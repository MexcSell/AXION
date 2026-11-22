// Typed delegation brief (c42). Pure: schema, canonical JSON, sha256 and the subset rule. No I/O.
// Sources: Intelligent AI Delegation (arXiv 2602.11865, a conceptual framework with no experiments), Magentic-One (2411.04468),
// the MAST failure categories (2503.13657) and spec invariant 4 (no cross-mission access without an authorised bridge).
import { createHash } from 'node:crypto';
import { z } from 'zod';

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
/** A capability is covered when the parent holds the kind without an origin limit, or at the same origin. */
export const covers = (parent: readonly Capability[], c: Capability) => parent.some((p) => p.kind === c.kind && (p.origin === undefined || p.origin === c.origin));

/** The items of `child` that the parent's scope does not cover (empty = a legal subset). */
export function scopeViolations(parent: readonly Capability[], child: readonly Capability[]): string[] {
  const out: string[] = [];
  for (const c of child) { const l = label(c); if (!covers(parent, c) && !out.includes(l)) out.push(l); }
  return out;
}
