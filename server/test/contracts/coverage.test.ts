import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, openStream, Browser, TEST_DB, type TestApp } from '../helpers.ts';
import { requestApproval, consumeApproval, loadBoundAction } from '../../src/approvals/service.ts';
import { createNotification } from '../../src/notifications/routes.ts';
import { eventDto } from '../../src/events/log.ts';
import { setInstanceState } from '../../src/instances/service.ts';
import { tx } from '../../src/db.ts';
import { writeAnchor, rotateAnchor } from '../../src/audit-anchor.ts';
import { proposeLesson, proposeSkill } from '../../src/agents/playbooks.ts';
import { recordFixtureOutcome } from '../../src/agents/retirement.ts';
import { enqueueJob } from '../../src/jobs/store.ts';
import { makeDataset, addRun } from '../eval-fixtures.ts';
import { recordRegrade } from '../../src/evolution/eval-runs.ts';
import { check } from './validate.ts';
import { errorEnvelope } from './validators.ts';
import { checkEvent, eventValidator, EVENT_VALIDATORS } from './events.ts';
import type { EventType } from '../../../shared/contracts/src/index.ts';
import { ROUTES, routeKey } from './registry.ts';
import { call, hits, gated, problems, errorShapes, bodies, requests, key, recordServed, writeDump } from './flow.ts';
import { decided as decidedFx } from '../c65-fixtures.ts';
import { SWEEP_SKIP, MEMBER_403_ALLOWED } from './allowlists.ts';
import { UNEXERCISED_ALLOWED } from './exercised.ts';
import { lenientMutations, unexercised } from './walk.ts';
const ST = { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' }; // c64: every proposal states a baseline and its expected cost

/**
 * Improvement cycle 50: the coverage run. Every route in the registry is called at least once in its happy state as the right
 * role and its body validated against the shared contract; every administrator route is also called as a member and its 403
 * checked against the error envelope; every domain event the flow produced is validated against its payload contract.
 * inventory.test.ts proves the registry lists every registered route; this file proves the registry entries are exercised.
 */
let t: TestApp;
let base: string;
const until = async (f: () => Promise<boolean>, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
const cookieOf = (b: Browser) => [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
const multipart = (name: string, content: string) => {
  const boundary = '----c50' + Date.now();
  return { boundary, payload: `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n` };
};
const dayIso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

// c57 (H13): a hermetic anchor setup. The key is generated here, never printed and never read from any .env; the domain is a fixed
// test id; the file lives in a temp dir that is removed in afterAll.
const anchorDir = mkdtempSync(join(tmpdir(), 'axion-c57-anchor-'));
const anchorCfg = { key: randomBytes(32).toString('hex'), domain: 'axion-contract-test', file: join(anchorDir, 'audit-anchors.jsonl') };

const openStreams: (() => void)[] = [];
let streamEvents: { event: string; data: any }[] = [];

describe('API coverage run', () => {
  beforeAll(async () => {
    t = await makeTestApp({ staffingStepMs: 30, conversationSimMs: 80, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } }, configure: recordServed, auditAnchor: anchorCfg });
    await t.app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  });
  afterAll(async () => { openStreams.forEach((c) => c()); await t?.close(); rmSync(anchorDir, { recursive: true, force: true }); });

  it('drives every route and validates every response', async () => {
    const anon = new Browser(t.app);
    await call(anon, 'GET', '/health', '/health');
    await call(anon, 'GET', '/auth/hello', '/auth/hello');
    expect((await call(anon, 'GET', '/me', '/me', { status: 401 })).body.code).toBe('UNAUTHENTICATED');

    // ---- sign-in flow (the first user is the administrator)
    const A = await withAdmin(t.app);
    const admin = A.admin;
    const stream = await openStream(base, admin);
    openStreams.push(stream.close);
    await stream.waitFor((e) => e.event === 'hello');
    await call(admin, 'GET', '/me', '/me');
    const dev = { name: 'Chrome on Linux', kind: 'desktop', browser: 'Chrome' };
    expect((await call(admin, 'POST', '/auth/connect', '/auth/connect', { body: { name: 'Luca', password: 'pass1234', device: dev } })).body.state).toBe('signedIn');
    expect((await call(new Browser(t.app, '127.0.0.9'), 'POST', '/auth/connect', '/auth/connect', { status: 202, body: { name: 'Luca', password: 'pass1234', device: { ...dev, name: 'Second PC' } } })).body.reason).toBe('device');
    const mina = new Browser(t.app);
    const w = await call(mina, 'POST', '/auth/connect', '/auth/connect', { status: 202, body: { name: 'Mina', password: 'pass1234', device: { name: 'Chrome on Linux', kind: 'desktop', browser: 'Chrome' } } });
    expect(w.body.state).toBe('waiting');
    const users = (await call(admin, 'GET', '/users', '/users')).body.users as { id: string; name: string }[];
    const minaId = users.find((u) => u.name === 'Mina')!.id;
    await call(admin, 'POST', '/users/:id/approve', `/users/${minaId}/approve`);
    expect((await call(mina, 'GET', '/auth/wait', '/auth/wait')).body.state).toBe('signedIn');
    const pend = new Browser(t.app);
    expect((await pend.connect('Rex', 'pass1234')).status).toBe(202);
    expect((await call(pend, 'GET', '/auth/wait', '/auth/wait', { status: 202 })).body.state).toBe('waiting');
    await call(pend, 'POST', '/auth/cancel', '/auth/cancel');
    const rexId = ((await admin.req('GET', '/users')).body.users as { id: string; name: string }[]).find((u) => u.name === 'Rex')!.id;
    await call(admin, 'POST', '/users/:id/reject', `/users/${rexId}/reject`);
    await call(mina, 'GET', '/people', '/people');
    await call(admin, 'GET', '/people', '/people');
    const bea = await A.member('Bea');
    await call(admin, 'PATCH', '/users/:id', `/users/${bea.id}`, { body: { role: 'admin' } });
    await call(mina, 'PATCH', '/me', '/me', { body: { avatar: { kind: 'initials', hue: 120 } } });
    await call(mina, 'POST', '/me/password', '/me/password', { body: { current: 'pass1234', next: 'newpass1234' } });
    // a second device for Mina: waiting, approved, blocked, removed
    const minaPhone = new Browser(t.app, '127.0.0.2', 'Safari on iPhone');
    const dw = await minaPhone.connect('Mina', 'newpass1234', { name: 'Phone', kind: 'phone', browser: 'Safari' });
    expect(dw.status).toBe(202);
    const minaAcct = ((await admin.req('GET', '/users')).body.users as any[]).find((u) => u.id === minaId);
    const phone = minaAcct.devices.find((d: any) => d.name === 'Phone');
    await call(admin, 'POST', '/users/:id/devices/:did/:action', `/users/${minaId}/devices/${phone.id}/approve`);
    await call(admin, 'POST', '/users/:id/devices/:did/:action', `/users/${minaId}/devices/${phone.id}/block`);
    await call(admin, 'DELETE', '/users/:id/devices/:did', `/users/${minaId}/devices/${phone.id}`);
    const cy = await A.member('Cy');
    const dev2 = new Browser(t.app, '127.0.0.3', 'Firefox on Linux');
    {
      expect((await dev2.connect('Cy', 'pass1234', { name: 'Laptop', kind: 'laptop', browser: 'Firefox' })).status).toBe(202);
      const cyAcct = ((await admin.req('GET', '/users')).body.users as any[]).find((u) => u.id === cy.id);
      const d = cyAcct.devices.find((x: any) => x.name === 'Laptop');
      await admin.req('POST', `/users/${cy.id}/devices/${d.id}/approve`);
      expect((await dev2.req('GET', '/auth/wait')).status).toBe(200);
      await call(dev2, 'DELETE', '/me/devices/:did', `/me/devices/${cyAcct.devices.find((x: any) => x.name !== 'Laptop').id}`);
    }
    await call(dev2, 'POST', '/auth/logout', '/auth/logout');

    // ---- missions, uploads
    const up = multipart('notes.txt', 'Line one\nLine two\n');
    const ur = await t.app.inject({ method: 'POST', url: '/api/v1/uploads', remoteAddress: '127.0.0.1', headers: { cookie: cookieOf(admin), 'x-csrf': admin.csrf, 'content-type': `multipart/form-data; boundary=${up.boundary}` }, payload: up.payload });
    expect(ur.statusCode).toBe(201);
    problems.push(...check('POST /uploads', (ROUTES['POST /uploads'] as any).v, ur.json())); hits.add('POST /uploads'); (bodies['POST /uploads'] ??= []).push(ur.json());
    const fileId = ur.json().id as string;
    const dl = await t.app.inject({ method: 'GET', url: `/api/v1/uploads/${fileId}`, headers: { cookie: cookieOf(admin) } });
    expect(dl.statusCode).toBe(200); expect(dl.body).toContain('Line one');

    const created = await call(admin, 'POST', '/missions', '/missions', { status: 201, body: { text: 'Build a website landing page for the shop.', files: [fileId], shared: false }, headers: key() });
    const m1 = created.body.mission.id as string;
    const m2 = (await admin.req('POST', '/missions', { text: 'Research the market for tea shops.', files: [], shared: true }, key())).body.mission.id as string;
    // a mission the member owns and shares: the administrator reviews its tasks (a producer must not review its own work)
    const upM = multipart('newsletter.txt', 'Draft one\n');
    const urM = await t.app.inject({ method: 'POST', url: '/api/v1/uploads', remoteAddress: '127.0.0.1', headers: { cookie: cookieOf(mina), 'x-csrf': mina.csrf, 'content-type': `multipart/form-data; boundary=${upM.boundary}` }, payload: upM.payload });
    const m3 = (await mina.req('POST', '/missions', { text: 'Write the shop newsletter.', files: [urM.json().id], shared: true }, key())).body.mission.id as string;
    for (const m of [m1, m3]) expect(await until(async () => (await admin.req('GET', `/missions/${m}`)).body.mission.staffing?.stage === 'working')).toBe(true);
    await call(admin, 'GET', '/missions', '/missions');
    const got = await call(admin, 'GET', '/missions/:id', `/missions/${m1}`);
    await call(admin, 'PATCH', '/missions/:id', `/missions/${m1}`, { body: { title: 'Landing page', priority: 'high', criteria: [{ text: 'Loads fast', done: false }] }, headers: { 'if-match': String(got.body.mission.rowVersion) } });
    await call(admin, 'POST', '/missions/:id/share', `/missions/${m1}/share`, { body: { shared: true } });
    await call(admin, 'POST', '/missions/:id/actions/:action', `/missions/${m1}/actions/pause`, { body: {}, headers: key() });
    await call(admin, 'POST', '/missions/:id/actions/:action', `/missions/${m1}/actions/resume`, { body: {}, headers: key() });
    await call(admin, 'GET', '/missions/:id/hierarchy', `/missions/${m1}/hierarchy`);
    const tasksR = await call(admin, 'GET', '/missions/:id/tasks', `/missions/${m1}/tasks`);

    // ---- instances and tasks
    const insts = await call(admin, 'GET', '/agent-instances', '/agent-instances');
    const mine = (insts.body.instances as { id: string; missionId: string }[]).filter((i) => i.missionId === m1);
    expect(mine.length).toBeGreaterThan(1);
    await call(admin, 'GET', '/agent-instances', '/agent-instances', { query: '?agentId=gm' });
    await call(admin, 'GET', '/agent-instances/:id', `/agent-instances/${encodeURIComponent(mine[0].id)}`);
    const tenant = (await t.pool.query(`select tenant_id from missions where id=$1`, [m1])).rows[0].tenant_id as string;
    const mkTask = (id: string, status: string, ownerInstance: string, mission = m1) => t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,$2,$3,'A task',$4,$5,$6)`, [id, tenant, mission, status, ownerInstance.split(':')[1], ownerInstance]);
    await mkTask('T-c50a', 'failed', mine[1].id);
    await mkTask('T-c50b', 'ready', mine[1].id);
    await mkTask('T-c50c', 'created', mine[1].id);
    const prod3 = ((await admin.req('GET', '/agent-instances')).body.instances as { id: string; missionId: string }[]).filter((i) => i.missionId === m3).find((i) => !i.id.endsWith(':gm'))!;
    await mkTask('T-c50r', 'passed', prod3.id, m3);
    await mkTask('T-c50p', 'passed', mine[1].id); // in the administrator's own mission: the owner may not review it
    await call(admin, 'GET', '/tasks/:id', '/tasks/T-c50a');
    await call(admin, 'POST', '/tasks/:id/:action', '/tasks/T-c50a/retry', { body: {}, headers: key() });
    await call(admin, 'POST', '/tasks/:id/:action', '/tasks/T-c50b/reassign', { body: { toInstanceId: mine[0].id, reason: 'balance', brief: { goal: 'Take over the task', acceptance: ['The result is attached'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner when unsure' } }, headers: key() });
    await call(admin, 'POST', '/tasks/:id/:action', '/tasks/T-c50c/cancel', { body: {}, headers: key() });
    expect(Array.isArray(tasksR.body)).toBe(true);
    expect(((await call(admin, 'GET', '/missions/:id/tasks', `/missions/${m1}/tasks`)).body as unknown[]).length, 'the task list now has rows to validate').toBeGreaterThan(2);
    // task reviews: the administrator reviews a passed task of a mission the member owns
    await call(admin, 'GET', '/tasks/:id/reviews', '/tasks/T-c50r/reviews');
    expect((await call(admin, 'GET', '/tasks/:id/reviews', '/tasks/T-c50p/reviews')).body.canReview.allowed).toBe(false);
    await call(admin, 'POST', '/tasks/:id/reviews', '/tasks/T-c50r/reviews', { status: 201, headers: key(), body: { verdict: 'accepted', rubric: [{ criterion: 'The output is attached', result: 'pass', note: 'seen' }], evidence: [{ kind: 'url', ref: 'https://example.com/report' }] } });
    // c51: the task is attempted again after the review, so the stored review no longer counts: `stale` is filled in the next read
    await t.pool.query(`insert into task_attempts(task_id, attempt_no, started_at) values ('T-c50r', 1, now())`);
    await call(admin, 'GET', '/tasks/:id/reviews', '/tasks/T-c50r/reviews');

    // ---- delegation briefs
    const brief = { goal: 'Draft the landing page copy', inputs: ['file:brief.md'], acceptance: ['Copy fits the template'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner' };
    await call(admin, 'POST', '/missions/:id/delegation-briefs', `/missions/${m1}/delegation-briefs`, { status: 201, headers: key(), body: { toInstanceId: mine[0].id, brief: { ...brief, taskClass: 'research', difficulty: 2 } } });
    // a brief to a manager and a wider one to its report: the report's effective scope is narrowed by the manager's
    const child = (insts.body.instances as { id: string; missionId: string; managerInstanceId: string | null }[]).find((i) => i.missionId === m1 && i.managerInstanceId && i.managerInstanceId !== `${m1}:gm`)!;
    await call(admin, 'POST', '/missions/:id/delegation-briefs', `/missions/${m1}/delegation-briefs`, { status: 201, headers: key(), body: { toInstanceId: child.managerInstanceId, brief: { ...brief, capabilities: [{ kind: 'read' }] } } });
    await call(admin, 'POST', '/missions/:id/delegation-briefs', `/missions/${m1}/delegation-briefs`, { status: 201, headers: key(), body: { toInstanceId: child.id, brief: { ...brief, capabilities: [{ kind: 'read' }, { kind: 'fill_draft' }] } } });
    const wide = (await admin.req('GET', `/missions/${m1}/delegation-briefs`)).body.briefs.find((b: any) => b.toInstanceId === child.id);
    await call(admin, 'POST', '/missions/:id/delegation-briefs', `/missions/${m1}/delegation-briefs`, { status: 201, headers: key(), body: { toInstanceId: child.id, supersedes: wide.id, taskId: 'T-c50b', brief: { ...brief, capabilities: [{ kind: 'read' }], budget: 3, deadline: dayIso(5) } } });
    await call(admin, 'GET', '/missions/:id/delegation-briefs', `/missions/${m1}/delegation-briefs`);

    // ---- ledgers
    await call(admin, 'GET', '/missions/:id/ledgers', `/missions/${m1}/ledgers`);
    const taskBody = { facts: { given: [{ text: 'Budget is 5k', source: 'mission text' }], to_look_up: [{ text: 'Vendor prices' }], to_derive: [{ text: 'Total cost' }], guesses: [{ text: 'Vendor A is cheaper' }] }, steps: [{ id: 's1', text: 'Collect quotes', owner: 'gm', status: 'todo' }] };
    await call(admin, 'POST', '/missions/:id/ledgers/:kind', `/missions/${m1}/ledgers/task`, { status: 201, body: { baseVersion: 0, body: taskBody } });
    await call(admin, 'POST', '/missions/:id/ledgers/:kind', `/missions/${m1}/ledgers/progress`, { status: 201, body: { baseVersion: 0, body: { satisfied: false, looping: false, progressing: true, next_speaker: 'gm', next_instruction: 'Collect quotes', notes: 'on track' } } });
    for (let v = 1; v <= 3; v++) await call(admin, 'POST', '/missions/:id/ledgers/:kind', `/missions/${m1}/ledgers/progress`, { status: 201, body: { baseVersion: v, body: { satisfied: false, looping: false, progressing: false, notes: 'stuck ' + v } } });
    await call(admin, 'GET', '/missions/:id/ledgers', `/missions/${m1}/ledgers`);
    await call(admin, 'GET', '/missions/:id/ledgers/:kind/versions', `/missions/${m1}/ledgers/progress/versions`, { query: '?limit=1' });
    await call(admin, 'GET', '/missions/:id/ledgers/:kind/versions', `/missions/${m1}/ledgers/task/versions`);
    await call(admin, 'GET', '/missions/:id/ledgers/:kind/:version', `/missions/${m1}/ledgers/task/1`);

    // ---- conversations
    const th = await call(admin, 'POST', '/missions/:id/threads', `/missions/${m1}/threads`, { body: { instanceId: mine[0].id } });
    const threadId = th.body.threadId as string;
    await call(admin, 'POST', '/threads/:id/messages', `/threads/${threadId}/messages`, { status: 201, body: { kind: 'command', text: 'Start with the header.', to: mine[0].id.split(':')[1] }, headers: key() });
    const up2 = multipart('spec.txt', 'Spec text\n');
    const ur2 = await t.app.inject({ method: 'POST', url: '/api/v1/uploads', remoteAddress: '127.0.0.1', headers: { cookie: cookieOf(admin), 'x-csrf': admin.csrf, 'content-type': `multipart/form-data; boundary=${up2.boundary}` }, payload: up2.payload });
    await call(admin, 'POST', '/threads/:id/messages', `/threads/${threadId}/messages`, { status: 201, body: { kind: 'command', text: 'See the attached spec.', to: mine[0].id.split(':')[1], uploadIds: [ur2.json().id] }, headers: key() });
    await call(admin, 'GET', '/threads/:id/messages', `/threads/${threadId}/messages`);
    await call(admin, 'GET', '/missions/:id/threads', `/missions/${m1}/threads`);
    await call(admin, 'POST', '/channels/:key/messages', '/channels/gm/messages', { status: 201, body: { kind: 'command', text: 'Plan my week' }, headers: key() });
    await call(admin, 'GET', '/channels/:key/messages', '/channels/gm/messages');
    await call(admin, 'GET', '/channels/:key/messages', '/channels/gm/messages', { query: '?limit=1' });
    await call(admin, 'POST', '/channels/:key/messages', '/channels/agent:coder-01/messages', { status: 201, body: { kind: 'command', text: 'Hello coder' }, headers: key() });
    await call(mina, 'POST', '/channels/:key/messages', '/channels/admin/messages', { status: 201, body: { kind: 'command', text: 'Need access' }, headers: key() });
    await call(admin, 'GET', '/channels/admin/:userId/messages', `/channels/admin/${minaId}/messages`);
    await call(admin, 'POST', '/channels/admin/:userId/messages', `/channels/admin/${minaId}/messages`, { status: 201, body: { kind: 'reply', text: 'Done.' }, headers: key() });
    await call(admin, 'GET', '/channels', '/channels');
    await call(mina, 'GET', '/channels', '/channels');

    // ---- approvals and notifications
    const ap = await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: m1, agentId: 'release-01', kind: 'release', title: 'Publish homepage', detail: 'Ship it', payload: { v: 1 }, expiresInMin: 30 }));
    await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: m1, agentId: 'release-01', kind: 'release', title: 'Bound request', detail: 'Bound to a task and an origin', payload: { v: 3 }, expiresInMin: 30, taskId: 'T-c50b', origin: 'https://example.com', target: 'site' }));
    await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: m1, agentId: 'release-01', kind: 'release', title: 'Old request', detail: 'Stale', payload: { v: 2 }, expiresInMin: -1 }));
    const apl = await call(admin, 'GET', '/approvals', '/approvals');
    expect((apl.body.approvals as { id: string }[]).some((a) => a.id === ap.id)).toBe(true);
    await call(admin, 'POST', '/approvals/:id/decision', `/approvals/${ap.id}/decision`, { body: { decision: 'approved', digest: ap.digest, reason: 'ok' } });
    // approval.consumed has no producer but the (future) executor: drive the service directly, as the approval tests do
    // c58: five more decisions (the statistics show numbers from five), then the aggregate for everyone and the per-approver table for administrators
    for (let i = 0; i < 5; i++) {
      const q = await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: m1, agentId: 'release-01', kind: 'submit_form', title: `Quality ${i}`, detail: 'For the statistics', payload: { q: i }, expiresInMin: 30 }));
      await call(admin, 'POST', '/approvals/:id/decision', `/approvals/${q.id}/decision`, { body: { decision: i === 4 ? 'denied' : 'approved', digest: q.digest, reason: 'ok' } });
    }
    await call(admin, 'GET', '/approvals/quality', '/approvals/quality');
    await call(mina, 'GET', '/approvals/quality', '/approvals/quality');
    await call(admin, 'GET', '/approvals/quality/approvers', '/approvals/quality/approvers'); // c58: per approver, administrators only
    // c65: review capacity for everyone, per-person rows for administrators only. Twenty decided items so the percentiles are numbers (they are null below 20).
    for (let i = 0; i < 20; i++) await decidedFx({ pool: t.pool, mission: m1 }, `c65cov-${i}`, 'release-01', 5 * 3_600_000, (i + 1) * 60_000, 'u-c65-a', i + 1);
    await call(admin, 'GET', '/review-capacity', '/review-capacity');
    await call(mina, 'GET', '/review-capacity', '/review-capacity', { query: '?windowDays=7' });
    await call(admin, 'GET', '/review-capacity/people', '/review-capacity/people');
    await tx(t.app.db, async (c) => consumeApproval(c, { approvalId: ap.id, action: await loadBoundAction(c, 't-1', ap.id), by: 'release-01' }));
    const nid = await tx(t.app.db, (c) => createNotification(c, { tenantId: 't-1', severity: 'info', category: 'system', title: 'Hello', body: 'World', missionId: m2 }));
    const nl = await call(admin, 'GET', '/notifications', '/notifications');
    expect((nl.body.notifications as { id: string }[]).some((x) => x.id === nid)).toBe(true);
    await call(admin, 'POST', '/notifications/:id/ack', `/notifications/${nid}/ack`);
    await call(admin, 'POST', '/notifications/ack-all', '/notifications/ack-all', { body: { ids: [nid] } });

    // ---- agents, versions, organisation
    await call(admin, 'GET', '/agents', '/agents');
    await call(admin, 'GET', '/agents/:id', '/agents/coder-01', { query: '?includeSimulated=1' });
    // c72 (R3-7): skill vectors. Two agents of mission m1 finish tasks with a class and a difficulty, so every cell state, the unrated count and the compare rows are filled.
    {
      const two = (await t.pool.query(`select id, agent_id, tenant_id from agent_instances where mission_id=$1 order by seq limit 8`, [m1])).rows as { id: string; agent_id: string; tenant_id: string }[];
      const [sa, sb] = [two[0], two.find((r) => r.agent_id !== two[0].agent_id)!];
      let k = 0;
      const fin = async (ag: typeof sa, status: string, cls: string | null, d: number | null) => {
        const id = `T-c72s-${++k}`;
        await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ($1,$2,$3,'c72 fixture',$4,$5)`, [id, ag.tenant_id, m1, status, ag.agent_id]);
        const b = { goal: 'c72 fixture task', inputs: [], acceptance: ['Done'], capabilities: [{ kind: 'read' }], escalation: 'Ask', ...(cls ? { taskClass: cls } : {}), ...(d ? { difficulty: d } : {}) };
        await t.pool.query(`insert into delegation_briefs(tenant_id, mission_id, task_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by, created_at) values ($1,$2,$3,'c72','user',$4,$5,$6,$7,1,'c72', now() - interval '1 hour')`, [ag.tenant_id, m1, id, ag.id, ag.agent_id, JSON.stringify(b), createHash('sha256').update(JSON.stringify(b)).digest('hex')]);
      };
      for (let i = 0; i < 16; i++) { await fin(sa, i < 15 ? 'passed' : 'failed', 'coding', 2 + (i % 2)); await fin(sb, i < 3 ? 'passed' : 'failed', 'coding', 2 + (i % 2)); }
      for (let i = 0; i < 5; i++) await fin(sa, 'passed', 'research', 1);
      await fin(sb, 'passed', 'research', 5);
      await fin(sa, 'passed', 'writing', null); // class without a difficulty: counted as unrated
      const r = await call(admin, 'GET', '/agents/:id/skills', `/agents/${sa.agent_id}/skills`);
      expect((r.body.skills.classes as { state: string }[]).some((c) => c.state === 'ok') && r.body.skills.unrated > 0).toBe(true);
      await call(admin, 'GET', '/agents/:id/skills', `/agents/${sb.agent_id}/skills`, { query: '?includeSimulated=1' });
      const cmp = await call(admin, 'GET', '/agents/:id/skills/compare', `/agents/${sa.agent_id}/skills/compare`, { query: `?with=${sb.agent_id}` });
      expect((cmp.body.compare.classes as { verdict: string }[]).map((c) => c.verdict).sort()).toEqual(['distinguishable', 'indistinguishable']);
    }
    const newAg = await call(admin, 'POST', '/agents', '/agents', { status: 201, body: { name: 'Audit Bot', role: 'Auditor', dept: 'Ops', duty: 'Audit the audits', model: 'test-model', skills: ['audit'], tools: [], parentId: 'ops-01' }, headers: key() });
    await call(admin, 'PATCH', '/agents/:id', `/agents/${newAg.body.agent.id}`, { body: { description: 'Audits things.' }, headers: { 'if-match': String(newAg.body.agent.rowVersion) } });
    const cur = (await admin.req('GET', `/agents/${newAg.body.agent.id}`)).body.agent;
    await call(admin, 'PATCH', '/agents/:id', `/agents/${newAg.body.agent.id}`, { body: { skills: ['audit', 'report'] }, headers: { 'if-match': String(cur.rowVersion) } });
    // version proposals: Bea proposes, Luca promotes; a second one is withdrawn; then a rollback
    const bb = bea.b;
    expect((await admin.req('GET', '/agents/coder-01')).status).toBe(200);
    const coder = (await admin.req('GET', '/agents/coder-01')).body.agent;
    const cand = (skill: string) => ({ model: coder.model, skills: [...coder.skills, skill], tools: coder.tools });
    await call(admin, 'GET', '/version-proposals', '/version-proposals');
    await call(admin, 'GET', '/agents/:id/version-proposals', '/agents/coder-01/version-proposals');
    const vp1 = (await call(bb, 'POST', '/agents/:id/version-proposals', '/agents/coder-01/version-proposals', { status: 201, headers: key(), body: { title: 'Add Svelte', hypothesis: 'Fewer review rounds.', candidate: cand('Svelte'), baseVersionId: coder.versionId } })).body.proposal;
    // c47: stored evaluation records (a frozen holdout dataset and a finished run each for the base and the candidate, by a third person), so the
    // evaluation object is filled in the lists and the promote carries the evaluationSha the reviewer saw. Records only: nothing is executed.
    // c61: attested before the freeze by an administrator who is not the author, so the evaluation carries a non-null attested version
    const adminId = (await t.pool.query(`select id from users where role='admin' and status='approved' order by created_at limit 1`)).rows[0].id;
    await makeDataset(t.pool, { id: 'HO-c50', split: 'holdout', cases: 12, createdBy: minaId, attestBy: adminId });
    await addRun(t.pool, { id: 'c50-base', datasetId: 'HO-c50', versionId: coder.versionId, scores: Array.from({ length: 12 }, () => 40), evaluator: minaId, judge: 'gpt-judge', grader: { name: 'rubric', version: '1' } });
    await addRun(t.pool, { id: 'c50-cand', datasetId: 'HO-c50', proposalId: vp1.id, scores: Array.from({ length: 12 }, (_, i) => 70 + (i % 3)), evaluator: minaId, judge: 'gpt-judge', grader: { name: 'rubric', version: '2' } });
    // c61: the base run was graded by version 1 and the candidate by version 2; a re-grade diff links them (so the DTO carries the re-grade and both graders)
    { const gc = await t.pool.connect(); try { await recordRegrade(gc, { id: 'c61-rg', tenantId: 't-1', runId: 'c50-base', to: { name: 'rubric', version: '2' }, by: adminId, cases: Array.from({ length: 12 }, (_, i) => ({ caseId: 'c' + String(i + 1).padStart(2, '0'), attempt: 1, newScore: 40 })) }); } finally { gc.release(); } }
    const evaluated = ((await call(admin, 'GET', '/agents/:id/version-proposals', '/agents/coder-01/version-proposals')).body.proposals as any[]).find((x) => x.id === vp1.id);
    expect(evaluated.evaluation?.outcome, 'the stored runs give a verified evaluation: ' + JSON.stringify(evaluated.evaluation?.refusals)).toBe('verified_better');
    await call(admin, 'GET', '/version-proposals', '/version-proposals');
    await call(admin, 'POST', '/version-proposals/:pid/decision', `/version-proposals/${vp1.id}/decision`, { body: { decision: 'promote', sha: vp1.sha, evaluationSha: evaluated.evaluationSha, note: 'ok' } });
    const coder2 = (await admin.req('GET', '/agents/coder-01')).body.agent;
    const vp2 = (await bb.req('POST', '/agents/coder-01/version-proposals', { title: 'Add Go', hypothesis: 'x', candidate: { model: 'another-model', skills: [...coder2.skills, 'Go'], tools: coder2.tools }, baseVersionId: coder2.versionId }, key())).body.proposal;
    await call(bb, 'POST', '/version-proposals/:pid/withdraw', `/version-proposals/${vp2.id}/withdraw`, { body: {} });
    // a third proposal whose evidence is not honest (the judge is the candidate's own model family): the evaluation carries refusals, so promoting it needs the administrator's override reason
    const vp3 = (await bb.req('POST', '/agents/coder-01/version-proposals', { title: 'Add Rust', hypothesis: 'y', candidate: { model: coder2.model, skills: [...coder2.skills, 'Rust'], tools: coder2.tools }, baseVersionId: coder2.versionId }, key())).body.proposal;
    await addRun(t.pool, { id: 'c50-base3', datasetId: 'HO-c50', versionId: coder2.versionId, scores: Array.from({ length: 12 }, () => 40), evaluator: minaId });
    await addRun(t.pool, { id: 'c50-cand3', datasetId: 'HO-c50', proposalId: vp3.id, scores: Array.from({ length: 12 }, (_, i) => 41 + (i % 2)), evaluator: minaId });
    const flawed = ((await admin.req('GET', '/agents/coder-01/version-proposals')).body.proposals as any[]).find((x) => x.id === vp3.id);
    expect(flawed.evaluation?.refusals.length, 'the self-judged runs are refused').toBeGreaterThan(0);
    await call(admin, 'POST', '/version-proposals/:pid/decision', `/version-proposals/${vp3.id}/decision`, { body: { decision: 'promote', sha: vp3.sha, evaluationSha: flawed.evaluationSha, overrideReason: 'Promoting on the reviewer\'s judgement for the contract run.', note: 'override' } });
    await call(admin, 'GET', '/version-proposals', '/version-proposals');
    await call(admin, 'GET', '/agents/:id/version-proposals', '/agents/coder-01/version-proposals');
    await call(admin, 'POST', '/agents/:id/rollback', '/agents/coder-01/rollback', { headers: key(), body: { toVersionId: coder.versionId, why: 'The new skill confused reviews.' } });
    // organisation (c64: the churn budget is set for the whole section, and the cooldown from the rollback on, so every churn field is filled in some call)
    (t.app.cfg as { orgGuardrails?: object }).orgGuardrails = { churnBudget: 100, churnWindowHours: 24 };
    const g = (await call(admin, 'GET', '/organization/graph', '/organization/graph')).body;
    await call(admin, 'GET', '/organization/revisions', '/organization/revisions');
    await call(admin, 'GET', '/organization/coverage', '/organization/coverage');
    const moved = (edges: any[], sub: string, sup: string) => edges.map((e) => (e.subordinateId === sub ? { ...e, supervisorId: sup } : e));
    const baseRev = async () => (await admin.req('GET', '/organization/graph')).body.revision.seq as number;
    await call(admin, 'POST', '/organization/proposals', '/organization/proposals', { status: 200, query: '?dryRun=1', body: { title: 'dry', why: 'x', baseRevision: await baseRev(), edges: moved(g.edges, 'tester-01', 'coder-01'), triggers: ['repeated_reassigns'] } });
    const p1 = (await call(admin, 'POST', '/organization/proposals', '/organization/proposals', { status: 201, body: { ...ST, title: 'Move tester', why: 'Shorter path.', baseRevision: await baseRev(), edges: moved(g.edges, 'tester-01', 'coder-01'), triggers: ['coverage_gap', 'load_imbalance'] }, headers: key() })).body.proposal;
    await call(bea.b, 'POST', '/organization/proposals/:id/decision', `/organization/proposals/${p1.id}/decision`, { body: { decision: 'approve', sha: p1.sha, note: 'ok' } });
    const g2 = (await admin.req('GET', '/organization/graph')).body;
    const p2 = (await admin.req('POST', '/organization/proposals', { ...ST, title: 'Move writer', why: 'x', baseRevision: g2.revision.seq, edges: moved(g2.edges, 'writer-01', 'ops-01') }, key())).body.proposal;
    await call(admin, 'POST', '/organization/proposals/:id/withdraw', `/organization/proposals/${p2.id}/withdraw`, { body: {} });
    const p3 = (await admin.req('POST', '/organization/proposals', { ...ST, title: 'Expire me', why: 'x', baseRevision: g2.revision.seq, edges: moved(g2.edges, 'writer-01', 'coder-01') }, key())).body.proposal;
    await t.pool.query(`update org_proposals set expires_at = now() - interval '1 minute' where id=$1`, [p3.id]);
    // a proposal whose reporting lines leave an agent without a manager is stored with its dry-run errors (applying it is refused)
    await call(admin, 'POST', '/organization/proposals', '/organization/proposals', { status: 200, query: '?dryRun=1', body: { title: 'dry orphan', why: 'x', baseRevision: g2.revision.seq, edges: g2.edges.filter((e: any) => e.subordinateId !== 'tester-01') } });
    const bad = (await call(admin, 'POST', '/organization/proposals', '/organization/proposals', { status: 201, body: { ...ST, title: 'Orphan', why: 'x', baseRevision: g2.revision.seq, edges: g2.edges.filter((e: any) => e.subordinateId !== 'tester-01') }, headers: key() })).body.proposal;
    expect(bad.result.errors.length).toBeGreaterThan(0);
    await call(bea.b, 'POST', '/organization/proposals/:id/decision', `/organization/proposals/${bad.id}/decision`, { body: { decision: 'reject', sha: bad.sha, note: 'Orphans an agent.' } });
    const bad2 = (await admin.req('POST', '/organization/proposals', { ...ST, title: 'Orphan 2', why: 'x', baseRevision: g2.revision.seq, edges: g2.edges.filter((e: any) => e.subordinateId !== 'tester-01') }, key())).body.proposal;
    await call(admin, 'POST', '/organization/proposals/:id/withdraw', `/organization/proposals/${bad2.id}/withdraw`, { body: {} });
    await call(admin, 'GET', '/organization/proposals', '/organization/proposals');
    const revs = (await admin.req('GET', '/organization/revisions')).body.revisions as { seq: number }[];
    const first = Math.min(...revs.map((r) => r.seq)), last = Math.max(...revs.map((r) => r.seq));
    await call(admin, 'GET', '/organization/revisions/:seq', `/organization/revisions/${last}`);
    await call(admin, 'GET', '/organization/revisions/:seq/diff', `/organization/revisions/${last}/diff`, { query: `?against=${first}` });
    await call(admin, 'GET', '/organization/revisions/:seq/diff', `/organization/revisions/${first}/diff`, { query: `?against=${last}` });
    // c64 fix round (S1): a rollback is exempt only as the undo of the last change a proposal made, so the running cooldown is shown on a dry run, and the rollback below runs with the cooldown off
    (t.app.cfg as { orgGuardrails?: object }).orgGuardrails = { churnBudget: 100, churnWindowHours: 24, cooldownHours: 24 };
    const g3 = (await admin.req('GET', '/organization/graph')).body;
    await call(admin, 'POST', '/organization/proposals', '/organization/proposals', { status: 200, query: '?dryRun=1', body: { title: 'dry cooldown', why: 'x', baseRevision: g3.revision.seq, edges: moved(g3.edges, 'writer-01', 'ops-01') } });
    (t.app.cfg as { orgGuardrails?: object }).orgGuardrails = { churnBudget: 100, churnWindowHours: 24 };
    const p4 = (await admin.req('POST', '/organization/proposals', { ...ST, title: 'Move writer again', why: 'x', baseRevision: g3.revision.seq, edges: moved(g3.edges, 'writer-01', 'ops-01') }, key())).body.proposal;
    expect((await bea.b.req('POST', `/organization/proposals/${p4.id}/decision`, { decision: 'approve', sha: p4.sha })).status).toBe(200);
    // the undo of that change is the one exempt rollback: it is stored with the cooldown running and marked exempt
    (t.app.cfg as { orgGuardrails?: object }).orgGuardrails = { churnBudget: 100, churnWindowHours: 24, cooldownHours: 24 };
    const undo = await baseRev() - 1;
    await call(admin, 'POST', '/organization/revisions/:seq/rollback-proposal', `/organization/revisions/${undo}/rollback-proposal`, { status: 201, headers: key(), body: { why: 'Back to the start.', triggers: ['failure_concentration'] } });

    // ---- mentoring
    await call(admin, 'GET', '/mentoring', '/mentoring');
    const plan = (await call(admin, 'POST', '/agents/:id/mentoring', '/agents/tester-01/mentoring', { status: 201, headers: key(), body: { mentorId: 'coder-01', skill: 'Unit testing', milestones: ['Write one test', 'Review one test'], reevalOn: dayIso(30).slice(0, 10) } })).body.plan;
    await call(admin, 'GET', '/agents/:id/mentoring', '/agents/tester-01/mentoring');
    await call(admin, 'POST', '/mentoring/:pid/milestones/:mid/done', `/mentoring/${plan.id}/milestones/${plan.milestones[0].id}/done`, { body: {} });
    await call(admin, 'GET', '/mentoring', '/mentoring');
    await call(admin, 'POST', '/mentoring/:pid/close', `/mentoring/${plan.id}/close`, { body: { outcome: 'completed', note: 'Done.' } });

    // ---- playbooks and skills (the member proposes, the administrator decides)
    const src = [{ kind: 'review', id: 'REV-1', note: 'Reviewer asked for it twice' }];
    await call(admin, 'GET', '/agents/:id/playbook', '/agents/coder-01/playbook');
    const l1 = (await call(mina, 'POST', '/agents/:id/lessons', '/agents/coder-01/lessons', { status: 201, headers: key(), body: { text: 'Run the linter before every commit', sources: src } })).body.lesson;
    await call(admin, 'GET', '/lessons', '/lessons');
    await call(admin, 'GET', '/lessons/:lid', `/lessons/${l1.id}`);
    await call(admin, 'POST', '/lessons/:lid/decision', `/lessons/${l1.id}/decision`, { body: { decision: 'accept', baseVersion: 0, note: 'Good practice.' } });
    const lc = (await call(mina, 'POST', '/agents/:id/lessons', '/agents/coder-01/lessons', { status: 201, headers: key(), body: { text: 'Never run the linter before every commit', sources: src } })).body.lesson;
    expect(lc.conflicts.length).toBeGreaterThan(0);
    await call(admin, 'GET', '/lessons/:lid', `/lessons/${lc.id}`);
    await call(admin, 'GET', '/lessons', '/lessons');
    await call(admin, 'POST', '/lessons/:lid/decision', `/lessons/${lc.id}/decision`, { body: { decision: 'accept', baseVersion: 1, overrideNote: 'A deliberate exception for generated files.' } });
    const l2 = (await mina.req('POST', '/agents/coder-01/lessons', { text: 'Keep pull requests small', sources: src, reviewBy: dayIso(60).slice(0, 10) }, key())).body.lesson;
    await admin.req('POST', `/lessons/${l2.id}/decision`, { decision: 'accept', baseVersion: 2 });
    await call(admin, 'GET', '/agents/:id/playbook', '/agents/coder-01/playbook');
    await call(admin, 'GET', '/agents/:id/playbook/versions/:v', '/agents/coder-01/playbook/versions/1');
    await call(admin, 'GET', '/agents/:id/playbook/diff', '/agents/coder-01/playbook/diff', { query: '?from=1&to=2' });
    await call(admin, 'GET', '/agents/:id/playbook/diff', '/agents/coder-01/playbook/diff', { query: '?from=2&to=1' });
    await call(admin, 'GET', '/agents/:id/playbook/diff', '/agents/coder-01/playbook/diff', { query: '?from=2&to=3' });
    await call(admin, 'GET', '/agents/:id/playbook/diff', '/agents/coder-01/playbook/diff', { query: '?from=3&to=2' });
    await call(admin, 'POST', '/agents/:id/playbook/rollback', '/agents/coder-01/playbook/rollback', { body: { toVersion: 1, baseVersion: 3, why: 'Too strict for now.' } });
    const skillBody = (name: string) => ({ name, description: 'Open the admin page and check the status.', steps: [{ kind: 'navigate', detail: 'Open the status page', origin: 'https://status.example.com' }, { kind: 'observe', detail: 'Read the banner' }], preconditions: ['Signed in'], sources: src });
    const s1 = (await call(mina, 'POST', '/skills', '/skills', { status: 201, headers: key(), body: skillBody('Check status page') })).body.skill;
    const s2 = (await mina.req('POST', '/skills', skillBody('Read the dashboard'), key())).body.skill;
    await call(admin, 'GET', '/skills', '/skills');
    await call(admin, 'GET', '/skills/:sid', `/skills/${s1.id}`);
    await call(admin, 'POST', '/skills/:sid/approve', `/skills/${s1.id}/approve`, { body: {} });
    await admin.req('POST', `/skills/${s2.id}/approve`, {});
    await call(admin, 'POST', '/skills/:sid/retire', `/skills/${s2.id}/retire`, { body: { note: 'Replaced.' } });
    // c59: origin classes (a tool-channel item and a derived one), the contribution log, and a fixture-only retirement proposal
    await call(admin, 'GET', '/skills/retirement-proposals', '/skills/retirement-proposals'); // nothing scored yet: dataState none
    const toolLesson = await tx(t.app.db, (c) => proposeLesson(c, { tenantId: t.app.cfg.tenantId, agentId: 'coder-01', proposedBy: 'tester-01', kind: 'agent', submittedBy: A.adminId, channel: 'tool_output', text: 'The linter output says to pin versions', sources: src as any, correlationId: 'c59-flow' }));
    const derived = (await call(admin, 'POST', '/agents/:id/lessons', '/agents/coder-01/lessons', { status: 201, headers: key(), body: { text: 'Pin versions, a summary of the linter output', sources: [{ kind: 'lesson', id: toolLesson }, ...src] } })).body.lesson;
    expect(derived).toMatchObject({ originChannel: 'derived', originClass: 'tool' });
    await call(admin, 'GET', '/lessons/:lid/contributions', `/lessons/${toolLesson}/contributions`); // filed by a person on an agent's behalf
    await call(admin, 'GET', '/lessons/:lid/contributions', `/lessons/${l1.id}/contributions`);
    await call(admin, 'GET', '/lessons/:lid/contributions', `/lessons/${lc.id}/contributions`);
    await call(admin, 'GET', '/lessons/:lid/contributions', `/lessons/${derived.id}/contributions`);
    await call(mina, 'GET', '/lessons/:lid/contributions', `/lessons/${l2.id}/contributions`);
    await call(admin, 'GET', '/skills/:sid/contributions', `/skills/${s2.id}/contributions`);
    await call(admin, 'GET', '/skills/:sid/contributions', `/skills/${s1.id}/contributions`);
    const agentSkill = await tx(t.app.db, (c) => proposeSkill(c, { tenantId: t.app.cfg.tenantId, proposedBy: 'tester-01', kind: 'agent', submittedBy: A.adminId, channel: 'tool_output', ...skillBody('Agent-filed skill'), preconditions: [], correlationId: 'c59-flow' } as any));
    await call(admin, 'GET', '/skills/:sid/contributions', `/skills/${agentSkill}/contributions`);
    const scored = (await call(mina, 'POST', '/skills', '/skills', { status: 201, headers: key(), body: skillBody('Scored by a fixture') })).body.skill;
    await admin.req('POST', `/skills/${scored.id}/approve`, {});
    await tx(t.app.db, (c) => recordFixtureOutcome(c, { tenantId: t.app.cfg.tenantId, skillId: scored.id, score: 0.1, n: 8 }));
    await call(admin, 'GET', '/skills/retirement-proposals', '/skills/retirement-proposals');
    await call(admin, 'POST', '/skills/:sid/retirement-dismiss', `/skills/${scored.id}/retirement-dismiss`, { body: { note: 'Fixture only.' } });
    await call(admin, 'GET', '/skills/:sid/contributions', `/skills/${scored.id}/contributions`);

    // ---- site grants, failure tags
    await call(admin, 'GET', '/site-grants', '/site-grants');
    await call(admin, 'GET', '/site-grants/validate', '/site-grants/validate', { query: '?origin=' + encodeURIComponent('https://example.com') });
    await call(admin, 'GET', '/site-grants/validate', '/site-grants/validate', { query: '?origin=' + encodeURIComponent('http://localhost') });
    const gr = (await call(admin, 'POST', '/site-grants', '/site-grants', { status: 201, headers: key(), body: { origin: 'https://example.com', missionId: m1, capabilities: ['read', 'screenshot'], expiresAt: dayIso(2) } })).body.grant;
    await call(admin, 'GET', '/site-grants', '/site-grants');
    await call(admin, 'POST', '/site-grants/:id/revoke', `/site-grants/${gr.id}/revoke`, { body: { reason: 'No longer needed' } });
    await call(admin, 'GET', '/failure-tags', '/failure-tags', { query: '?subjectKind=task&subjectId=T-c50a' });
    const tag = (await call(admin, 'POST', '/failure-tags', '/failure-tags', { status: 201, headers: key(), body: { subjectKind: 'task', subjectId: 'T-c50a', modeId: 'FM-1.1', note: 'It ignored the spec.', attribution: { agentId: 'agent-c60', stepRef: 'step-2' } } })).body.tag;
    await call(admin, 'POST', '/failure-tags/:id/decision', `/failure-tags/${tag.id}/decision`, { body: { decision: 'confirm' } });
    // a decision does not close attribution: a second view is appended after it (the response then shows the decided fields filled)
    await call(admin, 'POST', '/failure-tags/:id/attributions', `/failure-tags/${tag.id}/attributions`, { status: 201, headers: key(), body: { agentId: 'agent-c60b', stepRef: 'step-4', fullTraceAvailable: true } });
    // c63: detection fields. Six confirmed tags with a channel (so the "found only by a person" share is a number), one carrying every field, and one with "other" and its note.
    for (const [id, dept] of [['agent-c63x', 'C63 Alpha'], ['agent-c63y', 'C63 Beta']]) await t.pool.query(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ($1,$2,$1,'worker',$3,$1,'u-x')`, [id, tenant, dept]);
    for (let i = 0; i < 6; i++) { // two departments, so the third confirmed failure of FM-3.2 opens a recurrence candidate (c63 item 2)
      await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ($1,$2,$3,'A task','failed',$4)`, [`T-c63${i}`, tenant, m1, i % 2 ? 'agent-c63x' : 'agent-c63y']);
      await t.pool.query(`insert into task_attempts(task_id, attempt_no, result, started_at, finished_at) values ($1, 1, 'failed', now() - interval '3 hours', now() - interval '2 hours')`, [`T-c63${i}`]);
      const body = i === 0 ? { detectionChannel: 'human_review', mechanism: 'other', detectionNote: 'An outside vendor changed a field.', controlExpected: 'test', controlCaught: 'review' } : { detectionChannel: i % 2 ? 'test' : 'human_review' };
      const dt = (await call(admin, 'POST', '/failure-tags', '/failure-tags', { status: 201, headers: key(), body: { subjectKind: 'task', subjectId: `T-c63${i}`, modeId: 'FM-3.2', ...body } })).body.tag;
      if (i === 0) { // the decide and attribute responses show the same tag with its detection fields filled
        await call(admin, 'POST', '/failure-tags/:id/decision', `/failure-tags/${dt.id}/decision`, { body: { decision: 'confirm' } });
        await call(admin, 'POST', '/failure-tags/:id/attributions', `/failure-tags/${dt.id}/attributions`, { status: 201, headers: key(), body: { agentId: 'agent-c63', stepRef: 'step-1' } });
      } else await admin.req('POST', `/failure-tags/${dt.id}/decision`, { decision: 'confirm' });
    }
    await call(admin, 'GET', '/failure-tags', '/failure-tags', { query: '?subjectKind=task&subjectId=T-c630' });
    await call(admin, 'GET', '/company/failure-patterns', '/company/failure-patterns');
    // c68: a task waiting on a person for days with no state-change event (the wait is counted from its creation, so ageNote is set)
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, created_at) values ('T-c68-wait',$1,$2,'Waiting','waiting_user','agent-c63', now() - interval '3 days')`, [tenant, m1]);
    // c68: the attention queue, for an administrator (rows of several kinds) and for a member
    const att = (await call(admin, 'GET', '/attention', '/attention')).body;
    expect(att.rows.length).toBeGreaterThan(0);
    await call(mina, 'GET', '/attention', '/attention');
    await call(admin, 'GET', '/failure-tags', '/failure-tags', { query: '?subjectKind=task&subjectId=T-c50a' });
    await call(admin, 'GET', '/site-grants', '/site-grants');

    // ---- company, ops, policy, audit
    await call(admin, 'GET', '/company/scorecard', '/company/scorecard', { query: '?window=7d&includeDemo=1' });
    await call(mina, 'GET', '/company/scorecard', '/company/scorecard');
    await call(admin, 'GET', '/company/throughput', '/company/throughput', { query: '?weeks=4' });
    await call(admin, 'GET', '/company/failure-modes', '/company/failure-modes', { query: '?window=30d' });
    const dim = (await call(admin, 'GET', '/company/dimensions', '/company/dimensions', { query: '?window=30d' })).body;
    await call(admin, 'GET', '/company/dimensions', '/company/dimensions', { query: `?window=7d&department=${encodeURIComponent(dim.departments[0])}` });
    await call(mina, 'GET', '/company/dimensions', '/company/dimensions');
    await call(admin, 'GET', '/company/metric-guard', '/company/metric-guard');
    await call(admin, 'POST', '/company/metric-audits', '/company/metric-audits', { status: 201, body: { metricId: 'scorecard.finished', samples: Array.from({ length: 100 }, (_, i) => ({ sampleRef: `m${i}`, metricLabel: true, auditLabel: i >= 20 })) } });
    await call(mina, 'GET', '/company/metric-guard', '/company/metric-guard');
    await call(admin, 'GET', '/company/metric-guard', '/company/metric-guard'); // second read: the audit state is now filled
    await call(mina, 'GET', '/departments', '/departments');
    await call(admin, 'GET', '/departments', '/departments', { query: '?window=7d&includeDemo=1' });
    await call(admin, 'GET', '/operations/health', '/operations/health');
    await enqueueJob(t.app.db, { tenantId: tenant, kind: 'noop.test', idempotencyKey: 'c50-queue', createdBy: users.find((u) => u.name === 'Luca')!.id });
    await call(admin, 'GET', '/operations/queues', '/operations/queues');
    // c57 (H13): configured but no file yet (reported, never ok), then a written checkpoint (ok, anchored head), then a signed rotation
    const none = (await call(admin, 'GET', '/operations/anchors', '/operations/anchors')).body;
    expect(none).toMatchObject({ configured: false, ok: false, lastAnchorAt: null, restartedAt: null });
    const written = await writeAnchor(t.pool, anchorCfg);
    const anchored = (await call(admin, 'GET', '/operations/anchors', '/operations/anchors')).body;
    expect(anchored).toMatchObject({ configured: true, ok: true, restartedAt: null });
    expect(anchored.tenants[0]).toMatchObject({ status: 'ok' });
    expect(anchored.tenants[0].anchoredSeq).toBeGreaterThan(0);
    expect(anchored.lastAnchorAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    await rotateAnchor(t.pool, { ...anchorCfg, confirm: written.lastN, force: true });
    const rotated = (await call(admin, 'GET', '/operations/anchors', '/operations/anchors')).body;
    expect(rotated).toMatchObject({ configured: true, ok: true });
    expect(rotated.restartedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(JSON.stringify([none, anchored, rotated])).not.toContain(anchorCfg.key);
    await call(admin, 'GET', '/policy/baseline', '/policy/baseline');
    await call(admin, 'GET', '/audit/verify', '/audit/verify');

    // ---- error shapes the server must keep (envelope checked by call())
    await call(admin, 'GET', '/missions/:id', '/missions/M-999999', { status: 404 });
    await call(admin, 'PATCH', '/missions/:id', `/missions/${m1}`, { body: { title: 'x' }, status: 428 });
    await call(admin, 'POST', '/tasks/:id/:action', '/tasks/T-c50a/start', { body: {}, headers: key(), status: 403 });
    await call(admin, 'POST', '/missions', '/missions', { status: 400, body: { nope: 1 } });
    await call(anon, 'GET', '/users', '/users', { status: 401 });

    // ---- second read of every list and detail after all the writes: lifecycle fields (decidedBy, closedAt...) and criteria are filled now
    await t.pool.query(`update agent_instances set ended_at = now() where id = $1`, [mine[mine.length - 1].id]);
    await call(admin, 'GET', '/missions', '/missions');
    await call(admin, 'GET', '/missions/:id', `/missions/${m1}`);
    await call(admin, 'GET', '/agent-instances', '/agent-instances');
    await call(admin, 'GET', '/agent-instances/:id', `/agent-instances/${encodeURIComponent(mine[mine.length - 1].id)}`);
    await call(admin, 'GET', '/agents', '/agents');
    await call(admin, 'GET', '/agents/:id', `/agents/${newAg.body.agent.id}`);
    await call(admin, 'GET', '/agents/:id', '/agents/coder-01');
    await call(admin, 'GET', '/agents/:id/mentoring', '/agents/tester-01/mentoring');
    await call(admin, 'GET', '/mentoring', '/mentoring');
    await call(admin, 'GET', '/agents/:id/playbook', '/agents/coder-01/playbook');
    await call(admin, 'GET', '/agents/:id/playbook/versions/:v', '/agents/coder-01/playbook/versions/3');
    await call(admin, 'GET', '/agents/:id/playbook/versions/:v', '/agents/coder-01/playbook/versions/4');
    await call(admin, 'GET', '/lessons', '/lessons');
    await call(admin, 'GET', '/lessons/:lid', `/lessons/${l1.id}`);
    await call(admin, 'GET', '/lessons/:lid', `/lessons/${l2.id}`);
    await call(admin, 'GET', '/lessons/:lid', `/lessons/${lc.id}`);
    const own = (await call(admin, 'POST', '/agents/:id/lessons', '/agents/coder-01/lessons', { status: 201, headers: key(), body: { text: 'Name branches after the ticket', sources: src } })).body.lesson;
    await call(admin, 'GET', '/lessons/:lid', `/lessons/${own.id}`);
    await call(admin, 'GET', '/lessons', '/lessons');
    const ownSkill = (await call(admin, 'POST', '/skills', '/skills', { status: 201, headers: key(), body: skillBody('Admin-proposed skill') })).body.skill;
    await call(admin, 'GET', '/skills/:sid', `/skills/${ownSkill.id}`);
    await call(mina, 'GET', '/lessons', '/lessons');
    await call(mina, 'GET', '/lessons/:lid', `/lessons/${l2.id}`);
    await call(mina, 'GET', '/skills', '/skills');
    await call(mina, 'GET', '/skills/:sid', `/skills/${s2.id}`);
    await call(admin, 'GET', '/skills', '/skills');
    await call(admin, 'GET', '/skills/:sid', `/skills/${s2.id}`);
    await call(admin, 'GET', '/approvals', '/approvals');
    await call(admin, 'GET', '/version-proposals', '/version-proposals');
    await call(admin, 'GET', '/agents/:id/version-proposals', '/agents/coder-01/version-proposals');
    await call(admin, 'GET', '/missions/:id/delegation-briefs', `/missions/${m1}/delegation-briefs`);
    await call(admin, 'GET', '/missions/:id/ledgers', `/missions/${m1}/ledgers`);
    await call(admin, 'GET', '/missions/:id/ledgers/:kind/:version', `/missions/${m1}/ledgers/task/1`);
    await call(admin, 'GET', '/missions/:id/ledgers/:kind/versions', `/missions/${m1}/ledgers/progress/versions`);
    await call(admin, 'GET', '/missions/:id/threads', `/missions/${m1}/threads`);
    await call(admin, 'GET', '/threads/:id/messages', `/threads/${threadId}/messages`, { query: '?limit=1' });
    await call(admin, 'GET', '/channels/admin/:userId/messages', `/channels/admin/${minaId}/messages`, { query: '?limit=1' });
    await call(admin, 'GET', '/channels/:key/messages', '/channels/agent:coder-01/messages');
    await call(admin, 'GET', '/notifications', '/notifications');
    await call(admin, 'GET', '/organization/proposals', '/organization/proposals');
    await call(admin, 'GET', '/organization/revisions', '/organization/revisions');
    await call(admin, 'GET', '/tasks/:id/reviews', '/tasks/T-c50r/reviews');
    await call(admin, 'GET', '/site-grants', '/site-grants');
    await call(admin, 'GET', '/operations/health', '/operations/health');
    await call(admin, 'GET', '/channels', '/channels');

    // ---- member sweep: EVERY checked route is replayed as a member, with the real ids and bodies of its happy call.
    // Flagged administrator routes must answer 403 FORBIDDEN (and only they); any other 403 must be explained in allowlists.ts.
    const sweeper = (await A.member('Sweeper')).b;
    for (const [k, e] of Object.entries(ROUTES)) {
      if (!('v' in e) || k in SWEEP_SKIP) continue;
      const rq = requests[k];
      if (!rq) continue; // multipart upload: no replayable request; the hits assertion still requires its call
      const r = await sweeper.req(rq.method, rq.url, rq.body, rq.method === 'GET' ? {} : key());
      if (r.status >= 500) problems.push(`sweep ${k}: member got ${r.status}`);
      if (e.admin) {
        if (r.status !== 403 || r.body?.code !== 'FORBIDDEN' || r.body?.message !== 'Only an administrator can do this.') problems.push(`sweep ${k}: flagged admin but a member got ${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`);
        else if (!check(`sweep ${k}`, errorEnvelope, r.body).length) gated.add(k);
      } else if (r.status === 403) {
        if (!(k in MEMBER_403_ALLOWED)) problems.push(`sweep ${k}: a member got 403 ${r.body?.code} from a route not flagged admin (flag it, or explain it in allowlists.ts)`);
        problems.push(...check(`sweep ${k}`, errorEnvelope, r.body));
      } else if (r.status >= 400) problems.push(...check(`sweep ${k}`, errorEnvelope, r.body));
    }

    // instance.stateChanged has no producer except this service helper (nothing executes yet), so it is driven directly
    await tx(t.app.db, (c) => setInstanceState(c, mine[1].id, 'blocked'));

    // ---- delete, then collect the events
    await call(admin, 'DELETE', '/missions/:id', `/missions/${m2}`);
    await new Promise((r) => setTimeout(r, 400));
    streamEvents = stream.events.filter((e) => !['hello', 'ping'].includes(e.event));
    stream.close();
    void tenant;
    void [routeKey, TEST_DB];
  }, 180_000);

  it('drives the stalled-staffing retry route', async () => {
    const s = await makeTestApp({ staffingStepMs: 1, configure: recordServed });
    try {
      const A2 = await withAdmin(s.app);
      await s.pool.query(`create function stall_boom() returns trigger language plpgsql as $$ begin raise exception 'forced staffing failure'; end $$`);
      await s.pool.query(`create trigger stall_boom before insert on agent_instances for each row execute function stall_boom()`);
      const m = (await A2.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: true }, key())).body.mission.id as string;
      expect(await until(async () => !!(await A2.admin.req('GET', `/missions/${m}`)).body.mission.staffing?.stalled, 40_000)).toBe(true);
      await s.pool.query(`drop trigger stall_boom on agent_instances`);
      await call(A2.admin, 'POST', '/missions/:id/staffing/retry', `/missions/${m}/staffing/retry`, { body: {}, headers: key() });
      stalledEvents = (await s.pool.query(`select * from events where type in ('staffing.stalled','staffing.resumed') order by id`)).rows.map(eventDto);
      expect(stalledEvents.map((e) => e.type)).toEqual(['staffing.stalled', 'staffing.resumed']);
    } finally { await s.close(); }
  }, 90_000);

  it('validates every domain event of the runs (the stored rows and the live stream)', async () => {
    const errs: string[] = [];
    const seen = new Set<string>();
    const rows = (await t.pool.query('select * from events order by id')).rows.map(eventDto);
    eventRows = [...rows, ...stalledEvents];
    for (const ev of eventRows) { errs.push(...checkEvent(ev).map((e) => `[row ${ev.id}] ${e}`)); seen.add(ev.type); }
    expect(streamEvents.length, 'the live stream delivered the flow').toBeGreaterThan(20);
    for (const e of streamEvents) {
      if (e.event !== e.data.type) errs.push(`sse name ${e.event} != payload type ${e.data.type}`);
      errs.push(...checkEvent(e.data).map((x) => `[sse ${e.data.id}] ${x}`));
    }
    expect(errs, 'event drift').toEqual([]);
    const unseen = Object.keys(EVENT_VALIDATORS).filter((x) => !seen.has(x));
    expect(unseen, 'event types the coverage run never produced').toEqual([]);
  });

  it('every checked route got a contract-valid call, every administrator route a 403, and nothing drifted', () => {
    const checked = Object.entries(ROUTES).filter(([, e]) => 'v' in e).map(([k]) => k);
    const admins = Object.entries(ROUTES).filter(([, e]) => 'v' in e && e.admin).map(([k]) => k);
    writeDump();
    expect(problems, 'contract drift').toEqual([]);
    expect(checked.filter((k) => !hits.has(k)), 'routes without a contract-valid 2xx call').toEqual([]);
    expect(admins.filter((k) => !gated.has(k)), 'administrator routes without a validated 403 as a member').toEqual([]);
    expect([...hits].filter((h) => !(h in ROUTES)), 'hits that are not registry entries (typo in a pattern)').toEqual([]);
    
    writeDump();
  });

  it('non-vacuous, node by node: every validator rejects an extra key, a missing key and a null on every object node of its richest real body (routes and events)', () => {
    const lenient: string[] = [];
    let tried = 0;
    const richest = (xs: unknown[]) => xs.reduce((a, b) => (JSON.stringify(b).length > JSON.stringify(a).length ? b : a));
    for (const [k, e] of Object.entries(ROUTES)) {
      if (!('v' in e)) continue;
      if (!bodies[k]?.length) { lenient.push(`${k}: no body recorded`); continue; }
      const r = lenientMutations(e.v, richest(bodies[k]), k);
      lenient.push(...r.lenient); tried += r.tried;
      expect(r.tried, `${k}: mutations were tried`).toBeGreaterThan(0);
    }
    for (const type of Object.keys(EVENT_VALIDATORS) as EventType[]) {
      const rows = eventRows.filter((r) => r.type === type);
      if (!rows.length) { lenient.push(`event ${type}: no row recorded`); continue; }
      const r = lenientMutations(eventValidator(type), richest(rows), `event ${type}`);
      lenient.push(...r.lenient); tried += r.tried;
    }
    expect(tried).toBeGreaterThan(2000);
    expect(lenient).toEqual([]);
  });

  it('every object array was filled and every nullable field was non-null in some call, unless listed with a reason', () => {
    const open: string[] = [];
    const add = (label: string, found: string[]) => { for (const f of found) if (!UNEXERCISED_ALLOWED.some(([re]) => re.test(`${label} ${f}`))) open.push(`${label} ${f}`); };
    for (const [k, e] of Object.entries(ROUTES)) if ('v' in e && bodies[k]) add(k, unexercised(e.v, bodies[k]));
    for (const type of Object.keys(EVENT_VALIDATORS) as EventType[]) add(`event ${type}`, unexercised(eventValidator(type), eventRows.filter((r) => r.type === type)));
    expect(open).toEqual([]);
  });
});

let stalledEvents: ReturnType<typeof eventDto>[] = [];
let eventRows: ReturnType<typeof eventDto>[] = [];
