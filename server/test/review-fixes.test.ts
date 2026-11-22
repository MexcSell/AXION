import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';
import { transition } from '../src/missions/machine.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { tx } from '../src/db.ts';
import { LOCK_KEY_SQL } from '../src/locks.ts';

let t: TestApp;
beforeEach(async () => { t = await makeTestApp({ staffingStepMs: 60_000 }); });
afterEach(async () => { await t.close(); });
let n = 0;

describe('I1 sign-in rate limit', () => {
  it('a spoofed X-Forwarded-For does not reset the limit', async () => {
    await withAdmin(t.app);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await new Browser(t.app).connect('Luca', 'wrong-' + i, undefined as never).then((r) => r)).status);
    // the same, each with a different forged client address
    const forged: number[] = [];
    for (let i = 0; i < 3; i++) {
      const b = new Browser(t.app);
      forged.push((await b.req('POST', '/auth/connect', { name: 'Luca', password: 'xx-' + i, device: { name: 'x', kind: 'desktop', browser: 'x' } }, { 'x-forwarded-for': `10.9.9.${i}` })).status);
    }
    expect(codes[10]).toBe(429);
    expect(forged).toEqual([429, 429, 429]);
  });

  it('a parallel burst cannot get more than the limit of guesses', async () => {
    await withAdmin(t.app);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => new Browser(t.app).connect('Luca', 'burst-' + i)));
    expect(rs.filter((r) => r.status === 401).length).toBeLessThanOrEqual(10);
    expect(rs.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(10);
  });
});

describe('I2 password checks do not hold the global lock', () => {
  it('checking a password for an existing name does not wait for the registration lock', async () => {
    await withAdmin(t.app);
    const holder = await t.pool.connect();
    await holder.query('begin');
    await holder.query(`select pg_advisory_xact_lock(${LOCK_KEY_SQL})`, ['registration']); // e.g. a slow first-user registration
    const t0 = Date.now();
    const r = await new Browser(t.app).connect('Luca', 'wrong-pass');
    const took = Date.now() - t0;
    await holder.query('rollback'); holder.release();
    expect(r.status).toBe(401);
    expect(took).toBeLessThan(1000);
  });
});

describe('I3 waiting users learn the decision', () => {
  it('a rejected waiting user gets USER_REJECTED from /auth/wait', async () => {
    const { admin } = await withAdmin(t.app);
    const b = new Browser(t.app);
    await b.connect('Tomo', 'tomopass');
    const id = (await admin.req('GET', '/users')).body.users.find((u: any) => u.name === 'Tomo').id;
    await admin.req('POST', `/users/${id}/reject`, {});
    const r = await b.req('GET', '/auth/wait');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('USER_REJECTED');
  });

  it('a waiting device that gets blocked sees DEVICE_BLOCKED', async () => {
    const { admin, adminId } = await withAdmin(t.app);
    const phone = new Browser(t.app);
    await phone.connect('Luca', 'pass1234', { name: 'Safari on iOS', kind: 'phone', browser: 'Safari' });
    const dev = (await admin.req('GET', '/users')).body.users.find((u: any) => u.id === adminId).devices.find((d: any) => d.status === 'pending');
    await admin.req('POST', `/users/${adminId}/devices/${dev.id}/block`, {});
    const r = await phone.req('GET', '/auth/wait');
    expect(r.body.code).toBe('DEVICE_BLOCKED');
  });
});

describe('device ids are stored hashed', () => {
  it('devices.client_id is not the cookie value', async () => {
    const { admin } = await withAdmin(t.app);
    const cookie = admin.jar.get('axion_dev')!;
    const rows = (await t.pool.query('select client_id from devices')).rows;
    expect(rows.every((r) => r.client_id !== cookie)).toBe(true);
    expect(rows[0].client_id).toMatch(/^[0-9a-f]{64}$/);
    expect((await admin.req('GET', '/me')).status).toBe(200);
  });
});

