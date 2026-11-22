import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, badRequest, notFound } from '../errors.ts';
import { normalizeName } from './names.ts';
import { DEV, SID, WAIT, clear, newSession, requireAdmin, requireUser, revokeDeviceSessions, revokeUserSessions, setSid, setWait, sha256, shortId, cookieOpts } from './session.ts';
import { FailLimiter, addDevice, checkPassword, createUser, hashPassword, listAccounts, loadAccount } from './service.ts';
import { NAME_MIN, NAME_MAX, PASSWORD_MIN, NEW_PASSWORD_MIN, PASSWORD_MAX } from '../../../shared/contracts/src/index.ts';
import { emit } from '../events/hooks.ts';
import { createNotification } from '../notifications/routes.ts';
import { advisoryXactLock } from '../locks.ts';

const DeviceIn = z.object({ name: z.string().max(80).default('Browser'), kind: z.enum(['desktop', 'laptop', 'phone', 'tablet']).default('desktop'), browser: z.string().max(40).default('Browser') });
const ConnectIn = z.object({ name: z.string().max(200), password: z.string().max(PASSWORD_MAX), device: DeviceIn.default({ name: 'Browser', kind: 'desktop', browser: 'Browser' }) });
const AvatarIn = z.object({ kind: z.enum(['initials', 'image', 'robot']), hue: z.number().min(0).max(360), image: z.string().max(400_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Use a PNG, JPEG or WebP image.').optional(), robot: z.string().max(40).optional() });

export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of r.error.issues) fieldErrors[i.path.join('.') || '_'] = i.message;
    throw badRequest('Some fields are not valid.', fieldErrors);
  }
  return r.data;
}

function checkName(raw: string) {
  const n = normalizeName(raw);
  if (n.display.length < NAME_MIN) throw badRequest(`Enter a name of at least ${NAME_MIN} characters.`, { name: 'too short' });
  if (n.display.length > NAME_MAX) throw badRequest(`Use at most ${NAME_MAX} characters.`, { name: 'too long' });
  return n;
}

export async function meOf(req: FastifyRequest) {
  const c = await requireUser(req);
  const account = await loadAccount(req.server.db, c.tenantId, c.user.id);
  return { account: account!, deviceId: c.deviceId, csrf: c.csrf };
}

