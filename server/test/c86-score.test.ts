import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeWorld, forecast, type World } from './c86-fixtures.ts';
import { brier, logLoss, binOf, ledgerOf, hundredths, CALIBRATION_MIN_N, FORECAST_METHOD, type ForecastRowIn } from '../../shared/contracts/src/index.ts';

// c86 items 2 and 3: resolution at read time, Brier and log loss, calibration bins, the reference-class baseline, the skill floor.
const close = (a: number | null, b: number, d = 1e-6) => { expect(a).not.toBeNull(); expect(Math.abs((a as number) - b)).toBeLessThan(d); };

describe('scores by hand (pure)', () => {
  // Five forecasts, outcome in the last column. Hand values: Brier (p-o)^2; log loss -ln(p of what happened).
  //  0.80 yes: .04     and -ln .80 = 0.22314355
  //  0.30 no:  .09     and -ln .70 = 0.35667494
  //  0.99 no:  .9801   and -ln .01 = 4.60517019
  //  0.01 yes: .9801   and -ln .01 = 4.60517019
  //  0.50 yes: .25     and -ln .50 = 0.69314718
  const cases: [number, boolean, number, number][] = [[0.8, true, 0.04, 0.22314355], [0.3, false, 0.09, 0.35667494], [0.99, false, 0.9801, 4.60517019], [0.01, true, 0.9801, 4.60517019], [0.5, true, 0.25, 0.69314718]];
  for (const [p, o, b, l] of cases) it(`p=${p}, accepted=${o}: Brier ${b}, log loss ${l}`, () => { close(brier(p, o), b); close(logLoss(p, o), l); });

  it('the boundary probabilities 0 and 1 (a reference-class rate can be exactly these) are clamped to 0.01 and 0.99 for the log, never infinite', () => {
    expect(brier(0, true)).toBe(1); expect(brier(1, true)).toBe(0); expect(brier(1, false)).toBe(1); expect(brier(0, false)).toBe(0);
    close(logLoss(0, true), 4.60517019); close(logLoss(1, false), 4.60517019); close(logLoss(1, true), 0.01005034); close(logLoss(0, false), 0.01005034);
    expect(Number.isFinite(logLoss(0, true))).toBe(true);
  });

  it('bins are on whole percents: 1-20, 21-40, 41-60, 61-80, 81-99 (0.6 and 0.2 land where a person expects)', () => {
    const edges: [number, number][] = [[1, 0], [20, 0], [21, 1], [40, 1], [41, 2], [60, 2], [61, 3], [80, 3], [81, 4], [99, 4]];
    for (const [h, bin] of edges) expect(binOf(h), String(h)).toBe(bin);
    expect(hundredths('0.60')).toBe(60); expect(hundredths(0.29)).toBe(29);
  });

  it('means, bins and the floor on a five-forecast fixture', () => {
    const row = (i: number, p: number, v: string): ForecastRowIn => ({ id: 'F' + i, taskId: 'T' + i, missionId: 'M', taskTitle: 't', probability: p.toFixed(2), madeAt: '2026-01-01T00:00:00.000Z', firstVerdict: v, firstAt: '2026-01-02T00:00:00.000Z', inTime: true, voided: false, classId: null, difficulty: null, baseN: 0, baseX: 0 });
    const l = ledgerOf({ id: 'u', name: 'U' }, [row(1, 0.8, 'accepted'), row(2, 0.3, 'rejected'), row(3, 0.99, 'changes_requested'), row(4, 0.01, 'accepted'), row(5, 0.5, 'accepted')]);
    close(l.meanBrier, 0.46804); close(l.meanLogLoss, 2.09666121);
    expect(l.counts).toEqual({ total: 5, open: 0, void: 0, resolved: 5, late: 0 });
    expect(l.calibration.map((b) => b.n)).toEqual([1, 1, 1, 1, 1]);
    expect(l.calibration.every((b) => b.rate === null && b.meanForecast === null)).toBe(true); // every bin is below 5
    expect(CALIBRATION_MIN_N).toBe(5);
    expect(l.skill).toMatchObject({ state: 'not_enough_evidence', n: 0, needed: 20, skill: null, text: 'not enough evidence (0 of 20)' });
    expect(l.clamp).toEqual({ lo: 0.01, hi: 0.99 });
  });
});

let w: World;
beforeAll(async () => { w = await makeWorld(); }, 60_000);
afterAll(async () => { await w?.t.close(); });

