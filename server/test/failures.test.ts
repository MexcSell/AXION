import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { FAILURE_TAXONOMY, FAILURE_TAXONOMY_VERSION, FAILURE_TAXONOMY_SOURCE, FAILURE_MODE_IDS } from '../src/failures/taxonomy.ts';
import { createTag } from '../src/failures/service.ts';
import { clearDemo } from '../src/seed/demo.ts';
import { tx } from '../src/db.ts';

// Improvement cycle 33 (Phase 2, E3): failure-mode tags with the MAST taxonomy (brief c33-brief.md).
let t: TestApp;
let A: Browser; // administrator
let M: Browser; // member Mina (owns M-C1, sees the shared M-S1)
let K: Browser; // member Kenji (sees only the shared mission)
let adminId = '', minaId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'ft' + n++ });
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
const rows = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows;
const tag = (b: Browser, subjectKind: string, subjectId: string, modeId: string, extra: Record<string, unknown> = {}) => b.req('POST', '/failure-tags', { subjectKind, subjectId, modeId, ...extra }, key());

async function mission(id: string, owner: string, o: { shared?: boolean; demo?: boolean; tenant?: string } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,$2,$3,$4,'running',$5)`, [id, o.tenant ?? 't-1', owner, o.shared ?? false, o.demo ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
}
async function task(id: string, mid: string, status: string, tenant = 't-1') {
  await q(`insert into tasks(id, tenant_id, mission_id, title, status) values ($1,$2,$3,'A task',$4)`, [id, tenant, mid, status]);
}
async function attempt(taskId: string, no: number, result: string | null) {
  return (await q(`insert into task_attempts(task_id, attempt_no, result) values ($1,$2,$3) returning id`, [taskId, no, result])).rows[0].id as string;
}
async function message(missionId: string, tenant = 't-1') {
  const th = (await q(`insert into conversation_threads(tenant_id, scope, mission_id, kind, a, b) values ($1,'mission',$2,'agent-agent','a','b') returning id`, [tenant, missionId])).rows[0].id;
  return String((await q(`insert into messages(thread_id, seq, author_kind, author_id, kind, body) values ($1,1,'system','system','system','hi') returning id`, [th])).rows[0].id);
}
let attFailed = '', attOk = '', msgC1 = '', msgOther = '', msgDirect = '';

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  const m = await w.member('Mina'); M = m.b; minaId = m.id;
  K = (await w.member('Kenji')).b;
  await q(`insert into tenants(id,name) values ('t-2','Other')`);
  await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
  await mission('M-C1', minaId);                         // private to Mina (and the administrator)
  await mission('M-S1', minaId, { shared: true });       // shared
  await mission('M-D1', adminId, { shared: true, demo: true });
  await mission('M-T2', 'u-x', { shared: true, tenant: 't-2' });
  await task('T-F1', 'M-C1', 'failed'); await task('T-R1', 'M-C1', 'retry_ready'); await task('T-OK', 'M-C1', 'passed');
  await task('T-S1', 'M-S1', 'failed'); await task('T-D1', 'M-D1', 'failed'); await task('T-X2', 'M-T2', 'failed', 't-2');
  attFailed = await attempt('T-F1', 1, 'failed'); await attempt('T-F1', 2, null); attOk = await attempt('T-OK', 1, 'passed');
  msgC1 = await message('M-C1'); msgOther = await message('M-T2', 't-2');
  const dm = (await q(`insert into conversation_threads(tenant_id, scope, kind, a, b, owner_user_id) values ('t-1','direct','admin','a','b',$1) returning id`, [adminId])).rows[0].id;
  msgDirect = String((await q(`insert into messages(thread_id, seq, author_kind, author_id, kind, body) values ($1,1,'system','system','system','dm') returning id`, [dm])).rows[0].id);
});
afterAll(async () => { await t?.close(); });

describe('the taxonomy is the paper\'s (arXiv 2503.13657v3, Appendix A)', () => {
  it('3 categories with 5, 6 and 3 modes, exact names and ids', () => {
    expect(FAILURE_TAXONOMY_VERSION).toBe('mast-arxiv-2503.13657v3');
    expect(FAILURE_TAXONOMY.map((c) => [c.id, c.name, c.modes.length])).toEqual([['FC1', 'System Design Issues', 5], ['FC2', 'Inter-Agent Misalignment', 6], ['FC3', 'Task Verification', 3]]);
    expect(FAILURE_TAXONOMY.flatMap((c) => c.modes.map((m) => `${m.id} ${m.name}`))).toEqual([
      'FM-1.1 Disobey task specification', 'FM-1.2 Disobey role specification', 'FM-1.3 Step repetition', 'FM-1.4 Loss of conversation history', 'FM-1.5 Unaware of termination conditions',
      'FM-2.1 Conversation reset', 'FM-2.2 Fail to ask for clarification', 'FM-2.3 Task derailment', 'FM-2.4 Information withholding', 'FM-2.5 Ignored other agent’s input', 'FM-2.6 Reasoning-action mismatch',
      'FM-3.1 Premature termination', 'FM-3.2 No or incomplete verification', 'FM-3.3 Incorrect verification',
    ]);
    expect(FAILURE_MODE_IDS).toHaveLength(14);
    // licence (CC BY-NC-ND): names and ids are the paper's, the descriptions are AXION's own one-sentence summaries, not its text
    const defs = [...FAILURE_TAXONOMY.map((c) => c.definition), ...FAILURE_TAXONOMY.flatMap((c) => c.modes.map((m) => m.definition))];
    expect(defs).toHaveLength(17);
    expect(defs.every((d) => d.length > 30 && d.length < 140 && d.endsWith('.') && d.split('. ').length === 1)).toBe(true);
    expect(defs.filter((d) => /potentially|This category includes|leading to suboptimal|Failure to adhere/i.test(d))).toEqual([]);
    expect(FAILURE_TAXONOMY_SOURCE).toMatch(/arXiv:2503\.13657v3.*CC BY-NC-ND 4\.0.*https:\/\/arxiv\.org\/abs\/2503\.13657/);
  });
  it('is frozen (a change is a new version, never an edit)', () => {
    expect(Object.isFrozen(FAILURE_TAXONOMY)).toBe(true);
    for (const c of FAILURE_TAXONOMY) { expect(Object.isFrozen(c)).toBe(true); expect(Object.isFrozen(c.modes)).toBe(true); for (const m of c.modes) expect(Object.isFrozen(m)).toBe(true); }
    expect(() => { (FAILURE_TAXONOMY as unknown as unknown[]).push({}); }).toThrow();
  });
});

describe('tagging', () => {
  it('anonymous is 401; an unknown mode is 400 and nothing is stored', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/failure-tags?subjectKind=task&subjectId=T-F1' })).statusCode).toBe(401);
    for (const modeId of ['FM-9.9', 'FM-1.6', 'fm-1.1', 'nope', 'FM-1.10', '']) {
      const r = await tag(M, 'task', 'T-F1', modeId);
      expect(r.status, modeId).toBe(400);
    }
    expect((await tag(M, 'task', 'T-F1', 'FM-1.1', { extra: 1 })).status).toBe(400); // unknown fields refused
    expect((await tag(M, 'thing', 'T-F1', 'FM-1.1')).status).toBe(400);
    expect((await M.req('POST', '/failure-tags', { subjectKind: 'task', subjectId: 'T-F1', modeId: 'FM-1.1' })).status).toBe(400); // Idempotency-Key required
    expect((await rows('select count(*)::int n from failure_tags'))[0].n).toBe(0);
  });

  it('a missing, invisible or other-tenant subject is 404 for every kind (and nothing is stored)', async () => {
    const miss: [string, string][] = [
      ['task', 'T-NOPE'], ['task', 'T-X2'], ['mission', 'M-T2'], ['mission', 'M-NOPE'], ['task_attempt', '999999'], ['task_attempt', 'abc'], ['task_attempt', '1; drop table x'],
      ['message', msgOther], ['message', '999999'], ['message', 'abc'], ['message', msgDirect], ['task_attempt', '99999999999999999999999'],
    ];
    for (const [k, id] of miss) expect((await tag(A, k, id, 'FM-1.1')).status, `${k} ${id}`).toBe(404);
    // Kenji sees only the shared mission: Mina's private mission, task, attempt and message do not exist for him
    for (const [k, id] of [['mission', 'M-C1'], ['task', 'T-F1'], ['task_attempt', attFailed], ['message', msgC1]] as [string, string][]) {
      expect((await tag(K, k, id, 'FM-1.1')).status, `Kenji ${k}`).toBe(404);
      expect((await K.req('GET', `/failure-tags?subjectKind=${k}&subjectId=${id}`)).status, `Kenji GET ${k}`).toBe(404);
    }
    expect((await rows('select count(*)::int n from failure_tags'))[0].n).toBe(0);
  });

  it('a visible subject of each kind takes a tag; it starts proposed, with the tagger, the version and the mission', async () => {
    const cases: [string, string, string][] = [['task', 'T-F1', 'FM-1.3'], ['task', 'T-R1', 'FM-3.2'], ['task_attempt', attFailed, 'FM-2.6'], ['message', msgC1, 'FM-2.4'], ['mission', 'M-C1', 'FM-1.5']];
    for (const [k, id, mode] of cases) {
      const r = await tag(M, k, id, mode, { note: '  seen twice  ' });
      expect(r.status, `${k} ${id}`).toBe(201);
      expect(r.body.tag).toMatchObject({ subjectKind: k, subjectId: id, missionId: 'M-C1', modeId: mode, taxonomyVersion: FAILURE_TAXONOMY_VERSION, status: 'proposed', taggedBy: minaId, taggedByName: 'Mina', taggedByKind: 'user', note: 'seen twice', decidedBy: null, decidedAt: null });
      expect(r.body.tag.id).toMatch(/^FT-[0-9A-F]{32}$/);
    }
    expect((await rows(`select count(*)::int n from failure_tags where status='proposed'`))[0].n).toBe(5);
    const g = (await M.req('GET', '/failure-tags?subjectKind=task&subjectId=T-F1')).body;
    expect(g.subject).toMatchObject({ kind: 'task', id: 'T-F1', missionId: 'M-C1', failed: true, retried: true, demo: false });
    expect(g.tags).toHaveLength(1);
    const ok = (await A.req('GET', `/failure-tags?subjectKind=task_attempt&subjectId=${attOk}`)).body;
    expect(ok.subject).toMatchObject({ failed: false, retried: false });
    expect((await A.req('GET', '/failure-tags?subjectKind=task')).status).toBe(400);
  });

  it('the same mode twice on one subject is 409; another mode is fine', async () => {
    const dup = await tag(A, 'task', 'T-F1', 'FM-1.3');
    expect(dup.status).toBe(409); expect(dup.body.code).toBe('FAILURE_TAG_DUPLICATE');
    expect((await tag(A, 'task', 'T-F1', 'FM-3.3')).status).toBe(201);
  });

  it('an idempotent repeat returns the stored answer and stores one tag', async () => {
    const k = { 'idempotency-key': 'ft-repeat' };
    const a = await A.req('POST', '/failure-tags', { subjectKind: 'task', subjectId: 'T-S1', modeId: 'FM-2.3' }, k);
    const b = await A.req('POST', '/failure-tags', { subjectKind: 'task', subjectId: 'T-S1', modeId: 'FM-2.3' }, k);
    expect(a.status).toBe(201); expect(b.status).toBe(201); expect(b.body.tag.id).toBe(a.body.tag.id);
    expect((await rows(`select count(*)::int n from failure_tags where subject_id='T-S1'`))[0].n).toBe(1);
  });

  it('an agent tag stays proposed; the same visibility and tenant rules apply (internal path checks the tenant only)', async () => {
    const inst = 'inst-agent-1';
    const made = await tx(t.app.db, (c) => createTag(c, { tenantId: 't-1', viewer: null, taggedBy: inst, taggedByKind: 'agent' }, { kind: 'task', subjectId: 'T-S1', modeId: 'FM-1.1' }));
    expect(made).toMatchObject({ status: 'proposed', taggedByKind: 'agent', taggedBy: inst, decidedBy: null });
    await expect(tx(t.app.db, (c) => createTag(c, { tenantId: 't-1', viewer: null, taggedBy: inst, taggedByKind: 'agent' }, { kind: 'task', subjectId: 'T-X2', modeId: 'FM-1.1' }))).rejects.toMatchObject({ status: 404 });
    await expect(tx(t.app.db, (c) => createTag(c, { tenantId: 't-1', viewer: null, taggedBy: inst, taggedByKind: 'agent' }, { kind: 'task', subjectId: 'T-S1', modeId: 'FM-0.0' }))).rejects.toMatchObject({ status: 400 });
    // nothing is counted until a person confirms it
    const c0 = (await A.req('GET', '/company/failure-modes?window=30d')).body;
    expect(c0.proposed).toBeGreaterThan(0);
    expect(c0.n).toBe(0);
    // a person confirms it: the agent kind stays on the row
    const d = await A.req('POST', `/failure-tags/${made.id}/decision`, { decision: 'confirm' });
    expect(d.status).toBe(200);
    expect(d.body.tag).toMatchObject({ status: 'confirmed', taggedByKind: 'agent', decidedBy: adminId, decidedByName: 'Luca' });
  });
});

describe('decisions', () => {
  it('confirm once; a second decision (either way, any person) is 409 and the row does not change', async () => {
    const id = (await tag(M, 'task', 'T-R1', 'FM-1.4')).body.tag.id as string;
    expect((await K.req('POST', `/failure-tags/${id}/decision`, { decision: 'confirm' })).status).toBe(404); // not visible to Kenji
    expect((await M.req('POST', `/failure-tags/${id}/decision`, { decision: 'maybe' })).status).toBe(400);
    expect((await M.req('POST', `/failure-tags/${id}/decision`, { decision: 'confirm', note: 'x' })).status).toBe(400);
    const ok = await M.req('POST', `/failure-tags/${id}/decision`, { decision: 'confirm' });
    expect(ok.status).toBe(200);
    expect(ok.body.tag).toMatchObject({ status: 'confirmed', decidedBy: minaId, decidedByName: 'Mina' });
    const again = await A.req('POST', `/failure-tags/${id}/decision`, { decision: 'reject' });
    expect(again.status).toBe(409); expect(again.body.code).toBe('FAILURE_TAG_DECIDED');
    expect((await M.req('POST', `/failure-tags/${id}/decision`, { decision: 'confirm' })).status).toBe(409);
    expect((await rows('select status from failure_tags where id=$1', [id]))[0].status).toBe('confirmed');
    expect((await A.req('POST', '/failure-tags/FT-NOPE/decision', { decision: 'confirm' })).status).toBe(404);
  });

  it('self-confirmation is allowed but recorded: decider = tagger sets self_confirmed; another person, a rejection and an agent tag do not', async () => {
    const own = (await tag(M, 'task', 'T-D1', 'FM-1.2')).body.tag.id as string;
    const r = await M.req('POST', `/failure-tags/${own}/decision`, { decision: 'confirm' });
    expect(r.body.tag).toMatchObject({ status: 'confirmed', selfConfirmed: true, decidedBy: minaId });
    const other = (await tag(M, 'task', 'T-D1', 'FM-1.5')).body.tag.id as string;
    expect((await A.req('POST', `/failure-tags/${other}/decision`, { decision: 'confirm' })).body.tag).toMatchObject({ status: 'confirmed', selfConfirmed: false });
    const rej = (await tag(M, 'task', 'T-D1', 'FM-2.1')).body.tag.id as string;
    expect((await M.req('POST', `/failure-tags/${rej}/decision`, { decision: 'reject' })).body.tag).toMatchObject({ status: 'rejected', selfConfirmed: false });
    expect((await rows('select self_confirmed from failure_tags where id=$1', [own]))[0].self_confirmed).toBe(true);
    // the database refuses a lie about it
    const p2 = (await tag(M, 'task', 'T-D1', 'FM-2.2')).body.tag.id as string;
    await expect(q(`update failure_tags set status='confirmed', decided_by=$2, decided_at=now(), self_confirmed=true where id=$1`, [p2, adminId])).rejects.toThrow(/self_confirmed/);
    await expect(q(`update failure_tags set status='confirmed', decided_by=$2, decided_at=now(), self_confirmed=false where id=$1`, [p2, minaId])).rejects.toThrow(/self_confirmed/);
    await expect(q(`insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, self_confirmed) values ('FT-X','t-1','M-C1','task','T-F1','v','FM-1.1','u','user',true)`)).rejects.toThrow();
  });

  it('a rejected tag is final but the same mode can be proposed again', async () => {
    const id = (await tag(A, 'task', 'T-S1', 'FM-2.2')).body.tag.id as string;
    expect((await A.req('POST', `/failure-tags/${id}/decision`, { decision: 'reject' })).body.tag.status).toBe('rejected');
    expect((await A.req('POST', `/failure-tags/${id}/decision`, { decision: 'confirm' })).status).toBe(409);
    expect((await tag(A, 'task', 'T-S1', 'FM-2.2')).status).toBe(201);
  });

  it('every write and every refused decision is audited; events go to the mission audience only', async () => {
    expect((await rows(`select count(*)::int n from audit_events where action='failure.tag' and result='ok'`))[0].n).toBeGreaterThanOrEqual(8);
    expect((await rows(`select count(*)::int n from audit_events where action='failure.decide' and result='denied'`))[0].n).toBeGreaterThanOrEqual(3);
    const ev = await rows(`select type, audience, mission_id, subject_kind, payload from events where type in ('failure.tagged','failure.decided')`);
    expect(ev.length).toBeGreaterThan(5);
    expect(ev.every((e) => e.audience === 'mission' && e.mission_id && e.subject_kind === 'failure_tag')).toBe(true);
    expect(new Set(ev.map((e) => e.type))).toEqual(new Set(['failure.tagged', 'failure.decided']));
    expect(ev.find((e) => e.type === 'failure.decided')!.payload).toMatchObject({ status: expect.stringMatching(/confirmed|rejected/) });
  });

  it('the database refuses edits, deletes and truncate; only the one decision of a proposed tag is allowed', async () => {
    const id = (await tag(A, 'mission', 'M-S1', 'FM-3.1')).body.tag.id as string;
    await expect(q(`update failure_tags set mode_id='FM-1.1' where id=$1`, [id])).rejects.toThrow(/can only be decided/);
    await expect(q(`update failure_tags set note='x' where id=$1`, [id])).rejects.toThrow(/can only be decided/);
    await expect(q(`update failure_tags set status='confirmed' where id=$1`, [id])).rejects.toThrow(); // no decider recorded
    await expect(q(`delete from failure_tags where id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(q(`truncate failure_tags`)).rejects.toThrow(/append-only/);
    await q(`update failure_tags set status='confirmed', decided_by=$2, decided_at=now(), self_confirmed=true where id=$1`, [id, adminId]);
    await expect(q(`update failure_tags set status='rejected', decided_by='x', decided_at=now() where id=$1`, [id])).rejects.toThrow(/never changes/);
  });
});


