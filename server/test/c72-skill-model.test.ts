import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { standardise, compareSkill, rawRate, TASK_CLASS_IDS, SKILL_MIN_N, SKILL_METHOD, type LevelCount } from '../../shared/contracts/src/index.ts';
import { skillCells } from '../src/agents/skills.ts';
import { briefSha } from '../src/delegation/brief.ts';

/**
 * Improvement cycle 72, item 2: the read model. Per agent, a vector over task classes. Each cell is a success rate adjusted for difficulty
 * (direct standardisation to a fixed mix) with a 95% interval; null below 5 outcomes. Fixtures only: no agent executes, so the real cells
 * stay null until tasks run.
 */
let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'c72m-' + Date.now() + '-' + n++ });
const L = (...a: [number, number, number][]): LevelCount[] => a.map(([d, nn, x]) => ({ d, n: nn, x }));

describe('pure estimator', () => {
  it('a single level is a plain Wilson interval, and the adjusted rate of one level equals its raw rate', () => {
    const s = standardise(L([2, 20, 15]))!, r = rawRate(L([2, 20, 15]))!;
    expect(s.value).toBeCloseTo(0.75, 10);
    expect(s.nEff).toBeCloseTo(20, 6);
    expect(s.lo).toBeCloseTo(r.lo, 6); expect(s.hi).toBeCloseTo(r.hi, 6);
    expect(s.lo).toBeGreaterThan(0.5); expect(s.hi).toBeLessThan(0.9); // Wilson(15/20) = [0.531, 0.888]
  });
  it('re-weights to the fixed mix: easy-only 18/20 and hard-only 6/20 are different raw rates, and each is reported on its own levels', () => {
    const easy = L([1, 10, 9], [2, 10, 9]), hard = L([4, 10, 3], [5, 10, 3]);
    expect(rawRate(easy)!.value).toBeCloseTo(0.9, 10); expect(rawRate(hard)!.value).toBeCloseTo(0.3, 10);
    expect(standardise(easy)!.levels).toEqual([1, 2]); expect(standardise(hard)!.levels).toEqual([4, 5]);
    // a mixed agent: levels weighted equally whatever the counts (90 outcomes at level 1, 10 at level 5)
    const mixed = L([1, 90, 81], [5, 10, 3]);
    expect(rawRate(mixed)!.value).toBeCloseTo(0.84, 10);
    expect(standardise(mixed)!.value).toBeCloseTo((0.9 + 0.3) / 2, 10);
  });
  it('compares only on shared levels, and says only distinguishable or indistinguishable', () => {
    const a = L([1, 30, 27], [2, 30, 27]), b = L([4, 30, 9], [5, 30, 9]);
    const none = compareSkill(a, b);
    expect(none.verdict).toBe('indistinguishable'); expect(none.sharedLevels).toEqual([]); expect(none.reason).toMatch(/no difficulty level in common/);
    const a2 = L([2, 40, 36], [3, 40, 30]), b2 = L([2, 40, 12], [3, 40, 10]);
    const far = compareSkill(a2, b2);
    expect(far.verdict).toBe('distinguishable'); expect(far.sharedLevels).toEqual([2, 3]);
    expect(compareSkill(a2, a2).verdict).toBe('indistinguishable');
    expect(compareSkill(L([3, 4, 4]), L([3, 4, 0])).verdict).toBe('indistinguishable'); // under 5 tasks at the level: left out
    expect(Object.keys(far).sort()).toEqual(['reason', 'sharedLevels', 'verdict']); // no direction, no score
  });
  it('cells below the floor are null and every class is present in the fixed order', () => {
    const cells = skillCells(new Map([['coding', L([2, 4, 4])], ['research', L([2, 5, 5])]]));
    expect(cells.map((c) => c.classId)).toEqual(TASK_CLASS_IDS);
    const coding = cells.find((c) => c.classId === 'coding')!;
    expect(coding.state).toBe('not_enough_evidence'); expect(coding.adjusted).toBeNull(); expect(coding.raw).toBeNull(); expect(coding.n).toBe(4);
    expect(coding.evidence).toMatch(/not enough evidence \(4 of 5\)/);
    const research = cells.find((c) => c.classId === 'research')!;
    expect(research.state).toBe('ok'); expect(research.adjusted).not.toBeNull(); expect(research.n).toBe(SKILL_MIN_N);
    expect(cells.find((c) => c.classId === 'writing')!.n).toBe(0);
  });
});

