import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, openStream, Browser, TEST_DB, type TestApp } from '../helpers.ts';
import { requestApproval, consumeApproval, loadBoundAction } from '../../src/approvals/service.ts';
import { createNotification } from '../../src/notifications/routes.ts';
import { eventDto } from '../../src/events/log.ts';
import { setInstanceState } from '../../src/instances/service.ts';
import { tx } from '../../src/db.ts';
import { check } from './validate.ts';
import { errorEnvelope } from './validators.ts';
import { checkEvent, eventValidator, EVENT_VALIDATORS } from './events.ts';
import type { EventType } from '../../../shared/contracts/src/index.ts';
import { ROUTES, routeKey } from './registry.ts';
import { call, hits, gated, problems, errorShapes, bodies, requests, key, recordServed, writeDump } from './flow.ts';
import { SWEEP_SKIP, MEMBER_403_ALLOWED } from './allowlists.ts';
import { UNEXERCISED_ALLOWED } from './exercised.ts';
import { lenientMutations, unexercised } from './walk.ts';

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

const openStreams: (() => void)[] = [];
let streamEvents: { event: string; data: any }[] = [];

describe('API coverage run', () => {
  beforeAll(async () => {
    t = await makeTestApp({ staffingStepMs: 30, conversationSimMs: 80, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } }, configure: recordServed });
    await t.app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  });
  afterAll(async () => { openStreams.forEach((c) => c()); await t?.close(); });

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
    await call(admin, 'POST', '/tasks/:id/:action', '/tasks/T-c50b/reassign', { body: { toInstanceId: mine[0].id, reason: 'balance' }, headers: key() });
    await call(admin, 'POST', '/tasks/:id/:action', '/tasks/T-c50c/cancel', { body: {}, headers: key() });
    expect(Array.isArray(tasksR.body)).toBe(true);
    expect(((await call(admin, 'GET', '/missions/:id/tasks', `/missions/${m1}/tasks`)).body as unknown[]).length, 'the task list now has rows to validate').toBeGreaterThan(2);
    // task reviews: the administrator reviews a passed task of a mission the member owns
    await call(admin, 'GET', '/tasks/:id/reviews', '/tasks/T-c50r/reviews');
    expect((await call(admin, 'GET', '/tasks/:id/reviews', '/tasks/T-c50p/reviews')).body.canReview.allowed).toBe(false);
    await call(admin, 'POST', '/tasks/:id/reviews', '/tasks/T-c50r/reviews', { status: 201, headers: key(), body: { verdict: 'accepted', rubric: [{ criterion: 'The output is attached', result: 'pass', note: 'seen' }], evidence: [{ kind: 'url', ref: 'https://example.com/report' }] } });
    await call(admin, 'GET', '/tasks/:id/reviews', '/tasks/T-c50r/reviews');

    // ---- delegation briefs
    const brief = { goal: 'Draft the landing page copy', inputs: ['file:brief.md'], acceptance: ['Copy fits the template'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner' };
    await call(admin, 'POST', '/missions/:id/delegation-briefs', `/missions/${m1}/delegation-briefs`, { status: 201, headers: key(), body: { toInstanceId: mine[0].id, brief } });
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
    await tx(t.app.db, async (c) => consumeApproval(c, { approvalId: ap.id, action: await loadBoundAction(c, 't-1', ap.id), by: 'release-01' }));
    const nid = await tx(t.app.db, (c) => createNotification(c, { tenantId: 't-1', severity: 'info', category: 'system', title: 'Hello', body: 'World', missionId: m2 }));
    const nl = await call(admin, 'GET', '/notifications', '/notifications');
    expect((nl.body.notifications as { id: string }[]).some((x) => x.id === nid)).toBe(true);
    await call(admin, 'POST', '/notifications/:id/ack', `/notifications/${nid}/ack`);
    await call(admin, 'POST', '/notifications/ack-all', '/notifications/ack-all', { body: { ids: [nid] } });

    // ---- agents, versions, organisation
    await call(admin, 'GET', '/agents', '/agents');
    await call(admin, 'GET', '/agents/:id', '/agents/coder-01', { query: '?includeSimulated=1' });
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
    await call(admin, 'POST', '/version-proposals/:pid/decision', `/version-proposals/${vp1.id}/decision`, { body: { decision: 'promote', sha: vp1.sha, note: 'ok' } });
    const coder2 = (await admin.req('GET', '/agents/coder-01')).body.agent;
    const vp2 = (await bb.req('POST', '/agents/coder-01/version-proposals', { title: 'Add Go', hypothesis: 'x', candidate: { model: 'another-model', skills: [...coder2.skills, 'Go'], tools: coder2.tools }, baseVersionId: coder2.versionId }, key())).body.proposal;
    await call(bb, 'POST', '/version-proposals/:pid/withdraw', `/version-proposals/${vp2.id}/withdraw`, { body: {} });
    await call(admin, 'GET', '/version-proposals', '/version-proposals');
    await call(admin, 'GET', '/agents/:id/version-proposals', '/agents/coder-01/version-proposals');
    await call(admin, 'POST', '/agents/:id/rollback', '/agents/coder-01/rollback', { headers: key(), body: { toVersionId: coder.versionId, why: 'The new skill confused reviews.' } });
    // organisation
    const g = (await call(admin, 'GET', '/organization/graph', '/organization/graph')).body;
    await call(admin, 'GET', '/organization/revisions', '/organization/revisions');
    await call(admin, 'GET', '/organization/coverage', '/organization/coverage');
    const moved = (edges: any[], sub: string, sup: string) => edges.map((e) => (e.subordinateId === sub ? { ...e, supervisorId: sup } : e));
    const baseRev = async () => (await admin.req('GET', '/organization/graph')).body.revision.seq as number;
    await call(admin, 'POST', '/organization/proposals', '/organization/proposals', { status: 200, query: '?dryRun=1', body: { title: 'dry', why: 'x', baseRevision: await baseRev(), edges: moved(g.edges, 'tester-01', 'coder-01') } });
    const p1 = (await call(admin, 'POST', '/organization/proposals', '/organization/proposals', { status: 201, body: { title: 'Move tester', why: 'Shorter path.', baseRevision: await baseRev(), edges: moved(g.edges, 'tester-01', 'coder-01') }, headers: key() })).body.proposal;
    await call(bea.b, 'POST', '/organization/proposals/:id/decision', `/organization/proposals/${p1.id}/decision`, { body: { decision: 'approve', sha: p1.sha, note: 'ok' } });
    const g2 = (await admin.req('GET', '/organization/graph')).body;
    const p2 = (await admin.req('POST', '/organization/proposals', { title: 'Move writer', why: 'x', baseRevision: g2.revision.seq, edges: moved(g2.edges, 'writer-01', 'ops-01') }, key())).body.proposal;
    await call(admin, 'POST', '/organization/proposals/:id/withdraw', `/organization/proposals/${p2.id}/withdraw`, { body: {} });
    const p3 = (await admin.req('POST', '/organization/proposals', { title: 'Expire me', why: 'x', baseRevision: g2.revision.seq, edges: moved(g2.edges, 'writer-01', 'coder-01') }, key())).body.proposal;
    await t.pool.query(`update org_proposals set expires_at = now() - interval '1 minute' where id=$1`, [p3.id]);
    // a proposal whose reporting lines leave an agent without a manager is stored with its dry-run errors (applying it is refused)
    await call(admin, 'POST', '/organization/proposals', '/organization/proposals', { status: 200, query: '?dryRun=1', body: { title: 'dry orphan', why: 'x', baseRevision: g2.revision.seq, edges: g2.edges.filter((e: any) => e.subordinateId !== 'tester-01') } });
    const bad = (await call(admin, 'POST', '/organization/proposals', '/organization/proposals', { status: 201, body: { title: 'Orphan', why: 'x', baseRevision: g2.revision.seq, edges: g2.edges.filter((e: any) => e.subordinateId !== 'tester-01') }, headers: key() })).body.proposal;
    expect(bad.result.errors.length).toBeGreaterThan(0);
    await call(bea.b, 'POST', '/organization/proposals/:id/decision', `/organization/proposals/${bad.id}/decision`, { body: { decision: 'reject', sha: bad.sha, note: 'Orphans an agent.' } });
    const bad2 = (await admin.req('POST', '/organization/proposals', { title: 'Orphan 2', why: 'x', baseRevision: g2.revision.seq, edges: g2.edges.filter((e: any) => e.subordinateId !== 'tester-01') }, key())).body.proposal;
    await call(admin, 'POST', '/organization/proposals/:id/withdraw', `/organization/proposals/${bad2.id}/withdraw`, { body: {} });
    await call(admin, 'GET', '/organization/proposals', '/organization/proposals');
    const revs = (await admin.req('GET', '/organization/revisions')).body.revisions as { seq: number }[];
    const first = Math.min(...revs.map((r) => r.seq)), last = Math.max(...revs.map((r) => r.seq));
    await call(admin, 'GET', '/organization/revisions/:seq', `/organization/revisions/${last}`);
    await call(admin, 'GET', '/organization/revisions/:seq/diff', `/organization/revisions/${last}/diff`, { query: `?against=${first}` });
    await call(admin, 'GET', '/organization/revisions/:seq/diff', `/organization/revisions/${first}/diff`, { query: `?against=${last}` });
    await call(admin, 'POST', '/organization/revisions/:seq/rollback-proposal', `/organization/revisions/${first}/rollback-proposal`, { status: 201, headers: key(), body: { why: 'Back to the start.' } });

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

    // ---- site grants, failure tags
    await call(admin, 'GET', '/site-grants', '/site-grants');
    await call(admin, 'GET', '/site-grants/validate', '/site-grants/validate', { query: '?origin=' + encodeURIComponent('https://example.com') });
    await call(admin, 'GET', '/site-grants/validate', '/site-grants/validate', { query: '?origin=' + encodeURIComponent('http://localhost') });
    const gr = (await call(admin, 'POST', '/site-grants', '/site-grants', { status: 201, headers: key(), body: { origin: 'https://example.com', missionId: m1, capabilities: ['read', 'screenshot'], expiresAt: dayIso(2) } })).body.grant;
    await call(admin, 'GET', '/site-grants', '/site-grants');
    await call(admin, 'POST', '/site-grants/:id/revoke', `/site-grants/${gr.id}/revoke`, { body: { reason: 'No longer needed' } });
    await call(admin, 'GET', '/failure-tags', '/failure-tags', { query: '?subjectKind=task&subjectId=T-c50a' });
    const tag = (await call(admin, 'POST', '/failure-tags', '/failure-tags', { status: 201, headers: key(), body: { subjectKind: 'task', subjectId: 'T-c50a', modeId: 'FM-1.1', note: 'It ignored the spec.' } })).body.tag;
    await call(admin, 'POST', '/failure-tags/:id/decision', `/failure-tags/${tag.id}/decision`, { body: { decision: 'confirm' } });
    await call(admin, 'GET', '/failure-tags', '/failure-tags', { query: '?subjectKind=task&subjectId=T-c50a' });
    await call(admin, 'GET', '/site-grants', '/site-grants');

    // ---- company, ops, policy, audit
    await call(admin, 'GET', '/company/scorecard', '/company/scorecard', { query: '?window=7d&includeDemo=1' });
    await call(mina, 'GET', '/company/scorecard', '/company/scorecard');
    await call(admin, 'GET', '/company/throughput', '/company/throughput', { query: '?weeks=4' });
    await call(admin, 'GET', '/company/failure-modes', '/company/failure-modes', { query: '?window=30d' });
    await call(mina, 'GET', '/departments', '/departments');
    await call(admin, 'GET', '/departments', '/departments', { query: '?window=7d&includeDemo=1' });
    await call(admin, 'GET', '/operations/health', '/operations/health');
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
