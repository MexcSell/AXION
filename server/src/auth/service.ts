import { hash, verify } from '@node-rs/argon2';
import type { Tx, Db } from '../db.ts';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { normalizeName } from './names.ts';
import { shortId } from './session.ts';
import type { AccountDto, DeviceDto } from '../../../shared/contracts/src/index.ts';

const ms = (d: Date | null | undefined) => (d ? new Date(d).getTime() : undefined);
const hueOf = (name: string) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

export const hashPassword = (p: string) => hash(p);
export const checkPassword = async (h: string, p: string) => { try { return await verify(h, p); } catch { return false; } };
export const defaultAvatar = (name: string) => ({ kind: 'initials', hue: hueOf(name) });

export function deviceDto(d: any): DeviceDto {
  return { id: d.id, name: d.name, kind: d.kind, browser: d.browser, status: d.status, addedAt: ms(d.added_at)!, lastSeenAt: ms(d.last_seen_at)! };
}
export function accountDto(u: any, devices: any[]): AccountDto {
  return {
    id: u.id, name: u.name, role: u.role, status: u.status, avatar: u.avatar, devices: devices.map(deviceDto),
    createdAt: ms(u.created_at)!, ...(u.approved_at ? { approvedAt: ms(u.approved_at) } : {}), ...(u.approved_by ? { approvedBy: u.approved_by } : {}),
    ...(u.password_changed_at ? { passwordChangedAt: ms(u.password_changed_at) } : {}),
  };
}

export async function loadAccount(c: Tx | Db, tenantId: string, userId: string): Promise<AccountDto | null> {
  const u = (await c.query('select * from users where id=$1 and tenant_id=$2', [userId, tenantId])).rows[0];
  if (!u) return null;
  const d = (await c.query('select * from devices where user_id=$1 order by added_at', [userId])).rows;
  return accountDto(u, d);
}

export async function listAccounts(c: Tx | Db, tenantId: string): Promise<AccountDto[]> {
  const us = (await c.query('select * from users where tenant_id=$1 order by created_at', [tenantId])).rows;
  const ds = (await c.query('select * from devices where tenant_id=$1 order by added_at', [tenantId])).rows;
  return us.map((u) => accountDto(u, ds.filter((d) => d.user_id === u.id)));
}

export async function createUser(c: Tx, a: { tenantId: string; name: string; key: string; passHash: string; role: 'admin' | 'member'; status: 'approved' | 'pending' }) {
  const id = shortId('u');
  await c.query(
    `insert into users(id, tenant_id, name, name_key, pass_hash, role, status, avatar, approved_at, approved_by) values ($1,$2,$3,$4,$5,$6,$7,$8, $9, $10)`,
    [id, a.tenantId, a.name, a.key, a.passHash, a.role, a.status, JSON.stringify(defaultAvatar(a.name)), a.status === 'approved' ? new Date() : null, a.status === 'approved' ? 'first sign-up' : null],
  );
  return id;
}

export async function addDevice(c: Tx, a: { tenantId: string; userId: string; clientId: string; name: string; kind: string; browser: string; status: 'approved' | 'pending' }) {
  const id = shortId('d');
  await c.query(`insert into devices(id, tenant_id, user_id, client_id, name, kind, browser, status) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, a.tenantId, a.userId, a.clientId, a.name.slice(0, 80), a.kind, a.browser.slice(0, 40), a.status]);
  return id;
}

/** Server-side recovery (D4): approve the newest pending device of a user. */
export async function approveNewestDevice(db: Db, tenantId: string, rawName: string) {
  const { key } = normalizeName(rawName);
  return tx(db, async (c) => {
    const u = (await c.query('select id, name from users where tenant_id=$1 and name_key=$2', [tenantId, key])).rows[0];
    if (!u) return { approved: false as const, reason: 'no such user' };
    const d = (await c.query(`select id, name from devices where user_id=$1 and status='pending' order by added_at desc limit 1`, [u.id])).rows[0];
    if (!d) return { approved: false as const, reason: 'no pending device' };
    await c.query(`update devices set status='approved' where id=$1`, [d.id]);
    await audit(c, { tenantId, actor: 'cli', action: 'device.approve', subject: d.id, result: 'ok', correlationId: 'cli-' + Date.now(), detail: { user: u.id, via: 'admin:approve-device' } });
    return { approved: true as const, userId: u.id as string, deviceId: d.id as string, device: d.name as string };
  });
}

/** Sliding-window failure counter per (ip, name). */
export class FailLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max = 10, private windowMs = 60_000) {}
  blocked(k: string) { return this.recent(k).length >= this.max; }
  fail(k: string) { const r = this.recent(k); r.push(Date.now()); this.hits.set(k, r); }
  private recent(k: string) { const now = Date.now(); return (this.hits.get(k) ?? []).filter((t) => now - t < this.windowMs); }
}
