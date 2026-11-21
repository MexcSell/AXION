import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, openStream, Browser, type TestApp } from './helpers.ts';
import { seedDemo } from '../src/seed/demo.ts';
import { backfillMissionControl } from '../src/instances/backfill.ts';
import { tx } from '../src/db.ts';
import { MISSIONS, getMissionControl } from '../../web/src/data/missions.ts';

let t: TestApp;
const streams: { close: () => void }[] = [];
afterEach(async () => { streams.splice(0).forEach((s) => s.close()); await t.close(); });
let n = 0;
const key = () => ({ 'idempotency-key': 'c' + Date.now() + '-' + n++ });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await rows(sql, p))[0].n as number;
async function until(f: () => Promise<boolean>, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await sleep(30); } return false; }

type Adm = Awaited<ReturnType<typeof withAdmin>>;
async function realMission(b: Browser, shared = false) {
  const m = (await b.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared }, key())).body.mission;
  await until(async () => (await b.req('GET', `/missions/${m.id}`)).body.mission.staffing.stage === 'working');
  return m.id as string;
}
const humanThread = async (b: Browser, mid: string, instanceId: string) => {
  const r = await b.req('POST', `/missions/${mid}/threads`, { instanceId });
  expect(r.status).toBe(200);
  return r.body.threadId as string;
};
const send = (b: Browser, tid: string, body: Record<string, unknown>, h = key()) => b.req('POST', `/threads/${tid}/messages`, body, h);

async function setup(over: Record<string, unknown> = {}) {
  t = await makeTestApp({ staffingStepMs: 30, conversationSimMs: 30, ...over });
  return withAdmin(t.app);
}

describe('posting', () => {
  it('stores the human command with the session author; forged from/kind never become an agent message', async () => {
    const A: Adm = await setup();
    const mid = await realMission(A.admin);
    const tid = await humanThread(A.admin, mid, `${mid}:gm`);
    const ok = await send(A.admin, tid, { kind: 'command', text: 'Start with the hero section.', to: 'gm', from: 'gm', author: { kind: 'agent', id: 'gm' }, simulated: true });
    expect(ok.status).toBe(201);
    const m = ok.body.message;
    expect(m.from).toBe(`human:${A.adminId}`);
    expect(m.kind).toBe('command');
    expect(m.simulated).toBe(false);
    expect(m.status).toBe('queued');
    const stored = (await rows(`select * from messages where id=$1`, [m.id]))[0];
    expect(stored.author_kind).toBe('human'); expect(stored.author_id).toBe(A.adminId);
    for (const kind of ['report', 'ack', 'system', 'delegation', 'result', 'question', 'nope']) {
      const r = await send(A.admin, tid, { kind, text: 'x', to: 'gm', from: 'gm' });
      expect(r.status).toBe(422);
    }
    expect(await count(`select count(*)::int n from messages where author_kind='agent' and thread_id=$1`, [tid])).toBe(0);
  });

  it('validates: body max 8000, empty text, to must be a participant', async () => {
    const A = await setup();
    const mid = await realMission(A.admin);
    const tid = await humanThread(A.admin, mid, `${mid}:gm`);
    const big = await send(A.admin, tid, { kind: 'command', text: 'x'.repeat(8001), to: 'gm' });
    expect(big.status).toBe(422); expect(big.body.fieldErrors.text).toBeTruthy();
    expect((await send(A.admin, tid, { kind: 'command', text: 'x'.repeat(8000), to: 'gm' })).status).toBe(201);
    const empty = await send(A.admin, tid, { kind: 'command', text: '   ', to: 'gm' });
    expect(empty.status).toBe(422); expect(empty.body.fieldErrors.text).toBeTruthy();
    expect((await send(A.admin, tid, { kind: 'command', text: 'hi', to: 'coder-01' })).status).toBe(422);
    expect((await send(A.admin, tid, { kind: 'command', text: 'hi', to: 'human' })).status).toBe(422);
    expect((await send(A.admin, tid, { kind: 'reply', text: 'hi', to: `${mid}:gm` })).status).toBe(201); // instance id works too
  });

  it('Idempotency-Key replay returns the same message and stores one', async () => {
    const A = await setup();
    const mid = await realMission(A.admin);
    const tid = await humanThread(A.admin, mid, `${mid}:gm`);
    const h = { 'idempotency-key': 'same-key' };
    const a = await send(A.admin, tid, { kind: 'command', text: 'once', to: 'gm' }, h);
    const b = await send(A.admin, tid, { kind: 'command', text: 'once', to: 'gm' }, h);
    expect(b.status).toBe(a.status); expect(b.body.message.id).toBe(a.body.message.id);
    expect(await count(`select count(*)::int n from messages where thread_id=$1 and author_kind='human'`, [tid])).toBe(1);
    expect((await A.admin.req('POST', `/threads/${tid}/messages`, { kind: 'command', text: 'once', to: 'gm' })).status).toBe(400);
  });

  it('uploads: another user\'s upload is 404, an own upload is attached', async () => {
    const A = await setup();
    const mina = await A.member('Mina');
    const mid = await realMission(A.admin, true);
    const tid = await humanThread(mina.b, mid, `${mid}:gm`);
    await t.pool.query(`insert into uploads(id, tenant_id, owner_id, sha256, name, mime, kind, size) values ('f-aaaaaaaaaaaa','t-1',$1,'ab','a.png','image/png','image',412000), ('f-bbbbbbbbbbbb','t-1',$2,'cd','b.png','image/png','image',10)`, [A.adminId, mina.id]);
    expect((await send(mina.b, tid, { kind: 'command', text: 'see', to: 'gm', uploadIds: ['f-aaaaaaaaaaaa'] })).status).toBe(404);
    const ok = await send(mina.b, tid, { kind: 'command', text: '', to: 'gm', uploadIds: ['f-bbbbbbbbbbbb'] });
    expect(ok.status).toBe(201);
    expect(ok.body.message.attachments[0]).toMatchObject({ name: 'b.png', kind: 'image' });
    const list = await mina.b.req('GET', `/threads/${tid}/messages`);
    expect(list.body.messages.find((x: any) => x.id === ok.body.message.id).attachments).toHaveLength(1);
    expect(await count(`select count(*)::int n from messages where thread_id=$1`, [tid])).toBe(2); // command + note, the 404 stored nothing
  });
});

