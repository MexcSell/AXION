import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { tx } from '../src/db.ts';
import { recordReview } from '../src/tasks/reviews.ts';
import { addVersion } from '../src/agents/service.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { MISSIONS } from '../../web/src/data/missions.ts';

// Improvement cycle 38 (O3): independent task review, producer != verifier (brief c38-brief.md).
let t: TestApp;
let L: Browser, mia: Browser, ben: Browser, zed: Browser;
let miaId = '', benId = '', luId = '';
let M1 = '', M2 = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'r' + Date.now() + '-' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await rows(sql, p))[0].n as number;
const RUBRIC = [{ criterion: 'The output is attached', result: 'pass', note: 'seen' }, { criterion: 'Tests pass', result: 'na', note: '' }];
const EV = [{ kind: 'url', ref: 'https://example.com/report' }];
const body = (over: Record<string, unknown> = {}) => ({ verdict: 'accepted', rubric: RUBRIC, evidence: EV, ...over });
const post = (b: Browser, task: string, o: Record<string, unknown> = body()) => b.req('POST', `/tasks/${task}/reviews`, o, key());
let tk = 0;
/** A task in `mission`, owned by the mission's coder-01 instance (the producer). */
async function mkTask(mission: string, owner: string | null = `${mission}:coder-01`) {
  const id = 'T-r' + ++tk + '-' + Math.random().toString(36).slice(2, 6);
  const tn = (await rows('select tenant_id from missions where id=$1', [mission]))[0].tenant_id;
  await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,$2,$3,'Write the report','passed',$4,$5)`, [id, tn, mission, owner ? owner.split(':')[1] : null, owner]);
  return id;
}
/** A message in a thread of `mission`, about `taskId` (evidence a reviewer may cite). */
async function mkMsg(mission: string, taskId: string | null) {
  const tn = (await rows('select tenant_id from missions where id=$1', [mission]))[0].tenant_id;
  const th = (await rows(`insert into conversation_threads(tenant_id, scope, mission_id, kind, a, b) values ($1,'mission',$2,'human-agent',$3,'human') on conflict (coalesce(mission_id, ''), coalesce(owner_user_id, ''), a, b) do update set kind=excluded.kind returning id`, [tn, mission, `${mission}:gm`]))[0].id;
  const seq = (await rows('select coalesce(max(seq),0)+1 n from messages where thread_id=$1', [th]))[0].n;
  return String((await rows(`insert into messages(thread_id, seq, author_kind, author_id, recipient, kind, body, task_id) values ($1,$2,'agent',$3,'human','report','The report is attached.',$4) returning id`, [th, seq, `${mission}:coder-01`, taskId]))[0].id);
}
async function staffed(b: Browser, shared: boolean) {
  const m = (await b.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared }, key())).body.mission.id as string;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && (await b.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
  return m;
}

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 30, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  L = w.admin; luId = w.adminId;
  const a = await w.member('Mia'), b = await w.member('Ben'), c = await w.member('Zed');
  mia = a.b; miaId = a.id; ben = b.b; benId = b.id; zed = c.b;
  M1 = await staffed(mia, true);   // Mia owns it, shared: everybody sees it
  M2 = await staffed(mia, false);  // private: only Mia and the administrator see it
});
afterAll(async () => { await t.close(); });

describe('POST /tasks/:id/reviews', () => {
  it('a person who is not the producer or the commissioner records an accepted review (201), derived server-side', async () => {
    const id = await mkTask(M1);
    const r = await post(ben, id);
    expect(r.status).toBe(201);
    expect(r.body.review).toMatchObject({ taskId: id, missionId: M1, verdict: 'accepted', reviewer: { id: benId, kind: 'user', name: 'Ben', modelFamily: null }, producer: { id: 'coder-01', kind: 'agent' } });
    expect(r.body.review.producer.modelFamily).toBe('claude');
    expect(r.body.review.evidence).toEqual(EV);
    const [row] = await rows('select * from task_reviews where task_id=$1', [id]);
    expect(row).toMatchObject({ reviewer_id: benId, reviewer_kind: 'user', producer_id: 'coder-01', producer_kind: 'agent', producer_model_family: 'claude', principal_id: miaId, verdict: 'accepted', mission_id: M1 });
    expect(await count(`select count(*)::int n from events where type='task.reviewed' and subject_id=$1`, [id])).toBe(1);
    expect(await count(`select count(*)::int n from audit_events where action='task.review' and subject=$1`, [id])).toBe(1);
  });

  it('the commissioner (the mission owner) reviewing the work they asked for: 403 REVIEW_NOT_INDEPENDENT, nothing stored', async () => {
    const id = await mkTask(M1);
    const r = await post(mia, id);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('REVIEW_NOT_INDEPENDENT');
    expect(await count('select count(*)::int n from task_reviews where task_id=$1', [id])).toBe(0);
    const g = await mia.req('GET', `/tasks/${id}/reviews`);
    expect(g.body.canReview).toMatchObject({ allowed: false, code: 'REVIEW_NOT_INDEPENDENT' });
    expect(typeof g.body.canReview.reason).toBe('string');
    expect((await ben.req('GET', `/tasks/${id}/reviews`)).body.canReview).toEqual({ allowed: true, code: null, reason: null });
  });

  it('the database refuses a review whose reviewer is the producer or the principal, even on a direct insert', async () => {
    const id = await mkTask(M1);
    const ins = (over: Record<string, unknown>) => {
      const v = { id: 'TR-x' + Math.random().toString(36).slice(2, 8), reviewer_id: benId, reviewer_kind: 'user', reviewer_model_family: null, producer_id: 'coder-01', producer_kind: 'agent', producer_model_family: 'claude', principal_id: miaId, verdict: 'accepted', evidence: JSON.stringify(EV), ...over };
      return t.pool.query(`insert into task_reviews(id, tenant_id, mission_id, task_id, reviewer_id, reviewer_kind, reviewer_model_family, producer_id, producer_kind, producer_model_family, principal_id, rubric, verdict, evidence)
        select $1, tenant_id, mission_id, id, $2,$3,$4,$5,$6,$7,$8, $9::jsonb, $10, $11::jsonb from tasks where id=$12`, [v.id, v.reviewer_id, v.reviewer_kind, v.reviewer_model_family, v.producer_id, v.producer_kind, v.producer_model_family, v.principal_id, JSON.stringify(RUBRIC), v.verdict, v.evidence, id]);
    };
    await ins({}); // control: the same insert with an independent reviewer works
    await expect(ins({ reviewer_id: miaId, producer_id: miaId, producer_kind: 'user' })).rejects.toThrow(/check constraint/);
    await expect(ins({ reviewer_id: miaId })).rejects.toThrow(/check constraint/); // reviewer = principal
    await expect(ins({ reviewer_id: 'coder-01', reviewer_kind: 'agent', reviewer_model_family: 'gpt' })).rejects.toThrow(/check constraint/); // reviewer = producer
    await expect(ins({ evidence: '[]' })).rejects.toThrow(/check constraint/); // accepted needs evidence
    await expect(ins({ reviewer_kind: 'user', reviewer_model_family: 'claude' })).rejects.toThrow(/check constraint/); // a person has no model family
  });

  it('two agents of one model family: refused by the service (403 REVIEW_SAME_MODEL_FAMILY) and by the database', async () => {
    const id = await mkTask(M1);
    const reviewer = { kind: 'agent' as const, id: 'tester-01' }; // both seeded agents run a claude model
    const asCtx = { tenantId: t.app.cfg.tenantId, user: { id: luId, role: 'admin', name: 'Luca' }, correlationId: 'c' } as never;
    const go = (b: unknown) => tx(t.app.db, (c) => recordReview(c, asCtx, id, b as never, reviewer));
    await expect(go(body())).rejects.toMatchObject({ code: 'REVIEW_SAME_MODEL_FAMILY', status: 403 });
    expect(await count('select count(*)::int n from task_reviews where task_id=$1', [id])).toBe(0);
    // a database-level refusal with equal families, and with an unknown (NULL) one
    const raw = (rf: string | null, pf: string | null) => t.pool.query(`insert into task_reviews(id, tenant_id, mission_id, task_id, reviewer_id, reviewer_kind, reviewer_model_family, producer_id, producer_kind, producer_model_family, principal_id, rubric, verdict, evidence)
      select 'TR-f' || md5(random()::text), tenant_id, mission_id, id, 'tester-01','agent',$1,'coder-01','agent',$2,$3,$4::jsonb,'accepted',$5::jsonb from tasks where id=$6`, [rf, pf, miaId, JSON.stringify(RUBRIC), JSON.stringify(EV), id]);
    await expect(raw('claude', 'claude')).rejects.toThrow(/check constraint/);
    await expect(raw(null, 'claude')).rejects.toThrow(/check constraint/);
    await expect(raw('claude', null)).rejects.toThrow(/check constraint/);
    await raw('gpt', 'claude'); // control: different families pass
  });

  it('an agent of another family may review: its family comes from its active version, and is stored', async () => {
    const id = await mkTask(M1);
    await tx(t.app.db, (c) => addVersion(c, { agentId: 'tester-01', model: 'gpt-5-judge', skills: [], tools: [], createdBy: 'system' }));
    const asCtx = { tenantId: t.app.cfg.tenantId, user: { id: luId, role: 'admin', name: 'Luca' }, correlationId: 'c' } as never;
    const r = await tx(t.app.db, (c) => recordReview(c, asCtx, id, body() as never, { kind: 'agent', id: 'tester-01' }));
    expect(r.review).toMatchObject({ reviewer: { id: 'tester-01', kind: 'agent', modelFamily: 'gpt' }, producer: { id: 'coder-01', modelFamily: 'claude' } });
    // the producer's family is the PINNED version of its instance, not the current active version of the definition
    const id2 = await mkTask(M1);
    await tx(t.app.db, (c) => addVersion(c, { agentId: 'coder-01', model: 'gpt-5-coder', skills: [], tools: [], createdBy: 'system' }));
    const r2 = await tx(t.app.db, (c) => recordReview(c, asCtx, id2, body() as never, { kind: 'agent', id: 'tester-01' }));
    expect(r2.review.producer.modelFamily).toBe('claude');
  });

  it('an accepted review needs evidence (400 VALIDATION); other verdicts may have none; a failed criterion cannot be accepted', async () => {
    const id = await mkTask(M1);
    const a = await post(ben, id, body({ evidence: [] }));
    expect(a.status).toBe(400); expect(a.body.code).toBe('VALIDATION');
    expect((await post(ben, id, body({ evidence: [] }))).body.fieldErrors?.evidence).toBeTruthy();
    const f = await post(ben, id, body({ rubric: [{ criterion: 'Tests pass', result: 'fail', note: 'red' }] }));
    expect(f.status).toBe(400); expect(f.body.code).toBe('VALIDATION');
    expect(await count('select count(*)::int n from task_reviews where task_id=$1', [id])).toBe(0);
    const ok = await post(ben, id, body({ verdict: 'changes_requested', evidence: [], rubric: [{ criterion: 'Tests pass', result: 'fail', note: 'red' }] }));
    expect(ok.status).toBe(201);
  });

  it('validation: unknown fields (a client-sent producer or reviewer), empty rubric, bad verdict, blank criterion, too much evidence', async () => {
    const id = await mkTask(M1);
    for (const o of [{ producerId: 'x' }, { reviewerId: 'x' }, { reviewerKind: 'agent' }, { reviewerModelFamily: 'gpt' }, { rubric: [] }, { verdict: 'verified' },
      { rubric: [{ criterion: '  ', result: 'pass', note: '' }] }, { rubric: [{ criterion: 'x', result: 'maybe', note: '' }] },
      { evidence: Array.from({ length: 21 }, (_, i) => ({ kind: 'url', ref: 'https://e.com/' + i })) }, { evidence: [{ kind: 'url', ref: 'javascript:alert(1)' }] }, { evidence: [{ kind: 'url', ref: 'ftp://e.com' }] }]) {
      const r = await post(ben, id, body(o));
      expect(r.status, JSON.stringify(o)).toBe(400);
      expect(r.body.code).toBe('VALIDATION');
    }
    expect((await ben.req('POST', `/tasks/${id}/reviews`, body())).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await count('select count(*)::int n from task_reviews where task_id=$1', [id])).toBe(0);
  });

  it('evidence must belong to this mission: a file or a message of another mission is refused (400), one of this mission is stored', async () => {
    const id = await mkTask(M1);
    const msg = { id: await mkMsg(M1, id) };
    const other = { id: await mkMsg(M2, null) };
    const bad = await post(ben, id, body({ evidence: [{ kind: 'message', ref: String(other.id) }] }));
    expect(bad.status).toBe(400); expect(bad.body.code).toBe('VALIDATION');
    expect((await post(ben, id, body({ evidence: [{ kind: 'file', ref: 'U-nope' }] }))).status).toBe(400);
    expect((await post(ben, id, body({ evidence: [{ kind: 'message', ref: 'abc' }] }))).status).toBe(400);
    const ok = await post(ben, id, body({ evidence: [{ kind: 'message', ref: String(msg.id) }] }));
    expect(ok.status).toBe(201);
  });

  it('an invisible mission is 404 (no existence leak), as is an unknown task; anonymous is 401', async () => {
    const id = await mkTask(M2);
    const r = await post(ben, id);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_FOUND');
    expect((await ben.req('GET', `/tasks/${id}/reviews`)).status).toBe(404);
    expect((await post(ben, 'T-nope')).status).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/api/v1/tasks/${id}/reviews`, headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(401);
    expect(await count('select count(*)::int n from task_reviews where task_id=$1', [id])).toBe(0);
    expect((await L.req('POST', `/tasks/${id}/reviews`, body(), key())).status).toBe(201); // the administrator sees it and is not the owner
  });

  it('a task with no owner has no producer: 422 TASK_NO_PRODUCER; a replay of the same key returns the stored result once', async () => {
    const free = await mkTask(M1, null);
    const r = await post(ben, free);
    expect(r.status).toBe(422); expect(r.body.code).toBe('TASK_NO_PRODUCER');
    expect((await ben.req('GET', `/tasks/${free}/reviews`)).body.canReview).toMatchObject({ allowed: false, code: 'TASK_NO_PRODUCER' });
    const id = await mkTask(M1);
    const k = key();
    const a = await ben.req('POST', `/tasks/${id}/reviews`, body(), k);
    const b = await ben.req('POST', `/tasks/${id}/reviews`, body(), k);
    expect(a.status).toBe(201); expect(b.status).toBe(201); expect(b.body).toEqual(a.body);
    expect(await count('select count(*)::int n from task_reviews where task_id=$1', [id])).toBe(1);
  });

  it('the new route is not swallowed by /tasks/:id/:action (that one still refuses "reviews" as an action)', async () => {
    const id = await mkTask(M1);
    expect((await ben.req('PUT', `/tasks/${id}/reviews`, body())).status).toBeGreaterThanOrEqual(400);
    const r = await post(ben, id);
    expect(r.body.code).not.toBe('ACTION_NOT_ALLOWED');
  });
});

