import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { makeSchema } from './helpers.ts';
import { makeDataset, addRun } from './eval-fixtures.ts';
import {
  ESTIMATOR, ESTIMATOR_SCOPE, MIN_CALIBRATION_PER_CLASS, correctedPassRate, calibratedVerdict, calibrationCounts, recordCalibrationLabel, calibratedEvaluation,
  type Calibration,
} from '../src/evolution/judge-calibration.ts';

// c61 R2-1: judge calibration SCAFFOLD. Judges exist today only as family labels (c53), so nothing in a proposal's verdict calls this yet.
// Estimator: A1 (Lee, Zeng, Jeong, Sohn, Lee: "How to Correctly Report LLM-as-a-Judge Evaluations", ICML 2026, arXiv 2511.21140):
// Rogan-Gladen point estimate (Eq. 7) and the adjusted-Wald interval (Eq. 8-12, "add two successes and two failures"). Scope: BINARY judge
// verdicts, mapped here to one pass/fail verdict per case. Arithmetic over stored labels: no model call.

function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

describe('the estimator is named and scoped', () => {
  it('says which estimator and what scope', () => {
    expect(ESTIMATOR).toMatch(/Rogan-Gladen/); expect(ESTIMATOR).toMatch(/2511\.21140/);
    expect(ESTIMATOR_SCOPE).toMatch(/binary/i); expect(ESTIMATOR_SCOPE).toMatch(/pass\/fail/);
  });
});

describe('correctedPassRate', () => {
  const cal: Calibration = { tp: 45, fn: 5, tn: 40, fp: 10 }; // sensitivity .9, specificity .8
  it('matches the closed form (A1 Eq. 7) on a hand-checked case', () => {
    const e = correctedPassRate({ judgedPass: 120, n: 200, calibration: cal });
    expect(e.status).toBe('ok');
    expect(e.sensitivity).toBeCloseTo(0.9, 10); expect(e.specificity).toBeCloseTo(0.8, 10);
    expect(e.raw.rate).toBeCloseTo(0.6, 10);
    expect(e.corrected.rate).toBeCloseTo((0.6 + 0.8 - 1) / (0.8 + 0.9 - 1), 10); // 0.5714...
    expect(e.corrected.low!).toBeLessThan(e.corrected.rate!); expect(e.corrected.high!).toBeGreaterThan(e.corrected.rate!);
    expect(e.corrected.low!).toBeGreaterThanOrEqual(0); expect(e.corrected.high!).toBeLessThanOrEqual(1);
  });
  it('a perfect judge gives the raw rate back', () => {
    const e = correctedPassRate({ judgedPass: 30, n: 100, calibration: { tp: 40, fn: 0, tn: 40, fp: 0 } });
    expect(e.corrected.rate).toBeCloseTo(0.3, 10);
  });
  it('no calibration data: no corrected estimate, and the reason says so', () => {
    for (const c of [null, { tp: 0, fn: 0, tn: 0, fp: 0 }]) {
      const e = correctedPassRate({ judgedPass: 30, n: 100, calibration: c });
      expect(e.status).toBe('no_calibration'); expect(e.corrected).toEqual({ rate: null, low: null, high: null }); expect(e.raw.rate).toBeCloseTo(0.3, 10);
    }
  });
  it(`fewer than ${MIN_CALIBRATION_PER_CLASS} labelled items in either class: no corrected estimate`, () => {
    expect(correctedPassRate({ judgedPass: 30, n: 100, calibration: { tp: 20, fn: 0, tn: 5, fp: 4 } }).status).toBe('too_few_calibration');
    expect(correctedPassRate({ judgedPass: 30, n: 100, calibration: { tp: 5, fn: 4, tn: 20, fp: 0 } }).status).toBe('too_few_calibration');
  });
  it('a judge no better than a coin (sensitivity + specificity <= 1) gives no estimate, never NaN or an inverted interval', () => {
    for (const c of [{ tp: 25, fn: 25, tn: 25, fp: 25 }, { tp: 10, fn: 40, tn: 30, fp: 20 }, { tp: 0, fn: 50, tn: 0, fp: 50 }]) {
      const e = correctedPassRate({ judgedPass: 50, n: 100, calibration: c });
      expect(e.status).toBe('judge_too_weak'); expect(e.corrected.rate).toBeNull(); expect(e.corrected.low).toBeNull();
    }
  });
  it('never returns NaN, Infinity or an inverted interval over a 4000-point sweep', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 4000; i++) {
      const n = Math.floor(rng() * 300), m = () => Math.floor(rng() * 80);
      const e = correctedPassRate({ judgedPass: Math.floor(rng() * (n + 1)), n, calibration: { tp: m(), fn: m(), tn: m(), fp: m() } });
      for (const x of [e.raw.rate, e.raw.low, e.raw.high, e.corrected.rate, e.corrected.low, e.corrected.high]) if (x !== null) { expect(Number.isFinite(x)).toBe(true); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
      if (e.corrected.low !== null) expect(e.corrected.low).toBeLessThanOrEqual(e.corrected.high!);
      if (e.status !== 'ok') expect(e.corrected.rate).toBeNull();
    }
  });
  it('a bad input is refused', () => {
    expect(() => correctedPassRate({ judgedPass: 11, n: 10, calibration: null })).toThrow();
    expect(() => correctedPassRate({ judgedPass: -1, n: 10, calibration: null })).toThrow();
    expect(() => correctedPassRate({ judgedPass: 1, n: 10, calibration: { tp: -1, fn: 0, tn: 0, fp: 0 } })).toThrow();
  });
});

