import type { Tx, Db } from '../db.ts';
import { ApiError, badRequest } from '../errors.ts';
import type { OrgEdgeDto, OrgRevisionDto } from '../../../shared/contracts/src/index.ts';

export interface EdgeIn { supervisorId: string; subordinateId: string; edgeType?: string }
const CHAIN_LIMIT = 64;

/**
 * Cycle check (subnet-scout organization.py pattern): each subordinate has one supervisor; walk every supervisor
 * chain with a seen-set and a depth limit. Self-edges, loops and chains deeper than the limit are ORG_CYCLE (422).
 */
export function assertAcyclic(edges: EdgeIn[]) {
  const up = new Map<string, string>();
  for (const e of edges) {
    if (e.supervisorId === e.subordinateId) throw new ApiError('ORG_CYCLE', 422, 'An agent cannot report to itself.');
    if (up.has(e.subordinateId)) throw badRequest(`${e.subordinateId} has more than one supervisor.`);
    up.set(e.subordinateId, e.supervisorId);
  }
  for (const start of up.keys()) {
    const seen = new Set<string>([start]);
    let cur = up.get(start);
    for (let depth = 0; cur !== undefined; depth++) {
      if (seen.has(cur) || depth >= CHAIN_LIMIT) throw new ApiError('ORG_CYCLE', 422, 'These reporting lines form a loop.');
      seen.add(cur);
      cur = up.get(cur);
    }
  }
}

/** Append a new organization revision (append-only). Edges are validated before anything is inserted. */
export async function createOrgRevision(c: Tx, a: { tenantId: string; edges: EdgeIn[]; note: string; createdBy: string }): Promise<OrgRevisionDto> {
  assertAcyclic(a.edges);
  const ids = [...new Set(a.edges.flatMap((e) => [e.supervisorId, e.subordinateId]))];
  if (ids.length) {
    const have = (await c.query('select id from agent_definitions where tenant_id=$1 and id = any($2)', [a.tenantId, ids])).rows.map((r) => r.id);
    const missing = ids.filter((i) => !have.includes(i));
    if (missing.length) throw badRequest(`Unknown agent: ${missing[0]}.`);
  }
  await c.query('select pg_advisory_xact_lock(hashtext($1))', ['org-rev:' + a.tenantId]);
  const seq = Number((await c.query('select coalesce(max(seq),0)+1 s from org_revisions where tenant_id=$1', [a.tenantId])).rows[0].s);
  const rev = (await c.query('insert into org_revisions(tenant_id, seq, note, created_by) values ($1,$2,$3,$4) returning *', [a.tenantId, seq, a.note, a.createdBy])).rows[0];
  for (const e of a.edges) {
    await c.query('insert into org_edges(revision_id, supervisor_id, subordinate_id, edge_type) values ($1,$2,$3,$4)', [rev.id, e.supervisorId, e.subordinateId, e.edgeType ?? 'reports_to']);
  }
  return revDto(rev);
}

export const revDto = (r: any): OrgRevisionDto => ({ id: Number(r.id), seq: r.seq, note: r.note, createdBy: r.created_by, activeFrom: new Date(r.active_from).toISOString() });

export async function activeRevision(c: Tx | Db, tenantId: string) {
  const r = (await c.query('select * from org_revisions where tenant_id=$1 and active_from <= now() order by seq desc limit 1', [tenantId])).rows[0];
  return r ? revDto(r) : null;
}

export async function edgesOf(c: Tx | Db, revisionId: number): Promise<OrgEdgeDto[]> {
  return (await c.query('select supervisor_id, subordinate_id, edge_type from org_edges where revision_id=$1 order by subordinate_id', [revisionId]))
    .rows.map((e) => ({ supervisorId: e.supervisor_id, subordinateId: e.subordinate_id, edgeType: e.edge_type }));
}
