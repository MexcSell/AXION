import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, TEST_DB, type TestApp } from './helpers.ts';
import { buildApp } from '../src/app.ts';
import { executorOf } from '../../web/src/features/mission/staffing-plan.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { backfillMissionControl } from '../src/instances/backfill.ts';
import { MISSIONS } from '../../web/src/data/missions.ts';

let t: TestApp;
afterEach(async () => { await t.close(); });
let n = 0;
const key = () => ({ 'idempotency-key': 'i' + n++ });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await rows(sql, p))[0].n as number;
async function until(f: () => Promise<boolean>, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await sleep(40); } return false; }

const WEB = 'Build a website landing page for the shop.';
async function staffed(A: Awaited<ReturnType<typeof withAdmin>>, text = WEB) {
  const m = (await A.admin.req('POST', '/missions', { text, files: [], shared: false }, key())).body.mission;
  await until(async () => (await A.admin.req('GET', `/missions/${m.id}`)).body.mission.staffing.stage === 'working');
  return m.id as string;
}

describe('instances created by staffing', () => {
  it('two missions staffed with coder-01 have two instances with separate state', async () => {
    t = await makeTestApp({ staffingStepMs: 30 });
    const A = await withAdmin(t.app);
    const m1 = await staffed(A), m2 = await staffed(A);
    const ins = await rows(`select * from agent_instances where agent_id='coder-01' order by mission_id`);
    expect(ins.map((i) => i.id).sort()).toEqual([`${m1}:coder-01`, `${m2}:coder-01`].sort());
    await t.pool.query(`update agent_instances set state='blocked', progress=40 where id=$1`, [`${m1}:coder-01`]);
    const other = (await rows(`select state, progress from agent_instances where id=$1`, [`${m2}:coder-01`]))[0];
    expect(other.state).toBe('idle'); expect(other.progress).toBe(0); // real mission: nothing executes, so no instance claims to be working
    expect((await rows(`select distinct state from agent_instances where mission_id=$1`, [m2])).map((r) => r.state)).toEqual(['idle']);
    // real mission: recorded, not simulated; every non-GM instance has one delegated row from its manager
    expect(ins.every((i) => i.simulated === false)).toBe(true);
    const d = await rows(`select * from mission_delegations where mission_id=$1 and edge_kind='delegated'`, [m1]);
    const inst = await count(`select count(*)::int n from agent_instances where mission_id=$1`, [m1]);
    expect(d.length).toBe(inst - 1);
    const ev = await rows(`select type from events where mission_id=$1 and type in ('instance.created','task.delegated')`, [m1]);
    expect(ev.filter((e) => e.type === 'instance.created').length).toBe(inst); // the GM instance too
    expect(ev.filter((e) => e.type === 'task.delegated').length).toBe(inst - 1);
  });

  it('a skills PATCH keeps the old instance on v(n); the next staffed mission gets v(n+1)', async () => {
    t = await makeTestApp({ staffingStepMs: 30 });
    const A = await withAdmin(t.app);
    const m1 = await staffed(A);
    const old = (await A.admin.req('GET', '/agents/coder-01')).body.agent;
    const p = await A.admin.req('PATCH', '/agents/coder-01', { skills: [...old.skills, 'Rust'] }, { 'if-match': String(old.rowVersion) });
    expect(p.status).toBe(200);
    const m2 = await staffed(A);
    const h1 = (await A.admin.req('GET', `/missions/${m1}/hierarchy`)).body, h2 = (await A.admin.req('GET', `/missions/${m2}/hierarchy`)).body;
    const l1 = h1.nodes.find((x: any) => x.agentId === 'coder-01').versionLabel, l2 = h2.nodes.find((x: any) => x.agentId === 'coder-01').versionLabel;
    expect(l1).toBe(old.versionLabel);
    expect(l2).toBe(p.body.agent.versionLabel);
    expect(l1).not.toBe(l2);
    const list = (await A.admin.req('GET', '/agent-instances?agentId=coder-01')).body.instances;
    expect(list.length).toBe(2);
    expect((await A.admin.req('GET', `/agent-instances/${m1}:coder-01`)).body.instance.versionLabel).toBe(old.versionLabel);
  });

  it('hierarchy and tasks of a private mission are 404 for another member; shared ones are readable', async () => {
    t = await makeTestApp({ staffingStepMs: 30 });
    const A = await withAdmin(t.app);
    const bob = await A.member('Bob');
    const m = await staffed(A);
    expect((await bob.b.req('GET', `/missions/${m}/hierarchy`)).status).toBe(404);
    expect((await bob.b.req('GET', `/missions/${m}/tasks`)).status).toBe(404);
    expect((await bob.b.req('GET', `/agent-instances/${m}:coder-01`)).status).toBe(404);
    expect((await bob.b.req('GET', '/agent-instances')).body.instances).toEqual([]);
    expect((await A.admin.req('GET', `/missions/${m}/hierarchy`)).status).toBe(200);
    await A.admin.req('POST', `/missions/${m}/share`, { shared: true });
    const h = await bob.b.req('GET', `/missions/${m}/hierarchy`);
    expect(h.status).toBe(200);
    expect(h.body.edges.some((e: any) => e.kind === 'reports')).toBe(true);
    expect(h.body.nodes[0].versionLabel).toBeTruthy();
  });

  it('presentation.agentIds is no longer written, and the DTO still lists the team', async () => {
    t = await makeTestApp({ staffingStepMs: 30 });
    const A = await withAdmin(t.app);
    const m = (await A.admin.req('POST', '/missions', { text: 'Research competitor pricing.', files: [], shared: false }, key())).body.mission;
    expect(m.agentIds).toEqual(['gm']);
    const done = await until(async () => (await A.admin.req('GET', `/missions/${m.id}`)).body.mission.staffing.stage === 'working');
    expect(done).toBe(true);
    const dto = (await A.admin.req('GET', `/missions/${m.id}`)).body.mission;
    const pres = (await rows(`select presentation from missions where id=$1`, [m.id]))[0].presentation;
    expect(pres.agentIds).toEqual(['gm']); // untouched since creation
    expect(dto.agentIds).toEqual(['gm', 'researcher-01', ...dto.staffing.plan.map((p: any) => p.agentId)]);
    expect(dto.leadId).toBe('gm');
    expect(dto.executorId).toBe('researcher-01');
  });
});

