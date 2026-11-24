/**
 * c77 (M2): the pure budget check. WIRED TO NOTHING: no route, job or agent calls it; it only answers a question about numbers it is given.
 * A cap is a hard limit per unit (the unit is a ledger unit, or `cost_micros` for the fixed-point cost). Usage at or above the limit is
 * denied, usage at or above warnAtPct of the limit warns. Integer arithmetic only. Anything malformed denies (fail closed).
 */
export interface BudgetCap { unit: string; limit: number; warnAtPct?: number }
export interface UsageTotal { unit: string; quantity: number }
export type BudgetDecision = 'allow' | 'warn' | 'deny';
export interface BudgetReason { code: 'near_cap' | 'cap_reached' | 'invalid_input'; unit?: string; used?: number; limit?: number }
export const DEFAULT_WARN_PCT = 80;

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

export function checkBudget(caps: readonly BudgetCap[], usage: readonly UsageTotal[]): { decision: BudgetDecision; reasons: BudgetReason[] } {
  const invalid = (): { decision: 'deny'; reasons: BudgetReason[] } => ({ decision: 'deny', reasons: [{ code: 'invalid_input' }] });
  const seen = new Set<string>();
  for (const c of caps) {
    const pct = c.warnAtPct ?? DEFAULT_WARN_PCT;
    if (typeof c.unit !== 'string' || !c.unit || seen.has(c.unit) || !isCount(c.limit) || !Number.isInteger(pct) || pct < 1 || pct > 99) return invalid();
    seen.add(c.unit);
  }
  const used = new Map<string, number>();
  for (const u of usage) {
    if (typeof u.unit !== 'string' || !isCount(u.quantity)) return invalid();
    const sum = (used.get(u.unit) ?? 0) + u.quantity;
    if (!Number.isSafeInteger(sum)) return invalid();
    used.set(u.unit, sum);
  }
  const reasons: BudgetReason[] = [];
  let decision: BudgetDecision = 'allow';
  for (const c of caps) {
    const n = used.get(c.unit) ?? 0;
    const pct = c.warnAtPct ?? DEFAULT_WARN_PCT;
    if (n >= c.limit) { reasons.push({ code: 'cap_reached', unit: c.unit, used: n, limit: c.limit }); decision = 'deny'; }
    else if (BigInt(n) * 100n >= BigInt(c.limit) * BigInt(pct)) { reasons.push({ code: 'near_cap', unit: c.unit, used: n, limit: c.limit }); if (decision === 'allow') decision = 'warn'; }
  }
  return { decision, reasons };
}
