import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeTestApp, withAdmin, TEST_DB, type TestApp, type Browser } from './helpers.ts';
import { buildApp } from '../src/app.ts';
import { seedDemo } from '../src/seed/demo.ts';
import { hierarchy } from '../src/instances/service.ts';
import { loadRow, missionDto } from '../src/missions/service.ts';
import { AGENTS, AGENT_BY_ID } from '../../web/src/data/agents.ts';
import { staffingPlan, executorFor } from '../../web/src/features/mission/staffing-plan.ts';
import { KIND_DEPT, kindDeptText, departmentHead, departmentHeads, orgStaffing, FORMER_EXECUTOR_WHY, type OrgView } from '../../web/src/features/mission/staffing-org.ts';
const ST = { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' }; // c64: every proposal states a baseline and its expected cost

// Improvement cycle 11 (brief web/docs/improve/cycles/c11-brief.md): new real missions are staffed by the active organisation.
const KINDS = ['website', 'research', 'training', 'data', 'automation', 'structure', 'self-update'] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const key = () => ({ 'idempotency-key': 'c11-' + n++ });

/** The seeded organisation (revision 1): the fixture agents and their managerId lines. */
const seedOrg = (): OrgView => ({
  revision: 1,
  agents: AGENTS.map((a) => ({ id: a.id, dept: a.dept, active: true })),
  edges: AGENTS.filter((a) => a.managerId).map((a) => ({ supervisorId: a.managerId!, subordinateId: a.id })),
});
const move = (org: OrgView, moves: Record<string, string>): OrgView => ({
  ...org, edges: org.edges.map((e) => (moves[e.subordinateId] ? { ...e, supervisorId: moves[e.subordinateId] } : e)),
});

describe('kind → department, heads and the staffing plan (pure)', () => {
  it('c27 (c11 m3): the mission.create help names every kind with its department, generated from KIND_DEPT', () => {
    // (the help file is read as text: importing it would pull the web-only help registry into the server typecheck)
    const src = readFileSync(new URL('../../web/src/help/pages/missions.ts', import.meta.url), 'utf8');
    const line = src.split('\n').find((l) => l.includes("'mission.create'"))!;
    expect(line).toContain('${kindDeptText()}');
    expect(line).not.toMatch(/Engineering;|: R&D;|: QA;/); // no hand-copied table
    for (const k of KINDS) expect(kindDeptText(), k).toContain(k);
    for (const d of new Set(Object.values(KIND_DEPT))) expect(kindDeptText(), d).toContain(d);
    expect(kindDeptText()).toBe('website, automation, self-update: Engineering; research, data: R&D; training: QA; structure: Operations');
  });

  it('KIND_DEPT is the department of the fixture executor of every kind', () => {
    for (const k of KINDS) expect(KIND_DEPT[k], k).toBe(AGENT_BY_ID[executorFor(k)].dept);
    expect(Object.keys(KIND_DEPT).sort()).toEqual([...KINDS].sort());
  });

  it('without an organisation, staffingPlan is exactly the base fixture plan (no new keys)', () => {
    const base = JSON.parse(readFileSync(new URL('./fixtures/c11-fixture-plans.json', import.meta.url), 'utf8'));
    for (const k of KINDS) {
      expect(JSON.stringify(staffingPlan(k, 'Plain text.')), k).toBe(JSON.stringify(base[k]));
      expect(JSON.stringify(staffingPlan(k, 'Uses a voice model.')), k).toBe(JSON.stringify(base[k + '+model']));
    }
  });

  it('under the seeded organisation every kind staffs as before: same executor, same plan order, every agent under the executor', () => {
    for (const k of KINDS) for (const text of ['Plain text.', 'Uses a voice model.']) {
      const base = staffingPlan(k, text);
      const o = orgStaffing(k, base, seedOrg());
      expect(o.executorId, k).toBe(base.executorId);
      expect(o.plan.map((p) => [p.agentId, p.why]), k).toEqual(base.plan.map((p) => [p.agentId, p.why]));
      expect(o.plan.every((p) => p.managerId === base.executorId), k).toBe(true);
      expect(o.origin).toEqual({ revision: 1, dept: KIND_DEPT[k], executorFrom: 'head' });
    }
  });

  it('a department head is an active member reporting to the GM', () => {
    expect(departmentHeads('QA', seedOrg())).toEqual(['mentor-01', 'tester-01']);
    const org = seedOrg();
    org.agents = org.agents.map((a) => (a.id === 'tester-01' ? { ...a, active: false } : a));
    expect(departmentHeads('QA', org)).toEqual(['mentor-01']);
    expect(departmentHeads('Executive', seedOrg())).toEqual([]); // the GM is never a head
  });

  it('the executor follows the org: the head above the fixture executor, else the largest head, else the fixture rule', () => {
    // coder-01 under designer-01 (same department): designer-01 leads, coder-01 joins first under it
    const a = orgStaffing('website', staffingPlan('website', 'x'), move(seedOrg(), { 'coder-01': 'designer-01' }));
    expect(a.executorId).toBe('designer-01');
    expect(a.origin.executorFrom).toBe('head');
    expect(a.plan[0]).toEqual({ agentId: 'coder-01', why: FORMER_EXECUTOR_WHY, managerId: 'designer-01' });
    expect(a.plan.some((p) => p.agentId === 'designer-01')).toBe(false); // the executor is not planned twice
    // coder-01 under ops-01 (another department): the Engineering head with the most Engineering members under it
    expect(departmentHead('website', 'coder-01', move(seedOrg(), { 'coder-01': 'ops-01' }))).toBe('browser-01');
    // no head: QA's members both report to ops-01, so training falls back to the fixture executor
    const qa = move(seedOrg(), { 'mentor-01': 'ops-01', 'tester-01': 'ops-01' });
    expect(departmentHead('training', 'mentor-01', qa)).toBeUndefined();
    const t = orgStaffing('training', staffingPlan('training', 'x'), qa);
    expect(t.executorId).toBe('mentor-01');
    expect(t.origin).toEqual({ revision: 1, dept: 'QA', executorFrom: 'fixture' });
    expect(t.plan.every((p) => p.managerId === 'mentor-01')).toBe(true); // tester-01's supervisor ops-01 is not in the mission
  });

  it('a planned agent goes under its org supervisor when that supervisor is in the mission; managers join first', () => {
    const base = staffingPlan('research', 'x'); // analyst, browser, knowledge, writer, tester
    const w = orgStaffing('research', base, move(seedOrg(), { 'writer-01': 'analyst-01' }));
    expect(w.plan.map((p) => [p.agentId, p.managerId])).toEqual([
      ['analyst-01', 'researcher-01'], ['browser-01', 'researcher-01'], ['knowledge-01', 'researcher-01'], ['writer-01', 'analyst-01'], ['tester-01', 'researcher-01']]);
    // the manager comes later in fixture order: it is moved ahead of its report, the rest keep their order
    const r = orgStaffing('research', base, move(seedOrg(), { 'analyst-01': 'writer-01' }));
    const ids = r.plan.map((p) => p.agentId);
    expect(ids.indexOf('writer-01')).toBeLessThan(ids.indexOf('analyst-01'));
    expect(r.plan.find((p) => p.agentId === 'analyst-01')!.managerId).toBe('writer-01');
    expect(ids.filter((x) => x !== 'analyst-01')).toEqual(base.plan.map((p) => p.agentId).filter((x) => x !== 'analyst-01'));
    // a supervisor outside the mission: the executor
    const o = orgStaffing('research', base, move(seedOrg(), { 'writer-01': 'ops-01' }));
    expect(o.plan.find((p) => p.agentId === 'writer-01')!.managerId).toBe('researcher-01');
  });
});

/* ------------------------------------------------------------------ through the API */
async function until(f: () => Promise<boolean>, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await sleep(30); } return false; }
type Edge = { supervisorId: string; subordinateId: string };
async function applyMoves(A: Browser, B: Browser, moves: Record<string, string>) {
  const g = (await A.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };
  const edges = g.edges.map((e) => (moves[e.subordinateId] ? { ...e, supervisorId: moves[e.subordinateId] } : e));
  const p = await A.req('POST', '/organization/proposals', { ...ST, title: 'c11 move', why: 'Test.', baseRevision: g.revision.seq, edges }, key());
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const d = await B.req('POST', `/organization/proposals/${p.body.proposal.id}/decision`, { decision: 'approve', sha: p.body.proposal.sha });
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  return g.revision.seq + 1;
}
const parents = (h: { nodes: { agentId: string; parent?: string }[] }) => Object.fromEntries(h.nodes.map((x) => [x.agentId, x.parent ?? null]));

