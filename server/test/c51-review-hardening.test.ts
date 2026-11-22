import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { tx } from '../src/db.ts';
import { recordReview } from '../src/tasks/reviews.ts';
import { addVersion } from '../src/agents/service.ts';
import { audit } from '../src/audit.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { modelFamily, MODEL_FAMILY_TABLE } from '../src/tasks/review-rules.ts';
import { ERROR_CODES } from '../../shared/contracts/src/errors.ts';
import { MISSIONS } from '../../web/src/data/missions.ts';

// Improvement cycle 51 (O3a + O2a): owner history (fail-closed prior actors), review freshness, vendor matching, required briefs.

describe('vendor matching: o-series (c51)', () => {
  it.each([['o1-mini'], ['o3'], ['o4-mini'], ['o1'], ['o3-pro'], ['o1-preview'], ['O3-Mini'], ['openai/o1-mini'], ['o3_mini']])('%s is openai', (m) => expect(modelFamily(m)).toBe('openai'));
  it.each([['o10x'], ['bo1'], ['o10'], ['o1x'], ['o3mini'], ['o11'], ['o1.5'], ['o19'], ['xo3'], ['o2'], ['o']])('%s has no family', (m) => expect(modelFamily(m)).toBeNull());
  it('the table itself is unchanged (still frozen, o1/o3/o4 listed)', () => {
    expect(Object.isFrozen(MODEL_FAMILY_TABLE)).toBe(true);
    expect(MODEL_FAMILY_TABLE.openai).toEqual(expect.arrayContaining(['o1', 'o3', 'o4']));
  });
});

describe('vendor matching: router prefixes that name another vendor (c51)', () => {
  it.each([['anthropic/gpt-4'], ['openai/claude-3'], ['google/gpt-4o'], ['meta-llama/gpt-4'], ['mistralai/claude-3'], ['openrouter/anthropic/gpt-4'], ['anthropic.gpt-4'], ['us.anthropic.gpt-4'], ['x-ai/claude-3'], ['deepseek/gemini-2']])('%s resolves to null', (m) => expect(modelFamily(m)).toBeNull());
  it.each([
    ['openai/gpt-4o', 'openai'], ['anthropic/claude-3', 'anthropic'], ['google/gemini-pro', 'google'], ['meta-llama/Llama-3-70b', 'meta'], ['mistralai/Mixtral-8x7B', 'mistral'],
    ['x-ai/grok-2', 'xai'], ['qwen/qwen-2', 'alibaba'], ['deepseek-ai/deepseek-v3', 'deepseek'], ['openrouter/openai/gpt-4o', 'openai'], ['azure/gpt-4', 'openai'], ['bedrock/anthropic.claude-v2', 'anthropic'], ['us.anthropic.claude-3-5-sonnet', 'anthropic'],
  ])('%s is %s (a router or a matching vendor prefix is fine)', (m, f) => expect(modelFamily(m)).toBe(f));
});