describe('visibility', () => {
  it('another tenant member of an unshared mission gets 404 everywhere', async () => {
    const A = await setup();
    const mina = await A.member('Mina');
    const mid = await realMission(A.admin);
    const own = await realMission(mina.b);
    const tid = await humanThread(A.admin, mid, `${mid}:gm`);
    expect((await mina.b.req('POST', `/missions/${mid}/threads`, { instanceId: `${mid}:gm` })).status).toBe(404);
    expect((await mina.b.req('GET', `/missions/${mid}/threads`)).status).toBe(404);
    expect((await mina.b.req('GET', `/threads/${tid}/messages`)).status).toBe(404);
    expect((await send(mina.b, tid, { kind: 'command', text: 'hi', to: 'gm' })).status).toBe(404);
    expect((await mina.b.req('GET', `/threads/nope/messages`)).status).toBe(404);
    expect((await mina.b.req('POST', `/missions/${own}/threads`, { instanceId: `${mid}:gm` })).status).toBe(404); // instance of another mission
  });

  it('un-sharing: the other user\'s next POST is 404 and their stream gets no further conversation events', async () => {
    const A = await setup();
    await t.app.listen({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
    const mina = await A.member('Mina');
    const mid = await realMission(A.admin, true);
    const tid = await humanThread(mina.b, mid, `${mid}:gm`);
    const s = await openStream(base, mina.b); streams.push(s);
    expect((await send(A.admin, tid, { kind: 'command', text: 'one', to: 'gm' })).status).toBe(201);
    expect(await s.waitFor((e) => e.event === 'conversation.messageCreated' && e.data.payload.threadId === tid)).toBeTruthy();
    await A.admin.req('POST', `/missions/${mid}/share`, { shared: false });
    await sleep(200);
    const before = s.events.filter((e) => e.event.startsWith('conversation.')).length;
    expect((await send(mina.b, tid, { kind: 'command', text: 'two', to: 'gm' })).status).toBe(404);
    expect((await send(A.admin, tid, { kind: 'command', text: 'three', to: 'gm' })).status).toBe(201);
    await sleep(400);
    expect(s.events.filter((e) => e.event.startsWith('conversation.')).length).toBe(before);
  });
});

describe('paging', () => {
  it('5,000 messages page exactly newest first with no duplicates; limit is capped at 200', async () => {
    const A = await setup();
    const mid = await realMission(A.admin);
    const tid = await humanThread(A.admin, mid, `${mid}:gm`);
    await t.pool.query(`insert into messages(thread_id, seq, author_kind, author_id, recipient, kind, body, simulated)
      select $1, g, 'human', $2, $3, 'command', 'm' || g, false from generate_series(1, 5000) g`, [tid, A.adminId, `${mid}:gm`]);
    const first = await A.admin.req('GET', `/threads/${tid}/messages`);
    expect(first.body.messages).toHaveLength(50);
    expect(first.body.messages[0].seq).toBe(5000);
    const seen = new Set<number>(first.body.messages.map((m: any) => m.seq));
    let before = first.body.messages[49].seq;
    let pages = 1;
    for (;;) {
      const r = await A.admin.req('GET', `/threads/${tid}/messages?before=${before}&limit=200`);
      expect(r.status).toBe(200);
      if (!r.body.messages.length) break;
      expect(r.body.messages.length).toBeLessThanOrEqual(200);
      for (const m of r.body.messages) { expect(seen.has(m.seq)).toBe(false); seen.add(m.seq); expect(m.seq).toBeLessThan(before); }
      expect(r.body.messages[0].seq).toBe(before - 1); // no gap, no jump
      before = r.body.messages[r.body.messages.length - 1].seq; pages++;
    }
    expect(seen.size).toBe(5000); expect(pages).toBe(1 + 25);
    expect((await A.admin.req('GET', `/threads/${tid}/messages?limit=999`)).body.messages).toHaveLength(200);
    expect((await A.admin.req('GET', `/threads/${tid}/messages?before=abc`)).status).toBe(422);
  });
});

describe('honest notes and simulation', () => {
  it('a real mission gets one honest system note per thread, queued receipt, no simulated rows, no agent reply', async () => {
    const A = await setup();
    const mid = await realMission(A.admin);
    const tid = await humanThread(A.admin, mid, `${mid}:gm`);
    await send(A.admin, tid, { kind: 'command', text: 'first', to: 'gm' });
    await send(A.admin, tid, { kind: 'command', text: 'second', to: 'gm' });
    await sleep(300);
    const msgs = await rows(`select * from messages where thread_id=$1 order by seq`, [tid]);
    const notes = msgs.filter((m) => m.author_kind === 'system');
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe('system'); expect(notes[0].simulated).toBe(false);
    expect(notes[0].body).toBe("Agents don't act yet — this message is stored and will be delivered when execution starts.");
    expect(msgs.map((m) => m.author_kind)).toEqual(['human', 'system', 'human']);
    expect(msgs.some((m) => m.simulated)).toBe(false);
    const rc = await rows(`select r.state from message_receipts r join messages m on m.id=r.message_id where m.thread_id=$1`, [tid]);
    expect(rc.map((r) => r.state)).toEqual(['queued', 'queued']);
    const list = (await A.admin.req('GET', `/threads/${tid}/messages`)).body.messages;
    expect(list.filter((m: any) => m.from === `human:${A.adminId}`).every((m: any) => m.status === 'queued')).toBe(true);
    expect(list.find((m: any) => m.kind === 'system').from).toBe('system');
    // a second thread gets its own note
    const other = (await rows(`select id, agent_id from agent_instances where mission_id=$1 and agent_id<>'gm' limit 1`, [mid]))[0];
    const t2 = await humanThread(A.admin, mid, other.id);
    expect((await send(A.admin, t2, { kind: 'command', text: 'hello', to: other.agent_id })).status).toBe(201);
    expect(await count(`select count(*)::int n from messages where thread_id=$1 and author_kind='system'`, [t2])).toBe(1);
    expect(await count(`select count(*)::int n from messages where thread_id=$1 and author_kind='system'`, [tid])).toBe(1);
  });

  it('a demo mission gets simulated receipts, an ack and a report to the manager, all simulated=true', async () => {
    const A = await setup();
    await seedDemo(t.app.db, 't-1', A.adminId);
    const demo = MISSIONS.find((m) => m.status === 'running' && getMissionControl(m).nodes.some((x) => x.parent))!;
    const node = getMissionControl(demo).nodes.find((x) => x.parent)!;
    const tid = await humanThread(A.admin, demo.id, node.instanceId);
    const before = await count(`select count(*)::int n from messages where thread_id=$1`, [tid]);
    const r = await send(A.admin, tid, { kind: 'command', text: 'Status please', to: node.agentId });
    expect(r.status).toBe(201);
    expect(r.body.message.simulated).toBe(false); // the human's own command is real
    const mgrAgent = getMissionControl(demo).nodes.find((x) => x.instanceId === node.parent)!.agentId;
    expect(await until(async () => (await count(`select count(*)::int n from messages where simulated and kind='report' and author_id=$1 and recipient=$2 and created_at > now() - interval '1 minute'`, [node.instanceId, node.parent!])) >= 1)).toBe(true);
    const states = (await rows(`select state from message_receipts where message_id=$1 order by id`, [r.body.message.id])).map((x) => x.state);
    expect(states).toEqual(['delivered', 'acknowledged']);
    const added = await rows(`select * from messages where thread_id=$1 and seq > $2 order by seq`, [tid, before + 1]);
    expect(added.map((m) => [m.author_kind, m.kind, m.simulated])).toEqual([['agent', 'ack', true]]);
    expect(await count(`select count(*)::int n from messages where thread_id=$1 and author_kind='system'`, [tid])).toBe(0); // no honest note on demo
    const up = (await rows(`select m.* from messages m join conversation_threads c on c.id=m.thread_id where m.simulated and m.kind='report' and m.author_id=$1 and m.recipient=$2 order by m.id desc limit 1`, [node.instanceId, node.parent!]))[0];
    expect(up).toBeTruthy();
    const dto = (await A.admin.req('GET', `/threads/${up.thread_id}/messages`)).body.messages[0];
    expect(dto.from).toBe(node.agentId); expect(dto.to).toBe(mgrAgent); expect(dto.simulated).toBe(true);
    // never on a real mission
    expect(await count(`select count(*)::int n from messages m join conversation_threads c on c.id=m.thread_id join missions x on x.id=c.mission_id where m.simulated and not x.demo`)).toBe(0);
  });

  it('stops cleanly when the app closes with timers pending', async () => {
    const A = await setup({ conversationSimMs: 5000 });
    await seedDemo(t.app.db, 't-1', A.adminId);
    const demo = MISSIONS.find((m) => m.status === 'running')!;
    const node = getMissionControl(demo).nodes.find((x) => x.parent)!;
    const tid = await humanThread(A.admin, demo.id, node.instanceId);
    await send(A.admin, tid, { kind: 'command', text: 'x', to: node.agentId });
    // afterEach closes the app; a leaked timer would write to a closed pool and fail the run
  });
});

describe('append-only and backfill', () => {
  it('UPDATE and DELETE on messages and receipts throw', async () => {
    const A = await setup();
    const mid = await realMission(A.admin);
    const tid = await humanThread(A.admin, mid, `${mid}:gm`);
    const m = (await send(A.admin, tid, { kind: 'command', text: 'a', to: 'gm' })).body.message;
    await expect(t.pool.query(`update messages set body='b' where id=$1`, [m.id])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from messages where id=$1`, [m.id])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`update message_receipts set state='delivered'`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from message_receipts`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate messages cascade`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from conversation_threads where id=$1`, [tid])).rejects.toThrow(/append-only/);
  });

  it('backfilled demo threads match the fixture builder message counts, are simulated, and a second run changes nothing', async () => {
    const A = await setup();
    await seedDemo(t.app.db, 't-1', A.adminId);
    const check = async () => {
      for (const m of MISSIONS) {
        const want = Object.values(getMissionControl(m).threads).reduce((s, x) => s + x.length, 0);
        const got = await count(`select count(*)::int n from messages x join conversation_threads c on c.id=x.thread_id where c.mission_id=$1`, [m.id]);
        expect(got, m.id).toBe(want);
        expect(await count(`select count(*)::int n from conversation_threads where mission_id=$1`, [m.id])).toBe(Object.keys(getMissionControl(m).threads).length);
      }
      expect(await count(`select count(*)::int n from messages where not simulated`)).toBe(0);
    };
    await check();
    const total = await count(`select count(*)::int n from messages`);
    const rc = await count(`select count(*)::int n from message_receipts`);
    expect(rc).toBeGreaterThan(0);
    await tx(t.app.db, (c) => backfillMissionControl(c, 't-1'));
    expect(await count(`select count(*)::int n from messages`)).toBe(total);
    expect(await count(`select count(*)::int n from message_receipts`)).toBe(rc);
    // the newest message of the lead's human thread is as old as the fixture says
    const m = MISSIONS.find((x) => x.pendingApprovals > 0)!;
    const lead = (await A.admin.req('GET', `/missions/${m.id}`)).body.mission.leadId;
    const th = (await A.admin.req('GET', `/missions/${m.id}/threads`)).body;
    const human = th.threads.find((x: any) => x.kind === 'human-agent' && (x.aAgentId === lead || x.bAgentId === lead));
    const fx = getMissionControl(m).threads;
    const key = Object.keys(fx).find((k) => k.includes('human:'))!;
    expect(human.lastMessage.agoMin).toBe(Math.min(...fx[key].map((x) => x.agoMin)));
    expect(human.lastMessage.simulated).toBe(true);
  });

  it('missions that have instances but no threads (Task 2 backfill) still get threads; demo:clear works', async () => {
    const A = await setup();
    await seedDemo(t.app.db, 't-1', A.adminId);
    await tx(t.app.db, async (c) => { await c.query(`set local axion.purge_demo = 'on'`); await c.query(`delete from conversation_threads`); });
    expect(await count(`select count(*)::int n from messages`)).toBe(0);
    expect(await count(`select count(*)::int n from agent_instances`)).toBeGreaterThan(0);
    await tx(t.app.db, (c) => backfillMissionControl(c, 't-1'));
    expect(await count(`select count(*)::int n from messages`)).toBeGreaterThan(0);
    const { clearDemo } = await import('../src/seed/demo.ts');
    await clearDemo(t.app.db, 't-1');
    expect(await count(`select count(*)::int n from conversation_threads`)).toBe(0);
  });
});
