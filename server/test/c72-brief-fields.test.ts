import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { DelegationBriefIn, briefSha } from '../src/delegation/brief.ts';
import { INPUT_FIELDS, WRITE_SITES, writabilityOf, TASK_CLASSES, TASK_CLASS_IDS, SKILL_RATING_INPUTS, skillRatingDependsText } from '../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 72, item 1: an optional task class (fixed enum, plain-words labels) and an optional difficulty (1 to 5) on the
 * delegation brief. The delegator sets both, so both are gameable and are classified in c66's writability inventory.
 */
let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'c72-' + Date.now() + '-' + n++ });
const base = (over: Record<string, unknown> = {}) => ({ goal: 'Draft the landing page copy', inputs: [], acceptance: ['Copy fits the template'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner', ...over });

describe('pure rules', () => {
  it('accepts a task class from the fixed list and a difficulty from 1 to 5, both optional', () => {
    expect(DelegationBriefIn.safeParse(base()).success).toBe(true);
    for (const c of TASK_CLASS_IDS) expect(DelegationBriefIn.safeParse(base({ taskClass: c, difficulty: 3 })).success, c).toBe(true);
    for (const d of [1, 2, 3, 4, 5]) expect(DelegationBriefIn.safeParse(base({ difficulty: d })).success, String(d)).toBe(true);
  });
  it('rejects an unknown class and a difficulty that is not a whole number from 1 to 5', () => {
    expect(DelegationBriefIn.safeParse(base({ taskClass: 'wizardry' })).success).toBe(false);
    for (const d of [0, 6, 2.5, -1, '3', null]) expect(DelegationBriefIn.safeParse(base({ difficulty: d })).success, String(d)).toBe(false);
  });
  it('every class has a plain-words label, and the hash of a brief without the fields is unchanged', () => {
    for (const c of TASK_CLASS_IDS) expect(TASK_CLASSES[c].length, c).toBeGreaterThan(8);
    const plain = DelegationBriefIn.parse(base());
    expect('taskClass' in plain || 'difficulty' in plain).toBe(false);
    expect(briefSha(DelegationBriefIn.parse(base({ difficulty: 2 })))).not.toBe(briefSha(plain));
  });
});

describe('inventory', () => {
  it('both fields are inputs of the writability inventory, reachable by a delegating agent, and the rating declares them as inputs', () => {
    for (const f of ['delegation_briefs.task_class', 'delegation_briefs.difficulty'] as const) {
      expect(INPUT_FIELDS[f], f).toBeTruthy();
      expect(Object.values(WRITE_SITES).some((s) => (s.writes as readonly string[]).includes(f)), f).toBe(true);
      expect(writabilityOf([f]).agentWritable, f).toBe(true);
    }
    expect(SKILL_RATING_INPUTS).toEqual(expect.arrayContaining(['delegation_briefs.task_class', 'delegation_briefs.difficulty', 'tasks.status']));
    expect(skillRatingDependsText()).toMatch(/difficulty/i);
    expect(skillRatingDependsText()).toMatch(/set by the person or agent that delegates/);
  });
});

describe('API', () => {
  it('stores both fields through the brief route and returns them; a bad value is a 400 naming the field', async () => {
    t = await makeTestApp({ staffingStepMs: 30 });
    const A = await withAdmin(t.app);
    const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission.id as string;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
    const inst = (await t.pool.query(`select id from agent_instances where mission_id=$1 order by seq`, [m])).rows as { id: string }[];
    const ok = await A.admin.req('POST', `/missions/${m}/delegation-briefs`, { toInstanceId: inst[1].id, brief: base({ taskClass: 'coding', difficulty: 4 }) }, key());
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.brief.brief.taskClass).toBe('coding');
    expect(ok.body.brief.brief.difficulty).toBe(4);
    const list = (await A.admin.req('GET', `/missions/${m}/delegation-briefs`)).body.briefs.find((b: any) => b.id === ok.body.brief.id);
    expect(list.brief.taskClass).toBe('coding');
    const bad = await A.admin.req('POST', `/missions/${m}/delegation-briefs`, { toInstanceId: inst[1].id, brief: base({ taskClass: 'wizardry', difficulty: 9 }) }, key());
    expect(bad.status).toBe(400);
    expect(bad.body.error?.fieldErrors ?? bad.body.fieldErrors ?? {}).toEqual(expect.objectContaining({ taskClass: expect.any(String), difficulty: expect.any(String) }));
  });
});
