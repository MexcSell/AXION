import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { stallCheck, STALL_POLICY, diffLedgers, type ProgressBody, type TaskBody } from '../../shared/contracts/src/ledgers.ts';

// Improvement cycle 39 (Phase 2, O1): mission ledgers after Magentic-One (arXiv 2411.04468).

const P = (o: Partial<ProgressBody> = {}): ProgressBody => ({ satisfied: false, looping: false, progressing: true, notes: '', stall: 0, ...o });
const GOOD = P({ progressing: true });
const NOPE = P({ progressing: false });
const LOOP = P({ progressing: false, looping: true });

describe('stallCheck (pure, known answers)', () => {
  it('the policy is frozen: 3 non-progressing entries in a row, or 2 looping entries in a row', () => {
    expect(STALL_POLICY).toEqual({ nonProgressing: 3, loopingInARow: 2 });
    expect(Object.isFrozen(STALL_POLICY)).toBe(true);
    expect(() => { (STALL_POLICY as { nonProgressing: number }).nonProgressing = 1; }).toThrow();
  });
  it('empty and healthy histories are not stalled', () => {
    expect(stallCheck([])).toEqual({ stalled: false, counter: 0, reason: null });
    expect(stallCheck([GOOD, GOOD, GOOD])).toEqual({ stalled: false, counter: 0, reason: null });
  });
  it('counts only the trailing run and resets when progress is made', () => {
    expect(stallCheck([NOPE, NOPE, GOOD])).toMatchObject({ stalled: false, counter: 0 });
    expect(stallCheck([GOOD, NOPE])).toMatchObject({ stalled: false, counter: 1 });
    expect(stallCheck([GOOD, NOPE, NOPE])).toMatchObject({ stalled: false, counter: 2 });
    expect(stallCheck([GOOD, NOPE, NOPE, GOOD, NOPE, NOPE])).toMatchObject({ stalled: false, counter: 2 });
  });
  it('flags stalled at exactly N consecutive non-progressing entries', () => {
    expect(stallCheck([GOOD, NOPE, NOPE, NOPE])).toEqual({ stalled: true, counter: 3, reason: 'no-progress' });
    expect(stallCheck([NOPE, NOPE, NOPE, NOPE, NOPE])).toEqual({ stalled: true, counter: 5, reason: 'no-progress' });
  });
  it('looping twice in a row stalls, once does not', () => {
    expect(stallCheck([GOOD, LOOP])).toEqual({ stalled: false, counter: 1, reason: null });
    expect(stallCheck([GOOD, LOOP, LOOP])).toEqual({ stalled: true, counter: 2, reason: 'looping' });
    expect(stallCheck([LOOP, GOOD, LOOP])).toMatchObject({ stalled: false });
    expect(stallCheck([LOOP, NOPE, LOOP])).toMatchObject({ stalled: true, counter: 3 }); // loops not adjacent, but three non-progressing entries
    expect(stallCheck([LOOP, NOPE, LOOP]).reason).toBe('no-progress');
  });
  it('an entry that says progressing but also looping still counts as non-progressing', () => {
    expect(stallCheck([P({ progressing: true, looping: true })]).counter).toBe(1);
  });
  it('a satisfied latest entry ends the stall', () => {
    expect(stallCheck([NOPE, NOPE, NOPE, P({ satisfied: true, progressing: false })])).toEqual({ stalled: false, counter: 0, reason: null });
  });
});