describe('append-only', () => {
  it('UPDATE and DELETE on mission_delegations and task_attempts throw', async () => {
    t = await makeTestApp({ staffingStepMs: 30 });
    const A = await withAdmin(t.app);
    const m = await staffed(A);
    await expect(t.pool.query(`update mission_delegations set simulated=true where mission_id=$1`, [m])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from mission_delegations where mission_id=$1`, [m])).rejects.toThrow(/append-only/);
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title) values ('T-x1',$1,$2,'x')`, [t.app.cfg.tenantId, m]);
    await t.pool.query(`insert into task_attempts(task_id, attempt_no) values ('T-x1',1)`);
    await expect(t.pool.query(`update task_attempts set result='x'`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from task_attempts`)).rejects.toThrow(/append-only/);
  });
});

describe('startup backfill', () => {
  it('creates instances, delegations and tasks for demo and real missions; a second run changes nothing; demo:clear still works', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000 });
    const A = await withAdmin(t.app);
    const tenant = t.app.cfg.tenantId;
    await seedDemo(t.app.db, tenant, A.adminId);
    const real = (await A.admin.req('POST', '/missions', { text: 'Research competitor pricing.', files: [], shared: false }, key())).body.mission;
    // pretend this is the Stage 5 database: no instances at all
    await t.pool.query('alter table mission_delegations disable trigger user');
    await t.pool.query('delete from agent_instances');
    await t.pool.query('alter table task_owner_history disable trigger user'); // c51: test-only wipe, like the delegations above
    await t.pool.query('delete from tasks');
    await t.pool.query('alter table task_owner_history enable trigger user');
    await t.pool.query('alter table mission_delegations enable trigger user');
    const before = (await A.admin.req('GET', '/missions')).body.missions as any[];

    const c = await t.pool.connect();
    try { await c.query('begin'); const r = await backfillMissionControl(c, tenant); await c.query('commit'); expect(r.missions).toBe(MISSIONS.length + 1); } finally { c.release(); }
    const snap = async () => ({
      i: await count('select count(*)::int n from agent_instances'), d: await count('select count(*)::int n from mission_delegations'),
      t: await count('select count(*)::int n from tasks'), td: await count('select count(*)::int n from task_dependencies'),
    });
    const s1 = await snap();
    expect(s1.i).toBeGreaterThan(MISSIONS.length); expect(s1.d).toBeGreaterThan(0); expect(s1.t).toBeGreaterThan(0); expect(s1.td).toBeGreaterThan(0);
    for (const m of [...MISSIONS.map((x) => x.id), real.id]) {
      expect(await count('select count(*)::int n from agent_instances where mission_id=$1', [m])).toBeGreaterThan(0);
    }
    expect(await count(`select count(*)::int n from mission_delegations where edge_kind='reports'`)).toBe(0);
    expect(await count(`select count(*)::int n from agent_instances where mission_id=$1 and simulated`, [real.id])).toBe(0);
    expect(await count(`select count(*)::int n from agent_instances where mission_id<>$1 and not simulated`, [real.id])).toBe(0);
    expect(await count(`select count(*)::int n from agent_instances where agent_version_id is null`)).toBe(0);

    const c2 = await t.pool.connect();
    try { await c2.query('begin'); const r = await backfillMissionControl(c2, tenant); await c2.query('commit'); expect(r.missions).toBe(0); } finally { c2.release(); }
    expect(await snap()).toEqual(s1);

    // the team of every mission is unchanged by deriving it from instances
    const after = (await A.admin.req('GET', '/missions')).body.missions as any[];
    for (const b of before) {
      const a = after.find((x) => x.id === b.id);
      expect([...a.agentIds].sort()).toEqual([...b.agentIds].sort());
      expect(a.leadId).toBe(b.leadId);
      expect(a.executorId).toBe(executorOf(b)); // what the web computed before (explicit, else non-GM lead, else first non-GM)
    }
    // UI-shaped reads
    const demoId = MISSIONS[0].id;
    const tasks = (await A.admin.req('GET', `/missions/${demoId}/tasks`)).body;
    expect(tasks.length).toBeGreaterThan(0);
    expect(Object.keys(tasks[0]).sort()).toEqual(['col', 'deps', 'evidence', 'id', 'owner', 'row', 'state', 'title', 'weight']);
    expect(tasks.every((x: any) => ['queued', 'ready', 'running', 'waiting-agent', 'waiting-user', 'verifying', 'passed', 'failed', 'canceled'].includes(x.state))).toBe(true);
    const h = (await A.admin.req('GET', `/missions/${demoId}/hierarchy`)).body;
    expect(h.nodes.length).toBe(after.find((x) => x.id === demoId).agentIds.length);

    await clearDemo(t.app.db, tenant);
    expect(await count(`select count(*)::int n from mission_delegations where mission_id=$1`, [demoId])).toBe(0);
    expect(await count(`select count(*)::int n from agent_instances where mission_id=$1`, [real.id])).toBeGreaterThan(0);
  });

  it('buildApp runs the backfill at startup for missions that have no instances', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000 });
    const A = await withAdmin(t.app);
    await seedDemo(t.app.db, t.app.cfg.tenantId, A.adminId);
    const had = await count('select count(*)::int n from agent_instances');
    expect(had).toBeGreaterThan(0);
    await t.pool.query('alter table mission_delegations disable trigger user');
    await t.pool.query('delete from agent_instances');
    await t.pool.query('alter table mission_delegations enable trigger user');
    expect(await count('select count(*)::int n from agent_instances')).toBe(0);
    const app2 = await buildApp({ databaseUrl: TEST_DB(), schema: t.schema, logger: false, staffingStepMs: 60_000 });
    try { expect(await count('select count(*)::int n from agent_instances')).toBe(had); } finally { await app2.close(); }
  });

  async function runBackfill() {
    const c = await t.pool.connect();
    try { await c.query('begin'); const r = await backfillMissionControl(c, t.app.cfg.tenantId); await c.query('commit'); return r; } finally { c.release(); }
  }
  const realMission = async (A: Awaited<ReturnType<typeof withAdmin>>, pres: Record<string, unknown>) => {
    const m = (await A.admin.req('POST', '/missions', { text: 'Research competitor pricing.', files: [], shared: false }, key())).body.mission;
    await t.pool.query(`update missions set presentation = presentation || $2::jsonb where id=$1`, [m.id, JSON.stringify(pres)]);
    await t.pool.query('alter table mission_delegations disable trigger user');
    await t.pool.query('delete from agent_instances where mission_id=$1', [m.id]);
    await t.pool.query('alter table mission_delegations enable trigger user');
    return m.id as string;
  };

  it('a real mission with a Stage 5 staffed presentation gets its chain: gm -> executor -> others, not simulated', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000 });
    const A = await withAdmin(t.app);
    const id = await realMission(A, { agentIds: ['gm', 'researcher-01', 'analyst-01', 'writer-01'], executorId: 'researcher-01' });
    const r = await runBackfill();
    expect(r.skipped).toBe(0);
    const inst = await rows('select agent_id, manager_instance_id, simulated from agent_instances where mission_id=$1 order by seq', [id]);
    expect(inst.map((i) => i.agent_id)).toEqual(['gm', 'researcher-01', 'analyst-01', 'writer-01']);
    expect(inst.map((i) => i.manager_instance_id)).toEqual([null, `${id}:gm`, `${id}:researcher-01`, `${id}:researcher-01`]);
    expect(inst.every((i) => i.simulated === false)).toBe(true);
    const d = await rows(`select from_instance f, to_instance t from mission_delegations where mission_id=$1 order by id`, [id]);
    expect(d).toEqual([{ f: `${id}:gm`, t: `${id}:researcher-01` }, { f: `${id}:researcher-01`, t: `${id}:analyst-01` }, { f: `${id}:researcher-01`, t: `${id}:writer-01` }]);
    const dto = (await A.admin.req('GET', `/missions/${id}`)).body.mission;
    expect(dto.agentIds).toEqual(['gm', 'researcher-01', 'analyst-01', 'writer-01']);
    expect(dto.executorId).toBe('researcher-01');
  });

  it('one bad mission is skipped and logged; the others are backfilled and the transaction survives', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000 });
    const A = await withAdmin(t.app);
    const bad = await realMission(A, { agentIds: 123 });
    const unknown = await realMission(A, { agentIds: ['gm', 'ghost-99', 'coder-01'], executorId: 'ghost-99' });
    const good = await realMission(A, { agentIds: ['gm', 'coder-01'], executorId: 'coder-01' });
    const logged: object[] = [];
    const c = await t.pool.connect();
    let r;
    try { await c.query('begin'); r = await backfillMissionControl(c, t.app.cfg.tenantId, { info: () => {}, error: (o) => logged.push(o) }); await c.query('commit'); } finally { c.release(); }
    expect(r.skipped).toBe(1);
    expect(logged.length).toBe(1);
    expect(await count('select count(*)::int n from agent_instances where mission_id=$1', [bad])).toBe(0);
    expect(await count('select count(*)::int n from agent_instances where mission_id=$1', [good])).toBe(2);
    // unknown agent ids are skipped; the rest hang under the GM instead of a missing manager
    const u = await rows('select agent_id, manager_instance_id from agent_instances where mission_id=$1 order by seq', [unknown]);
    expect(u).toEqual([{ agent_id: 'gm', manager_instance_id: null }, { agent_id: 'coder-01', manager_instance_id: `${unknown}:gm` }]);
  });
});

describe('append-only cascade guard', () => {
  it('a delete cascading from tasks or missions raises unless the purge flag is set; clearDemo sets it', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000 });
    const A = await withAdmin(t.app);
    await seedDemo(t.app.db, t.app.cfg.tenantId, A.adminId);
    const demoId = MISSIONS[0].id;
    await t.pool.query(`insert into task_attempts(task_id, attempt_no) select id, 1 from tasks where mission_id=$1 limit 1`, [demoId]);
    await expect(t.pool.query(`delete from tasks where mission_id=$1`, [demoId])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from missions where id=$1`, [demoId])).rejects.toThrow(/append-only/);
    expect(await count('select count(*)::int n from task_attempts')).toBe(1);
    await clearDemo(t.app.db, t.app.cfg.tenantId);
    expect(await count('select count(*)::int n from task_attempts')).toBe(0);
    expect(await count('select count(*)::int n from mission_delegations')).toBe(0);
  });
});

describe('migration 0012', () => {
  it('turns "working" instances of real missions into idle and leaves demo (simulated) ones alone', async () => {
    t = await makeTestApp({ staffingStepMs: 30 });
    const A = await withAdmin(t.app);
    const m = await staffed(A);
    await t.pool.query(`update agent_instances set state='working', task_label='Coordinating mission plan', progress=5 where mission_id=$1`, [m]);
    await t.pool.query(`update agent_instances set simulated=true where id=$1`, [`${m}:gm`]);
    const { readFileSync } = await import('node:fs');
    await t.pool.query(readFileSync(new URL('../migrations/0012_idle_real_instances.up.sql', import.meta.url), 'utf8'));
    const r = await rows(`select id, state, task_label from agent_instances where mission_id=$1`, [m]);
    expect(r.find((x) => x.id === `${m}:gm`)!.state).toBe('working');
    expect(r.filter((x) => x.id !== `${m}:gm`).every((x) => x.state === 'idle' && x.task_label === 'Staffed, waits for execution')).toBe(true);
  });
});
