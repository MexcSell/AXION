import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { notFound } from '../errors.ts';
import { tx } from '../db.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { DIMENSION_WINDOWS, FAILURE_TAXONOMY_VERSION } from '../../../shared/contracts/src/index.ts';
import { computeDimensions, type DimInput } from './dimensions.ts';
import { loadDeptRows } from './departments.ts';
import { dbWindow } from './clock.ts';

const QueryIn = z.object({ window: z.enum(DIMENSION_WINDOWS as unknown as [string, ...string[]]).default('30d'), department: z.string().trim().min(1).max(80).optional() }).strict();

/**
 * Improvement cycle 46: GET /company/dimensions?window=7d|30d|90d&department=. Any signed-in user. DEMO missions and simulated
 * rows are never read (there is no includeDemo switch). Mission-scoped tables are read only for the missions the caller can
 * see (the same predicate as GET /company/scorecard). Tables that are not mission-scoped follow their own routes: version
 * proposals, playbooks, org revisions and rollbacks are readable by every signed-in user; lessons under review and site
 * grants are administrator-only there, so a member's cells for them stay 'none' with n = 0 (the pure function enforces it).
 */
/** One client runs one query at a time: await them in order (the snapshot is the transaction, not concurrency). */
async function runInOrder<T>(_c: unknown, fs: (() => Promise<T>)[]): Promise<T[]> { const out: T[] = []; for (const f of fs) out.push(await f()); return out; }

