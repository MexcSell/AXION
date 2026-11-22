import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { reviewCapacity } from '../src/capacity/model.ts';
import { littlesLaw, assertLittle, LittleLawError, LITTLE_REL_TOL, LITTLE_ABS_TOL } from '../src/capacity/littles.ts';
import { DAY, addAgent, addApproval, decided, type Fx } from './c65-fixtures.ts';

const HOUR = 3_600_000;
describe('c65 item 2: Little\'s law, pure', () => {
  const T = 30 * DAY;
  it('a steady system (one arrival an hour, three hours in the system) passes: L = 3 = lambda x W', () => {
    // 720 arrivals, each 3 h in the system; the average number in the system over the window is 3 (the boundary adds a small carry-in)
    const r = littlesLaw({ arrivals: 720, sumTisMs: 720 * 3 * HOUR, sumOverlapMs: 720 * 3 * HOUR + 3 * 3 * HOUR / 2, windowMs: T, missingClose: 0, openNow: 3 });
    expect(r.status).toBe('pass'); expect(r.lambdaTimesW).toBeCloseTo(3, 9);
  });
  it('the tolerance is stated: relative and absolute, and a gap above it fails as a mismatch', () => {
    expect(LITTLE_REL_TOL).toBe(0.15); expect(LITTLE_ABS_TOL).toBe(0.25);
    const bad = littlesLaw({ arrivals: 720, sumTisMs: 720 * 3 * HOUR, sumOverlapMs: 720 * 5 * HOUR, windowMs: T, missingClose: 0, openNow: 5 });
    expect(bad.status).toBe('fail'); expect(bad.reason).toBe('mismatch');
    const near = littlesLaw({ arrivals: 720, sumTisMs: 720 * 3 * HOUR, sumOverlapMs: 720 * 3.3 * HOUR, windowMs: T, missingClose: 0, openNow: 3 }); // 9% off
    expect(near.status).toBe('pass');
  });
  it('a missing close event fails LOUDLY (a thrown LittleLawError), even when the averages happen to agree', () => {
    const r = littlesLaw({ arrivals: 10, sumTisMs: 10 * HOUR, sumOverlapMs: 10 * HOUR, windowMs: T, missingClose: 1, openNow: 0 });
    expect(r.status).toBe('fail'); expect(r.reason).toBe('missing_close');
    expect(() => assertLittle(r)).toThrow(LittleLawError);
    expect(() => assertLittle(r)).toThrow(/missing_close.*1 item/);
  });
  it('no arrivals: nothing to compare (insufficient), not a pass and not a failure', () => {
    const r = littlesLaw({ arrivals: 0, sumTisMs: 0, sumOverlapMs: 0, windowMs: T, missingClose: 0, openNow: 0 });
    expect(r.status).toBe('insufficient'); expect(() => assertLittle(r)).not.toThrow();
  });
});

let t: TestApp; let f: Fx;
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  const A = await withAdmin(t.app);
  f = { pool: t.pool, mission: (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'c65l' + Date.now() })).body.mission.id as string };
  await addAgent(f, 'c65-ops-1', 'Operations');
});
afterEach(async () => { await t.close(); });

