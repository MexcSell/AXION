import { createHash } from 'node:crypto';

/**
 * c97 (R6-7, first slice): outcome-state graders. Pure TypeScript, no I/O, no clock, no model call, no route.
 *
 * WHAT THIS IS. A grader judges an END STATE held in memory (files, rows, page fields), never an agent's statement. Each toy task ships a
 * reference solution (must pass) and a null solution (must fail). A validity check flags graders that pass everything or nothing.
 *
 * WHAT THIS IS NOT. It tests the HARNESS on toy tasks. It says nothing about any agent, and no figure from it describes AXION's real tasks:
 * real tasks need agents to execute. Numbers produced here are fixture-only.
 */

export type Scalar = string | number | boolean | null;
export interface OutcomeState {
  /** path -> file content (compared by sha256) */
  files: Record<string, string>;
  /** table -> row id -> field -> value */
  rows: Record<string, Record<string, Record<string, Scalar>>>;
  /** page-state fixture: key -> value */
  page: Record<string, Scalar>;
}

export interface GradeResult { pass: boolean; reasons: string[] }
export interface ToyTask {
  id: string;
  description: string;
  initial: OutcomeState;
  /** deterministic; reads only the end state (and the initial state for comparison) */
  grade(final: OutcomeState, initial: OutcomeState): GradeResult;
  /** pure: returns a new end state, never mutates `initial` */
  reference(initial: OutcomeState): OutcomeState;
  nul(initial: OutcomeState): OutcomeState;
}
export type GradeFn = (final: OutcomeState, initial: OutcomeState) => GradeResult;

export function sha256(s: string): string { return createHash('sha256').update(s, 'utf8').digest('hex'); }

export function emptyState(): OutcomeState { return { files: {}, rows: {}, page: {} }; }
export function cloneState(s: OutcomeState): OutcomeState { return JSON.parse(JSON.stringify(s)) as OutcomeState; }

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** lexical path normalisation: collapse //, ., and .. (case kept); the result always starts with / */
export function normPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) { if (seg === '' || seg === '.') continue; if (seg === '..') { out.pop(); continue; } out.push(seg); }
  return '/' + out.join('/');
}
/** the ignored area: graders never look under /scratch/ (agents may leave logs there). Paths are normalised first, so /scratch/../work/x is NOT scratch. */
export function isScratch(path: string): boolean { return normPath(path).startsWith('/scratch/'); }

const isScalar = (v: unknown): v is Scalar => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/**
 * Snapshot (one JSON round trip), shape check and canonicalisation of file path keys. Returns null for any bad shape: a non-object, wrong types,
 * a relative file path, a __proto__ key, or two file keys that normalise to the same path. Never throws.
 */
export function validateState(input: unknown): OutcomeState | null {
  try {
    const snap: unknown = JSON.parse(JSON.stringify(input));
    if (!isPlain(snap) || !isPlain(snap.files) || !isPlain(snap.rows) || !isPlain(snap.page)) return null;
    const files: Record<string, string> = {};
    for (const k of Object.keys(snap.files)) {
      const v = snap.files[k];
      if (typeof v !== 'string' || !k.startsWith('/') || k === '__proto__') return null;
      const nk = normPath(k);
      if (Object.prototype.hasOwnProperty.call(files, nk)) return null;
      files[nk] = v;
    }
    const rows: OutcomeState['rows'] = {};
    for (const t of Object.keys(snap.rows)) {
      const table = snap.rows[t];
      if (t === '__proto__' || !isPlain(table)) return null;
      const rt: Record<string, Record<string, Scalar>> = {};
      for (const id of Object.keys(table)) {
        const row = table[id];
        if (id === '__proto__' || !isPlain(row)) return null;
        const rr: Record<string, Scalar> = {};
        for (const f of Object.keys(row)) { if (f === '__proto__' || !isScalar(row[f])) return null; rr[f] = row[f] as Scalar; }
        rt[id] = rr;
      }
      rows[t] = rt;
    }
    const page: Record<string, Scalar> = {};
    for (const k of Object.keys(snap.page)) { if (k === '__proto__' || !isScalar(snap.page[k])) return null; page[k] = snap.page[k] as Scalar; }
    return { files, rows, page };
  } catch { return null; }
}
/** wraps a task grader: a bad final or initial shape fails (never throws); file keys are canonical before the grader sees them */
export function guardedGrade(raw: GradeFn): GradeFn {
  return (final, initial) => {
    const f = validateState(final);
    const i = validateState(initial);
    if (f === null) return { pass: false, reasons: ['bad_state_shape'] };
    if (i === null) return { pass: false, reasons: ['bad_initial_shape'] };
    try { return raw(f, i); } catch { return { pass: false, reasons: ['grader_error'] }; }
  };
}

