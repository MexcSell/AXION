import { describe, expect, it } from 'vitest';
import {
  buildVariants, checkReferenceAndNull, checkTrialStart, cloneState, gradeValidity, mulberry32, passAtK, passPowK, wilson, MIN_VALIDITY_TRIALS,
  type GradeFn, type ToyTask,
} from '../src/evolution/outcome-grader.ts';
import { TOY_TASKS } from '../src/evolution/outcome-tasks.ts';
import { leakFixtures } from './c97-fixtures.ts';

// c97: tests the harness on toy tasks; no model, no agent. Real tasks need agents to execute.

describe('c97 item 1-2: ten toy tasks, reference passes and null fails (threshold a)', () => {
  it('has 10 tasks with unique ids', () => {
    expect(TOY_TASKS.length).toBe(10);
    expect(new Set(TOY_TASKS.map((t) => t.id)).size).toBe(10);
  });
  it('threshold (a): 10/10 reference passes, null fails, grading is deterministic', () => {
    const rows = TOY_TASKS.map((t) => ({ id: t.id, ...checkReferenceAndNull(t) }));
    for (const r of rows) expect(r, r.id).toEqual({ id: r.id, referencePasses: true, nullFails: true, deterministic: true });
    console.info('C97 (a):', JSON.stringify({ n: rows.length, ok: rows.filter((r) => r.referencePasses && r.nullFails).length, wilson: wilson(10, 10) }));
  });
  it('a reference does not mutate the initial state', () => {
    for (const t of TOY_TASKS) { const before = JSON.stringify(t.initial); t.reference(t.initial); t.nul(t.initial); expect(JSON.stringify(t.initial), t.id).toBe(before); }
  });
  it('graders judge the end state, not claims: a state with an extra unrelated change fails', () => {
    for (const t of TOY_TASKS) {
      const s = t.reference(cloneState(t.initial));
      s.files['/work/unrelated-damage.txt'] = 'x';
      expect(t.grade(s, t.initial).pass, t.id).toBe(false);
    }
  });
  it('scratch files are ignored', () => {
    for (const t of TOY_TASKS) { const s = t.reference(cloneState(t.initial)); s.files['/scratch/a.log'] = 'x'; expect(t.grade(s, t.initial).pass, t.id).toBe(true); }
  });
});

describe('c97 item 3: grader validity (threshold c)', () => {
  const alwaysFail: GradeFn = () => ({ pass: false, reasons: ['broken'] });
  const alwaysPass: GradeFn = () => ({ pass: true, reasons: [] });
  const wrongExpectation = (t: ToyTask): GradeFn => (f, i) => { const r = t.grade(f, i); return { pass: !r.pass && false, reasons: r.reasons }; };

  it('healthy graders are not flagged over >= 10 varied solutions, and every partial solution fails', () => {
    for (const t of TOY_TASKS) {
      const variants = buildVariants(t);
      expect(variants.length, t.id).toBeGreaterThanOrEqual(MIN_VALIDITY_TRIALS);
      const rep = gradeValidity(t, t.grade, variants);
      expect(rep.flagged, `${t.id}: ${rep.flags.join()}`).toBe(false);
      for (const v of variants) expect(t.grade(cloneState(v.state), t.initial).pass, `${t.id}/${v.name}`).toBe(v.expect === 'pass');
    }
  });
  it('threshold (c): wrong-expectation mutants (fail the reference) are flagged 10/10', () => {
    let flagged = 0;
    for (const t of TOY_TASKS) { const rep = gradeValidity(t, wrongExpectation(t), buildVariants(t)); if (rep.flagged && rep.flags.includes('fails_reference')) flagged++; }
    expect(flagged).toBe(10);
    console.info('C97 (c) broken-fails-reference flagged:', JSON.stringify({ flagged, n: 10, wilson: wilson(flagged, 10) }));
  });
  it('always-fail and always-pass graders are flagged 10/10 each', () => {
    let f = 0, p = 0;
    for (const t of TOY_TASKS) {
      const v = buildVariants(t);
      if (gradeValidity(t, alwaysFail, v).flags.includes('never_passes')) f++;
      const rp = gradeValidity(t, alwaysPass, v);
      if (rp.flags.includes('always_passes') && rp.flags.includes('passes_null')) p++;
    }
    expect([f, p]).toEqual([10, 10]);
  });
  it('fewer than 10 trials is flagged, never silently accepted', () => {
    const t = TOY_TASKS[0];
    expect(gradeValidity(t, t.grade, buildVariants(t).slice(0, 5)).flags).toContain('too_few_trials');
  });
});