export default async function authRoutes(app: FastifyInstance) {
  const limiter = new FailLimiter(10, 60_000);
  const tenantId = app.cfg.tenantId;

  app.post('/auth/connect', async (req, reply) => {
    const b = parse(ConnectIn, req.body);
    const n = checkName(b.name);
    if (b.password.length < PASSWORD_MIN) throw badRequest(`The password needs at least ${PASSWORD_MIN} characters.`, { password: 'too short' });
    // I1: the limit is per name (every client reaches the API through the local proxy, so the address says nothing),
    // and an attempt is reserved before any await, so a parallel burst can't get past it.
    const lk = n.key;
    if (limiter.blocked(lk)) throw new ApiError('RATE_LIMITED', 429, 'Too many wrong passwords. Wait a minute and try again.', { retryable: true });
    const attempt = limiter.reserve(lk);
    let clientId = req.cookies[DEV];
    if (!clientId || !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) clientId = shortId('c');
    reply.setCookie(DEV, clientId, cookieOpts(365 * 86400));
    const clientKey = sha256(clientId); // only a hash of the device cookie is stored
    const cid = String(req.id);

    // I2: look the user up and check the password with no lock held; the registration lock is only for creating users.
    let u = (await app.db.query('select * from users where tenant_id=$1 and name_key=$2', [tenantId, n.key])).rows[0];
    let created: { kind: 'signedIn'; userId: string; deviceId: string; first: true } | { kind: 'waiting'; reason: 'user'; userId: string; deviceId: string } | null = null;
    if (!u) {
      const passHashNew = await hashPassword(b.password);
      const r = await tx(app.db, async (c) => {
        await advisoryXactLock(c, 'registration');
        const again = (await c.query('select * from users where tenant_id=$1 and name_key=$2', [tenantId, n.key])).rows[0];
        if (again) return { existing: again };
        const first = Number((await c.query('select count(*) from users where tenant_id=$1', [tenantId])).rows[0].count) === 0;
        const userId = await createUser(c, { tenantId, name: n.display, key: n.key, passHash: passHashNew, role: first ? 'admin' : 'member', status: first ? 'approved' : 'pending' });
        const deviceId = await addDevice(c, { tenantId, userId, clientId: clientKey, ...b.device, status: first ? 'approved' : 'pending' });
        await audit(c, { tenantId, actor: userId, action: first ? 'user.register.first-admin' : 'user.register', subject: userId, result: 'ok', correlationId: cid, detail: { device: deviceId } });
        if (first) return { created: { kind: 'signedIn' as const, userId, deviceId, first: true as const } };
        await emit(c, { tenantId, type: 'user.requested', subject: userId, adminOnly: true, payload: { userId, name: n.display, device: b.device.name } });
        await createNotification(c, { tenantId, adminsOnly: true, severity: 'warning', category: 'approval', title: `${n.display} wants to join`, body: `New user on ${b.device.name}. Approve or decline in Settings › Users.`, route: '/settings?tab=users', actionable: true });
        return { created: { kind: 'waiting' as const, reason: 'user' as const, userId, deviceId } };
      });
      if ('existing' in r) u = r.existing; else created = r.created;
    }
    if (!created && !(await checkPassword(u.pass_hash, b.password))) {
      // c31 fix round: the chain write takes locks (events + tenant) and can time out under load; the caller still gets the 401, and the failed audit write is logged
      try { await audit(app.db, { tenantId, actor: 'anonymous', action: 'auth.connect', subject: u.id, result: 'denied', correlationId: cid, detail: { reason: 'wrong password' } }); }
      catch (err) { req.log.error({ err, correlationId: cid }, 'audit write failed for a denied sign-in'); }
      throw new ApiError('WRONG_PASSWORD', 401, 'Wrong password for this name. A new name registers a new user.'); // the reserved attempt stays counted
    }
    limiter.release(lk, attempt);

    const out = created ?? await tx(app.db, async (c) => {
      const cur = (await c.query('select * from users where id=$1 and tenant_id=$2 for update', [u.id, tenantId])).rows[0];
      if (cur.status === 'disabled') return { kind: 'denied' as const, code: 'USER_DISABLED' as const, msg: 'This user is disabled. Ask the administrator.' };
      if (cur.status === 'rejected') return { kind: 'denied' as const, code: 'USER_REJECTED' as const, msg: 'An administrator declined this user.' };
      let d = (await c.query('select * from devices where user_id=$1 and client_id=$2', [cur.id, clientKey])).rows[0];
      if (!d) {
        const id = await addDevice(c, { tenantId, userId: cur.id, clientId: clientKey, ...b.device, status: 'pending' });
        d = { id, status: 'pending' };
        if (cur.status === 'approved') {
          await emit(c, { tenantId, type: 'user.requested', subject: cur.id, adminOnly: true, payload: { userId: cur.id, name: cur.name, device: b.device.name, deviceId: id } });
          await createNotification(c, { tenantId, adminsOnly: true, severity: 'warning', category: 'approval', title: `New device for ${cur.name}`, body: `${b.device.name} waits for approval in Settings › Users.`, route: '/settings?tab=users', actionable: true });
        }
      }
      if (d.status === 'blocked') return { kind: 'denied' as const, code: 'DEVICE_BLOCKED' as const, msg: 'This device is blocked for this user.' };
      if (cur.status === 'pending') return { kind: 'waiting' as const, reason: 'user' as const, userId: cur.id as string, deviceId: d.id as string };
      if (d.status === 'pending') return { kind: 'waiting' as const, reason: 'device' as const, userId: cur.id as string, deviceId: d.id as string };
      await audit(c, { tenantId, actor: cur.id, action: 'auth.connect', subject: cur.id, result: 'ok', correlationId: cid, detail: { device: d.id } });
      return { kind: 'signedIn' as const, userId: cur.id as string, deviceId: d.id as string, first: false };
    });

    if (out.kind === 'denied') throw new ApiError(out.code, 403, out.msg);
    if (out.kind === 'waiting') {
      const s = await newSession(app.db, { tenantId, userId: out.userId, deviceId: out.deviceId, kind: 'wait' });
      setWait(reply, s.token);
      clear(reply, SID);
      return reply.status(202).send({ state: 'waiting', reason: out.reason, name: n.display, device: { name: b.device.name } });
    }
    const s = await newSession(app.db, { tenantId, userId: out.userId, deviceId: out.deviceId, kind: 'full' });
    setSid(reply, s.token);
    clear(reply, WAIT);
    if (out.first) await app.onFirstAdmin?.(out.userId);
    const account = await loadAccount(app.db, tenantId, out.userId);
    return { state: 'signedIn', me: { account, deviceId: out.deviceId, csrf: s.csrf } };
  });

  app.get('/auth/wait', async (req, reply) => {
    const raw = req.cookies[WAIT];
    if (!raw) throw new ApiError('UNAUTHENTICATED', 401, 'Sign in first.');
    const h = sha256(raw);
    // I3: the ticket is read even when revoked, so a rejected / disabled / blocked waiting user learns why
    const r = (await app.db.query(
      `select s.user_id, s.device_id, s.revoked_at, s.expires_at < now() as expired, u.status, u.name, d.status as dev_status, d.name as dev_name
         from sessions s join users u on u.id=s.user_id left join devices d on d.id=s.device_id
        where s.token_hash=$1 and s.kind='wait' and s.tenant_id=$2`, [h, tenantId])).rows[0];
    if (!r) { clear(reply, WAIT); throw new ApiError('UNAUTHENTICATED', 401, 'Sign in again.'); }
    if (r.status === 'rejected') { clear(reply, WAIT); throw new ApiError('USER_REJECTED', 403, 'An administrator declined this user.'); }
    if (r.status === 'disabled') { clear(reply, WAIT); throw new ApiError('USER_DISABLED', 403, 'This user is disabled.'); }
    if (!r.dev_status || r.dev_status === 'blocked') { clear(reply, WAIT); throw new ApiError('DEVICE_BLOCKED', 403, 'This device is blocked for this user.'); }
    if (r.revoked_at || r.expired) { clear(reply, WAIT); throw new ApiError('UNAUTHENTICATED', 401, 'This request ended. Connect again.'); }
    if (r.status === 'pending' || r.dev_status === 'pending') return reply.status(202).send({ state: 'waiting', reason: r.status === 'pending' ? 'user' : 'device', name: r.name, device: { name: r.dev_name } });
    // approved: rotate the wait ticket into a full session (axor: new token on every auth step)
    const s = await tx(app.db, async (c) => {
      await c.query('update sessions set revoked_at=now() where token_hash=$1', [h]);
      await audit(c, { tenantId, actor: r.user_id, action: 'auth.connect', subject: r.user_id, result: 'ok', correlationId: String(req.id), detail: { device: r.device_id, after: 'approval' } });
      return newSession(c, { tenantId, userId: r.user_id, deviceId: r.device_id, kind: 'full' });
    });
    setSid(reply, s.token);
    clear(reply, WAIT);
    return { state: 'signedIn', me: { account: await loadAccount(app.db, tenantId, r.user_id), deviceId: r.device_id, csrf: s.csrf } };
  });

  app.get('/me', async (req) => ({ me: await meOf(req) }));

  /** Leave the waiting screen: the ticket is revoked (the registration itself stays for the admin to decide). */
  app.post('/auth/cancel', async (req, reply) => {
    const raw = req.cookies[WAIT];
    if (raw) await app.db.query(`update sessions set revoked_at=now() where token_hash=$1 and kind='wait'`, [sha256(raw)]);
    clear(reply, WAIT);
    return { ok: true };
  });

  /** Public: only whether the first (administrator) seat is still free, for the Connect screen's hint. */
  app.get('/auth/hello', async () => {
    const n = Number((await app.db.query('select count(*) from users where tenant_id=$1', [tenantId])).rows[0].count);
    return { firstEver: n === 0 };
  });

  /** Every signed-in user: the approved people (names and avatars only), e.g. mission owners and chat. */
  app.get('/people', async (req) => {
    const c = await requireUser(req);
    if (c.user.role === 'admin') return { people: await listAccounts(app.db, tenantId) };
    const us = (await app.db.query(`select * from users where tenant_id=$1 and status='approved' order by created_at`, [tenantId])).rows;
    // members see only what they need to show people: name, avatar, role (no approval or password metadata)
    return { people: us.map((u) => ({ id: u.id, name: u.name, role: u.role, status: u.status, avatar: u.avatar, devices: [], createdAt: new Date(u.created_at).getTime() })) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const c = await requireUser(req);
    await app.db.query('update sessions set revoked_at=now() where token_hash=$1', [c.tokenHash]);
    await audit(app.db, { tenantId, actor: c.user.id, action: 'auth.logout', subject: c.user.id, result: 'ok', correlationId: c.correlationId });
    clear(reply, SID);
    return { ok: true };
  });

  app.patch('/me', async (req) => {
    const c = await requireUser(req);
    const b = parse(z.object({ name: z.string().max(200).optional(), avatar: AvatarIn.optional() }), req.body);
    await tx(app.db, async (t) => {
      if (b.name !== undefined) {
        const n = checkName(b.name);
        const clash = (await t.query('select 1 from users where tenant_id=$1 and name_key=$2 and id<>$3', [tenantId, n.key, c.user.id])).rows[0];
        if (clash) throw new ApiError('NAME_TAKEN', 409, 'Another user already has this name.', { fieldErrors: { name: 'taken' } });
        await t.query('update users set name=$1, name_key=$2 where id=$3', [n.display, n.key, c.user.id]);
      }
      if (b.avatar) await t.query('update users set avatar=$1 where id=$2', [JSON.stringify(b.avatar), c.user.id]);
      await audit(t, { tenantId, actor: c.user.id, action: 'user.profile', subject: c.user.id, result: 'ok', correlationId: c.correlationId, detail: { name: b.name !== undefined, avatar: !!b.avatar } });
      await emit(t, { tenantId, actor: c.user.id, correlationId: c.correlationId, type: 'user.changed', subject: c.user.id, payload: { userId: c.user.id } });
    });
    return { me: { account: await loadAccount(app.db, tenantId, c.user.id), deviceId: c.deviceId, csrf: c.csrf } };
  });

  app.post('/me/password', async (req) => {
    const c = await requireUser(req);
    const b = parse(z.object({ current: z.string().max(PASSWORD_MAX), next: z.string().max(PASSWORD_MAX) }), req.body);
    const u = (await app.db.query('select pass_hash from users where id=$1', [c.user.id])).rows[0];
    if (!(await checkPassword(u.pass_hash, b.current))) throw new ApiError('WRONG_PASSWORD', 401, 'The current password is wrong.', { fieldErrors: { current: 'wrong' } });
    if (b.next.length < NEW_PASSWORD_MIN) throw badRequest(`Use at least ${NEW_PASSWORD_MIN} characters.`, { next: 'too short' });
    if (b.next === b.current) throw badRequest('The new password must differ from the current one.', { next: 'same' });
    const ph = await hashPassword(b.next);
    await tx(app.db, async (t) => {
      await t.query('update users set pass_hash=$1, password_changed_at=now() where id=$2', [ph, c.user.id]);
      await revokeUserSessions(t, c.user.id, c.tokenHash);
      await emit(t, { tenantId, actor: c.user.id, correlationId: c.correlationId, type: 'user.changed', subject: c.user.id, payload: { userId: c.user.id, passwordChanged: true } });
      await audit(t, { tenantId, actor: c.user.id, action: 'user.password', subject: c.user.id, result: 'ok', correlationId: c.correlationId });
    });
    return { ok: true };
  });

  /** M7: a user removes one of their own other devices (it must be approved again next time). */
  app.delete('/me/devices/:did', async (req) => {
    const c = await requireUser(req);
    const { did } = req.params as { did: string };
    if (did === c.deviceId) throw new ApiError('FORBIDDEN', 403, "You can't remove the device you are using. Sign out instead.");
    await tx(app.db, async (t) => {
      const d = (await t.query('select id from devices where id=$1 and user_id=$2 and tenant_id=$3 for update', [did, c.user.id, tenantId])).rows[0];
      if (!d) throw notFound('No such device.');
      await revokeDeviceSessions(t, did);
      await t.query('delete from devices where id=$1', [did]);
      await audit(t, { tenantId, actor: c.user.id, action: 'device.remove.self', subject: did, result: 'ok', correlationId: c.correlationId });
      await emit(t, { tenantId, actor: c.user.id, correlationId: c.correlationId, type: 'user.changed', subject: c.user.id, payload: { userId: c.user.id, deviceId: did } });
    });
    return { ok: true };
  });

  /* ---------------- administrators ---------------- */
  app.get('/users', async (req) => {
    await requireAdmin(req);
    return { users: await listAccounts(app.db, tenantId) };
  });

  const target = async (t: import('../db.ts').Tx, id: string) => {
    const u = (await t.query('select * from users where id=$1 and tenant_id=$2 for update', [id, tenantId])).rows[0];
    if (!u) throw notFound('No such user.');
    return u;
  };

  app.post('/users/:id/approve', async (req) => {
    const c = await requireAdmin(req);
    const { id } = req.params as { id: string };
    await tx(app.db, async (t) => {
      const u = await target(t, id);
      if (u.status === 'disabled') throw new ApiError('CONFLICT', 409, 'Enable this user instead.');
      await t.query(`update users set status='approved', approved_at=now(), approved_by=$1 where id=$2`, [c.user.name, id]);
      await t.query(`update devices set status='approved' where user_id=$1 and status='pending'`, [id]);
      await audit(t, { tenantId, actor: c.user.id, action: 'user.approve', subject: id, result: 'ok', correlationId: c.correlationId });
      await emit(t, { tenantId, actor: c.user.id, correlationId: c.correlationId, type: 'auth.approved', subject: id, payload: { userId: id } });
    });
    return { ok: true };
  });

  app.post('/users/:id/reject', async (req) => {
    const c = await requireAdmin(req);
    const { id } = req.params as { id: string };
    if (id === c.user.id) throw new ApiError('FORBIDDEN', 403, "You can't reject yourself.");
    await tx(app.db, async (t) => {
      const u = await target(t, id);
      if (u.role === 'admin') throw new ApiError('CONFLICT', 409, 'Demote this administrator first.');
      await t.query(`update users set status='rejected', approved_by=$1 where id=$2`, [c.user.name, id]);
      await revokeUserSessions(t, id);
      await audit(t, { tenantId, actor: c.user.id, action: 'user.reject', subject: id, result: 'ok', correlationId: c.correlationId });
      await emit(t, { tenantId, actor: c.user.id, correlationId: c.correlationId, type: 'user.changed', subject: id, payload: { userId: id, revoked: true } });
    });
    return { ok: true };
  });

  app.patch('/users/:id', async (req) => {
    const c = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ role: z.enum(['admin', 'member']).optional(), status: z.enum(['approved', 'disabled']).optional() }), req.body);
    await tx(app.db, async (t) => {
      await advisoryXactLock(t, 'registration');
      const u = await target(t, id);
      const losesAdmin = u.role === 'admin' && u.status === 'approved' && (b.role === 'member' || b.status === 'disabled');
      if (losesAdmin) {
        const others = Number((await t.query(`select count(*) from users where tenant_id=$1 and role='admin' and status='approved' and id<>$2`, [tenantId, id])).rows[0].count);
        if (others === 0) throw new ApiError('LAST_ADMIN', 409, 'This is the last administrator. Make someone else an administrator first.');
      }
      if (id === c.user.id && (b.role === 'member' || b.status === 'disabled')) throw new ApiError('FORBIDDEN', 403, "You can't demote or disable yourself. Ask another administrator.");
      if (b.role) await t.query('update users set role=$1 where id=$2', [b.role, id]);
      if (b.status) {
        if (b.status === 'approved' && u.status === 'pending') throw new ApiError('CONFLICT', 409, 'Use Approve for a waiting user.');
        await t.query('update users set status=$1 where id=$2', [b.status, id]);
        if (b.status === 'disabled') await revokeUserSessions(t, id);
      }
      await audit(t, { tenantId, actor: c.user.id, action: 'user.update', subject: id, result: 'ok', correlationId: c.correlationId, detail: b });
      await emit(t, { tenantId, actor: c.user.id, correlationId: c.correlationId, type: 'user.changed', subject: id, payload: { userId: id, ...(b.status === 'disabled' ? { revoked: true } : {}) } });
    });
    return { ok: true };
  });

  const deviceOf = async (t: import('../db.ts').Tx, uid: string, did: string) => {
    const d = (await t.query('select * from devices where id=$1 and user_id=$2 and tenant_id=$3 for update', [did, uid, tenantId])).rows[0];
    if (!d) throw notFound('No such device.');
    return d;
  };
  app.post('/users/:id/devices/:did/:action', async (req) => {
    const c = await requireAdmin(req);
    const { id, did, action } = req.params as { id: string; did: string; action: string };
    if (action !== 'approve' && action !== 'block') throw notFound();
    if (action === 'block' && did === c.deviceId) throw new ApiError('FORBIDDEN', 403, "You can't block the device you are using.");
    await tx(app.db, async (t) => {
      await deviceOf(t, id, did);
      await t.query('update devices set status=$1 where id=$2', [action === 'approve' ? 'approved' : 'blocked', did]);
      if (action === 'block') await revokeDeviceSessions(t, did);
      await audit(t, { tenantId, actor: c.user.id, action: `device.${action}`, subject: did, result: 'ok', correlationId: c.correlationId, detail: { user: id } });
      await emit(t, { tenantId, actor: c.user.id, correlationId: c.correlationId, type: action === 'approve' ? 'auth.approved' : 'user.changed', subject: id, payload: { userId: id, deviceId: did } });
    });
    return { ok: true };
  });

  app.delete('/users/:id/devices/:did', async (req) => {
    const c = await requireAdmin(req);
    const { id, did } = req.params as { id: string; did: string };
    if (did === c.deviceId) throw new ApiError('FORBIDDEN', 403, "You can't remove the device you are using.");
    await tx(app.db, async (t) => {
      await deviceOf(t, id, did);
      await revokeDeviceSessions(t, did);
      await t.query('delete from devices where id=$1', [did]);
      await audit(t, { tenantId, actor: c.user.id, action: 'device.remove', subject: did, result: 'ok', correlationId: c.correlationId, detail: { user: id } });
      await emit(t, { tenantId, actor: c.user.id, correlationId: c.correlationId, type: 'user.changed', subject: id, payload: { userId: id, deviceId: did } });
    });
    return { ok: true };
  });
}
