import type { FastifyInstance } from 'fastify';
import type { Db, Tx } from '../db.ts';
import { requireUser } from '../auth/session.ts';
import { edgesOf, latestRevision } from '../agents/org.ts';
import { orgCoverage, coverageChanges, type CoverageAgent, type CoverageEdge } from './coverage.ts';
import type { OrgCoverage, OrgDryRunCoverage } from '../../../shared/contracts/src/index.ts';

/** The tenant's agents as the coverage facts need them (current definitions; a revision's coverage uses today's agents). */
export async function coverageAgents(c: Tx | Db, tenantId: string): Promise<CoverageAgent[]> {
  return (await c.query('select id, status, dept, role, duty from agent_definitions where tenant_id=$1', [tenantId])).rows;
}
/** Coverage of the active revision (null id = no revision: no lines). */
export async function activeCoverage(c: Tx | Db, tenantId: string, agents?: CoverageAgent[]) {
  const cur = await latestRevision(c, tenantId);
  const edges = cur.id === null ? [] : await edgesOf(c, cur.id);
  return { seq: cur.seq, edges, coverage: orgCoverage(edges, agents ?? await coverageAgents(c, tenantId)) };
}
/** The coverage block of a dry run: the active lines, the proposed lines, and what changes. Warnings only, never errors. */
export async function dryRunCoverage(c: Tx | Db, tenantId: string, proposed: CoverageEdge[], current: CoverageEdge[]): Promise<OrgDryRunCoverage> {
  const agents = await coverageAgents(c, tenantId);
  const before = orgCoverage(current, agents);
  const after = orgCoverage(proposed, agents, undefined, current);
  return { current: before, proposed: after, changes: coverageChanges(before, after) };
}
export const revisionCoverage = (edges: CoverageEdge[], agents: CoverageAgent[]): OrgCoverage => orgCoverage(edges, agents);

export default async function coverageRoutes(app: FastifyInstance) {
  /** Coverage facts of the active organisation revision. Read only; any signed-in user of the tenant. */
  app.get('/organization/coverage', async (req) => {
    const ctx = await requireUser(req);
    const { seq, coverage } = await activeCoverage(app.db, ctx.tenantId);
    return { revision: seq, coverage };
  });
}