describe('c97 item 5: trial isolation (threshold d)', () => {
  const leaks = leakFixtures(TOY_TASKS);
  it('12 seeded cross-trial leaks are all caught', () => {
    expect(leaks.length).toBe(12);
    for (const l of leaks) expect(checkTrialStart(l.task, l.start).clean, l.name).toBe(false);
    console.info('C97 (d) caught:', JSON.stringify({ caught: leaks.length, n: leaks.length, wilson: wilson(leaks.length, leaks.length) }));
  });
  it('12 clean starts raise no flag', () => {
    let flags = 0;
    for (let i = 0; i < 12; i++) { const t = TOY_TASKS[i % 10]; if (!checkTrialStart(t, cloneState(t.initial)).clean) flags++; }
    expect(flags).toBe(0);
  });
  it('a leftover final state would have let the null solution pass (why isolation matters)', () => {
    const consequential = leaks.filter((l) => l.leftoverFinal);
    expect(consequential.length).toBe(2);
    for (const l of consequential) expect(l.task.grade(l.task.nul(cloneState(l.start)), l.task.initial).pass, l.name).toBe(true);
  });
});

describe('c97 item 6: pass^k next to pass@k', () => {
  it('estimators on known values', () => {
    expect(passAtK(10, 0, 5)).toBe(0);
    expect(passPowK(10, 10, 10)).toBe(1);
    expect(passAtK(10, 5, 1)).toBeCloseTo(0.5, 12);
    expect(passPowK(10, 5, 1)).toBeCloseTo(0.5, 12);
    expect(passPowK(10, 5, 2)).toBeCloseTo(20 / 90, 12);
    expect(passAtK(10, 5, 2)).toBeCloseTo(1 - 20 / 90, 12);
    expect(() => passAtK(10, 11, 1)).toThrow();
    expect(() => passPowK(5, 3, 6)).toThrow();
  });
  it('wilson known values', () => {
    const w = wilson(37, 40);
    expect(w.lo).toBeCloseTo(0.801, 2); expect(w.hi).toBeCloseTo(0.974, 2);
    expect(wilson(10, 10).lo).toBeCloseTo(0.722, 2);
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1, n: 0 });
  });
  it('scripted dice over the 10 tasks: pass^k <= pass@k, both graded by the real graders', () => {
    const rng = mulberry32(9703);
    const N = 10;
    const rows: { id: string; p: number; c: number }[] = [];
    TOY_TASKS.forEach((t, ti) => {
      const p = 0.95 - ti * 0.09; // scripted per-task success chance, 0.95 down to 0.14
      const wrong = buildVariants(t).filter((v) => v.expect === 'fail');
      let c = 0;
      for (let k = 0; k < N; k++) {
        const v = rng() < p ? t.reference(cloneState(t.initial)) : wrong[Math.floor(rng() * wrong.length)].state;
        if (t.grade(cloneState(v), t.initial).pass) c++;
      }
      rows.push({ id: t.id, p, c });
    });
    const table = [1, 2, 5, 10].map((k) => ({
      k,
      passAtK: rows.reduce((a, r) => a + passAtK(N, r.c, k), 0) / rows.length,
      passPowK: rows.reduce((a, r) => a + passPowK(N, r.c, k), 0) / rows.length,
    }));
    for (const r of table) expect(r.passPowK).toBeLessThanOrEqual(r.passAtK + 1e-12);
    for (let i = 1; i < table.length; i++) { expect(table[i].passAtK).toBeGreaterThanOrEqual(table[i - 1].passAtK - 1e-12); expect(table[i].passPowK).toBeLessThanOrEqual(table[i - 1].passPowK + 1e-12); }
    console.info('C97 pass@k vs pass^k (scripted dice, n=10 per task, 10 tasks):', JSON.stringify({ counts: rows.map((r) => r.c), table }));
  });
});
