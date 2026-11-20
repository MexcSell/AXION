import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';

let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
let mina: { b: Browser; id: string };
let kenji: { b: Browser; id: string };
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  A = await withAdmin(t.app);
  mina = await A.member('Mina');
  kenji = await A.member('Kenji');
});
afterEach(async () => { await t.close(); });

let n = 0;
const key = () => 'k-' + Date.now() + '-' + n++;
const create = (b: Browser, body: Record<string, unknown> = {}, k = key()) =>
  b.req('POST', '/missions', { text: 'Research three competitor websites and report pricing.', files: [], shared: false, ...body }, { 'idempotency-key': k });
const act = (b: Browser, id: string, action: string, body: unknown = {}) => b.req('POST', `/missions/${id}/actions/${action}`, body, { 'idempotency-key': key() });

describe('create and read', () => {
  it('a new mission comes back in planning with staffing reading and an executor', async () => {
    const r = await create(mina.b);
    expect(r.status).toBe(201);
    const m = r.body.mission;
    expect(m.id).toMatch(/^M-\d+$/);
    expect(Number(m.id.slice(2))).toBeGreaterThan(136);
    expect(m.status).toBe('planning');
    expect(m.kind).toBe('research');
    expect(m.staffing.stage).toBe('reading');
    expect(m.executorId).toBe('researcher-01');
    expect(m.ownerId).toBe(mina.id);
    expect(m.owner).toBe('Mina');
    expect(m.revision).toBe(1);
    expect(typeof m.rowVersion).toBe('number');
    expect(m.content.text).toContain('competitor');
  });

  it('needs an Idempotency-Key', async () => {
    const r = await mina.b.req('POST', '/missions', { text: 'x y z', files: [], shared: false });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('the same key twice gives one mission and the same response; another body → 422', async () => {
    const k = key();
    const a = await create(mina.b, {}, k);
    const b = await create(mina.b, {}, k);
    expect(b.status).toBe(201);
    expect(b.body.mission.id).toBe(a.body.mission.id);
    expect((await t.pool.query('select count(*)::int n from missions')).rows[0].n).toBe(1);
    const c = await create(mina.b, { text: 'something else entirely' }, k);
    expect(c.status).toBe(422);
    expect(c.body.code).toBe('IDEMPOTENCY_MISMATCH');
  });
});

describe('visibility', () => {
  it('owner, other member and admin × private and shared', async () => {
    const priv = (await create(mina.b)).body.mission.id;
    const shared = (await create(mina.b, { shared: true })).body.mission.id;
    const ids = async (b: Browser) => (await b.req('GET', '/missions')).body.missions.map((m: any) => m.id).sort();
    expect(await ids(mina.b)).toEqual([priv, shared].sort());
    expect(await ids(kenji.b)).toEqual([shared]);
    expect(await ids(A.admin)).toEqual([priv, shared].sort());
    expect((await kenji.b.req('GET', `/missions/${priv}`)).status).toBe(404);
    expect((await kenji.b.req('GET', `/missions/${shared}`)).status).toBe(200);
    expect((await A.admin.req('GET', `/missions/${priv}`)).status).toBe(200);
  });

  it('a member can edit and pause a shared mission but not flip share', async () => {
    const m = (await create(mina.b, { shared: true })).body.mission;
    const e = await kenji.b.req('PATCH', `/missions/${m.id}`, { priority: 'high' }, { 'if-match': String(m.rowVersion) });
    expect(e.status).toBe(200);
    expect(e.body.mission.priority).toBe('high');
    expect((await act(kenji.b, m.id, 'pause')).body.mission.status).toBe('paused');
    const s = await kenji.b.req('POST', `/missions/${m.id}/share`, { shared: false });
    expect(s.status).toBe(403);
    expect((await mina.b.req('POST', `/missions/${m.id}/share`, { shared: false })).status).toBe(200);
    expect((await kenji.b.req('GET', `/missions/${m.id}`)).status).toBe(404); // Review Focus #2
  });

  it('a mission in another tenant is 404 even for an admin', async () => {
    await t.pool.query(`insert into tenants(id,name) values ('t-2','Other')`);
    await t.pool.query(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
    await t.pool.query(`insert into missions(id,tenant_id,owner_id,shared,status) values ('M-9001','t-2','u-x',true,'running')`);
    await t.pool.query(`insert into mission_revisions(mission_id,revision,title,kind,priority,text,created_by) values ('M-9001',1,'Other','data','normal','x','u-x')`);
    expect((await A.admin.req('GET', '/missions/M-9001')).status).toBe(404);
    expect((await A.admin.req('GET', '/missions')).body.missions.map((m: any) => m.id)).not.toContain('M-9001');
    expect((await act(A.admin, 'M-9001', 'pause')).status).toBe(404);
  });
});

describe('edits and actions', () => {
  it('a stale If-Match is a 409; a missing one is 428', async () => {
    const m = (await create(mina.b)).body.mission;
    const ok = await mina.b.req('PATCH', `/missions/${m.id}`, { title: 'New title' }, { 'if-match': String(m.rowVersion) });
    expect(ok.status).toBe(200);
    const stale = await mina.b.req('PATCH', `/missions/${m.id}`, { title: 'Other title' }, { 'if-match': String(m.rowVersion) });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('MISSION_REVISION_CONFLICT');
    expect((await mina.b.req('PATCH', `/missions/${m.id}`, { title: 'x' })).status).toBe(428);
  });

  it('editing a started mission appends a revision', async () => {
    const m = (await create(mina.b)).body.mission;
    const r = await mina.b.req('PATCH', `/missions/${m.id}`, { text: 'Changed scope: five competitors.' }, { 'if-match': String(m.rowVersion) });
    expect(r.body.mission.revision).toBe(2);
    expect((await t.pool.query('select count(*)::int n from mission_revisions where mission_id=$1', [m.id])).rows[0].n).toBe(2);
  });

  it('an illegal action is 409; system actions are 403', async () => {
    const m = (await create(mina.b)).body.mission;
    const r = await act(mina.b, m.id, 'resume');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ILLEGAL_TRANSITION');
    for (const a of ['complete', 'fail', 'approvalDone', 'submit', 'hack']) {
      const x = await act(mina.b, m.id, a);
      expect(x.status, a).toBe(403);
      expect(x.body.code).toBe('ACTION_NOT_ALLOWED');
    }
  });

  it('start records a run with execution disabled', async () => {
    const m = (await create(mina.b)).body.mission;
    const r = await act(mina.b, m.id, 'start');
    expect(r.body.mission.status).toBe('running');
    const runs = (await t.pool.query('select * from mission_runs where mission_id=$1', [m.id])).rows;
    expect(runs).toHaveLength(1);
    expect(runs[0].execution).toBe('disabled');
  });

  it('cancel-and-archive in one call, then restore', async () => {
    const m = (await create(mina.b)).body.mission;
    expect((await act(mina.b, m.id, 'archive')).status).toBe(409);
    const r = await act(mina.b, m.id, 'archive', { cancelFirst: true });
    expect(r.status).toBe(200);
    expect(r.body.mission.status).toBe('archived');
    const back = await act(mina.b, m.id, 'restore');
    expect(back.body.mission.status).toBe('canceled');
  });

  it('delete is for the owner or an admin', async () => {
    const m = (await create(mina.b, { shared: true })).body.mission;
    expect((await kenji.b.req('DELETE', `/missions/${m.id}`)).status).toBe(403);
    expect((await mina.b.req('DELETE', `/missions/${m.id}`)).status).toBe(200);
    expect((await mina.b.req('GET', `/missions/${m.id}`)).status).toBe(404);
  });

  it('every write writes one audit row', async () => {
    const before = (await t.pool.query(`select count(*)::int n from audit_events where action like 'mission.%'`)).rows[0].n;
    const m = (await create(mina.b)).body.mission;
    await mina.b.req('PATCH', `/missions/${m.id}`, { title: 'T2' }, { 'if-match': String(m.rowVersion) });
    await mina.b.req('POST', `/missions/${m.id}/share`, { shared: true });
    await act(mina.b, m.id, 'pause');
    await mina.b.req('DELETE', `/missions/${m.id}`);
    const after = (await t.pool.query(`select count(*)::int n from audit_events where action like 'mission.%'`)).rows[0].n;
    expect(after - before).toBe(5);
  });
});

describe('uploads (Review Focus #5)', () => {
  const upload = async (b: Browser, name: string, bytes: Buffer, type = 'application/octet-stream') => {
    const boundary = '----axion' + Math.random().toString(16).slice(2);
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const cookie = [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/uploads', headers: { cookie, 'x-csrf': b.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([head, bytes, tail]) });
    return { status: r.statusCode, body: r.json() };
  };
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

  it('accepts a real PNG and a text file, and attaches them to a mission', async () => {
    const img = await upload(mina.b, 'shot.png', PNG, 'image/png');
    expect(img.status).toBe(201);
    expect(img.body).toMatchObject({ name: 'shot.png', kind: 'image', mime: 'image/png', size: PNG.length });
    const txt = await upload(mina.b, 'notes.txt', Buffer.from('hello\nworld'), 'text/plain');
    expect(txt.body.kind).toBe('txt');
    const m = (await create(mina.b, { text: '', files: [img.body.id, txt.body.id] })).body.mission;
    expect(m.content.files.map((f: any) => f.name)).toEqual(['shot.png', 'notes.txt']);
    expect(m.content.files[1].excerpt).toContain('hello');
    const dl = await t.app.inject({ method: 'GET', url: m.content.files[0].url, headers: { cookie: [...mina.b.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
  });

  it('rejects 0 bytes, wrong extension for the content, and ../ names', async () => {
    expect((await upload(mina.b, 'empty.txt', Buffer.alloc(0))).body.code).toBe('UPLOAD_REJECTED');
    const fake = await upload(mina.b, 'photo.png', Buffer.from('%PDF-1.4 hello'));
    expect(fake.status).toBe(400);
    expect(fake.body.code).toBe('UPLOAD_REJECTED');
    expect((await upload(mina.b, '../../etc/passwd.txt', Buffer.from('x'))).body.code).toBe('UPLOAD_REJECTED');
    expect((await upload(mina.b, 'tool.exe', Buffer.from('MZ\x90\x00'))).body.code).toBe('UPLOAD_REJECTED');
  });

  it('rejects a file over 25 MB', async () => {
    const big = await upload(mina.b, 'big.txt', Buffer.alloc(25 * 1024 * 1024 + 10, 0x61));
    expect(big.status).toBe(413);
    expect(big.body.code).toBe('UPLOAD_REJECTED');
  });

  it("someone else's upload can't be attached or downloaded", async () => {
    const img = await upload(mina.b, 'shot.png', PNG, 'image/png');
    const r = await create(kenji.b, { files: [img.body.id] });
    expect(r.status).toBe(400);
    const dl = await t.app.inject({ method: 'GET', url: `/api/v1/uploads/${img.body.id}`, headers: { cookie: [...kenji.b.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(dl.statusCode).toBe(404);
  });
});
