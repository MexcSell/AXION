import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { reviewCapacity, departmentOfAgent, MIN_PERCENTILE_N, DEPARTMENT_RULE } from '../src/capacity/model.ts';
import { DAY, addAgent, addApproval, addDecision, decided, addTask, addStateEvent, type Fx } from './c65-fixtures.ts';

let t: TestApp; let f: Fx;
const HOUR = 3_600_000;
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  const A = await withAdmin(t.app);
  const mission = (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'c65' + Date.now() })).body.mission.id as string;
  f = { pool: t.pool, mission };
  await addAgent(f, 'c65-ops-1', 'Operations'); await addAgent(f, 'c65-ops-2', 'Operations'); await addAgent(f, 'c65-fin-1', 'Finance');
});
afterEach(async () => { await t.close(); });
const cap = (days = 30, admin = true) => reviewCapacity(t.app.db, 't-1', days, admin);
const dept = (r: Awaited<ReturnType<typeof cap>>, name: string) => r.departments.find((d) => d.dept === name)!;

describe('c65 item 1: department mapping rule', () => {
  it('the rule is written down, and an approval belongs to the department of the agent that raised it', async () => {
    expect(DEPARTMENT_RULE).toMatch(/agent that raised/i);
    await addApproval(f, 'A1', 'c65-ops-1', HOUR); await addApproval(f, 'A2', 'c65-fin-1', HOUR);
    const r = await cap();
    expect(dept(r, 'Operations').n).toBe(1); expect(dept(r, 'Finance').n).toBe(1);
    expect(r.total.n).toBe(2);
  });
  it('an agent that is not in the catalogue maps to "Unassigned", never dropped and never guessed', async () => {
    await addApproval(f, 'A1', 'c65-ghost', HOUR);
    expect(dept(await cap(), 'Unassigned').n).toBe(1);
    expect(departmentOfAgent(null)).toBe('Unassigned');
    expect(departmentOfAgent('Finance')).toBe('Finance');
  });
  it('a task waiting for a person belongs to the department of the agent that owns the task', async () => {
    await addTask(f, 'T1', 'c65-fin-1'); await addStateEvent(f, 'T1', 'running', 'waiting_user', 2 * HOUR);
    await addTask(f, 'T2', null); await addStateEvent(f, 'T2', 'running', 'waiting_user', 2 * HOUR);
    const r = await cap();
    expect(dept(r, 'Finance').n).toBe(1); expect(dept(r, 'Unassigned').n).toBe(1);
  });
});

describe('c65 item 1: arrival rate, backlog, time to decision', () => {
  it('arrival rate is arrivals per day over the window; items outside the window and DEMO items are not counted', async () => {
    for (let i = 0; i < 6; i++) await addApproval(f, 'in' + i, 'c65-ops-1', (i + 1) * HOUR);
    await addApproval(f, 'old', 'c65-ops-1', 10 * DAY); await addApproval(f, 'demo', 'c65-ops-1', HOUR, { demo: true });
    const r = await cap(7);
    expect(dept(r, 'Operations').n).toBe(6);
    expect(dept(r, 'Operations').arrivalPerDay).toBeCloseTo(6 / 7, 9);
    expect((await cap(30)).total.n).toBe(7);
  });
  it('open backlog counts pending, unexpired approvals and tasks still waiting; decided and expired ones are closed', async () => {
    await addApproval(f, 'open1', 'c65-ops-1', HOUR); await addApproval(f, 'open2', 'c65-ops-1', HOUR);
    await addApproval(f, 'exp', 'c65-ops-1', 3 * HOUR, { expiresInMs: -HOUR }); // pending but past its expiry: closed by expiry
    await addApproval(f, 'exp2', 'c65-ops-1', 3 * HOUR, { state: 'expired', expiresInMs: -HOUR });
    await decided(f, 'done', 'c65-ops-1', 2 * HOUR, HOUR);
    await addTask(f, 'T1', 'c65-ops-1'); await addStateEvent(f, 'T1', 'running', 'waiting_user', HOUR); // still waiting
    await addTask(f, 'T2', 'c65-ops-1', 'running'); await addStateEvent(f, 'T2', 'running', 'waiting_user', 2 * HOUR); await addStateEvent(f, 'T2', 'waiting_user', 'running', HOUR);
    const o = dept(await cap(), 'Operations');
    expect(o.openBacklog).toBe(3); // open1, open2, T1
    expect(o.n).toBe(7);
  });
  it('time to decision reads c58\'s STORED latency and queue size (a stored value that differs from the timestamps wins)', async () => {
    // 20 decisions: the stored latency is i minutes, while the timestamps say 1 hour. If the model recomputed, the median would be 1 hour.
    for (let i = 1; i <= 20; i++) { await addApproval(f, 'D' + i, 'c65-ops-1', 5 * HOUR, { state: 'approved' }); await addDecision(f, 'D' + i, 'u-a', 4 * HOUR, i * 60_000, i); }
    const o = dept(await cap(), 'Operations');
    expect(o.p50Ms).toBeCloseTo(10.5 * 60_000, 0); // median of 1..20 minutes
    expect(o.p95Ms).toBeCloseTo(19.05 * 60_000, 0); // linear interpolation, as percentile_cont
    expect(o.medianQueueSize).toBe(10.5);
  });
  it('percentiles are null below 20 decided items, numbers from 20, and every cell shows n', async () => {
    expect(MIN_PERCENTILE_N).toBe(20);
    for (let i = 0; i < 19; i++) await decided(f, 'N' + i, 'c65-ops-1', 5 * HOUR, (i + 1) * 60_000);
    let o = dept(await cap(), 'Operations');
    expect(o.decided).toBe(19); expect(o.p50Ms).toBeNull(); expect(o.p95Ms).toBeNull(); expect(o.n).toBe(19);
    await decided(f, 'N19', 'c65-ops-1', 5 * HOUR, 20 * 60_000);
    o = dept(await cap(), 'Operations');
    expect(o.decided).toBe(20); expect(o.p50Ms).not.toBeNull(); expect(o.p95Ms).not.toBeNull();
  });
  it('a task wait is decided when the next state change leaves waiting_user; its time is computed in SQL from the event times', async () => {
    for (let i = 0; i < 20; i++) { await addTask(f, 'W' + i, 'c65-ops-1', 'running'); await addStateEvent(f, 'W' + i, 'running', 'waiting_user', 3 * HOUR); await addStateEvent(f, 'W' + i, 'waiting_user', 'running', 2 * HOUR); }
    const o = dept(await cap(), 'Operations');
    expect(o.decided).toBe(20);
    expect(o.p50Ms).toBeGreaterThan(HOUR - 5000); expect(o.p50Ms).toBeLessThan(HOUR + 5000);
  });
});
