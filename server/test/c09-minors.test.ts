import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { tx } from '../src/db.ts';
const BRIEF = { goal: 'Take over the task', acceptance: ['The result is attached'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner when unsure' }; // c51: a reassignment always carries a brief

// Cycle 9 (lane w7): the deferred server minors, one test each (RED first).
let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'c9-' + Date.now() + '-' + n++ });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
async function until(f: () => Promise<boolean>, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await sleep(30); } return false; }

async function setup() {
  t = await makeTestApp({ staffingStepMs: 30 });
  const A = await withAdmin(t.app);
  const mk = async () => {
    const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission.id as string;
    await until(async () => (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage === 'working');
    return m;
  };
  const m1 = await mk(), m2 = await mk();
  const inst = async (m: string) => (await rows(`select id, agent_id from agent_instances where mission_id=$1 order by seq`, [m])) as { id: string; agent_id: string }[];
  const thread = async (m: string, instanceId: string) => (await A.admin.req('POST', `/missions/${m}/threads`, { instanceId })).body.threadId as string;
  return { A, m1, m2, inst, thread };
}

describe('1. replyTo must name a message in the same conversation', () => {
  it('thread: unknown, other-thread and non-numeric replyTo are 422; a message of this thread is 201', async () => {
    const { A, m1, m2, inst, thread } = await setup();
    const i1 = await inst(m1), i2 = await inst(m2);
    const th1 = await thread(m1, i1[0].id), th2 = await thread(m2, i2[0].id);
    const first = await A.admin.req('POST', `/threads/${th1}/messages`, { kind: 'command', text: 'hello', to: 'gm' }, key());
    expect(first.status).toBe(201);
    const other = await A.admin.req('POST', `/threads/${th2}/messages`, { kind: 'command', text: 'elsewhere', to: 'gm' }, key());
    expect(other.status).toBe(201);
    for (const bad of ['999999', 'nope', other.body.message.id]) {
      const r = await A.admin.req('POST', `/threads/${th1}/messages`, { kind: 'reply', text: 'x', to: 'gm', replyTo: bad }, key());
      expect(r.status, String(bad)).toBe(422); expect(r.body.fieldErrors?.replyTo).toBeTruthy();
    }
    const ok = await A.admin.req('POST', `/threads/${th1}/messages`, { kind: 'reply', text: 'x', to: 'gm', replyTo: first.body.message.id }, key());
    expect(ok.status).toBe(201); expect(ok.body.message.replyTo).toBe(first.body.message.id);
  });
  it('channel: the same rule holds in direct channels (own thread only)', async () => {
    const { A } = await setup();
    const mina = await A.member('Mina'), omar = await A.member('Omar');
    const a = await mina.b.req('POST', '/channels/gm/messages', { kind: 'command', text: 'one' }, key());
    const b = await omar.b.req('POST', '/channels/gm/messages', { kind: 'command', text: 'two' }, key());
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect((await mina.b.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'x', replyTo: 'nope' }, key())).status).toBe(422);
    expect((await mina.b.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'x', replyTo: b.body.message.id }, key())).status).toBe(422);
    const ok = await mina.b.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'x', replyTo: a.body.message.id }, key());
    expect(ok.status).toBe(201);
  });
});

describe('2. one shared post validator', () => {
  it('exports parsePost for both routes: drops unknown keys, trims, rejects bad kinds and empty bodies', async () => {
    const { parsePost } = await import('../src/conversations/post.ts');
    const ok = parsePost({ kind: 'reply', text: '  hi  ', from: 'gm', author: 1 }, { withTo: false });
    expect(ok).toMatchObject({ kind: 'reply', text: 'hi', uploadIds: [] }); expect('from' in ok).toBe(false);
    expect(() => parsePost({ kind: 'report', text: 'x' }, { withTo: false })).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() => parsePost({ kind: 'reply', text: '   ' }, { withTo: false })).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() => parsePost({ kind: 'reply', text: 'x' }, { withTo: true })).toThrowError(expect.objectContaining({ status: 422 })); // `to` required in threads
    expect(parsePost({ kind: 'reply', text: 'x', to: 'gm' }, { withTo: true }).to).toBe('gm');
  });
});

