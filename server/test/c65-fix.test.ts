// c65 fix round: F1 (Little check never alarms on healthy data), F2 (missing_open), F3 (privacy floor), F5 (c54 department rule), minors.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { reviewCapacity } from '../src/capacity/model.ts';
import { littlesLaw } from '../src/capacity/littles.ts';
import { DAY, addAgent, addApproval, addDecision, decided, addTask, addStateEvent, type Fx } from './c65-fixtures.ts';

const HOUR = 3_600_000;
let t: TestApp; let f: Fx; let A: Awaited<ReturnType<typeof withAdmin>>; let M: { b: any; id: string };
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  A = await withAdmin(t.app); M = await A.member('Mina');
  f = { pool: t.pool, mission: (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'c65x' + Date.now() })).body.mission.id as string };
  await addAgent(f, 'c65-ops-1', 'Operations'); await addAgent(f, 'c65-fin-1', 'Finance');
});
afterEach(async () => { await t.close(); });
const cap = (w = 7, admin = true) => reviewCapacity(t.app.db, 't-1', w, admin);

describe('F1: the Little check never alarms on healthy data', () => {
  it('REVIEWER PROBE: 10 approvals decided within 2 days plus one pending since 10 days ago, window 7, raises no alert', async () => {
    for (let i = 0; i < 10; i++) await decided(f, 'H' + i, 'c65-ops-1', 2 * DAY - i * HOUR, HOUR);
    await addApproval(f, 'old', 'c65-ops-1', 10 * DAY, { expiresInMs: 30 * DAY });
    const l = (await cap(7)).littles;
    expect(l.status).not.toBe('fail'); expect(l.reason).not.toBe('mismatch');
  });
  it('healthy data passes for every window length and every carry-in (no tolerance to tune)', async () => {
    for (let i = 0; i < 6; i++) await decided(f, 'W' + i, 'c65-ops-1', 80 * DAY - i * HOUR, 30 * DAY); // long waits that straddle every window edge
    for (let i = 0; i < 6; i++) await addApproval(f, 'P' + i, 'c65-ops-1', (3 + i * 20) * DAY, { expiresInMs: 90 * DAY });
    for (const w of [7, 30, 90]) { const l = (await cap(w)).littles; expect(l.status, 'window ' + w).not.toBe('fail'); }
  });
  it('the pure check has no tolerance: only lost records can fail it', () => {
    const l = littlesLaw({ arrivals: 3, sumTisMs: 1, sumOverlapMs: 99 * DAY, windowMs: 7 * DAY, missingClose: 0, missingOpen: 0, openNow: 1 } as any);
    expect(l.status).toBe('pass'); expect('relTol' in l).toBe(false); expect('absTol' in l).toBe(false);
  });
});

describe('F2: a task waiting for a person with no entering event is flagged missing_open', () => {
  it('reviewer probe: waiting_user task with no events gives a fail with reason missing_open', async () => {
    await addTask(f, 'NOEV', 'c65-ops-1', 'waiting_user');
    const l = (await cap(30)).littles;
    expect(l.status).toBe('fail'); expect(l.reason).toBe('missing_open'); expect((l as any).missingOpen).toBe(1);
  });
  it('a waiting_user task that has its entering event is fine; a simulated one with no event is not flagged', async () => {
    await addTask(f, 'OK1', 'c65-ops-1', 'waiting_user'); await addStateEvent(f, 'OK1', 'running', 'waiting_user', HOUR);
    await addTask(f, 'SIM', 'c65-ops-1', 'waiting_user'); await t.pool.query(`update tasks set simulated = true where id = 'SIM'`);
    const l = (await cap(30)).littles; expect(l.status).not.toBe('fail'); expect((l as any).missingOpen).toBe(0);
  });
  it('missing_close still wins and stays an alert', async () => {
    await addApproval(f, 'lost', 'c65-ops-1', 4 * HOUR, { state: 'approved' });
    expect((await cap(30)).littles.reason).toBe('missing_close');
  });
});

