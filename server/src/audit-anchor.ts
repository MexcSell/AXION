import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, constants as fsc, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.ts';
import { canonical } from './approvals/service.ts';
import { audit, verifyChain } from './audit.ts';

/**
 * c49 (P5b): an audit-chain anchor held OUTSIDE the database. The chain (c31) proves internal consistency only: someone who can
 * write the DB can drop the newest rows or rehash everything. A checkpoint of every tenant's head, signed with a key that lives in
 * the server environment and appended to a file, makes both attacks detectable.
 *
 * File format: JSON lines, append-only. Each line is { v, n, batch, i, of, tenant, seq, rowHash, at, anchoredAt, sig }:
 *   n = 1-based line counter of the whole file (a deleted or inserted line leaves a gap),
 *   batch/i/of = the checkpoint a line belongs to, its position and the batch size (a half-deleted last checkpoint shows),
 *   sig = HMAC-SHA256(key, canonical(all other fields)).
 * Limits (honest): deleting the WHOLE final checkpoint cannot be told from "never anchored later" (a single-tenant checkpoint is one
 * line, so deleting that last line leaves an older, valid file). A missing or empty file IS reported (anchor_missing, never ok).
 * Whoever holds the key can recreate a whole file. Keep the key off the database host and copy the file's last line off-host.
 */
export const MIN_KEY_BYTES = 32;
export const MIN_DISTINCT_BYTES = 16;
export const DEFAULT_ANCHOR_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'audit-anchors.jsonl');

export type AnchorStatus = 'ok' | 'truncated' | 'rewritten' | 'bad_signature' | 'anchor_missing' | 'rolled_back' | 'insecure_file' | 'unreadable';
export interface AnchorLine { v: 1; n: number; batch: string; i: number; of: number; tenant: string; seq: number; rowHash: string; at: string; anchoredAt: string; sig: string }
export interface TenantAnchor { tenant: string; status: AnchorStatus; anchoredSeq: number | null; anchoredAt: string | null; reason?: string }
export interface AnchorReport { ok: boolean; configured: boolean; lastAnchorAt: string | null; lines: number; tenants: TenantAnchor[]; reason?: string }

export class AnchorError extends Error { constructor(m: string) { super(m); this.name = 'AnchorError'; } }

export interface AnchorSettings { key?: string; file?: string; domain?: string }
/** Key and file path come from the environment (a test may pass them in). The key is never returned to callers outside this module's HMAC. */
export function anchorSettings(over: AnchorSettings = {}, env: NodeJS.ProcessEnv = process.env): { key: string | undefined; file: string; domain: string | undefined } {
  return { key: over.key ?? (env.AUDIT_ANCHOR_KEY || undefined), file: over.file ?? (env.AUDIT_ANCHOR_FILE || DEFAULT_ANCHOR_FILE), domain: over.domain ?? (env.AUDIT_ANCHOR_DOMAIN || undefined) };
}
/** Domain separation (P2): the MAC also covers a deployment id, AUDIT_ANCHOR_DOMAIN, else "<database>:<schema>". A line signed for another deployment never verifies here. */
async function domainOf(db: Db, d: string | undefined): Promise<string> {
  if (d) return d;
  const r = (await db.query('select current_database() as d, current_schema() as s')).rows[0];
  return `axion-audit-anchor-v1:${r.d}:${r.s}`;
}
/** Fails closed: a missing or short key is an error, never a weaker signature. The message never contains the key. */
export function requireKey(key: string | undefined): Buffer {
  if (!key) throw new AnchorError('AUDIT_ANCHOR_KEY is not set');
  const b = Buffer.from(key, 'utf8');
  if (b.length < MIN_KEY_BYTES) throw new AnchorError(`AUDIT_ANCHOR_KEY is too short (need at least ${MIN_KEY_BYTES} bytes)`);
  if (new Set(b).size < MIN_DISTINCT_BYTES) throw new AnchorError(`AUDIT_ANCHOR_KEY is too repetitive (need at least ${MIN_DISTINCT_BYTES} distinct bytes; use openssl rand -hex 32)`);
  return b;
}

type Unsigned = Omit<AnchorLine, 'sig'>;
const sign = (key: Buffer, domain: string, l: Unsigned) => createHmac('sha256', key).update(canonical({ domain, line: l })).digest('hex');
const sameSig = (a: string, b: string) => { if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false; const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };

