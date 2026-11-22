import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { createAttribution, createTag } from '../src/failures/service.ts';
import { clearDemo } from '../src/seed/demo.ts';
import { tx } from '../src/db.ts';

// Improvement cycle 60 (Phase 2, R2-10): failure attribution fields on failure tags (brief c60-brief.md, item 1).
// A tag can carry attribution entries (agent id, step reference, "full trace available"); an entry exists only for a task or
// task attempt with a recorded failure; two people who attribute differently both stay on record and a disagreement count is shown.
let t: TestApp;
let A: Browser, M: Browser, K: Browser;
let adminId = '', minaId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'fa' + n++ });
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
const rows = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows;
const tag = (b: Browser, subjectKind: string, subjectId: string, modeId: string, extra: Record<string, unknown> = {}) => b.req('POST', '/failure-tags', { subjectKind, subjectId, modeId, ...extra }, key());
const attribute = (b: Browser, tagId: string, body: Record<string, unknown>) => b.req('POST', `/failure-tags/${tagId}/attributions`, body, key());

async function mission(id: string, owner: string, o: { shared?: boolean; demo?: boolean } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,'t-1',$2,$3,'running',$4)`, [id, owner, o.shared ?? false, o.demo ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
}
const task = (id: string, mid: string, status: string) => q(`insert into tasks(id, tenant_id, mission_id, title, status) values ($1,'t-1',$2,'A task',$3)`, [id, mid, status]);
const attempt = async (taskId: string, no: number, result: string | null) => String((await q(`insert into task_attempts(task_id, attempt_no, result) values ($1,$2,$3) returning id`, [taskId, no, result])).rows[0].id);
let attFailed = '', attOk = '', msgC1 = '';

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  const m = await w.member('Mina'); M = m.b; minaId = m.id;
  K = (await w.member('Kenji')).b;
  await mission('M-C1', minaId);
  await mission('M-S1', minaId, { shared: true });
  await mission('M-D1', adminId, { shared: true, demo: true });
  await task('T-F1', 'M-C1', 'failed'); await task('T-R1', 'M-C1', 'retry_ready'); await task('T-OK', 'M-C1', 'passed'); await task('T-S1', 'M-S1', 'failed');
  await task('T-D1', 'M-D1', 'failed'); await task('T-R2', 'M-C1', 'passed');
  attFailed = await attempt('T-F1', 1, 'failed'); attOk = await attempt('T-OK', 1, 'passed'); await attempt('T-R2', 1, 'failed'); await attempt('T-R2', 2, 'passed');
  const th = (await q(`insert into conversation_threads(tenant_id, scope, mission_id, kind, a, b) values ('t-1','mission','M-C1','agent-agent','a','b') returning id`)).rows[0].id;
  msgC1 = String((await q(`insert into messages(thread_id, seq, author_kind, author_id, kind, body) values ($1,1,'system','system','system','hi') returning id`, [th])).rows[0].id);
});
afterAll(async () => { await t?.close(); });

describe('attribution on a tag', () => {
  it('a tag made with an attribution stores one entry by the tagger; a tag without one has none', async () => {
    const r = await tag(M, 'task', 'T-F1', 'FM-1.3', { attribution: { agentId: 'agent-writer', stepRef: 'step-3', fullTraceAvailable: true } });
    expect(r.status).toBe(201);
    expect(r.body.tag.attributions).toHaveLength(1);
    expect(r.body.tag.attributions[0]).toMatchObject({ agentId: 'agent-writer', stepRef: 'step-3', fullTraceAvailable: true, attributedBy: minaId, attributedByName: 'Mina', attributedByKind: 'user' });
    expect(r.body.tag.attributions[0].id).toMatch(/^FA-[0-9A-F]{32}$/);
    expect(r.body.tag.attributionDisagreements).toBe(0);
    const plain = await tag(M, 'task', 'T-F1', 'FM-2.6');
    expect(plain.status).toBe(201);
    expect(plain.body.tag.attributions).toEqual([]);
    expect(plain.body.tag.attributionDisagreements).toBe(0);
  });

  it('only the agent or only the step is enough; neither, empty text, an unknown field or a wrong type is 400 and nothing is stored', async () => {
    const t1 = (await tag(M, 'task', 'T-S1', 'FM-1.1')).body.tag.id;
    const before = (await rows('select count(*)::int n from failure_attributions'))[0].n;
    expect((await attribute(M, t1, { agentId: 'agent-x' })).status).toBe(201);
    expect((await attribute(M, t1, { stepRef: 'step-9' })).status).toBe(201);
    for (const bad of [{}, { fullTraceAvailable: true }, { agentId: '' }, { agentId: '   ' }, { stepRef: 'x'.repeat(121) }, { agentId: 'a', extra: 1 }, { agentId: 'a', fullTraceAvailable: 'yes' }, { agentId: 5 }]) {
      expect((await attribute(M, t1, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await rows('select count(*)::int n from failure_attributions'))[0].n).toBe(before + 2);
    expect((await M.req('POST', `/failure-tags/${t1}/attributions`, { agentId: 'a' })).status).toBe(400); // Idempotency-Key required
  });

  it('attribution is refused for a subject with no recorded failure, and a refused tag-with-attribution stores no tag either', async () => {
    const att = { attribution: { agentId: 'agent-writer' } };
    for (const [k, id] of [['task', 'T-OK'], ['task_attempt', attOk], ['mission', 'M-C1'], ['message', msgC1]] as [string, string][]) {
      const r = await tag(M, k, id, 'FM-1.1', att);
      expect(r.status, `${k} ${id}`).toBe(409);
      expect(r.body.code).toBe('ATTRIBUTION_NEEDS_FAILURE');
    }
    expect((await rows(`select count(*)::int n from failure_tags where subject_id in ('T-OK', $1, 'M-C1', $2)`, [attOk, msgC1]))[0].n).toBe(0);
    // a tag without attribution on those subjects still works exactly as before
    const plain = await tag(M, 'task', 'T-OK', 'FM-3.2');
    expect(plain.status).toBe(201);
    const late = await attribute(M, plain.body.tag.id, { agentId: 'agent-writer' });
    expect(late.status).toBe(409); expect(late.body.code).toBe('ATTRIBUTION_NEEDS_FAILURE');
    const ms = await tag(M, 'mission', 'M-C1', 'FM-1.5');
    expect((await attribute(M, ms.body.tag.id, { stepRef: 's' })).status).toBe(409);
  });

  it('a failed attempt, or a task that failed once and then passed, counts as a recorded failure', async () => {
    expect((await tag(M, 'task_attempt', attFailed, 'FM-2.6', { attribution: { stepRef: 'step-1' } })).status).toBe(201);
    expect((await tag(M, 'task', 'T-R1', 'FM-3.2', { attribution: { agentId: 'agent-r' } })).status).toBe(409); // retry_ready with no attempt: nothing recorded as failed
    expect((await tag(M, 'task', 'T-R2', 'FM-3.1', { attribution: { agentId: 'agent-r' } })).status).toBe(201); // attempt 1 failed, attempt 2 passed
  });

  it('two people who attribute differently both stay on record, the count shows it, and the latest never wins', async () => {
    const tg = (await tag(A, 'task', 'T-D1', 'FM-2.3', { attribution: { agentId: 'agent-a', stepRef: 'step-2' } })).body.tag;
    const second = await attribute(M, tg.id, { agentId: 'agent-b', stepRef: 'step-5', fullTraceAvailable: true });
    expect(second.status).toBe(201);
    const view = second.body.tag;
    expect(view.attributions.map((a: any) => [a.agentId, a.stepRef, a.attributedByName])).toEqual([['agent-a', 'step-2', expect.any(String)], ['agent-b', 'step-5', 'Mina']]);
    expect(view.attributionDisagreements).toBe(1);
    expect('currentAttribution' in view).toBe(false);
    // a third person agreeing with the first does not hide the disagreement
    const third = await attribute(K, tg.id, { agentId: 'agent-a', stepRef: 'step-2' });
    expect(third.status).toBe(201); // M-D1 is shared, so Kenji sees it
    expect(third.body.tag.attributions).toHaveLength(3);
    expect(third.body.tag.attributionDisagreements).toBe(1);
  });

  it('the same target from a second person is an agreement (count stays 0) and a repeat by the same person is 409', async () => {
    const tg = (await tag(M, 'task', 'T-S1', 'FM-2.4', { attribution: { agentId: 'agent-a', stepRef: 'step-2' } })).body.tag;
    const same = await attribute(K, tg.id, { agentId: 'agent-a', stepRef: 'step-2' });
    expect(same.status).toBe(201);
    expect(same.body.tag.attributions).toHaveLength(2);
    expect(same.body.tag.attributionDisagreements).toBe(0);
    const dup = await attribute(M, tg.id, { agentId: 'agent-a', stepRef: 'step-2' });
    expect(dup.status).toBe(409); expect(dup.body.code).toBe('FAILURE_ATTRIBUTION_DUPLICATE');
    const other = await attribute(M, tg.id, { agentId: 'agent-c', stepRef: 'step-2', fullTraceAvailable: false });
    expect(other.status).toBe(201);
    expect(other.body.tag.attributionDisagreements).toBe(1);
    const k2 = await attribute(K, tg.id, { agentId: 'agent-d' });
    expect(k2.body.tag.attributionDisagreements).toBe(2); // 3 distinct targets (a+2, c+2, d): disagreements = distinct - 1
    const g = (await A.req('GET', '/failure-tags?subjectKind=task&subjectId=T-S1')).body;
    const listed = g.tags.find((x: any) => x.id === tg.id);
    expect(listed.attributions).toHaveLength(4);
    expect(listed.attributionDisagreements).toBe(2);
  });

  it('visibility: a person who cannot see the mission gets 404 for the tag; an unknown tag is 404; anonymous is 401', async () => {
    const tg = (await tag(M, 'task', 'T-F1', 'FM-3.3')).body.tag;
    expect((await attribute(K, tg.id, { agentId: 'a' })).status).toBe(404);
    expect((await attribute(A, 'FT-' + '0'.repeat(32), { agentId: 'a' })).status).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/api/v1/failure-tags/${tg.id}/attributions`, payload: { agentId: 'a' }, headers: key() })).statusCode).toBe(401);
  });

  it('is audited, and an idempotent repeat stores one entry', async () => {
    const tg = (await tag(M, 'task', 'T-F1', 'FM-1.4')).body.tag;
    const k = { 'idempotency-key': 'fa-repeat' };
    const a = await M.req('POST', `/failure-tags/${tg.id}/attributions`, { agentId: 'agent-z' }, k);
    const b = await M.req('POST', `/failure-tags/${tg.id}/attributions`, { agentId: 'agent-z' }, k);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect((await rows(`select count(*)::int n from failure_attributions where tag_id=$1`, [tg.id]))[0].n).toBe(1);
    expect((await rows(`select actor, result, detail from audit_events where action='failure.attribute' and subject=$1`, [tg.id]))[0]).toMatchObject({ actor: minaId, result: 'ok' });
  });

  it('an agent may attribute through the internal path (taggedByKind agent, tenant only)', async () => {
    const tg = (await tag(M, 'task', 'T-F1', 'FM-2.5')).body.tag;
    const view = await tx(t.app.db, (c) => createAttribution(c, { tenantId: 't-1', viewer: null, attributedBy: 'inst-x', attributedByKind: 'agent' }, tg.id, { agentId: 'agent-q', stepRef: 'step-1' }));
    expect(view.attributions.at(-1)).toMatchObject({ attributedBy: 'inst-x', attributedByKind: 'agent', agentId: 'agent-q' });
    expect(typeof createTag).toBe('function');
  });
});

