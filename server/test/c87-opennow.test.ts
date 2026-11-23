import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { addAgent, decided, addApproval, addTask, type Fx } from './c65-fixtures.ts';

/** c87: the item-counting figures of the data check (littles.openNow, avgOpen, lambdaTimesW) follow the c58 floor for a member (c65-brief.md item 5). */
let t: TestApp; let f: Fx; let A: Awaited<ReturnType<typeof withAdmin>>; let M: { b: any; id: string };
const HOUR = 3_600_000;
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  A = await withAdmin(t.app); M = await A.member('Mina');
  f = { pool: t.pool, mission: (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'c87' + Date.now() })).body.mission.id as string };
  await addAgent(f, 'c65-ops-1', 'Operations');
});
afterEach(async () => { await t.close(); });
const seed = async (people: string[], n: number, prefix: string) => { for (let i = 0; i < n; i++) await decided(f, prefix + i, 'c65-ops-1', 5 * HOUR, (i + 1) * 60_000, people[i % people.length]); };
const littles = async (who: any) => (await who.req('GET', '/review-capacity')).body.review.littles;

describe('c87: littles figures under the c58 floor', () => {
  it('below the floor a member gets null openNow, avgOpen and lambdaTimesW, an administrator keeps the numbers', async () => {
    await seed([A.adminId, M.id, 'u-third'], 3, 'F');
    await addApproval(f, 'OPEN1', 'c65-ops-1', 2 * HOUR); // one item waiting now (4 items, under 5)
    const m = await littles(M.b), a = await littles(A.admin);
    expect(m.openNow).toBeNull(); expect(m.avgOpen).toBeNull(); expect(m.lambdaTimesW).toBeNull(); expect(m.missingClose).toBeNull(); expect(m.missingOpen).toBeNull();
    expect(a.openNow).toBe(1); expect(a.missingClose).toBe(0); expect(a.avgOpen).not.toBeNull();
  });
  it('at the floor (5 items, 3 people) a member gets the numbers', async () => {
    await seed([A.adminId, M.id, 'u-third'], 6, 'G');
    await addApproval(f, 'OPEN2', 'c65-ops-1', 2 * HOUR);
    const m = await littles(M.b);
    expect(m.openNow).toBe(1); expect(m.avgOpen).not.toBeNull();
  });
  it('a hidden waiting item does not move what a member sees', async () => {
    await seed([A.adminId, M.id, 'u-third'], 3, 'H');
    const before = await littles(M.b);
    await addApproval(f, 'OPEN3', 'c65-ops-1', 2 * HOUR);
    expect(await littles(M.b)).toEqual(before);
  });
  it('a lost record of a hidden task: a member below the floor gets the status but no count, an administrator the count', async () => {
    await seed([A.adminId, M.id, 'u-third'], 3, 'L');
    await addTask(f, 'NOEV', 'c65-ops-1', 'waiting_user'); // waiting with no event that started the wait
    const m = await littles(M.b), a = await littles(A.admin);
    expect(m.status).toBe('fail'); expect(m.missingOpen).toBeNull(); expect(m.missingClose).toBeNull();
    expect(a.status).toBe('fail'); expect(a.missingOpen).toBe(1);
  });
});
