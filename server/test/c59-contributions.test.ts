import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { tx } from '../src/db.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { proposeLesson } from '../src/agents/playbooks.ts';
import type { SourceRef } from '../../shared/contracts/src/index.ts';

// Improvement cycle 59, item 2 (R2-5): an append-only contribution log per record, with all four guards (UPDATE, DELETE, TRUNCATE, purge exception).
let t: TestApp;
let A: Browser, B: Browser, M: Browser, K: Browser;
let aId = '', bId = '', mId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'c59c' + n++ });
const q = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const SRC: SourceRef[] = [{ kind: 'review', id: 'REV-9', note: 'seen twice' }];
const lesson = (by: Browser, text: string, agent = 'coder-01', sources: SourceRef[] = SRC) => by.req('POST', `/agents/${agent}/lessons`, { text, sources }, key());
const log = async (by: Browser, kind: 'lessons' | 'skills', id: string) => by.req('GET', `/${kind}/${id}/contributions`);
const actions = async (by: Browser, kind: 'lessons' | 'skills', id: string) => ((await log(by, kind, id)).body.contributions as { action: string }[]).map((c) => c.action);
const skillBody = (over: Record<string, unknown> = {}) => ({ name: 'Log skill ' + n++, description: 'A skill.', steps: [{ kind: 'observe', detail: 'Look at it' }], preconditions: [], sources: SRC, ...over });

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea'); B = b.b; bId = b.id;
  expect((await A.req('PATCH', `/users/${bId}`, { role: 'admin' })).status).toBe(200);
  const m = await w.member('Mia'); M = m.b; mId = m.id;
  K = (await w.member('Kai')).b;
});
afterAll(async () => { await t.close(); });

