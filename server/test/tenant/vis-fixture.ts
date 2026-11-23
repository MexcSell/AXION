import { tx } from '../../src/db.ts';
import { insertInstance } from '../../src/instances/service.ts';
import { requestApproval } from '../../src/approvals/service.ts';
import { createNotification } from '../../src/notifications/routes.ts';
import { Browser } from '../helpers.ts';
import { buildWorld, seedTenant, upload, idem, type World, type Tenant } from './fixture.ts';

/**
 * Improvement cycle 87: visibility INSIDE one tenant. One tenant (t-1, the "A" of c79), an administrator, two members:
 *  M, the viewer, and O, the owner of a PRIVATE mission (not shared). Everything O's private mission holds carries a marker
 *  (ZQPRIV...Q) that no response for M may show. The c79 seed (seedTenant) gives M a full visible baseline.
 * The states are SEQUENTIAL in one world (two separately seeded worlds would differ in ids and timestamps, which would need new normalisations):
 *   a   O exists, O's private mission does not;
 *   b1  the private mission exists, with GOOD outcomes (passed tasks, accepted reviews, approved approvals);
 *   b2  the outcomes are FLIPPED: the same tasks fail, new rejected reviews and a rejected approval, more failed tasks.
 */
export interface VisWorld {
  w: World; t: Tenant; M: Browser; O: Browser; oId: string; mId: string;
  /** ids in O's private mission (what a foreign-id request uses) */
  priv: Record<string, string>;
  /** marker -> field, for the private mission only */
  markers: Map<string, string>;
  mk: (field: string) => string;
}
const must = (r: { status: number; body: any }, want: number | number[], what: string) => {
  if (![want].flat().includes(r.status)) throw new Error(`vis seed ${what}: got ${r.status} ${JSON.stringify(r.body)?.slice(0, 300)}`);
  return r;
};
const until = async (f: () => Promise<boolean>, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
const D = (c = 'coding', d = 3) => ({ taskClass: c, difficulty: d });
const brief = (goal: string, extra: Record<string, unknown> = {}) => ({ goal, inputs: [], acceptance: ['Fits the template'], capabilities: [{ kind: 'read' }], escalation: 'Ask the owner', ...extra });

export async function buildVisWorld(configure?: (app: import('fastify').FastifyInstance) => void): Promise<VisWorld> {
  const w = await buildWorld({ configureA: configure });
  await seedTenant(w, w.A); // M = w.A.member, the c79 baseline (shared missions, M's own mission3)
  const t = w.A;
  // O: a second member, approved BEFORE the first snapshot, so the only change between states is the private mission
  const O = new Browser(t.app, '127.0.0.9', 'Chrome on Linux');
  const oName = 'Olga Owner';
  must(await O.connect(oName, 'pass1234', { name: 'Desk O', kind: 'desktop', browser: 'Chrome' }), 202, 'O connect');
  const oId = ((await t.admin.req('GET', '/users')).body.users as { id: string; name: string }[]).find((u) => u.name === oName)!.id;
  must(await t.admin.req('POST', `/users/${oId}/approve`), 200, 'approve O');
  must(await O.req('GET', '/auth/wait'), 200, 'O wait');
  const markers = new Map<string, string>(); let n = 0;
  const mk = (f: string) => { const m = `ZQPRIV${String(++n).padStart(3, '0')}Q`; markers.set(m, f); return m; };
  const v: VisWorld = { w, t, M: t.member, O, oId, mId: t.ids.memberId, priv: {}, markers, mk };
  await seedMemberOutcomes(v);
  return v;
}

const mkTask = (v: VisWorld, id: string, status: string, instanceId: string, mission: string, title: string) =>
  v.w.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,$2,$3,$4,$5,$6,$7)`, [id, v.t.tenantId, mission, title, status, instanceId.split(':')[1], instanceId]);
/** Attempts of a task, the way the retry route writes them (attempt_no 1, 2, ...; the table is append-only, so a flip adds attempts, it never rewrites). `from` is the first attempt number. */
export async function addAttempts(v: VisWorld, taskId: string, results: string[], from = 1) {
  for (const [i, r] of results.entries()) await v.w.pool.query(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,$2::int, now() - interval '3 hours' + ($2::int * interval '10 minutes'), now() - interval '2 hours' + ($2::int * interval '10 minutes'), $3)`, [taskId, from + i, r]);
}
/** An admin org proposal (c64 evidence is stored at creation: counts of open tasks, failures and approvals). Different edges per call, because a pending proposal with the same edges is refused. */
export async function createOrgProposal(v: VisWorld, which: 'a' | 'b'): Promise<string> {
  const g = must(await v.t.admin.req('GET', '/organization/graph'), 200, 'graph').body;
  const sub = which === 'a' ? 'tester-01' : 'release-01';
  const edges = g.edges.map((e: any) => (e.subordinateId === sub ? { ...e, supervisorId: 'coder-01' } : e));
  const r = must(await v.t.admin.req('POST', '/organization/proposals', { title: 'Move ' + sub + ' (' + which + ')', why: 'Evidence check ' + which, baseRevision: g.revision.seq, edges, triggers: ['load_imbalance', 'failure_concentration', 'repeated_reassigns'], baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' }, idem()), 201, 'org proposal ' + which);
  return r.body.proposal.id as string;
}
/** A task with a brief (class and difficulty) written BEFORE the task finishes (the skill rating only counts a label given before the first finish). */
async function finishedTask(v: VisWorld, id: string, owner: string, mission: string, title: string, outcome: 'passed' | 'failed', cls: string, diff: number, verdict?: 'accepted' | 'rejected', briefGoal?: string, attempts: string[] = []) {
  await mkTask(v, id, 'ready', owner, mission, title);
  must(await v.t.admin.req('POST', `/missions/${mission}/delegation-briefs`, { toInstanceId: owner, taskId: id, brief: brief(briefGoal ?? 'Goal for ' + id, D(cls, diff)) }, idem()), 201, 'brief ' + id);
  await v.w.pool.query(`update tasks set status=$2, created_at = now() + interval '2 minutes' where id=$1`, [id, outcome]);
  await addAttempts(v, id, attempts); // before the review, which records the latest attempt
  if (verdict) must(await v.t.admin.req('POST', `/tasks/${id}/reviews`, { verdict, rubric: [{ criterion: 'Output attached', result: verdict === 'accepted' ? 'pass' : 'fail', note: 'Seen' }], evidence: [{ kind: 'url', ref: 'https://example.com/' + id.toLowerCase() }] }, idem()), 201, 'review ' + id);
}
/** The instance of `agent` in `mission`; staffing only creates a few agents' instances, so the others are stored directly (as c79 does for tenant B). */
const agentInstance = async (v: VisWorld, mission: string, agent: string) => {
  const list = (await v.t.admin.req('GET', '/agent-instances')).body.instances as { id: string; missionId: string; agentId: string }[];
  const i = list.find((x) => x.missionId === mission && x.agentId === agent);
  if (i) return i.id;
  await tx(v.t.app.db, (c) => insertInstance(c, { tenantId: v.t.tenantId, missionId: mission, agentId: agent, simulated: false }));
  const again = ((await v.t.admin.req('GET', '/agent-instances')).body.instances as { id: string; missionId: string; agentId: string }[]).find((x) => x.missionId === mission && x.agentId === agent);
  if (!again) throw new Error(`no instance of ${agent} in ${mission}`);
  return again.id;
};

/** M's own visible outcomes, on the same agent, class and difficulty as O's private ones, with M just UNDER the n = 5 floor, so one hidden outcome crosses it. */
async function seedMemberOutcomes(v: VisWorld) {
  const m3 = v.t.ids.mission3;
  const inst = await agentInstance(v, m3, 'coder-01');
  const tag = 'mv';
  await finishedTask(v, `T-${tag}-1`, inst, m3, 'Member task one', 'passed', 'coding', 3, 'accepted', undefined, ['failed', 'passed']);
  await finishedTask(v, `T-${tag}-2`, inst, m3, 'Member task two', 'passed', 'coding', 3, 'accepted', undefined, ['passed']);
  await finishedTask(v, `T-${tag}-3`, inst, m3, 'Member task three', 'failed', 'coding', 3, 'rejected');
  await finishedTask(v, `T-${tag}-4`, inst, m3, 'Member task four', 'failed', 'coding', 3, 'rejected');
  v.priv.memberTaskCount = '4';
  v.priv.orgA = await createOrgProposal(v, 'a'); // stored evidence made while the private mission does not exist
}

/** State b1: the private mission with GOOD outcomes. Everything here belongs to the private mission (no lesson, skill or channel message of O's own). */
export async function addPrivate(v: VisWorld): Promise<void> {
  const { t, O, mk, priv } = v; const admin = t.admin;
  priv.upload = await upload(t, O, mk('upload.name') + '.txt', 'Body ' + mk('upload.content'));
  priv.mission = must(await O.req('POST', '/missions', { text: 'Secret launch plan ' + mk('mission.text'), files: [priv.upload], shared: false }, idem()), 201, 'private mission').body.mission.id;
  if (!await until(async () => (await admin.req('GET', `/missions/${priv.mission}`)).body.mission.staffing?.stage === 'working')) throw new Error('staffing did not finish for the private mission');
  const got = (await admin.req('GET', `/missions/${priv.mission}`)).body.mission;
  must(await O.req('PATCH', `/missions/${priv.mission}`, { title: 'Hidden ' + mk('mission.title'), priority: 'high', criteria: [{ text: 'Secret criterion ' + mk('mission.criteria'), done: false }] }, { 'if-match': String(got.rowVersion) }), 200, 'private patch');
  const coder = await agentInstance(v, priv.mission, 'coder-01');
  priv.instance = coder;
  // outcomes on the SAME agent, class and difficulty as M's four: M sits at n = 4 (under the floor of 5), the private mission adds more
  await finishedTask(v, 'T-pv-1', coder, priv.mission, 'Hidden task ' + mk('task.title'), 'passed', 'coding', 3, 'accepted', 'Draft the secret copy ' + mk('brief.goal'), ['failed', 'passed']);
  await finishedTask(v, 'T-pv-2', coder, priv.mission, 'Hidden task two ' + mk('task.title2'), 'passed', 'coding', 3, 'accepted', 'Second brief ' + mk('brief.goal2'), ['failed', 'passed']);
  await finishedTask(v, 'T-pv-3', coder, priv.mission, 'Hidden task three ' + mk('task.title3'), 'passed', 'research', 2, 'accepted', 'Third ' + mk('brief.goal3'), ['failed', 'passed']);
  priv.task = 'T-pv-1'; priv.task2 = 'T-pv-2'; priv.task3 = 'T-pv-3';
  await mkTask(v, 'T-pv-open', 'ready', coder, priv.mission, 'Open hidden ' + mk('task.open'));
  priv.taskOpen = 'T-pv-open';
  // approvals (service helper: no create route), one decided, one waiting
  const mkAp = (title: string, detail: string) => tx(t.app.db, (c) => requestApproval(c, { tenantId: t.tenantId, missionId: priv.mission, agentId: 'release-01', kind: 'release', title, detail, payload: { v: mk('approval.payload') }, expiresInMin: 30 }));
  const ap1 = await mkAp('Publish hidden ' + mk('approval.title'), 'Ship it ' + mk('approval.detail'));
  const ap2 = await mkAp('Decided hidden ' + mk('approval.title2'), 'Done ' + mk('approval.detail2'));
  priv.approval = ap1.id; priv.approvalDecided = ap2.id; priv.approvalDigest = ap1.digest;
  must(await admin.req('POST', `/approvals/${ap2.id}/decision`, { decision: 'approved', digest: ap2.digest, reason: 'ok ' + mk('approval.reason') }), 200, 'decide');
  // thread and message, ledgers, grant, failure tag on a passed task is refused: tag the (later failing) task in b2; the tag here goes on the open task
  priv.thread = must(await admin.req('POST', `/missions/${priv.mission}/threads`, { instanceId: coder }), [200, 201], 'thread').body.threadId;
  must(await admin.req('POST', `/threads/${priv.thread}/messages`, { kind: 'command', text: 'Start with the hidden header ' + mk('thread.message'), to: coder.split(':')[1], uploadIds: [await upload(t, admin, mk('thread.attachment') + '.txt', mk('thread.attachment.content'))] }, idem()), 201, 'thread message');
  must(await admin.req('POST', `/missions/${priv.mission}/ledgers/task`, { baseVersion: 0, body: { facts: { given: [{ text: 'Budget ' + mk('ledger.given'), source: 'text ' + mk('ledger.source') }], to_look_up: [{ text: 'Prices ' + mk('ledger.lookup') }], to_derive: [], guesses: [] }, steps: [{ id: 's1', text: 'Collect ' + mk('ledger.step'), owner: 'gm', status: 'todo' }] } }), 201, 'task ledger');
  priv.grant = must(await admin.req('POST', '/site-grants', { origin: 'https://private-' + mk('grant.origin').toLowerCase() + '.example.com', missionId: priv.mission, capabilities: ['read'], expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }, idem()), 201, 'grant').body.grant.id;
  priv.notification = await tx(t.app.db, (c) => createNotification(c, { tenantId: t.tenantId, severity: 'warning', category: 'system', title: 'Hidden notice ' + mk('notice.title'), body: 'Body ' + mk('notice.body'), missionId: priv.mission }));
  priv.notification2 = await tx(t.app.db, (c) => createNotification(c, { tenantId: t.tenantId, severity: 'info', category: 'system', title: 'Owner notice ' + mk('notice.owner'), body: 'Only O ' + mk('notice.owner.body'), userId: v.oId, missionId: priv.mission, ownerOnly: true }));
  // a failure tag on a failed task needs a failed task: the mission has none yet; b2 adds them. The open task cannot be tagged either, so priv.tag is set in b2.
}

/** State b2: FLIP the outcomes. The same passed tasks fail, new tasks fail with rejected reviews, the waiting approval is rejected, a new one is approved. */
export async function flipPrivate(v: VisWorld): Promise<void> {
  const { t, mk, priv } = v; const admin = t.admin; const pool = v.w.pool;
  await pool.query(`update tasks set status='failed' where id = any($1)`, [['T-pv-1', 'T-pv-2']]);
  await pool.query(`update tasks set status='passed' where id = $1`, ['T-pv-open']);
  const coder = priv.instance;
  await addAttempts(v, 'T-pv-1', ['failed'], 3); await addAttempts(v, 'T-pv-2', ['failed'], 3); // the flip: a third attempt that fails
  await mkTask(v, 'T-pv-open2', 'running', coder, priv.mission, 'Open again ' + mk('task.open2'));
  await finishedTask(v, 'T-pv-4', coder, priv.mission, 'Hidden failed ' + mk('task.title4'), 'failed', 'coding', 3, 'rejected', 'Fourth ' + mk('brief.goal4'), ['failed', 'failed']);
  await finishedTask(v, 'T-pv-5', coder, priv.mission, 'Hidden failed two ' + mk('task.title5'), 'failed', 'coding', 3, 'rejected', 'Fifth ' + mk('brief.goal5'), ['failed', 'failed']);
  must(await admin.req('POST', `/approvals/${priv.approval}/decision`, { decision: 'denied', digest: priv.approvalDigest, reason: 'no ' + mk('approval.reason2') }), 200, 'reject');
  priv.tag = must(await admin.req('POST', '/failure-tags', { subjectKind: 'task', subjectId: 'T-pv-4', modeId: 'FM-1.1', note: 'Ignored the hidden spec ' + mk('tag.note'), attribution: { agentId: 'agent-' + mk('tag.agent').toLowerCase(), stepRef: 'step ' + mk('tag.step') } }, idem()), 201, 'tag').body.tag.id;
  priv.notification3 = String(await tx(t.app.db, (c) => createNotification(c, { tenantId: t.tenantId, severity: 'critical', category: 'system', title: 'Hidden failure ' + mk('notice.title3'), body: mk('notice.body3'), missionId: priv.mission })));
}