describe('GET /tasks/:id/reviews', () => {
  it('lists reviews oldest first with the producer, the mission criteria, evidence options and each reviewer\'s agreement (not enough evidence below 5)', async () => {
    await t.pool.query(`update mission_revisions set criteria=$2::jsonb where mission_id=$1`, [M1, JSON.stringify([{ text: 'Page loads', done: false }, { text: 'Copy is proofread', done: false }])]);
    const id = await mkTask(M1);
    await mkMsg(M1, id);
    expect((await post(ben, id, body({ verdict: 'accepted' }))).status).toBe(201);
    expect((await post(zed, id, body({ verdict: 'rejected', evidence: [] }))).status).toBe(201);
    const g = await zed.req('GET', `/tasks/${id}/reviews`);
    expect(g.status).toBe(200);
    expect(g.body.reviews.map((r: any) => [r.reviewer.name, r.verdict])).toEqual([['Ben', 'accepted'], ['Zed', 'rejected']]);
    expect(g.body.producer).toMatchObject({ id: 'coder-01', kind: 'agent' });
    expect(g.body.criteria).toEqual(['Page loads', 'Copy is proofread']);
    expect(g.body.evidenceOptions.some((o: any) => o.kind === 'message')).toBe(true);
    const ben1 = g.body.reviews[0].reviewerAgreement;
    expect(ben1).toMatchObject({ n: expect.any(Number), state: 'none' });
    expect(g.body.reviews[1].reviewerAgreement).toEqual({ agreed: 0, n: 0, rate: null, state: 'none' });
  });

  it('agreement counts only reviews of missions the viewer can see', async () => {
    const id = await mkTask(M2); // private: Mia and the administrator only
    expect((await L.req('POST', `/tasks/${id}/reviews`, body(), key())).status).toBe(201);
    const open = await mkTask(M1);
    expect((await post(ben, open)).status).toBe(201);
    const asZed = (await zed.req('GET', `/tasks/${open}/reviews`)).body.reviews;
    const asLuca = (await L.req('GET', `/tasks/${open}/reviews`)).body.reviews;
    expect(asZed.length).toBe(asLuca.length);
    // no review of the private mission leaks into what Zed sees
    expect(JSON.stringify(asZed)).not.toContain(id);
  });
});

