import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';

// Improvement cycle 19 (theme C): mentoring plans, recorded and honest (brief c19-brief.md).
let t: TestApp;
let A: Browser; // administrator
let M: Browser; // member
let n = 0;
const key = () => ({ 'idempotency-key': 'm' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await rows(sql, p))[0].n as number;
const MENTEE = 'coder-01', MENTOR = 'mentor-01';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const plan = (over: Record<string, unknown> = {}) => ({ mentorId: MENTOR, skill: 'Code review', milestones: ['Read the review rubric', 'Review three pull requests'], reevalOn: inDays(14), ...over });
const create = (b: Browser, body: Record<string, unknown> = plan(), id = MENTEE) => b.req('POST', `/agents/${id}/mentoring`, body, key());

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
  const w = await withAdmin(t.app);
  A = w.admin;
  M = (await w.member('Mia')).b;
});
afterAll(async () => { await t.close(); });

describe('read', () => {
  it('everyone signed in reads plans (all, and per agent); anonymous cannot; empty at first', async () => {
    const r = await M.req('GET', '/mentoring');
    expect(r.status).toBe(200);
    expect(r.body.plans).toEqual([]);
    expect((await M.req('GET', `/agents/${MENTEE}/mentoring`)).body.plans).toEqual([]);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/mentoring' })).statusCode).toBe(401);
    expect((await M.req('GET', '/agents/nope-01/mentoring')).status).toBe(404);
  });
});