let t: TestApp;
let L: Browser, ben: Browser, mia: Browser;
let luId = '', miaId = '';
let M1 = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'k' + Date.now() + '-' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await rows(sql, p))[0].n as number;
const RUBRIC = [{ criterion: 'The output is attached', result: 'pass', note: 'seen' }];
const EV = [{ kind: 'url', ref: 'https://example.com/report' }];
const body = (over: Record<string, unknown> = {}) => ({ verdict: 'accepted', rubric: RUBRIC, evidence: EV, ...over });
const BRIEF = { goal: 'Take over the task', acceptance: ['The result is attached'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner when unsure' };
const asCtx = () => ({ tenantId: t.app.cfg.tenantId, user: { id: luId, role: 'admin', name: 'Luca' }, correlationId: 'c' }) as never;
let tk = 0;
async function mkTask(mission: string, owner: string | null = `${mission}:coder-01`, status = 'passed') {
  const id = 'T-h' + ++tk + '-' + Math.random().toString(36).slice(2, 6);
  const tn = (await rows('select tenant_id from missions where id=$1', [mission]))[0].tenant_id;
  await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,$2,$3,'Write the report',$6,$4,$5)`, [id, tn, mission, owner ? owner.split(':')[1] : null, owner, status]);
  return id;
}
const hist = (id: string) => rows('select agent_id, owner_instance_id, source from task_owner_history where task_id=$1 order by seq', [id]);
async function staffed(b: Browser, shared: boolean) {
  const m = (await b.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared }, key())).body.mission.id as string;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && (await b.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
  return m;
}
const insts = async () => (await rows(`select id, agent_id from agent_instances where mission_id=$1 and agent_id <> 'coder-01' order by seq`, [M1])) as { id: string; agent_id: string }[];
const scoreRow = async () => (await ben.req('GET', '/company/scorecard?window=30d')).body.rows.find((r: any) => r.key === 'tasks_verified_by_review') as { value: number; n: number };

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 30, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  L = w.admin; luId = w.adminId;
  const a = await w.member('Mia'), b = await w.member('Ben');
  mia = a.b; miaId = a.id; ben = b.b;
  M1 = await staffed(mia, true);
  void miaId;
});
afterAll(async () => { await t.close(); });

describe('owner history is written by a trigger on tasks (c51)', () => {
  it('a task inserted with an owner gets a first history row', async () => {
    const id = await mkTask(M1);
    expect(await hist(id)).toEqual([{ agent_id: 'coder-01', owner_instance_id: `${M1}:coder-01`, source: 'insert' }]);
  });
  it('a task inserted without an owner has no row until it gets one', async () => {
    const id = await mkTask(M1, null);
    expect(await hist(id)).toEqual([]);
    await t.pool.query(`update tasks set owner_agent='tester-01' where id=$1`, [id]);
    expect((await hist(id)).map((h) => h.agent_id)).toEqual(['tester-01']);
  });
  it('a raw SQL change of owner_agent is recorded', async () => {
    const id = await mkTask(M1);
    await t.pool.query(`update tasks set owner_agent='tester-01', owner_instance_id=null where id=$1`, [id]);
    expect((await hist(id)).map((h) => h.agent_id)).toEqual(['coder-01', 'tester-01']);
    expect((await hist(id))[1].source).toBe('change');
  });
  it('a raw SQL change of owner_instance_id alone is recorded, with the agent resolved from the instance', async () => {
    const id = await mkTask(M1);
    const other = (await insts())[0];
    await t.pool.query(`update tasks set owner_instance_id=$2, owner_agent=null where id=$1`, [id, other.id]);
    const h = await hist(id);
    expect(h.length).toBe(2);
    expect(h[1]).toMatchObject({ agent_id: other.agent_id, owner_instance_id: other.id });
  });
  it('a chain of three owners keeps all three, in order', async () => {
    const id = await mkTask(M1);
    await t.pool.query(`update tasks set owner_agent='tester-01', owner_instance_id=null where id=$1`, [id]);
    await t.pool.query(`update tasks set owner_agent='planner-01' where id=$1`, [id]);
    expect((await hist(id)).map((h) => h.agent_id)).toEqual(['coder-01', 'tester-01', 'planner-01']);
  });
  it('changing something other than the owner, or setting the same owner again, records nothing', async () => {
    const id = await mkTask(M1);
    await t.pool.query(`update tasks set title='Another title', status='failed' where id=$1`, [id]);
    await t.pool.query(`update tasks set owner_agent='coder-01', owner_instance_id=$2 where id=$1`, [id, `${M1}:coder-01`]);
    expect((await hist(id)).length).toBe(1);
  });
  it('the reassign route records the new owner through the trigger', async () => {
    const id = await mkTask(M1, `${M1}:coder-01`, 'ready');
    const target = (await insts())[0];
    const r = await L.req('POST', `/tasks/${id}/reassign`, { toInstanceId: target.id, reason: 'x', brief: BRIEF }, key());
    expect(r.status).toBe(200);
    expect((await hist(id)).map((h) => h.agent_id)).toEqual(['coder-01', target.agent_id]);
  });
  it('UPDATE, DELETE and TRUNCATE on the history are refused', async () => {
    const id = await mkTask(M1);
    await expect(t.pool.query(`update task_owner_history set agent_id='x' where task_id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from task_owner_history where task_id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate task_owner_history`)).rejects.toThrow(/append-only/);
    expect((await hist(id)).length).toBe(1);
  });
  it('deleting a task that has history is refused outside the demo purge (the cascade hits the guard)', async () => {
    const id = await mkTask(M1);
    await expect(t.pool.query(`delete from tasks where id=$1`, [id])).rejects.toThrow(/append-only/);
  });
  it('every task with an owner has at least one history row', async () => {
    expect(await count(`select count(*)::int n from tasks t where (t.owner_agent is not null or t.owner_instance_id is not null) and not exists (select 1 from task_owner_history h where h.task_id=t.id)`)).toBe(0);
  });
  it('the demo purge still removes demo missions and their history', async () => {
    await seedDemo(t.app.db, t.app.cfg.tenantId, luId);
    const dm = MISSIONS[0].id;
    expect(await count('select count(*)::int n from task_owner_history h join tasks k on k.id=h.task_id where k.mission_id=$1', [dm])).toBeGreaterThan(0);
    await clearDemo(t.app.db, t.app.cfg.tenantId);
    expect(await count('select count(*)::int n from tasks where mission_id=$1', [dm])).toBe(0);
    expect(await count('select count(*)::int n from task_owner_history h where not exists (select 1 from tasks k where k.id=h.task_id)')).toBe(0);
  });
});

describe('the prior-actor exclusion reads the history, fail-closed (c51)', () => {
  it('a task that has an owner but no history row refuses every review, and says why', async () => {
    await t.pool.query('alter table tasks disable trigger user');
    let id = '';
    try { id = await mkTask(M1); } finally { await t.pool.query('alter table tasks enable trigger user'); }
    expect(await hist(id)).toEqual([]);
    const r = await ben.req('POST', `/tasks/${id}/reviews`, body(), key());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('REVIEW_NOT_INDEPENDENT');
    expect(r.body.message).toMatch(/history/i);
    expect(await count('select count(*)::int n from task_reviews where task_id=$1', [id])).toBe(0);
  });
  it('GET canReview is also refused for such a task', async () => {
    await t.pool.query('alter table tasks disable trigger user');
    let id = '';
    try { id = await mkTask(M1); } finally { await t.pool.query('alter table tasks enable trigger user'); }
    const g = await ben.req('GET', `/tasks/${id}/reviews`);
    expect(g.body.canReview).toMatchObject({ allowed: false, code: 'REVIEW_NOT_INDEPENDENT' });
  });
  it('a task with a history row is reviewable (control)', async () => {
    const id = await mkTask(M1);
    expect((await ben.req('POST', `/tasks/${id}/reviews`, body(), key())).status).toBe(201);
  });
  it('a prior owner can never verify, even after the audit and delegation rows are purged', async () => {
    const [a, b] = await insts();
    for (const x of [a, b]) await tx(t.app.db, (c) => addVersion(c, { agentId: x.agent_id, model: 'gpt-5-judge', skills: [], tools: [], createdBy: 'system' }));
    const id = await mkTask(M1, a.id, 'ready'); // a owns it first
    expect((await L.req('POST', `/tasks/${id}/reassign`, { toInstanceId: b.id, reason: 'x', brief: BRIEF }, key())).status).toBe(200);
    await t.pool.query(`update tasks set status='passed' where id=$1`, [id]);
    // purge every other trace of the earlier owner: the reassign audit rows and the delegation rows
    await t.pool.query('alter table audit_events disable trigger audit_events_no_update');
    await t.pool.query(`delete from audit_events where action='task.reassign' and subject=$1`, [id]);
    await t.pool.query('alter table audit_events enable trigger audit_events_no_update');
    const c = await t.pool.connect();
    try { await c.query('begin'); await c.query(`set local axion.purge_demo='on'`); await c.query(`delete from mission_delegations where task_id=$1`, [id]); await c.query('commit'); } finally { c.release(); }
    expect(await count(`select count(*)::int n from audit_events where action='task.reassign' and subject=$1`, [id])).toBe(0);
    expect(await count(`select count(*)::int n from mission_delegations where task_id=$1`, [id])).toBe(0);
    // b (the current owner) is the producer; a is a prior owner; they run the same family here, so only the history can decide
    await expect(tx(t.app.db, (c2) => recordReview(c2, asCtx(), id, body() as never, { kind: 'agent', id: a.agent_id }))).rejects.toMatchObject({ code: 'REVIEW_NOT_INDEPENDENT', status: 403 });
    expect(await count('select count(*)::int n from task_reviews where task_id=$1', [id])).toBe(0);
  });
  it('prior owners from a raw SQL owner change are excluded too', async () => {
    const [a, b] = await insts();
    const id = await mkTask(M1, a.id);
    await t.pool.query(`update tasks set owner_instance_id=$2, owner_agent=$3 where id=$1`, [id, b.id, b.agent_id]);
    await expect(tx(t.app.db, (c) => recordReview(c, asCtx(), id, body() as never, { kind: 'agent', id: a.agent_id }))).rejects.toMatchObject({ code: 'REVIEW_NOT_INDEPENDENT' });
  });
  it('an agent that never owned the task, and a person, may still review (controls)', async () => {
    const insp = await insts();
    const id = await mkTask(M1, insp[0].id);
    await t.pool.query(`update tasks set owner_instance_id=$2, owner_agent=$3 where id=$1`, [id, insp[1].id, insp[1].agent_id]);
    const out = await tx(t.app.db, (c) => recordReview(c, asCtx(), id, body() as never, { kind: 'agent', id: insp[2]?.agent_id ?? 'coder-01' }).catch((e) => ({ err: e.code })));
    expect(JSON.stringify(out)).not.toMatch(/REVIEW_NOT_INDEPENDENT/);
    expect((await ben.req('POST', `/tasks/${id}/reviews`, body(), key())).status).toBe(201);
  });
  it('GET canReview names the owner-history problem and is allowed for an ordinary task', async () => {
    const id = await mkTask(M1);
    expect((await ben.req('GET', `/tasks/${id}/reviews`)).body.canReview).toMatchObject({ allowed: true });
  });
});

describe('review freshness (c51)', () => {
  const failRetryPass = async (id: string) => {
    await t.pool.query(`update tasks set status='failed' where id=$1`, [id]);
    const r = await L.req('POST', `/tasks/${id}/retry`, {}, key());
    expect(r.status).toBe(200);
    await t.pool.query(`update tasks set status='passed' where id=$1`, [id]);
  };
  it('fail, retry, pass with only the old accepted review leaves the task not verified', async () => {
    const id = await mkTask(M1);
    const v0 = (await scoreRow()).value;
    expect((await ben.req('POST', `/tasks/${id}/reviews`, body(), key())).status).toBe(201);
    expect((await scoreRow()).value).toBe(v0 + 1);
    await failRetryPass(id);
    expect((await scoreRow()).value).toBe(v0);
  });
  it('a fresh accepted review after the retry verifies it again', async () => {
    const id = await mkTask(M1);
    const v0 = (await scoreRow()).value;
    await ben.req('POST', `/tasks/${id}/reviews`, body(), key());
    await failRetryPass(id);
    expect((await scoreRow()).value).toBe(v0);
    expect((await ben.req('POST', `/tasks/${id}/reviews`, body(), key())).status).toBe(201);
    expect((await scoreRow()).value).toBe(v0 + 1);
  });
  it('GET shows the old review as stale (before attempt N) and the new one as current', async () => {
    const id = await mkTask(M1);
    await ben.req('POST', `/tasks/${id}/reviews`, body(), key());
    await failRetryPass(id);
    await ben.req('POST', `/tasks/${id}/reviews`, body(), key());
    const g = (await ben.req('GET', `/tasks/${id}/reviews`)).body;
    expect(g.reviews.map((r: any) => r.stale)).toEqual([{ beforeAttempt: 2 }, null]);
    expect(g.verified).toBe(true);
  });
  it('GET says the task is not verified when only a stale accepted review exists', async () => {
    const id = await mkTask(M1);
    await ben.req('POST', `/tasks/${id}/reviews`, body(), key());
    expect((await ben.req('GET', `/tasks/${id}/reviews`)).body.verified).toBe(true);
    await failRetryPass(id);
    const g = (await ben.req('GET', `/tasks/${id}/reviews`)).body;
    expect(g.verified).toBe(false);
    expect(g.reviews[0].stale).toEqual({ beforeAttempt: 2 });
  });
  it('a stale review does not fall back: a stale accepted review hides behind a newer rejected one as before', async () => {
    const id = await mkTask(M1);
    const v0 = (await scoreRow()).value;
    await ben.req('POST', `/tasks/${id}/reviews`, body(), key());
    await failRetryPass(id);
    await ben.req('POST', `/tasks/${id}/reviews`, body({ verdict: 'rejected', evidence: [] }), key());
    expect((await scoreRow()).value).toBe(v0);
  });
  it('a review of a task that never had a second attempt is never stale', async () => {
    const id = await mkTask(M1);
    await ben.req('POST', `/tasks/${id}/reviews`, body(), key());
    const g = (await ben.req('GET', `/tasks/${id}/reviews`)).body;
    expect(g.reviews[0].stale).toBeNull();
    expect(g.verified).toBe(true);
  });
  it('a review made before the latest started attempt (DB time) is stale, one made after is not', async () => {
    const id = await mkTask(M1);
    await t.pool.query(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,1, now() - interval '1 hour', now() - interval '50 minutes','passed')`, [id]);
    await ben.req('POST', `/tasks/${id}/reviews`, body(), key()); // attempt 1, created now
    expect((await ben.req('GET', `/tasks/${id}/reviews`)).body.reviews[0].stale).toBeNull();
    await t.pool.query(`insert into task_attempts(task_id, attempt_no, started_at) values ($1,2, now() + interval '1 minute')`, [id]);
    expect((await ben.req('GET', `/tasks/${id}/reviews`)).body.reviews[0].stale).toEqual({ beforeAttempt: 2 });
  });
  it('the stale flag is computed from the database clock, not the client (the timestamps compared are timestamptz in SQL)', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/tasks/reviews.ts', import.meta.url), 'utf8'));
    expect(src).toMatch(/started_at/);
    expect(src).not.toMatch(/Date\.now\(\)/);
  });
});

