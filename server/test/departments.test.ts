import { describe, it, expect } from 'vitest';
import { departmentFacts, type DeptRows } from '../src/company/departments.ts';
import { windowOf } from '../src/company/scorecard.ts';

// Improvement cycle 6: the pure department-facts function (membership, head, staffed counts, open-task buckets, outcome
// counts, window boundaries, last org change). The route only loads rows; every rule lives here.
const NOW = new Date('2026-11-21T12:00:00Z');
const H = 3_600_000, D = 24 * H;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const W30 = { ...windowOf('30d', NOW), includeDemo: false };

const agents: DeptRows['agents'] = [
  { id: 'gm', dept: 'Executive', active: true },
  { id: 'eng-a', dept: 'Engineering', active: true },
  { id: 'eng-b', dept: 'Engineering', active: true },
  { id: 'eng-c', dept: 'Engineering', active: true },
  { id: 'ops-a', dept: 'Operations', active: true },
  { id: 'ops-old', dept: 'Operations', active: false },
  { id: 'qa-a', dept: 'QA', active: true },
];
// eng-a and eng-b both report to the GM; eng-c reports to eng-b, so eng-b heads more of Engineering
const edges: DeptRows['edges'] = [
  { supervisorId: 'gm', subordinateId: 'eng-a' }, { supervisorId: 'gm', subordinateId: 'eng-b' }, { supervisorId: 'eng-b', subordinateId: 'eng-c' },
  { supervisorId: 'gm', subordinateId: 'ops-a' }, { supervisorId: 'eng-a', subordinateId: 'qa-a' },
];
const empty = (): DeptRows => ({ agents, edges, instances: [], tasks: [], orgChanges: [] });
const dept = (rows: DeptRows, name: string, opt = W30) => departmentFacts(rows, opt).departments.find((d) => d.name === name)!;

describe('membership and head', () => {
  it('one department per catalog department of active agents, sorted by name; retired agents are not members', () => {
    const out = departmentFacts(empty(), W30);
    expect(out.departments.map((d) => d.name)).toEqual(['Engineering', 'Executive', 'Operations', 'QA']);
    expect(dept(empty(), 'Engineering').memberIds).toEqual(['eng-a', 'eng-b', 'eng-c']);
    expect(dept(empty(), 'Operations').memberIds).toEqual(['ops-a']);
    expect(out).toMatchObject({ window: '30d', includeDemo: false, from: W30.from.toISOString(), to: W30.to.toISOString() });
  });
  it('a department with only retired agents is not listed', () => {
    const rows = { ...empty(), agents: [...agents, { id: 'gone', dept: 'Legal', active: false }] };
    expect(departmentFacts(rows, W30).departments.map((d) => d.name)).not.toContain('Legal');
  });
  it('the head is the member reporting to the GM; with several, the one with the most department members under it, then by id', () => {
    const e = dept(empty(), 'Engineering');
    expect(e.headAgentId).toBe('eng-b');
    expect(e.gmReports).toEqual(['eng-b', 'eng-a']);
    expect(e.evidence).toMatch(/2 members report to the GM/);
    // equal subtrees: lowest id
    const flat = { ...empty(), edges: edges.filter((x) => x.subordinateId !== 'eng-c').concat({ supervisorId: 'gm', subordinateId: 'eng-c' }) };
    expect(dept(flat, 'Engineering')).toMatchObject({ headAgentId: 'eng-a', gmReports: ['eng-a', 'eng-b', 'eng-c'] });
  });
  it('a reporting line into another department does not count toward the subtree (qa-a under eng-a)', () => {
    // eng-a manages qa-a (QA), eng-b manages eng-c (Engineering): eng-b still wins
    expect(dept(empty(), 'Engineering').headAgentId).toBe('eng-b');
  });
  it('no member reporting to the GM: no head (null, empty list)', () => {
    expect(dept(empty(), 'QA')).toMatchObject({ headAgentId: null, gmReports: [] });
    expect(dept(empty(), 'QA').evidence).toMatch(/no member reports to the GM/);
  });
  it("the GM's own department is headed by the GM", () => {
    expect(dept(empty(), 'Executive')).toMatchObject({ headAgentId: 'gm', gmReports: [] });
  });
  it('a retired member reporting to the GM is not a head', () => {
    const rows = { ...empty(), edges: [...edges, { supervisorId: 'gm', subordinateId: 'ops-old' }] };
    expect(dept(rows, 'Operations')).toMatchObject({ headAgentId: 'ops-a', gmReports: ['ops-a'] });
  });
});