const T = (o: Partial<TaskBody> = {}): TaskBody => ({
  facts: { given: [{ text: 'Budget is 5k' }], to_look_up: [], to_derive: [], guesses: [{ text: 'Vendor A is cheaper' }] },
  steps: [{ id: 's1', text: 'Collect quotes', status: 'todo' }, { id: 's2', text: 'Compare', owner: 'analyst-01', status: 'todo' }],
  ...o,
});
describe('diffLedgers (pure)', () => {
  it('lists added, removed and changed task entries', () => {
    const b = T({ facts: { given: [{ text: 'Budget is 5k' }, { text: 'Deadline Friday' }], to_look_up: [], to_derive: [], guesses: [] }, steps: [{ id: 's1', text: 'Collect quotes', status: 'done' }, { id: 's3', text: 'Decide', status: 'todo' }] });
    const d = diffLedgers('task', T(), b);
    expect(d).toContainEqual({ change: 'added', label: 'Given facts', to: 'Deadline Friday' });
    expect(d).toContainEqual({ change: 'removed', label: 'Guesses', from: 'Vendor A is cheaper' });
    expect(d).toContainEqual({ change: 'changed', label: 'Step s1 status', from: 'todo', to: 'done' });
    expect(d).toContainEqual({ change: 'removed', label: 'Step s2', from: 'Compare' });
    expect(d).toContainEqual({ change: 'added', label: 'Step s3', to: 'Decide' });
  });
  it('lists changed progress flags; identical bodies give an empty diff', () => {
    expect(diffLedgers('progress', P(), P())).toEqual([]);
    const d = diffLedgers('progress', P(), P({ looping: true, progressing: false, notes: 'stuck', stall: 1 }));
    expect(d).toContainEqual({ change: 'changed', label: 'Looping', from: 'no', to: 'yes' });
    expect(d).toContainEqual({ change: 'changed', label: 'Making progress', from: 'yes', to: 'no' });
    expect(d).toContainEqual({ change: 'changed', label: 'Notes', from: '', to: 'stuck' });
  });
});

let t: TestApp;
let A: Browser, M: Browser, O: Browser;
let adminId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'l' + n++ });
let mId = ''; // a shared mission owned by Olga
let pId = ''; // a private mission owned by Olga
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const post = (b: Browser, id: string, kind: string, baseVersion: number, body: unknown) => b.req('POST', `/missions/${id}/ledgers/${kind}`, { baseVersion, body });
const taskBody = (text = 'Budget is 5k') => ({ facts: { given: [{ text }], to_look_up: [], to_derive: [], guesses: [] }, steps: [{ id: 's1', text: 'Collect quotes', status: 'todo' }] });
const progBody = (o: Record<string, unknown> = {}) => ({ satisfied: false, looping: false, progressing: true, notes: '', ...o });

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { messages: { max: 1000, windowMs: 60_000 }, proposals: { max: 1000, windowMs: 60_000 }, uploads: { max: 1000, windowMs: 60_000 }, ledgers: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  M = (await w.member('Mia')).b;
  O = (await w.member('Olga')).b;
  mId = (await O.req('POST', '/missions', { text: 'Research three competitor websites and report pricing.', files: [], shared: true }, key())).body.mission.id;
  pId = (await O.req('POST', '/missions', { text: 'Private mission of Olga about taxes.', files: [], shared: false }, key())).body.mission.id;
});
afterAll(async () => { await t.close(); });

