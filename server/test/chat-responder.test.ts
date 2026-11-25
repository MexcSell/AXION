import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { CloudCallError, type CloudAdapter } from '../src/cloud/claude-cli.ts';
import { extractDraft } from '../src/conversations/responder.ts';

/** Owner 2026-11-25: the GM and agent chats are answered live by Claude 2 with company data; no limits; mission threads stay off. */
let t: TestApp;
afterEach(async () => { const x = t; t = undefined as unknown as TestApp; await x?.close(); });
let n = 0;
const key = () => ({ 'idempotency-key': 'cr' + Date.now() + '-' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;

type Behave = (prompt: string, system: string) => Promise<string> | string;
function fake(id: string, behave: Behave): CloudAdapter & { calls: { prompt: string; system: string }[] } {
  const calls: { prompt: string; system: string }[] = [];
  return { id, label: id === 'claude-2' ? 'Claude 2' : 'Claude 1', tokenVar: 'CLAUDE_CODE_OAUTH_TOKEN' + id.slice(-1), model: 'claude-opus-5-5', calls,
    refresh: async () => ({ checkedAt: new Date().toISOString(), status: 'available', account: null, resetsAt: null, windows: [] }),
    complete: async (i) => { calls.push(i); return { text: await behave(i.prompt, i.system), durationMs: 5, usage: { input: 10, output: 4 } }; } };
}

async function setup(behave: Behave = () => 'Hello from the model.') {
  const one = fake('claude-1', () => 'WRONG MODEL');
  const two = fake('claude-2', behave);
  t = await makeTestApp({ cloudModels: [one, two] });
  const A = await withAdmin(t.app);
  return { A, one, two };
}
const page = async (b: { req: Function }, path: string) => (await b.req('GET', path + '/messages')).body.messages.slice().reverse();

describe('chat responder (fake Claude 2)', () => {
  it('gm: Claude 2 answers as the GM with company data, the message goes queued -> acknowledged, no honest note', async () => {
    const { A, one, two } = await setup((p) => p.includes('Homepage-01') ? 'Homepage control is Homepage-01; the app opens on Missions.' : 'no data');
    const mina = await A.member('Mina');
    const omar = await A.member('Omar');
    await mina.b.req('POST', '/missions', { text: 'Mina launches the spring catalogue.', files: [], shared: false }, key());
    await omar.b.req('POST', '/missions', { text: 'Omar private salary review.', files: [], shared: false }, key());
    const r = await mina.b.req('POST', '/channels/gm/messages', { kind: 'command', text: 'Where is the current homepage?' }, key());
    expect(r.status).toBe(201);
    expect(r.body.message.status).toBe('queued');
    await t.app.chatResponder.idle();
    const msgs = await page(mina.b, '/channels/gm');
    expect(msgs.map((m: any) => [m.from, m.text])).toEqual([[`human:${mina.id}`, 'Where is the current homepage?'], ['gm', 'Homepage control is Homepage-01; the app opens on Missions.']]);
    expect(msgs[0].status).toBe('acknowledged');
    expect(msgs[1]).toMatchObject({ kind: 'reply', simulated: false, replyTo: msgs[0].id, author: { kind: 'agent', name: 'GM' } });
    expect(one.calls).toHaveLength(0);
    expect(two.calls).toHaveLength(1);
    const { prompt, system } = two.calls[0];
    expect(system).toMatch(/General Manager/);
    expect(system).not.toMatch(/Homepage-01|Mina/); // company data and the conversation go on stdin, never in argv
    expect(prompt).toMatch(/Where is the current homepage\?/);
    expect(prompt).toMatch(/spring catalogue/);           // her own mission
    expect(prompt).not.toMatch(/salary review/);          // another member's private mission is not hers to see
    expect(prompt).not.toMatch(/People \(/);              // the people list is for administrators
    expect(prompt).not.toMatch(/pass_hash|argon|\$argon/);
    const receipts = (await rows(`select r.state from message_receipts r join messages m on m.id=r.message_id where m.body='Where is the current homepage?' order by r.id`)).map((x) => x.state);
    expect(receipts).toEqual(['queued', 'delivered', 'acknowledged']);
    const ev = await rows(`select payload, audience, audience_user from events where type='conversation.receipt' order by seq`);
    expect(ev.map((e) => e.payload.state)).toEqual(['delivered', 'acknowledged']);
    expect(ev.every((e) => e.audience === 'owner' && e.audience_user === mina.id && e.payload.channel.kind === 'gm')).toBe(true);
    const au = await rows(`select actor, result, detail::text d from audit_events where action='model.cloud.chat'`);
    expect(au).toHaveLength(1);
    expect(au[0].result).toBe('ok');
    expect(au[0].d).not.toMatch(/homepage/i); // sizes only
  });

  it('agent channel: the agent answers under its own name; an administrator sees the people list', async () => {
    const { A, two } = await setup(() => 'Coder here.');
    await A.admin.req('POST', '/channels/agent:coder-01/messages', { kind: 'command', text: 'Status?' }, key());
    await t.app.chatResponder.idle();
    const msgs = await page(A.admin, '/channels/agent:coder-01');
    expect(msgs.at(-1)).toMatchObject({ from: 'coder-01', text: 'Coder here.', author: { kind: 'agent', name: 'Coder-01' } });
    expect(msgs.filter((m: any) => m.from === 'system')).toHaveLength(0);
    expect(two.calls[0].system).toMatch(/Coder-01/);
    expect(two.calls[0].prompt).toMatch(/People \(1\)/);
  });

  it('every model fails: a note; the waiting message is answered together with the next one', async () => {
    let fail = true;
    const one = fake('claude-1', () => { if (fail) throw new CloudCallError('failed', 'boom'); return 'One answered.'; });
    const two = fake('claude-2', () => { if (fail) throw new CloudCallError('limited', 'hit your limit'); return 'Both answered.'; });
    t = await makeTestApp({ cloudModels: [one, two] });
    const A = await withAdmin(t.app);
    const p = (text: string) => A.admin.req('POST', '/channels/gm/messages', { kind: 'reply', text }, key());
    await p('first');
    await t.app.chatResponder.idle();
    let msgs = await page(A.admin, '/channels/gm');
    expect(msgs.map((m: any) => m.from)).toEqual([expect.stringMatching(/^human:/), 'system']);
    expect(msgs[1].text).toMatch(/could not answer: Claude 2 reached a usage limit; Claude 1 failed/);
    expect(msgs[0].status).toBe('delivered');
    expect([one.calls.length, two.calls.length]).toEqual([1, 1]);
    fail = false;
    await p('second');
    await t.app.chatResponder.idle();
    msgs = await page(A.admin, '/channels/gm');
    // both are cooling now: the router still tries them (soonest back first) rather than leave the chat unanswered
    expect(msgs.map((m: any) => m.text).slice(2)).toEqual(['second', expect.stringMatching(/answered\./)]);
    expect(msgs.filter((m: any) => m.from.startsWith('human:')).map((m: any) => m.status)).toEqual(['acknowledged', 'acknowledged']);
    const last = [...one.calls, ...two.calls].map((c) => c.prompt).find((x) => x.includes('second'))!;
    expect(last).toMatch(/last 2 messages/);
    expect(last).not.toMatch(/could not answer/); // system notes stay out of the transcript
  });

  it('router: Claude 2 limited -> Claude 1 answers at once and Claude 2 cools down; the next answer skips it', async () => {
    const one = fake('claude-1', () => 'From one.');
    const two = fake('claude-2', () => { throw new CloudCallError('limited', 'hit your limit'); });
    t = await makeTestApp({ cloudModels: [one, two] });
    const A = await withAdmin(t.app);
    await A.admin.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'a' }, key());
    await t.app.chatResponder.idle();
    expect((await page(A.admin, '/channels/gm')).map((m: any) => m.from)).toEqual([expect.stringMatching(/^human:/), 'gm']);
    expect([two.calls.length, one.calls.length]).toEqual([1, 1]);
    const st = (await A.admin.req('GET', '/chat-model')).body;
    expect(st).toMatchObject({ models: ['claude-2', 'claude-1'], custom: false, active: 'claude-1', canEdit: true });
    expect(st.entries.find((e: any) => e.id === 'claude-2')).toMatchObject({ usable: false, reason: 'usage limit reached' });
    expect(Date.parse(st.entries.find((e: any) => e.id === 'claude-2').until)).toBeGreaterThan(Date.now());
    await A.admin.req('POST', '/channels/agent:coder-01/messages', { kind: 'reply', text: 'b' }, key());
    await t.app.chatResponder.idle();
    expect([two.calls.length, one.calls.length]).toEqual([1, 2]); // cooling: not tried while Claude 1 works
    const usage = (await A.admin.req('GET', '/chat-model/usage?days=1')).body;
    expect(usage.fallbacks).toBe(1);
    expect(usage.rows.map((r: any) => [r.modelId, r.calls, r.errors])).toEqual(expect.arrayContaining([['claude-1', 2, 0], ['claude-2', 1, 1]]));
  });

  it('settings: an administrator orders the chat models; members read but cannot change; bad lists are refused', async () => {
    const { A, one, two } = await setup(() => 'two');
    const mina = await A.member('Mina');
    expect((await mina.b.req('PUT', '/chat-model', { models: ['claude-1'] })).status).toBe(403);
    expect((await mina.b.req('GET', '/chat-model')).body).toMatchObject({ models: ['claude-2', 'claude-1'], canEdit: false });
    expect((await mina.b.req('GET', '/chat-model/usage')).status).toBe(403);
    for (const models of [[], ['claude-9'], ['claude-1', 'claude-1']]) expect((await A.admin.req('PUT', '/chat-model', { models })).status).toBe(400);
    const r = await A.admin.req('PUT', '/chat-model', { models: ['claude-1'] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ models: ['claude-1'], custom: true, active: 'claude-1' });
    await mina.b.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'who answers?' }, key());
    await t.app.chatResponder.idle();
    expect([one.calls.length, two.calls.length]).toEqual([1, 0]);
    expect((await A.admin.req('PUT', '/chat-model', { models: null })).body).toMatchObject({ models: ['claude-2', 'claude-1'], custom: false });
    expect((await rows(`select detail from audit_events where action='model.chat.route' order by seq`)).map((x) => x.detail.models)).toEqual([['claude-1'], 'default']);
  });

  it('a model disabled on Models is never tried; every chat model disabled = the honest note; a replayed key never answers twice', async () => {
    const { A, one, two } = await setup();
    const h = key();
    await A.admin.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'once' }, h);
    await A.admin.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'once' }, h);
    await t.app.chatResponder.idle();
    expect([two.calls.length, one.calls.length]).toEqual([1, 0]);
    expect((await A.admin.req('POST', '/cloud-models/claude-2/manage', { action: 'disable' }, key())).status).toBe(200);
    await A.admin.req('POST', '/channels/agent:writer-01/messages', { kind: 'reply', text: 'hello?' }, key());
    await t.app.chatResponder.idle();
    expect([two.calls.length, one.calls.length]).toEqual([1, 1]); // Claude 1 took over
    expect((await A.admin.req('POST', '/cloud-models/claude-1/manage', { action: 'disable' }, key())).status).toBe(200);
    expect((await A.admin.req('GET', '/chat-model')).body.active).toBeNull();
    await A.admin.req('POST', '/channels/agent:tester-01/messages', { kind: 'reply', text: 'anyone?' }, key());
    await t.app.chatResponder.idle();
    expect([two.calls.length, one.calls.length]).toEqual([1, 1]);
    const msgs = await page(A.admin, '/channels/agent:tester-01');
    expect(msgs.map((m: any) => m.from)).toEqual([expect.stringMatching(/^human:/), 'system']);
    expect(msgs[1].text).toMatch(/can't answer yet/);
  });

  it('no cloud model configured: unchanged honest-note behaviour', async () => {
    t = await makeTestApp({});
    const A = await withAdmin(t.app);
    await A.admin.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'hi' }, key());
    await t.app.chatResponder.idle();
    expect((await page(A.admin, '/channels/gm')).map((m: any) => m.from)).toEqual([expect.stringMatching(/^human:/), 'system']);
  });

  it('startup sweep answers messages that were waiting (sent while answers were off, or cut by a restart)', async () => {
    const { A, one, two } = await setup(() => 'Late answer.');
    for (const id of ['claude-1', 'claude-2']) expect((await A.admin.req('POST', `/cloud-models/${id}/manage`, { action: 'disable' }, key())).status).toBe(200);
    await A.admin.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'Do you know where the homepage is?' }, key());
    await A.admin.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'hi' }, key());
    expect((await A.admin.req('POST', '/cloud-models/claude-2/manage', { action: 'enable' }, key())).status).toBe(200);
    await t.app.chatResponder.sweep();
    await t.app.chatResponder.idle();
    expect([two.calls.length, one.calls.length]).toEqual([1, 0]);
    expect(two.calls[0].prompt).toMatch(/last 2 messages/);
    const msgs = await page(A.admin, '/channels/gm');
    expect(msgs.at(-1).text).toBe('Late answer.');
    expect(msgs.filter((m: any) => m.from.startsWith('human:')).every((m: any) => m.status === 'acknowledged')).toBe(true);
  });

  it('GM mission drafts: a valid <mission_draft> becomes the reply\'s draft and leaves the text; agents never get one', async () => {
    const draft = { title: 'Refresh the homepage', text: 'Update the hero and pricing sections.', criteria: ['Hero uses the new copy', 'Lighthouse >= 90'] };
    const { A, two } = await setup((p) => p.includes('Coder-01:') && !p.includes('General Manager') ? `ok <mission_draft>${JSON.stringify(draft)}</mission_draft>` : `I drafted it.\n<mission_draft>${JSON.stringify(draft)}</mission_draft>`);
    await A.admin.req('POST', '/channels/gm/messages', { kind: 'command', text: 'Please refresh the homepage' }, key());
    await t.app.chatResponder.idle();
    const gm = (await page(A.admin, '/channels/gm')).at(-1);
    expect(gm.text).toBe('I drafted it.');
    expect(gm.draft).toEqual(draft);
    expect(two.calls[0].system).toMatch(/mission_draft/);
    expect(two.calls[0].prompt).toMatch(/<about_you>\nGM: General Manager/);
    await A.admin.req('POST', '/channels/agent:coder-01/messages', { kind: 'command', text: 'x' }, key());
    await t.app.chatResponder.idle();
    expect(two.calls[1].system).not.toMatch(/mission_draft/);
    expect((await page(A.admin, '/channels/agent:coder-01')).at(-1).draft).toBeUndefined();
  });

  it('extractDraft: bad JSON or a wrong shape is dropped from the text without a draft', () => {
    expect(extractDraft('Hi <mission_draft>{nope</mission_draft>')).toEqual({ body: 'Hi', draft: null });
    expect(extractDraft('Hi <mission_draft>{"title":"t"}</mission_draft>')).toEqual({ body: 'Hi', draft: null });
    expect(extractDraft('<mission_draft>```json\n{"title":"T","text":"X"}\n```</mission_draft>')).toEqual({ body: 'Here is a mission draft.', draft: { title: 'T', text: 'X', criteria: [] } });
    expect(extractDraft('plain')).toEqual({ body: 'plain', draft: null });
  });

  it('mission threads never call the model', async () => {
    const { A, two } = await setup();
    const mid = (await A.admin.req('POST', '/missions', { text: 'Ship it.', files: [], shared: false }, key())).body.mission.id;
    const th = (await A.admin.req('GET', `/missions/${mid}/threads`)).body;
    expect(th).toBeTruthy();
    await t.app.chatResponder.sweep();
    await t.app.chatResponder.idle();
    expect(two.calls).toHaveLength(0);
  });
});