const AT_FMT = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** What is at the anchor path, without following a symlink. 'absent' | 'ok' | a reason it must not be trusted or written. */
export function inspectFile(file: string): { state: 'absent' | 'ok' | 'insecure_file' | 'unreadable'; reason?: string } {
  let st;
  try { st = lstatSync(file); } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable', reason: 'the anchor file cannot be examined' }; }
  if (st.isSymbolicLink()) return { state: 'insecure_file', reason: 'the anchor path is a symbolic link; refusing to follow it' };
  if (!st.isFile()) return { state: 'unreadable', reason: 'the anchor path is not a regular file' };
  if (st.mode & 0o022) return { state: 'insecure_file', reason: 'the anchor file is writable by group or others; run chmod 600 on it' };
  return { state: 'ok' };
}

/** Parse the file. Lines that are not JSON objects are returned as null (reported as bad_signature at their position). */
function readLines(file: string): (AnchorLine | null)[] {
  return readFileSync(file, 'utf8').split('\n').filter((s) => s.trim() !== '').map((s) => {
    try { const o = JSON.parse(s); return o && typeof o === 'object' ? (o as AnchorLine) : null; } catch { return null; }
  });
}
const wellFormed = (l: AnchorLine) => l.v === 1 && Number.isInteger(l.n) && Number.isInteger(l.i) && Number.isInteger(l.of) && Number.isInteger(l.seq) && l.seq >= 1
  && [l.batch, l.tenant, l.rowHash, l.at, l.anchoredAt, l.sig].every((x) => typeof x === 'string');

/**
 * Check every anchored head against the live chain, per tenant. Read-only. Never reports ok when it could not check:
 * no key, no file, or a tenant that has chain rows but no anchor line is `anchor_missing`.
 * Priority when several apply: bad_signature > rolled_back > truncated > rewritten.
 */
