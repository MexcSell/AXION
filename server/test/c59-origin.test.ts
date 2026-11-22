import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, makeSchema, type TestApp, type Browser } from './helpers.ts';
import { tx } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { proposeLesson, proposeSkill } from '../src/agents/playbooks.ts';
import type { SourceRef } from '../../shared/contracts/src/index.ts';

// Improvement cycle 59, item 1 (R2-5): every lesson and skill records its write channel and an origin class derived from it.
// Ruling (total order): tool < agent < human. Review never changes the class. A derived record is never above its weakest source.
let t: TestApp;
let A: Browser, B: Browser, M: Browser, K: Browser;
let aId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'c59o' + n++ });
const q = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const SRC: SourceRef[] = [{ kind: 'review', id: 'REV-1', note: 'Reviewer asked for it twice' }];
const lesson = (by: Browser, text: string, sources: SourceRef[] = SRC, agent = 'coder-01') => by.req('POST', `/agents/${agent}/lessons`, { text, sources }, key());
const ref = (kind: 'lesson' | 'skill', id: string): SourceRef => ({ kind, id });
const viaService = (over: Record<string, unknown>) => tx(t.app.db, (c) => proposeLesson(c, { tenantId: 't-1', agentId: 'coder-01', proposedBy: 'tester-01', kind: 'agent', submittedBy: aId, text: 'Agent lesson ' + n++, sources: SRC, correlationId: 'c59-svc', ...over } as any));
const skillSteps = [{ kind: 'observe', detail: 'Look at the status page' }];
const skillBody = (over: Record<string, unknown> = {}) => ({ name: 'Origin skill ' + n++, description: 'A skill.', steps: skillSteps, preconditions: [], sources: SRC, ...over });
const cls = async (id: string, table = 'lesson_candidates') => (await q(`select origin_channel as ch, origin_class as cl from ${table} where id=$1`, [id]))[0] as { ch: string; cl: string };

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea'); B = b.b;
  expect((await A.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b; K = (await w.member('Kai')).b;
});
afterAll(async () => { await t.close(); });

