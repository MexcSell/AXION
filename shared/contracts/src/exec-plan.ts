/**
 * c96 (R6-8 part 1): the approved execution plan a scripted agent is checked against. Types, limits and canonical JSON only; the
 * validator and checker live in server/src/exec-plan. Checks a scripted agent against its approved plan; it does not test a real
 * model. Label propagation is next phase and is not here.
 */
export type ScalarValue = string | number | boolean | null;

/** Argument constraints. No regex: matching is linear (string comparison, prefix, suffix, contains, numeric bounds). */
export type ArgConstraint = (
  | { kind: 'exact'; value: string | number | boolean | null }
  | { kind: 'oneOf'; values: (string | number | boolean)[] }
  | { kind: 'text'; op: 'prefix' | 'suffix' | 'contains'; value: string }
  | { kind: 'range'; min?: number; max?: number }
  /** the argument is a list; every element must be in `values`; a strict subset is a narrowing */
  | { kind: 'subsetOf'; values: (string | number | boolean)[]; maxItems?: number }
) & { /** an omitted optional argument is a narrowing; an omitted required argument is an expansion */ optional?: boolean };

export interface PlanCall {
  id: string;
  tool: string;
  args: Record<string, ArgConstraint>;
  /** exact normalised origins this call may run on (each must be in `grants`); empty means the tool has no origin */
  origins: string[];
  /** ids of plan calls that must have run before this one */
  after?: string[];
  /** how many times this call may run (default 1) */
  max?: number;
}
export interface ExecPlan {
  v: 1;
  calls: PlanCall[];
  /** tools that are refused whatever the provenance */
  forbiddenTools: string[];
  /** the site grants' exact origins; an origin outside this list is denied */
  grants: string[];
}

export type ExecProvenance = 'user' | 'system' | 'untrusted';
export const EXEC_PROVENANCES: readonly ExecProvenance[] = ['user', 'system', 'untrusted'];
export interface ProposedCall {
  tool: string;
  args: Record<string, ScalarValue | ScalarValue[]>;
  origin: string | null;
  provenance: ExecProvenance;
}
/** One earlier step of the trajectory: the plan call it matched (null when it matched none, e.g. a one-off approval). */
export interface TrajectoryStep { planCallId: string | null }

export type ConformanceDecision = 'allow' | 'narrow-allow' | 'needs-approval' | 'deny';
export type ConformanceReason =
  | 'in_plan' | 'narrowed' | 'new_tool' | 'forbidden_tool' | 'origin_not_granted' | 'new_origin' | 'wider_value' | 'extra_arg'
  | 'missing_arg' | 'out_of_order' | 'exceeds_count' | 'untrusted_off_plan' | 'malformed';
export interface ConformanceResult { decision: ConformanceDecision; reasons: ConformanceReason[]; planCallId: string | null }

export const EXEC_PLAN_LIMITS = Object.freeze({
  maxCalls: 64, maxArgs: 16, maxValues: 64, maxList: 32, maxString: 512, maxToolName: 64, maxId: 32, maxOrigins: 16, maxGrants: 32,
  maxForbidden: 64, maxHistory: 1024, maxMax: 1000, maxDepth: 5, maxNodes: 4000,
});

/** Canonical JSON: keys sorted at every level (same rule as the approvals digest). */
export function canonicalPlanJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalPlanJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + canonicalPlanJson((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v);
}