async function setup() {
  t = await makeTestApp({ staffingStepMs: 30 });
  const A = await withAdmin(t.app);
  const mk = async (shared: boolean, who = A.admin) => {
    const m = (await who.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared }, key())).body.mission.id as string;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
    return m;
  };
  const m = await mk(false);
  const inst = (await t.pool.query(`select id, agent_id, tenant_id from agent_instances where mission_id=$1 order by seq`, [m])).rows as { id: string; agent_id: string; tenant_id: string }[];
  let k = 0;
  /** a finished task owned by `agent`, with a brief to that agent naming class and difficulty (either may be left out) */
  const outcome = async (mission: string, agent: { id: string; agent_id: string; tenant_id: string }, status: 'passed' | 'failed', cls?: string, difficulty?: number, o: { simulated?: boolean; briefTo?: typeof agent } = {}) => {
    const id = `T-c72-${++k}`;
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, simulated) values ($1,$2,$3,'fixture',$4,$5,$6)`, [id, agent.tenant_id, mission, status, agent.agent_id, o.simulated ?? false]);
    const to = o.briefTo ?? agent;
    const brief = { goal: 'Do the fixture task', inputs: [], acceptance: ['Done'], capabilities: [{ kind: 'read' }], escalation: 'Ask', ...(cls ? { taskClass: cls } : {}), ...(difficulty ? { difficulty } : {}) };
    await t.pool.query(`insert into delegation_briefs(tenant_id, mission_id, task_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by, created_at) values ($1,$2,$3,'c72','user',$4,$5,$6,$7,1,'c72', now() - interval '1 hour')`, [agent.tenant_id, mission, id, to.id, to.agent_id, JSON.stringify(brief), briefSha(brief)]);
    return id;
  };
  return { A, m, inst, mk, outcome };
}
const skills = async (b: { req: Function }, id: string, q = '') => (await b.req('GET', `/agents/${id}/skills${q}`)) as { status: number; body: any };

describe('GET /agents/:id/skills', () => {
  it('needs a session, 404s an unknown agent, and has no data until tasks finish: every cell is null with n shown', async () => {
    const { A, inst } = await setup();
    const { Browser } = await import('./helpers.ts');
    expect((await new Browser(t.app).req('GET', `/agents/${inst[0].agent_id}/skills`)).status).toBe(401);
    expect((await skills(A.admin, 'no-such-agent')).status).toBe(404);
    const r = await skills(A.admin, inst[0].agent_id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.skills.classes.map((c: any) => c.classId)).toEqual(TASK_CLASS_IDS);
    for (const c of r.body.skills.classes) { expect(c.adjusted).toBeNull(); expect(c.raw).toBeNull(); expect(c.n).toBe(0); expect(c.state).toBe('not_enough_evidence'); }
    expect(r.body.skills.method).toBe(SKILL_METHOD);
    expect(r.body.skills.pairRatings.built).toBe(false);
    expect(r.body.skills.pairRatings.why).toMatch(/no record|Nothing recorded/i);
    expect(r.body.skills.dependsOn.gameable).toBe(true);
    expect(r.body.skills.dependsOn.text).toMatch(/difficulty/);
  });

  it('counts finished tasks with a class and a difficulty; 4 outcomes are null, the fifth makes the cell', async () => {
    const { A, m, inst, outcome } = await setup();
    const a = inst[1];
    for (let i = 0; i < 4; i++) await outcome(m, a, i % 2 ? 'passed' : 'failed', 'coding', 2);
    let c = (await skills(A.admin, a.agent_id)).body.skills.classes.find((x: any) => x.classId === 'coding');
    expect(c.n).toBe(4); expect(c.adjusted).toBeNull(); expect(c.evidence).toMatch(/not enough evidence \(4 of 5\)/);
    await outcome(m, a, 'passed', 'coding', 2);
    c = (await skills(A.admin, a.agent_id)).body.skills.classes.find((x: any) => x.classId === 'coding');
    expect(c.n).toBe(5); expect(c.successes).toBe(3); expect(c.state).toBe('ok');
    expect(c.adjusted.value).toBe(60); expect(c.raw.value).toBe(60);
    expect(c.adjusted.lo).toBeLessThan(60); expect(c.adjusted.hi).toBeGreaterThan(60);
    expect(c.levels).toEqual([expect.objectContaining({ difficulty: 2, n: 5, successes: 3 })]);
  });

  it('leaves out open tasks, simulated tasks (unless asked), unrated briefs (counted apart) and tasks whose brief went to someone else', async () => {
    const { A, m, inst, outcome } = await setup();
    const a = inst[1], b = inst[2];
    for (let i = 0; i < 5; i++) await outcome(m, a, 'passed', 'research', 3);
    await outcome(m, a, 'passed', 'research', 3, { simulated: true });          // a DEMO task
    await outcome(m, a, 'passed', 'research');                                   // class but no difficulty
    await outcome(m, a, 'passed', undefined, 3);                                 // difficulty but no class
    await outcome(m, a, 'failed', 'research', 3, { briefTo: b });                // the brief names another agent
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ('T-c72-open',$1,$2,'open','running',$3)`, [a.tenant_id, m, a.agent_id]);
    const r = (await skills(A.admin, a.agent_id)).body.skills;
    const c = r.classes.find((x: any) => x.classId === 'research');
    expect(c.n).toBe(5); expect(c.successes).toBe(5);
    expect(r.unrated).toBe(3); // class only, difficulty only, and the task whose brief went to another agent (no label for its owner): every finished task outside a cell
    const withSim = (await skills(A.admin, a.agent_id, '?includeSimulated=1')).body.skills;
    expect(withSim.classes.find((x: any) => x.classId === 'research').n).toBe(6);
    expect(withSim.includesSimulated).toBe(true);
  });

  it('shows the same cell for the same data whoever asks, but a member never counts tasks of a private mission', async () => {
    const { A, m, inst, outcome } = await setup();
    const mina = (await A.member('Mina')).b;
    for (let i = 0; i < 6; i++) await outcome(m, inst[1], 'passed', 'data', 4);
    expect((await skills(A.admin, inst[1].agent_id)).body.skills.classes.find((x: any) => x.classId === 'data').n).toBe(6);
    expect((await skills(mina, inst[1].agent_id)).body.skills.classes.find((x: any) => x.classId === 'data').n).toBe(0);
  });
});