describe('read', () => {
  it('a fresh mission has no ledgers; versions empty; anonymous gets 401', async () => {
    const r = await M.req('GET', `/missions/${mId}/ledgers`);
    expect(r.status).toBe(200);
    expect(r.body.ledgers).toEqual({ task: null, progress: null });
    expect(r.body.versions).toEqual({ task: [], progress: [] });
    expect(r.body.stall).toEqual({ stalled: false, counter: 0, reason: null });
    expect(r.body.canEdit).toBe(false);
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/missions/${mId}/ledgers` })).statusCode).toBe(401);
    expect((await O.req('GET', `/missions/${mId}/ledgers`)).body.canEdit).toBe(true);
  });
  it('unknown kind or version is 404', async () => {
    expect((await M.req('GET', `/missions/${mId}/ledgers/other/1`)).status).toBe(404);
    expect((await M.req('GET', `/missions/${mId}/ledgers/task/1`)).status).toBe(404);
    expect((await M.req('GET', `/missions/${mId}/ledgers/task/abc`)).status).toBe(404);
  });
});

describe('write', () => {
  it('the owner writes v1, v2; GET returns the latest of each kind and the version list', async () => {
    const r1 = await post(O, mId, 'task', 0, taskBody());
    expect(r1.status).toBe(201);
    expect(r1.body.ledger).toMatchObject({ kind: 'task', version: 1, authorKind: 'human', demo: false });
    const r2 = await post(O, mId, 'task', 1, taskBody('Budget is 6k'));
    expect(r2.body.ledger.version).toBe(2);
    const p1 = await post(A, mId, 'progress', 0, progBody());
    expect(p1.status).toBe(201);
    expect(p1.body.ledger.body.stall).toBe(0); // the server computes the stall counter
    const g = (await M.req('GET', `/missions/${mId}/ledgers`)).body;
    expect(g.ledgers.task.version).toBe(2);
    expect(g.ledgers.task.body.facts.given[0].text).toBe('Budget is 6k');
    expect(g.ledgers.progress.version).toBe(1);
    expect(g.versions.task.map((v: any) => v.version)).toEqual([2, 1]);
    expect(g.versions.task[0]).toMatchObject({ authorName: 'Olga', authorKind: 'human', demo: false });
    const one = (await M.req('GET', `/missions/${mId}/ledgers/task/1`)).body.ledger;
    expect(one.body.facts.given[0].text).toBe('Budget is 5k');
  });

  it('a stale baseVersion is 409 and nothing is stored', async () => {
    const before = (await rows(`select count(*)::int n from mission_ledgers where mission_id=$1`, [mId]))[0].n;
    const r = await post(O, mId, 'task', 1, taskBody('late'));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('LEDGER_CONFLICT');
    expect((await rows(`select count(*)::int n from mission_ledgers where mission_id=$1`, [mId]))[0].n).toBe(before);
    expect((await post(O, mId, 'task', 5, taskBody())).status).toBe(409); // ahead of the server is also a conflict
  });

  it('an invalid body is 400 with the paths of the faults; nothing is stored', async () => {
    const bad = await post(O, mId, 'task', 2, { facts: { given: [{ text: '' }], to_look_up: [], to_derive: [], guesses: [], extra: 1 }, steps: [{ id: 'S 1', text: 'x', status: 'nope' }] });
    expect(bad.status).toBe(400);
    const fe = Object.keys(bad.body.fieldErrors);
    expect(fe).toEqual(expect.arrayContaining(['body.facts.given.0.text', 'body.steps.0.id', 'body.steps.0.status']));
    expect(fe.some((k) => k.startsWith('body.facts'))).toBe(true);
    expect((await post(O, mId, 'progress', 1, { ...progBody(), stall: 9 })).status).toBe(400); // the stall counter is the server's
    expect((await post(O, mId, 'progress', 1, { looping: false })).status).toBe(400);
    expect((await post(O, mId, 'task', 2, { ...taskBody(), steps: [{ id: 's1', text: 'a', status: 'todo' }, { id: 's1', text: 'b', status: 'todo' }] })).status).toBe(400); // duplicate step ids
    expect((await O.req('POST', `/missions/${mId}/ledgers/task`, { body: taskBody() })).status).toBe(400); // baseVersion required
    expect((await O.req('POST', `/missions/${mId}/ledgers/task`, { baseVersion: 2, body: taskBody(), extra: 1 })).status).toBe(400);
    expect((await O.req('POST', `/missions/${mId}/ledgers/oops`, { baseVersion: 0, body: {} })).status).toBe(404);
    const big = Array.from({ length: 31 }, (_, i) => ({ text: 'f' + i }));
    expect((await post(O, mId, 'task', 2, { ...taskBody(), facts: { given: big, to_look_up: [], to_derive: [], guesses: [] } })).status).toBe(400);
    expect((await post(O, mId, 'task', 2, taskBody('x'.repeat(401)))).status).toBe(400);
    expect((await rows(`select count(*)::int n from mission_ledgers where mission_id=$1 and kind='task'`, [mId]))[0].n).toBe(2);
  });

  it('an invisible mission is 404 for read and write; a missing one too; a visible one the caller does not manage is 403', async () => {
    expect((await M.req('GET', `/missions/${pId}/ledgers`)).status).toBe(404);
    expect((await M.req('GET', `/missions/${pId}/ledgers/task/1`)).status).toBe(404);
    expect((await post(M, pId, 'task', 0, taskBody())).status).toBe(404);
    expect((await M.req('GET', `/missions/M-99999/ledgers`)).status).toBe(404);
    expect((await M.req('GET', `/missions/nope/ledgers`)).status).toBe(404);
    expect((await post(M, mId, 'task', 2, taskBody())).status).toBe(403); // sees the shared mission, does not own it
    expect((await rows(`select count(*)::int n from mission_ledgers where mission_id=$1`, [pId]))[0].n).toBe(0);
    expect((await A.req('GET', `/missions/${pId}/ledgers`)).status).toBe(200); // admin sees all
  });

  it('writes are audited and emit ledger.updated to the mission audience', async () => {
    const a = await rows(`select actor, subject, detail from audit_events where action='mission.ledger' and subject=$1 order by id`, [mId]);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a[0].detail).toMatchObject({ kind: 'task', version: 1 });
    const ev = await rows(`select type, mission_id, payload from events where type='ledger.updated' and mission_id=$1 order by seq`, [mId]);
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(ev[0].payload).toMatchObject({ kind: 'task', version: 1 });
  });

  it('progress writes keep a server-side stall counter; three non-progressing entries stall the mission', async () => {
    const id = (await O.req('POST', '/missions', { text: 'Stall me please.', files: [], shared: true }, key())).body.mission.id;
    expect((await post(O, id, 'progress', 0, progBody())).body.ledger.body.stall).toBe(0);
    expect((await post(O, id, 'progress', 1, progBody({ progressing: false }))).body.ledger.body.stall).toBe(1);
    expect((await post(O, id, 'progress', 2, progBody({ progressing: false }))).body.ledger.body.stall).toBe(2);
    expect((await M.req('GET', `/missions/${id}/ledgers`)).body.stall.stalled).toBe(false);
    const r = await post(O, id, 'progress', 3, progBody({ progressing: false }));
    expect(r.body.ledger.body.stall).toBe(3);
    const g = (await M.req('GET', `/missions/${id}/ledgers`)).body;
    expect(g.stall).toEqual({ stalled: true, counter: 3, reason: 'no-progress' });
    expect(g.policy).toEqual({ nonProgressing: 3, loopingInARow: 2 });
  });

  it('an archived mission takes no ledger edits', async () => {
    const id = (await O.req('POST', '/missions', { text: 'To be archived soon.', files: [], shared: false }, key())).body.mission.id;
    await O.req('POST', `/missions/${id}/actions/archive`, { cancelFirst: true }, key());
    expect((await post(O, id, 'task', 0, taskBody())).status).toBe(409);
  });
});

describe('concurrency', () => {
  it('10 concurrent writers that retry on conflict get versions 1..10, gap-free and unique', async () => {
    const id = (await O.req('POST', '/missions', { text: 'Concurrent ledger writers.', files: [], shared: true }, key())).body.mission.id;
    const writer = async (i: number) => {
      for (let tries = 0; tries < 40; tries++) {
        const cur = (await O.req('GET', `/missions/${id}/ledgers`)).body.ledgers.task?.version ?? 0;
        const r = await post(O, id, 'task', cur, taskBody('writer ' + i));
        if (r.status === 201) return r.body.ledger.version as number;
        if (r.status !== 409) throw new Error('unexpected ' + r.status + JSON.stringify(r.body));
      }
      throw new Error('never got in');
    };
    const got = await Promise.all(Array.from({ length: 10 }, (_, i) => writer(i)));
    expect([...got].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await rows(`select version from mission_ledgers where mission_id=$1 and kind='task' order by version`, [id])).map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it('10 writers on the same baseVersion: exactly one wins, nine get 409', async () => {
    const id = (await O.req('POST', '/missions', { text: 'Same base ledger writers.', files: [], shared: true }, key())).body.mission.id;
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => post(O, id, 'progress', 0, progBody({ notes: 'w' + i }))));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    expect((await rows(`select version from mission_ledgers where mission_id=$1`, [id])).map((r) => r.version)).toEqual([1]);
  });
});

describe('append-only', () => {
  it('update, delete and truncate are refused by the database', async () => {
    await expect(t.pool.query(`update mission_ledgers set version = version + 10 where mission_id=$1`, [mId])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`update mission_ledgers set body = '{}'::jsonb where mission_id=$1`, [mId])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from mission_ledgers where mission_id=$1`, [mId])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate mission_ledgers`)).rejects.toThrow(/append-only/);
  });
  it('the table rejects a duplicate version, a bad kind and a body that is not an object', async () => {
    const base = (await rows(`select tenant_id from missions where id=$1`, [mId]))[0].tenant_id;
    const ins = (kind: string, version: number, body: string) => t.pool.query(
      `insert into mission_ledgers(tenant_id, mission_id, kind, version, body, author_id, author_kind) values ($1,$2,$3,$4,$5::jsonb,'u','human')`, [base, mId, kind, version, body]);
    await expect(ins('task', 1, '{}')).rejects.toThrow(/duplicate|unique/);
    await expect(ins('other', 9, '{}')).rejects.toThrow(/check/);
    await expect(ins('task', 9, '[]')).rejects.toThrow(/check/);
    await expect(ins('task', 0, '{}')).rejects.toThrow(/check/);
  });
});

describe('demo samples and clearDemo', () => {
  it('seedDemo adds clearly flagged sample ledgers to demo missions only; clearDemo removes them and keeps real ledgers', async () => {
    const w = await makeTestApp({ staffingStepMs: 3_600_000 });
    try {
      const B = await withAdmin(w.app);
      const real = (await B.admin.req('POST', '/missions', { text: 'A real mission.', files: [], shared: false }, { 'idempotency-key': 'real-l' })).body.mission.id;
      expect((await post(B.admin, real, 'task', 0, taskBody())).status).toBe(201);
      await seedDemo(w.app.db, 't-1', B.adminId);
      const demoRows = (await w.pool.query(`select l.demo, l.author_kind, l.mission_id, m.demo as mdemo from mission_ledgers l join missions m on m.id = l.mission_id`)).rows;
      expect(demoRows.filter((r) => r.demo).length).toBeGreaterThan(0);
      expect(demoRows.filter((r) => r.demo).every((r) => r.mdemo && r.author_kind === 'system')).toBe(true);
      expect(demoRows.filter((r) => !r.demo).map((r) => r.mission_id)).toEqual([real]);
      const dm = demoRows.find((r) => r.demo)!.mission_id;
      const g = (await B.admin.req('GET', `/missions/${dm}/ledgers`)).body;
      expect(g.ledgers.task.demo).toBe(true);
      expect(JSON.stringify(g.ledgers.task.body)).toMatch(/DEMO/);
      expect(g.ledgers.progress.demo).toBe(true);
      expect((await seedDemo(w.app.db, 't-1', B.adminId)).missions).toBe(0); // idempotent: no second sample set
      await clearDemo(w.app.db, 't-1');
      expect((await w.pool.query(`select count(*)::int n from mission_ledgers where demo`)).rows[0].n).toBe(0);
      expect((await w.pool.query(`select count(*)::int n from mission_ledgers`)).rows[0].n).toBe(1);
    } finally { await w.close(); }
  });
});

describe('rate limit', () => {
  it('ledger writes have their own bucket: 429 after the limit, nothing stored for the refused ones, and proposals are not starved', async () => {
    const w = await makeTestApp({ staffingStepMs: 3_600_000, writeLimits: { messages: { max: 100, windowMs: 60_000 }, proposals: { max: 100, windowMs: 60_000 }, uploads: { max: 100, windowMs: 60_000 }, ledgers: { max: 3, windowMs: 60_000 } } });
    try {
      const B = await withAdmin(w.app);
      const id = (await B.admin.req('POST', '/missions', { text: 'Rate limited ledger.', files: [], shared: false }, { 'idempotency-key': 'rl-1' })).body.mission.id;
      const st: number[] = [];
      for (let i = 0; i < 5; i++) st.push((await post(B.admin, id, 'progress', i, progBody())).status);
      expect(st).toEqual([201, 201, 201, 429, 429]);
      expect((await w.pool.query(`select count(*)::int n from mission_ledgers where mission_id=$1`, [id])).rows[0].n).toBe(3);
      expect((await B.admin.req('POST', '/agents/no-such-agent/version-proposals', {})).status).not.toBe(429);
    } finally { await w.close(); }
  });
});

describe('fix round: size, pagination, cap, lock order', () => {
  const grp = (n: number, chars: number) => Array.from({ length: n }, (_, i) => ({ text: '€'.repeat(chars) + i }));
  const multi = (n: number, chars: number) => ({ facts: { given: grp(n, chars), to_look_up: grp(n, chars), to_derive: grp(n, chars), guesses: grp(n, chars) }, steps: [] });
  it('I1: a maximal multi-byte body is 400 with a path (never 500); one just under the cap is saved', async () => {
    const id = (await O.req('POST', '/missions', { text: 'Size limits of ledger bodies.', files: [], shared: true }, key())).body.mission.id;
    const big = { facts: { given: Array.from({ length: 30 }, (_, i) => ({ text: '€'.repeat(399) + i % 10, source: '€'.repeat(199) })), to_look_up: Array.from({ length: 30 }, () => ({ text: '€'.repeat(400) })), to_derive: Array.from({ length: 30 }, () => ({ text: '€'.repeat(400) })), guesses: Array.from({ length: 30 }, () => ({ text: '€'.repeat(400) })) }, steps: [] };
    const r = await post(O, id, 'task', 0, big);
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.fieldErrors)).toContain('body');
    expect(r.body.fieldErrors.body).toMatch(/too large/i);
    const ok = await post(O, id, 'task', 0, multi(10, 374)); // about 45,000 bytes of 3-byte characters
    expect(ok.status).toBe(201);
    expect((await rows(`select pg_column_size(body)::int n from mission_ledgers where mission_id=$1`, [id]))[0].n).toBeLessThan(65536);
  });

  it('I2: version lists are keyset pages (newest first, at most 100) without bodies; 500 versions per kind is the cap', async () => {
    const id = (await O.req('POST', '/missions', { text: 'Many ledger versions.', files: [], shared: true }, key())).body.mission.id;
    const tenant = (await rows(`select tenant_id from missions where id=$1`, [id]))[0].tenant_id;
    await t.pool.query(`insert into mission_ledgers(tenant_id, mission_id, kind, version, body, author_id, author_kind)
      select $1, $2, 'progress', v, '{"satisfied":false,"looping":false,"progressing":true,"notes":"","stall":0}'::jsonb, 'u', 'human' from generate_series(1, 500) v`, [tenant, id]);
    const g = (await M.req('GET', `/missions/${id}/ledgers`)).body;
    expect(g.versions.progress).toHaveLength(100);
    expect(g.versions.progress[0].version).toBe(500);
    expect(g.versions.progress[99].version).toBe(401);
    expect(g.versions.progress[0].body).toBeUndefined();
    expect(g.moreVersions).toEqual({ task: null, progress: 401 });
    const seen: number[] = g.versions.progress.map((v: any) => v.version);
    let cursor: number | null = g.moreVersions.progress;
    while (cursor) {
      const pg = (await M.req('GET', `/missions/${id}/ledgers/progress/versions?before=${cursor}&limit=100`)).body;
      expect(pg.versions.length).toBeLessThanOrEqual(100);
      seen.push(...pg.versions.map((v: any) => v.version));
      cursor = pg.next;
    }
    expect(seen).toEqual(Array.from({ length: 500 }, (_, i) => 500 - i));
    expect((await M.req('GET', `/missions/${id}/ledgers/progress/versions?limit=1000`)).body.versions.length).toBeLessThanOrEqual(100);
    expect((await M.req('GET', `/missions/${id}/ledgers/progress/versions?before=abc`)).status).toBe(400);
    expect((await M.req('GET', `/missions/${pId}/ledgers/progress/versions`)).status).toBe(404);
    const capped = await post(O, id, 'progress', 500, progBody());
    expect(capped.status).toBe(409);
    expect(capped.body.code).toBe('LEDGER_VERSION_CAP');
    expect(capped.body.message).toMatch(/500/);
    expect((await post(O, id, 'task', 0, taskBody())).status).toBe(201); // the cap is per kind
  });

  it('M2/M3: a malformed request and a refused caller never block a writer (validation first, lock after the permission check)', async () => {
    const id = (await O.req('POST', '/missions', { text: 'Lock order for ledgers.', files: [], shared: true }, key())).body.mission.id;
    expect((await post(M, id, 'task', 0, { nonsense: true })).status).toBe(400); // validated before any lock or permission work
    expect((await post(M, id, 'task', 0, taskBody())).status).toBe(403);
    expect((await post(M, pId, 'task', 0, taskBody())).status).toBe(404);
    expect((await post(O, id, 'task', 0, taskBody())).status).toBe(201);
  });
});