describe('create', () => {
  it('a member gets 403 and nothing is stored', async () => {
    const r = await create(M);
    expect(r.status).toBe(403);
    expect(await count('select count(*)::int n from mentoring_plans')).toBe(0);
  });

  it('the mentor must be another, active agent; the skill and milestones are validated', async () => {
    const same = await create(A, plan({ mentorId: MENTEE }));
    expect(same.status).toBe(422);
    expect(same.body.fieldErrors?.mentorId).toBeTruthy();
    expect((await create(A, plan({ mentorId: 'ghost-99' }))).status).toBe(422);
    expect((await create(A, plan({ skill: '   ' }))).status).toBe(400);
    expect((await create(A, plan({ milestones: [] }))).status).toBe(400);
    expect((await create(A, plan({ milestones: ['1', '2', '3', '4', '5', '6'] }))).status).toBe(400);
    expect((await create(A, plan({ milestones: ['ok', '  '] }))).status).toBe(400);
    expect((await create(A, plan({ reevalOn: 'tomorrow' }))).status).toBe(400);
    expect((await create(A, plan({ reevalOn: inDays(-3) }))).status).toBe(422); // a date already past
    expect((await create(A, plan(), 'nope-01')).status).toBe(404);
    expect((await A.req('POST', `/agents/${MENTEE}/mentoring`, plan())).status).toBe(400); // Idempotency-Key required
    expect((await create(A, { ...plan(), skillGain: 40 })).status).toBe(400); // no invented numbers: unknown fields refused
    expect(await count('select count(*)::int n from mentoring_plans')).toBe(0);
  });

  it('a retired mentor is refused', async () => {
    await t.pool.query(`update agent_definitions set status='retired' where id='ops-01'`);
    const r = await create(A, plan({ mentorId: 'ops-01' }));
    await t.pool.query(`update agent_definitions set status='active' where id='ops-01'`);
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors.mentorId).toMatch(/retired/);
  });

  it('an admin records a plan: milestones numbered, none done, audited, announced, idempotent', async () => {
    const k = key();
    const body = plan();
    const r = await A.req('POST', `/agents/${MENTEE}/mentoring`, body, k);
    expect(r.status).toBe(201);
    const p = r.body.plan;
    expect(p).toMatchObject({ menteeId: MENTEE, mentorId: MENTOR, skill: 'Code review', status: 'active', milestonesDone: 0, milestonesTotal: 2, evaluation: null });
    expect(p.id).toMatch(/^MP-/);
    expect(p.milestones.map((m: { seq: number; text: string; doneAt: unknown }) => [m.seq, m.text, m.doneAt])).toEqual([[1, 'Read the review rubric', null], [2, 'Review three pull requests', null]]);
    expect(p).not.toHaveProperty('gain');
    // the same key and body replays the same plan; nothing is added
    const again = await A.req('POST', `/agents/${MENTEE}/mentoring`, body, k);
    expect(again.body.plan.id).toBe(p.id);
    expect(await count('select count(*)::int n from mentoring_plans')).toBe(1);
    expect((await rows(`select 1 from audit_events where action='mentoring.plan' and subject=$1 and result='ok'`, [p.id])).length).toBe(1);
    const ev = await rows(`select * from events where type='mentoring.planned' and subject_id=$1`, [MENTEE]);
    expect(ev.length).toBe(1);
    expect(ev[0].audience).toBe('all');
    expect(ev[0].subject_kind).toBe('agent');
  });

  it('one active plan per agent', async () => {
    const r = await create(A, plan({ skill: 'Other' }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MENTORING_ACTIVE');
  });

  it('reads: all plans, per agent; another agent has none', async () => {
    const all = (await M.req('GET', '/mentoring')).body.plans;
    expect(all.length).toBe(1);
    expect(all[0].menteeName).toBe('Coder-01');
    expect(all[0].mentorName).toBe('Mentor-01');
    expect((await M.req('GET', `/agents/${MENTEE}/mentoring`)).body.plans.length).toBe(1);
    expect((await M.req('GET', '/agents/ops-01/mentoring')).body.plans).toEqual([]);
  });
});

describe('milestones', () => {
  it('a member cannot tick; an admin ticks once with who and when; a second tick is 409', async () => {
    const p = (await A.req('GET', `/agents/${MENTEE}/mentoring`)).body.plans[0];
    const m1 = p.milestones[0].id;
    const path = `/mentoring/${p.id}/milestones/${m1}/done`;
    expect((await M.req('POST', path)).status).toBe(403);
    const r = await A.req('POST', path);
    expect(r.status).toBe(200);
    expect(r.body.plan.milestonesDone).toBe(1);
    expect(r.body.plan.milestones[0]).toMatchObject({ doneBy: expect.any(String), doneByName: 'Luca' });
    expect(r.body.plan.milestones[0].doneAt).toBeTruthy();
    expect(r.body.plan.milestones[1].doneAt).toBeNull();
    const twice = await A.req('POST', path);
    expect(twice.status).toBe(409);
    expect((await A.req('POST', `/mentoring/${p.id}/milestones/00000000-0000-0000-0000-000000000000/done`)).status).toBe(404);
    expect((await A.req('POST', `/mentoring/MP-NOPE/milestones/${m1}/done`)).status).toBe(404);
    expect((await rows(`select 1 from audit_events where action='mentoring.milestone' and subject=$1 and result='ok'`, [p.id])).length).toBe(1);
    expect((await rows(`select 1 from events where type='mentoring.milestoneDone' and subject_id=$1`, [MENTEE])).length).toBe(1);
  });
});

describe('close', () => {
  it('a member gets 403; the outcome is validated; closing twice is 409; a closed plan takes no ticks', async () => {
    const p = (await A.req('GET', `/agents/${MENTEE}/mentoring`)).body.plans[0];
    expect((await M.req('POST', `/mentoring/${p.id}/close`, { outcome: 'completed', note: '' })).status).toBe(403);
    expect((await A.req('POST', `/mentoring/${p.id}/close`, { outcome: 'great', note: '' })).status).toBe(400);
    const r = await A.req('POST', `/mentoring/${p.id}/close`, { outcome: 'cancelled', note: 'Mentor is reassigned' });
    expect(r.status).toBe(200);
    expect(r.body.plan).toMatchObject({ status: 'cancelled', closedByName: 'Luca', note: 'Mentor is reassigned', milestonesDone: 1 });
    expect(r.body.plan.closedAt).toBeTruthy();
    const twice = await A.req('POST', `/mentoring/${p.id}/close`, { outcome: 'completed', note: '' });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('PLAN_CLOSED');
    const tick = await A.req('POST', `/mentoring/${p.id}/milestones/${p.milestones[1].id}/done`);
    expect(tick.status).toBe(409);
    expect(tick.body.code).toBe('PLAN_CLOSED');
    expect((await rows(`select status from mentoring_plans where id=$1`, [p.id]))[0].status).toBe('cancelled');
    expect((await rows(`select 1 from audit_events where action='mentoring.close' and subject=$1 and result='ok'`, [p.id])).length).toBe(1);
    expect((await rows(`select 1 from audit_events where action='mentoring.close' and subject=$1 and result='denied'`, [p.id])).length).toBeGreaterThan(0);
    expect((await rows(`select 1 from events where type='mentoring.closed' and subject_id=$1`, [MENTEE])).length).toBe(1);
  });

  it('the closed plan stays in history and a new plan can start', async () => {
    const hist = (await M.req('GET', `/agents/${MENTEE}/mentoring`)).body.plans;
    expect(hist.map((p: { status: string }) => p.status)).toEqual(['cancelled']);
    const r = await create(A, plan({ skill: 'Testing', milestones: ['Write a test plan'] }));
    expect(r.status).toBe(201);
    const list = (await M.req('GET', `/agents/${MENTEE}/mentoring`)).body.plans;
    expect(list.map((p: { status: string }) => p.status)).toEqual(['active', 'cancelled']); // newest first
    const done = await A.req('POST', `/mentoring/${r.body.plan.id}/close`, { outcome: 'completed', note: '' });
    expect(done.body.plan.status).toBe('completed');
  });

  it('closed plans and their milestones cannot be changed in the database', async () => {
    const closed = (await rows(`select id from mentoring_plans where status<>'active' limit 1`))[0].id;
    expect(closed).toBeTruthy();
    await expect(t.pool.query(`update mentoring_plans set skill='x' where id=$1`, [closed])).rejects.toThrow();
    await expect(t.pool.query(`update mentoring_plans set status='active' where id=$1`, [closed])).rejects.toThrow();
    await expect(t.pool.query(`update mentoring_milestones set text='x'`)).rejects.toThrow();
    await expect(t.pool.query(`delete from mentoring_plans`)).rejects.toThrow();
  });
});

describe('tenant', () => {
  it('another tenant\'s plan, agent and milestone are 404 and never listed', async () => {
    await t.pool.query(`insert into tenants(id,name) values ('t-2','Other')`);
    await t.pool.query(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
    for (const id of ['other-01', 'other-02']) await t.pool.query(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ($1,'t-2',$1,'other','Ops',$1,'u-x')`, [id]);
    await t.pool.query(`insert into mentoring_plans(id, tenant_id, mentee_id, mentor_id, skill, reeval_on, created_by) values ('MP-X','t-2','other-01','other-02','S','2030-01-01','u-x')`);
    const mid = (await t.pool.query(`insert into mentoring_milestones(plan_id, seq, text) values ('MP-X',1,'m') returning id`)).rows[0].id;
    expect((await A.req('GET', '/agents/other-01/mentoring')).status).toBe(404);
    expect((await A.req('GET', '/mentoring')).body.plans.every((p: { id: string }) => p.id !== 'MP-X')).toBe(true);
    expect((await A.req('POST', `/mentoring/MP-X/milestones/${mid}/done`)).status).toBe(404);
    expect((await A.req('POST', '/mentoring/MP-X/close', { outcome: 'completed', note: '' })).status).toBe(404);
    expect((await create(A, plan(), 'other-01')).status).toBe(404);
    expect((await create(A, plan({ mentorId: 'other-02' }))).status).toBe(422); // another tenant's agent is no mentor
    expect((await rows(`select status from mentoring_plans where id='MP-X'`))[0].status).toBe('active');
  });
});

describe('migration 0023', () => {
  it('down and up again on a populated schema keeps agents; plans are recreated empty', async () => {
    const all = listMigrations().map((m) => m.version);
    const prev = Math.max(...all.filter((v) => v < 23));
    const latest = Math.max(...all);
    expect(latest).toBeGreaterThanOrEqual(23);
    const agents = await count('select count(*)::int n from agent_definitions');
    expect(await count('select count(*)::int n from mentoring_plans')).toBeGreaterThan(0);
    const has = async (tn: string) => (await rows(`select 1 from information_schema.tables where table_schema=$1 and table_name=$2`, [t.schema, tn])).length === 1;
    expect(await migrate(t.pool, 'down', prev)).toBe(prev);
    expect(await has('mentoring_plans')).toBe(false);
    expect(await has('mentoring_milestones')).toBe(false);
    expect(await count('select count(*)::int n from agent_definitions')).toBe(agents);
    expect(await migrate(t.pool, 'up')).toBe(latest);
    expect(await has('mentoring_plans')).toBe(true);
    expect(await has('mentoring_milestones')).toBe(true);
    expect((await M.req('GET', '/mentoring')).body.plans).toEqual([]);
  });
});
