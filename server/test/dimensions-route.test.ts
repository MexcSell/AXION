import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';
import { DIMENSION_KEYS } from '../../shared/contracts/src/index.ts';

// Improvement cycle 46: GET /api/v1/company/dimensions — access, shape, the "no value without n" rule on the real route, visibility
// (a member's response must not move when rows appear on missions they cannot see, in every mission-scoped source), simulated rows.
let t: TestApp;
let A: Browser, M: Browser;
let adminId = '', minaId = '';
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
const HASH = 'a'.repeat(64);
let seq = 0;

async function mission(id: string, owner: string, o: { shared?: boolean; demo?: boolean } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,'t-1',$2,$3,'running',$4)`, [id, owner, o.shared ?? false, o.demo ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
}
async function instance(m: string, agent: string, simulated = false) {
  await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, simulated) select $1,'t-1',$2,d.id,d.active_version_id,$4 from agent_definitions d where d.id=$3`, [`${m}:${agent}`, m, agent, simulated]);
}
async function task(id: string, m: string, agent: string, status: string, o: { simulated?: boolean; attempts?: number } = {}) {
  await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated, created_at) values ($1,'t-1',$2,'T',$3,$4,$5,$6, now() - interval '3 days')`, [id, m, status, agent, `${m}:${agent}`, o.simulated ?? false]);
  for (let i = 1; i <= (o.attempts ?? 1); i++) await q(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,$2, now() - interval '2 days', now() - interval '1 day', $3)`, [id, i, status]);
  await q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at) values ('t-1','task.stateChanged',$1,$2,'task',$3,'mission',$4, now() - interval '1 day')`, [m, 800000 + seq++, id, JSON.stringify({ taskId: id, from: 'running', to: status })]);
}
const review = (id: string, m: string, taskId: string, agent: string) => q(
  `insert into task_reviews(id, tenant_id, mission_id, task_id, reviewer_id, reviewer_kind, reviewer_model_family, producer_id, producer_kind, producer_model_family, principal_id, rubric, verdict, evidence)
   values ($1,'t-1',$2,$3,'rev-x','agent','fam-b',$4,'agent','fam-a','owner-x','[{"criterion":"c","result":"pass"}]','accepted','[{"kind":"note","id":"n"}]')`, [id, m, taskId, `${m}:${agent}`]);
const ledger = (m: string, v: number) => q(`insert into mission_ledgers(tenant_id, mission_id, kind, version, body, author_id, author_kind) values ('t-1',$1,'progress',$2,'{"satisfied":false,"looping":false,"progressing":false,"notes":"","stall":1}','u','human')`, [m, v]);
const approval = (id: string, m: string, by: string, demo = false) => q(`insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, digest_version, demo, created_at, expires_at) values ($1,'t-1',$2,'coder-01','k','t','R1','d',2,$3, now() - interval '1 day', now() + interval '1 day')`, [id, m, demo])
  .then(() => q(`insert into approval_decisions(approval_id, decision, digest, decided_by, decided_at) values ($1,'approved','d',$2, now() - interval '1 day' + interval '2 hours')`, [id, by]));
const delegation = (m: string, agent: string, simulated = false) => q(`insert into mission_delegations(mission_id, from_instance, to_instance, edge_kind, simulated) values ($1,$2,$2,'delegated',$3)`, [m, `${m}:${agent}`, simulated]);
const brief = (m: string, agent: string) => q(`insert into delegation_briefs(tenant_id, mission_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by) values ('t-1',$1,'u','user',$2,$3,'{}'::jsonb,$4,1,'u')`, [m, `${m}:${agent}`, agent, HASH]);
const tag = (id: string, m: string, taskId: string, mode: string) => q(`insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, decided_by, decided_at) values ($1,'t-1',$2,'task',$3,'mast-arxiv-2503.13657v3',$4,'u1','user','confirmed','u2', now())`, [id, m, taskId, mode]);
const grant = (id: string, m: string, issuer: string) => q(`insert into site_grants(id, tenant_id, mission_id, exact_origin, capabilities, issued_by, expires_at) values ($1,'t-1',$2,'https://example.com',array['read'],$3, now() + interval '5 days')`, [id, m, issuer]);

const dims = async (b: Browser, qs = '') => { const r = await b.req('GET', '/company/dimensions' + qs); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body; };
const cells = (body: any) => body.dimensions.flatMap((d: any) => d.cells) as any[];
const cell = (body: any, key: string) => cells(body).find((c) => c.key === key);
/** compare responses without the clock-derived fields */
const strip = (body: any) => JSON.stringify(body.dimensions.map((d: any) => d.cells.map(({ from, to, ...c }: any) => c)));

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  const m = await w.member('Mina'); M = m.b; minaId = m.id;
});
afterAll(async () => { await t?.close(); });

describe('access and shape', () => {
  it('anonymous is 401; unknown window, unknown parameter (includeDemo) and unknown department are refused', async () => {
    expect((await new Browser(t.app).req('GET', '/company/dimensions')).status).toBe(401);
    expect((await A.req('GET', '/company/dimensions?window=1y')).status).toBe(400);
    expect((await A.req('GET', '/company/dimensions?includeDemo=1')).status).toBe(400);
    expect((await A.req('GET', '/company/dimensions?department=Nowhere')).status).toBe(404);
  });
  it('a fresh database: six dimensions in order, every cell honest, nothing invented', async () => {
    const b = await dims(M);
    expect(b.window).toBe('30d');
    expect(new Date(b.to).getTime() - new Date(b.from).getTime()).toBe(30 * 86_400_000);
    expect(b.dimensions.map((d: any) => d.key)).toEqual([...DIMENSION_KEYS]);
    expect(b.departments).toContain('Engineering');
    for (const c of cells(b)) {
      if (c.value === null) expect(c.evidence.startsWith(`not enough evidence (n = ${c.n})`), c.key).toBe(true);
      else expect(c.n).toBeGreaterThanOrEqual(c.minN);
    }
    expect(cell(b, 'capability.playbook_items')).toMatchObject({ basis: 'snapshot' });
    expect(cell(b, 'environmental.site_navigation')).toMatchObject({ value: null, n: 0 });
    expect(Object.keys(b)).not.toContain('score');
  });
  it('7d and 90d are accepted and the department filter is echoed', async () => {
    expect((await dims(M, '?window=7d')).window).toBe('7d');
    const b = await dims(M, '?window=90d&department=Engineering');
    expect([b.window, b.department]).toEqual(['90d', 'Engineering']);
  });
});

describe('visibility and exclusion on recorded rows', () => {
  let before: string;
  const beforeDept: Record<string, string> = {};
  beforeAll(async () => {
    // a shared mission everyone sees, with four finished tasks of coder-01 (Engineering) reviewed on a first attempt
    await mission('S', adminId, { shared: true });
    await instance('S', 'coder-01');
    for (let i = 0; i < 4; i++) { await task(`S${i}`, 'S', 'coder-01', 'passed'); await review(`TR-S${i}`, 'S', `S${i}`, 'coder-01'); }
    before = strip(await dims(M));
    for (const d of ['Engineering', 'QA']) beforeDept[d] = strip(await dims(M, `?department=${d}`));
  });
  it('the shared mission produces values for a member', async () => {
    const b = await dims(M);
    expect(cell(b, 'cognitive.first_attempt_verified')).toMatchObject({ value: 100, n: 4, state: 'ok' });
    expect(cell(b, 'capability.first_pass')).toMatchObject({ value: null, n: 4 }); // 4 outcomes < 5
    expect(cell(await dims(M, '?department=Engineering'), 'cognitive.first_attempt_verified').n).toBe(4);
    expect(cell(await dims(M, '?department=QA'), 'cognitive.first_attempt_verified').n).toBe(0);
  });
  it('rows on a private mission of the admin, in every mission-scoped source, change nothing for a member', async () => {
    await mission('P', adminId); // private
    await instance('P', 'coder-01');
    for (let i = 0; i < 6; i++) {
      await task(`P${i}`, 'P', 'coder-01', i % 2 ? 'failed' : 'passed', { attempts: 2 });
      await review(`TR-P${i}`, 'P', `P${i}`, 'coder-01');
      await ledger('P', i + 1);
      await approval(`AP-P${i}`, 'P', adminId);
      await delegation('P', 'coder-01'); await brief('P', 'coder-01');
      await tag(`FT-P${i}`, 'P', `P${i}`, 'FM-1.4');
      await grant(`SG-P${i}`, 'P', adminId);
    }
    expect(strip(await dims(M))).toBe(before);
    for (const d of ['Engineering', 'QA']) expect(strip(await dims(M, `?department=${d}`))).toBe(beforeDept[d]);
  });
  it('the administrator sees those same rows', async () => {
    const b = await dims(A);
    expect(cell(b, 'cognitive.first_attempt_verified').n).toBe(4); // P's tasks have two attempts: outside the first-attempt sample
    expect(cell(b, 'cognitive.stalled_missions')).toMatchObject({ n: 1 }); // P only: S has no ledger
    expect(cell(b, 'collective.approval_decision_h')).toMatchObject({ n: 6, value: 2 });
    expect(cell(b, 'collective.briefed_delegations')).toMatchObject({ n: 6, value: 100 });
    expect(cell(b, 'collective.cross_family_reviews')).toMatchObject({ n: 10, value: 100 });
    expect(cell(b, 'capability.site_grants')).toMatchObject({ n: 6, value: 6 });
    expect(cell(b, 'environmental.env_tagged')).toMatchObject({ n: 6, value: 100 }); // every P task has two attempts, so all six are retried and tagged
    expect(cell(b, 'capability.first_pass')).toMatchObject({ n: 10, value: 40 }); // S: 4 first-time passes; P: 3 retried passes and 3 failures
  });
  it('a member never gets site grant or lesson counts, whatever the rows say', async () => {
    const b = await dims(M);
    for (const k of ['capability.site_grants', 'knowledge.lessons_proposed', 'knowledge.lessons_accepted', 'knowledge.lessons_rolled_back']) expect(cell(b, k)).toMatchObject({ value: null, n: 0, state: 'none' });
  });
  it('sharing the private mission makes its rows visible to the member (the same predicate as the scorecard)', async () => {
    await q(`update missions set shared = true where id='P'`);
    expect(strip(await dims(M))).not.toBe(before);
    expect(cell(await dims(M), 'cognitive.stalled_missions').n).toBe(1);
    await q(`update missions set shared = false where id='P'`);
    expect(strip(await dims(M))).toBe(before);
  });
  it('DEMO missions and simulated rows change nothing, even for the administrator', async () => {
    const adminBefore = strip(await dims(A));
    await mission('DM', adminId, { shared: true, demo: true });
    await instance('DM', 'coder-01', true);
    await instance('S', 'tester-01', true);
    for (let i = 0; i < 6; i++) {
      await task(`DM${i}`, 'DM', 'coder-01', 'failed', { simulated: true });
      await task(`SIM${i}`, 'S', 'tester-01', 'failed', { simulated: true });
      await review(`TR-DM${i}`, 'DM', `DM${i}`, 'coder-01'); await ledger('DM', i + 1); await approval(`AP-DM${i}`, 'DM', adminId, true);
      await delegation('S', 'tester-01', true); await tag(`FT-SIM${i}`, 'S', `SIM${i}`, 'FM-1.4');
    }
    expect(strip(await dims(A))).toBe(adminBefore);
    expect(strip(await dims(M))).toBe(before);
  });
});

describe('knowledge and evolution rows for administrators', () => {
  it('lessons, promotions, rollbacks and org revisions are counted, and a department filter follows the agent', async () => {
    for (let i = 0; i < 4; i++) {
      await q(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,sha256,status,decided_by,decided_at,accepted_in_version)
               values ($1,'t-1','coder-01','coder','lesson text','[{"kind":"note","id":"n"}]','p1',$2,'accepted','p2', now(), 1)`, [`LC-${i}`, HASH]);
    }
    const a = await dims(A);
    expect(cell(a, 'knowledge.lessons_proposed')).toMatchObject({ value: 4, n: 4 });
    expect(cell(a, 'knowledge.lessons_accepted')).toMatchObject({ value: 100, n: 4 });
    expect(cell(await dims(A, '?department=QA'), 'knowledge.lessons_proposed')).toMatchObject({ value: null, n: 0 });
    expect(cell(await dims(A, '?department=Engineering'), 'knowledge.lessons_proposed').n).toBe(4);
    expect(cell(a, 'evolutionary.org_revisions').n).toBe(0); // only the seeded starting chart exists
  });
});