const brief = (task: string, mission: string, cls: string | null, diff: number | null, ago: string) => w.q(
  `insert into delegation_briefs(tenant_id, mission_id, task_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by, created_at)
   values ('t-1',$1,$2,$3,'user',$4,'coder-01',$5::jsonb,$6,1,$3, now() - $7::interval)`,
  [mission, task, w.miaId, `${mission}:coder-01`, JSON.stringify({ goal: 'g', ...(cls ? { taskClass: cls } : {}), ...(diff ? { difficulty: diff } : {}) }), 'a'.repeat(63) + String(Math.floor(Math.random() * 10)), ago]);
const review = (task: string, mission: string, verdict: string, ago: string) => w.q(
  `insert into task_reviews(id, tenant_id, mission_id, task_id, reviewer_id, reviewer_kind, producer_id, producer_kind, principal_id, rubric, verdict, evidence, created_at)
   values ('TR-' || $1::text || '-' || $5::text,'t-1',$2,$1,$3,'user','coder-01','agent',$4,'[{"criterion":"x","result":"pass","note":""}]',$6, case when $6 = 'accepted' then '[{"kind":"url","ref":"https://example.com/x"}]'::jsonb else '[]'::jsonb end, now() - $7::interval)`,
  [task, mission, w.benId, w.miaId, Math.random().toString(36).slice(2, 7), verdict, ago]);
const fc = (task: string, by: string, p: number, ago: string, mission = w.mShared) => w.q(
  `insert into forecasts(id, tenant_id, mission_id, task_id, forecaster_id, probability, made_at) values ('FC-' || $1::text || '-' || $2::text,'t-1',$3,$1,$2,$4, now() - $5::interval)`, [task, by, mission, p.toFixed(2), ago]);
const mine = async (b = w.zed) => (await b.req('GET', '/me/forecasts')).body;

describe('resolution is computed at read time from the first review', () => {
  it('open, then resolved by the FIRST review by seq (a later review of the same task changes nothing)', async () => {
    const id = await w.task();
    expect((await forecast(w.amy, id, 0.7)).status).toBe(201);
    let f = (await mine(w.amy)).forecasts.find((x: any) => x.taskId === id);
    expect(f).toMatchObject({ state: 'open', accepted: null, resolvedAt: null, brier: null, logLoss: null });
    expect((await w.review(id, 'rejected')).status).toBe(201);
    expect((await w.review(id, 'accepted', w.admin)).status).toBe(201);
    f = (await mine(w.amy)).forecasts.find((x: any) => x.taskId === id);
    expect(f.state).toBe('resolved'); expect(f.accepted).toBe(false);
    close(f.brier, 0.49); close(f.logLoss, -Math.log(0.3));
    expect(typeof f.resolvedAt).toBe('string');
  });

  it('nothing is stored for the outcome: the forecasts table has no outcome, score or resolved column', async () => {
    const cols = (await w.q(`select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'forecasts'`)).map((r) => r.column_name).sort();
    expect(cols).toEqual(['forecaster_id', 'id', 'made_at', 'mission_id', 'probability', 'question', 'seq', 'task_id', 'tenant_id']);
  });

  it('a task canceled with no review makes the forecast void (not scored); a later review turns it into resolved', async () => {
    const id = await w.task(w.mShared, { status: 'running' });
    await forecast(w.amy, id, 0.5);
    await w.q(`update tasks set status='canceled' where id=$1`, [id]);
    let l = await mine(w.amy);
    expect(l.forecasts.find((x: any) => x.taskId === id)).toMatchObject({ state: 'void', brier: null });
    const voidBefore = l.counts.void;
    await review(id, w.mShared, 'accepted', '0 seconds');
    l = await mine(w.amy);
    expect(l.forecasts.find((x: any) => x.taskId === id).state).toBe('resolved');
    expect(l.counts.void).toBe(voidBefore - 1);
  });

  it('a mission that was archived makes an unreviewed forecast void', async () => {
    const id = await w.task(w.mShared, { status: 'running' });
    await forecast(w.amy, id, 0.5);
    await w.q(`update missions set status='archived', archived_at=now() where id=$1`, [w.mShared]);
    try { expect((await mine(w.amy)).forecasts.find((x: any) => x.taskId === id).state).toBe('void'); }
    finally { await w.q(`update missions set status='running', archived_at=null where id=$1`, [w.mShared]); }
  });

  it('a forecast that is not strictly before its first review (inserted around the route) is "late": shown, never scored, not counted as resolved', async () => {
    const id = await w.task();
    await review(id, w.mShared, 'accepted', '2 hours');
    await fc(id, w.amyId, 0.9, '1 hour');
    const l = await mine(w.amy);
    expect(l.forecasts.find((x: any) => x.taskId === id)).toMatchObject({ state: 'late', accepted: null, brier: null, logLoss: null, resolvedAt: null });
    expect(l.counts.late).toBeGreaterThanOrEqual(1);
  });

  it('race: forecast and first review sent together: every forecast row is either refused or is not "late" unless the review really began first; never scored after the outcome', async () => {
    for (let i = 0; i < 8; i++) {
      const id = await w.task();
      const [f, r] = await Promise.all([forecast(w.zed, id, 0.6), w.review(id)]);
      expect(r.status).toBe(201);
      const e = (await mine(w.zed)).forecasts.find((x: any) => x.taskId === id);
      if (f.status === 409) expect(e).toBeUndefined();
      else {
        expect(['resolved', 'late']).toContain(e.state);
        const [row] = await w.q(`select (f.made_at < (select min(created_at) from task_reviews r where r.task_id=f.task_id)) as before from forecasts f where f.task_id=$1`, [id]);
        expect(e.state === 'resolved').toBe(row.before); // scored exactly when it was made strictly before the outcome
      }
    }
  }, 60_000);
});

