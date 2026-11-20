import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, Browser, withAdmin, type TestApp } from './helpers.ts';
import { normalizeName } from '../src/auth/names.ts';
import { approveNewestDevice } from '../src/auth/service.ts';

let t: TestApp;
beforeEach(async () => { t = await makeTestApp(); });
afterEach(async () => { await t.close(); });

describe('names', () => {
  it('trims, collapses spaces, NFC and lower-cases the key', () => {
    expect(normalizeName('  Luca   Rossi ')).toEqual({ display: 'Luca Rossi', key: 'luca rossi' });
    expect(normalizeName('LUCA').key).toBe(normalizeName('luca').key);
    expect(normalizeName('Café').display).toBe('Café');
  });
});

describe('connect', () => {
  it('the first connect creates a signed-in admin', async () => {
    const a = new Browser(t.app);
    const r = await a.connect('Luca', 'pass1234');
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('signedIn');
    expect(r.body.me.account.role).toBe('admin');
    expect(r.body.me.account.status).toBe('approved');
    expect(a.jar.has('axion_sid')).toBe(true);
    expect(a.jar.has('axion_dev')).toBe(true);
    const me = await a.req('GET', '/me');
    expect(me.status).toBe(200);
    expect(me.body.me.account.name).toBe('Luca');
  });

  it('session cookie is HttpOnly and SameSite=Strict', async () => {
    const r = await new Browser(t.app).connect('Luca', 'pass1234');
    const sid = (r.raw.cookies as any[]).find((c) => c.name === 'axion_sid');
    expect(sid.httpOnly).toBe(true);
    expect(String(sid.sameSite).toLowerCase()).toBe('strict');
  });

  it('a second name waits for an admin, then /auth/wait signs it in', async () => {
    const { admin } = await withAdmin(t.app);
    const b = new Browser(t.app);
    const w = await b.connect('Mina', 'minapass');
    expect(w.status).toBe(202);
    expect(w.body).toMatchObject({ state: 'waiting', reason: 'user' });
    expect(b.jar.has('axion_sid')).toBe(false);
    expect((await b.req('GET', '/auth/wait')).status).toBe(202);
    expect((await b.req('GET', '/me')).status).toBe(401);
    const users = (await admin.req('GET', '/users')).body.users;
    const mina = users.find((u: any) => u.name === 'Mina');
    expect(mina.status).toBe('pending');
    expect((await admin.req('POST', `/users/${mina.id}/approve`)).status).toBe(200);
    const ok = await b.req('GET', '/auth/wait');
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe('signedIn');
    expect(b.jar.has('axion_sid')).toBe(true);
    expect((await b.req('GET', '/me')).body.me.account.role).toBe('member');
  });

  it('a known user on a new device waits for device approval', async () => {
    const { admin, adminId } = await withAdmin(t.app);
    const phone = new Browser(t.app);
    const w = await phone.connect('Luca', 'pass1234', { name: 'Safari on iOS', kind: 'phone', browser: 'Safari' });
    expect(w.status).toBe(202);
    expect(w.body.reason).toBe('device');
    const users = (await admin.req('GET', '/users')).body.users;
    const dev = users.find((u: any) => u.id === adminId).devices.find((d: any) => d.status === 'pending');
    expect(dev.name).toBe('Safari on iOS');
    expect((await admin.req('POST', `/users/${adminId}/devices/${dev.id}/approve`)).status).toBe(200);
    expect((await phone.req('GET', '/auth/wait')).status).toBe(200);
  });

  it('names that only look different are one account; a wrong password never creates one', async () => {
    await withAdmin(t.app);
    const b = new Browser(t.app);
    const b2 = new Browser(t.app);
    b2.jar = b.jar; // same browser
    const again = await new Browser(t.app).connect(' luca ', 'pass1234');
    expect(again.status).toBe(202); // new browser = new device of the SAME account
    expect(again.body.reason).toBe('device');
    const wrong = await new Browser(t.app).connect('LUCA', 'nope-nope');
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('WRONG_PASSWORD');
    const n = await t.pool.query('select count(*)::int as n from users');
    expect(n.rows[0].n).toBe(1);
  });

  it('enforces name ≥ 2 and password ≥ 4', async () => {
    expect((await new Browser(t.app).connect('L', 'pass1234')).body.code).toBe('VALIDATION');
    expect((await new Browser(t.app).connect('Luca', 'abc')).body.code).toBe('VALIDATION');
  });

  it('disabling a signed-in user revokes their session', async () => {
    const { admin, member } = await withAdmin(t.app);
    const m = await member('Mina');
    expect((await m.b.req('GET', '/me')).status).toBe(200);
    expect((await admin.req('PATCH', `/users/${m.id}`, { status: 'disabled' })).status).toBe(200);
    const r = await m.b.req('GET', '/me');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SESSION_REVOKED');
    expect((await new Browser(t.app).connect('Mina', 'pass1234')).body.code).toBe('USER_DISABLED');
  });

  it('a write without X-CSRF is refused', async () => {
    const { admin } = await withAdmin(t.app);
    const csrf = admin.csrf;
    admin.csrf = '';
    const r = await admin.req('POST', '/auth/logout', {});
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF');
    admin.csrf = csrf;
    expect((await admin.req('POST', '/auth/logout', {})).status).toBe(200);
  });

  it('a cross-site Origin is refused', async () => {
    const r = await new Browser(t.app).req('POST', '/auth/connect', { name: 'Luca', password: 'pass1234', device: { name: 'x', kind: 'desktop', browser: 'x' } }, { origin: 'https://evil.example', host: 'localhost:5191' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF');
  });

  it('the 11th failed connect for one name within a minute is rate limited (per name, any address)', async () => {
    await withAdmin(t.app);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await new Browser(t.app, '10.0.0.9').connect('Luca', 'wrong-' + i)).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    // review I1: the client address can't be trusted behind the local proxy, so the limit is per name
    expect((await new Browser(t.app, '10.0.0.8').connect('Luca', 'wrong')).status).toBe(429);
    // another name is not affected
    expect((await new Browser(t.app, '10.0.0.9').connect('Mina', 'minapass')).status).toBe(202);
  });

  it('a member cannot call admin routes', async () => {
    const { member, adminId } = await withAdmin(t.app);
    const m = await member('Mina');
    expect((await m.b.req('GET', '/users')).status).toBe(403);
    expect((await m.b.req('PATCH', `/users/${adminId}`, { role: 'member' })).status).toBe(403);
  });

  it('stores only argon2id hashes and never logs passwords', async () => {
    await withAdmin(t.app);
    const u = await t.pool.query('select pass_hash from users');
    expect(u.rows[0].pass_hash.startsWith('$argon2id$')).toBe(true);
    const all = JSON.stringify((await t.pool.query('select * from users')).rows) + JSON.stringify((await t.pool.query('select * from audit_events')).rows);
    expect(all).not.toContain('pass1234');
    expect((await t.pool.query(`select count(*)::int n from audit_events where detail ? 'password'`)).rows[0].n).toBe(0);
  });

  it('two parallel first connects give exactly one admin', async () => {
    const [a, b] = await Promise.all([new Browser(t.app).connect('Alpha', 'pass1234'), new Browser(t.app).connect('Beta', 'pass1234')]);
    expect([a.status, b.status].sort()).toEqual([200, 202]);
    expect((await t.pool.query(`select count(*)::int n from users where role='admin'`)).rows[0].n).toBe(1);
  });

  it('approveNewestDevice lets a locked-out admin back in', async () => {
    await withAdmin(t.app);
    const nb = new Browser(t.app);
    expect((await nb.connect('Luca', 'pass1234')).status).toBe(202);
    const r = await approveNewestDevice(t.app.db, t.app.cfg.tenantId, 'luca');
    expect(r.approved).toBe(true);
    expect((await nb.req('GET', '/auth/wait')).status).toBe(200);
  });

  it('keeps the last admin: cannot demote or disable yourself', async () => {
    const { admin, adminId } = await withAdmin(t.app);
    const r = await admin.req('PATCH', `/users/${adminId}`, { role: 'member' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('LAST_ADMIN');
  });

  it('a password change revokes the other sessions and keeps this one', async () => {
    const { admin } = await withAdmin(t.app);
    const phone = new Browser(t.app);
    await phone.connect('Luca', 'pass1234', { name: 'Safari on iOS', kind: 'phone', browser: 'Safari' });
    await approveNewestDevice(t.app.db, t.app.cfg.tenantId, 'luca');
    expect((await phone.req('GET', '/auth/wait')).status).toBe(200);
    expect((await admin.req('POST', '/me/password', { current: 'pass1234', next: 'longer-pass-1' })).status).toBe(200);
    expect((await admin.req('GET', '/me')).status).toBe(200);
    expect((await phone.req('GET', '/me')).status).toBe(401);
    expect((await admin.req('POST', '/me/password', { current: 'wrong', next: 'longer-pass-2' })).body.code).toBe('WRONG_PASSWORD');
  });

  it('profile rename keeps names unique', async () => {
    const { admin, member } = await withAdmin(t.app);
    await member('Mina');
    expect((await admin.req('PATCH', '/me', { name: ' mina ' })).body.code).toBe('NAME_TAKEN');
    const ok = await admin.req('PATCH', '/me', { name: 'Luca R', avatar: { kind: 'initials', hue: 20 } });
    expect(ok.status).toBe(200);
    expect(ok.body.me.account.name).toBe('Luca R');
  });

  it('logout ends the session', async () => {
    const { admin } = await withAdmin(t.app);
    await admin.req('POST', '/auth/logout', {});
    expect((await admin.req('GET', '/me')).status).toBe(401);
  });
});

describe('directory and hello', () => {
  it('hello tells whether the first account is still free', async () => {
    expect((await new Browser(t.app).req('GET', '/auth/hello')).body.firstEver).toBe(true);
    await withAdmin(t.app);
    expect((await new Browser(t.app).req('GET', '/auth/hello')).body.firstEver).toBe(false);
  });

  it('members see approved people without devices; strangers get 401', async () => {
    const { member } = await withAdmin(t.app);
    const m = await member('Mina');
    await new Browser(t.app).connect('Tomo', 'tomopass');
    const r = await m.b.req('GET', '/people');
    expect(r.status).toBe(200);
    expect(r.body.people.map((p: any) => p.name).sort()).toEqual(['Luca', 'Mina']);
    expect(r.body.people[0].devices).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(/pass_hash|client_id/);
    expect((await new Browser(t.app).req('GET', '/people')).status).toBe(401);
  });
});

describe('cancel waiting', () => {
  it('drops the waiting ticket', async () => {
    await withAdmin(t.app);
    const b = new Browser(t.app);
    await b.connect('Tomo', 'tomopass');
    expect((await b.req('GET', '/auth/wait')).status).toBe(202);
    expect((await b.req('POST', '/auth/cancel', {})).status).toBe(200);
    expect((await b.req('GET', '/auth/wait')).status).toBe(401);
  });
});
