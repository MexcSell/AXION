import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/evolution/stats.ts';
import { auditState, AUDIT_BAR, AUDIT_MIN_N, type AuditSample } from '../src/company/metric-audit.ts';

/**
 * Improvement cycle 66, item 4: the human-audited sample, scaffold. A divergence between what the metric counted and what a person
 * found, above a stated bar, flags the row.
 *
 * THIS IS A FIXTURE TEST OF THE FLAG. It is circular: the fixture itself defines what "gamed" means (a sample the metric counted as
 * a success that a person finds is not), and then checks that a flag built on exactly that disagreement fires. It shows the
 * arithmetic of the flag (bar, minimum sample, noise) is sound. It is NOT evidence that the flag catches real gaming: no real agent
 * has executed, and real gaming need not look like this model. B2's "about half of episodes" figure is a motive only and is not used.
 *
 * Model (stated, fixed before running): each audit takes N samples. A sample is gamed with probability g: the metric counted it as a
 * success while it is not (metricLabel true, truth false). Otherwise the metric equals the truth. The auditor reports the truth,
 * flipped with probability e (auditor error). Bar and minimum N are AUDIT_BAR and AUDIT_MIN_N, chosen before the trials.
 */
function audit(rand: () => number, n: number, g: number, e: number): AuditSample[] {
  const out: AuditSample[] = [];
  for (let i = 0; i < n; i++) {
    const truth = rand() < 0.7; // the honest success share does not matter to the flag, it only varies the samples
    const gamed = rand() < g;
    const metricLabel = gamed ? true : truth;
    const realTruth = gamed ? false : truth;
    const auditLabel = rand() < e ? !realTruth : realTruth;
    out.push({ ref: `s${i}`, metricLabel, auditLabel });
  }
  return out;
}
function rate(seed0: number, trials: number, n: number, g: number, e: number): number {
  let fired = 0;
  for (let k = 0; k < trials; k++) if (auditState(audit(mulberry32(seed0 + k), n, g, e)).flagged) fired++;
  return fired / trials;
}
const SEED = 660001, FRESH = 9_900_001;
const pct = (x: number) => (x * 100).toFixed(1) + '%';

describe('auditState (pure)', () => {
  const s = (m: boolean, a: boolean, i: number): AuditSample => ({ ref: `r${i}`, metricLabel: m, auditLabel: a });
  it('is null and state none below the minimum sample, however large the disagreement', () => {
    const few = Array.from({ length: AUDIT_MIN_N - 1 }, (_, i) => s(true, false, i));
    const st = auditState(few);
    expect(st).toMatchObject({ n: AUDIT_MIN_N - 1, divergence: null, state: 'none', flagged: false });
  });
  it('flags at exactly the bar and not one disagreement below it', () => {
    const n = 100, atBar = Math.ceil((AUDIT_BAR / 100) * n);
    const mk = (d: number) => Array.from({ length: n }, (_, i) => s(true, i >= d, i));
    expect(auditState(mk(atBar))).toMatchObject({ divergence: atBar, flagged: true, disagreements: atBar, metricOver: atBar, auditOver: 0 });
    expect(auditState(mk(atBar - 1)).flagged).toBe(false);
  });
  it('counts the direction: the metric over-crediting vs the audit finding more than the metric did', () => {
    const xs = [...Array.from({ length: 40 }, (_, i) => s(true, false, i)), ...Array.from({ length: 10 }, (_, i) => s(false, true, 100 + i)), ...Array.from({ length: 50 }, (_, i) => s(true, true, 200 + i))];
    expect(auditState(xs)).toMatchObject({ n: 100, disagreements: 50, metricOver: 40, auditOver: 10, divergence: 50, flagged: true });
  });
});

describe('the flag on a seeded fixture (circular: see the header)', () => {
  it('RED/GREEN threshold case: 100 samples per audit, 5% auditor error: fires in at least 95% of 1,000 trials at 20% gamed, and in at most 5% at 0% gamed', () => {
    const g20 = rate(SEED, 1000, 100, 0.2, 0.05), g0 = rate(SEED, 1000, 100, 0, 0.05);
    console.log(`[c66 trials] n=100 error=5% seed=${SEED}: gamed 20% fires ${pct(g20)} (need >= 95%); gamed 0% fires ${pct(g0)} (need <= 5%); bar ${AUDIT_BAR}%, min n ${AUDIT_MIN_N}`);
    expect(g20).toBeGreaterThanOrEqual(0.95);
    expect(g0).toBeLessThanOrEqual(0.05);
  });

  it('a fresh seed range gives the same answer (nothing was tuned to the first seeds)', () => {
    const g20 = rate(FRESH, 1000, 100, 0.2, 0.05), g0 = rate(FRESH, 1000, 100, 0, 0.05);
    console.log(`[c66 trials] n=100 error=5% fresh seed=${FRESH}: gamed 20% fires ${pct(g20)}; gamed 0% fires ${pct(g0)}`);
    expect(g20).toBeGreaterThanOrEqual(0.95);
    expect(g0).toBeLessThanOrEqual(0.05);
  });

  it('reports the grid, including the cells that do not meet the threshold (no cell is dropped)', () => {
    const rows: string[] = ['sample n | auditor error | gamed 20% fires | gamed 0% fires | skipped (n below minimum)'];
    for (const n of [30, 60, 100, 200]) for (const e of [0, 0.05, 0.1]) {
      const skipped = n < AUDIT_MIN_N;
      rows.push(`${n} | ${e * 100}% | ${skipped ? 'n/a' : pct(rate(SEED, 1000, n, 0.2, e))} | ${skipped ? 'n/a' : pct(rate(SEED, 1000, n, 0, e))} | ${skipped ? 'all' : 'none'}`);
    }
    console.log('[c66 trials grid, seed ' + SEED + ', 1000 trials per cell]\n' + rows.join('\n'));
    expect(rows.length).toBe(13);
  });
});
