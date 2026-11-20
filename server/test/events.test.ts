import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, Browser, openStream, makeSchema, TEST_DB, type TestApp } from './helpers.ts';
import { buildApp } from '../src/app.ts';
import { appendEvent } from '../src/events/log.ts';
import { tx } from '../src/db.ts';

let t: TestApp;
let base: string;
let A: Awaited<ReturnType<typeof withAdmin>>;
let mina: { b: Browser; id: string };
let kenji: { b: Browser; id: string };
const streams: { close: () => void }[] = [];
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  await t.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = t.app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  A = await withAdmin(t.app);
  mina = await A.member('Mina');
  kenji = await A.member('Kenji');
});
afterEach(async () => { streams.splice(0).forEach((s) => s.close()); await t.close(); });

let n = 0;
const create = (b: Browser, body: Record<string, unknown> = {}) => b.req('POST', '/missions', { text: 'Clean the product catalog data.', files: [], shared: false, ...body }, { 'idempotency-key': 'k' + Date.now() + n++ });

describe('event stream', () => {
  it('needs a session', async () => {
    const s = await openStream(base, new Browser(t.app));
    expect(s.status).toBe(401);
  });

  it("B never receives events about A's private mission, and does once it is shared", async () => {
    const sb = await openStream(base, kenji.b); streams.push(sb);
    const sa = await openStream(base, mina.b); streams.push(sa);
    expect(await sb.waitFor((e) => e.event === 'hello')).toBeTruthy();
    const m = (await create(mina.b)).body.mission;
    expect(await sa.waitFor((e) => e.event === 'mission.created' && e.data.subject.id === m.id)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(sb.events.some((e) => e.data?.subject?.id === m.id)).toBe(false);
    await mina.b.req('POST', `/missions/${m.id}/share`, { shared: true });
    expect(await sb.waitFor((e) => e.event === 'mission.shared' && e.data.subject.id === m.id)).toBeTruthy();
    await mina.b.req('POST', `/missions/${m.id}/actions/pause`, {}, { 'idempotency-key': 'p' + n++ });
    const ev = await sb.waitFor((e) => e.event === 'mission.stateChanged' && e.data.subject.id === m.id);
    expect(ev?.data.payload.to).toBe('paused');
    expect(ev?.data).toMatchObject({ tenantId: 't-1', actor: { kind: 'human', id: mina.id }, schemaVersion: 1 });
    expect(typeof ev?.data.seq).toBe('number');
  });

  it('un-sharing tells the other user (so the UI can leave the mission) and then stops their events', async () => {
    const m = (await create(mina.b, { shared: true })).body.mission;
    const sb = await openStream(base, kenji.b); streams.push(sb);
    await sb.waitFor((e) => e.event === 'hello');
    await mina.b.req('POST', `/missions/${m.id}/share`, { shared: false });
    const ev = await sb.waitFor((e) => e.event === 'mission.shared');
    expect(ev?.data.payload).toEqual({ shared: false });
    await mina.b.req('POST', `/missions/${m.id}/actions/pause`, {}, { 'idempotency-key': 'p' + n++ });
    await new Promise((r) => setTimeout(r, 300));
    expect(sb.events.some((e) => e.event === 'mission.stateChanged')).toBe(false);
  });

  it('Last-Event-ID replays exactly the missed events, in order, without duplicates', async () => {
    const sa = await openStream(base, mina.b); streams.push(sa);
    const hello = await sa.waitFor((e) => e.event === 'hello');
    const m = (await create(mina.b)).body.mission;
    const first = await sa.waitFor((e) => e.event === 'mission.created');
    sa.close();
    for (const a of ['pause', 'resume', 'pause']) await mina.b.req('POST', `/missions/${m.id}/actions/${a}`, {}, { 'idempotency-key': a + n++ });
    const again = await openStream(base, mina.b, first!.id); streams.push(again);
    await again.waitFor((e) => e.event === 'mission.stateChanged' && e.data.payload.to === 'paused' && e.data.payload.from === 'running');
    await new Promise((r) => setTimeout(r, 200));
    const got = again.events.filter((e) => e.event.startsWith('mission.'));
    expect(got.map((e) => e.data.payload.to)).toEqual(['paused', 'running', 'paused']);
    const ids = got.map((e) => Number(e.id));
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBeGreaterThan(Number(first!.id));
    expect(hello?.data.cursor).toBeTypeOf('string');
  });

  it("a revoked session's stream ends within 1 s", async () => {
    const sb = await openStream(base, kenji.b); streams.push(sb);
    await sb.waitFor((e) => e.event === 'hello');
    await A.admin.req('PATCH', `/users/${kenji.id}`, { status: 'disabled' });
    const t0 = Date.now();
    while (!sb.isEnded() && Date.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 25));
    expect(sb.isEnded()).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(sb.events.some((e) => e.event === 'auth' && e.data.code === 'SESSION_REVOKED')).toBe(true);
  });

  it('admin-only events (new user waiting) reach admins only', async () => {
    const sa = await openStream(base, A.admin); streams.push(sa);
    const sm = await openStream(base, mina.b); streams.push(sm);
    await sa.waitFor((e) => e.event === 'hello'); await sm.waitFor((e) => e.event === 'hello');
    await new Browser(t.app).connect('Tomo', 'tomopass');
    expect(await sa.waitFor((e) => e.event === 'user.requested')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 200));
    expect(sm.events.some((e) => e.event === 'user.requested')).toBe(false);
  });
});

describe('event log', () => {
  it('a restarted app on the same database keeps the history', async () => {
    const m = (await create(mina.b)).body.mission;
    const app2 = await buildApp({ databaseUrl: TEST_DB(), schema: t.schema, logger: false });
    const rows = (await app2.db.query('select type from events where mission_id=$1 order by id', [m.id])).rows.map((r) => r.type);
    expect(rows).toContain('mission.created');
    await app2.close();
  });

  it('is append-only', async () => {
    await create(mina.b);
    await expect(t.pool.query(`update events set type='x'`)).rejects.toThrow(/append-only/);
  });

  it('ids commit in order: a later append waits for an earlier open transaction', async () => {
    const s = await makeSchema();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let firstId = 0;
    const t1 = tx(s.pool, async (c) => { firstId = Number((await appendEvent(c, { tenantId: 't-1', type: 'x.one', subject: { kind: 'test', id: '1' } })).id); await held; });
    await new Promise((r) => setTimeout(r, 100));
    let secondDone = false;
    const t2 = tx(s.pool, async (c) => appendEvent(c, { tenantId: 't-1', type: 'x.two', subject: { kind: 'test', id: '2' } })).then((e) => { secondDone = true; return e; });
    await new Promise((r) => setTimeout(r, 200));
    expect(secondDone).toBe(false);
    release();
    await t1;
    const second = await t2;
    expect(Number(second.id)).toBeGreaterThan(firstId);
    await s.drop();
  });

  it('seq increases per mission', async () => {
    const m = (await create(mina.b)).body.mission;
    await mina.b.req('POST', `/missions/${m.id}/actions/pause`, {}, { 'idempotency-key': 'q' + n++ });
    const seqs = (await t.pool.query('select seq from events where mission_id=$1 order by id', [m.id])).rows.map((r) => r.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });
});