export async function verifyAnchors(db: Db, opts: AnchorSettings & { tenant?: string } = {}): Promise<AnchorReport> {
  const { key: rawKey, file, domain: rawDomain } = anchorSettings(opts);
  const heads = (await db.query('select tenant_id, max(seq)::bigint as seq from audit_events group by tenant_id order by tenant_id')).rows
    .filter((r) => !opts.tenant || r.tenant_id === opts.tenant) as { tenant_id: string; seq: string }[];
  const missing = (reason: string): AnchorReport => ({ ok: false, configured: false, lastAnchorAt: null, lines: 0, reason,
    tenants: heads.map((h) => ({ tenant: h.tenant_id, status: 'anchor_missing', anchoredSeq: null, anchoredAt: null, reason })) });
  let key: Buffer;
  try { key = requireKey(rawKey); } catch (e) { return missing((e as Error).message); }
  const domain = await domainOf(db, rawDomain);
  const fi = inspectFile(file);
  if (fi.state === 'absent') return missing('no anchor file yet (run npm run audit:anchor)');
  if (fi.state !== 'ok') return { ...missing(fi.reason!), configured: true, tenants: heads.map((h) => ({ tenant: h.tenant_id, status: fi.state as AnchorStatus, anchoredSeq: null, anchoredAt: null, reason: fi.reason })) };
  let lines: (AnchorLine | null)[];
  try { lines = readLines(file); } catch { const reason = 'the anchor file cannot be read'; return { ...missing(reason), configured: true, tenants: heads.map((h) => ({ tenant: h.tenant_id, status: 'unreadable' as AnchorStatus, anchoredSeq: null, anchoredAt: null, reason })) }; }
  const status = new Map<string, TenantAnchor>();
  const note = (tenant: string, s: AnchorStatus, reason: string, l?: AnchorLine) => {
    const rank: Record<AnchorStatus, number> = { ok: 0, anchor_missing: 0, rewritten: 1, truncated: 2, rolled_back: 3, bad_signature: 4, insecure_file: 5, unreadable: 5 };
    const cur = status.get(tenant);
    if (!cur) { status.set(tenant, { tenant, status: s, anchoredSeq: l?.seq ?? null, anchoredAt: l?.anchoredAt ?? null, ...(s === 'ok' ? {} : { reason }) }); return; }
    if (rank[s] > rank[cur.status]) { cur.status = s; cur.reason = reason; }
    if (l && (cur.anchoredSeq === null || l.seq > cur.anchoredSeq)) { cur.anchoredSeq = l.seq; cur.anchoredAt = l.anchoredAt; }
  };

  // 1. signatures; a bad line cannot be trusted for anything else, not even its tenant name, so it taints every tenant
  const good: AnchorLine[] = [];
  let badAt = 0;
  lines.forEach((l, idx) => {
    if (!l || !wellFormed(l) || !sameSig(l.sig, sign(key, domain, (({ sig: _s, ...rest }) => rest)(l)))) { if (!badAt) badAt = idx + 1; return; }
    good.push(l);
  });
  // 2. counter continuity (a deleted middle line, a deleted first line, an inserted/replayed line)
  let gapAt = 0;
  good.forEach((l, idx) => { if (!gapAt && l.n !== idx + 1 && !badAt) gapAt = idx + 1; });
  // 3. the last checkpoint must be complete (a deleted trailing line of a multi-tenant checkpoint)
  let partial = '';
  if (!badAt && good.length) {
    const last = good[good.length - 1];
    const inLast = good.filter((l) => l.batch === last.batch);
    if (inLast.length !== last.of) partial = `the last checkpoint has ${inLast.length} of ${last.of} lines`;
  }
  // 4. a line whose seq is older than an earlier line of the same tenant (a replayed or reordered line)
  const maxSeq = new Map<string, number>();
  const backward = new Set<string>();
  for (const l of good) { const m = maxSeq.get(l.tenant) ?? 0; if (l.seq < m) backward.add(l.tenant); else maxSeq.set(l.tenant, l.seq); }

  for (const h of heads) {
    const mine = good.filter((l) => l.tenant === h.tenant_id);
    if (!mine.length && !badAt) { note(h.tenant_id, 'anchor_missing', 'this tenant has audit rows but no anchor line yet'); continue; }
    // check every anchored (seq, row_hash) of this tenant in one query
    const r = mine.length ? (await db.query(
      `select a.seq, e.row_hash from unnest($2::bigint[]) with ordinality as a(seq, o) left join audit_events e on e.tenant_id = $1 and e.seq = a.seq order by a.o`,
      [h.tenant_id, mine.map((l) => l.seq)])).rows : [];
    mine.forEach((l, idx) => {
      const got = r[idx]?.row_hash as string | null | undefined;
      if (!got) note(h.tenant_id, 'truncated', `anchored seq ${l.seq} is no longer in the chain (head is ${h.seq})`, l);
      else if (got !== l.rowHash) note(h.tenant_id, 'rewritten', `the row at anchored seq ${l.seq} has a different hash`, l);
      else note(h.tenant_id, 'ok', '', l);
    });
    if (badAt) note(h.tenant_id, 'bad_signature', `anchor file line ${badAt} fails its signature`);
    if (gapAt) note(h.tenant_id, 'rolled_back', `anchor file line counter breaks at line ${gapAt} (a line was removed or inserted)`);
    if (partial) note(h.tenant_id, 'rolled_back', partial);
    if (backward.has(h.tenant_id)) note(h.tenant_id, 'rolled_back', 'an anchor line is older than an earlier one for this tenant');
  }
  // tenants that were anchored but no longer have any row at all
  const live = new Set((await db.query('select distinct tenant_id from audit_events')).rows.map((r) => r.tenant_id as string));
  for (const l of good) if (!live.has(l.tenant) && (!opts.tenant || l.tenant === opts.tenant)) note(l.tenant, 'truncated', `tenant ${l.tenant} has no audit rows left but was anchored at seq ${l.seq}`, l);
  if (badAt && !heads.length) return { ok: false, configured: true, lastAnchorAt: null, lines: lines.length, tenants: [], reason: `anchor file line ${badAt} fails its signature` };

  const tenants = [...status.values()].sort((a, b) => a.tenant.localeCompare(b.tenant));
  const last = good.length ? good.reduce((m, l) => (l.anchoredAt > m ? l.anchoredAt : m), '') : null;
  return { ok: tenants.length > 0 && tenants.every((t) => t.status === 'ok'), configured: true, lastAnchorAt: last, lines: lines.length, tenants,
    ...(tenants.length === 0 ? { reason: 'no audit rows to anchor' } : {}) };
}

/** Exclusive lock file, so two operators never both pick the same next counter. Stale locks are not guessed at: the error says what to do. */
async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = file + '.lock';
  let fd: number;
  try { fd = openSync(lock, 'wx', 0o600); } catch { throw new AnchorError('another anchor write is running, or a crashed one left its lock (see "Stale lock" in server/docs/audit-anchor.md before removing the .lock file next to the anchor file)'); }
  try { return await fn(); } finally { closeSync(fd); try { unlinkSync(lock); } catch { /* gone */ } }
}

export interface WriteResult { file: string; batch: string; written: { tenant: string; seq: number }[]; lastN: number; lastSig: string }
/**
 * Append a signed checkpoint of every tenant's head. The lock is taken FIRST, then the existing file is verified, the chains are
 * verified and the heads are read (one repeatable-read snapshot), so two writers can never append an older head after a newer one.
 * Refuses (and writes nothing) when the key is missing/weak, when a tenant's chain does not verify (never sign a broken chain), or
 * when the existing anchor file fails verification, is a symlink or is group/world-writable (never extend a tampered file).
 * The file is created with mode 600 (O_NOFOLLOW) and fsynced.
 */
