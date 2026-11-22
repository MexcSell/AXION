import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type Browser, type TestApp } from './helpers.ts';

// Improvement cycle 54 (M1c): a dimension cell that counts review verification uses c51's freshness rule, the one the task page
// uses: a review counts only if it is newer than the task's latest attempt (and was written against it). So the scorecard
// dimension and GET /tasks/:id/reviews never disagree about whether a task is verified.
let t: TestApp;
let A: Browser;
let seq = 0;
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);

async function task(id: string, attempts: { startedHoursAgo: number; result: string }[]) {
  await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated, created_at) values ($1,'t-1','M-fresh','T','passed','coder-01','M-fresh:coder-01',false, now() - interval '5 days')`, [id]);
  const ids: number[] = [];
  for (const [i, a] of attempts.entries()) ids.push((await q(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,$2, now() - $3 * interval '1 hour', now() - ($3 - 0.5) * interval '1 hour', $4) returning id`, [id, i + 1, a.startedHoursAgo, a.result])).rows[0].id);
  await q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at) values ('t-1','task.stateChanged','M-fresh',$1,'task',$2,'mission',$3, now() - interval '1 hour')`, [600000 + seq++, id, JSON.stringify({ taskId: id, from: 'running', to: 'passed' })]);
  return ids;
}
/** an accepted review written `agoHours` ago against attempt id `attemptId` */
const review = (id: string, taskId: string, attemptId: number, agoHours: number) => q(
  `insert into task_reviews(id, tenant_id, mission_id, task_id, attempt_id, reviewer_id, reviewer_kind, reviewer_model_family, producer_id, producer_kind, producer_model_family, principal_id, rubric, verdict, evidence, created_at)
   values ($1,'t-1','M-fresh',$2,$3,'rev-x','agent','fam-b','coder-01','agent','fam-a','owner-x','[{"criterion":"c","result":"pass"}]','accepted','[{"kind":"note","id":"n"}]', now() - $4 * interval '1 hour')`, [id, taskId, attemptId, agoHours]);

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  A = w.admin;
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ('M-fresh','t-1',$1,true,'running',false)`, [w.adminId]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ('M-fresh',1,'M-fresh','data','normal','x',$1)`, [w.adminId]);
  await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, simulated) select 'M-fresh:coder-01','t-1','M-fresh',d.id,d.active_version_id,false from agent_definitions d where d.id='coder-01'`);
  // F0, F1: one attempt, a review written after it ended: fresh
  for (const i of [0, 1]) { const [a] = await task(`F${i}`, [{ startedHoursAgo: 10, result: 'passed' }]); await review(`TR-F${i}`, `F${i}`, a, 2); }
  // F2: one attempt, but its review is OLDER than the attempt's start (written against that attempt id, then the attempt was restarted): stale
  { const [a] = await task('F2', [{ startedHoursAgo: 3, result: 'passed' }]); await review('TR-F2', 'F2', a, 6); }
  // R: fail -> retry -> pass, with the old accepted review written against attempt 1
  { const [a1] = await task('R', [{ startedHoursAgo: 20, result: 'failed' }, { startedHoursAgo: 4, result: 'passed' }]); await review('TR-R', 'R', a1, 15); }
});
afterAll(async () => { await t?.close(); });

const cell = (body: any, key: string) => body.dimensions.flatMap((d: any) => d.cells).find((c: any) => c.key === key);

describe('review freshness in the dimension cells (c51 rule)', () => {
  it('the task page says F2 and R are not verified (the rule the cells must follow)', async () => {
    for (const [id, verified] of [['F0', true], ['F1', true], ['F2', false], ['R', false]] as const) {
      const r = await A.req('GET', `/tasks/${id}/reviews`);
      expect(r.status, id).toBe(200);
      expect(r.body.verified, id).toBe(verified);
    }
  });
  it('cognitive.first_attempt_verified counts only the fresh reviews: 2 of 3 first-attempt tasks, the retried task is outside the sample', async () => {
    const r = await A.req('GET', '/company/dimensions?window=7d');
    expect(r.status).toBe(200);
    expect(cell(r.body, 'cognitive.first_attempt_verified')).toMatchObject({ n: 3, value: 66.7, state: 'ok' });
  });
});
