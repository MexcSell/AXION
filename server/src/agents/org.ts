import type { Tx, Db } from '../db.ts';
import { ApiError, badRequest } from '../errors.ts';
import type { OrgEdgeDto, OrgRevisionDto } from '../../../shared/contracts/src/index.ts';
import { validateOrg } from '../organization/validate.ts';
import { advisoryXactLock } from '../locks.ts';

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

/** The org write lock. Every org-revision writer takes it BEFORE it reads the organisation (review I-1). */
export const lockOrg = (c: Tx, tenantId: string) => advisoryXactLock(c, 'org-rev:' + tenantId);

/**
 * The newest revision by seq. Writers use this, not activeRevision(): its `active_from <= now()` compares with the
 * transaction's start time and can miss a revision another transaction committed while this one waited on the lock.
 */
export async function latestRevision(c: Tx | Db, tenantId: string): Promise<{ seq: number; id: number | null }> {
  const r = (await c.query('select id, seq from org_revisions where tenant_id=$1 order by seq desc limit 1', [tenantId])).rows[0];
  return r ? { seq: r.seq, id: Number(r.id) } : { seq: 0, id: null };
}

/**
 * Append a new organization revision (append-only), the only way any caller writes one. Lock, then read the latest
 * revision; `edges` is the full new set, or a function of the latest revision's edges (so no caller reads outside the
 * lock). `expectSeq`: refuse (409 ORG_CHANGED) unless the latest revision is still that one. The chart is checked before
 * anything is inserted: ORG_CYCLE for loops and self-edges (as before), then the full dry run (validateOrg): any error,
 * e.g. an agent without a manager or a chain not under the GM, is 422 ORG_INVALID.
 */
export async function createOrgRevision(c: Tx, a: { tenantId: string; edges: EdgeIn[] | ((latest: EdgeIn[]) => EdgeIn[]); note: string; createdBy: string; expectSeq?: number }): Promise<OrgRevisionDto> {
  await lockOrg(c, a.tenantId);
  const cur = await latestRevision(c, a.tenantId);
  if (a.expectSeq !== undefined && cur.seq !== a.expectSeq) throw new ApiError('ORG_CHANGED', 409, `The organisation changed meanwhile (revision ${cur.seq} is active, not ${a.expectSeq}).`);
  const current = cur.id === null ? [] : await edgesOf(c, cur.id);
  const edges = typeof a.edges === 'function' ? a.edges(current) : a.edges;
  assertAcyclic(edges);
  const ids = [...new Set(edges.flatMap((e) => [e.supervisorId, e.subordinateId]))];
  if (ids.length) {
    const have = (await c.query('select id from agent_definitions where tenant_id=$1 and id = any($2)', [a.tenantId, ids])).rows.map((r) => r.id);
    const missing = ids.filter((i) => !have.includes(i));
    if (missing.length) throw badRequest(`Unknown agent: ${missing[0]}.`);
  }
  const agents = (await c.query('select id, status, dept, role from agent_definitions where tenant_id=$1', [a.tenantId])).rows;
  const check = validateOrg(edges, agents, current);
  if (!check.ok) throw new ApiError('ORG_INVALID', 422, `This organisation chart is not valid: ${check.errors[0].message}`);
  const rev = (await c.query('insert into org_revisions(tenant_id, seq, note, created_by) values ($1,$2,$3,$4) returning *', [a.tenantId, cur.seq + 1, a.note, a.createdBy])).rows[0];
  for (const e of edges) {
    await c.query('insert into org_edges(revision_id, supervisor_id, subordinate_id, edge_type) values ($1,$2,$3,$4)', [rev.id, e.supervisorId, e.subordinateId, e.edgeType ?? 'reports_to']);
  }
  return revDto(rev);
}

export const revDto = (r: any): OrgRevisionDto => ({ id: Number(r.id), seq: r.seq, note: r.note, createdBy: r.created_by, activeFrom: new Date(r.active_from).toISOString() });

/** Reads (graph, catalog managers). Writers use latestRevision() under lockOrg(). */
export async function activeRevision(c: Tx | Db, tenantId: string) {
  const r = (await c.query('select * from org_revisions where tenant_id=$1 and active_from <= now() order by seq desc limit 1', [tenantId])).rows[0];
  return r ? revDto(r) : null;
}

export async function edgesOf(c: Tx | Db, revisionId: number): Promise<OrgEdgeDto[]> {
  return (await c.query('select supervisor_id, subordinate_id, edge_type from org_edges where revision_id=$1 order by subordinate_id', [revisionId]))
    .rows.map((e) => ({ supervisorId: e.supervisor_id, subordinateId: e.subordinate_id, edgeType: e.edge_type }));
}
