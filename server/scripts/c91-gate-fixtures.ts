// c91 (R5-5): run the skill gate on SYNTHETIC candidates. This tests the gate, not any skill. Pure arithmetic: no database, no model call.
// Usage: npx tsx scripts/c91-gate-fixtures.ts <seed>
//
// FIXTURE DESIGN (fixed and committed BEFORE the first run; the gate's constants were committed before this file).
//   4 classes, 40 items per class per set, incumbent mean 0.60 in every class. Candidate scores are incumbent + a true effect + paired noise:
//   the class mean difference gets Normal(0, SD_ITEM/sqrt(n)) noise, SD_ITEM = 0.15 (items are paired: the same tasks, both arms).
//   50 candidates per kind, 6 kinds = 300 candidates per seed. True effects (score points) by kind, [probe A, probe B, replay], per class:
//     true_gain      : +0.10, +0.10, +0.08 on every class
//     no_gain        :  0,     0,     0     (noise only)
//     harmful_class  : +0.08, +0.08 on A and B in 3 classes; in ONE class (random per candidate) -0.12 on replay (and 0 on A and B in that class);
//                      replay +0.08 in the other 3
//     overfit_to_a   : +0.10 on A, 0 on B, 0 on replay
//     leaky          : as true_gain, but 1 to 3 evidence task ids are also in A, B or replay (random)
//     too_small      : as true_gain, but one random set has one random class with 10 items (candidate and incumbent) instead of 40
//   Stated thresholds: true_gain admit 100%; harmful_class and leaky refuse 100%; overfit_to_a refused (not admitted) >= 90%;
//   no_gain false-admit rate <= 2% (bound is stated, not derived; chosen as 2x the rate the margins imply: see report). too_small must not be admitted (100%).
//   Seeds: 20261123 and 91.
import { MARGIN_PROBE_A, MARGIN_PROBE_B, REGRESSION_BUDGET, MIN_ITEMS_PER_CLASS, MAX_ATTEMPTS_PER_PROBE_A, skillGate, type GateInput, type ScoreSet, type ClassScores } from '../src/evolution/skill-gate.ts';

function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seed = Number(process.argv[2]);
if (!Number.isInteger(seed)) throw new Error('usage: c91-gate-fixtures.ts <seed>');
const rng = mulberry32(seed);
const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const CLASSES = ['build', 'fix', 'review', 'research'];
const N = 40, SD_ITEM = 0.15, INC = 0.6, PER_KIND = 50;
const KINDS = ['true_gain', 'no_gain', 'harmful_class', 'overfit_to_a', 'leaky', 'too_small'] as const;
type Kind = typeof KINDS[number];
const clamp = (x: number) => Math.min(1, Math.max(0, x));

function makeSet(prefix: string, effect: Record<string, number>, nOf: (c: string) => number = () => N): ScoreSet {
  const candidate: ClassScores = {}, incumbent: ClassScores = {};
  for (const c of CLASSES) {
    const n = nOf(c);
    incumbent[c] = { n, mean: INC };
    candidate[c] = { n, mean: clamp(INC + effect[c] + (normal() * SD_ITEM) / Math.sqrt(n)) };
  }
  return { taskIds: Array.from({ length: 3 * N }, (_, i) => `${prefix}-${i}`), candidate, incumbent };
}
const flat = (x: number) => Object.fromEntries(CLASSES.map((c) => [c, x]));

function build(kind: Kind, k: number): GateInput {
  const id = `${kind}-${k}`;
  const tag = `${seed}-${id}`;
  let eA = flat(0.1), eB = flat(0.1), eR = flat(0.08);
  if (kind === 'no_gain') { eA = flat(0); eB = flat(0); eR = flat(0); }
  if (kind === 'overfit_to_a') { eB = flat(0); eR = flat(0); }
  if (kind === 'harmful_class') {
    const bad = CLASSES[Math.floor(rng() * CLASSES.length)];
    eA = flat(0.08); eB = flat(0.08); eR = flat(0.08);
    eA[bad] = 0; eB[bad] = 0; eR[bad] = -0.12;
  }
  let sizes: Record<string, (c: string) => number> = {};
  if (kind === 'too_small') {
    const set = ['A', 'B', 'R'][Math.floor(rng() * 3)], cls = CLASSES[Math.floor(rng() * CLASSES.length)];
    sizes = { [set]: (c) => (c === cls ? 10 : N) };
  }
  const probeA = makeSet(`${tag}-A`, eA, sizes.A), probeB = makeSet(`${tag}-B`, eB, sizes.B), replay = makeSet(`${tag}-R`, eR, sizes.R);
  const evidenceTaskIds = Array.from({ length: 5 }, (_, i) => `${tag}-ev-${i}`);
  if (kind === 'leaky') {
    const pools = [probeA, probeB, replay];
    const m = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < m; i++) { const p = pools[Math.floor(rng() * 3)]; evidenceTaskIds[i] = p.taskIds[Math.floor(rng() * p.taskIds.length)]; }
  }
  return { candidate: { id, evidenceTaskIds, contract: 'Synthetic contract: when the task class matches, apply the procedure; observable: the review passes.' }, probeA, probeB, replay, probeAAttempts: (k % MAX_ATTEMPTS_PER_PROBE_A) + 1 };
}

