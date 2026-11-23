// Plan conformance and privilege check over scripted trajectories (c96, R6-8 part 1). PURE: no model, no I/O, no clock.
// Checks a scripted agent against its approved plan; it does not test a real model. Label propagation is next phase.
//
// D4's split (not a plan hash): a call that uses LESS authority than a plan call is auto-allowed and recorded (`narrow-allow`);
// MORE authority needs approval; untrusted content can never add calls (an untrusted call that is not in the plan is `deny`).
// Fail closed: anything malformed is `deny`. Each input is snapshotted once (no accessor re-reads). Matching is linear: string
// comparison, prefix, suffix, contains and numeric bounds. No regex is ever built from input.
import type { ArgConstraint, ConformanceReason, ConformanceResult, ExecPlan, PlanCall, ProposedCall, TrajectoryStep } from '../../../shared/contracts/src/exec-plan.ts';
import { EXEC_PLAN_LIMITS as L, EXEC_PROVENANCES } from '../../../shared/contracts/src/exec-plan.ts';
import { nameOk, originOk, toolNameOk, validatePlan } from './plan.ts';
import { trySnapshot } from './snapshot.ts';

const MAX_VALUE_STRING = 4096;
const deny = (...reasons: ConformanceReason[]): ConformanceResult => ({ decision: 'deny', reasons, planCallId: null });
type Scalar = string | number | boolean | null;
const isScalar = (v: unknown): v is Scalar => v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= MAX_VALUE_STRING);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Validate the shape of a proposed call (already a snapshot). */
function callShape(c: unknown): ProposedCall | null {
  if (!isObj(c)) return null;
  const keys = Object.keys(c);
  if (keys.length !== 4 || !['tool', 'args', 'origin', 'provenance'].every((k) => keys.includes(k))) return null;
  if (!toolNameOk(c.tool) || !EXEC_PROVENANCES.includes(c.provenance as never)) return null;
  if (c.origin !== null && !originOk(c.origin)) return null;
  if (!isObj(c.args) || Object.keys(c.args).length > L.maxArgs) return null;
  for (const [k, v] of Object.entries(c.args)) {
    if (!nameOk(k, 64, '.')) return null;
    if (Array.isArray(v)) { if (v.length > L.maxList || !v.every(isScalar)) return null; } else if (!isScalar(v)) return null;
  }
  return c as unknown as ProposedCall;
}
function historyShape(h: unknown): TrajectoryStep[] | null {
  if (!Array.isArray(h) || h.length > L.maxHistory) return null;
  for (const s of h) { if (!isObj(s) || Object.keys(s).length !== 1 || !('planCallId' in s) || !(s.planCallId === null || nameOk(s.planCallId, L.maxId))) return null; }
  return h as TrajectoryStep[];
}

/** Normalise a URL or absolute path before a prefix/contains test (`.`, `..`, `//` inside the path). Returns null (refuse, so the value is `wider`) for:
 *  percent-encoding, backslash, control characters; a leading `//`; a URL scheme other than https unless the plan's own text starts with that scheme;
 *  and a relative value that has a `.` or `..` segment. A relative value without dot segments is compared as plain text. */
