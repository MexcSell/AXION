// Deterministic policy service: shared types. Pure data, no I/O. Spec §13.2 (risk tiers), invariants 7 and 10.

export const TIERS = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;
export type RiskTier = (typeof TIERS)[number];
export const tierRank = (t: RiskTier): number => TIERS.indexOf(t);
export const isTier = (t: unknown): t is RiskTier => typeof t === 'string' && (TIERS as readonly string[]).includes(t);
export const maxTier = (a: RiskTier, b: RiskTier): RiskTier => (tierRank(a) >= tierRank(b) ? a : b);

export const EFFECTS = ['read', 'prepare', 'external', 'infra', 'critical'] as const;
export type Effect = (typeof EFFECTS)[number];
/** The lowest tier an effect can have. A caller's effect label can raise a tier, never lower it. */
export const EFFECT_FLOOR: Readonly<Record<Effect, RiskTier>> = Object.freeze({ read: 'R0', prepare: 'R1', external: 'R2', infra: 'R3', critical: 'R4' });

export interface Requester { id: string; kind: 'user' | 'agent'; role: string }

export interface Action {
  kind: string;
  target?: string;
  origin?: string;
  missionId?: string;
  requester: Requester;
  effect: Effect;
  payload: Record<string, unknown>;
}

/** In-memory grant (P4 will back it with a table). It covers one subject, a list of action kinds, optionally one target and one mission. */
export interface Grant { id: string; subjectId: string; kinds: string[]; target?: string; missionId?: string; expiresAt: number }

/** Who must approve. 'owner' is the highest human gate; today an administrator holds it. */
export type Approver = 'user' | 'admin' | 'owner';

export const REASON_CODES = [
  'baseline_tier', 'effect_raises_tier', 'tenant_raised_tier', 'override_loosening_ignored',
  'unknown_action', 'unknown_effect', 'prohibited', 'tenant_deny', 'no_grant', 'grant_expired', 'out_of_scope', 'audit_required',
  'approval_user', 'approval_admin', 'approval_owner',
  'rule_of_two', 'rule_of_two_deny',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface Decision {
  outcome: 'allow' | 'needs_approval' | 'deny';
  tier: RiskTier;
  approver: Approver | null;
  reasons: ReasonCode[];
  policyVersion: number;
}

/** Owner/tenant policy. It can only tighten: raise a kind's tier or deny a kind. */
/** `ruleOfTwo: 'deny'` turns the Rule-of-Two escalation into a refusal. Any other value changes nothing (the rule only ever escalates). */
export interface TenantPolicy { minTier?: Readonly<Record<string, RiskTier>>; deny?: readonly string[]; ruleOfTwo?: 'deny' }
