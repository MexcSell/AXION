import type { Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { AGENTS } from '../../../web/src/data/agents.ts';
import { addVersion } from './service.ts';
import { createOrgRevision } from './org.ts';
import { advisoryXactLock } from '../locks.ts';

/**
 * Decision E1: the prototype's 18 agents are company data. Idempotent: inserts any fixture agent that is missing
 * (one version labelled with the fixture version) and creates org revision 1 from `managerId` when none exists.
 * Display-only fields go into profile (E2), tagged as demo-fixture.
 */
export async function seedCompany(c: Tx, tenantId: string) {
  await advisoryXactLock(c, 'agent-seed:' + tenantId);
  const have = new Set((await c.query('select id from agent_definitions where tenant_id=$1', [tenantId])).rows.map((r) => r.id));
  let added = 0;
  for (const a of AGENTS) {
    if (have.has(a.id)) continue;
    const { id, name, role, dept, duty, parentId, site, description, model, skills, version, managerId: _m, ...profile } = a;
    void _m;
    await c.query(
      `insert into agent_definitions(id, tenant_id, name, role, dept, duty, parent_id, site, description, profile, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'system')`,
      [id, tenantId, name, role, dept, duty, parentId ?? null, site ?? null, description, JSON.stringify({ ...profile, provenance: { source: 'demo-fixture', sample: null, window: '90d' } })]);
    await addVersion(c, { agentId: id, model, skills, tools: [], createdBy: 'system', label: version });
    have.add(id);
    added++;
  }
  const hasRev = (await c.query('select 1 from org_revisions where tenant_id=$1 limit 1', [tenantId])).rowCount;
  let revision = false;
  if (!hasRev) {
    const edges = AGENTS.filter((a) => a.managerId && have.has(a.managerId)).map((a) => ({ supervisorId: a.managerId!, subordinateId: a.id }));
    await createOrgRevision(c, { tenantId, edges, note: 'Initial organization (seeded)', createdBy: 'system' });
    revision = true;
  }
  if (added || revision) await audit(c, { tenantId, actor: 'system', action: 'agents.seed', subject: tenantId, result: 'ok', correlationId: 'seed-agents-' + Date.now(), detail: { agents: added, revision } });
  return { agents: added, revision };
}