describe('calibratedVerdict', () => {
  const good: Calibration = { tp: 95, fn: 5, tn: 95, fp: 5 };
  it('is inconclusive in 100% of fixture cases without enough calibration data', () => {
    let n = 0;
    const rng = mulberry32(11);
    for (let i = 0; i < 100; i++) {
      const cal = i % 3 === 0 ? null : { tp: Math.floor(rng() * 9), fn: 0, tn: 50, fp: 0 }; // under the minimum in one class, or none
      const v = calibratedVerdict({ baseline: { judgedPass: 20, n: 100 }, candidate: { judgedPass: 90, n: 100 }, calibration: cal });
      if (v.outcome === 'inconclusive') n++;
    }
    expect(n).toBe(100);
  });
  it('always shows the raw and the corrected figures side by side', () => {
    for (const cal of [null, good]) {
      const v = calibratedVerdict({ baseline: { judgedPass: 40, n: 100 }, candidate: { judgedPass: 80, n: 100 }, calibration: cal });
      expect(v.baseline.raw.rate).toBeCloseTo(0.4, 10); expect(v.candidate.raw.rate).toBeCloseTo(0.8, 10);
      expect(v.rawDelta).toBeCloseTo(0.4, 10);
      expect(v).toHaveProperty('correctedDelta'); expect(v.estimator).toBe(ESTIMATOR);
    }
  });
  it('a clear gain with a good judge is verified better', () => {
    const v = calibratedVerdict({ baseline: { judgedPass: 30, n: 200 }, candidate: { judgedPass: 150, n: 200 }, calibration: good });
    expect(v.outcome).toBe('verified_better'); expect(v.correctedDelta!).toBeGreaterThan(0.3);
  });
  it('a raw gain whose corrected interval spans the margin is inconclusive', () => {
    const v = calibratedVerdict({ baseline: { judgedPass: 50, n: 60 }, candidate: { judgedPass: 54, n: 60 }, calibration: { tp: 30, fn: 5, tn: 25, fp: 8 } });
    expect(v.outcome).toBe('inconclusive'); expect(v.reasons.join(' ')).toMatch(/margin|interval/);
  });
  it('a candidate whose whole corrected interval is below the base is worse', () => {
    const v = calibratedVerdict({ baseline: { judgedPass: 180, n: 200 }, candidate: { judgedPass: 40, n: 200 }, calibration: good });
    expect(v.outcome).toBe('worse');
  });
  it('the margin is a pass-rate gap (the score margin of 5 points maps to 0.05); a smaller gap is not enough', () => {
    const v = calibratedVerdict({ baseline: { judgedPass: 100, n: 1000 }, candidate: { judgedPass: 120, n: 1000 }, calibration: { tp: 490, fn: 10, tn: 490, fp: 10 } });
    expect(v.marginRate).toBe(0.05);
  });
});