describe('real missions follow the active organisation; older and DEMO missions do not change', () => {
  let t: TestApp;
  let A: Browser, B: Browser, adminId = '';
  beforeAll(async () => {
    t = await makeTestApp({ staffingStepMs: 30, conversationSimMs: 3_600_000 });
    const w = await withAdmin(t.app);
    A = w.admin; adminId = w.adminId;
    const b = await w.member('Bea');
    B = b.b;
    expect((await A.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
  });
  afterAll(async () => { await t.close(); });

  const staffed = async (text: string) => {
    const m = (await A.req('POST', '/missions', { text, files: [], shared: false }, key())).body.mission;
    expect(await until(async () => (await A.req('GET', `/missions/${m.id}`)).body.mission.staffing.stage === 'working')).toBe(true);
    return m.id as string;
  };
  const hier = async (id: string) => (await A.req('GET', `/missions/${id}/hierarchy`)).body;

  it('after a proposal moves writer-01 under analyst-01, a new research mission has writer-01 under analyst-01; the earlier mission keeps its structure', async () => {
    const before = await staffed('Research competitor pricing.');
    const snapBefore = await hier(before);
    expect(parents(snapBefore)['writer-01']).toBe(`${before}:researcher-01`);
    const rev = await applyMoves(A, B, { 'writer-01': 'analyst-01' });
    const after = await staffed('Research competitor pricing.');
    const h = await hier(after);
    expect(parents(h)).toEqual({
      gm: null, 'researcher-01': `${after}:gm`, 'analyst-01': `${after}:researcher-01`, 'browser-01': `${after}:researcher-01`,
      'knowledge-01': `${after}:researcher-01`, 'writer-01': `${after}:analyst-01`, 'tester-01': `${after}:researcher-01`,
    });
    expect(h.edges).toContainEqual({ from: `${after}:analyst-01`, to: `${after}:writer-01`, kind: 'delegated' });
    const m = (await A.req('GET', `/missions/${after}`)).body.mission;
    expect(m.executorId).toBe('researcher-01');
    expect(m.staffing.org).toEqual({ revision: rev, dept: 'R&D', executorFrom: 'head' });
    expect(m.staffing.plan.find((p: any) => p.agentId === 'writer-01').managerId).toBe('analyst-01');
    // the mission staffed before the change: byte-identical hierarchy
    expect(JSON.stringify(await hier(before))).toBe(JSON.stringify(snapBefore));
  });

  it('the executor is the head of the kind\'s department: coder-01 under designer-01 makes designer-01 lead a website mission', async () => {
    const rev = await applyMoves(A, B, { 'coder-01': 'designer-01' });
    const id = await staffed('Build a website landing page for the shop.');
    const m = (await A.req('GET', `/missions/${id}`)).body.mission;
    expect(m.executorId).toBe('designer-01');
    expect(m.staffing.org).toEqual({ revision: rev, dept: 'Engineering', executorFrom: 'head' });
    const p = parents(await hier(id));
    expect(p['designer-01']).toBe(`${id}:gm`);
    expect(p['coder-01']).toBe(`${id}:designer-01`);
    expect(Object.entries(p).filter(([a]) => a !== 'gm' && a !== 'designer-01').every(([, v]) => v === `${id}:designer-01`)).toBe(true);
    expect(m.staffing.log.find((l: any) => l.by === 'gm' && l.agentId === 'designer-01').text).toContain('head of Engineering');
  });

  it('a department without a head falls back to the fixture executor', async () => {
    const rev = await applyMoves(A, B, { 'mentor-01': 'ops-01', 'tester-01': 'ops-01' });
    const id = await staffed('Train and coach the agents with exercises.');
    const m = (await A.req('GET', `/missions/${id}`)).body.mission;
    expect(m.kind).toBe('training');
    expect(m.executorId).toBe('mentor-01');
    expect(m.staffing.org).toEqual({ revision: rev, dept: 'QA', executorFrom: 'fixture' });
    const p = parents(await hier(id));
    expect(p['mentor-01']).toBe(`${id}:gm`);
    expect(p['tester-01']).toBe(`${id}:mentor-01`); // its supervisor ops-01 is not in the mission
  });

  it('DEMO missions seeded after these org changes are byte-identical to the base code (golden from 2ed66e9)', async () => {
    const latest = (await A.req('GET', '/organization/graph')).body.revision.seq;
    expect(latest).toBeGreaterThan(1);
    await seedDemo(t.app.db, 't-1', adminId);
    const golden = JSON.parse(readFileSync(new URL('./fixtures/c11-demo-hierarchy.json', import.meta.url), 'utf8'));
    const ids = (await t.pool.query(`select id from missions where demo order by id`)).rows.map((r) => r.id as string);
    expect(ids).toEqual(Object.keys(golden));
    for (const id of ids) {
      const d = missionDto(await loadRow(t.app.db, id));
      const now = { team: { agentIds: d.agentIds, leadId: d.leadId, executorId: d.executorId ?? null }, hierarchy: await hierarchy(t.app.db, id) };
      expect(JSON.stringify(now), id).toBe(JSON.stringify(golden[id]));
    }
  });
});

describe('a mission created before an org change keeps its plan when it is staffed after it', () => {
  it('created under revision 1, staffed (after a restart) under revision 2: writer-01 stays under the executor', async () => {
    const t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
    try {
      const w = await withAdmin(t.app);
      const b = await w.member('Bea');
      expect((await w.admin.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
      const m = (await w.admin.req('POST', '/missions', { text: 'Research the market.', files: [], shared: false }, key())).body.mission;
      expect(m.staffing.stage).toBe('reading');
      await applyMoves(w.admin, b.b, { 'writer-01': 'analyst-01' });
      const app2 = await buildApp({ databaseUrl: TEST_DB(), schema: t.schema, logger: false, staffingStepMs: 30, conversationSimMs: 3_600_000 });
      try {
        expect(await until(async () => (await t.pool.query(`select presentation->'staffing'->>'stage' s from missions where id=$1`, [m.id])).rows[0].s === 'working')).toBe(true);
      } finally { await app2.close(); }
      const inst = (await t.pool.query('select agent_id, manager_instance_id from agent_instances where mission_id=$1', [m.id])).rows;
      const p = Object.fromEntries(inst.map((r) => [r.agent_id, r.manager_instance_id]));
      expect(p['writer-01']).toBe(`${m.id}:researcher-01`);
      expect(p['analyst-01']).toBe(`${m.id}:researcher-01`);
    } finally { await t.close(); }
  });
});