describe('GET /agents/:id/skills/compare', () => {
  it('says only distinguishable or indistinguishable per class, on shared levels, and refuses a comparison with itself', async () => {
    const { A, m, inst, outcome } = await setup();
    const a = inst[1], b = inst[2];
    expect(a.agent_id).not.toBe(b.agent_id);
    for (let i = 0; i < 30; i++) { await outcome(m, a, i < 27 ? 'passed' : 'failed', 'coding', 2); await outcome(m, b, i < 9 ? 'passed' : 'failed', 'coding', 2); }
    for (let i = 0; i < 30; i++) { await outcome(m, a, i < 27 ? 'passed' : 'failed', 'research', 1); await outcome(m, b, i < 9 ? 'passed' : 'failed', 'research', 5); }
    const r = await A.admin.req('GET', `/agents/${a.agent_id}/skills/compare?with=${b.agent_id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rows = r.body.compare.classes as { classId: string; verdict: string; reason: string }[];
    expect(rows.map((x) => x.classId)).toEqual(['research', 'coding']); // fixed class order
    expect(rows.find((x) => x.classId === 'coding')!.verdict).toBe('distinguishable');
    const res = rows.find((x) => x.classId === 'research')!;
    expect(res.verdict).toBe('indistinguishable'); expect(res.reason).toMatch(/no difficulty level in common/);
    for (const x of rows) expect(Object.keys(x).sort()).toEqual(['classId', 'label', 'reason', 'sharedLevels', 'verdict']);
    expect((await A.admin.req('GET', `/agents/${a.agent_id}/skills/compare?with=${a.agent_id}`)).status).toBe(400);
    expect((await A.admin.req('GET', `/agents/${a.agent_id}/skills/compare?with=nobody`)).status).toBe(404);
  });
});

describe('how a brief reaches a task', () => {
  const base = (over: Record<string, unknown> = {}) => ({ goal: 'Do the fixture task', inputs: [], acceptance: ['Done'], capabilities: [{ kind: 'read' }], escalation: 'Ask', ...over });
  it('POST /tasks/:id/reassign with a brief stores the class and the difficulty, and the finished task then counts in that cell', async () => {
    const { A, m, inst } = await setup();
    const tn = inst[1].tenant_id;
    for (let i = 0; i < 5; i++) {
      await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,$2,$3,'A task','ready',$4,$5)`, [`T-c72re-${i}`, tn, m, inst[1].agent_id, inst[1].id]);
      const ok = await A.admin.req('POST', `/tasks/T-c72re-${i}/reassign`, { toInstanceId: inst[2].id, reason: 'x', brief: base({ taskClass: 'planning', difficulty: 4 }) }, key());
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    }
    const stored = (await t.pool.query(`select brief->>'taskClass' c, brief->>'difficulty' d from delegation_briefs where mission_id=$1 and task_id like 'T-c72re-%'`, [m])).rows;
    expect(stored).toHaveLength(5); expect(stored.every((r) => r.c === 'planning' && r.d === '4')).toBe(true);
    await t.pool.query(`update tasks set status='passed' where id like 'T-c72re-%'`);
    await t.pool.query(`insert into events(tenant_id, type, mission_id, subject_kind, subject_id, payload) select tenant_id, 'task.stateChanged', mission_id, 'task', id, jsonb_build_object('taskId', id, 'from', 'running', 'to', 'passed') from tasks where id like 'T-c72re-%'`);
    const c = (await skills(A.admin, inst[2].agent_id)).body.skills.classes.find((x: any) => x.classId === 'planning');
    expect(c.n).toBe(5); expect(c.levels).toEqual([expect.objectContaining({ difficulty: 4, n: 5, successes: 5 })]);
  });

  it('a brief that supersedes the first one after the task finished does not change its label: the label stated when the task was handed over counts', async () => {
    const { A, m, inst, outcome } = await setup();
    for (let i = 0; i < 5; i++) await outcome(m, inst[1], 'passed', 'coding', 5);
    const first = (await t.pool.query(`select id, task_id from delegation_briefs where mission_id=$1 and task_id like 'T-c72-%' order by seq limit 1`, [m])).rows[0];
    const sup = await A.admin.req('POST', `/missions/${m}/delegation-briefs`, { toInstanceId: inst[1].id, supersedes: first.id, taskId: first.task_id, brief: base({ taskClass: 'coding', difficulty: 1 }) }, key());
    expect(sup.status, JSON.stringify(sup.body)).toBe(201);
    const c = (await skills(A.admin, inst[1].agent_id)).body.skills.classes.find((x: any) => x.classId === 'coding');
    expect(c.levels.map((l: any) => l.difficulty)).toEqual([5]); // not moved to level 1 after the outcome was known
    expect(c.n).toBe(5);
  });
});

