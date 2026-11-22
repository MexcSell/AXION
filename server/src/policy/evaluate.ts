// evaluate(): one pure decision. No I/O, no clock reads (`now` is passed in), no model.
// Deny overrides everything (Cedar). The policy lives outside the model and outside agent-editable storage (CaMeL).
import { CURRENT_BASELINE, approverFor } from './baseline.ts';
import { EFFECT_FLOOR, isTier, maxTier, tierRank, type Action, type Decision, type Grant, type ReasonCode, type RiskTier, type TenantPolicy } from './types.ts';

const NO_OVERRIDE: TenantPolicy = Object.freeze({});

function covering(action: Action, grants: readonly Grant[]) {
  const where = action.target ?? action.origin;
  return grants.filter((g) =>
    g.subjectId === action.requester.id && g.kinds.includes(action.kind)
    && (g.target === undefined || g.target === where)
    && (g.missionId === undefined || g.missionId === action.missionId));
}

export function evaluate(action: Action, grants: readonly Grant[], tenantPolicy: TenantPolicy = NO_OVERRIDE, now: number): Decision {
  const policy = CURRENT_BASELINE;
  const policyVersion = policy.version;
  const rule = typeof action.kind === 'string' && Object.prototype.hasOwnProperty.call(policy.kinds, action.kind) ? policy.kinds[action.kind] : undefined;
  if (!rule) return { outcome: 'deny', tier: 'R4', approver: null, reasons: ['unknown_action'], policyVersion };

  const reasons: ReasonCode[] = ['baseline_tier'];
  let tier: RiskTier = rule.tier;
  const knownEffect = typeof action.effect === 'string' && Object.prototype.hasOwnProperty.call(EFFECT_FLOOR, action.effect);
  const floor = knownEffect ? EFFECT_FLOOR[action.effect] : undefined;
  if (!knownEffect) reasons.push('unknown_effect'); // reported, and it cannot lower the tier: the baseline tier stands
  if (floor && tierRank(floor) > tierRank(tier)) { tier = maxTier(tier, floor); reasons.push('effect_raises_tier'); }

  // a tenant/owner policy may only tighten
  const asked = tenantPolicy.minTier && Object.prototype.hasOwnProperty.call(tenantPolicy.minTier, action.kind) ? tenantPolicy.minTier[action.kind] : undefined;
  if (asked !== undefined) {
    if (isTier(asked) && tierRank(asked) > tierRank(tier)) { tier = asked; reasons.push('tenant_raised_tier'); }
    else if (!isTier(asked) || tierRank(asked) < tierRank(tier)) reasons.push('override_loosening_ignored');
  }

  const denies: ReasonCode[] = [];
  if (rule.prohibited === 'any' || (rule.prohibited === 'agent' && action.requester.kind === 'agent')) denies.push('prohibited');
  if (tenantPolicy.deny?.includes(action.kind)) denies.push('tenant_deny');

  // R0 always, and R1 for an agent, need a grant that covers the kind, target and mission
  const needsGrant = tier === 'R0' || (tier === 'R1' && action.requester.kind === 'agent');
  if (needsGrant && !denies.length) {
    const cover = covering(action, grants);
    if (!cover.some((g) => g.expiresAt > now)) denies.push(cover.length ? 'grant_expired' : tier === 'R0' ? 'no_grant' : 'out_of_scope');
  }

  if (denies.length) return { outcome: 'deny', tier, approver: null, reasons: [...reasons, ...denies], policyVersion };
  const approver = approverFor(tier);
  if (!approver) {
    if (tier === 'R1') reasons.push('audit_required');
    return { outcome: 'allow', tier, approver: null, reasons, policyVersion };
  }
  reasons.push(`approval_${approver}` as ReasonCode);
  return { outcome: 'needs_approval', tier, approver, reasons, policyVersion };
}