describe('every writer logs', () => {
  it('propose, accept (and the system closing a duplicate), reject: who, what, when, from which sources', async () => {
    const text = 'Log the lesson once ' + n++;
    const l1 = (await lesson(M, text)).body.lesson.id as string;
    const dup = (await lesson(K, text)).body.lesson.id as string;
    const rej = (await lesson(K, 'This one is rejected ' + n++)).body.lesson.id as string;
    expect(await actions(A, 'lessons', l1)).toEqual(['proposed']);
    const first = (await log(A, 'lessons', l1)).body.contributions[0];
    expect(first).toMatchObject({ recordKind: 'lesson', recordId: l1, action: 'proposed', actor: mId, actorName: 'Mia', actorKind: 'human', originChannel: 'human_entry', originClass: 'human', sources: [expect.objectContaining({ kind: 'review', id: 'REV-9' })], version: null });
    expect(typeof first.at).toBe('string'); expect(first.seq).toEqual(expect.any(Number));
    expect((await B.req('POST', `/lessons/${l1}/decision`, { decision: 'accept', baseVersion: 0, note: 'Fine.' })).status).toBe(200);
    expect(await actions(A, 'lessons', l1)).toEqual(['proposed', 'accepted']);
    const acc = (await log(A, 'lessons', l1)).body.contributions[1];
    expect(acc).toMatchObject({ actor: bId, actorName: 'Bea', actorKind: 'human', version: 1, note: 'Fine.' });
    expect(await actions(A, 'lessons', dup)).toEqual(['proposed', 'closed_duplicate']);
    expect((await log(A, 'lessons', dup)).body.contributions[1]).toMatchObject({ actor: 'system', actorKind: 'system', note: `Same text as ${l1}` });
    expect((await B.req('POST', `/lessons/${rej}/decision`, { decision: 'reject', note: 'No.' })).status).toBe(200);
    expect(await actions(A, 'lessons', rej)).toEqual(['proposed', 'rejected']);
  });

  it('an agent proposal is logged with the agent as the actor and its channel; a rollback logs withdrawn and restored on the lessons it moved', async () => {
    const id = await tx(t.app.db, (c) => proposeLesson(c, { tenantId: 't-1', agentId: 'writer-01', proposedBy: 'tester-01', kind: 'agent', submittedBy: aId, channel: 'tool_output', text: 'Tool says use sentence case ' + n++, sources: SRC, correlationId: 'c59-c' }));
    expect((await log(A, 'lessons', id)).body.contributions[0]).toMatchObject({ action: 'proposed', actor: 'tester-01', actorKind: 'agent', originChannel: 'tool_output', originClass: 'tool' });
    const l1 = (await lesson(M, 'Writer: keep titles short ' + n++, 'writer-01')).body.lesson.id as string;
    const l2 = (await lesson(K, 'Writer: no exclamation marks ' + n++, 'writer-01')).body.lesson.id as string;
    expect((await B.req('POST', `/lessons/${l1}/decision`, { decision: 'accept', baseVersion: 0 })).status).toBe(200);
    expect((await B.req('POST', `/lessons/${l2}/decision`, { decision: 'accept', baseVersion: 1 })).status).toBe(200);
    expect((await B.req('POST', '/agents/writer-01/playbook/rollback', { toVersion: 1, baseVersion: 2, why: 'Too strict.' })).status).toBe(200);
    expect(await actions(A, 'lessons', l2)).toEqual(['proposed', 'accepted', 'withdrawn']);
    expect((await log(A, 'lessons', l2)).body.contributions[2]).toMatchObject({ action: 'withdrawn', version: 3, actor: bId });
    // restoring it (a different administrator, since the rollback may not put back a lesson its actor proposed)
    expect((await A.req('POST', '/agents/writer-01/playbook/rollback', { toVersion: 2, baseVersion: 3, why: 'Back again.' })).status).toBe(200);
    expect(await actions(A, 'lessons', l2)).toEqual(['proposed', 'accepted', 'withdrawn', 'restored']);
    expect(await actions(A, 'lessons', l1)).toEqual(['proposed', 'accepted']); // untouched by the rollbacks
  });

  it('skills: propose, approve, the previous version replaced, retire', async () => {
    const s1 = (await M.req('POST', '/skills', skillBody({ name: 'Versioned skill' }), key())).body.skill.id as string;
    expect(await actions(A, 'skills', s1)).toEqual(['proposed']);
    expect((await B.req('POST', `/skills/${s1}/approve`, {})).status).toBe(200);
    const s2 = (await K.req('POST', '/skills', skillBody({ name: 'Versioned skill' }), key())).body.skill.id as string;
    expect((await B.req('POST', `/skills/${s2}/approve`, {})).status).toBe(200);
    expect(await actions(A, 'skills', s1)).toEqual(['proposed', 'approved', 'replaced']);
    expect((await log(A, 'skills', s1)).body.contributions[2]).toMatchObject({ actor: bId, note: 'Replaced by version 2' });
    expect((await A.req('POST', `/skills/${s2}/retire`, { note: 'Not needed.' })).status).toBe(200);
    expect(await actions(A, 'skills', s2)).toEqual(['proposed', 'approved', 'retired']);
    expect((await log(A, 'skills', s2)).body.contributions[2]).toMatchObject({ action: 'retired', actor: aId, note: 'Not needed.' });
  });

  it('a refused decision writes no contribution line (the state did not change)', async () => {
    const l = (await lesson(M, 'Refused decisions leave no trace in the log ' + n++)).body.lesson.id as string;
    expect((await A.req('POST', `/lessons/${l}/decision`, { decision: 'accept', baseVersion: 99 })).status).toBe(409);
    expect((await M.req('POST', `/lessons/${l}/decision`, { decision: 'accept', baseVersion: 0 })).status).toBe(403);
    expect(await actions(A, 'lessons', l)).toEqual(['proposed']);
  });
});