describe('baseline, calibration and skill', () => {
  let zedId: string;
  beforeAll(async () => {
    zedId = w.benId; // Ben is the forecaster of this block (he only reviews elsewhere)
    // history: 6 reviewed tasks of research/3 a long time ago (4 accepted, 2 not) = rate 2/3 with n 6; plus 3 simulated rejected ones that must not count
    for (const v of ['accepted', 'accepted', 'accepted', 'accepted', 'rejected', 'changes_requested']) { const id = await w.task(); await brief(id, w.mShared, 'research', 3, '11 days'); await review(id, w.mShared, v, '10 days'); }
    for (let i = 0; i < 3; i++) { const id = await w.task(); await w.q(`update tasks set simulated=true where id=$1`, [id]); await brief(id, w.mShared, 'research', 3, '11 days'); await review(id, w.mShared, 'rejected', '10 days'); }
    // a task whose brief names only a class: not in any reference class
    const half = await w.task(); await brief(half, w.mShared, 'research', null, '11 days'); await review(half, w.mShared, 'rejected', '10 days');
    // 19 of Zed's forecasts: made 3 days ago, reviewed 1 day ago, brief 4 days ago: 10 accepted at 0.90, 9 not at 0.40
    for (let i = 0; i < 19; i++) { const ok = i < 10; const id = await w.task(); await brief(id, w.mShared, 'research', 3, '4 days'); await fc(id, zedId, ok ? 0.9 : 0.4, '3 days'); await review(id, w.mShared, ok ? 'accepted' : 'rejected', '1 day'); }
  }, 120_000);

  it('the reference-class baseline uses only tasks of the same class and difficulty reviewed before the forecast, not simulated, with both fields named', async () => {
    const l = await mine(w.ben);
    const f = l.forecasts.find((x: any) => x.accepted === true);
    expect(f.classId).toBe('research'); expect(f.difficulty).toBe(3);
    expect(f.baseline).toMatchObject({ classId: 'research', difficulty: 3, n: 6 });
    close(f.baseline.rate, 4 / 6); close(f.baseline.brier, 1 / 9);                 // (2/3 - 1)^2
    const g = l.forecasts.find((x: any) => x.accepted === false);
    close(g.baseline.brier, 4 / 9);                                                // (2/3 - 0)^2
    close(g.baseline.logLoss, -Math.log(1 - 4 / 6));
  });

  it('below 20 resolved forecasts with a baseline the skill is "not enough evidence (19 of 20)"; the means and bins still show', async () => {
    const l = await mine(w.ben);
    expect(l.skill).toMatchObject({ state: 'not_enough_evidence', n: 19, needed: 20, skill: null, meanBrier: null, baselineBrier: null, text: 'not enough evidence (19 of 20)' });
    expect(l.counts).toMatchObject({ resolved: 19, open: 0 });
    close(l.meanBrier, (10 * 0.01 + 9 * 0.16) / 19);
    expect(l.calibration[4]).toMatchObject({ n: 10 }); close(l.calibration[4].rate, 1); close(l.calibration[4].meanForecast, 0.9);
    expect(l.calibration[1]).toMatchObject({ n: 9 }); close(l.calibration[1].rate, 0); close(l.calibration[1].meanForecast, 0.4);
  });

  it('with the 20th the skill appears: 1 - mean Brier over the mean Brier of the baseline on the same tasks; bins under 5 forecasts show no rate; a per-class row exists', async () => {
    const id = await w.task(); await brief(id, w.mShared, 'research', 3, '4 days'); await fc(id, zedId, 0.4, '3 days'); await review(id, w.mShared, 'rejected', '1 day');
    for (let i = 0; i < 3; i++) { const t2 = await w.task(); await fc(t2, zedId, 0.5, '3 days'); await review(t2, w.mShared, 'accepted', '1 day'); } // no brief: no class, no baseline
    const l = await mine(w.ben);
    expect(l.skill).toMatchObject({ state: 'ok', n: 20, needed: 20 });
    const f = (10 * 0.01 + 10 * 0.16) / 20, b = (10 * (1 / 9) + 10 * (4 / 9)) / 20;
    close(l.skill.meanBrier, f); close(l.skill.baselineBrier, b); close(l.skill.skill, 1 - f / b);
    expect(l.counts.resolved).toBe(23);
    expect(l.calibration[2]).toMatchObject({ n: 3, rate: null, meanForecast: null });
    const row = l.byClass.find((c: any) => c.classId === 'research');
    expect(row).toMatchObject({ n: 20, label: 'Finding things out' }); close(row.meanBrier, f);
    close(row.meanLogLoss, (10 * -Math.log(0.9) + 10 * -Math.log(0.6)) / 20);
  });

  it('a person sees only their own record; an administrator reads one person at a time; a member may not; an unknown person is 404', async () => {
    expect((await mine(w.amy)).forecasts.every((x: any) => x.taskId !== undefined)).toBe(true);
    expect((await mine(w.amy)).forecaster).toEqual({ id: w.amyId, name: 'Amy' });
    const a = await w.admin.req('GET', `/users/${zedId}/forecasts`);
    expect(a.status).toBe(200); expect(a.body.forecaster).toEqual({ id: zedId, name: 'Ben' }); expect(a.body.counts.resolved).toBe(23);
    expect((await w.zed.req('GET', `/users/${zedId}/forecasts`)).status).toBe(403);
    expect((await w.admin.req('GET', `/users/U-nobody/forecasts`)).status).toBe(404);
  });

  it('a forecast on a mission the person can no longer see leaves their record', async () => {
    const id = await w.task(); await forecast(w.ben, id, 0.5);
    expect((await mine(w.ben)).forecasts.some((x: any) => x.taskId === id)).toBe(true);
    await w.q(`update missions set shared=false where id=$1`, [w.mShared]);
    try { expect((await mine(w.ben)).forecasts.length).toBe(0); } finally { await w.q(`update missions set shared=true where id=$1`, [w.mShared]); }
  });

  it('no route lists forecasters: exactly one record route, one of your own, one per person', () => {
    const routes = [...new Set(w.t.app.routeTable.filter((r) => /forecast/.test(r.url) && r.method !== 'HEAD').map((r) => `${r.method} ${r.url.replace('/api/v1', '')}`))].sort();
    expect(routes).toEqual(['GET /me/forecasts', 'GET /users/:id/forecasts', 'POST /tasks/:id/forecasts']);
  });
});

