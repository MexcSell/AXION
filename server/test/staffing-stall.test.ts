import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, TEST_DB, type TestApp } from './helpers.ts';
import { buildApp } from '../src/app.ts';

let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'stall-' + Date.now() + '-' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const until = async (f: () => Promise<boolean>, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

describe('staffing give-up is visible, retryable and not silent (c42 fix round 2)', () => {
  it('13 failures: audit row, mission event, stalled state on the mission; Retry resumes and clears it', async () => {
    t = await makeTestApp({ staffingStepMs: 1 });
    const A = await withAdmin(t.app);
    // every instance insert fails, so every staffing step fails
    await t.pool.query(`create function stall_boom() returns trigger language plpgsql as $$ begin raise exception 'forced staffing failure'; end $$`);
    await t.pool.query(`create trigger stall_boom before insert on agent_instances for each row execute function stall_boom()`);
    const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: true }, key())).body.mission.id as string;
    const get = async () => (await A.admin.req('GET', `/missions/${m}`)).body.mission;
    expect(await until(async () => !!(await get()).staffing?.stalled)).toBe(true);
    const mis = await get();
    expect(mis.staffing.stage).toBe('reading'); // the stage is untouched
    expect(mis.staffing.stalled.attempts).toBe(13);
    expect(mis.staffing.stalled.reason).toMatch(/13 times/);
    expect(typeof mis.staffing.stalled.at).toBe('number');
    const au = await rows(`select actor, detail from audit_events where action='staffing.gave_up' and subject=$1`, [m]);
    expect(au.length).toBe(1); expect(au[0].detail.code).toBeTruthy(); expect(au[0].detail.attempts).toBe(13);
    const ev = await rows(`select audience, payload from events where type='staffing.stalled' and mission_id=$1`, [m]);
    expect(ev.length).toBe(1); expect(ev[0].audience).toBe('mission'); expect(ev[0].payload.reason).toMatch(/13 times/);

    // a restart does not revive it by itself: a second server on the same database, with the cause gone, leaves it stalled
    await t.pool.query(`drop trigger stall_boom on agent_instances`);
    const app2 = await buildApp({ databaseUrl: TEST_DB(), schema: t.schema, logger: false, staffingStepMs: 1 });
    await new Promise((r) => setTimeout(r, 700));
    await app2.close();
    expect((await get()).staffing.stalled).toBeTruthy();
    expect((await get()).staffing.stage).toBe('reading');

    // Retry: only an admin or the owner; not while it is not stalled
    const carol = await A.member('Carol');
    expect((await carol.b.req('POST', `/missions/${m}/staffing/retry`, {}, key())).status).toBe(403);
    const ok = await A.admin.req('POST', `/missions/${m}/staffing/retry`, {}, key());
    expect(ok.status).toBe(200);
    expect(await until(async () => (await get()).staffing.stage === 'working')).toBe(true);
    expect((await get()).staffing.stalled).toBeUndefined();
    expect((await rows(`select 1 from audit_events where action='staffing.retry' and subject=$1`, [m])).length).toBe(1);
    expect((await rows(`select 1 from events where type='staffing.resumed' and mission_id=$1`, [m])).length).toBe(1);
    expect((await A.admin.req('POST', `/missions/${m}/staffing/retry`, {}, key())).status).toBe(409);
  }, 60_000);
});
