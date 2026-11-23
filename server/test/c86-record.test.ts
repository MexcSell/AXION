import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeWorld, forecast, key, type World } from './c86-fixtures.ts';
import { tx } from '../src/db.ts';
import { taskReviewLock } from '../src/locks.ts';

// c86 item 1: recording a forecast. RED first: the route, the table and the lock do not exist yet.
let w: World;
beforeAll(async () => { w = await makeWorld(); }, 60_000);
afterAll(async () => { await w?.t.close(); });

describe('POST /tasks/:id/forecasts', () => {
  it('records a probability with two decimals for the signed-in person; made_at is the database clock; the write is audited', async () => {
    const id = await w.task();
    const before = (await w.q(`select clock_timestamp() as t`))[0].t as Date;
    const r = await forecast(w.zed, id, 0.35);
    const after = (await w.q(`select clock_timestamp() as t`))[0].t as Date;
    expect(r.status).toBe(201);
    expect(r.body.forecast).toMatchObject({ taskId: id, missionId: w.mShared, probability: 0.35, state: 'open', accepted: null, brier: null, logLoss: null });
    const [row] = await w.q(`select * from forecasts where task_id=$1`, [id]);
    expect(row).toMatchObject({ forecaster_id: w.zedId, question: 'first_review_accepted', tenant_id: 't-1', mission_id: w.mShared });
    expect(Number(row.probability)).toBe(0.35);
    expect(row.made_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(row.made_at.getTime()).toBeLessThanOrEqual(after.getTime());
    const a = await w.q(`select actor, detail from audit_events where action='forecast.record' and subject=$1`, [id]);
    expect(a).toHaveLength(1);
    expect(a[0].actor).toBe(w.zedId);
    expect(a[0].detail).toMatchObject({ probability: 0.35, forecastId: r.body.forecast.id });
  });

  it('the client cannot set the time, the forecaster or the outcome: unknown keys are refused', async () => {
    const id = await w.task();
    for (const extra of [{ madeAt: '2020-01-01T00:00:00Z' }, { forecasterId: w.amyId }, { outcome: true }]) {
      const r = await w.zed.req('POST', `/tasks/${id}/forecasts`, { probability: 0.5, ...extra }, key());
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    expect((await w.q(`select count(*)::int n from forecasts where task_id=$1`, [id]))[0].n).toBe(0);
  });

  it('only 0.01 to 0.99 in two decimals is accepted', async () => {
    const id = await w.task();
    for (const p of [0, 1, 0.005, 0.355, 1.5, -0.2, '0.5', null, 'x']) {
      const r = await forecast(w.zed, id, p);
      expect(r.status, String(p)).toBe(400);
      expect(r.body.code).toBe('VALIDATION');
    }
    expect((await w.q(`select count(*)::int n from forecasts where task_id=$1`, [id]))[0].n).toBe(0);
    for (const p of [0.01, 0.99]) { const t2 = await w.task(); expect((await forecast(w.zed, t2, p)).status).toBe(201); }
  });

  it('one forecast per person per task: the second is 409 and never overwrites the first; another person may still forecast', async () => {
    const id = await w.task();
    expect((await forecast(w.zed, id, 0.8)).status).toBe(201);
    const again = await forecast(w.zed, id, 0.1);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONFLICT');
    const [row] = await w.q(`select probability from forecasts where task_id=$1 and forecaster_id=$2`, [id, w.zedId]);
    expect(Number(row.probability)).toBe(0.8);
    expect((await forecast(w.amy, id, 0.2)).status).toBe(201);
    expect((await w.q(`select count(*)::int n from forecasts where task_id=$1`, [id]))[0].n).toBe(2);
  });

  it('an idempotent replay with the same key returns the stored answer and writes nothing more', async () => {
    const id = await w.task();
    const k = key();
    const a = await w.zed.req('POST', `/tasks/${id}/forecasts`, { probability: 0.6 }, k);
    const b = await w.zed.req('POST', `/tasks/${id}/forecasts`, { probability: 0.6 }, k);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body).toEqual(a.body);
    expect((await w.q(`select count(*)::int n from forecasts where task_id=$1`, [id]))[0].n).toBe(1);
  });

  it('refused once the task has a review (409), and nothing is stored', async () => {
    const id = await w.task();
    expect((await w.review(id)).status).toBe(201);
    const r = await forecast(w.zed, id, 0.9);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONFLICT');
    expect((await w.q(`select count(*)::int n from forecasts where task_id=$1`, [id]))[0].n).toBe(0);
  });

  it('refused for a canceled task, and for a task the person cannot see (404, before any other answer)', async () => {
    const c = await w.task(w.mShared, { status: 'canceled' });
    expect((await forecast(w.zed, c, 0.5)).status).toBe(409);
    const hidden = await w.task(w.mPrivate);
    expect((await forecast(w.zed, hidden, 0.5)).status).toBe(404);
    expect((await forecast(w.zed, 'T-nope', 0.5)).status).toBe(404);
    expect((await forecast(w.admin, hidden, 0.5)).status).toBe(201); // an administrator sees every mission
  });

  it('race: a forecast and the first review sent together either lands before the review or is refused with 409 (never a row that the review did not wait for)', async () => {
    for (let i = 0; i < 12; i++) {
      const id = await w.task();
      const [f, r] = await Promise.all([forecast(w.zed, id, 0.7), w.review(id)]);
      expect(r.status).toBe(201);
      expect([201, 409]).toContain(f.status);
      const rows = await w.q(`select f.made_at, (select created_at from task_reviews r where r.task_id=f.task_id order by r.seq limit 1) as first_at from forecasts f where f.task_id=$1`, [id]);
      expect(rows.length).toBe(f.status === 201 ? 1 : 0);
    }
  }, 60_000);

  it('race, forced order: a review that holds the task lock and commits first makes the waiting forecast a 409 (lock + same-statement check)', async () => {
    const id = await w.task();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let locked!: () => void;
    const hasLock = new Promise<void>((res) => { locked = res; });
    const holder = tx(w.t.app.db, async (c) => {
      await taskReviewLock(c, id);
      locked();
      await gate;
      await c.query(
        `insert into task_reviews(id, tenant_id, mission_id, task_id, reviewer_id, reviewer_kind, producer_id, producer_kind, principal_id, rubric, verdict, evidence)
         values ('TR-forced-' || $1::text,'t-1',$2,$1,$3,'user','coder-01','agent',$4,'[{"criterion":"x","result":"pass","note":""}]','rejected','[]')`, [id, w.mShared, w.benId, w.miaId]);
    });
    await hasLock;
    const pending = forecast(w.zed, id, 0.9);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await holder;
    const r = await pending;
    expect(r.status).toBe(409);
    expect((await w.q(`select count(*)::int n from forecasts where task_id=$1`, [id]))[0].n).toBe(0);
  }, 30_000);

  it('the table is append-only: UPDATE, DELETE and TRUNCATE are refused even in SQL', async () => {
    const id = await w.task();
    await forecast(w.zed, id, 0.4);
    await expect(w.t.pool.query(`update forecasts set probability = 0.99 where task_id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(w.t.pool.query(`delete from forecasts where task_id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(w.t.pool.query(`truncate forecasts`)).rejects.toThrow(/append-only/);
    expect(Number((await w.q(`select probability from forecasts where task_id=$1`, [id]))[0].probability)).toBe(0.4);
  });
});
