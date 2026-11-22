import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, makeSchema, type TestApp, type Browser } from './helpers.ts';
import { tx } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { proposeLesson } from '../src/agents/playbooks.ts';
import { originRank, type SourceRef } from '../../shared/contracts/src/index.ts';

// c59 fix round (review F1, F5, F6).
let t: TestApp; let A: Browser, B: Browser, M: Browser; let aId = ''; let n = 0;
const key = () => ({ 'idempotency-key': 'c59f' + n++ });
const q = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const SRC: SourceRef[] = [{ kind: 'review', id: 'REV-F' }];
const lesson = (by: Browser, text: string, agent = 'coder-01') => by.req('POST', `/agents/${agent}/lessons`, { text, sources: SRC }, key());
const actions = async (id: string, kind = 'lessons') => ((await A.req('GET', `/${kind}/${id}/contributions`)).body.contributions as { action: string }[]).map((c) => c.action);

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app); A = w.admin; aId = w.adminId;
  const b = await w.member('Bea'); B = b.b;
  expect((await A.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b;
});
afterAll(async () => { await t.close(); });

describe('F1: a 0044 down then up never raises a class', () => {
  it('derived, tool and agent rows come back at the lowest class that is provable; human entries stay human', async () => {
    const s = await makeSchema();
    try {
      await s.pool.query(`insert into agent_definitions(id,tenant_id,name,role,dept,duty,created_by) values ('a-1','t-1','A','r','d','duty','system')`);
      const ins = (id: string, kind: string, ch: string, cl: string, srcs: unknown[], by = 'u-1', filed: string | null = null) => s.pool.query(
        `insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,proposed_by_kind,submitted_by,sha256,origin_channel,origin_class) values ($1,'t-1','a-1','r',$1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, JSON.stringify(srcs), by, kind, filed, 'a'.repeat(64), ch, cl]);
      const note = [{ kind: 'note', id: 'n' }];
      await ins('LC-T', 'agent', 'tool_output', 'tool', note, 'tester', 'u-9');
      await ins('LC-G', 'agent', 'agent_output', 'agent', note, 'tester', 'u-9');
      await ins('LC-D', 'human', 'derived', 'agent', [{ kind: 'lesson', id: 'LC-G' }]);
      await ins('LC-H', 'human', 'human_entry', 'human', note);
      const before = new Map((await s.pool.query('select id, origin_class c from lesson_candidates')).rows.map((r) => [r.id, r.c]));
      await migrate(s.pool, 'down', 43); await migrate(s.pool, 'up');
      const after = (await s.pool.query('select id, origin_class c, origin_channel ch from lesson_candidates')).rows;
      for (const r of after) expect(originRank(r.c), r.id).toBeLessThanOrEqual(originRank(before.get(r.id)));
      expect(after.find((r) => r.id === 'LC-H')).toMatchObject({ c: 'human', ch: 'human_entry' });
      expect(after.find((r) => r.id === 'LC-D')).toMatchObject({ c: 'tool', ch: 'derived' });
    } finally { await s.drop(); }
  });
});

describe('F6: the trigger matches source kinds case-insensitively', () => {
  it('a raw row citing {"kind":"Lesson"} as human_entry is refused', async () => {
    const g = await tx(t.app.db, (c) => proposeLesson(c, { tenantId: 't-1', agentId: 'coder-01', proposedBy: 'tester-01', kind: 'agent', submittedBy: aId, text: 'Case probe ' + n++, sources: SRC, correlationId: 'c59f' }));
    for (const k of ['Lesson', 'LESSON', 'Skill']) await expect(t.pool.query(
      `insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,sha256,origin_channel,origin_class) values ($1,'t-1','coder-01','dev','x',$2,'u-raw',$3,'human_entry','human')`,
      ['LC-CASE' + n++, JSON.stringify([{ kind: k, id: g }]), 'b'.repeat(64)]), k).rejects.toThrow(/derived/);
  });
});

describe('F5: the log is complete by construction', () => {
  it('a raw status change without an actor is refused; with a transaction-local actor it writes its log row', async () => {
    const sk = (await M.req('POST', '/skills', { name: 'Raw log ' + n++, description: 'd', steps: [{ kind: 'note', detail: 'x' }], preconditions: [], sources: SRC }, key())).body.skill.id as string;
    await expect(t.pool.query(`update skills set status='retired', retired_by='u-9', retired_at=now() where id=$1`, [sk])).rejects.toThrow(/actor/);
    const c = await t.pool.connect();
    try {
      await c.query('begin'); await c.query(`select set_config('axion.actor','u-9',true), set_config('axion.actor_kind','human',true)`);
      await c.query(`update skills set status='retired', retired_by='u-9', retired_at=now() where id=$1`, [sk]); await c.query('commit');
    } finally { c.release(); }
    expect(await actions(sk, 'skills')).toEqual(['proposed', 'retired']);
    expect((await q(`select actor from record_contributions where record_id=$1 and action='retired'`, [sk]))[0].actor).toBe('u-9');
  });

  it('the person who files an agent proposal is recorded on its proposed line', async () => {
    const id = await tx(t.app.db, (c) => proposeLesson(c, { tenantId: 't-1', agentId: 'writer-01', proposedBy: 'tester-01', kind: 'agent', submittedBy: aId, text: 'Filed lesson ' + n++, sources: SRC, correlationId: 'c59f' }));
    const line = (await A.req('GET', `/lessons/${id}/contributions`)).body.contributions[0];
    expect(line).toMatchObject({ actor: 'tester-01', actorKind: 'agent', filedBy: aId, filedByName: 'Luca' });
  });

  it('withdraw, restore, withdraw again: the log ends with withdrawn (the second withdrawal is a real event)', async () => {
    const l1 = (await lesson(M, 'Rollback line one ' + n++, 'tester-01')).body.lesson.id as string;
    const l2 = (await lesson(M, 'Rollback line two ' + n++, 'tester-01')).body.lesson.id as string;
    expect((await B.req('POST', `/lessons/${l1}/decision`, { decision: 'accept', baseVersion: 0 })).status).toBe(200);
    expect((await B.req('POST', `/lessons/${l2}/decision`, { decision: 'accept', baseVersion: 1 })).status).toBe(200);
    for (const [to, base] of [[1, 2], [2, 3], [1, 4]]) expect((await B.req('POST', '/agents/tester-01/playbook/rollback', { toVersion: to, baseVersion: base, why: 'again' })).status).toBe(200);
    expect(await actions(l2)).toEqual(['proposed', 'accepted', 'withdrawn', 'restored', 'withdrawn']);
  });

  it('an actor without a kind is refused, and a line written by the insert fallback says the actor was not asserted', async () => {
    const sk = (await M.req('POST', '/skills', { name: 'Kind probe ' + n++, description: 'd', steps: [{ kind: 'note', detail: 'x' }], preconditions: [], sources: SRC }, key())).body.skill.id as string;
    const c = await t.pool.connect();
    try {
      await c.query('begin'); await c.query(`select set_config('axion.actor','u-9',true), set_config('axion.actor_kind','',true)`);
      await expect(c.query(`update skills set status='retired', retired_by='u-9', retired_at=now() where id=$1`, [sk])).rejects.toThrow(/kind/);
      await c.query('rollback');
    } finally { c.release(); }
    expect((await A.req('GET', `/skills/${sk}/contributions`)).body.contributions[0]).toMatchObject({ action: 'proposed', actorAsserted: true });
    await t.pool.query(`insert into skills(id,tenant_id,name,version,description,steps,sources,proposed_by) values ('SK-FB','t-1','Fallback',1,'d','[{"kind":"note","detail":"x"}]',$1,'u-raw')`, [JSON.stringify(SRC)]);
    expect((await A.req('GET', '/skills/SK-FB/contributions')).body.contributions[0]).toMatchObject({ actor: 'u-raw', actorAsserted: false });
  });
});