// ---- state paths (for diff, partial solutions and isolation) ----
export type StatePath =
  | { t: 'file'; path: string }
  | { t: 'table'; table: string }
  | { t: 'row'; table: string; id: string }
  | { t: 'field'; table: string; id: string; field: string }
  | { t: 'page'; key: string };

export function describePath(p: StatePath): string {
  switch (p.t) {
    case 'file': return `file ${p.path}`;
    case 'table': return `table ${p.table}`;
    case 'row': return `row ${p.table}/${p.id}`;
    case 'field': return `field ${p.table}/${p.id}.${p.field}`;
    case 'page': return `page ${p.key}`;
  }
}

/** every place where two states differ (rows that exist in only one state count once; fields only inside rows present in both) */
export function diffStates(a: OutcomeState, b: OutcomeState): StatePath[] {
  const out: StatePath[] = [];
  for (const path of new Set([...Object.keys(a.files), ...Object.keys(b.files)])) {
    if (own(a.files, path) !== own(b.files, path) || a.files[path] !== b.files[path]) out.push({ t: 'file', path });
  }
  for (const table of new Set([...Object.keys(a.rows), ...Object.keys(b.rows)])) {
    if (own(a.rows, table) !== own(b.rows, table)) { out.push({ t: 'table', table }); continue; } // an empty leftover table still counts
    const ra = own(a.rows, table) ? a.rows[table] : {};
    const rb = own(b.rows, table) ? b.rows[table] : {};
    for (const id of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (own(ra, id) !== own(rb, id)) { out.push({ t: 'row', table, id }); continue; }
      for (const field of new Set([...Object.keys(ra[id]), ...Object.keys(rb[id])])) {
        if (own(ra[id], field) !== own(rb[id], field) || ra[id][field] !== rb[id][field]) out.push({ t: 'field', table, id, field });
      }
    }
  }
  for (const key of new Set([...Object.keys(a.page), ...Object.keys(b.page)])) {
    if (own(a.page, key) !== own(b.page, key) || a.page[key] !== b.page[key]) out.push({ t: 'page', key });
  }
  return out;
}

/** copy of `s` with one path put back to its value in `from` (or removed if `from` lacks it) */
export function revertPath(s: OutcomeState, from: OutcomeState, p: StatePath): OutcomeState {
  const r = cloneState(s);
  switch (p.t) {
    case 'file':
      if (own(from.files, p.path)) r.files[p.path] = from.files[p.path]; else delete r.files[p.path];
      break;
    case 'table':
      if (own(from.rows, p.table)) r.rows[p.table] = JSON.parse(JSON.stringify(from.rows[p.table])); else delete r.rows[p.table];
      break;
    case 'row':
      if (own(from.rows, p.table) && own(from.rows[p.table], p.id)) { (r.rows[p.table] ??= {})[p.id] = JSON.parse(JSON.stringify(from.rows[p.table][p.id])); }
      else if (own(r.rows, p.table)) delete r.rows[p.table][p.id];
      break;
    case 'field':
      if (own(from.rows[p.table][p.id], p.field)) r.rows[p.table][p.id][p.field] = from.rows[p.table][p.id][p.field]; else delete r.rows[p.table][p.id][p.field];
      break;
    case 'page':
      if (own(from.page, p.key)) r.page[p.key] = from.page[p.key]; else delete r.page[p.key];
      break;
  }
  return r;
}

// ---- grading helpers used by the toy tasks ----
export function fileIs(s: OutcomeState, path: string, content: string): boolean {
  return own(s.files, path) && sha256(s.files[path]) === sha256(content);
}
export function mark(reasons: string[], ok: boolean, why: string): boolean { if (!ok) reasons.push(why); return ok; }
export function result(reasons: string[]): GradeResult { return { pass: reasons.length === 0, reasons }; }
/** every non-scratch path outside `allowed` must equal the initial state, so a solution may not damage unrelated state */
export function untouchedOutside(final: OutcomeState, initial: OutcomeState, allowed: (p: StatePath) => boolean): string[] {
  return diffStates(final, initial).filter((p) => !(p.t === 'file' && isScratch(p.path)) && !allowed(p)).map((p) => `unexpected change: ${describePath(p)}`);
}