describe('F3: the privacy floor hides people and decided, and span open items', () => {
  const seedSole = async () => { for (let i = 0; i < 10; i++) await decided(f, 'S' + i, 'c65-ops-1', 5 * HOUR, (i + 1) * 60_000, A.adminId); };
  it('REVIEWER PROBE: a member below the floor gets null decided and null people (a sole decider is not revealed); n stays', async () => {
    await seedSole();
    const c = (await M.b.req('GET', '/review-capacity?windowDays=7')).body.review.total;
    expect(c.shown).toBe(false); expect(c.n).toBe(10); expect(c.decided).toBeNull(); expect(c.people).toBeNull();
    const d = (await M.b.req('GET', '/review-capacity?windowDays=7')).body.review.departments[0];
    expect(d.decided).toBeNull(); expect(d.people).toBeNull();
    const a = (await cap(7, true)).total; expect(a.decided).toBe(10); expect(a.people).toBe(1); // administrators keep them
  });
  it('a member cannot recover a suppressed backlog by summing span rows', async () => {
    await addAgent(f, 'c65-sup', 'Operations');
    const seq = Number((await t.pool.query(`select coalesce(max(seq),0)+1 as n from org_revisions where tenant_id='t-1'`)).rows[0].n);
    const rev = (await t.pool.query(`insert into org_revisions(tenant_id, seq, note, created_by) values ('t-1',$1,'c65','test') returning id`, [seq])).rows[0].id;
    await t.pool.query(`insert into org_edges(revision_id, supervisor_id, subordinate_id) values ($1,'c65-sup','c65-ops-1')`, [rev]);
    for (let i = 0; i < 4; i++) await addApproval(f, 'B' + i, 'c65-ops-1', HOUR, { expiresInMs: 5 * DAY }); // 4 open items: under the floor of 5
    const r = (await M.b.req('GET', '/review-capacity?windowDays=7')).body.review;
    expect(r.total.openBacklog).toBeNull();
    const row = r.span.rows.find((s: any) => s.supervisorId === 'c65-sup');
    expect(row, 'span row present').toBeTruthy(); expect(row.openItems).toBeNull();
    expect((await cap(7, true)).span.rows.find((s) => s.supervisorId === 'c65-sup')!.openItems).toBe(4);
  });
});

describe('F5: the c54 department rule (owner instance first) and simulated tasks excluded', () => {
  it('a task owned through an instance belongs to the instance agent department (owner_agent is only the fallback)', async () => {
    const dept = (await t.pool.query(`select dept from agent_definitions where id='coder-01'`)).rows[0].dept as string;
    await t.pool.query(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id) select 'I-c',$1,$2,d.id,d.active_version_id from agent_definitions d where d.id='coder-01'`, ['t-1', f.mission]);
    await addTask(f, 'INST', 'c65-ops-1', 'waiting_user'); await t.pool.query(`update tasks set owner_instance_id='I-c' where id='INST'`);
    await addStateEvent(f, 'INST', 'running', 'waiting_user', HOUR);
    const r = await cap(7);
    expect(r.departments.find((d) => d.dept === dept)?.n).toBe(1); expect(r.departments.find((d) => d.dept === 'Operations')).toBeUndefined();
  });
  it('a simulated task waiting for a person is not counted', async () => {
    await addTask(f, 'SIMW', 'c65-ops-1', 'waiting_user'); await t.pool.query(`update tasks set simulated = true where id = 'SIMW'`);
    await addStateEvent(f, 'SIMW', 'running', 'waiting_user', HOUR);
    const r = await cap(7); expect(r.total.n).toBe(0); expect(r.total.openBacklog).toBe(0);
  });
});

describe('minors', () => {
  it('pre-c58 decisions with null latency are excluded from decided, as from the percentiles', async () => {
    for (let i = 0; i < 25; i++) { await addApproval(f, 'L' + i, 'c65-ops-1', 5 * HOUR, { state: 'approved' }); await t.pool.query(`insert into approval_decisions(approval_id, decision, reason, digest, decided_by, decided_at, latency_ms, queue_size, fast_bulk) values ($1,'approved','','d','u-a', now() - interval '1 hour', null, null, false)`, ['L' + i]); }
    const c = (await cap(7)).total; expect(c.n).toBe(25); expect(c.decided).toBe(0); expect(c.p50Ms).toBeNull();
  });
  it('windowStart comes from the same statement as the data', async () => {
    const a = await cap(7); expect(Math.abs(Date.parse(a.windowStart) - (Date.now() - 7 * DAY))).toBeLessThan(10_000);
  });
});
