import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { tx } from '../src/db.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { recordFixtureOutcome } from '../src/agents/retirement.ts';
import { SKILL_SCORE_FLOOR, SKILL_OUTCOME_MIN_N } from '../../shared/contracts/src/index.ts';

// Improvement cycle 59, item 4 (R2-5): retirement proposals, FIXTURE-ONLY. No agent uses a skill yet, so the only scores are fixtures a test writes.
// A proposal appears when the latest fixture score is below the floor with enough observations; a person decides; nothing retires by itself.
let t: TestApp;
let A: Browser, B: Browser, M: Browser;
let aId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'c59r' + n++ });
const q = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const newSkill = async (name: string) => {
  const s = (await M.req('POST', '/skills', { name: name + ' ' + n++, description: 'A skill.', steps: [{ kind: 'observe', detail: 'Look at it' }], preconditions: [], sources: [{ kind: 'review', id: 'REV-4' }] }, key())).body.skill;
  expect((await B.req('POST', `/skills/${s.id}/approve`, {})).status).toBe(200);
  return s.id as string;
};
const outcome = (skillId: string, score: number, nn: number) => tx(t.app.db, (c) => recordFixtureOutcome(c, { tenantId: 't-1', skillId, score, n: nn }));
const proposals = async (by: Browser = A) => (await by.req('GET', '/skills/retirement-proposals')).body as { floor: number; minN: number; dataState: string; proposals: { skillId: string; score: number; n: number; outcomeId: number; source: string }[] };
const status = async (id: string) => (await q('select status from skills where id=$1', [id]))[0].status as string;

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea'); B = b.b;
  expect((await A.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b;
});
afterAll(async () => { await t.close(); });

describe('no outcome data', () => {
  it('says so explicitly: dataState none, no proposals, the floor and the minimum are stated', async () => {
    const p = await proposals();
    expect(p).toEqual({ floor: SKILL_SCORE_FLOOR, minN: SKILL_OUTCOME_MIN_N, dataState: 'none', proposals: [] });
  });
});