export default async function dimensionRoutes(app: FastifyInstance) {
  app.get('/company/dimensions', async (req) => {
    const ctx = await requireUser(req);
    const qs = parse(QueryIn, req.query ?? {});
    const T = ctx.tenantId;
    const admin = ctx.user.role === 'admin';
    return tx(app.db, async (c) => {
      // one snapshot for every read: REPEATABLE READ (the first statement of the transaction), one database clock
      await c.query('set transaction isolation level repeatable read read only');
      // one clock for the whole read: the database's (expiry and window ends are compared against it, never the app clock)
      const w = await dbWindow(c, qs.window as '7d' | '30d' | '90d');
      // SQL time bounds come from SQL: pg hands timestamptz back as a JS Date (milliseconds), so a row written in the same millisecond as
      // this read's now() has created_at above the Date and would be dropped by `<= $to`. Upper bound: `<= now()` (the same transaction
      // clock). Lower bound: `now() - interval`, 2 ms wider than the JS window start (the pure function filters rows by the JS dates; the SQL bound only has to load a superset).
      const sinceMs = 2 * (w.to.getTime() - w.from.getTime()) + 2;

      const missions = (await c.query(
        `select m.id, m.demo from missions m where m.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and not m.demo`,
        [T, admin, ctx.user.id])).rows;
      const ids = missions.map((m) => m.id as string);
      const dept = await loadDeptRows(c, { tenantId: T, admin, userId: ctx.user.id }, false);
      const has = ids.length > 0;
      const E = { rows: [] as Record<string, any>[] };
      const q = (sql: string, p: unknown[]) => (has ? c.query(sql, p) : Promise.resolve(E));
      // nothing older than the previous window is needed by a window cell; snapshots read in full below
      const queries: (() => Promise<{ rows: Record<string, any>[] }>)[] = [
        () => q(`select i.mission_id, i.agent_id, i.simulated, i.created_at from agent_instances i where i.tenant_id=$1 and i.mission_id = any($2::text[])`, [T, ids]),
        () => q(`select r.task_id, r.mission_id, r.reviewer_id, r.reviewer_kind, r.reviewer_model_family, r.producer_id, r.producer_kind, r.producer_model_family, r.principal_id,
                  r.verdict, jsonb_array_length(r.evidence) as ev, r.created_at, r.seq, (t.simulated or m.demo) as simulated
             from task_reviews r join tasks t on t.id=r.task_id join missions m on m.id=r.mission_id
            where r.tenant_id=$1 and r.mission_id = any($2::text[]) and r.created_at <= now()`, [T, ids]),
        () => q(`select l.mission_id, l.version, l.body, l.created_at, l.demo from mission_ledgers l where l.tenant_id=$1 and l.kind='progress' and l.mission_id = any($2::text[]) and l.created_at <= now()`, [T, ids]),
        () => q(`select r.mission_id, r.created_at, (select min(d.decided_at) from approval_decisions d where d.approval_id=r.id) as decided_at, r.demo
             from approval_requests r where r.tenant_id=$1 and r.mission_id = any($2::text[])`, [T, ids]),
        () => q(`select d.mission_id, d.to_instance, i.agent_id, d.at, d.simulated from mission_delegations d join agent_instances i on i.id=d.to_instance
            where i.tenant_id=$1 and d.mission_id = any($2::text[]) and d.edge_kind='delegated' and d.at >= now() - ($3::double precision * interval '1 millisecond')`, [T, ids, sinceMs]),
        () => q(`select mission_id, to_instance, simulated, created_at from delegation_briefs where tenant_id=$1 and mission_id = any($2::text[])`, [T, ids]),
        () => admin ? q(`select mission_id, issued_at, expires_at, revoked_at from site_grants where tenant_id=$1 and mission_id = any($2::text[]) and least(coalesce(revoked_at, expires_at), expires_at) >= now() - ($3::double precision * interval '1 millisecond')`, [T, ids, sinceMs]) : Promise.resolve(E),
        () => q(`select subject_id, mode_id, coalesce(decided_at, created_at) as at from failure_tags
            where tenant_id=$1 and mission_id = any($2::text[]) and subject_kind='task' and status='confirmed' and taxonomy_version=$3`, [T, ids, FAILURE_TAXONOMY_VERSION]),
        () => admin ? c.query(`select agent_id, status, created_at, decided_at, accepted_in_version, withdrawn_in_version from lesson_candidates where tenant_id=$1`, [T]) : Promise.resolve(E),
        () => c.query(`select agent_id, version, jsonb_array_length(items) as items, created_at from playbooks where tenant_id=$1`, [T]),
        () => c.query(`select agent_id, decided_at from agent_version_proposals where tenant_id=$1 and status='promoted' and decided_at is not null`, [T]),
        () => c.query(`select subject as agent_id, at from audit_events where tenant_id=$1 and action='agent.rollback' and result='ok'`, [T]),
        () => c.query(`select seq, active_from from org_revisions where tenant_id=$1`, [T]),
      ];
      const [instances, reviews, ledgers, approvals, delegations, briefs, grants, tags, lessons, playbooks, promotions, rollbacks, orgRevs] = await runInOrder(c, queries);
      const D = (x: unknown) => new Date(x as string);
      const input: DimInput = {
        admin,
        agents: dept.agents.map((a) => ({ id: a.id, dept: a.dept, role: '', active: a.active })),
        missions: missions.map((m) => ({ id: m.id, demo: m.demo })),
        instances: instances.rows.map((i) => ({ missionId: i.mission_id, agentId: i.agent_id, simulated: i.simulated, at: D(i.created_at) })),
        tasks: dept.tasks,
        reviews: reviews.rows.map((r) => ({ taskId: r.task_id, missionId: r.mission_id, reviewerId: r.reviewer_id, reviewerKind: r.reviewer_kind, reviewerFamily: r.reviewer_model_family, producerId: r.producer_id, producerKind: r.producer_kind, producerFamily: r.producer_model_family, principalId: r.principal_id, verdict: r.verdict, evidenceCount: Number(r.ev), at: D(r.created_at), seq: Number(r.seq), simulated: r.simulated })),
        ledgers: ledgers.rows.map((l) => ({ missionId: l.mission_id, version: l.version, body: l.body, at: D(l.created_at), demo: l.demo })),
        approvals: approvals.rows.map((a) => ({ missionId: a.mission_id, createdAt: D(a.created_at), decidedAt: a.decided_at ? D(a.decided_at) : null, demo: a.demo })),
        delegations: delegations.rows.map((d) => ({ missionId: d.mission_id, toInstance: d.to_instance, toAgent: d.agent_id, at: D(d.at), simulated: d.simulated })),
        briefs: briefs.rows.map((b) => ({ missionId: b.mission_id, toInstance: b.to_instance, simulated: b.simulated, at: D(b.created_at) })),
        grants: grants.rows.map((g) => ({ missionId: g.mission_id, issuedAt: D(g.issued_at), expiresAt: D(g.expires_at), revokedAt: g.revoked_at ? D(g.revoked_at) : null })),
        tags: tags.rows.map((g) => ({ taskId: g.subject_id, modeId: g.mode_id, at: D(g.at) })),
        lessons: lessons.rows.map((l) => ({ agentId: l.agent_id, status: l.status, createdAt: D(l.created_at), decidedAt: l.decided_at ? D(l.decided_at) : null, acceptedInVersion: l.accepted_in_version, withdrawnInVersion: l.withdrawn_in_version })),
        playbooks: playbooks.rows.map((p) => ({ agentId: p.agent_id, version: p.version, items: Number(p.items), at: D(p.created_at) })),
        promotions: promotions.rows.map((p) => ({ agentId: p.agent_id, at: D(p.decided_at) })),
        rollbacks: rollbacks.rows.map((r) => ({ agentId: r.agent_id, at: D(r.at) })),
        orgRevisions: orgRevs.rows.map((r) => ({ seq: r.seq, at: D(r.active_from) })),
        orgChanges: dept.orgChanges,
      };
      const roleOf = new Map((await c.query(`select id, role from agent_definitions where tenant_id=$1`, [T])).rows.map((a) => [a.id as string, a.role as string]));
      input.agents = input.agents.map((a) => ({ ...a, role: roleOf.get(a.id) ?? '' }));
      const departments = new Set(input.agents.filter((a) => a.active).map((a) => a.dept));
      if (qs.department && !departments.has(qs.department)) throw notFound('No such department.');
      return computeDimensions(input, { window: qs.window as '7d' | '30d' | '90d', from: w.from, to: w.to, department: qs.department ?? null });
    });

  });
}