// ---- validity ----
export interface Variant { name: string; expect: 'pass' | 'fail'; state: OutcomeState }
export const MIN_VALIDITY_TRIALS = 10;

/** varied solutions: the reference, harmless noise copies (must pass), the null, and each reference change reverted alone (partial, must fail) */
export function buildVariants(task: ToyTask, minCount: number = 12): Variant[] {
  try { return buildVariantsUnsafe(task, minCount); } catch { return []; } // a bad task yields no variants; gradeValidity then flags it
}
function buildVariantsUnsafe(task: ToyTask, minCount: number): Variant[] {
  if (validateState(task.initial) === null) throw new Error('bad initial');
  const ref = task.reference(cloneState(task.initial));
  const out: Variant[] = [{ name: 'reference', expect: 'pass', state: ref }, { name: 'null', expect: 'fail', state: task.nul(cloneState(task.initial)) }];
  for (const p of diffStates(ref, task.initial)) {
    if (p.t === 'file' && isScratch(p.path)) continue;
    out.push({ name: `partial: ${describePath(p)} reverted`, expect: 'fail', state: revertPath(ref, task.initial, p) });
  }
  const dmg = cloneState(ref); dmg.files['/work/unrelated-damage.txt'] = 'x';
  out.push({ name: 'reference plus unrelated file damage', expect: 'fail', state: dmg });
  const extraRow = cloneState(ref); (extraRow.rows.zz_extra ??= {}).x1 = { v: 1 };
  out.push({ name: 'reference plus extra row', expect: 'fail', state: extraRow });
  const extraPage = cloneState(ref); extraPage.page['zz.extra'] = true;
  out.push({ name: 'reference plus extra page key', expect: 'fail', state: extraPage });
  for (let i = 1; out.length < minCount; i++) {
    const s = cloneState(ref);
    s.files[`/scratch/noise-${i}.log`] = `noise ${i}`;
    out.push({ name: `reference plus scratch noise ${i}`, expect: 'pass', state: s });
  }
  return out;
}

export type ValidityFlag = 'malformed_input' | 'malformed_variant' | 'verdict_mismatch' | 'grader_threw' | 'too_few_trials' | 'fails_reference' | 'passes_null' | 'never_passes' | 'always_passes';
export interface ValidityReport { n: number; passes: number; passRate: number; flags: ValidityFlag[]; flagged: boolean; mismatches: string[] }

export function gradeValidity(task: Pick<ToyTask, 'initial'>, grade: GradeFn, variants: Variant[]): ValidityReport {
  const flags: ValidityFlag[] = [];
  const mismatches: string[] = [];
  const flag = (f: ValidityFlag) => { if (!flags.includes(f)) flags.push(f); };
  // fail closed: anything that is not the expected shape is a flag, never a throw
  if (task === null || typeof task !== 'object' || validateState(task.initial) === null || !Array.isArray(variants) || typeof grade !== 'function') {
    return { n: 0, passes: 0, passRate: 0, flags: ['malformed_input'], flagged: true, mismatches };
  }
  let passes = 0;
  for (const v of variants) {
    if (v === null || typeof v !== 'object' || typeof v.name !== 'string' || (v.expect !== 'pass' && v.expect !== 'fail') || validateState(v.state) === null) { flag('malformed_variant'); mismatches.push('malformed variant'); continue; }
    let pass = false;
    try { pass = grade(cloneState(v.state), cloneState(task.initial)).pass === true; } catch { flag('grader_threw'); }
    if (pass) passes++;
    if (v.name === 'reference' && !pass) flag('fails_reference');
    if (v.name === 'null' && pass) flag('passes_null');
    // every variant has an expected verdict: a grader that is too lenient (passes a partial or a damaged state) or too strict is caught here
    if (pass !== (v.expect === 'pass')) mismatches.push(v.name);
  }
  if (mismatches.length > 0) flag('verdict_mismatch');
  const n = variants.length;
  if (n < MIN_VALIDITY_TRIALS) flag('too_few_trials');
  else if (passes === 0) flag('never_passes');
  else if (passes === n) flag('always_passes');
  return { n, passes, passRate: n === 0 ? 0 : passes / n, flags, flagged: flags.length > 0, mismatches };
}