describe('origin channels', () => {
  it('a person entering a lesson through the route is human_entry / human, and the DTO says so', async () => {
    const r = await lesson(M, 'Prefer role locators over css selectors ' + n++);
    expect(r.status).toBe(201);
    expect(r.body.lesson).toMatchObject({ originChannel: 'human_entry', originClass: 'human' });
    expect(await cls(r.body.lesson.id)).toEqual({ ch: 'human_entry', cl: 'human' });
  });

  it('the origin is never read from a request body: every attempt to send it is 400 and nothing is stored (lessons and skills)', async () => {
    const before = (await q('select count(*)::int n from lesson_candidates'))[0].n + (await q('select count(*)::int n from skills'))[0].n;
    for (const extra of [{ originClass: 'human' }, { originChannel: 'human_entry' }, { origin: { class: 'human' } }, { originClass: 'agent', originChannel: 'derived' }]) {
      expect((await M.req('POST', '/agents/coder-01/lessons', { text: 'Smuggled ' + n++, sources: SRC, ...extra }, key())).status, JSON.stringify(extra)).toBe(400);
      expect((await M.req('POST', '/skills', skillBody(extra), key())).status, JSON.stringify(extra)).toBe(400);
    }
    expect((await q('select count(*)::int n from lesson_candidates'))[0].n + (await q('select count(*)::int n from skills'))[0].n).toBe(before);
  });

  it('agent-side writes: agent_output is class agent, tool_output is class tool, and the default for an agent is agent_output', async () => {
    const def = await viaService({});
    const agentOut = await viaService({ channel: 'agent_output' });
    const toolOut = await viaService({ channel: 'tool_output' });
    expect(await cls(def)).toEqual({ ch: 'agent_output', cl: 'agent' });
    expect(await cls(agentOut)).toEqual({ ch: 'agent_output', cl: 'agent' });
    expect(await cls(toolOut)).toEqual({ ch: 'tool_output', cl: 'tool' });
    const dto = (await A.req('GET', `/lessons/${toolOut}`)).body.lesson;
    expect(dto).toMatchObject({ originChannel: 'tool_output', originClass: 'tool', proposedByKind: 'agent' });
  });

  it('100% of attempts to make an agent-side write human are refused: every kind x channel x filer combination, and raw SQL', async () => {
    const attempts: Record<string, unknown>[] = [];
    for (const submittedBy of [aId, undefined]) attempts.push({ channel: 'human_entry', submittedBy });
    let refused = 0;
    for (const a of attempts) { await expect(viaService(a)).rejects.toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' }); refused++; }
    // a derived agent write from human sources is still capped at agent
    const h = (await lesson(M, 'A human lesson to summarise ' + n++)).body.lesson.id as string;
    const d = await viaService({ channel: 'derived', sources: [ref('lesson', h)] });
    expect(await cls(d)).toEqual({ ch: 'derived', cl: 'agent' });
    // raw SQL cannot say human for an agent row (a CHECK in the table), however the channel is spelled
    for (const [ch, cl] of [['human_entry', 'human'], ['agent_output', 'human'], ['derived', 'human'], ['tool_output', 'human']]) {
      await expect(t.pool.query(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,proposed_by_kind,submitted_by,sha256,origin_channel,origin_class) values ($1,'t-1','coder-01','dev','x',$2,'tester-01','agent',$3,$4,$5,$6)`,
        ['LC-RAW' + n++, JSON.stringify([ref('lesson', h)]), aId, 'a'.repeat(64), ch, cl]), `${ch}/${cl}`).rejects.toThrow();
      refused++;
    }
    expect(refused).toBe(6);
    // skills too
    await expect(tx(t.app.db, (c) => proposeSkill(c, { tenantId: 't-1', proposedBy: 'tester-01', kind: 'agent', submittedBy: aId, channel: 'human_entry', ...skillBody(), correlationId: 'c59' } as any))).rejects.toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
    await expect(t.pool.query(`insert into skills(id,tenant_id,name,version,description,steps,sources,proposed_by,proposed_by_kind,origin_channel,origin_class) values ('SK-RAW','t-1','Raw',1,'d','[{"kind":"note","detail":"x"}]',$1,'tester-01','agent','human_entry','human')`, [JSON.stringify(SRC)])).rejects.toThrow();
  });

  it('a raw insert that names no origin still works: the database fills the channel and class from the proposer kind', async () => {
    await t.pool.query(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,sha256) values ('LC-DEF-H','t-1','coder-01','dev','raw human',$1,'u-raw',$2)`, [JSON.stringify(SRC), 'b'.repeat(64)]);
    await t.pool.query(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,proposed_by_kind,sha256) values ('LC-DEF-A','t-1','coder-01','dev','raw agent',$1,'tester-01','agent',$2)`, [JSON.stringify(SRC), 'c'.repeat(64)]);
    expect(await cls('LC-DEF-H')).toEqual({ ch: 'human_entry', cl: 'human' });
    expect(await cls('LC-DEF-A')).toEqual({ ch: 'agent_output', cl: 'agent' });
  });
});

describe('derivation: never above the weakest source', () => {
  it('a person summarising agent-written items stays at agent, a mix with a tool item stays at tool, and agreement between agent items never raises', async () => {
    const human = (await lesson(M, 'Human fact one ' + n++)).body.lesson.id as string;
    const agent1 = await viaService({});
    const agent2 = await viaService({});
    const tool = await viaService({ channel: 'tool_output' });
    const d1 = (await lesson(A, 'A person summarises the agent item ' + n++, [ref('lesson', agent1)])).body.lesson;
    expect(d1).toMatchObject({ originChannel: 'derived', originClass: 'agent' });
    const d2 = (await lesson(A, 'Two agents agree on this ' + n++, [ref('lesson', agent1), ref('lesson', agent2)])).body.lesson;
    expect(d2.originClass).toBe('agent');
    const d3 = (await lesson(A, 'Human plus tool merged ' + n++, [ref('lesson', human), ref('lesson', tool)])).body.lesson;
    expect(d3.originClass).toBe('tool');
    const d4 = (await lesson(A, 'Only human sources ' + n++, [ref('lesson', human)])).body.lesson;
    expect(d4).toMatchObject({ originChannel: 'derived', originClass: 'human' });
  });

  it('a 3-level chain: tool -> agent-derived -> person-derived (with a human source) -> person-derived stays at tool', async () => {
    const human = (await lesson(M, 'Human anchor ' + n++)).body.lesson.id as string;
    const l0 = await viaService({ channel: 'tool_output' });                                           // level 0: tool
    const l1 = await viaService({ channel: 'derived', sources: [ref('lesson', l0)] });                   // level 1: agent summarises the tool item
    const l2 = (await lesson(A, 'Level two merges ' + n++, [ref('lesson', l1), ref('lesson', human)])).body.lesson.id as string; // level 2: person merges with a human item
    const l3 = (await lesson(B, 'Level three restates ' + n++, [ref('lesson', l2)])).body.lesson.id as string;                   // level 3
    for (const id of [l1, l2, l3]) expect((await cls(id)).cl, id).toBe('tool');
    // a skill derived from the chain is capped as well
    const sk = (await A.req('POST', '/skills', skillBody({ sources: [ref('lesson', l3), ref('lesson', human)] }), key())).body.skill;
    expect(sk).toMatchObject({ originChannel: 'derived', originClass: 'tool' });
    // and a skill derived from a skill
    const sk2 = (await B.req('POST', '/skills', skillBody({ sources: [ref('skill', sk.id)] }), key())).body.skill;
    expect(sk2).toMatchObject({ originClass: 'tool' });
  });

  it('a reference to a record that does not exist, is in another tenant, or that the person cannot see is 404; a person cannot launder an invisible item', async () => {
    expect((await lesson(A, 'Ghost source ' + n++, [ref('lesson', 'LC-NOPE')])).status).toBe(404);
    expect((await A.req('POST', '/skills', skillBody({ sources: [ref('skill', 'SK-NOPE')] }), key())).status).toBe(404);
    const mine = (await lesson(M, 'Mia proposal, private to her ' + n++)).body.lesson.id as string; // proposed, not accepted: Kai may not see it
    expect((await lesson(K, 'Kai cites it ' + n++, [ref('lesson', mine)])).status).toBe(404);
    expect((await lesson(M, 'Mia cites her own ' + n++, [ref('lesson', mine)])).status).toBe(201);
  });

  it('the database holds the rule too: a derived row above its weakest source, with no record source, or naming a missing one is refused; so is a raw class change', async () => {
    const tool = await viaService({ channel: 'tool_output' });
    const ins = (id: string, cls: string, srcs: SourceRef[], kind = 'human', by = 'u-raw') => t.pool.query(
      `insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,proposed_by_kind,sha256,origin_channel,origin_class) values ($1,'t-1','coder-01','dev','derived raw',$2,$3,$4,$5,'derived',$6)`,
      [id, JSON.stringify(srcs), by, kind, 'd'.repeat(64), cls]);
    await expect(ins('LC-D1', 'human', [ref('lesson', tool)])).rejects.toThrow(/weakest source/);
    await expect(ins('LC-D2', 'agent', [ref('lesson', tool)])).rejects.toThrow(/weakest source/);
    await expect(ins('LC-D3', 'tool', SRC)).rejects.toThrow(/lesson or skill sources/);
    await expect(ins('LC-D4', 'tool', [ref('lesson', 'LC-MISSING')])).rejects.toThrow(/exist/);
    await expect(ins('LC-D5', 'human', [ref('lesson', (await viaService({}))), ref('lesson', tool)], 'agent', 'tester-01')).rejects.toThrow();
    await ins('LC-OK', 'tool', [ref('lesson', tool)]);
    // immutable: no UPDATE can raise (or lower) the class or channel, on a proposed row or a decided one
    for (const set of ["origin_class='human'", "origin_class='agent'", "origin_channel='human_entry', origin_class='human'"])
      await expect(t.pool.query(`update lesson_candidates set ${set} where id='LC-OK'`), set).rejects.toThrow(/can only be decided/);
    await t.pool.query(`update lesson_candidates set status='rejected', decided_by='u-other', decided_at=now() where id='LC-OK'`);
    await expect(t.pool.query(`update lesson_candidates set origin_class='human' where id='LC-OK'`)).rejects.toThrow(/never changes/);
    const sk = (await A.req('POST', '/skills', skillBody(), key())).body.skill;
    await expect(t.pool.query(`update skills set origin_class='agent' where id=$1`, [sk.id])).rejects.toThrow(/can only be approved or retired/);
  });
});

describe('review is a separate axis: it never changes the class', () => {
  it('accept, approve and rollback leave the origin as written; the playbook item reports it from the lesson row', async () => {
    const agentLesson = await viaService({ agentId: 'writer-01', text: 'Writer notes that headings need sentence case ' + n++ });
    const accepted = await B.req('POST', `/lessons/${agentLesson}/decision`, { decision: 'accept', baseVersion: 0 });
    expect(accepted.status).toBe(200);
    expect(accepted.body.lesson).toMatchObject({ originChannel: 'agent_output', originClass: 'agent' });
    expect(accepted.body.playbook.items.at(-1)).toMatchObject({ lessonId: agentLesson, trust: 'reviewed', originChannel: 'agent_output', originClass: 'agent' });
    const human = (await lesson(M, 'Writer should keep paragraphs short ' + n++, SRC, 'writer-01')).body.lesson.id as string;
    expect((await A.req('POST', `/lessons/${human}/decision`, { decision: 'accept', baseVersion: 1 })).status).toBe(200);
    expect((await A.req('POST', '/agents/writer-01/playbook/rollback', { toVersion: 1, baseVersion: 2, why: 'Back to the first.' })).status).toBe(200);
    const cur = (await A.req('GET', '/agents/writer-01/playbook')).body.playbook;
    expect(cur.items.map((i: any) => [i.originChannel, i.originClass])).toEqual([['agent_output', 'agent']]);
    expect(await cls(agentLesson)).toEqual({ ch: 'agent_output', cl: 'agent' });
    // a skill's approval does not change it either
    const sk = (await viaServiceSkill({})).id;
    const ap = await B.req('POST', `/skills/${sk}/approve`, {});
    expect(ap.status).toBe(200);
    expect(ap.body.skill).toMatchObject({ status: 'approved', originChannel: 'agent_output', originClass: 'agent' });
  });

  it('a human-entered skill is human_entry / human, and an agent-proposed skill (service) is agent', async () => {
    const h = (await A.req('POST', '/skills', skillBody(), key())).body.skill;
    expect(h).toMatchObject({ originChannel: 'human_entry', originClass: 'human' });
    const a = await viaServiceSkill({ channel: 'tool_output' });
    expect(a).toMatchObject({ originChannel: 'tool_output', originClass: 'tool', proposedBy: 'tester-01' });
  });
});

async function viaServiceSkill(over: Record<string, unknown>): Promise<any> {
  const id = await tx(t.app.db, (c) => proposeSkill(c, { tenantId: 't-1', proposedBy: 'tester-01', kind: 'agent', submittedBy: aId, ...skillBody(), correlationId: 'c59-sk', ...over } as any));
  return (await A.req('GET', `/skills/${id}`)).body.skill;
}

describe('migration 0044 on a database that already has decided rows', () => {
  it('backfills agent rows (also the decided and retired ones the c41 guard would refuse to touch), keeps human rows, and down restores the 0033 guard bodies', async () => {
    const s = await makeSchema({ migrate: false });
    try {
      await migrate(s.pool, 'up', 43);
      // earlier migrations in this tree stop below 0044, so this is the state before c59
      const guards = async () => (await s.pool.query(`select proname, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and proname in ('lesson_candidates_guard','skills_guard') order by 1`, [s.schema])).rows;
      const before = await guards();
      await s.pool.query(`insert into agent_definitions(id,tenant_id,name,role,dept,duty,created_by) values ('a-1','t-1','A','r','d','duty','system')`);
      const L = (id: string, kind: string, status: string) => s.pool.query(
        `insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,proposed_by_kind,submitted_by,sha256,status,decided_by,decided_at) values ($1,'t-1','a-1','r',$1,'[{"kind":"note","id":"n"}]',$2,$3,$4,$5,$6,$7,$8)`,
        [id, kind === 'agent' ? 'ag-1' : 'u-1', kind, kind === 'agent' ? 'u-9' : null, 'a'.repeat(64), status, status === 'proposed' ? null : 'u-2', status === 'proposed' ? null : new Date()]);
      await L('LC-H', 'human', 'rejected'); await L('LC-A1', 'agent', 'rejected'); await L('LC-A2', 'agent', 'proposed');
      await s.pool.query(`insert into skills(id,tenant_id,name,version,description,steps,sources,proposed_by,proposed_by_kind,status,retired_by,retired_at) values ('SK-A','t-1','S',1,'d','[{"kind":"note","detail":"x"}]','[{"kind":"note","id":"n"}]','ag-1','agent','retired','u-2',now())`);
      await migrate(s.pool, 'up');
      const rows = (await s.pool.query(`select id, origin_channel, origin_class from lesson_candidates order by id`)).rows;
      expect(rows).toEqual([{ id: 'LC-A1', origin_channel: 'agent_output', origin_class: 'agent' }, { id: 'LC-A2', origin_channel: 'agent_output', origin_class: 'agent' }, { id: 'LC-H', origin_channel: 'human_entry', origin_class: 'human' }]);
      expect((await s.pool.query(`select origin_channel, origin_class from skills`)).rows).toEqual([{ origin_channel: 'agent_output', origin_class: 'agent' }]);
      // the guards are live again afterwards: a decided row is still immutable
      await expect(s.pool.query(`update lesson_candidates set origin_class='human' where id='LC-A1'`)).rejects.toThrow(/never changes/);
      await migrate(s.pool, 'down', 43);
      expect(await guards()).toEqual(before);
      expect((await s.pool.query(`select count(*)::int n from lesson_candidates`)).rows[0].n).toBe(3);
      await migrate(s.pool, 'up');
    } finally { await s.drop(); }
  });
});