describe('POST /tasks/:id/reassign requires a brief (c51, O2a)', () => {
  it('without a brief: 400 BRIEF_REQUIRED, the owner stays, nothing is audited', async () => {
    const id = await mkTask(M1, `${M1}:coder-01`, 'ready');
    const target = (await insts())[0];
    const before = await count(`select count(*)::int n from audit_events where subject=$1`, [id]);
    const r = await L.req('POST', `/tasks/${id}/reassign`, { toInstanceId: target.id, reason: 'x' }, key());
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BRIEF_REQUIRED');
    expect((await rows('select owner_instance_id from tasks where id=$1', [id]))[0].owner_instance_id).toBe(`${M1}:coder-01`);
    expect(await count(`select count(*)::int n from audit_events where subject=$1`, [id])).toBe(before);
  });
  it('brief: null is the same as none', async () => {
    const id = await mkTask(M1, `${M1}:coder-01`, 'ready');
    const r = await L.req('POST', `/tasks/${id}/reassign`, { toInstanceId: (await insts())[0].id, brief: null }, key());
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BRIEF_REQUIRED');
  });
  it('with a valid brief it still works and records the brief', async () => {
    const id = await mkTask(M1, `${M1}:coder-01`, 'ready');
    const r = await L.req('POST', `/tasks/${id}/reassign`, { toInstanceId: (await insts())[0].id, reason: 'x', brief: BRIEF }, key());
    expect(r.status).toBe(200);
    expect(await count('select count(*)::int n from delegation_briefs where task_id=$1', [id])).toBe(1);
  });
  it('an invalid brief is still a 400 (not BRIEF_REQUIRED) and nothing moves', async () => {
    const id = await mkTask(M1, `${M1}:coder-01`, 'ready');
    const r = await L.req('POST', `/tasks/${id}/reassign`, { toInstanceId: (await insts())[0].id, brief: { ...BRIEF, acceptance: [] } }, key());
    expect(r.status).toBe(400);
    expect(r.body.code).not.toBe('BRIEF_REQUIRED');
    expect((await rows('select owner_instance_id from tasks where id=$1', [id]))[0].owner_instance_id).toBe(`${M1}:coder-01`);
  });
  it('a task the caller cannot see is still 404 (visibility first), and an unknown task is 404', async () => {
    const priv = (await mia.req('POST', '/missions', { text: 'Private study of hosting costs.', files: [], shared: false }, key())).body.mission.id as string;
    const id = await mkTask(priv, null);
    expect((await ben.req('POST', `/tasks/${id}/reassign`, { toInstanceId: 'x' }, key())).status).toBe(404);
    expect((await L.req('POST', `/tasks/T-nope/reassign`, { toInstanceId: 'x' }, key())).status).toBe(404);
  });
  it('retry and cancel do not need a brief', async () => {
    const id = await mkTask(M1, `${M1}:coder-01`, 'failed');
    expect((await L.req('POST', `/tasks/${id}/retry`, {}, key())).status).toBe(200);
    expect((await L.req('POST', `/tasks/${id}/cancel`, {}, key())).status).toBe(200);
  });
  it('BRIEF_REQUIRED is in the shared error codes', () => { expect(ERROR_CODES).toContain('BRIEF_REQUIRED'); });
  it('a running task is still refused (409) when a brief is sent', async () => {
    const id = await mkTask(M1, `${M1}:coder-01`, 'running');
    expect((await L.req('POST', `/tasks/${id}/reassign`, { toInstanceId: (await insts())[0].id, brief: BRIEF }, key())).status).toBe(409);
  });
  it('the audit helper still writes through a pool (sanity for the purge test setup)', async () => {
    await audit(t.pool, { tenantId: t.app.cfg.tenantId, actor: 'x', action: 'c51.sanity', subject: 'S', result: 'ok', correlationId: 'c' });
    expect(await count(`select count(*)::int n from audit_events where action='c51.sanity'`)).toBe(1);
  });
});
