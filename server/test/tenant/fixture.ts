import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/app.ts';
import { tx } from '../../src/db.ts';
import { insertInstance } from '../../src/instances/service.ts';
import { requestApproval } from '../../src/approvals/service.ts';
import { createNotification } from '../../src/notifications/routes.ts';
import { makeSchema, withAdmin, Browser, TEST_DB } from '../helpers.ts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

/**
 * Improvement cycle 79 (R4-4): two tenants in ONE schema of the test database. One app instance serves one tenant (a session only
 * works for `cfg.tenantId`), so tenant A is `t-1` (the default) and tenant B is `t-b`, two buildApp() calls on the same schema.
 * Tenant B's agents carry the prefix 'b-' (see seedmock.ts); both tenants have the same structure, so a dropped tenant predicate shows.
 * Every free-text field of a tenant carries a unique marker (letters and digits only, so no field rewrites it).
 */
export interface Tenant {
  tag: string; tenantId: string; app: FastifyInstance; admin: Browser; member: Browser;
  ids: Record<string, string>;
  /** a person whose sign-in waits for approval (the only caller of GET /auth/wait that gets data) */
  waiting?: Browser;
  /** every marker planted so far: marker -> the field it sits in */
  markers: Map<string, string>;
  mk: (field: string) => string;
  base: string;
}
export interface World { A: Tenant; B: Tenant; pool: pg.Pool; schema: string; close: () => Promise<void> }