describe('3. task.delegated has one payload shape', () => {
  it('staffing (instance subject) and reassign (task subject) both carry fromInstance and toInstance', async () => {
    const { A, m1, inst } = await setup();
    const i1 = await inst(m1);
    const tn = (await rows(`select tenant_id from missions where id=$1`, [m1]))[0].tenant_id;
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ('T-d1',$1,$2,'A task','ready',$3,$4)`, [tn, m1, i1[1].agent_id, i1[1].id]);
    expect((await A.admin.req('POST', '/tasks/T-d1/reassign', { toInstanceId: i1[2].id, brief: BRIEF }, key())).status).toBe(200);
    const ev = await rows(`select subject_kind, payload from events where type='task.delegated' and mission_id=$1`, [m1]);
    expect(ev.some((e) => e.subject_kind === 'instance')).toBe(true);
    expect(ev.some((e) => e.subject_kind === 'task')).toBe(true);
    for (const e of ev) {
      expect(typeof e.payload.fromInstance, e.subject_kind).toBe('string');
      expect(typeof e.payload.toInstance, e.subject_kind).toBe('string');
      if (e.subject_kind === 'task') expect(e.payload.taskId).toBe('T-d1');
    }
  });
});

describe('4. reassign target must still be working in the mission', () => {
  it('an instance that has ended or is done is 422', async () => {
    const { A, m1, inst } = await setup();
    const i1 = await inst(m1);
    const tn = (await rows(`select tenant_id from missions where id=$1`, [m1]))[0].tenant_id;
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ('T-e1',$1,$2,'A task','ready',$3,$4)`, [tn, m1, i1[1].agent_id, i1[1].id]);
    await t.pool.query(`update agent_instances set ended_at=now() where id=$1`, [i1[2].id]);
    await t.pool.query(`update agent_instances set state='done' where id=$1`, [i1[3].id]);
    for (const x of [i1[2], i1[3]]) {
      const r = await A.admin.req('POST', '/tasks/T-e1/reassign', { toInstanceId: x.id, brief: BRIEF }, key());
      expect(r.status, x.id).toBe(422); expect(r.body.code).toBe('TASK_TARGET_INVALID');
    }
    expect((await rows(`select owner_instance_id from tasks where id='T-e1'`))[0].owner_instance_id).toBe(i1[1].id);
    // the precondition: the mission has a fifth instance that is still working, and it is a valid target
    expect(i1.length).toBeGreaterThan(4);
    expect((await A.admin.req('POST', '/tasks/T-e1/reassign', { toInstanceId: i1[4].id, brief: BRIEF }, key())).status).toBe(200);
  });
});

describe('5. listInstances pages and says when it is cut', () => {
  it('limit + before page through every instance, with truncated / nextBefore; the default reply is not truncated', async () => {
    const { A, m1, m2 } = await setup();
    const total = (await rows(`select count(*)::int n from agent_instances`))[0].n as number;
    expect(total).toBeGreaterThan(3);
    const all = (await A.admin.req('GET', '/agent-instances')).body;
    expect(all.instances.length).toBe(total); expect(all.truncated).toBe(false);
    const seen: string[] = []; let before: string | undefined; let pages = 0;
    for (;;) {
      const r = (await A.admin.req('GET', `/agent-instances?limit=3${before ? `&before=${encodeURIComponent(before)}` : ''}`)).body;
      expect(r.instances.length).toBeLessThanOrEqual(3);
      seen.push(...r.instances.map((i: any) => i.id)); pages++;
      if (!r.truncated) { expect(r.nextBefore).toBeUndefined(); break; }
      expect(r.nextBefore).toBeTruthy(); before = r.nextBefore;
      expect(pages).toBeLessThan(50);
    }
    expect(new Set(seen).size).toBe(total); expect(seen.length).toBe(total);
    expect(pages).toBeGreaterThan(1);
    expect(new Set(seen)).toEqual(new Set(all.instances.map((i: any) => i.id)));
    void m1; void m2;
    expect((await A.admin.req('GET', '/agent-instances?limit=0')).status).toBe(400);
    expect((await A.admin.req('GET', '/agent-instances?before=abc')).status).toBe(400);
  });
});

describe('7. approvals say who decided', () => {
  it('a decided approval carries decidedByName (the real decider); a pending one has null', async () => {
    const { A, m1 } = await setup();
    const mina = await A.member('Mina');
    const mid = (await mina.b.req('POST', '/missions', { text: 'Publish the homepage preview.', files: [], shared: false }, key())).body.mission.id as string;
    // deliberate tightening (c30 fix round): a member can no longer decide an R3 approval; an R2 one (submit_form) still works
    const r3 = await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: mid, agentId: 'release-01', kind: 'release', title: 'Publish', detail: 'd', payload: { v: 1 }, expiresInMin: 60 }));
    const r = await mina.b.req('POST', `/approvals/${r3.id}/decision`, { decision: 'approved', digest: r3.digest }, key());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('POLICY_DENIED');
    const a = await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: mid, agentId: 'release-01', kind: 'submit_form', title: 'Send', detail: 'd', payload: { v: 2 }, expiresInMin: 60 }));
    const before = (await mina.b.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === a.id);
    expect(before.decidedByName).toBeNull();
    const dec = await mina.b.req('POST', `/approvals/${a.id}/decision`, { decision: 'approved', digest: a.digest }, key());
    expect(dec.status).toBe(200);
    const after = (await mina.b.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === a.id);
    expect(after.decidedByName).toBe('Mina');
    expect(dec.body.approval.decidedByName, 'the decision response names the decider too (H10 item 4)').toBe('Mina');
    expect(dec.body.approval).toEqual(after); // the same row, the same join, as GET /approvals
    void m1;
  });
});