describe('the baseline is computed per viewer, over the missions that viewer can see (no leak of private outcomes)', () => {
  const cell = async (verdicts: string[], mission: string) => { for (const v of verdicts) { const id = await w.task(mission); await brief(id, mission, 'planning', 2, '11 days'); await review(id, mission, v, '10 days'); } };
  const baselineOf = async (viewer: 'amy' | 'admin', taskId: string) => {
    const b = viewer === 'amy' ? await w.amy.req('GET', '/me/forecasts') : await w.admin.req('GET', `/users/${w.amyId}/forecasts`);
    return b.body.forecasts.find((x: any) => x.taskId === taskId).baseline;
  };
  it('a member gets the same n and rate whether a hidden task in the cell is accepted, rejected or absent; an administrator gets it counted', async () => {
    await cell(['accepted', 'accepted', 'accepted', 'rejected', 'rejected'], w.mShared); // 5 visible: n 5, rate 0.6
    const f = await w.task(); await brief(f, w.mShared, 'planning', 2, '4 days'); await fc(f, w.amyId, 0.5, '3 days'); await review(f, w.mShared, 'accepted', '1 day');
    const absent = await baselineOf('amy', f);
    expect(absent).toMatchObject({ n: 5 }); close(absent.rate, 0.6);
    await cell(['accepted'], w.mPrivate);
    expect(await baselineOf('amy', f)).toEqual(absent);
    const adminSees1 = await baselineOf('admin', f);
    expect(adminSees1.n).toBe(6); close(adminSees1.rate, 4 / 6);
    await cell(['rejected'], w.mPrivate);
    expect(await baselineOf('amy', f)).toEqual(absent);
    expect((await baselineOf('admin', f)).n).toBe(7);
  });
  it('method text says so', () => { expect(FORECAST_METHOD).toMatch(/per viewer/i); });
});
