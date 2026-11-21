import type { Tx, Db } from '../db.ts';
import { activeRevision, edgesOf } from '../agents/org.ts';
import type { OrgView } from '../../../web/src/features/mission/staffing-org.ts';

/**
 * Improvement cycle 11: the organisation a new real mission is staffed from. Read-only: the active revision (as
 * /organization/graph shows it), its reporting lines and every agent's department and lifecycle. Undefined when the
 * tenant has no revision yet (staffing then follows the fixture rule).
 */
export async function readOrgView(c: Tx | Db, tenantId: string): Promise<OrgView | undefined> {
  const rev = await activeRevision(c, tenantId);
  if (!rev) return undefined;
  const edges = await edgesOf(c, rev.id);
  const agents = (await c.query('select id, dept, status from agent_definitions where tenant_id=$1 order by id', [tenantId])).rows
    .map((r) => ({ id: r.id as string, dept: r.dept as string, active: r.status === 'active' }));
  return { revision: rev.seq, agents, edges: edges.map((e) => ({ supervisorId: e.supervisorId, subordinateId: e.subordinateId })) };
}