describe('visibility follows the record', () => {
  it('a member sees the log of a lesson they can open, without notes; administrators see notes; an invisible or foreign record is 404', async () => {
    const mine = (await lesson(M, 'Visible to Mia only until accepted ' + n++)).body.lesson.id as string;
    expect((await log(M, 'lessons', mine)).status).toBe(200);
    expect((await log(K, 'lessons', mine)).status).toBe(404);
    expect((await B.req('POST', `/lessons/${mine}/decision`, { decision: 'accept', baseVersion: (await A.req('GET', '/agents/coder-01/playbook')).body.playbook.version, note: 'Private note' })).status).toBe(200);
    const asK = (await log(K, 'lessons', mine)).body.contributions as any[];
    expect(asK.map((c) => c.action)).toEqual(['proposed', 'accepted']);
    expect(asK.every((c) => c.note === null)).toBe(true);
    expect(asK[0].sources).toEqual([{ kind: 'review', id: '', hidden: true, verified: false }]); // a non-owner member never gets source ids
    expect(((await log(A, 'lessons', mine)).body.contributions as any[])[1].note).toBe('Private note');
    const draft = (await M.req('POST', '/skills', skillBody(), key())).body.skill.id as string;
    expect((await log(K, 'skills', draft)).status).toBe(404);
    expect((await log(M, 'skills', draft)).status).toBe(200);
    for (const [kind, id] of [['lessons', 'LC-NOPE'], ['skills', 'SK-NOPE']] as const) expect((await log(A, kind, id)).status).toBe(404);
    await q(`insert into tenants(id,name) values ('t-2','Other') on conflict do nothing`);
    await q(`insert into record_contributions(tenant_id,record_kind,record_id,action,actor,actor_kind,origin_channel,origin_class) values ('t-2','lesson','LC-T2','proposed','u','human','human_entry','human')`);
    expect((await log(A, 'lessons', 'LC-T2')).status).toBe(404);
  });
});

describe('append-only: all four guards', () => {
  it('UPDATE, DELETE and TRUNCATE are refused; the purge flag lets a demo purge delete only; the timestamp is the database clock', async () => {
    const l = (await lesson(M, 'Guarded log ' + n++)).body.lesson.id as string;
    expect((await q('select count(*)::int n from record_contributions where record_id=$1', [l]))[0].n).toBe(1);
    await expect(t.pool.query(`update record_contributions set note='x'`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`update record_contributions set action='accepted' where record_id=$1`, [l])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from record_contributions where record_id=$1`, [l])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate record_contributions`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate record_contributions cascade`)).rejects.toThrow(/append-only/);
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query(`set local axion.purge_demo = 'on'`);
      expect((await c.query('delete from record_contributions where record_id=$1', [l])).rowCount).toBe(1);
      await expect(c.query('truncate record_contributions')).rejects.toThrow(/append-only/); // the exception covers DELETE only
      await c.query('rollback');
    } finally { c.release(); }
    expect((await q('select count(*)::int n from record_contributions where record_id=$1', [l]))[0].n).toBe(1);
    // the clock: a line inserted without a time gets now() of the database, and the column has no app-side value
    const r = (await q(`insert into record_contributions(tenant_id,record_kind,record_id,action,actor,actor_kind,origin_channel,origin_class) values ('t-1','lesson','LC-CLK','proposed','u','human','human_entry','human') returning at = now() as same`))[0];
    expect(typeof r.same).toBe('boolean');
    expect((await q(`select (at <= now() and at > now() - interval '1 minute') as ok from record_contributions where record_id='LC-CLK'`))[0].ok).toBe(true);
    // a line cannot name an action or a channel that does not exist
    await expect(t.pool.query(`insert into record_contributions(tenant_id,record_kind,record_id,action,actor,actor_kind,origin_channel,origin_class) values ('t-1','lesson','x','invented','u','human','human_entry','human')`)).rejects.toThrow();
  });

  it('clearDemo still works with contribution lines present, and leaves them alone', async () => {
    await seedDemo(t.app.db, 't-1', aId);
    const before = (await q('select count(*)::int n from record_contributions'))[0].n;
    expect(before).toBeGreaterThan(0);
    await expect(clearDemo(t.app.db, 't-1')).resolves.toBeTruthy();
    expect((await q('select count(*)::int n from record_contributions'))[0].n).toBe(before);
  });
});