describe('c65 item 2: Little\'s law on the real rows', () => {
  it('FIXTURE WITH A MISSING CLOSE EVENT: an approval that says "approved" but has no decision row makes the check fail loudly', async () => {
    for (let i = 0; i < 5; i++) await decided(f, 'ok' + i, 'c65-ops-1', 5 * HOUR, HOUR);
    expect((await reviewCapacity(t.app.db, 't-1', 30, true)).littles.status).toBe('pass');
    await addApproval(f, 'lost', 'c65-ops-1', 4 * HOUR, { state: 'approved' }); // closed state, no close record
    const r = (await reviewCapacity(t.app.db, 't-1', 30, true)).littles;
    expect(r.status).toBe('fail'); expect(r.reason).toBe('missing_close'); expect(r.missingClose).toBe(1);
    expect(() => assertLittle(r)).toThrow(LittleLawError);
  });
  it('a task wait whose task has moved on with no event out of waiting_user is a missing close too', async () => {
    const { addTask, addStateEvent } = await import('./c65-fixtures.ts');
    await addTask(f, 'T1', 'c65-ops-1', 'running'); await addStateEvent(f, 'T1', 'running', 'waiting_user', HOUR); // no event back, yet the task is running
    const r = (await reviewCapacity(t.app.db, 't-1', 30, true)).littles;
    expect(r.status).toBe('fail'); expect(r.missingClose).toBe(1);
  });
  it('SEEDED ARRIVAL SIMULATION: rate, median, p95 and Little\'s law match an independent reference calculation', async () => {
    // Deterministic generator (mulberry32). Arrivals: about 2 an hour for 40 days (the first 10 days are carry-in before the 30-day window),
    // time to decision exponential with mean 4 hours. An item whose decision would fall in the future is still open.
    let s = 20261122; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const rows: { id: string; ago: number; lat: number | null }[] = [];
    for (let ago = 40 * DAY, i = 0; ago > 2 * 60_000; i++) { ago -= Math.round(-Math.log(1 - rnd()) * 30 * 60_000) + 1; if (ago <= 2 * 60_000) break; const lat = Math.round(-Math.log(1 - rnd()) * 4 * HOUR); rows.push({ id: 'S' + i, ago, lat: lat < ago - 60_000 ? lat : null }); }
    const dec = rows.filter((r) => r.lat !== null), open = rows.filter((r) => r.lat === null);
    await t.pool.query(`insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, digest_version, state, created_at, expires_at)
      select x.id, 't-1', $1, 'c65-ops-1', 'submit_form', 'T', 'R2', 'x', 2, case when x.lat is null then 'pending' else 'approved' end, now() - (x.ago || ' milliseconds')::interval, now() + interval '30 days'
        from unnest($2::text[], $3::bigint[], $4::bigint[]) as x(id, ago, lat)`, [f.mission, rows.map((r) => r.id), rows.map((r) => r.ago), rows.map((r) => r.lat)]);
    await t.pool.query(`insert into approval_decisions(approval_id, decision, reason, digest, decided_by, decided_at, latency_ms, queue_size, fast_bulk)
      select x.id, 'approved', '', 'd', 'u-a', now() - ((x.ago - x.lat) || ' milliseconds')::interval, x.lat, 1, false from unnest($1::text[], $2::bigint[], $3::bigint[]) as x(id, ago, lat)`,
      [dec.map((r) => r.id), dec.map((r) => r.ago), dec.map((r) => r.lat)]);
    const W = 30 * DAY;
    const got = await reviewCapacity(t.app.db, 't-1', 30, true);
    // reference, from the same arrays, in plain JS (times are ms before "now"; the test and the query run seconds apart, so every bound is checked with that slack)
    const inWin = rows.filter((r) => r.ago <= W); // a row near the edge could flip: none sits within a minute of it (checked below)
    expect(rows.filter((r) => Math.abs(r.ago - W) < 60_000).length).toBe(0);
    const lats = inWin.filter((r) => r.lat !== null).map((r) => r.lat as number).sort((a, b) => a - b);
    const pct = (q: number) => { const k = (lats.length - 1) * q, lo = Math.floor(k), hi = Math.ceil(k); return lats[lo] + (lats[hi] - lats[lo]) * (k - lo); };
    const TOL_RATE = 1e-9, TOL_MS = 1; // the same numbers, so the rate is exact; percentile_cont and the reference interpolate identically (rounded to a whole ms)
    expect(rows.filter((r) => Math.abs(r.ago - W) < 60_000).length, 'a row sits at the window edge: change the seed').toBe(0);
    expect(got.total.n).toBe(inWin.length);
    expect(Math.abs(got.total.arrivalPerDay! - inWin.length / 30)).toBeLessThan(TOL_RATE);
    expect(got.total.decided).toBe(lats.length); expect(lats.length).toBeGreaterThan(20);
    expect(Math.abs(got.total.p50Ms! - pct(0.5))).toBeLessThanOrEqual(TOL_MS);
    expect(Math.abs(got.total.p95Ms! - pct(0.95))).toBeLessThanOrEqual(TOL_MS);
    expect(got.total.openBacklog).toBe(open.length);
    // Little's law: the reference L and W come from the arrays; the stated tolerance applies between L and lambda x W
    const refL = rows.reduce((a, r) => a + Math.max(0, Math.min(r.lat === null ? r.ago : r.lat, r.ago) - Math.max(0, r.ago - W)) , 0) / W;
    const refLW = inWin.reduce((a, r) => a + (r.lat === null ? r.ago : r.lat), 0) / W;
    expect(Math.abs(got.littles.avgOpen! - refL) / refL).toBeLessThan(0.01);
    expect(Math.abs(got.littles.lambdaTimesW! - refLW) / refLW).toBeLessThan(0.01);
    expect(got.littles.status).toBe('pass');
    expect(Math.abs(refL - refLW)).toBeLessThanOrEqual(Math.max(LITTLE_ABS_TOL, LITTLE_REL_TOL * Math.max(refL, refLW))); // the reference itself is inside the tolerance
    expect(refL).toBeGreaterThan(5); expect(refL).toBeLessThan(11); // about 2 an hour x 4 hours = 8 in the system
  });
});