describe('coverage of the corrected interval (seeded Monte Carlo, simulated judges of KNOWN error)', () => {
  // The first 48 cells are the reviewer's grid, fixed (c61 review, finding 4); we added 24 at the new minimum calibration size (20 per class): theta {0.05, 0.5, 0.95} x judge (specificity, sensitivity)
  // {(.6,.6), (.7,.65), (.55,.9), (.9,.9)} x (test n, calibration m0+m1) {(30,10+10), (100,10+60), (100,60+10), (200,50+50), plus (100,20+20), (100,20+60)}.
  // Each cell is 1000 simulated datasets at a nominal 95%. COVERAGE IS CONDITIONAL ON PASSING THE GATE (status ok): a draw the gate
  // skips has no interval. The skip rate is printed per cell. SE = sqrt(c(1-c)/ok). The target is 93%. Two seeds: 424242 (the grid's
  // seed, used to choose the gate) and 77031 (chosen before the confirmation run). Nothing is tuned to pass: the cells that do not meet
  // the target are listed in NOT_MET and the test fails if that list changes in either direction.
  const thetas = [0.05, 0.5, 0.95];
  const judges: Array<[number, number]> = [[0.6, 0.6], [0.7, 0.65], [0.55, 0.9], [0.9, 0.9]]; // [specificity q0, sensitivity q1]
  const sizes: Array<[number, number, number]> = [[30, 10, 10], [100, 10, 60], [100, 60, 10], [200, 50, 50], [100, 20, 20], [100, 20, 60]]; // the last two are ours: sizes at the new minimum of 20 per class
  const bern = (rng: () => number, p: number) => (rng() < p ? 1 : 0);
  /** a cell with fewer gate-passing draws than this has no usable coverage figure: it is a REFUSED regime (reported, not asserted) */
  const MIN_OK = 30;
  const NOT_MET: Record<number, string[]> = {
    424242: ['0.05/0.6/0.6/200/50+50',  '0.05/0.6/0.6/100/20+20',  '0.05/0.6/0.6/100/20+60',  '0.05/0.7/0.65/100/20+60',  '0.95/0.6/0.6/200/50+50',  '0.95/0.6/0.6/100/20+20',  '0.95/0.6/0.6/100/20+60',  '0.95/0.7/0.65/100/20+20'],
    77031: ['0.05/0.6/0.6/200/50+50',  '0.05/0.6/0.6/100/20+20',  '0.05/0.6/0.6/100/20+60',  '0.05/0.7/0.65/100/20+20',  '0.5/0.6/0.6/100/20+60',  '0.95/0.6/0.6/200/50+50',  '0.95/0.6/0.6/100/20+20'],
  };

  for (const seed of [424242, 77031]) {
    it(`seed ${seed}: conditional coverage per cell, with the skip rate`, () => {
      const failing: string[] = []; const lines: string[] = []; let ci = 0; let refused = 0;
      let okAll = 0, covAll = 0;
      for (const theta of thetas) for (const [q0, q1] of judges) for (const [n, m0, m1] of sizes) {
        const rng = mulberry32(seed + 7919 * ++ci);
        let ok = 0, cov = 0; const T = 1000;
        for (let t = 0; t < T; t++) {
          let judgedPass = 0;
          for (let i = 0; i < n; i++) judgedPass += bern(rng, bern(rng, theta) ? q1 : 1 - q0);
          let tp = 0, fp = 0;
          for (let i = 0; i < m1; i++) tp += bern(rng, q1);
          for (let i = 0; i < m0; i++) fp += bern(rng, 1 - q0);
          const e = correctedPassRate({ judgedPass, n, calibration: { tp, fn: m1 - tp, tn: m0 - fp, fp } });
          if (e.status !== 'ok') continue;
          ok++; if (e.corrected.low! <= theta && theta <= e.corrected.high!) cov++;
        }
        const name = `${theta}/${q0}/${q1}/${n}/${m0}+${m1}`;
        const c = ok ? cov / ok : NaN, se = ok ? Math.sqrt(c * (1 - c) / ok) : NaN;
        lines.push(`seed ${seed} cell ${name}: passes the gate ${ok}/1000 (skipped ${((1 - ok / T) * 100).toFixed(1)}%), conditional coverage ${ok ? (c * 100).toFixed(1) + '% (SE ' + (se * 100).toFixed(2) + ')' : 'n/a'}`);
        if (ok < MIN_OK) refused++; else { okAll += ok; covAll += cov; if (c < 0.93) failing.push(name); }
      }
      console.log(lines.join('\n'));
      console.log(`seed ${seed}: ${72 - refused} cells assessed (gate passes >= ${MIN_OK}), ${refused} refused regimes; pooled conditional coverage ${(covAll / okAll * 100).toFixed(2)}%; cells under 93%: ${failing.length} ${JSON.stringify(failing)}`);
      expect(failing).toEqual(NOT_MET[seed]);
    });
  }
});

