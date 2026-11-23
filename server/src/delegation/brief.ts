// Typed delegation brief (c42). Pure: schema, canonical JSON, sha256 and the subset rule. No I/O.
// Sources: Intelligent AI Delegation (arXiv 2602.11865, a conceptual framework with no experiments), Magentic-One (2411.04468),
// the MAST failure categories (2503.13657) and spec invariant 4 (no cross-mission access without an authorised bridge).
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TASK_CLASS_IDS } from '../../../shared/contracts/src/skills.ts';

/** Frozen policy: how long a delegation chain may be (root human brief = depth 1). Code only, like the baseline policy. */
export const MAX_CHAIN_DEPTH = 3;
Object.freeze(MAX_CHAIN_DEPTH);

export interface Capability { kind: string; origin?: string }

const normOrigin = (s: string) => new URL(s).origin;
const Origin = z.string().trim().min(1).max(200).refine((s) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } }, 'must be an http(s) origin').transform(normOrigin);
const CapabilityIn = z.object({ kind: z.string().trim().min(1).max(60), origin: Origin.optional() }).strict();

/** The brief a delegator hands over. Strict and bounded; `acceptance` needs at least one testable criterion. */
export const DelegationBriefIn = z.object({
  goal: z.string().trim().min(3).max(500),
  inputs: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  acceptance: z.array(z.string().trim().min(3).max(300)).min(1, 'at least one acceptance criterion').max(20),
  capabilities: z.array(CapabilityIn).max(30),
  budget: z.number().int().min(1).max(1_000_000).optional(),
  deadline: z.string().datetime({ offset: true }).transform((s) => new Date(s).toISOString()).optional(),
  escalation: z.string().trim().min(3).max(300),
  /** c72: the kind of task (fixed list) and how hard the delegator says it is (1 to 5). Both optional; both set by the delegator, so both are gameable (c66 inventory). */
  taskClass: z.enum(TASK_CLASS_IDS).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
}).strict().transform((b) => {
  // canonical form: duplicates removed, capabilities in a fixed order
  const seen = new Set<string>();
  const capabilities = b.capabilities.filter((c) => { const k = `${c.kind}|${c.origin ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, c) => (a.kind + '|' + (a.origin ?? '')).localeCompare(c.kind + '|' + (c.origin ?? '')));
  return { ...b, capabilities };
});
export type DelegationBriefData = z.output<typeof DelegationBriefIn>;

/** JSON with object keys sorted at every level, so key order never changes the hash. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
export const briefSha = (b: unknown): string => createHash('sha256').update(canonicalJson(b)).digest('hex');

const label = (c: Capability) => (c.origin ? `${c.kind} @ ${c.origin}` : c.kind);
/**
 * A capability is covered only by the same kind at the same origin. A kind without an origin is not a wildcard for every origin
 * (c42 fix round, M2): standing access to a site is its own, explicit capability, and a person needs the origin-grant gate to give it.
 */
export const covers = (parent: readonly Capability[], c: Capability) => parent.some((p) => p.kind === c.kind && p.origin === c.origin);

/** The items of `child` that the parent's scope does not cover (empty = a legal subset). */
export function scopeViolations(parent: readonly Capability[], child: readonly Capability[]): string[] {
  const out: string[] = [];
  for (const c of child) { const l = label(c); if (!covers(parent, c) && !out.includes(l)) out.push(l); }
  return out;
}

export const intersectCaps = (a: readonly Capability[], b: readonly Capability[]): Capability[] => a.filter((c) => covers(b, c));

/** The minimal row the chain walk needs (a delegation_briefs row). `seq` orders briefs of one agent: the newest is its scope. */
export interface ChainRow { id: string; seq: number | string; to_instance: string; to_agent: string; parent_brief_id: string | null; brief: DelegationBriefData }
export interface EffectiveScope {
  capabilities: Capability[]; deadline?: string; budget?: number;
  /** ancestors whose latest brief removed something from this brief's own capabilities */
  narrowedBy: { briefId: string; toAgentId: string; dropped: string[] }[];
  chain: string[];
}
const latestByInstance = (rows: readonly ChainRow[]) => {
  const m = new Map<string, ChainRow>();
  for (const r of rows) { const o = m.get(r.to_instance); if (!o || Number(r.seq) > Number(o.seq)) m.set(r.to_instance, r); }
  return m;
};
/** The newest brief addressed to an instance (its current scope), or undefined. */
export const latestOf = (rows: readonly ChainRow[], toInstance: string) => latestByInstance(rows).get(toInstance);

/**
 * The effective scope of `start`: its own capabilities intersected with the LATEST brief of every ancestor up to the current root
 * (c42 fix round, I1). Deadline and budget are the minimum along the chain (I3). Recomputed at every use, never stored, so narrowing
 * an ancestor narrows every descendant at once without rewriting a row. Ancestors are resolved through `parent_brief_id` to the agent
 * that held that brief, then to that agent's newest brief.
 */
export function effectiveFrom(rows: readonly ChainRow[], start: ChainRow): EffectiveScope {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const latest = latestByInstance(rows);
  let caps = start.brief.capabilities;
  let deadline = start.brief.deadline, budget = start.brief.budget;
  const narrowedBy: EffectiveScope['narrowedBy'] = [];
  const chain = [start.id];
  const seen = new Set([start.id]);
  for (let p = start.parent_brief_id ? byId.get(start.parent_brief_id) : undefined; p && chain.length <= MAX_CHAIN_DEPTH + 1; ) {
    const cur = latest.get(p.to_instance) ?? p;
    if (seen.has(cur.id)) break;
    seen.add(cur.id); chain.push(cur.id);
    const next = intersectCaps(caps, cur.brief.capabilities);
    const dropped = scopeViolations(cur.brief.capabilities, caps);
    if (dropped.length) narrowedBy.push({ briefId: cur.id, toAgentId: cur.to_agent, dropped });
    caps = next;
    if (cur.brief.deadline && (!deadline || cur.brief.deadline < deadline)) deadline = cur.brief.deadline; // normalised UTC ISO strings sort as times
    if (cur.brief.budget !== undefined && (budget === undefined || cur.brief.budget < budget)) budget = cur.brief.budget;
    p = cur.parent_brief_id ? byId.get(cur.parent_brief_id) : undefined;
  }
  return { capabilities: caps, ...(deadline ? { deadline } : {}), ...(budget !== undefined ? { budget } : {}), narrowedBy, chain };
}