describe('staffed agents and active missions', () => {
  const inst = (agentId: string, missionId: string, missionStatus = 'running', o: { ended?: boolean; simulated?: boolean } = {}) =>
    ({ agentId, missionId, missionStatus, ended: o.ended ?? false, simulated: o.simulated ?? false });
  it('counts distinct staffed members and distinct active missions', () => {
    const rows = { ...empty(), instances: [inst('eng-a', 'M-1'), inst('eng-a', 'M-2', 'planning'), inst('eng-b', 'M-2', 'verifying'), inst('eng-c', 'M-3', 'waiting_approval'), inst('ops-a', 'M-1')] };
    expect(dept(rows, 'Engineering')).toMatchObject({ staffedAgents: 3, activeMissions: 3 });
    expect(dept(rows, 'Operations')).toMatchObject({ staffedAgents: 1, activeMissions: 1 });
  });
  it('not counted: ended instances, missions that are not active, simulated instances (unless includeDemo)', () => {
    const rows = { ...empty(), instances: [
      inst('eng-a', 'M-1', 'running', { ended: true }), inst('eng-a', 'M-2', 'completed'), inst('eng-a', 'M-3', 'paused'), inst('eng-a', 'M-4', 'queued'),
      inst('eng-a', 'M-5', 'draft'), inst('eng-a', 'M-6', 'failed'), inst('eng-a', 'M-7', 'canceled'), inst('eng-a', 'M-8', 'archived'), inst('eng-a', 'M-9', 'retry_queued'),
      inst('eng-b', 'M-10', 'running', { simulated: true }),
    ] };
    expect(dept(rows, 'Engineering')).toMatchObject({ staffedAgents: 0, activeMissions: 0 });
    expect(dept(rows, 'Engineering', { ...W30, includeDemo: true })).toMatchObject({ staffedAgents: 1, activeMissions: 1 });
  });
  it('an instance of an agent outside the catalog is ignored', () => {
    expect(dept({ ...empty(), instances: [inst('ghost', 'M-1')] }, 'Engineering')).toMatchObject({ staffedAgents: 0 });
  });
});

describe('open tasks', () => {
  const task = (id: string, owner: string | null, status: string, o: Partial<DeptRows['tasks'][number]> = {}) =>
    ({ id, owner, status, missionStatus: 'running', attempts: 1, finishedAt: null, simulated: false, ...o });
  it('buckets: running = running + verifying, waiting = waiting_agent + waiting_user, failed = failed; queued and finished states are not open', () => {
    const rows = { ...empty(), tasks: [
      task('t1', 'eng-a', 'running'), task('t2', 'eng-b', 'verifying'), task('t3', 'eng-a', 'waiting_agent'), task('t4', 'eng-c', 'waiting_user'),
      task('t5', 'eng-a', 'failed', { finishedAt: ago(H) }), task('t6', 'eng-a', 'created'), task('t7', 'eng-a', 'ready'), task('t8', 'eng-a', 'retry_ready'),
      task('t9', 'eng-a', 'passed', { finishedAt: ago(H) }), task('t10', 'eng-a', 'canceled'), task('t11', null, 'running'), task('t12', 'ops-a', 'running'),
    ] };
    expect(dept(rows, 'Engineering').openTasks).toEqual({ running: 2, waiting: 2, failed: 1 });
    expect(dept(rows, 'Operations').openTasks).toEqual({ running: 1, waiting: 0, failed: 0 });
  });
  it('a task of a completed, canceled or archived mission is not open; a failed mission still counts', () => {
    const rows = { ...empty(), tasks: [
      task('t1', 'eng-a', 'running', { missionStatus: 'completed' }), task('t2', 'eng-a', 'failed', { missionStatus: 'canceled', finishedAt: ago(H) }),
      task('t3', 'eng-a', 'waiting_user', { missionStatus: 'archived' }), task('t4', 'eng-a', 'failed', { missionStatus: 'failed', finishedAt: ago(H) }),
    ] };
    expect(dept(rows, 'Engineering').openTasks).toEqual({ running: 0, waiting: 0, failed: 1 });
  });
  it('simulated tasks are left out unless includeDemo', () => {
    const rows = { ...empty(), tasks: [task('t1', 'eng-a', 'running', { simulated: true })] };
    expect(dept(rows, 'Engineering').openTasks.running).toBe(0);
    expect(dept(rows, 'Engineering', { ...W30, includeDemo: true }).openTasks.running).toBe(1);
  });
});

