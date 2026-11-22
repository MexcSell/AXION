import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { transitionTask } from '../src/tasks/machine.ts';
import { TASK_STATUSES, USER_TASK_ACTIONS, SYSTEM_TASK_ACTIONS, type TaskStatus, type TaskAction } from '../../shared/contracts/src/index.ts';
const BRIEF = { goal: 'Take over the task', acceptance: ['The result is attached'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner when unsure' }; // c51: a reassignment always carries a brief

const LEGAL: [TaskStatus, TaskAction, TaskStatus][] = [
  ['created', 'ready', 'ready'], ['created', 'cancel', 'canceled'],
  ['ready', 'start', 'running'], ['ready', 'cancel', 'canceled'],
  ['running', 'verify', 'verifying'], ['running', 'fail', 'failed'], ['running', 'waitAgent', 'waiting_agent'], ['running', 'waitUser', 'waiting_user'], ['running', 'cancel', 'canceled'],
  ['waiting_agent', 'resume', 'running'], ['waiting_agent', 'cancel', 'canceled'],
  ['waiting_user', 'resume', 'running'], ['waiting_user', 'cancel', 'canceled'],
  ['verifying', 'pass', 'passed'], ['verifying', 'cancel', 'canceled'],
  ['failed', 'retry', 'retry_ready'], ['failed', 'cancel', 'canceled'],
  ['retry_ready', 'requeue', 'ready'], ['retry_ready', 'cancel', 'canceled'],
  // reassign keeps the state; it is refused only while running (and on a finished task)
  ['created', 'reassign', 'created'], ['ready', 'reassign', 'ready'], ['waiting_agent', 'reassign', 'waiting_agent'], ['waiting_user', 'reassign', 'waiting_user'],
  ['verifying', 'reassign', 'verifying'], ['failed', 'reassign', 'failed'], ['retry_ready', 'reassign', 'retry_ready'],
];
const ALL = [...USER_TASK_ACTIONS, ...SYSTEM_TASK_ACTIONS] as TaskAction[];

describe('task state machine', () => {
  it.each(LEGAL)('%s --%s--> %s', (from, action, to) => { expect(transitionTask(from, action)).toBe(to); });
  it('every other (status, action) pair throws ILLEGAL_TRANSITION', () => {
    let illegal = 0;
    for (const from of TASK_STATUSES) for (const a of ALL) {
      if (LEGAL.some(([f, x]) => f === from && x === a)) continue;
      expect(() => transitionTask(from, a), `${from} ${a}`).toThrowError(expect.objectContaining({ code: 'ILLEGAL_TRANSITION', status: 409 }));
      illegal++;
    }
    expect(illegal + LEGAL.length).toBe(TASK_STATUSES.length * ALL.length);
  });
});

let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'k' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;

async function setup() {
  t = await makeTestApp({ staffingStepMs: 30 });
  const A = await withAdmin(t.app);
  const mk = async () => {
    const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission.id as string;
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
    return m;
  };
  const m1 = await mk(), m2 = await mk();
  const inst = async (m: string) => (await rows(`select id, agent_id from agent_instances where mission_id=$1 order by seq`, [m])) as { id: string; agent_id: string }[];
  const mkTask = async (m: string, id: string, status: string, owner?: string) => {
    const tn = (await rows(`select tenant_id from missions where id=$1`, [m]))[0].tenant_id;
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,$2,$3,'A task',$4,$5,$6)`, [id, tn, m, status, owner ? owner.split(':')[1] : null, owner ?? null]);
  };
  return { A, m1, m2, inst, mkTask };
}

describe('task actions', () => {
  it('system-only actions are 403 for a person', async () => {
    const { A, m1, mkTask } = await setup();
    await mkTask(m1, 'T-s1', 'running');
    for (const a of SYSTEM_TASK_ACTIONS) expect((await A.admin.req('POST', `/tasks/T-s1/${a}`, {}, key())).status, a).toBe(403);
    expect((await A.admin.req('POST', `/tasks/T-s1/bogus`, {}, key())).body.code).toBe('ACTION_NOT_ALLOWED');
  });

  it('retry keeps attempt 1 (failed) and adds attempt 2; replay returns the same result', async () => {
    const { A, m1, mkTask } = await setup();
    await mkTask(m1, 'T-r1', 'failed');
    const k = key();
    const r = await A.admin.req('POST', '/tasks/T-r1/retry', {}, k);
    expect(r.status).toBe(200);
    expect(r.body.task.state).toBe('queued');
    const at = await rows(`select attempt_no, result, started_at, finished_at from task_attempts where task_id='T-r1' order by attempt_no`);
    expect(at.map((a) => a.attempt_no)).toEqual([1, 2]);
    expect(at[0].result).toBe('failed'); expect(at[1].started_at).toBeNull();
    expect((await rows(`select status from tasks where id='T-r1'`))[0].status).toBe('retry_ready');
    const again = await A.admin.req('POST', '/tasks/T-r1/retry', {}, k);
    expect(again.status).toBe(200); expect(again.body).toEqual(r.body);
    expect((await rows(`select 1 from task_attempts where task_id='T-r1'`)).length).toBe(2);
    expect((await rows(`select 1 from audit_events where action='task.retry' and subject='T-r1'`)).length).toBe(1);
    expect((await rows(`select 1 from events where type='task.stateChanged' and payload->>'taskId'='T-r1'`)).length).toBe(1);
    // a second retry (now retry_ready) is illegal; a task with history gets max+1
    expect((await A.admin.req('POST', '/tasks/T-r1/retry', {}, key())).status).toBe(409);
    await t.pool.query(`update tasks set status='failed' where id='T-r1'`);
    expect((await A.admin.req('POST', '/tasks/T-r1/retry', {}, key())).status).toBe(200);
    expect((await rows(`select attempt_no from task_attempts where task_id='T-r1' order by 1`)).map((a) => a.attempt_no)).toEqual([1, 2, 3]);
  });

  it('retry or reassign while running is 409; cancel works on running; a canceled task cannot move', async () => {
    const { A, m1, inst, mkTask } = await setup();
    const i = await inst(m1);
    await mkTask(m1, 'T-run', 'running', i[1].id);
    expect((await A.admin.req('POST', '/tasks/T-run/retry', {}, key())).status).toBe(409);
    expect((await A.admin.req('POST', '/tasks/T-run/reassign', { toInstanceId: i[0].id, brief: BRIEF }, key())).status).toBe(409);
    const c = await A.admin.req('POST', '/tasks/T-run/cancel', {}, key());
    expect(c.status).toBe(200); expect(c.body.task.state).toBe('canceled');
    expect((await A.admin.req('POST', '/tasks/T-run/cancel', {}, key())).status).toBe(409);
    expect((await A.admin.req('POST', '/tasks/T-run/retry', {}, key())).status).toBe(409);
  });

  it('reassign: records a delegated row and task.delegated; another mission or the same owner is 422', async () => {
    const { A, m1, m2, inst, mkTask } = await setup();
    const i1 = await inst(m1), i2 = await inst(m2);
    await mkTask(m1, 'T-a1', 'ready', i1[1].id);
    const bad = await A.admin.req('POST', '/tasks/T-a1/reassign', { toInstanceId: i2[1].id, brief: BRIEF }, key());
    expect(bad.status).toBe(422); expect(bad.body.code).toBe('TASK_TARGET_INVALID');
    expect((await A.admin.req('POST', '/tasks/T-a1/reassign', { toInstanceId: 'nope', brief: BRIEF }, key())).status).toBe(422);
    expect((await A.admin.req('POST', '/tasks/T-a1/reassign', { toInstanceId: i1[1].id, brief: BRIEF }, key())).status).toBe(422);
    expect((await A.admin.req('POST', '/tasks/T-a1/reassign', {}, key())).status).toBe(400);
    const target = i1.find((x, k) => k > 1)!;
    const before = (await rows(`select 1 from mission_delegations where task_id='T-a1'`)).length;
    const r = await A.admin.req('POST', '/tasks/T-a1/reassign', { toInstanceId: target.id, reason: 'needs a specialist', brief: BRIEF }, key());
    expect(r.status).toBe(200); expect(r.body.task.owner).toBe(target.agent_id); expect(r.body.task.state).toBe('ready');
    const d = await rows(`select from_instance, to_instance, edge_kind, simulated from mission_delegations where task_id='T-a1'`);
    expect(d.length).toBe(before + 1);
    expect(d[0]).toMatchObject({ to_instance: target.id, edge_kind: 'delegated', simulated: false });
    const row = (await rows(`select owner_instance_id, owner_agent, status from tasks where id='T-a1'`))[0];
    expect(row).toMatchObject({ owner_instance_id: target.id, owner_agent: target.agent_id, status: 'ready' });
    expect((await rows(`select 1 from events where type='task.delegated' and mission_id=$1 and payload->>'taskId'='T-a1'`, [m1])).length).toBe(1);
    expect((await rows(`select 1 from events where type='task.stateChanged' and payload->>'taskId'='T-a1'`)).length).toBe(0);
    const au = (await rows(`select actor, detail from audit_events where action='task.reassign' and subject='T-a1'`))[0];
    expect(au.actor).toBe(A.adminId); expect(au.detail.reason).toBe('needs a specialist');
    // the hierarchy shows no duplicate edge
    const h = (await A.admin.req('GET', `/missions/${m1}/hierarchy`)).body.edges.map((e: any) => `${e.from}|${e.to}|${e.kind}`);
    expect(new Set(h).size).toBe(h.length);
  });

  it('a private mission is 404 for another member and for invisible ids; tasks are tenant-bound', async () => {
    const { A, m1, mkTask } = await setup();
    const bob = await A.member('Bob');
    await mkTask(m1, 'T-p1', 'failed');
    for (const a of ['retry', 'cancel', 'reassign']) expect((await bob.b.req('POST', `/tasks/T-p1/${a}`, a === 'reassign' ? { toInstanceId: 'x' } : {}, key())).status, a).toBe(404);
    expect((await A.admin.req('POST', '/tasks/T-none/cancel', {}, key())).status).toBe(404);
    expect((await A.admin.req('POST', '/tasks/T-p1/cancel', {})).status).toBe(400); // Idempotency-Key required
    expect((await rows(`select status from tasks where id='T-p1'`))[0].status).toBe('failed');
  });

  it('GET /tasks/:id returns the task for a visible mission', async () => {
    const { A, m1, mkTask } = await setup();
    await mkTask(m1, 'T-g1', 'created');
    const r = await A.admin.req('GET', '/tasks/T-g1');
    expect(r.status).toBe(200); expect(r.body.task.id).toBe('T-g1');
  });
});