// ---- mutant graders (for testing the validity check): each one is a lenient or broken copy of a real grader ----
/** a grader that does not look at one path: that path is overwritten with the reference's value before grading */
export function mutantIgnoringPath(task: ToyTask, p: StatePath): GradeFn {
  const ref = task.reference(cloneState(task.initial));
  return (f, i) => { const v = validateState(f); return v === null ? { pass: false, reasons: ['bad_state_shape'] } : task.grade(revertPath(v, ref, p), i); };
}
/** a grader with no side-effect check: every deviation from the initial state outside the reference's own changes is put back first */
export function mutantDroppingSideEffects(task: ToyTask): GradeFn {
  const ref = task.reference(cloneState(task.initial));
  const keep = new Set(diffStates(ref, task.initial).map(describePath));
  return (f, i) => {
    let v = validateState(f);
    if (v === null) return { pass: false, reasons: ['bad_state_shape'] };
    for (const p of diffStates(v, task.initial)) if (!keep.has(describePath(p))) v = revertPath(v, task.initial, p);
    return task.grade(v, i);
  };
}
/** a grader that accepts extra rows and tables: any row or table absent from both the initial and the reference state is dropped first */
export function mutantAcceptingExtraRows(task: ToyTask): GradeFn {
  const ref = task.reference(cloneState(task.initial));
  return (f, i) => {
    const v = validateState(f);
    if (v === null) return { pass: false, reasons: ['bad_state_shape'] };
    for (const table of Object.keys(v.rows)) {
      if (!own(task.initial.rows, table) && !own(ref.rows, table)) { delete v.rows[table]; continue; }
      for (const id of Object.keys(v.rows[table])) {
        const inInit = own(task.initial.rows, table) && own(task.initial.rows[table], id);
        const inRef = own(ref.rows, table) && own(ref.rows[table], id);
        if (!inInit && !inRef) delete v.rows[table][id];
      }
    }
    return task.grade(v, i);
  };
}
/** an inverted grader: passes exactly what the real one fails (fails the reference, passes the null) */
export function mutantInverted(task: ToyTask): GradeFn { return (f, i) => { const r = task.grade(f, i); return { pass: !r.pass, reasons: r.reasons }; }; }

/** threshold (a) check for one task */
export function checkReferenceAndNull(task: ToyTask): { referencePasses: boolean; nullFails: boolean; deterministic: boolean } {
  const ref = task.reference(cloneState(task.initial));
  const nul = task.nul(cloneState(task.initial));
  const a = task.grade(cloneState(ref), cloneState(task.initial));
  const b = task.grade(cloneState(ref), cloneState(task.initial));
  return { referencePasses: a.pass, nullFails: !task.grade(cloneState(nul), cloneState(task.initial)).pass, deterministic: JSON.stringify(a) === JSON.stringify(b) };
}

// ---- trial isolation ----
export interface IsolationReport { clean: boolean; leaks: string[] }
/** before each trial the workspace must equal the task's initial state; anything a prior trial left behind shows up as a difference */
export function checkTrialStart(task: Pick<ToyTask, 'initial'>, start: OutcomeState): IsolationReport {
  const st = validateState(start);
  const init = validateState(task.initial);
  if (st === null || init === null) return { clean: false, leaks: ['malformed_state'] }; // a state we cannot read is never clean evidence
  const leaks = diffStates(st, init).map(describePath);
  return { clean: leaks.length === 0, leaks };
}

// ---- statistics ----
const Z95 = 1.959963984540054;
export function wilson(successes: number, n: number, z: number = Z95): { p: number; lo: number; hi: number; n: number } {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || n < 0 || successes < 0 || successes > n) throw new Error('bad counts');
  if (n === 0) return { p: 0, lo: 0, hi: 1, n };
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n };
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
/** unbiased pass@k from n trials with c passes: 1 - C(n-c, k) / C(n, k) */
export function passAtK(n: number, c: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k) || k < 1 || k > n || c < 0 || c > n) throw new Error('bad counts');
  return 1 - choose(n - c, k) / choose(n, k);
}
/** unbiased pass^k (all k drawn trials pass): C(c, k) / C(n, k) */
export function passPowK(n: number, c: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k) || k < 1 || k > n || c < 0 || c > n) throw new Error('bad counts');
  return choose(c, k) / choose(n, k);
}

/** small seeded PRNG for fixtures (mulberry32) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