describe('outcomes and window boundaries', () => {
  const fin = (id: string, owner: string, status: 'passed' | 'failed' | 'canceled', at: Date, o: Partial<DeptRows['tasks'][number]> = {}) =>
    ({ id, owner, status, missionStatus: 'running', attempts: 1, finishedAt: at, simulated: false, ...o });
  it('passed, failed and retried (a subset: more than one attempt) with n = passed + failed; canceled is not an outcome', () => {
    const rows = { ...empty(), tasks: [
      fin('a', 'eng-a', 'passed', ago(H)), fin('b', 'eng-b', 'passed', ago(2 * H), { attempts: 2 }), fin('c', 'eng-c', 'failed', ago(3 * H), { attempts: 3 }),
      fin('d', 'eng-a', 'canceled', ago(H)), fin('e', 'ops-a', 'passed', ago(H)),
    ] };
    expect(dept(rows, 'Engineering').outcomes).toEqual({ passed: 2, failed: 1, retried: 2, n: 3 });
    expect(dept(rows, 'Operations').outcomes).toEqual({ passed: 1, failed: 0, retried: 0, n: 1 });
  });
  it('outcomes count tasks of finished missions too (the window decides, not the mission state)', () => {
    const rows = { ...empty(), tasks: [fin('a', 'eng-a', 'passed', ago(H), { missionStatus: 'completed' })] };
    expect(dept(rows, 'Engineering').outcomes.n).toBe(1);
  });
  it('the window is inclusive at both ends; one millisecond outside is out', () => {
    const rows = { ...empty(), tasks: [
      fin('edge-from', 'eng-a', 'passed', W30.from), fin('edge-to', 'eng-a', 'failed', W30.to),
      fin('before', 'eng-a', 'passed', new Date(W30.from.getTime() - 1)), fin('after', 'eng-a', 'passed', new Date(W30.to.getTime() + 1)),
    ] };
    expect(dept(rows, 'Engineering').outcomes).toEqual({ passed: 1, failed: 1, retried: 0, n: 2 });
  });
  it('7d and 90d windows', () => {
    const rows = { ...empty(), tasks: [fin('a', 'eng-a', 'passed', ago(3 * D)), fin('b', 'eng-a', 'passed', ago(20 * D)), fin('c', 'eng-a', 'passed', ago(60 * D))] };
    expect(dept(rows, 'Engineering', { ...windowOf('7d', NOW), includeDemo: false }).outcomes.n).toBe(1);
    expect(dept(rows, 'Engineering').outcomes.n).toBe(2);
    expect(dept(rows, 'Engineering', { ...windowOf('90d', NOW), includeDemo: false }).outcomes.n).toBe(3);
  });
  it('simulated tasks are left out of outcomes unless includeDemo', () => {
    const rows = { ...empty(), tasks: [fin('a', 'eng-a', 'passed', ago(H), { simulated: true }), fin('b', 'eng-a', 'failed', ago(H))] };
    expect(dept(rows, 'Engineering').outcomes).toEqual({ passed: 0, failed: 1, retried: 0, n: 1 });
    expect(dept(rows, 'Engineering', { ...W30, includeDemo: true }).outcomes).toEqual({ passed: 1, failed: 1, retried: 0, n: 2 });
  });
  it('the evidence says "too few to rate" below 5 and names the window; never a percentage', () => {
    const few = dept({ ...empty(), tasks: [fin('a', 'eng-a', 'passed', ago(H))] }, 'Engineering');
    expect(few.evidence).toMatch(/1 finished task in 30 days \(too few to rate, 5 needed\)/);
    const five = dept({ ...empty(), tasks: ['a', 'b', 'c', 'd', 'e'].map((id) => fin(id, 'eng-a', 'passed', ago(H))) }, 'Engineering');
    expect(five.evidence).toMatch(/5 finished tasks in 30 days/);
    expect(five.evidence).not.toMatch(/too few|%/);
  });
});

describe('last org change', () => {
  it('the newest revision that changed a line whose subordinate is a member; null when none', () => {
    const rows = { ...empty(), orgChanges: [
      { seq: 1, at: ago(10 * D), subordinateId: 'eng-a' }, { seq: 1, at: ago(10 * D), subordinateId: 'ops-a' },
      { seq: 3, at: ago(D), subordinateId: 'eng-c' }, { seq: 2, at: ago(2 * D), subordinateId: 'ops-a' },
    ] };
    expect(dept(rows, 'Engineering').lastOrgChange).toEqual({ revision: 3, at: ago(D).toISOString() });
    expect(dept(rows, 'Operations').lastOrgChange).toEqual({ revision: 2, at: ago(2 * D).toISOString() });
    expect(dept(rows, 'QA').lastOrgChange).toBeNull();
  });
  it('a retired member’s line still belongs to its department', () => {
    const rows = { ...empty(), orgChanges: [{ seq: 4, at: ago(H), subordinateId: 'ops-old' }] };
    expect(dept(rows, 'Operations').lastOrgChange?.revision).toBe(4);
  });
});

describe('evidence', () => {
  it('names the counts and the source; DEMO included is said', () => {
    const e = dept(empty(), 'Operations').evidence;
    expect(e).toMatch(/1 member/);
    expect(e).toMatch(/0 staffed on 0 active missions/);
    expect(e).toMatch(/from missions you can see/);
    expect(e).not.toMatch(/DEMO/);
    expect(dept(empty(), 'Operations', { ...W30, includeDemo: true }).evidence).toMatch(/DEMO included/);
  });
});