const until = async (f: () => Promise<boolean>, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
export const cookieOf = (b: Browser) => [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
let nk = 0;
export const idem = () => ({ 'idempotency-key': 'c79-' + Date.now() + '-' + nk++ });
const dayIso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const ST = { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' };

/** Both apps are built with the sims frozen (huge steps), so only tests change a tenant's data. `configure` hooks are given per app. */
export async function buildWorld(opts: { configureA?: (app: FastifyInstance) => void; configureB?: (app: FastifyInstance) => void } = {}): Promise<World> {
  const s = await makeSchema();
  const dirs: string[] = [];
  const mkApp = async (tenantId: string, configure?: (app: FastifyInstance) => void, step = 25) => {
    const uploadDir = mkdtempSync(join(tmpdir(), 'axion-c79-')); dirs.push(uploadDir);
    return buildApp({ databaseUrl: TEST_DB(), schema: s.schema, logger: false, uploadDir, tenantId, staffingStepMs: step, conversationSimMs: 100_000_000, writeLimits: { proposals: { max: 10000, windowMs: 60_000 } }, configure });
  };
  await s.pool.query(`insert into tenants(id, name) values ('t-b', 'Bravo') on conflict do nothing`);
  const appA = await mkApp('t-1', opts.configureA);
  const appB = await mkApp('t-b', opts.configureB);
  for (const a of [appA, appB]) await a.listen({ host: '127.0.0.1', port: 0 });
  const mkT = async (tag: string, tenantId: string, app: FastifyInstance): Promise<Tenant> => {
    const w = await withAdmin(app);
    const markers = new Map<string, string>();
    let n = 0;
    const mk = (field: string) => { const m = `ZQ${tag}${String(++n).padStart(3, '0')}Q`; markers.set(m, field); return m; };
    const member = await w.member(mk('user.name'));
    return { tag, tenantId, app, admin: w.admin, member: member.b, ids: { adminId: w.adminId, memberId: member.id }, markers, mk, base: `http://127.0.0.1:${(app.server.address() as { port: number }).port}` };
  };
  const A = await mkT('ALPHA', 't-1', appA);
  const B = await mkT('BRAVO', 't-b', appB);
  const world: World = { A, B, pool: s.pool, schema: s.schema, close: async () => { await appA.close(); await appB.close(); await s.drop(); dirs.forEach((d) => rmSync(d, { recursive: true, force: true })); } };
  return world;
}

const multipartOf = (name: string, content: string) => {
  const boundary = '----c79' + Date.now() + nk++;
  return { boundary, payload: `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n` };
};
export async function upload(t: Tenant, who: Browser, name: string, content: string): Promise<string> {
  const m = multipartOf(name, content);
  const r = await t.app.inject({ method: 'POST', url: '/api/v1/uploads', remoteAddress: '127.0.0.1', headers: { cookie: cookieOf(who), 'x-csrf': who.csrf, 'content-type': `multipart/form-data; boundary=${m.boundary}` }, payload: m.payload });
  if (r.statusCode !== 201) throw new Error('upload failed ' + r.body);
  return r.json().id as string;
}
const must = <T extends { status: number; body: any }>(r: T, want: number | number[], what: string): T => {
  if (![want].flat().includes(r.status)) throw new Error(`seed ${what}: got ${r.status} ${JSON.stringify(r.body)?.slice(0, 300)}`);
  return r;
};

/** Plant a marker in every free-text field a person can write, through the API where a route exists (SQL or service helpers where none does). */
export async function seedTenant(w: World, t: Tenant): Promise<void> {
  const { admin, member, mk, ids } = t; const pool = w.pool;
  const tag = t.tag.toLowerCase();
  const P = t.tenantId === 't-b' ? 'b-' : ''; // agent ids of tenant B are prefixed (see seedmock.ts)
  const coderId = P + 'coder-01', testerId = P + 'tester-01', opsId = P + 'ops-01', releaseId = P + 'release-01';
  ids.coder = coderId; ids.tester = testerId; // c72 merge: the second agent id of GET /agents/:id/skills/compare?with=
  // uploads (file name and file content are both free text)
  ids.upload = await upload(t, admin, mk('upload.name') + '.txt', 'Body ' + mk('upload.content'));
  // missions: text, title, criteria, shared flag
  ids.mission = must(await admin.req('POST', '/missions', { text: 'Build a landing page ' + mk('mission.text'), files: [ids.upload], shared: false }, idem()), 201, 'mission').body.mission.id;
  ids.mission2 = must(await admin.req('POST', '/missions', { text: 'Research the tea market ' + mk('mission.text2'), files: [], shared: true }, idem()), 201, 'mission2').body.mission.id;
  ids.mission3 = must(await member.req('POST', '/missions', { text: 'Write the newsletter ' + mk('mission.text.member'), files: [await upload(t, member, mk('member.upload') + '.txt', mk('member.upload.content'))], shared: true }, idem()), 201, 'mission3').body.mission.id;
  for (const m of [ids.mission, ids.mission2, ids.mission3]) if (!await until(async () => (await admin.req('GET', `/missions/${m}`)).body.mission.staffing?.stage === 'working')) throw new Error('staffing did not finish for ' + m);
  // tenant B's staffing creates no instances (the staffing plan names tenant t-1's agent ids and the insert is tenant-scoped), so its team is stored directly
  if (t.tenantId === 't-b') for (const m of [ids.mission, ids.mission2, ids.mission3]) for (const a of [testerId, coderId, releaseId]) await tx(t.app.db, (c) => insertInstance(c, { tenantId: t.tenantId, missionId: m, agentId: a, simulated: false }));
  const got = (await admin.req('GET', `/missions/${ids.mission}`)).body.mission;
  must(await admin.req('PATCH', `/missions/${ids.mission}`, { title: 'Landing ' + mk('mission.title'), priority: 'high', criteria: [{ text: 'Loads fast ' + mk('mission.criteria'), done: false }] }, { 'if-match': String(got.rowVersion) }), 200, 'mission patch');
  must(await admin.req('POST', `/missions/${ids.mission}/share`, { shared: true }), 200, 'share');
  // instances, tasks (SQL: no create route), delegation briefs, ledgers
  const insts = must(await admin.req('GET', '/agent-instances'), 200, 'instances').body.instances as { id: string; missionId: string; managerInstanceId: string | null }[];
  const mine = insts.filter((i) => i.missionId === ids.mission);
  ids.instance = mine[0].id; ids.instance2 = mine[1].id;
  const mkTask = (id: string, status: string, owner: string, mission: string, title: string) => pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,$2,$3,$4,$5,$6,$7)`, [id, t.tenantId, mission, title, status, owner.split(':')[1], owner]);
  ids.task = `T-${tag}-a`; ids.task2 = `T-${tag}-b`; ids.task3 = `T-${tag}-c`;
  await mkTask(ids.task, 'failed', ids.instance2, ids.mission, 'Task ' + mk('task.title'));
  await mkTask(ids.task2, 'ready', ids.instance2, ids.mission, 'Second ' + mk('task.title2'));
  const prod3 = insts.filter((i) => i.missionId === ids.mission3 && !i.id.endsWith(':gm'))[0] ?? ((await admin.req('GET', '/agent-instances')).body.instances as any[]).find((i) => i.missionId === ids.mission3 && !i.id.endsWith(':gm'));
  await mkTask(ids.task3, 'passed', prod3.id, ids.mission3, 'Passed ' + mk('task.title3'));
  must(await admin.req('POST', `/tasks/${ids.task3}/reviews`, { verdict: 'accepted', rubric: [{ criterion: 'Output attached ' + mk('review.criterion'), result: 'pass', note: 'Seen ' + mk('review.note') }], evidence: [{ kind: 'url', ref: 'https://example.com/' + mk('review.evidence').toLowerCase() }] }, idem()), 201, 'review');
  const brief = { goal: 'Draft the copy ' + mk('brief.goal'), inputs: ['file:' + mk('brief.input')], acceptance: ['Fits the template ' + mk('brief.acceptance')], capabilities: [{ kind: 'read' }], escalation: 'Ask the owner ' + mk('brief.escalation') };
  ids.brief = must(await admin.req('POST', `/missions/${ids.mission}/delegation-briefs`, { toInstanceId: ids.instance, brief }, idem()), 201, 'brief').body.brief?.id ?? '';
  const task = { facts: { given: [{ text: 'Budget is 5k ' + mk('ledger.given'), source: 'mission text ' + mk('ledger.source') }], to_look_up: [{ text: 'Prices ' + mk('ledger.lookup') }], to_derive: [{ text: 'Total ' + mk('ledger.derive') }], guesses: [{ text: 'A is cheaper ' + mk('ledger.guess') }] }, steps: [{ id: 's1', text: 'Collect quotes ' + mk('ledger.step'), owner: 'gm', status: 'todo' }] };
  must(await admin.req('POST', `/missions/${ids.mission}/ledgers/task`, { baseVersion: 0, body: task }), 201, 'task ledger');
  must(await admin.req('POST', `/missions/${ids.mission}/ledgers/progress`, { baseVersion: 0, body: { satisfied: false, looping: false, progressing: true, next_speaker: 'gm', next_instruction: 'Collect ' + mk('ledger.instruction'), notes: 'On track ' + mk('ledger.notes') } }), 201, 'progress ledger');
  // conversations: thread, direct channels, admin channel
  ids.thread = must(await admin.req('POST', `/missions/${ids.mission}/threads`, { instanceId: ids.instance }), [200, 201], 'thread').body.threadId;
  must(await admin.req('POST', `/threads/${ids.thread}/messages`, { kind: 'command', text: 'Start with the header ' + mk('thread.message'), to: ids.instance.split(':')[1], uploadIds: [await upload(t, admin, mk('thread.attachment') + '.txt', mk('thread.attachment.content'))] }, idem()), 201, 'thread message');
  must(await admin.req('POST', '/channels/gm/messages', { kind: 'command', text: 'Plan my week ' + mk('channel.gm') }, idem()), 201, 'gm message');
  must(await admin.req('POST', `/channels/agent:${coderId}/messages`, { kind: 'command', text: 'Hello coder ' + mk('channel.agent') }, idem()), 201, 'agent message');
  must(await member.req('POST', '/channels/admin/messages', { kind: 'command', text: 'Need access ' + mk('channel.admin') }, idem()), 201, 'admin message');
  must(await admin.req('POST', `/channels/admin/${ids.memberId}/messages`, { kind: 'reply', text: 'Done ' + mk('channel.admin.reply') }, idem()), 201, 'admin reply');
  // approvals and notifications (service helpers: no create route)
  const ap = await tx(t.app.db, (c) => requestApproval(c, { tenantId: t.tenantId, missionId: ids.mission, agentId: releaseId, kind: 'release', title: 'Publish ' + mk('approval.title'), detail: 'Ship it ' + mk('approval.detail'), payload: { v: mk('approval.payload') }, expiresInMin: 30 }));
  ids.approval = ap.id;
  const ap2 = await tx(t.app.db, (c) => requestApproval(c, { tenantId: t.tenantId, missionId: ids.mission, agentId: releaseId, kind: 'release', title: 'Decided ' + mk('approval.title2'), detail: mk('approval.detail2'), payload: { v: 2 }, expiresInMin: 30 }));
  must(await admin.req('POST', `/approvals/${ap2.id}/decision`, { decision: 'approved', digest: ap2.digest, reason: 'ok ' + mk('approval.reason') }), 200, 'decision');
  ids.notification = await tx(t.app.db, (c) => createNotification(c, { tenantId: t.tenantId, severity: 'info', category: 'system', title: 'Hello ' + mk('notice.title'), body: 'World ' + mk('notice.body'), missionId: ids.mission2 }));
  // agents, versions, organisation, mentoring
  // creating an agent needs the organisation chart (a new agent is placed under a manager), which tenant B does not have: B edits an existing agent instead
  const ag = t.tenantId === 't-1'
    ? must(await admin.req('POST', '/agents', { name: 'Audit ' + mk('agent.name'), role: 'Auditor ' + mk('agent.role'), dept: 'Ops', duty: 'Audit ' + mk('agent.duty'), model: 'test-model', skills: ['audit'], tools: [], parentId: opsId }, idem()), 201, 'agent').body.agent
    : (await admin.req('GET', `/agents/${testerId}`)).body.agent;
  ids.newAgent = ag.id;
  must(await admin.req('PATCH', `/agents/${ag.id}`, { description: 'Audits ' + mk('agent.description') }, { 'if-match': String(ag.rowVersion) }), 200, 'agent patch');
  const coder = (await admin.req('GET', `/agents/${coderId}`)).body.agent;
  ids.versionProposal = must(await admin.req('POST', `/agents/${coderId}/version-proposals`, { title: 'Add Svelte ' + mk('vp.title'), hypothesis: 'Fewer rounds ' + mk('vp.hypothesis'), candidate: { model: coder.model, skills: [...coder.skills, 'Svelte'], tools: coder.tools }, baseVersionId: coder.versionId }, idem()), 201, 'version proposal').body.proposal.id;
  if (t.tenantId === 't-1') { // tenant B has no organisation chart (see seedmock.ts)
    const g = must(await admin.req('GET', '/organization/graph'), 200, 'graph').body;
    const moved = g.edges.map((e: any) => (e.subordinateId === 'tester-01' ? { ...e, supervisorId: 'coder-01' } : e));
    ids.orgProposal = must(await admin.req('POST', '/organization/proposals', { ...ST, title: 'Move tester ' + mk('org.title'), why: 'Shorter path ' + mk('org.why'), baseRevision: g.revision.seq, edges: moved, triggers: ['coverage_gap'] }, idem()), 201, 'org proposal').body.proposal.id;
    // c85: a plan whose free text carries a marker, so the isolation relations also cover the plan routes
    must(await admin.req('PUT', `/organization/proposals/${ids.orgProposal}/plan`, { primary: { metric: 'process.first_pass_acceptance', direction: 'up', margin: 5 }, minN: 20, windowDays: 14, guardrails: [{ metric: 'scorecard.failure_rate', margin: 2 }], why: 'A shorter path should raise first-pass acceptance ' + mk('org.plan.why') }), 200, 'org plan');
    ids.revision = String(g.revision.seq);
  }
  const plan = must(await admin.req('POST', `/agents/${testerId}/mentoring`, { mentorId: coderId, skill: 'Testing ' + mk('mentoring.skill'), milestones: ['Write one test ' + mk('mentoring.milestone'), 'Review one'], reevalOn: dayIso(30).slice(0, 10) }, idem()), 201, 'mentoring').body.plan;
  ids.plan = plan.id; ids.milestone = plan.milestones[0].id;
  // playbooks and skills
  const src = [{ kind: 'review', id: 'REV-1', note: 'Asked twice ' + mk('lesson.source') }];
  ids.lesson = must(await member.req('POST', `/agents/${coderId}/lessons`, { text: 'Run the linter ' + mk('lesson.text'), sources: src }, idem()), 201, 'lesson').body.lesson.id;
  must(await admin.req('POST', `/lessons/${ids.lesson}/decision`, { decision: 'accept', baseVersion: 0, note: 'Good ' + mk('lesson.note') }), 200, 'accept lesson');
  const l2 = must(await member.req('POST', `/agents/${coderId}/lessons`, { text: 'Keep PRs small ' + mk('lesson.text2'), sources: src }, idem()), 201, 'lesson 2').body.lesson.id;
  must(await admin.req('POST', `/lessons/${l2}/decision`, { decision: 'accept', baseVersion: 1 }), 200, 'accept lesson 2');
  ids.skill = must(await member.req('POST', '/skills', { name: 'Check status ' + mk('skill.name'), description: 'Open the admin page ' + mk('skill.description'), steps: [{ kind: 'navigate', detail: 'Open status ' + mk('skill.step'), origin: 'https://status.example.com' }, { kind: 'observe', detail: 'Read ' + mk('skill.step2') }], preconditions: ['Signed in ' + mk('skill.precondition')], sources: src }, idem()), 201, 'skill').body.skill.id;
  // site grants, failure tags
  ids.grant = must(await admin.req('POST', '/site-grants', { origin: 'https://example.com', missionId: ids.mission, capabilities: ['read'], expiresAt: dayIso(2) }, idem()), 201, 'grant').body.grant.id;
  ids.tag = must(await admin.req('POST', '/failure-tags', { subjectKind: 'task', subjectId: ids.task, modeId: 'FM-1.1', note: 'It ignored the spec ' + mk('tag.note'), attribution: { agentId: 'agent-' + mk('tag.agent').toLowerCase(), stepRef: 'step ' + mk('tag.step') } }, idem()), 201, 'tag').body.tag.id;
  // a second device with a marker name for the member
  const phone = new Browser(t.app, '127.0.0.2', 'Safari on iPhone');
  await phone.connect(await memberName(t), 'pass1234', { name: 'Phone ' + mk('device.name'), kind: 'phone', browser: 'Safari' });
  const acct = ((await admin.req('GET', '/users')).body.users as any[]).find((u) => u.id === ids.memberId);
  ids.device = acct.devices.find((d: any) => String(d.name).startsWith('Phone')).id;
  ids.memberName = acct.name;
  t.waiting = new Browser(t.app, '127.0.0.7', 'Chrome on Linux');
  must(await t.waiting.connect(mk('waiting.user'), 'pass1234', { name: 'Desk ' + mk('waiting.device'), kind: 'desktop', browser: 'Chrome' }), 202, 'waiting user');
}
const memberName = async (t: Tenant) => ((await t.admin.req('GET', '/users')).body.users as any[]).find((u) => u.id === t.ids.memberId).name as string;

/** More data in a tenant, with fresh markers: new mission, a changed mission title, new messages, a new lesson, a deleted mission. */
export async function mutateTenant(t: Tenant, round: number): Promise<void> {
  const { admin, member, mk } = t;
  const m = must(await admin.req('POST', '/missions', { text: `Extra mission ${round} ` + mk('extra.mission.text'), files: [], shared: true }, idem()), 201, 'extra mission').body.mission.id;
  must(await admin.req('POST', '/missions', { text: `Second extra ${round} ` + mk('extra.mission.text2'), files: [], shared: true }, idem()), 201, 'extra mission 2');
  // a new person asks to join (an administrator-only event and notification carry the name and the device name)
  const nb = new Browser(t.app, `127.0.1.${10 + round}`, 'Firefox on Linux');
  must(await nb.connect(mk('extra.user'), 'pass1234', { name: 'Laptop ' + mk('extra.device'), kind: 'laptop', browser: 'Firefox' }), 202, 'extra user');
  const cur = (await admin.req('GET', `/missions/${t.ids.mission2}`)).body.mission;
  must(await admin.req('PATCH', `/missions/${t.ids.mission2}`, { title: `Renamed ${round} ` + mk('extra.mission.title') }, { 'if-match': String(cur.rowVersion) }), 200, 'rename');
  must(await admin.req('POST', '/channels/gm/messages', { kind: 'command', text: `More ${round} ` + mk('extra.channel') }, idem()), 201, 'extra message');
  must(await member.req('POST', '/channels/admin/messages', { kind: 'command', text: `More ${round} ` + mk('extra.admin.channel') }, idem()), 201, 'extra admin message');
  must(await member.req('POST', `/agents/${t.ids.coder}/lessons`, { text: `Lesson ${round} ` + mk('extra.lesson'), sources: [{ kind: 'review', id: 'REV-9', note: mk('extra.lesson.source') }] }, idem()), 201, 'extra lesson');
  must(await member.req('POST', '/skills', { name: `Skill ${round} ` + mk('extra.skill'), description: 'Do it ' + mk('extra.skill.description'), steps: [{ kind: 'observe', detail: 'Read ' + mk('extra.skill.step') }], preconditions: [], sources: [{ kind: 'review', id: 'REV-9', note: mk('extra.skill.source') }] }, idem()), 201, 'extra skill');
  await tx(t.app.db, (c) => createNotification(c, { tenantId: t.tenantId, severity: 'info', category: 'system', title: `Notice ${round} ` + mk('extra.notice.title'), body: mk('extra.notice.body') }));
  // data deleted again: a third mission with its own text, soft-deleted
  const gone = must(await admin.req('POST', '/missions', { text: `Doomed ${round} ` + mk('extra.mission.deleted'), files: [], shared: true }, idem()), 201, 'doomed mission').body.mission.id;
  must(await admin.req('DELETE', `/missions/${gone}`), 200, 'delete mission');
  void m;
}