describe('proposals', () => {
  it('appear only below the floor with enough observations, label fixture data, and never retire anything', async () => {
    const ok = await newSkill('Healthy skill'), few = await newSkill('Few observations'), low = await newSkill('Low scorer'), edge = await newSkill('At the floor');
    await outcome(ok, 0.9, 20);
    await outcome(few, 0.1, SKILL_OUTCOME_MIN_N - 1);
    await outcome(low, SKILL_SCORE_FLOOR - 0.01, SKILL_OUTCOME_MIN_N);
    await outcome(edge, SKILL_SCORE_FLOOR, 50); // the floor itself is not below it
    const p = await proposals();
    expect(p.dataState).toBe('fixture');
    expect(p.proposals.map((x) => x.skillId)).toEqual([low]);
    expect(p.proposals[0]).toMatchObject({ source: 'fixture', n: SKILL_OUTCOME_MIN_N, name: expect.stringContaining('Low scorer'), version: 1 });
    expect(p.proposals[0].score).toBeCloseTo(SKILL_SCORE_FLOOR - 0.01, 3);
    // a proposal is only a proposal: every skill is still approved, nothing was audited as a retirement, no log line says retired
    for (const id of [ok, few, low, edge]) expect(await status(id)).toBe('approved');
    expect((await q(`select count(*)::int n from audit_events where action='skill.retire'`))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from record_contributions where action='retired'`))[0].n).toBe(0);
  });

  it('only the latest score counts: a recovery removes the proposal, a later drop brings it back', async () => {
    const s = await newSkill('Recovering');
    await outcome(s, 0.1, 10);
    expect((await proposals()).proposals.map((x) => x.skillId)).toContain(s);
    await outcome(s, 0.8, 10);
    expect((await proposals()).proposals.map((x) => x.skillId)).not.toContain(s);
    await outcome(s, 0.2, 12);
    expect((await proposals()).proposals.map((x) => x.skillId)).toContain(s);
  });

  it('a person retires through the existing retire route and the proposal is gone; a retired or draft skill never has one', async () => {
    const s = await newSkill('To retire');
    await outcome(s, 0.05, 9);
    expect((await proposals()).proposals.map((x) => x.skillId)).toContain(s);
    expect((await A.req('POST', `/skills/${s}/retire`, { note: 'Fixture says it fails.' })).status).toBe(200);
    expect((await proposals()).proposals.map((x) => x.skillId)).not.toContain(s);
    const draft = (await M.req('POST', '/skills', { name: 'Draft ' + n++, description: 'd', steps: [{ kind: 'note', detail: 'x' }], preconditions: [], sources: [{ kind: 'review', id: 'R' }] }, key())).body.skill.id;
    await outcome(draft, 0.0, 99);
    expect((await proposals()).proposals.map((x) => x.skillId)).not.toContain(draft);
  });

  it('a person can keep a skill: the dismissal is logged against that score, the proposal is gone, and a new low score proposes it again', async () => {
    const s = await newSkill('To keep');
    await outcome(s, 0.1, 8);
    const first = (await proposals()).proposals.find((x) => x.skillId === s)!;
    const r = await A.req('POST', `/skills/${s}/retirement-dismiss`, { note: 'Fixture data is not real use.' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(await status(s)).toBe('approved'); // keeping changes nothing about the skill
    expect((await proposals()).proposals.map((x) => x.skillId)).not.toContain(s);
    const lines = (await A.req('GET', `/skills/${s}/contributions`)).body.contributions;
    expect(lines.at(-1)).toMatchObject({ action: 'retirement_kept', actor: aId, note: 'Fixture data is not real use.' });
    expect((await q(`select ref from record_contributions where record_id=$1 and action='retirement_kept'`, [s]))[0].ref).toBe(String(first.outcomeId));
    expect((await q(`select count(*)::int n from audit_events where action='skill.retirementDismiss' and subject=$1 and result='ok'`, [s]))[0].n).toBe(1);
    await outcome(s, 0.05, 9);
    expect((await proposals()).proposals.map((x) => x.skillId)).toContain(s);
  });

  it('dismissing something that is not proposed is 409, an unknown skill is 404, and members get 403 on both routes', async () => {
    const fine = await newSkill('Fine skill');
    await outcome(fine, 0.95, 30);
    const r = await A.req('POST', `/skills/${fine}/retirement-dismiss`, {});
    expect([r.status, r.body.code]).toEqual([409, 'PROPOSAL_NOT_PENDING']);
    expect((await A.req('POST', '/skills/SK-NOPE/retirement-dismiss', {})).status).toBe(404);
    expect((await M.req('GET', '/skills/retirement-proposals')).status).toBe(403);
    expect((await M.req('POST', `/skills/${fine}/retirement-dismiss`, {})).status).toBe(403);
  });

  it("another tenant's skills never appear", async () => {
    await q(`insert into tenants(id,name) values ('t-2','Other') on conflict do nothing`);
    await q(`insert into skills(id,tenant_id,name,version,description,steps,sources,proposed_by,status,approved_by,approved_at) values ('SK-T2R','t-2','Foreign',1,'d','[{"kind":"note","detail":"x"}]','[{"kind":"note","id":"n"}]','u-x','approved','u-y',now())`);
    await q(`insert into skill_outcomes(tenant_id,skill_id,score,n) values ('t-2','SK-T2R',0.0,50)`);
    expect((await proposals()).proposals.map((x) => x.skillId)).not.toContain('SK-T2R');
  });
});

describe('skill_outcomes is append-only and fixture-only', () => {
  it('UPDATE, DELETE and TRUNCATE are refused; the purge flag allows only the delete; only fixtures and sane scores can be written; clearDemo still works', async () => {
    const s = await newSkill('Guarded outcomes');
    await outcome(s, 0.5, 5);
    await expect(t.pool.query(`update skill_outcomes set score=1`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from skill_outcomes`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate skill_outcomes`)).rejects.toThrow(/append-only/);
    const c = await t.pool.connect();
    try {
      await c.query('begin'); await c.query(`set local axion.purge_demo = 'on'`);
      expect((await c.query('delete from skill_outcomes where skill_id=$1', [s])).rowCount).toBe(1);
      await expect(c.query('truncate skill_outcomes')).rejects.toThrow(/append-only/);
      await c.query('rollback');
    } finally { c.release(); }
    await expect(t.pool.query(`insert into skill_outcomes(tenant_id,skill_id,score,n,source) values ('t-1',$1,0.5,5,'agent_run')`, [s])).rejects.toThrow(); // no real-use source exists yet
    for (const [score, nn] of [[-0.1, 5], [1.1, 5], [0.5, 0]]) await expect(outcome(s, score, nn), `${score}/${nn}`).rejects.toThrow();
    await seedDemo(t.app.db, 't-1', aId);
    const before = (await q('select count(*)::int n from skill_outcomes'))[0].n;
    await expect(clearDemo(t.app.db, 't-1')).resolves.toBeTruthy();
    expect((await q('select count(*)::int n from skill_outcomes'))[0].n).toBe(before);
  });
});
