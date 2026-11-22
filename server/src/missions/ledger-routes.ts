import type { FastifyInstance } from 'fastify';
import { tx, type Tx, type Db } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, badRequest, forbidden, notFound } from '../errors.ts';
import { requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { emit } from '../events/hooks.ts';
import { canManage } from './visibility.ts';
import { getVisibleRow } from './service.ts';
import { ProgressInSchema, TaskBodySchema, WriteEnvelope } from './ledger-schema.ts';
import { LEDGER_KINDS, STALL_POLICY, stallCheck, type LedgerDto, type LedgerKind, type LedgersDto, type LedgerVersionDto, type ProgressBody } from '../../../shared/contracts/src/ledgers.ts';

/**
 * Cycle 39: mission ledgers (task and progress), after Magentic-One's Orchestrator (arXiv 2411.04468).
 * Reads follow mission visibility (an invisible mission is 404). Writes are for people only: an administrator or the
 * mission's owner. A write names the version it was made from (baseVersion); a stale one is 409 LEDGER_CONFLICT
 * (compare-and-set), and the next number is assigned while the mission row is locked, so versions are gap-free.
 */
const SELECT = `select l.*, u.name as author_name from mission_ledgers l left join users u on u.id = l.author_id`;
const authorName = (r: any) => (r.author_kind === 'system' ? (r.demo ? 'DEMO sample' : 'System') : (r.author_name ?? r.author_id));
const meta = (r: any): LedgerVersionDto => ({ version: r.version, authorId: r.author_id, authorName: authorName(r), authorKind: r.author_kind, createdAt: new Date(r.created_at).toISOString(), demo: r.demo });
const dto = (r: any): LedgerDto => ({ id: r.id, missionId: r.mission_id, kind: r.kind, body: r.body, ...meta(r) });
const kindOf = (k: string): LedgerKind => { if (!(LEDGER_KINDS as readonly string[]).includes(k)) throw notFound('No such ledger.'); return k as LedgerKind; };

async function stallOf(c: Tx | Db, missionId: string) {
  const h = (await c.query(`select body from mission_ledgers where mission_id=$1 and kind='progress' order by version desc limit 50`, [missionId])).rows;
  return stallCheck(h.map((r) => r.body as ProgressBody).reverse());
}

export default async function ledgerRoutes(app: FastifyInstance) {
  app.get('/missions/:id/ledgers', async (req): Promise<LedgersDto> => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const m = await getVisibleRow(app.db, ctx, id);
    const latest = (await app.db.query(`${SELECT} where l.mission_id=$1 and (l.kind, l.version) in (select kind, max(version) from mission_ledgers where mission_id=$1 group by kind)`, [id])).rows;
    const all = (await app.db.query(`${SELECT} where l.mission_id=$1 order by l.kind, l.version desc limit 1000`, [id])).rows;
    const pick = (k: LedgerKind) => { const r = latest.find((x) => x.kind === k); return r ? dto(r) : null; };
    return {
      ledgers: { task: pick('task') as LedgersDto['ledgers']['task'], progress: pick('progress') as LedgersDto['ledgers']['progress'] },
      versions: { task: all.filter((r) => r.kind === 'task').map(meta), progress: all.filter((r) => r.kind === 'progress').map(meta) },
      stall: await stallOf(app.db, id), policy: STALL_POLICY, canEdit: canManage(ctx, m), demo: !!m.demo,
    };
  });

  app.get('/missions/:id/ledgers/:kind/:version', async (req) => {
    const ctx = await requireUser(req);
    const { id, kind, version } = req.params as { id: string; kind: string; version: string };
    const k = kindOf(kind);
    await getVisibleRow(app.db, ctx, id);
    if (!/^\d{1,7}$/.test(version)) throw notFound('No such version.');
    const r = (await app.db.query(`${SELECT} where l.mission_id=$1 and l.kind=$2 and l.version=$3`, [id, k, Number(version)])).rows[0];
    if (!r) throw notFound('No such version.');
    return { ledger: dto(r) };
  });

  app.post('/missions/:id/ledgers/:kind', async (req, reply) => {
    const ctx = await requireUser(req);
    const { id, kind } = req.params as { id: string; kind: string };
    const k = kindOf(kind);
    const ledger = await tx(app.db, async (c) => {
      const m = await getVisibleRow(c, ctx, id, true); // 404 when invisible; the row lock serialises every writer of this mission
      if (!canManage(ctx, m)) throw forbidden('Only the mission owner or an administrator can edit its ledgers.');
      const env = parse(WriteEnvelope, req.body);
      const sch = (k === 'task' ? TaskBodySchema : ProgressInSchema).safeParse(env.body);
      if (!sch.success) {
        const fieldErrors: Record<string, string> = {};
        for (const i of sch.error.issues) fieldErrors[['body', ...i.path].join('.')] = i.message;
        throw badRequest('Some fields are not valid.', fieldErrors);
      }
      if (m.status === 'archived') throw new ApiError('ILLEGAL_TRANSITION', 409, 'Restore the mission before editing its ledgers.');
      const cur = Number((await c.query(`select coalesce(max(version), 0) as v from mission_ledgers where mission_id=$1 and kind=$2`, [id, k])).rows[0].v);
      if (cur !== env.baseVersion) throw new ApiError('LEDGER_CONFLICT', 409, `Someone saved version ${cur} of this ledger meanwhile. Load it and apply your change again.`);
      let body: unknown = sch.data;
      if (k === 'progress') {
        const hist = (await c.query(`select body from mission_ledgers where mission_id=$1 and kind='progress' order by version desc limit 50`, [id])).rows.map((r) => r.body as ProgressBody).reverse();
        body = { ...(sch.data as object), stall: stallCheck([...hist, sch.data as ProgressBody]).counter };
      }
      const row = (await c.query(
        `insert into mission_ledgers(tenant_id, mission_id, kind, version, body, author_id, author_kind) values ($1,$2,$3,$4,$5,$6,'human') returning *, $7::text as author_name`,
        [ctx.tenantId, id, k, cur + 1, JSON.stringify(body), ctx.user.id, ctx.user.name])).rows[0];
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'mission.ledger', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { kind: k, version: cur + 1 } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'ledger.updated', subject: id, missionId: id, payload: { kind: k, version: cur + 1 } });
      return dto(row);
    });
    return reply.status(201).send({ ledger });
  });
}