describe('counts on a fixture with known tags', () => {
  let ts: TestApp, X: Browser, Y: Browser, xId = '';
  /** A confirmed tag written straight into the table with a made-up creation time (the API only makes tags "now"; a decided row can never be edited). */
  const old = (task: string, mission: string, mode: string, daysAgo: number, status = 'confirmed') => ts.pool.query(
    `insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, created_at, decided_by, decided_at)
     values ('FT-OLD-' || md5(random()::text), 't-1', $2, 'task', $1, $3, $4, $5, 'user', $6, now() - $7 * interval '1 day', case when $6='proposed' then null else $5 end, case when $6='proposed' then null else now() - $7 * interval '1 day' end)`,
    [task, mission, FAILURE_TAXONOMY_VERSION, mode, xId, status, daysAgo]);
  beforeAll(async () => {
    ts = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
    const w = await withAdmin(ts.app);
    X = w.admin; xId = w.adminId;
    Y = (await w.member('Yan')).b;
    const sq = (sql: string, p: unknown[] = []) => ts.pool.query(sql, p);
    const [yId] = (await sq(`select id from users where name='Yan'`)).rows.map((r) => r.id);
    await sq(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ('M-P',$1,$2,false,'running',false),('M-Q',$1,$2,true,'running',false),('M-DM',$1,$3,true,'running',true)`, ['t-1', yId, xId]);
    for (const [id, m] of [['T-1', 'M-P'], ['T-2', 'M-P'], ['T-3', 'M-Q'], ['T-4', 'M-DM']]) await sq(`insert into tasks(id, tenant_id, mission_id, title, status) values ($1,'t-1',$2,'t','failed')`, [id, m]);
  });
  afterAll(async () => { await ts?.close(); });
  const mk = async (b: Browser, task: string, mode: string, decision?: 'confirm' | 'reject') => {
    const r = await b.req('POST', '/failure-tags', { subjectKind: 'task', subjectId: task, modeId: mode }, key());
    expect(r.status).toBe(201);
    if (decision) expect((await b.req('POST', `/failure-tags/${r.body.tag.id}/decision`, { decision })).status).toBe(200);
    return r.body.tag.id as string;
  };
  const flat = (b: any) => Object.fromEntries(b.categories.flatMap((c: any) => c.modes.map((m: any) => [m.id, m.count])));

  it('n = 0: every count is null, n is 0, the window and version are stated (a confirmed tag outside the window does not count)', async () => {
    await old('T-1', 'M-P', 'FM-1.2', 200);
    const r = (await X.req('GET', '/company/failure-modes')).body;
    expect(r).toMatchObject({ window: '30d', n: 0, proposed: 0, includeDemo: false, taxonomyVersion: FAILURE_TAXONOMY_VERSION });
    expect(r.categories).toHaveLength(3);
    expect(r.categories.every((c: any) => c.count === null && c.modes.every((m: any) => m.count === null))).toBe(true);
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBe(30 * 86_400_000);
    expect((await X.req('GET', '/company/failure-modes?window=7d')).body.window).toBe('7d');
  });

  it('exact counts: confirmed only, per mode and per category, with n', async () => {
    const a = await mk(Y, 'T-1', 'FM-1.3', 'confirm');
    await mk(X, 'T-2', 'FM-1.3', 'confirm');          // second FM-1.3
    await mk(X, 'T-1', 'FM-3.2', 'confirm');
    await mk(X, 'T-3', 'FM-2.6', 'confirm');
    await mk(Y, 'T-2', 'FM-2.5', 'reject');           // rejected: not counted
    await mk(Y, 'T-3', 'FM-3.1');                     // proposed: not counted, reported apart
    const r = (await X.req('GET', '/company/failure-modes?window=30d')).body;
    expect(r.n).toBe(4); expect(r.proposed).toBe(1);
    // who confirmed: Yan confirmed his own (T-1 FM-1.3), the administrator confirmed three tags made by herself: 4 self-confirmed
    expect(r.selfConfirmed).toBe(4); expect(r.demo).toBe(0);
    expect(flat(r)).toMatchObject({ 'FM-1.3': 2, 'FM-3.2': 1, 'FM-2.6': 1, 'FM-1.1': 0, 'FM-2.5': 0, 'FM-3.1': 0 });
    expect(r.categories.map((c: any) => [c.id, c.count])).toEqual([['FC1', 2], ['FC2', 1], ['FC3', 1]]);
    expect(r.categories.reduce((s: number, c: any) => s + c.count, 0)).toBe(r.n);
    expect(r.categories.flatMap((c: any) => c.modes).every((m: any) => typeof m.count === 'number')).toBe(true);
    expect(a).toMatch(/^FT-/);
  });

  it('the window: a tag made 20 days ago is in 30d and 90d, not in 7d; 100 days ago in none; the 7d view is null again when it holds nothing', async () => {
    await old('T-3', 'M-Q', 'FM-1.1', 20);
    expect((await X.req('GET', '/company/failure-modes?window=30d')).body.n).toBe(5);
    expect((await X.req('GET', '/company/failure-modes?window=90d')).body.n).toBe(5);
    expect((await X.req('GET', '/company/failure-modes?window=7d')).body.n).toBe(4);
    await old('T-3', 'M-Q', 'FM-1.5', 100);  // older than 90 days: in no window
    await old('T-3', 'M-Q', 'FM-1.4', 3, 'proposed');
    const r90 = (await X.req('GET', '/company/failure-modes?window=90d')).body;
    expect(r90.n).toBe(5); expect(r90.proposed).toBe(2); expect(flat(r90)['FM-1.5']).toBe(0); expect(flat(r90)['FM-1.2']).toBe(0);
  });

  it('visibility and DEMO: only missions the caller can see; DEMO missions only with includeDemo=1', async () => {
    const demo = await mk(X, 'T-4', 'FM-2.1', 'confirm');
    expect(demo).toMatch(/^FT-/);
    const a0 = (await X.req('GET', '/company/failure-modes')).body, a1 = (await X.req('GET', '/company/failure-modes?includeDemo=1')).body;
    expect(a0.demo).toBe(0); expect(a1.demo).toBe(1); expect(a1.n).toBe(a0.n + 1); expect(a1.includeDemo).toBe(true); expect(flat(a1)['FM-2.1']).toBe(1); expect(flat(a0)['FM-2.1']).toBe(0);
    // Yan owns M-P (private) and sees the shared M-Q and M-DM; the administrator's tags on M-P are visible to Yan too (his own mission)
    const y = (await Y.req('GET', '/company/failure-modes?includeDemo=1')).body;
    expect(y.n).toBe(a1.n);
    // a private mission of someone else does not count for a member: move M-P to the administrator, private
    await ts.pool.query(`update missions set owner_id=$1 where id='M-P'`, [xId]);
    const y2 = (await Y.req('GET', '/company/failure-modes?includeDemo=1')).body;
    expect(y2.n).toBeLessThan(y.n);
    expect((await X.req('GET', '/company/failure-modes?includeDemo=1')).body.n).toBe(a1.n); // the administrator still sees everything
    expect((await X.req('GET', '/company/failure-modes?window=1y')).status).toBe(400);
    expect((await X.req('GET', '/company/failure-modes?includeDemo=yes')).status).toBe(400);
    expect((await new (Y.constructor as new (a: unknown) => Browser)(ts.app).req('GET', '/company/failure-modes')).status).toBe(401);
  });

  it('a demo purge removes the demo mission\'s tags (the one allowed delete); other tags stay', async () => {
    const before = (await ts.pool.query(`select count(*)::int n from failure_tags`)).rows[0].n;
    const onDemo = (await ts.pool.query(`select count(*)::int n from failure_tags where mission_id='M-DM'`)).rows[0].n;
    expect(onDemo).toBeGreaterThan(0);
    await clearDemo(ts.app.db, 't-1');
    expect((await ts.pool.query(`select count(*)::int n from failure_tags`)).rows[0].n).toBe(before - onDemo);
    expect((await ts.pool.query(`select count(*)::int n from failure_tags where mission_id='M-DM'`)).rows[0].n).toBe(0);
  });
});
