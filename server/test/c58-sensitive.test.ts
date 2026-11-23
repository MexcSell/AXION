import { describe, it, expect } from 'vitest';
import { SENSITIVE_KINDS, FLAG_SOURCES, deriveFlags } from '../src/policy/rule-of-two.ts';
import { CURRENT_BASELINE } from '../src/policy/index.ts';

// c58 fix F1: what flag (b) means today. No existing kind or capability reads another mission's or tenant data, or secrets, except through an
// infra or critical kind. This list is pinned so adding a kind to the baseline forces a decision about flag (b).
describe('c58 fix F1: flag (b) is exactly the infra and critical kinds', () => {
  it('the kinds that set (b) are pinned', () => {
    expect([...SENSITIVE_KINDS].sort()).toEqual(['add_integration', 'autonomous_gate_change', 'irreversible_delete', 'merge_source', 'move_agent_permissions', 'origin-grant', 'production_deploy', 'release', 'release-record', 'rotate_credential', 'security_policy_rewrite', 'update_live_site']);
  });
  it('no read or prepare kind reads outside the mission: none of them sets (b)', () => {
    for (const [k, r] of Object.entries(CURRENT_BASELINE.kinds)) if (r.effect === 'read' || r.effect === 'prepare') expect(deriveFlags({ capabilities: [{ kind: k }], siteGrants: [], contentOrigins: ['internal'] }).sensitiveAccess, k).toBe(false);
  });
  it('the mapping text says live systems and credentials, and does not claim data access', () => {
    expect(FLAG_SOURCES.sensitiveAccess).toMatch(/live systems|credentials/i);
    expect(FLAG_SOURCES.sensitiveAccess).not.toMatch(/sensitive data/i);
  });
});
