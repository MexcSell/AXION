import type { Tx } from '../../src/db.ts';
import { COMPANY_AGENTS } from '../../../shared/company/agents.ts';
import { addVersion } from '../../src/agents/service.ts';

/**
 * Finding for the c79 report (not a leak): `agent_definitions.id` is the primary key on its own, so the standard company seed cannot be
 * stored for a second tenant in the same schema (duplicate key). Tenant B therefore gets the same company under prefixed agent ids
 * ('b-coder-01'), without an organisation chart (the validator requires the literal root id 'gm', also global). Used through vi.mock of src/agents/seed.ts in the tenant test files; tenant t-1 keeps the real seed.
 */
export const prefixOf = (tenantId: string) => (tenantId === 't-b' ? 'b-' : '');
export async function seedPrefixedCompany(c: Tx, tenantId: string) {
  const p = prefixOf(tenantId);
  const have = new Set((await c.query('select id from agent_definitions where tenant_id=$1', [tenantId])).rows.map((r) => r.id));
  for (const a of COMPANY_AGENTS) {
    const id = p + a.id;
    if (have.has(id)) continue;
    const { name, role, dept, duty, parentId, site, description, model, skills, version, managerId: _m, id: _i, ...profile } = a as any;
    void _m; void _i;
    await c.query(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, parent_id, site, description, profile, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'system')`,
      [id, tenantId, name, role, dept, duty, parentId ? p + parentId : null, site ?? null, description, JSON.stringify({ ...profile, provenance: { source: 'demo-fixture', sample: null, window: '90d' } })]);
    await addVersion(c, { agentId: id, model, skills, tools: [], createdBy: 'system', label: version });
  }
  // No org revision for a second tenant: the chart validator requires the agent with the literal id 'gm' as root, and 'gm' is already tenant t-1's row.
  return { agents: COMPANY_AGENTS.length, revision: false };
}