describe('F1 (review): a label counts only if its brief existed before the task first finished, and an outcome belongs to the owner at that time', () => {
  const base = (over: Record<string, unknown> = {}) => ({ goal: 'Do the fixture task', inputs: [], acceptance: ['Done'], capabilities: [{ kind: 'read' }], escalation: 'Ask', ...over });
  const finishEvent = (tn: string, m: string, id: string, to: string, ago: string) => t.pool.query(`insert into events(tenant_id, type, mission_id, subject_kind, subject_id, payload, occurred_at) values ($1,'task.stateChanged',$2,'task',$3,$4,now() - $5::interval)`, [tn, m, id, JSON.stringify({ taskId: id, from: 'running', to }), ago]);

  it('a failure stays with the agent that owned the task when it failed; a reassign afterwards (with a brief labelling it very hard) moves nothing', async () => {
    const { A, m, inst } = await setup();
    const tn = inst[1].tenant_id;
    for (let i = 0; i < 5; i++) {
      const id = `T-c72f1-${i}`;
      await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, created_at) values ($1,$2,$3,'A task','running',$4,$5, now() - interval '3 hours')`, [id, tn, m, inst[1].agent_id, inst[1].id]);
      const b = base({ taskClass: 'coding', difficulty: 2 });
      await t.pool.query(`insert into delegation_briefs(tenant_id, mission_id, task_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by, created_at) values ($1,$2,$3,'c72','user',$4,$5,$6,$7,1,'c72', now() - interval '2 hours')`, [tn, m, id, inst[1].id, inst[1].agent_id, JSON.stringify(b), briefSha(b)]);
      await t.pool.query(`update tasks set status='failed' where id=$1`, [id]);
      await finishEvent(tn, m, id, 'failed', '1 hour');
      const r = await A.admin.req('POST', `/tasks/${id}/reassign`, { toInstanceId: inst[2].id, reason: 'x', brief: base({ taskClass: 'coding', difficulty: 5 }) }, key());
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const a = (await skills(A.admin, inst[1].agent_id)).body.skills.classes.find((x: any) => x.classId === 'coding');
    const b = (await skills(A.admin, inst[2].agent_id)).body.skills.classes.find((x: any) => x.classId === 'coding');
    expect(a.levels).toEqual([expect.objectContaining({ difficulty: 2, n: 5, successes: 0 })]); // the failure is A's, at the level stated before it
    expect(b.n).toBe(0); // B inherits nothing, and no level 5 appears
  });

  it('a first-ever brief posted to the owner of an already finished task does not label it', async () => {
    const { A, m, inst } = await setup();
    const tn = inst[1].tenant_id;
    for (let i = 0; i < 5; i++) {
      const id = `T-c72f1b-${i}`;
      await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, created_at) values ($1,$2,$3,'A task','passed',$4,$5, now() - interval '3 hours')`, [id, tn, m, inst[1].agent_id, inst[1].id]);
      await finishEvent(tn, m, id, 'passed', '1 hour');
      const r = await A.admin.req('POST', `/missions/${m}/delegation-briefs`, { toInstanceId: inst[1].id, taskId: id, brief: base({ taskClass: 'coding', difficulty: 1 }) }, key());
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const s = (await skills(A.admin, inst[1].agent_id)).body.skills;
    expect(s.classes.find((x: any) => x.classId === 'coding').n).toBe(0);
    expect(s.unrated).toBe(5); // counted apart, in no cell
  });
});

