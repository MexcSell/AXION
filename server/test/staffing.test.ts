import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { buildApp } from '../src/app.ts';
import { TEST_DB } from './helpers.ts';

let t: TestApp;
afterEach(async () => { await t.close(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;

async function waitStage(get: () => Promise<any>, pred: (m: any) => boolean, ms = 5000) {
  const t0 = Date.now();
  for (;;) { const m = await get(); if (pred(m)) return m; if (Date.now() - t0 > ms) return m; await sleep(40); }
}

describe('simulated staffing (server-side)', () => {
  it('moves reading → appointing → recruiting → working, then planning → running, with ordered simulated events', async () => {
    t = await makeTestApp({ staffingStepMs: 40 });
    const A = await withAdmin(t.app);
    const m = (await A.admin.req('POST', '/missions', { text: 'Research competitor pricing.', files: [], shared: false }, { 'idempotency-key': 'a' + n++ })).body.mission;
    const get = async () => (await A.admin.req('GET', `/missions/${m.id}`)).body.mission;
    const done = await waitStage(get, (x) => x.staffing.stage === 'working');
    expect(done.staffing.stage).toBe('working');
    expect(done.status).toBe('running');
    expect(done.agentIds).toEqual(expect.arrayContaining(['gm', 'researcher-01', ...done.staffing.plan.map((p: any) => p.agentId)]));
    const ev = (await t.pool.query(`select type, seq, payload from events where mission_id=$1 order by id`, [m.id])).rows;
    const steps = ev.filter((e) => e.type === 'staffing.progressed');
    expect(steps.length).toBe(done.staffing.plan.length + 2);
    expect(steps.every((e) => e.payload.simulated === true)).toBe(true);
    expect(steps.map((e) => e.payload.stage)).toEqual(['appointing', ...done.staffing.plan.map(() => 'recruiting'), 'working']);
    expect(ev.map((e) => e.seq)).toEqual(ev.map((_, i) => i + 1));
    expect(ev.some((e) => e.type === 'mission.stateChanged' && e.payload.to === 'running')).toBe(true);
  });

  it('stops after cancel', async () => {
    t = await makeTestApp({ staffingStepMs: 80 });
    const A = await withAdmin(t.app);
    const m = (await A.admin.req('POST', '/missions', { text: 'Build a landing page with a signup form.', files: [], shared: false }, { 'idempotency-key': 'b' + n++ })).body.mission;
    await A.admin.req('POST', `/missions/${m.id}/actions/cancel`, {}, { 'idempotency-key': 'c' + n++ });
    const count = async () => (await t.pool.query(`select count(*)::int n from events where mission_id=$1 and type='staffing.progressed'`, [m.id])).rows[0].n;
    const c1 = await count();
    await sleep(400);
    expect(await count()).toBe(c1);
    expect((await A.admin.req('GET', `/missions/${m.id}`)).body.mission.status).toBe('canceled');
  });

  it('pauses and resumes', async () => {
    t = await makeTestApp({ staffingStepMs: 60 });
    const A = await withAdmin(t.app);
    const m = (await A.admin.req('POST', '/missions', { text: 'Clean the catalog data and migrate it.', files: [], shared: false }, { 'idempotency-key': 'd' + n++ })).body.mission;
    await A.admin.req('POST', `/missions/${m.id}/actions/pause`, {}, { 'idempotency-key': 'e' + n++ });
    const get = async () => (await A.admin.req('GET', `/missions/${m.id}`)).body.mission;
    const before = (await get()).staffing.joined;
    await sleep(300);
    expect((await get()).staffing.joined).toBe(before);
    await A.admin.req('POST', `/missions/${m.id}/actions/resume`, {}, { 'idempotency-key': 'f' + n++ });
    const done = await waitStage(get, (x) => x.staffing.stage === 'working');
    expect(done.staffing.stage).toBe('working');
  });

  it('a restarted server resumes unfinished staffing', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000 });
    const A = await withAdmin(t.app);
    const m = (await A.admin.req('POST', '/missions', { text: 'Research the market.', files: [], shared: false }, { 'idempotency-key': 'g' + n++ })).body.mission;
    const app2 = await buildApp({ databaseUrl: TEST_DB(), schema: t.schema, logger: false, staffingStepMs: 40 });
    const t0 = Date.now();
    let stage = '';
    while (Date.now() - t0 < 5000) { stage = (await t.pool.query(`select presentation->'staffing'->>'stage' s from missions where id=$1`, [m.id])).rows[0].s; if (stage === 'working') break; await sleep(50); }
    await app2.close();
    expect(stage).toBe('working');
  });
});
