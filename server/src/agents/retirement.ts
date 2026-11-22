import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx, type Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { logContribution } from './contributions.ts';
import { SKILL_OUTCOME_MIN_N, SKILL_SCORE_FLOOR, type RetirementProposalDto, type RetirementProposalsDto } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 59 (R2-5): outcome-driven retirement proposals. FIXTURE-ONLY: no agent uses a skill yet, so no route or job writes a
 * score. recordFixtureOutcome is the only writer (tests and demo fixtures call it), and the table accepts only source 'fixture'.
 *  - A proposal is DERIVED on read: an approved skill whose latest score is below SKILL_SCORE_FLOOR with at least SKILL_OUTCOME_MIN_N
 *    observations, and that nobody dismissed for that very score. Nothing is stored, so there is nothing that could retire a skill.
 *  - A person decides: retire through the existing retire route, or keep through retirement-dismiss (logged in the contribution log).
 */
export async function recordFixtureOutcome(c: Tx, a: { tenantId: string; skillId: string; score: number; n: number }): Promise<number> {
  if (!(a.score >= 0 && a.score <= 1) || !Number.isInteger(a.n) || a.n < 1) throw new ApiError('VALIDATION', 400, 'A score is 0 to 1 and n is a whole number of at least 1.');
  return Number((await c.query(`insert into skill_outcomes(tenant_id, skill_id, score, n, source) values ($1,$2,$3,$4,'fixture') returning seq`, [a.tenantId, a.skillId, a.score, a.n])).rows[0].seq);
}

const PROPOSALS = `select s.id, s.name, s.version, o.seq, o.score::float8 as score, o.n, o.at
  from skills s join lateral (select * from skill_outcomes where skill_id = s.id order by seq desc limit 1) o on true
 where s.tenant_id = $1 and s.status = 'approved' and o.score < $2 and o.n >= $3
   and not exists (select 1 from record_contributions rc where rc.tenant_id = s.tenant_id and rc.record_kind = 'skill' and rc.record_id = s.id
                      and rc.action = 'retirement_kept' and rc.ref = o.seq::text)
 order by o.score, s.name`;

export async function retirementProposals(c: Tx, tenantId: string): Promise<RetirementProposalsDto> {
  const rows = (await c.query(PROPOSALS, [tenantId, SKILL_SCORE_FLOOR, SKILL_OUTCOME_MIN_N])).rows;
  const any = (await c.query('select 1 from skill_outcomes where tenant_id=$1 limit 1', [tenantId])).rowCount! > 0;
  const proposals: RetirementProposalDto[] = rows.map((r) => ({ skillId: r.id, name: r.name, version: r.version, score: r.score, n: r.n, outcomeId: Number(r.seq), recordedAt: new Date(r.at).toISOString(), source: 'fixture' }));
  return { floor: SKILL_SCORE_FLOOR, minN: SKILL_OUTCOME_MIN_N, dataState: any ? 'fixture' : 'none', proposals };
}

const DismissIn = z.object({ note: z.string().trim().max(1000).optional() }).strict();

export default async function retirementRoutes(app: FastifyInstance) {
  app.get('/skills/retirement-proposals', async (req) => {
    const ctx = await requireAdmin(req);
    return tx(app.db, (c) => retirementProposals(c, ctx.tenantId));
  });

  app.post('/skills/:sid/retirement-dismiss', async (req) => {
    const ctx = await requireAdmin(req);
    const { sid } = req.params as { sid: string };
    const b = parse(DismissIn, req.body);
    const A = 'skill.retirementDismiss';
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { ok: true }> => {
      const refuse = async (err: ApiError) => { await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: sid, result: 'denied', correlationId: ctx.correlationId, detail: { code: err.code } }); return { err }; };
      if (!(await c.query('select 1 from skills where id=$1 and tenant_id=$2', [sid, ctx.tenantId])).rowCount) return refuse(notFound('No such skill.'));
      const open = (await retirementProposals(c, ctx.tenantId)).proposals.find((p) => p.skillId === sid);
      if (!open) return refuse(new ApiError('PROPOSAL_NOT_PENDING', 409, 'There is no retirement proposal for this skill.'));
      await logContribution(c, { tenantId: ctx.tenantId, kind: 'skill', recordId: sid, action: 'retirement_kept', actor: ctx.user.id, actorKind: 'human', version: open.version, note: b.note || null, ref: String(open.outcomeId) });
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: sid, result: 'ok', correlationId: ctx.correlationId, detail: { outcomeId: open.outcomeId, score: open.score, n: open.n, note: b.note || null } });
      return { ok: true };
    });
    if ('err' in out) throw out.err;
    return out;
  });
}