console.log(`c91 skill-gate fixture run: seed ${seed}. SYNTHETIC candidates and scores; this tests the gate, not any skill.`);
console.log(`constants: margin A ${MARGIN_PROBE_A}, margin B ${MARGIN_PROBE_B}, regression budget ${REGRESSION_BUDGET}, min items per class ${MIN_ITEMS_PER_CLASS}, attempt cap ${MAX_ATTEMPTS_PER_PROBE_A}`);
console.log(`design: ${CLASSES.length} classes, ${N} items per class per set, incumbent ${INC}, item sd ${SD_ITEM}, ${PER_KIND} candidates per kind, ${PER_KIND * KINDS.length} per seed`);
const tally: Record<Kind, { admit: number; refuse: number; nee: number; reasons: Record<string, number> }> = {} as never;
for (const kind of KINDS) tally[kind] = { admit: 0, refuse: 0, nee: 0, reasons: {} };
const gains: Record<string, number[]> = {};
for (const kind of KINDS) for (let k = 0; k < PER_KIND; k++) {
  const d = skillGate(build(kind, k));
  const t = tally[kind];
  if (d.verdict === 'admit') t.admit++; else if (d.verdict === 'refuse') t.refuse++; else t.nee++;
  for (const r of d.reasons) t.reasons[r.code] = (t.reasons[r.code] ?? 0) + 1;
  if (d.metrics.gainA !== null) (gains[`${kind}.A`] ??= []).push(d.metrics.gainA);
  if (d.metrics.gainB !== null) (gains[`${kind}.B`] ??= []).push(d.metrics.gainB);
}
const pct = (x: number) => `${((100 * x) / PER_KIND).toFixed(1)}%`;
console.log('\nkind | n | admit | refuse | not enough evidence | reason counts (a candidate can have several)');
for (const kind of KINDS) {
  const t = tally[kind];
  console.log(`${kind} | ${PER_KIND} | ${t.admit} (${pct(t.admit)}) | ${t.refuse} (${pct(t.refuse)}) | ${t.nee} (${pct(t.nee)}) | ${Object.entries(t.reasons).sort().map(([k, v]) => `${k}=${v}`).join(', ')}`);
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('\nmean net gain seen by the gate (where computed): ' + Object.entries(gains).map(([k, v]) => `${k} ${mean(v).toFixed(3)}`).join(', '));
const THRESH = { overfitRefused: 0.9, noGainFalseAdmit: 0.02 };
const checks: Array<[string, boolean, string]> = [
  ['true_gain admitted 100%', tally.true_gain.admit === PER_KIND, `${tally.true_gain.admit}/${PER_KIND}`],
  ['harmful_class refused 100% (not admitted)', tally.harmful_class.admit === 0, `${tally.harmful_class.admit} admitted`],
  ['leaky refused 100%', tally.leaky.refuse === PER_KIND, `${tally.leaky.refuse}/${PER_KIND} refused`],
  [`overfit_to_a not admitted >= ${THRESH.overfitRefused * 100}%`, 1 - tally.overfit_to_a.admit / PER_KIND >= THRESH.overfitRefused, `${tally.overfit_to_a.admit} admitted; ${tally.overfit_to_a.reasons['probe_b_gain_too_small'] ?? 0} had B gain below margin`],
  [`no_gain false-admit <= ${THRESH.noGainFalseAdmit * 100}%`, tally.no_gain.admit / PER_KIND <= THRESH.noGainFalseAdmit, `${tally.no_gain.admit}/${PER_KIND}`],
  ['too_small never admitted', tally.too_small.admit === 0, `${tally.too_small.admit} admitted; ${tally.too_small.nee} not enough evidence`],
];
console.log('\nthreshold | met | observed');
for (const [n, ok, obs] of checks) console.log(`${n} | ${ok ? 'MET' : 'NOT MET'} | ${obs}`);
