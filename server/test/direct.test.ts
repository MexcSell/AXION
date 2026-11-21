import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, openStream, type TestApp } from './helpers.ts';

let t: TestApp;
const streams: { close: () => void }[] = [];
afterEach(async () => { streams.splice(0).forEach((s) => s.close()); await t.close(); });
let n = 0;
const key = () => ({ 'idempotency-key': 'd' + Date.now() + '-' + n++ });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const GM_NOTE = "The General Manager can't answer yet — this is stored and will be answered when agents start working.";
const post = (b: { req: Function }, path: string, body: Record<string, unknown>, h = key()) => b.req('POST', path, body, h);

async function setup() {
  t = await makeTestApp({});
  await t.app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  return { A: await withAdmin(t.app), base };
}

describe('direct channels', () => {
  it('gm: author is the session user, from/to are ignored, kinds are limited, the honest note appears once', async () => {
    const { A } = await setup();
    const mina = await A.member('Mina');
    const r = await post(mina.b, '/channels/gm/messages', { kind: 'command', text: 'Plan my week', from: 'gm', to: 'coder-01', author: { kind: 'agent', id: 'gm' }, simulated: true });
    expect(r.status).toBe(201);
    expect(r.body.message.from).toBe(`human:${mina.id}`);
    expect(r.body.message.status).toBe('queued');
    expect(r.body.message.simulated).toBe(false);
    for (const kind of ['report', 'ack', 'system', 'nope']) expect((await post(mina.b, '/channels/gm/messages', { kind, text: 'x', from: 'gm' })).status).toBe(422);
    expect((await post(mina.b, '/channels/gm/messages', { kind: 'reply', text: '   ' })).status).toBe(422);
    expect((await post(mina.b, '/channels/gm/messages', { kind: 'reply', text: 'x'.repeat(8001) })).status).toBe(422);
    expect((await post(mina.b, '/channels/gm/messages', { kind: 'reply', text: 'second' })).status).toBe(201);
    const page = (await mina.b.req('GET', '/channels/gm/messages')).body;
    expect(page.messages.map((m: any) => m.text).reverse()).toEqual(['Plan my week', GM_NOTE, 'second']);
    expect(page.messages.filter((m: any) => m.from === 'system').length).toBe(1);
    expect(page.messages.find((m: any) => m.from === 'system').kind).toBe('system');
    expect(await rows(`select 1 from messages where author_kind='agent'`)).toHaveLength(0);
  });

  it('agent channel: honest note names the agent, unknown agent and agent:gm are 404', async () => {
    const { A } = await setup();
    const mina = await A.member('Mina');
    const name = (await rows(`select name from agent_definitions where id='coder-01'`))[0].name;
    expect((await post(mina.b, '/channels/agent:coder-01/messages', { kind: 'command', text: 'fix it' })).status).toBe(201);
    expect((await post(mina.b, '/channels/agent:coder-01/messages', { kind: 'reply', text: 'again' })).status).toBe(201);
    const msgs = (await mina.b.req('GET', '/channels/agent:coder-01/messages')).body.messages;
    const notes = msgs.filter((m: any) => m.from === 'system');
    expect(notes.length).toBe(1);
    expect(notes[0].text).toBe(`${name} can't answer yet — this is stored and will be delivered when execution starts.`);
    expect((await post(mina.b, '/channels/agent:nobody/messages', { kind: 'reply', text: 'x' })).status).toBe(404);
    expect((await mina.b.req('GET', '/channels/agent:nobody/messages')).status).toBe(404);
    expect((await post(mina.b, '/channels/agent:gm/messages', { kind: 'reply', text: 'x' })).status).toBe(404);
    expect((await post(mina.b, '/channels/bogus/messages', { kind: 'reply', text: 'x' })).status).toBe(404);
  });

  it('privacy: no one reads or writes another user\'s gm/agent channel; admin line of another user is admin-only', async () => {
    const { A } = await setup();
    const mina = await A.member('Mina');
    const omar = await A.member('Omar');
    await post(mina.b, '/channels/gm/messages', { kind: 'reply', text: 'private gm' });
    await post(mina.b, '/channels/agent:coder-01/messages', { kind: 'reply', text: 'private agent' });
    const gmTid = (await rows(`select id from conversation_threads where owner_user_id=$1 and kind='gm'`, [mina.id]))[0].id;
    const agTid = (await rows(`select id from conversation_threads where owner_user_id=$1 and kind='agent-direct'`, [mina.id]))[0].id;
    // Omar's own channels are his: empty
    expect((await omar.b.req('GET', '/channels/gm/messages')).body.messages).toEqual([]);
    for (const tid of [gmTid, agTid]) {
      for (const who of [omar.b, A.admin]) { // not even an administrator reads a member's private channel
        expect((await who.req('GET', `/threads/${tid}/messages`)).status).toBe(404);
        expect((await post(who, `/threads/${tid}/messages`, { kind: 'command', text: 'hi', to: 'gm' })).status).toBe(404);
      }
    }
    expect((await omar.b.req('GET', `/channels/admin/${mina.id}/messages`)).status).toBe(404);
    expect((await post(omar.b, `/channels/admin/${mina.id}/messages`, { kind: 'reply', text: 'x' })).status).toBe(404);
    expect((await A.admin.req('GET', `/channels/gm/${mina.id}/messages`)).status).toBe(404);
    expect((await A.admin.req('GET', `/channels/admin/nobody/messages`)).status).toBe(404);
    expect(await rows(`select 1 from messages where body='hi'`)).toHaveLength(0);
  });

  it('events: gm/agent events reach only the owner (never an admin); admin-line events reach the owner and admins only', async () => {
    const { A, base } = await setup();
    const mina = await A.member('Mina');
    const omar = await A.member('Omar');
    const sa = await openStream(base, A.admin); streams.push(sa);
    const sm = await openStream(base, mina.b); streams.push(sm);
    const so = await openStream(base, omar.b); streams.push(so);
    await post(mina.b, '/channels/gm/messages', { kind: 'reply', text: 'gm secret' });
    await post(mina.b, '/channels/agent:coder-01/messages', { kind: 'reply', text: 'agent secret' });
    await post(mina.b, '/channels/admin/messages', { kind: 'reply', text: 'hello admins' });
    const isMsg = (e: any) => e.event === 'conversation.messageCreated';
    expect(await sm.waitFor((e) => isMsg(e) && e.data.payload.message.text === 'agent secret')).toBeTruthy();
    expect(await sa.waitFor((e) => isMsg(e) && e.data.payload.message.text === 'hello admins')).toBeTruthy();
    await sleep(400);
    const texts = (s: typeof sa) => s.events.filter(isMsg).map((e) => e.data.payload.message.text);
    expect(texts(sm)).toEqual(expect.arrayContaining(['gm secret', 'agent secret', 'hello admins']));
    expect(texts(sa)).toEqual(['hello admins']);
    expect(texts(so)).toEqual([]);
    // admin answers: Mina gets it live, Omar still nothing
    expect((await post(A.admin, `/channels/admin/${mina.id}/messages`, { kind: 'reply', text: 'we are on it' })).status).toBe(201);
    expect(await sm.waitFor((e) => isMsg(e) && e.data.payload.message.text === 'we are on it')).toBeTruthy();
    await sleep(300);
    expect(texts(so)).toEqual([]);
    const ev = await rows(`select audience, audience_user, mission_id from events where type='conversation.messageCreated' order by id`);
    expect(ev.map((e) => e.audience)).toEqual(['owner', 'owner', 'owner', 'owner', 'user', 'user']); // gm + note, agent + note, admin post, admin answer
    expect(ev.every((e) => e.audience_user === mina.id && e.mission_id === null)).toBe(true);
  });

  it('lists: a member sees only their own channels; an administrator also sees every admin line', async () => {
    const { A } = await setup();
    const mina = await A.member('Mina');
    const omar = await A.member('Omar');
    await post(mina.b, '/channels/admin/messages', { kind: 'reply', text: 'mina asks' });
    await post(omar.b, '/channels/admin/messages', { kind: 'reply', text: 'omar asks' });
    await post(mina.b, '/channels/gm/messages', { kind: 'reply', text: 'mina gm' });
    const mine = (await mina.b.req('GET', '/channels')).body.channels as any[];
    expect(mine.filter((c) => c.kind === 'admin').map((c) => c.userId)).toEqual([mina.id]);
    expect(mine.find((c) => c.kind === 'gm').last.text).toBe(GM_NOTE);
    expect(mine.map((c) => c.kind).sort()).toEqual(['admin', 'gm']);
    expect(mine.every((c) => c.userId === mina.id)).toBe(true);
    const all = (await A.admin.req('GET', '/channels')).body.channels as any[];
    expect(all.filter((c) => c.kind === 'admin').map((c) => c.userId).sort()).toEqual([mina.id, omar.id, A.adminId].sort());
    expect(all.filter((c) => c.kind === 'gm').map((c) => c.userId)).toEqual([A.adminId]); // never Mina's gm
    expect(all.some((c) => c.userId === mina.id && c.kind !== 'admin')).toBe(false);
    expect(all.find((c) => c.kind === 'admin' && c.userId === mina.id).userName).toBe('Mina');
    const peek = (await A.admin.req('GET', `/channels/admin/${mina.id}/messages`)).body.messages;
    expect(peek[0].text).toBe('mina asks');
  });

  it('an administrator\'s answer is a real reply authored by the admin, notifies the user, and counts as unread until read', async () => {
    const { A } = await setup();
    const mina = await A.member('Mina');
    await post(mina.b, '/channels/admin/messages', { kind: 'reply', text: 'Can I get a new device?' });
    expect((await mina.b.req('GET', '/channels')).body.channels.find((c: any) => c.kind === 'admin').unread).toBe(0); // own message
    const r = await post(A.admin, `/channels/admin/${mina.id}/messages`, { kind: 'reply', text: 'Done, try again.', from: `human:${mina.id}` });
    expect(r.status).toBe(201);
    expect(r.body.message.from).toBe(`human:${A.adminId}`);
    expect(r.body.message.author.name).toBe('Luca');
    expect(await rows(`select 1 from messages where author_kind='system'`)).toHaveLength(0); // no honest note, no invented reply
    const list = (await mina.b.req('GET', '/channels')).body.channels as any[];
    const adm = list.find((c) => c.kind === 'admin');
    expect(adm.unread).toBe(1);
    expect(adm.last.text).toBe('Done, try again.');
    const nots = (await mina.b.req('GET', '/notifications')).body.notifications as any[];
    const nt = nots.find((x) => /administrator/i.test(x.title));
    expect(nt).toBeTruthy();
    expect(nt.route).toBe('/?chat=admin');
    expect(nt.body).toContain('Done, try again.');
    await mina.b.req('GET', '/channels/admin/messages');
    expect((await mina.b.req('GET', '/channels')).body.channels.find((c: any) => c.kind === 'admin').unread).toBe(0);
    // an admin writing in their own line notifies nobody
    const before = (await rows(`select count(*)::int n from notifications`))[0].n;
    await post(A.admin, '/channels/admin/messages', { kind: 'reply', text: 'note to self' });
    expect((await rows(`select count(*)::int n from notifications`))[0].n).toBe(before);
  });

  it('idempotent replay stores one message; paging returns newest first without duplicates; the legacy thread routes refuse direct threads', async () => {
    const { A } = await setup();
    const mina = await A.member('Mina');
    const h = key();
    const a = await post(mina.b, '/channels/gm/messages', { kind: 'reply', text: 'once' }, h);
    const b = await post(mina.b, '/channels/gm/messages', { kind: 'reply', text: 'once' }, h);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect(b.body.message.id).toBe(a.body.message.id);
    expect(await rows(`select 1 from messages where body='once'`)).toHaveLength(1);
    expect((await mina.b.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'no key' })).status).toBe(400);
    for (let i = 0; i < 5; i++) await post(mina.b, '/channels/gm/messages', { kind: 'reply', text: `m${i}` });
    const p1 = (await mina.b.req('GET', '/channels/gm/messages?limit=3')).body;
    expect(p1.hasMore).toBe(true);
    const p2 = (await mina.b.req('GET', `/channels/gm/messages?limit=3&before=${p1.nextBefore}`)).body;
    const p3 = (await mina.b.req('GET', `/channels/gm/messages?limit=3&before=${p2.nextBefore}`)).body;
    const ids = [...p1.messages, ...p2.messages, ...p3.messages].map((m: any) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(7); // once, note, m0..m4
    expect(p3.hasMore).toBe(false);
    expect((await mina.b.req('GET', '/channels/gm/messages?limit=zero')).status).toBe(422);
    const tid = (await rows(`select id from conversation_threads where owner_user_id=$1 and kind='gm'`, [mina.id]))[0].id;
    expect((await mina.b.req('GET', `/threads/${tid}/messages`)).status).toBe(404);
    expect((await post(mina.b, `/threads/${tid}/messages`, { kind: 'command', text: 'x', to: 'gm' })).status).toBe(404);
  });

  it('attachments: the user\'s own upload can be attached; another user\'s upload is 404; the other side can open it', async () => {
    const { A } = await setup();
    const mina = await A.member('Mina');
    const omar = await A.member('Omar');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const up = async (b: any, name: string) => {
      const head = Buffer.from(`--XB\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: image/png\r\n\r\n`);
      const cookie = [...b.jar].map(([k, v]: [string, string]) => `${k}=${v}`).join('; ');
      const r = await t.app.inject({ method: 'POST', url: '/api/v1/uploads', headers: { cookie, 'x-csrf': b.csrf, 'content-type': 'multipart/form-data; boundary=XB' }, payload: Buffer.concat([head, png, Buffer.from('\r\n--XB--\r\n')]) });
      return r.json().id as string;
    };
    const f = await up(mina.b, 'a.png');
    const g = await up(omar.b, 'b.png');
    const ok = await post(mina.b, '/channels/admin/messages', { kind: 'reply', text: 'see', uploadIds: [f] });
    expect(ok.status).toBe(201);
    expect(ok.body.message.attachments[0].name).toBe('a.png');
    expect((await post(mina.b, '/channels/admin/messages', { kind: 'reply', text: 'see', uploadIds: [g] })).status).toBe(404);
    expect((await mina.b.req('GET', `/uploads/${f}`)).status).toBe(200);
    expect((await omar.b.req('GET', `/uploads/${f}`)).status).toBe(404);
    const back = await post(A.admin, `/channels/admin/${mina.id}/messages`, { kind: 'reply', text: 'got it', uploadIds: [(await up(A.admin, 'c.png'))] });
    expect(back.status).toBe(201);
    const cid = back.body.message.attachments[0].id;
    expect((await mina.b.req('GET', `/uploads/${cid}`)).status).toBe(200); // the member opens the admin's file
    expect((await omar.b.req('GET', `/uploads/${cid}`)).status).toBe(404);
  });
});
