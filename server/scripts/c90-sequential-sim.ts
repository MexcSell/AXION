// c90 (R5-4): simulation of the peek-safe confidence sequence (src/company/sequential.ts) against naive peeking.
// Rule and thresholds: web/docs/improve/cycles/c90-method.md (committed before this script and before any run).
// Usage: npx tsx scripts/c90-sequential-sim.ts <seed> [power]   (power mode: ever-exclude rates under real effects; pure arithmetic, no database, no model call; one seed per run)
import os from 'node:os';
import { initialState, update, readout, MIN_PER_ARM, RHO, ALPHA } from '../src/company/sequential.ts';

function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seed = Number(process.argv[2]);
if (!Number.isInteger(seed)) throw new Error('usage: c90-sequential-sim.ts <seed>');
const POWER = process.argv[3] === 'power';
const T = 1000, N = 200, Z = 1.959964, PS = [0.1, 0.3, 0.5], WIDTH_AT = [20, 50, 100];
const SE = Math.sqrt(ALPHA * (1 - ALPHA) / T), LIMIT = ALPHA + 2 * SE;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const t0 = Date.now();
if (POWER) {
  console.log(`c90 power simulation: seed ${seed}, ${T} streams per cell, arms alternate, checked after every observation from ${MIN_PER_ARM} per arm; share of streams that EVER exclude zero by n per arm (real effect, so higher is better)`);
  const cells: Array<[number, number]> = [[0.3, 0.5], [0.3, 0.7], [0.2, 0.8]];
  for (const [ci, [pb, pa]] of cells.entries()) {
    const rng = mulberry32(seed + 104729 * (ci + 1));
    const hit: Record<number, number> = { 50: 0, 100: 0, 200: 0 };
    for (let t = 0; t < T; t++) {
      let s = initialState(), first = Infinity;
      for (let i = 1; i <= 200; i++) {
        s = update(update(s, { arm: 'before', outcome: (rng() < pb ? 1 : 0) as 0 | 1 }), { arm: 'after', outcome: (rng() < pa ? 1 : 0) as 0 | 1 });
        if (first === Infinity && i >= MIN_PER_ARM && readout(s).zeroExcluded) first = i;
      }
      for (const n of [50, 100, 200]) if (first <= n) hit[n]++;
    }
    console.log(`${pb} vs ${pa} (gap ${((pa - pb) * 100).toFixed(0)} points): ` + [50, 100, 200].map((n) => `n=${n}: ${(hit[n] / T * 100).toFixed(1)}%`).join(', '));
  }
  console.log(`SUMMARY power seed ${seed}: elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s, load average ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  process.exit(0);
}
console.log(`c90 sequential simulation: seed ${seed}, ${T} no-effect streams per p, ${N} obs per arm (arms alternate), checked after every observation from ${MIN_PER_ARM} per arm, alpha ${ALPHA}, rho ${RHO.toFixed(4)}`);
console.log(`limit for (a): ${(ALPHA * 100).toFixed(2)}% + 2 x MC SE (${(SE * 100).toFixed(2)} points) = ${(LIMIT * 100).toFixed(2)}%`);
let allPass = true;
for (const [pi, p] of PS.entries()) {
  const rng = mulberry32(seed + 7919 * (pi + 1));
  let cs = 0, naive = 0;
  const w: Record<number, number[]> = { 20: [], 50: [], 100: [] }, wNaive: Record<number, number[]> = { 20: [], 50: [], 100: [] };
  for (let t = 0; t < T; t++) {
    let s = initialState(), sb = 0, sa = 0, csHit = false, nvHit = false;
    for (let i = 1; i <= N; i++) {
      const xb = rng() < p ? 1 : 0, xa = rng() < p ? 1 : 0;
      s = update(update(s, { arm: 'before', outcome: xb as 0 | 1 }), { arm: 'after', outcome: xa as 0 | 1 });
      sb += xb; sa += xa;
      if (i < MIN_PER_ARM) continue;
      const r = readout(s);
      if (r.zeroExcluded) csHit = true;
      const pb = sb / i, pa = sa / i, d = pa - pb, se = Math.sqrt(pb * (1 - pb) / i + pa * (1 - pa) / i);
      if (se > 0 ? Math.abs(d) > Z * se : d !== 0) nvHit = true;
      if (WIDTH_AT.includes(i)) { w[i].push(r.upper! - r.lower!); wNaive[i].push(2 * Z * se); }
    }
    if (csHit) cs++; if (nvHit) naive++;
  }
  const rate = cs / T, pass = rate <= LIMIT; if (!pass) allPass = false;
  console.log(`p=${p}: ever-exclude-zero, confidence sequence ${(rate * 100).toFixed(2)}% (${cs}/${T}) -> ${pass ? 'PASS' : 'NOT MET'}; naive 95% Wald re-checked every observation ${(naive / T * 100).toFixed(2)}% (${naive}/${T})`);
  console.log(`  median width, confidence sequence: ${WIDTH_AT.map((n) => `n=${n}: ${median(w[n]).toFixed(3)}`).join(', ')}; fixed-horizon Wald (single look): ${WIDTH_AT.map((n) => `n=${n}: ${median(wNaive[n]).toFixed(3)}`).join(', ')}`);
}
console.log(`SUMMARY seed ${seed}: threshold (a) ${allPass ? 'PASS on all p' : 'NOT MET'}; elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s, load average ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