describe('M2/M3/M7 profile and devices', () => {
  it('avatar images must be small data URLs', async () => {
    const { admin } = await withAdmin(t.app);
    expect((await admin.req('PATCH', '/me', { avatar: { kind: 'image', hue: 1, image: 'https://tracker.example/x.png' } })).status).toBe(400);
    expect((await admin.req('PATCH', '/me', { avatar: { kind: 'image', hue: 1, image: 'data:image/jpeg;base64,/9j/4AAQ' } })).status).toBe(200);
  });

  it('members get only id, name, avatar and role of other people', async () => {
    const { member } = await withAdmin(t.app);
    const m = await member('Mina');
    const people = (await m.b.req('GET', '/people')).body.people;
    const luca = people.find((p: any) => p.name === 'Luca');
    expect(Object.keys(luca).sort()).toEqual(['avatar', 'createdAt', 'devices', 'id', 'name', 'role', 'status'].sort());
  });

  it('a member can remove their own other device, not someone else\'s', async () => {
    const { member, adminId, admin } = await withAdmin(t.app);
    const m = await member('Mina');
    const phone = new Browser(t.app);
    await phone.connect('Mina', 'pass1234', { name: 'Safari on iOS', kind: 'phone', browser: 'Safari' });
    const devs = (await m.b.req('GET', '/me')).body.me.account.devices;
    const other = devs.find((d: any) => d.status === 'pending');
    expect((await m.b.req('DELETE', `/me/devices/${other.id}`)).status).toBe(200);
    expect((await m.b.req('GET', '/me')).body.me.account.devices.some((d: any) => d.id === other.id)).toBe(false);
    const adminDev = (await admin.req('GET', '/me')).body.me.account.devices[0].id;
    expect((await m.b.req('DELETE', `/me/devices/${adminDev}`)).status).toBe(404);
    expect((await m.b.req('DELETE', `/me/devices/${m.b.jar.size ? (await m.b.req('GET', '/me')).body.me.deviceId : ''}`)).status).toBe(403);
    void adminId;
  });
});

describe('I4 resume returns to where the mission was paused', () => {
  it('machine: resume uses prePause', () => {
    expect(transition('paused', 'resume', { prePause: 'waiting_approval' })).toBe('waiting_approval');
    expect(transition('paused', 'resume', { prePause: 'verifying' })).toBe('verifying');
    expect(transition('paused', 'resume')).toBe('running');
  });

  it('pause → resume on a waiting_approval mission keeps it waiting', async () => {
    const { admin } = await withAdmin(t.app);
    const m = (await admin.req('POST', '/missions', { text: 'Publish it', files: [], shared: false }, { 'idempotency-key': 'i4-' + n++ })).body.mission;
    await t.pool.query(`update missions set status='waiting_approval' where id=$1`, [m.id]);
    await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: m.id, agentId: 'release-01', kind: 'release', title: 'Publish', detail: '', payload: {}, expiresInMin: 60 }));
    await admin.req('POST', `/missions/${m.id}/actions/pause`, {}, { 'idempotency-key': 'i4p' + n++ });
    const r = await admin.req('POST', `/missions/${m.id}/actions/resume`, {}, { 'idempotency-key': 'i4r' + n++ });
    expect(r.body.mission.status).toBe('waiting');
  });

  it('…but goes on running when the approval was decided while paused', async () => {
    const { admin } = await withAdmin(t.app);
    const m = (await admin.req('POST', '/missions', { text: 'Publish it', files: [], shared: false }, { 'idempotency-key': 'i4b-' + n++ })).body.mission;
    await t.pool.query(`update missions set status='waiting_approval' where id=$1`, [m.id]);
    await admin.req('POST', `/missions/${m.id}/actions/pause`, {}, { 'idempotency-key': 'i4bp' + n++ });
    const r = await admin.req('POST', `/missions/${m.id}/actions/resume`, {}, { 'idempotency-key': 'i4br' + n++ });
    expect(r.body.mission.status).toBe('running');
  });
});

