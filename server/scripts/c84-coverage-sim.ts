// c84 (E1e): coverage simulation of three ways to bound a judge-corrected pass rate, on the c61 72-cell grid.
//   gate    = c61 as shipped: the margin gate on ALL labels, then the interval from the same labels (the thing being repaired)
//   split   = remedy 1: eligibility on a pilot half, interval from the other half only (rule: header of splitCalibration)
//   fieller = remedy 3: Fieller-type interval, no margin gate, unbounded when the margin's confidence set includes 0
// Usage: npx tsx scripts/c84-coverage-sim.ts <seed>     (pure arithmetic, no database, no model call; one seed per run)
// The draws are the same as the c61 test's (same generator, same per-cell seed, same order), and all three methods see the SAME draw.
import os from 'node:os';
import { correctedPassRateGate, splitCalibration, splitInterval, fiellerInterval, MIN_CALIBRATION_PER_CLASS } from '../src/evolution/judge-calibration.ts';

function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seed = Number(process.argv[2]);
if (!Number.isInteger(seed)) throw new Error('usage: c84-coverage-sim.ts <seed>');
const thetas = [0.05, 0.5, 0.95];
const judges: Array<[number, number]> = [[0.6, 0.6], [0.7, 0.65], [0.55, 0.9], [0.9, 0.9]]; // [specificity q0, sensitivity q1]
const sizes: Array<[number, number, number]> = [[30, 10, 10], [100, 10, 60], [100, 60, 10], [200, 50, 50], [100, 20, 20], [100, 20, 60]];
const bern = (rng: () => number, p: number) => (rng() < p ? 1 : 0);
const T = 1000, MIN_OK = 30, TARGET = 0.93;
const METHODS = ['gate', 'split', 'fieller'] as const;
type M = typeof METHODS[number];
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

const t0 = Date.now();
console.log(`c84 coverage simulation: seed ${seed}, ${T} simulated datasets per cell, 72 cells (3 thetas x 4 judges x 6 sizes), nominal 95%, target ${TARGET * 100}%, a cell with fewer than ${MIN_OK} admitted draws is a refused regime; a cell with under ${MIN_CALIBRATION_PER_CLASS} labels in a class is refused by size for every method`);
const failing: Record<M, string[]> = { gate: [], split: [], fieller: [] };
const pooled: Record<M, { ok: number; cov: number; assessed: number; draws: number }> = { gate: { ok: 0, cov: 0, assessed: 0, draws: 0 }, split: { ok: 0, cov: 0, assessed: 0, draws: 0 }, fieller: { ok: 0, cov: 0, assessed: 0, draws: 0 } };
let ci = 0;
console.log('cell (theta/spec/sens/n/m0+m1) | method | admitted/1000 | coverage (SE) | median width | verdict');
for (const theta of thetas) for (const [q0, q1] of judges) for (const [n, m0, m1] of sizes) {
  const rng = mulberry32(seed + 7919 * ++ci);
  const acc: Record<M, { ok: number; cov: number; w: number[] }> = { gate: { ok: 0, cov: 0, w: [] }, split: { ok: 0, cov: 0, w: [] }, fieller: { ok: 0, cov: 0, w: [] } };
  for (let t = 0; t < T; t++) {
    let judgedPass = 0;
    for (let i = 0; i < n; i++) judgedPass += bern(rng, bern(rng, theta) ? q1 : 1 - q0);
    let tp = 0, fp = 0;
    for (let i = 0; i < m1; i++) tp += bern(rng, q1);
    for (let i = 0; i < m0; i++) fp += bern(rng, 1 - q0);
    const cal = { tp, fn: m1 - tp, tn: m0 - fp, fp };
    if (m0 < MIN_CALIBRATION_PER_CLASS || m1 < MIN_CALIBRATION_PER_CLASS) continue;
    const res: Record<M, { low: number; high: number } | null> = { gate: null, split: null, fieller: null };
    const g = correctedPassRateGate({ judgedPass, n, calibration: cal });
    if (g.status === 'ok') res.gate = { low: g.corrected.low!, high: g.corrected.high! };
    const sp = splitCalibration(cal), s = splitInterval({ judgedPass, n, pilot: sp.pilot, holdout: sp.holdout });
    if (s.status === 'ok') res.split = { low: s.corrected.low!, high: s.corrected.high! };
    const f = fiellerInterval({ judgedPass, n, calibration: cal });
    if (f.status === 'ok') res.fieller = { low: f.corrected.low!, high: f.corrected.high! };
    for (const m of METHODS) { const r = res[m]; if (!r) continue; acc[m].ok++; if (r.low <= theta && theta <= r.high) acc[m].cov++; acc[m].w.push(r.high - r.low); }
  }
  const name = `${theta}/${q0}/${q1}/${n}/${m0}+${m1}`;
  for (const m of METHODS) {
    const a = acc[m], c = a.ok ? a.cov / a.ok : NaN, se = a.ok ? Math.sqrt(c * (1 - c) / a.ok) : NaN;
    let verdict: string;
    if (m0 < MIN_CALIBRATION_PER_CLASS || m1 < MIN_CALIBRATION_PER_CLASS) verdict = 'REFUSED (size)';
    else if (a.ok < MIN_OK) verdict = 'REFUSED (admitted < 30)';
    else { pooled[m].ok += a.ok; pooled[m].cov += a.cov; pooled[m].assessed++; verdict = c >= TARGET ? 'PASS' : 'NOT_MET'; if (c < TARGET) failing[m].push(name); }
    console.log(`${name} | ${m} | ${a.ok} | ${a.ok ? (c * 100).toFixed(1) + '% (' + (se * 100).toFixed(2) + ')' : 'n/a'} | ${a.ok ? median(a.w).toFixed(3) : 'n/a'} | ${verdict}`);
  }
}
for (const m of METHODS) {
  const p = pooled[m];
  console.log(`SUMMARY seed ${seed} ${m}: ${p.assessed} cells assessed, pooled conditional coverage ${(p.cov / p.ok * 100).toFixed(2)}% over ${p.ok} admitted draws, cells under 93%: ${failing[m].length} ${JSON.stringify(failing[m])}`);
}
console.log(`run time ${((Date.now() - t0) / 1000).toFixed(1)} s, load average ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}, 72 cells x ${T} datasets x 3 methods on the same draws`);