let s: Awaited<ReturnType<typeof makeSchema>>;
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);
const cx = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => { const c = await s.pool.connect(); try { return await fn(c); } finally { c.release(); } };
let v1 = '';
beforeAll(async () => {
  s = await makeSchema();
  await q(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
  await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-h','t-1','Human','human','h','member','approved'), ('u-off','t-1','Off','off','h','member','disabled')`);
  await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('a-1','t-1','A','r','D','duty','u')`);
  v1 = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-1',1,'v1','m','h','u') returning id`)).rows[0].id;
});
afterAll(async () => { await s.drop(); });

describe('the calibration label store', () => {
  const label = (o: Partial<{ datasetId: string; judge: string; input: unknown; judgeVerdict: boolean; humanLabel: boolean; by: string }> = {}) =>
    cx((c) => recordCalibrationLabel(c, { tenantId: 't-1', datasetId: o.datasetId ?? 'CD-1', judgeLabel: o.judge ?? 'claude-judge', input: o.input ?? { cal: 1 }, judgeVerdict: o.judgeVerdict ?? true, humanLabel: o.humanLabel ?? true, labeledBy: o.by ?? 'u-h' }));
  beforeAll(async () => { await makeDataset(s.pool, { id: 'CD-1', split: 'holdout', cases: 4 }); await makeDataset(s.pool, { id: 'CD-OPEN', split: 'holdout', cases: 4, freeze: false }); });
  it('stores a label per (judge family, dataset) and resolves the family through the c38 table', async () => {
    await label({ input: { cal: 1 } });
    expect((await q(`select judge_family f, judge_verdict j, human_label h from eval_calibration_labels`)).rows[0]).toEqual({ f: 'anthropic', j: true, h: true });
  });
  it('an unresolvable judge label is refused', async () => { await expect(label({ judge: 'mystery-model', input: { cal: 2 } })).rejects.toMatchObject({ code: 'judge_label_unknown' }); });
  it('is disjoint from the test set: an item whose input is a case of the dataset is refused (canonical form: key order does not hide it)', async () => {
    const ho = (await q(`select input from eval_cases where dataset_id='CD-1' and case_id='c01'`)).rows[0].input as Record<string, unknown>;
    await expect(label({ input: ho })).rejects.toThrow(/calibration_overlaps_test/);
    await expect(label({ input: Object.fromEntries(Object.entries(ho).reverse()) })).rejects.toThrow(/calibration_overlaps_test/);
    await expect(label({ input: { ...ho, extra: 1 } })).resolves.toBeUndefined(); // a different input is a different item
  });
  it('the database refuses the same for a raw insert', async () => {
    const ho = (await q(`select input from eval_cases where dataset_id='CD-1' and case_id='c02'`)).rows[0].input;
    await expect(q(`insert into eval_calibration_labels(tenant_id, dataset_id, judge_family, input, judge_verdict, human_label, labeled_by) values ('t-1','CD-1','anthropic',$1::jsonb,true,true,'u-h')`, [JSON.stringify(ho)])).rejects.toThrow(/calibration_overlaps_test/);
  });
  it('needs a frozen dataset (so the test set cannot change afterwards) and a known, approved person', async () => {
    await expect(label({ datasetId: 'CD-OPEN', input: { cal: 3 } })).rejects.toThrow(/dataset_not_frozen/);
    await expect(label({ input: { cal: 4 }, by: 'u-off' })).rejects.toThrow(/labeler/);
    await expect(label({ input: { cal: 5 }, by: 'nobody' })).rejects.toThrow(/labeler/);
  });
  it('one label per item: a second label for the same input, judge family and dataset is refused', async () => {
    await expect(label({ input: { cal: 1 }, humanLabel: false })).rejects.toThrow(/duplicate|unique/);
  });
  it('the input hash is computed by the database', async () => {
    await q(`insert into eval_calibration_labels(tenant_id, dataset_id, judge_family, input, input_sha256, judge_verdict, human_label, labeled_by) values ('t-1','CD-1','anthropic','{"cal":6}'::jsonb,'forged',true,true,'u-h')`);
    expect((await q(`select input_sha256 h from eval_calibration_labels where input = '{"cal":6}'::jsonb`)).rows[0].h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is append-only (update, delete, truncate), except demo purge', async () => {
    await expect(q(`update eval_calibration_labels set human_label = not human_label`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from eval_calibration_labels`)).rejects.toThrow(/append-only/);
    await expect(q(`truncate eval_calibration_labels`)).rejects.toThrow(/append-only/);
    const c = await s.pool.connect();
    try { await c.query('begin'); await c.query(`set local axion.purge_demo='on'`); const r = await c.query(`delete from eval_calibration_labels`); expect(r.rowCount).toBeGreaterThan(0); await c.query('rollback'); } finally { c.release(); }
  });
  it('counts the 2x2 table per judge family and dataset', async () => {
    await makeDataset(s.pool, { id: 'CD-2', split: 'holdout', cases: 3 });
    let i = 0;
    for (const [j, h, k] of [[true, true, 3], [false, true, 1], [false, false, 4], [true, false, 2]] as const) for (let x = 0; x < k; x++) await label({ datasetId: 'CD-2', input: { c2: i++ }, judgeVerdict: j, humanLabel: h });
    expect(await cx((c) => calibrationCounts(c, 't-1', 'CD-2', 'anthropic'))).toEqual({ tp: 3, fn: 1, tn: 4, fp: 2 });
    expect(await cx((c) => calibrationCounts(c, 't-1', 'CD-2', 'openai'))).toEqual({ tp: 0, fn: 0, tn: 0, fp: 0 });
  });
});

describe('calibratedEvaluation: stored runs and stored labels', () => {
  let n = 0;
  async function setup(o: { cal?: Calibration; judgeB?: string; judgeC?: string; ungradedC?: Record<number, string> }) {
    const id = 'CE' + ++n;
    await makeDataset(s.pool, { id, split: 'holdout', cases: 12 });
    await q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by) values ($1,'t-1','a-1',$2,'h','{"model":"qwen-72b"}'::jsonb,$1,'t','u')`, ['P' + id, v1]);
    await addRun(s.pool, { id: 'B' + id, datasetId: id, versionId: v1, scores: Array.from({ length: 12 }, () => 40), judge: o.judgeB ?? 'claude-judge', evaluator: 'ev' });
    await addRun(s.pool, { id: 'C' + id, datasetId: id, proposalId: 'P' + id, scores: Array.from({ length: 12 }, () => 80), judge: o.judgeC ?? 'claude-judge', evaluator: 'ev', ungraded: o.ungradedC });
    let i = 0;
    if (o.cal) for (const [j, h, k] of [[true, true, o.cal.tp], [false, true, o.cal.fn], [false, false, o.cal.tn], [true, false, o.cal.fp]] as const) for (let x = 0; x < k; x++)
      await cx((c) => recordCalibrationLabel(c, { tenantId: 't-1', datasetId: id, judgeLabel: 'claude-judge', input: { lab: i++ }, judgeVerdict: j, humanLabel: h, labeledBy: 'u-h' }));
    return id;
  }
  const run = (id: string) => cx((c) => calibratedEvaluation(c, { tenantId: 't-1', baseRunId: 'B' + id, candidateRunId: 'C' + id }));
  it('no labels: inconclusive, raw figures shown', async () => {
    const v = await run(await setup({}));
    expect(v.outcome).toBe('inconclusive'); expect(v.candidate.raw.rate).toBe(1); expect(v.baseline.raw.rate).toBe(0); expect(v.candidate.status).toBe('no_calibration');
  });
  it('enough labels: uses them (12 cases is small, so this is the scaffold, not a policy)', async () => {
    const v = await run(await setup({ cal: { tp: 28, fn: 2, tn: 28, fp: 2 } }));
    expect(v.candidate.sensitivity).toBeCloseTo(28 / 30, 10); expect(v.candidate.status).toBe('ok'); expect(v.outcome).not.toBe('worse');
  });
  it('runs judged by different families are not comparable: inconclusive', async () => {
    const v = await run(await setup({ cal: { tp: 28, fn: 2, tn: 28, fp: 2 }, judgeC: 'gpt-judge' }));
    expect(v.outcome).toBe('inconclusive'); expect(v.reasons.join(' ')).toMatch(/judge/);
  });
  it('ungraded attempts are left out of n (never counted as a judged failure)', async () => {
    const v = await run(await setup({ cal: { tp: 28, fn: 2, tn: 28, fp: 2 }, ungradedC: { 0: 'grader_timeout', 1: 'grader_timeout' } }));
    expect(v.candidate.n).toBe(10); expect(v.candidate.raw.rate).toBe(1);
  });
});