describe('N1 (re-review): the outcome is the status of the first finish; later attempts are not rated', () => {
  const base = (over: Record<string, unknown> = {}) => ({ goal: 'Do the fixture task', inputs: [], acceptance: ['Done'], capabilities: [{ kind: 'read' }], escalation: 'Ask', ...over });
  const ev = (tn: string, m: string, id: string, to: string, ago: string) => t.pool.query(`insert into events(tenant_id, type, mission_id, subject_kind, subject_id, payload, occurred_at) values ($1,'task.stateChanged',$2,'task',$3,$4,now() - $5::interval)`, [tn, m, id, JSON.stringify({ taskId: id, from: 'running', to }), ago]);
  const mk = async (m: string, tn: string, id: string, agent: { id: string; agent_id: string }) => {
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, created_at) values ($1,$2,$3,'A task','running',$4,$5, now() - interval '5 hours')`, [id, tn, m, agent.agent_id, agent.id]);
    const b = base({ taskClass: 'coding', difficulty: 3 });
    await t.pool.query(`insert into delegation_briefs(tenant_id, mission_id, task_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by, created_at) values ($1,$2,$3,'c72','user',$4,$5,$6,$7,1,'c72', now() - interval '4 hours')`, [tn, m, id, agent.id, agent.agent_id, JSON.stringify(b), briefSha(b)]);
    await t.pool.query(`update tasks set status='failed' where id=$1`, [id]);
    await ev(tn, m, id, 'failed', '3 hours');
  };
  it('fail, retry_ready, reassign, then the new owner passes it: A keeps the failure and B is credited with nothing', async () => {
    const { A, m, inst } = await setup();
    const tn = inst[1].tenant_id;
    for (let i = 0; i < 5; i++) {
      const id = `T-c72n1-${i}`;
      await mk(m, tn, id, inst[1]);
      const r = await A.admin.req('POST', `/tasks/${id}/reassign`, { toInstanceId: inst[2].id, reason: 'x', brief: base({ taskClass: 'coding', difficulty: 1 }) }, key());
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      await t.pool.query(`update tasks set status='passed' where id=$1`, [id]);
      await ev(tn, m, id, 'passed', '1 minute');
    }
    const a = (await skills(A.admin, inst[1].agent_id)).body.skills.classes.find((x: any) => x.classId === 'coding');
    const b = (await skills(A.admin, inst[2].agent_id)).body.skills.classes.find((x: any) => x.classId === 'coding');
    expect(a.levels).toEqual([expect.objectContaining({ difficulty: 3, n: 5, successes: 0 })]);
    expect(b.n).toBe(0);
  });
  it('fail, retry by the same owner, then pass: the first failure stays a failure and the later pass is not rated', async () => {
    const { A, m, inst } = await setup();
    const tn = inst[1].tenant_id;
    for (let i = 0; i < 5; i++) {
      const id = `T-c72n1r-${i}`;
      await mk(m, tn, id, inst[1]);
      await t.pool.query(`update tasks set status='passed' where id=$1`, [id]);
      await ev(tn, m, id, 'passed', '1 minute');
    }
    const a = (await skills(A.admin, inst[1].agent_id)).body.skills.classes.find((x: any) => x.classId === 'coding');
    expect(a.levels).toEqual([expect.objectContaining({ difficulty: 3, n: 5, successes: 0 })]);
    expect(a.n).toBe(5);
  });
});