describe('the table is append-only and fail-closed', () => {
  it('no update, delete or truncate; a raw insert for a subject without a recorded failure is refused', async () => {
    const id = (await rows(`select id from failure_attributions limit 1`))[0].id as string;
    await expect(q(`update failure_attributions set agent_id='zz' where id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(q(`delete from failure_attributions where id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(q(`truncate failure_attributions`)).rejects.toThrow(/append-only/);
    const okTag = (await rows(`select id, mission_id, tenant_id from failure_tags where subject_id='T-OK' limit 1`))[0];
    await expect(q(`insert into failure_attributions(id, tenant_id, tag_id, mission_id, agent_id, attributed_by, attributed_by_kind) values ('FA-RAW1',$1,$2,$3,'a','u','user')`, [okTag.tenant_id, okTag.id, okTag.mission_id])).rejects.toThrow(/recorded failure/);
    await expect(q(`insert into failure_attributions(id, tenant_id, tag_id, mission_id, attributed_by, attributed_by_kind) values ('FA-RAW2','t-1',$1,$2,'u','user')`, [okTag.id, okTag.mission_id])).rejects.toThrow();
  });

  it('a demo purge still removes them (the one allowed delete)', async () => {
    expect((await rows(`select count(*)::int n from failure_attributions a join failure_tags f on f.id=a.tag_id where f.mission_id='M-D1'`))[0].n).toBeGreaterThan(0);
    await clearDemo(t.app.db, 't-1');
    expect((await rows(`select count(*)::int n from failure_attributions where mission_id='M-D1'`))[0].n).toBe(0);
  });
});