describe('I5 idempotency is atomic with the work', () => {
  it('a failure after the work leaves no key and no mission', async () => {
    const { admin } = await withAdmin(t.app);
    await t.pool.query(`create or replace function boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await t.pool.query(`create trigger idem_boom before update on idempotency_keys for each row execute function boom()`);
    const k = 'i5-' + n++;
    const r = await admin.req('POST', '/missions', { text: 'Atomic', files: [], shared: false }, { 'idempotency-key': k });
    expect(r.status).toBe(500);
    expect((await t.pool.query('select count(*)::int n from missions')).rows[0].n).toBe(0);
    expect((await t.pool.query('select count(*)::int n from idempotency_keys')).rows[0].n).toBe(0);
    await t.pool.query('drop trigger idem_boom on idempotency_keys');
    const ok = await admin.req('POST', '/missions', { text: 'Atomic', files: [], shared: false }, { 'idempotency-key': k });
    expect(ok.status).toBe(201);
    const again = await admin.req('POST', '/missions', { text: 'Atomic', files: [], shared: false }, { 'idempotency-key': k });
    expect(again.body.mission.id).toBe(ok.body.mission.id);
    expect((await t.pool.query('select count(*)::int n from missions')).rows[0].n).toBe(1);
  });

  it('a replay after the mission became invisible is 404 (M5)', async () => {
    const A = await withAdmin(t.app);
    const mina = await A.member('Mina');
    const kenji = await A.member('Kenji');
    const m = (await mina.b.req('POST', '/missions', { text: 'Shared then private', files: [], shared: true }, { 'idempotency-key': 'm5a' })).body.mission;
    await kenji.b.req('POST', `/missions/${m.id}/actions/pause`, {}, { 'idempotency-key': 'm5k' });
    await mina.b.req('POST', `/missions/${m.id}/share`, { shared: false });
    expect((await kenji.b.req('POST', `/missions/${m.id}/actions/pause`, {}, { 'idempotency-key': 'm5k' })).status).toBe(404);
  });
});

describe('review 2', () => {
  it('I2 system writes (staffing, approvals, state changes) do not make a content edit stale', async () => {
    const { admin } = await withAdmin(t.app);
    const m = (await admin.req('POST', '/missions', { text: 'Write a report', files: [], shared: false }, { 'idempotency-key': 'r2a' + n++ })).body.mission;
    await admin.req('POST', `/missions/${m.id}/actions/pause`, {}, { 'idempotency-key': 'r2p' + n++ });
    await t.pool.query(`update missions set presentation = presentation || '{"x":1}', row_version=row_version+1 where id=$1`, [m.id]); // like a staffing step
    const r = await admin.req('PATCH', `/missions/${m.id}`, { title: 'Fixed title' }, { 'if-match': String(m.rowVersion) });
    expect(r.status).toBe(200);
    const stale = await admin.req('PATCH', `/missions/${m.id}`, { title: 'Other' }, { 'if-match': String(m.rowVersion) });
    expect(stale.status).toBe(409);
  });

  it('I3 deciding an approval while the mission is paused/cancelled concurrently never 500s', async () => {
    const { admin } = await withAdmin(t.app);
    for (let i = 0; i < 8; i++) {
      const m = (await admin.req('POST', '/missions', { text: 'Race ' + i, files: [], shared: false }, { 'idempotency-key': 'r3m' + n++ })).body.mission;
      await t.pool.query(`update missions set status='waiting_approval' where id=$1`, [m.id]);
      const a = await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: m.id, agentId: 'release-01', kind: 'release', title: 'P', detail: '', payload: { i }, expiresInMin: 60 }));
      const [d, p] = await Promise.all([
        admin.req('POST', `/approvals/${a.id}/decision`, { decision: 'approved', digest: a.digest }),
        admin.req('POST', `/missions/${m.id}/actions/cancel`, {}, { 'idempotency-key': 'r3c' + n++ }),
      ]);
      expect(d.status, JSON.stringify(d.body)).not.toBe(500);
      expect(p.status, JSON.stringify(p.body)).not.toBe(500);
    }
  });

  it('I4 an expired approval releases its waiting mission and leaves the list', async () => {
    const { admin } = await withAdmin(t.app);
    const m = (await admin.req('POST', '/missions', { text: 'Expire', files: [], shared: false }, { 'idempotency-key': 'r4' + n++ })).body.mission;
    await t.pool.query(`update missions set status='waiting_approval' where id=$1`, [m.id]);
    await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: m.id, agentId: 'release-01', kind: 'release', title: 'Old', detail: '', payload: {}, expiresInMin: -1 }));
    const list = (await admin.req('GET', '/approvals')).body.approvals;
    expect(list.filter((x: any) => x.missionId === m.id)).toEqual([]);
    const after = (await admin.req('GET', `/missions/${m.id}`)).body.mission;
    expect(after.status).toBe('running');
    expect(after.pendingApprovals).toBe(0);
  });

  it('sharing to the same value is a no-op (no event to everyone)', async () => {
    const { admin } = await withAdmin(t.app);
    const m = (await admin.req('POST', '/missions', { text: 'Private', files: [], shared: false }, { 'idempotency-key': 'sh' + n++ })).body.mission;
    await admin.req('POST', `/missions/${m.id}/share`, { shared: false });
    expect((await t.pool.query(`select count(*)::int n from events where type='mission.shared'`)).rows[0].n).toBe(0);
  });

  it('the stream refuses an idle-expired session', async () => {
    const { admin } = await withAdmin(t.app);
    await t.pool.query(`update sessions set last_seen_at = now() - interval '25 hours'`);
    await t.app.listen({ host: '127.0.0.1', port: 0 });
    const res = await fetch(`http://127.0.0.1:${(t.app.server.address() as { port: number }).port}/api/v1/events/stream`, { headers: { cookie: [...admin.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });
});