describe('append-only', () => {
  it('update, delete and truncate are refused', async () => {
    await mkTask(M1).then((id) => post(ben, id));
    await expect(t.pool.query(`update task_reviews set verdict='rejected'`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from task_reviews`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate task_reviews`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from tasks where mission_id=$1`, [M1])).rejects.toThrow(/append-only/); // cascade from tasks
    expect(await count('select count(*)::int n from task_reviews')).toBeGreaterThan(0);
  });

  it('clearDemo still removes the reviews of demo missions (purge flag) and keeps the real ones', async () => {
    const before = await count('select count(*)::int n from task_reviews');
    await seedDemo(t.app.db, t.app.cfg.tenantId, luId);
    const demoMission = MISSIONS[0].id;
    const dt = (await rows('select id from tasks where mission_id=$1 limit 1', [demoMission]))[0].id as string;
    await t.pool.query(`insert into task_reviews(id, tenant_id, mission_id, task_id, reviewer_id, reviewer_kind, producer_id, producer_kind, principal_id, rubric, verdict, evidence)
      select 'TR-demo1', tenant_id, mission_id, id, $2,'user','coder-01','agent', $3, $4::jsonb, 'accepted', $5::jsonb from tasks where id=$1`, [dt, benId, miaId, JSON.stringify(RUBRIC), JSON.stringify(EV)]);
    expect(await count('select count(*)::int n from task_reviews')).toBe(before + 1);
    await clearDemo(t.app.db, t.app.cfg.tenantId);
    expect(await count('select count(*)::int n from task_reviews')).toBe(before);
    expect(await count(`select count(*)::int n from task_reviews where id='TR-demo1'`)).toBe(0);
  });
});

describe('scorecard rows over HTTP', () => {
  it('"Tasks verified by review" counts a task once, exactly, with n; "Approved by a non-owner" is a separate row', async () => {
    const sc = async (b: Browser) => (await b.req('GET', '/company/scorecard?window=30d')).body.rows as { key: string; value: number | null; n: number; unit: string; state: string }[];
    const row = (rs: Awaited<ReturnType<typeof sc>>, k: string) => rs.find((r) => r.key === k)!;
    const before = row(await sc(zed), 'tasks_verified_by_review');
    const a = await mkTask(M1), b = await mkTask(M1);
    await post(ben, a, body());
    await post(ben, b, body({ verdict: 'rejected', evidence: [] }));
    const after = row(await sc(zed), 'tasks_verified_by_review');
    expect(after.value).toBe(before.value! + 1);
    expect(after.n).toBe(before.n + 2);
    expect(after.unit).toBe('tasks');
    expect(row(await sc(zed), 'approved_by_non_owner')).toMatchObject({ unit: 'missions' });
    // Zed cannot see M2, so its reviews are not in Zed's numbers, but are in Luca's
    const zedN = row(await sc(zed), 'tasks_verified_by_review').n, lucaN = row(await sc(L), 'tasks_verified_by_review').n;
    expect(lucaN).toBeGreaterThan(zedN);
  });
});

describe('rate limit', () => {
  it('reviews share the governance write budget: past the limit a review is 429 RATE_LIMITED and nothing is stored', async () => {
    const t2 = await makeTestApp({ staffingStepMs: 30, writeLimits: { proposals: { max: 2, windowMs: 60_000 } } });
    try {
      const w = await withAdmin(t2.app);
      const owner = (await w.member('Mia')).b, rev = (await w.member('Ben')).b;
      const m = (await owner.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: true }, key())).body.mission.id as string;
      for (let i = 0; i < 100 && (await owner.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working'; i++) await new Promise((r) => setTimeout(r, 40));
      const tn = (await t2.pool.query('select tenant_id from missions where id=$1', [m])).rows[0].tenant_id;
      const task = async (i: number) => { await t2.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,$2,$3,'x','passed','coder-01',$4)`, ['T-rl' + i, tn, m, `${m}:coder-01`]); return 'T-rl' + i; };
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) codes.push((await rev.req('POST', `/tasks/${await task(i)}/reviews`, body(), key())).status);
      expect(codes).toEqual([201, 201, 429]);
      expect((await t2.pool.query('select count(*)::int n from task_reviews')).rows[0].n).toBe(2);
    } finally { await t2.close(); }
  });
});
