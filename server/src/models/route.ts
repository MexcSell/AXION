import { modelFamily } from '../tasks/review-rules.ts';

/**
 * c77 (G1): the pure routing function. The policy is DATA (ordered rules, each naming preferred models); route() picks an entry and says why.
 * It takes no adapter and calls nothing: the caller (a test, with a fake adapter) would hand the chosen entry to an adapter. No route calls it.
 * Fail closed: a malformed policy, or no eligible model, gives entry null with a reason, never a guess.
 */
export interface ModelEntry { model: string; family: string; version: string; capabilities: readonly string[]; status: 'active' | 'deprecated' | 'disabled' }
export interface RoutingRule { id: string; requires: readonly string[]; prefer: readonly string[] }
export interface RoutingPolicy { name: string; version: number; rules: readonly RoutingRule[] }
export interface RouteRequest { capabilities: readonly string[]; exclude?: readonly string[]; excludeFamilies?: readonly string[] }
export interface RouteResult { entry: ModelEntry | null; reason: string }

const strs = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === 'string' && x.length > 0);
export function policyProblem(p: RoutingPolicy): string | null {
  if (!p || !Array.isArray(p.rules) || p.rules.length === 0) return 'a policy needs at least one rule';
  const ids = new Set<string>();
  for (const r of p.rules) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id)) return 'every rule needs a unique id';
    ids.add(r.id);
    if (!strs(r.requires) || !strs(r.prefer) || r.prefer.length === 0) return `rule ${r.id}: requires and prefer must be lists of names, and prefer cannot be empty`;
  }
  return null;
}

export function route(policy: RoutingPolicy, request: RouteRequest, entries: readonly ModelEntry[]): RouteResult {
  if (policyProblem(policy)) return { entry: null, reason: 'invalid_policy' };
  const want = new Set(request.capabilities);
  const exclude = new Set(request.exclude ?? []);
  const excludeFamilies = new Set(request.excludeFamilies ?? []);
  for (const rule of policy.rules) {
    if (!rule.requires.every((c) => want.has(c))) continue;
    for (let i = 0; i < rule.prefer.length; i++) {
      const entry = entries.find((m) => m.model === rule.prefer[i]);
      if (!entry || entry.status !== 'active') continue;
      if (modelFamily(entry.model) !== entry.family) continue; // the entry's family must be the c38 vendor-table family (unknown names are never routable)
      if (exclude.has(entry.model) || excludeFamilies.has(entry.family)) continue;
      if (![...want].every((c) => entry.capabilities.includes(c))) continue;
      return { entry, reason: `rule:${rule.id}:${i === 0 ? 'preferred' : 'fallback'}` };
    }
  }
  return { entry: null, reason: 'no_eligible_model' };
}