export async function writeAnchor(db: Db, opts: AnchorSettings & { now?: () => Date } = {}): Promise<WriteResult> {
  const { key: rawKey, file, domain: rawDomain } = anchorSettings(opts);
  const key = requireKey(rawKey);
  const fi = inspectFile(file);
  if (fi.state !== 'absent' && fi.state !== 'ok') throw new AnchorError(`${fi.reason}; not writing`);
  mkdirSync(dirname(file), { recursive: true });
  return withLock(file, async () => {
    const domain = await domainOf(db, rawDomain);
    if (inspectFile(file).state === 'ok') {
      const rep = await verifyAnchors(db, { key: rawKey, file, domain: rawDomain });
      const bad = rep.tenants.find((t) => t.status !== 'ok' && t.status !== 'anchor_missing');
      if (bad || !rep.configured) throw new AnchorError(`the existing anchor file does not verify (${bad ? `${bad.tenant}: ${bad.status}` : rep.reason}); not extending it (see "Recovery" in server/docs/audit-anchor.md)`);
    }
    const c = await db.connect();
    let heads: { tenant_id: string; seq: string; row_hash: string; at: string }[];
    try {
      await c.query('begin isolation level repeatable read read only');
      heads = (await c.query(`select distinct on (tenant_id) tenant_id, seq, row_hash, to_char(at at time zone 'UTC', ${AT_FMT}) as at from audit_events order by tenant_id, seq desc`)).rows;
      await c.query('commit');
    } catch (e) { try { await c.query('rollback'); } catch { /* lost */ } throw e; } finally { c.release(); }
    if (!heads.length) throw new AnchorError('there are no audit rows to anchor');
    for (const h of heads) {
      const v = await verifyChain(db, h.tenant_id);
      if (!v.ok) throw new AnchorError(`the chain of ${h.tenant_id} is broken at seq ${v.firstBadSeq}; refusing to anchor it`);
    }
    const existing = inspectFile(file).state === 'ok' ? readLines(file).length : 0;
    const batch = randomUUID();
    const anchoredAt = (opts.now?.() ?? new Date()).toISOString();
    const out = heads.map((h, i): AnchorLine => {
      const u: Unsigned = { v: 1, n: existing + i + 1, batch, i: i + 1, of: heads.length, tenant: h.tenant_id, seq: Number(h.seq), rowHash: h.row_hash, at: h.at, anchoredAt };
      return { ...u, sig: sign(key, domain, u) };
    });
    const fd = openSync(file, fsc.O_WRONLY | fsc.O_APPEND | fsc.O_CREAT | fsc.O_NOFOLLOW, 0o600);
    try { writeSync(fd, out.map((l) => JSON.stringify(l) + '\n').join('')); fsyncSync(fd); } finally { closeSync(fd); }
    const last = out[out.length - 1];
    return { file, batch, written: out.map((l) => ({ tenant: l.tenant, seq: l.seq })), lastN: last.n, lastSig: last.sig };
  });
}

/**
 * Recovery for a file that does not verify: rename it to <file>.<timestamp>.bad (the evidence is kept, mode unchanged) and record
 * the event in the audit log of every tenant, so the archive itself is on the chain. The next audit:anchor starts a new file at n=1.
 * It never deletes anything, and it refuses a symlink.
 */
export async function rotateAnchor(db: Db, opts: AnchorSettings & { actor?: string; now?: () => Date } = {}): Promise<{ archived: string }> {
  const { file } = anchorSettings(opts);
  const fi = inspectFile(file);
  if (fi.state === 'absent') throw new AnchorError('there is no anchor file to rotate');
  if (fi.state === 'unreadable' || (fi.state === 'insecure_file' && /symbolic/.test(fi.reason ?? ''))) throw new AnchorError(`${fi.reason}; not rotating (inspect it by hand)`);
  const stamp = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const archived = `${file}.${stamp}.bad`;
  return withLock(file, async () => {
    renameSync(file, archived);
    const tenants = (await db.query('select distinct tenant_id from audit_events order by tenant_id')).rows.map((r) => r.tenant_id as string);
    for (const t of tenants) await audit(db, { tenantId: t, actor: opts.actor ?? 'operator', action: 'audit.anchor.rotated', subject: 'audit-anchor', result: 'ok', correlationId: 'anchor-rotate-' + stamp, detail: { archive: archived.split('/').pop() } });
    return { archived };
  });
}