function normalisePathish(v: string, planText: string): string | null {
  for (let i = 0; i < v.length; i++) { const k = v.charCodeAt(i); if (k < 32 || k === 127 || k === 92 || k === 37) return null; }
  if (v.startsWith('//')) return null;
  let scheme = '';
  const sep = v.indexOf('://');
  if (sep > 0) { const sc = v.slice(0, sep); let ok = true; for (let i = 0; i < sc.length; i++) { const k = sc.charCodeAt(i); if (!((k >= 97 && k <= 122) || (k >= 65 && k <= 90) || (i > 0 && ((k >= 48 && k <= 57) || k === 43 || k === 45 || k === 46)))) ok = false; } if (ok) scheme = sc; }
  if (scheme !== '' && scheme !== 'https' && !planText.startsWith(scheme + '://')) return null;
  let head = '', rest = v;
  if (scheme !== '') { const i = v.indexOf('/', scheme.length + 3); if (i === -1) return v; head = v.slice(0, i); rest = v.slice(i); }
  else if (!v.startsWith('/')) { for (const seg of v.split('/')) if (seg === '.' || seg === '..') return null; return v; }
  let tail = '';
  const q = rest.search(/[?#]/); // fixed class, applied to the value, never built from it
  if (q !== -1) { tail = rest.slice(q); rest = rest.slice(0, q); }
  const out: string[] = [];
  const parts = rest.split('/');
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (seg === '..') out.pop(); else if (seg !== '.' && seg !== '') out.push(seg);
    else if (i === parts.length - 1 && seg === '') out.push('');
  }
  return head + '/' + out.join('/') + tail;
}
type ArgVerdict = 'ok' | 'narrow' | 'wider' | 'missing';
const same = (a: unknown, b: unknown) => a === b; // strict: 1 and '1' differ, no coercion
function checkArg(c: ArgConstraint, present: boolean, v: unknown): ArgVerdict {
  if (!present) return c.omitNarrows ? 'narrow' : 'missing';
  switch (c.kind) {
    case 'exact': return !Array.isArray(v) && same(v, c.value) ? 'ok' : 'wider';
    case 'oneOf': return !Array.isArray(v) && c.values.some((x) => same(x, v)) ? 'ok' : 'wider';
    case 'text': {
      if (typeof v !== 'string') return 'wider';
      let w = v;
      if (c.op !== 'suffix' && c.value.includes('/')) { const n = normalisePathish(v, c.value); if (n === null) return 'wider'; w = n; }
      const ok = c.op === 'prefix' ? w.startsWith(c.value) : c.op === 'suffix' ? w.endsWith(c.value) : w.includes(c.value);
      return ok ? 'ok' : 'wider';
    }
    case 'range': {
      if (typeof v !== 'number' || (c.integer && !Number.isInteger(v))) return 'wider';
      return (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max) ? 'ok' : 'wider';
    }
    case 'subsetOf': {
      if (!Array.isArray(v) || v.length === 0) return 'wider'; // an empty list often means "no filter" (everything)
      const cap = c.maxItems ?? c.values.length;
      if (v.length > cap) return 'wider';
      for (let i = 0; i < v.length; i++) {
        if (!c.values.some((x) => same(x, v[i]))) return 'wider';
        for (let j = 0; j < i; j++) if (same(v[j], v[i])) return 'wider'; // duplicates: fail closed (quadratic in at most 32 items)
      }
      // With maxItems any list up to the cap is in plan. Without it, a strict subset of the allowed values is a narrowing.
      return c.maxItems === undefined && v.length < c.values.length ? 'narrow' : 'ok';
    }
  }
}

interface Candidate { call: PlanCall; narrowed: boolean; reasons: ConformanceReason[] }
function evaluate(pc: PlanCall, call: ProposedCall, ids: Map<string, number>): Candidate {
  const reasons: ConformanceReason[] = [];
  let narrowed = false;
  const add = (r: ConformanceReason) => { if (!reasons.includes(r)) reasons.push(r); };
  if (!(call.origin === null ? pc.origins.length === 0 : pc.origins.includes(call.origin))) add('new_origin');
  for (const k of Object.keys(call.args)) if (!Object.hasOwn(pc.args, k)) add('extra_arg');
  for (const [k, c] of Object.entries(pc.args)) {
    const present = Object.hasOwn(call.args, k);
    const v = checkArg(c, present, present ? call.args[k] : undefined);
    if (v === 'wider') add('wider_value'); else if (v === 'missing') add('missing_arg'); else if (v === 'narrow') narrowed = true;
  }
  for (const a of pc.after ?? []) if (!ids.has(a)) add('out_of_order');
  if ((ids.get(pc.id) ?? 0) >= (pc.max ?? 1)) add('exceeds_count');
  return { call: pc, narrowed, reasons };
}

/** Check one proposed call against a plan and the trajectory so far. Never throws. */
export function checkCall(planInput: unknown, callInput: unknown, historyInput: unknown = []): ConformanceResult {
  try { return checkInner(planInput, callInput, historyInput); } catch { return deny('malformed'); }
}
function checkInner(planInput: unknown, callInput: unknown, historyInput: unknown): ConformanceResult {
  const pv = validatePlan(planInput);
  if (!pv.ok) return deny('malformed');
  const plan: ExecPlan = pv.plan;
  const cs = trySnapshot(callInput), hs = trySnapshot(historyInput);
  if (!cs.ok || !hs.ok) return deny('malformed');
  const call = callShape(cs.value), history = historyShape(hs.value);
  if (!call || !history) return deny('malformed');

  const lower = call.tool.toLowerCase();
  if (plan.forbiddenTools.some((t) => t.toLowerCase() === lower)) return deny('forbidden_tool');
  if (call.origin !== null && !plan.grants.includes(call.origin)) return deny('origin_not_granted');

  const ids = new Map<string, number>();
  for (const s of history) if (s.planCallId !== null) ids.set(s.planCallId, (ids.get(s.planCallId) ?? 0) + 1);
  const cands = plan.calls.filter((c) => c.tool === call.tool).map((c) => evaluate(c, call, ids));
  const clean = cands.filter((c) => c.reasons.length === 0);
  const best = clean.find((c) => !c.narrowed) ?? clean[0];
  // An untrusted narrowing is denied until label propagation exists: untrusted content picks WHICH narrower call runs.
  if (best && best.narrowed && call.provenance === 'untrusted') return { decision: 'deny', reasons: ['untrusted_narrowing'], planCallId: null };
  if (best) return { decision: best.narrowed ? 'narrow-allow' : 'allow', reasons: [best.narrowed ? 'narrowed' : 'in_plan'], planCallId: best.call.id };

  const reasons: ConformanceReason[] = cands.length === 0 ? ['new_tool'] : [...cands.reduce((a, b) => (b.reasons.length < a.reasons.length ? b : a)).reasons];
  if (call.provenance === 'untrusted') return { decision: 'deny', reasons: [...reasons, 'untrusted_off_plan'], planCallId: null };
  return { decision: 'needs-approval', reasons, planCallId: null };
}

export interface TrajectoryOutcome { results: ConformanceResult[]; approvals: number; denied: number }
/** Replay a scripted trajectory. A needs-approval step is assumed approved as a one-off and does not count toward any plan call's uses; a denied step is not executed. */
export function checkTrajectory(plan: unknown, calls: readonly unknown[]): TrajectoryOutcome {
  const history: TrajectoryStep[] = [];
  const results: ConformanceResult[] = [];
  for (const c of calls) {
    const r = checkCall(plan, c, history);
    results.push(r);
    if (r.decision === 'allow' || r.decision === 'narrow-allow') history.push({ planCallId: r.planCallId });
    else if (r.decision === 'needs-approval') history.push({ planCallId: null });
  }
  return { results, approvals: results.filter((r) => r.decision === 'needs-approval').length, denied: results.filter((r) => r.decision === 'deny').length };
}
