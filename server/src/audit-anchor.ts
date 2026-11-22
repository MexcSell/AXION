import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, constants as fsc, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.ts';
import { canonical } from './approvals/service.ts';
import { audit, verifyChain } from './audit.ts';
import { tx } from './db.ts';

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
export const MIN_DISTINCT_BYTES = 8; // not 16: a hex key (openssl rand -hex 32) has only 16 symbols, and a random one often shows 14 or 15
export const DEFAULT_ANCHOR_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'audit-anchors.jsonl');

export type AnchorStatus = 'ok' | 'truncated' | 'rewritten' | 'bad_signature' | 'anchor_missing' | 'rolled_back' | 'insecure_file' | 'unreadable';
export interface RotatedFrom { sha256: string; archive: string; at: string }
export interface AnchorLine { v: 1; n: number; batch: string; i: number; of: number; tenant: string; seq: number; rowHash: string; at: string; anchoredAt: string; rotatedFrom?: RotatedFrom; sig: string }
export interface TenantAnchor { tenant: string; status: AnchorStatus; anchoredSeq: number | null; anchoredAt: string | null; reason?: string }
export interface AnchorReport { ok: boolean; configured: boolean; lastAnchorAt: string | null; lines: number; tenants: TenantAnchor[]; reason?: string; /** the file's first line says it replaced an archived file (signed, so it survives a database tamperer) */ rotatedFrom?: RotatedFrom }

export class AnchorError extends Error { constructor(m: string) { super(m); this.name = 'AnchorError'; } }

export interface AnchorSettings { key?: string; file?: string; domain?: string }
/** Key and file path come from the environment (a test may pass them in). The key is never returned to callers outside this module's HMAC. */
export function anchorSettings(over: AnchorSettings = {}, env: NodeJS.ProcessEnv = process.env): { key: string | undefined; file: string; domain: string | undefined } {
  return { key: over.key ?? (env.AUDIT_ANCHOR_KEY || undefined), file: over.file ?? (env.AUDIT_ANCHOR_FILE || DEFAULT_ANCHOR_FILE), domain: over.domain ?? (env.AUDIT_ANCHOR_DOMAIN || undefined) };
}
/** Domain separation (P2): the MAC covers a deployment id, AUDIT_ANCHOR_DOMAIN. It is REQUIRED (no default): a default derived from the
 * database name would make a restore check against a differently named database fail with the same status as tampering. */
export function requireDomain(d: string | undefined): string {
  if (!d) throw new AnchorError('AUDIT_ANCHOR_DOMAIN is not set (no domain: a fixed deployment id, for example axion-prod, that survives a restore into another database name)');
  return d;
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
  let domain: string;
  try { domain = requireDomain(rawDomain); } catch (e) { return missing((e as Error).message); }
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
  const first = good[0];
  const rotatedFrom = first && first.n === 1 && first.rotatedFrom && typeof first.rotatedFrom === 'object' ? first.rotatedFrom : undefined;
  const last = good.length ? good.reduce((m, l) => (l.anchoredAt > m ? l.anchoredAt : m), '') : null;
  return { ok: tenants.length > 0 && tenants.every((t) => t.status === 'ok'), configured: true, lastAnchorAt: last, lines: lines.length, tenants, ...(rotatedFrom ? { rotatedFrom } : {}),
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

/** The checkpoint itself, to be called with the lock held. */
async function appendCheckpoint(db: Db, o: { key: Buffer; rawKey: string | undefined; file: string; domain: string; rawDomain: string | undefined; now?: () => Date; rotatedFrom?: RotatedFrom }): Promise<WriteResult> {
  const { key, file, domain } = o;
  if (inspectFile(file).state === 'ok') {
    const rep = await verifyAnchors(db, { key: o.rawKey, file, domain: o.rawDomain });
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
  const anchoredAt = (o.now?.() ?? new Date()).toISOString();
  const out = heads.map((h, i): AnchorLine => {
    const u: Unsigned = { v: 1, n: existing + i + 1, batch, i: i + 1, of: heads.length, tenant: h.tenant_id, seq: Number(h.seq), rowHash: h.row_hash, at: h.at, anchoredAt, ...(existing + i === 0 && o.rotatedFrom ? { rotatedFrom: o.rotatedFrom } : {}) };
    return { ...u, sig: sign(key, domain, u) };
  });
  const fd = openSync(file, fsc.O_WRONLY | fsc.O_APPEND | fsc.O_CREAT | fsc.O_NOFOLLOW, 0o600);
  try { writeSync(fd, out.map((l) => JSON.stringify(l) + '\n').join('')); fsyncSync(fd); } finally { closeSync(fd); }
  const last = out[out.length - 1];
  return { file, batch, written: out.map((l) => ({ tenant: l.tenant, seq: l.seq })), lastN: last.n, lastSig: last.sig };
}

/**
 * Append a signed checkpoint of every tenant's head. The lock is taken FIRST, then the existing file is verified, the chains are
 * verified and the heads are read (one repeatable-read snapshot), so two writers can never append an older head after a newer one.
 * Refuses (and writes nothing) when the key or the domain is missing/weak, when a tenant's chain does not verify (never sign a broken
 * chain), or when the existing anchor file fails verification, is a symlink or is group/world-writable (never extend a tampered file).
 * The file is created with mode 600 (O_NOFOLLOW) and fsynced.
 */
export async function writeAnchor(db: Db, opts: AnchorSettings & { now?: () => Date } = {}): Promise<WriteResult> {
  const { key: rawKey, file, domain: rawDomain } = anchorSettings(opts);
  const key = requireKey(rawKey);
  const domain = requireDomain(rawDomain);
  const fi = inspectFile(file);
  if (fi.state !== 'absent' && fi.state !== 'ok') throw new AnchorError(`${fi.reason}; not writing`);
  mkdirSync(dirname(file), { recursive: true });
  return withLock(file, () => appendCheckpoint(db, { key, rawKey, file, domain, rawDomain, now: opts.now }));
}

export interface AnchorState { lines: number; lastN: number | null; lastSig: string | null; report: AnchorReport }
/** What `--rotate` shows the operator before it acts: the verification result and the old file's last line. Read-only. */
export async function anchorState(db: Db, opts: AnchorSettings = {}): Promise<AnchorState> {
  const { file } = anchorSettings(opts);
  const report = await verifyAnchors(db, opts);
  let lastN: number | null = null; let lastSig: string | null = null; let lines = 0;
  if (inspectFile(file).state !== 'absent' && !/symbolic/.test(inspectFile(file).reason ?? '')) {
    try { const ls = readLines(file); lines = ls.length; const l = ls[ls.length - 1]; lastN = l && Number.isInteger(l.n) ? l.n : lines || null; lastSig = l && typeof l.sig === 'string' ? l.sig : null; } catch { /* reported by verify */ }
  }
  return { lines, lastN, lastSig, report };
}

export interface RotateOpts extends AnchorSettings { confirm?: number | string; force?: boolean; actorNote?: string; now?: () => Date; failAfter?: 'audit' | 'rename' }
/**
 * Recovery for a file that does not verify. Needs the key (so a database-only operator cannot launder), the old file's last line
 * number as `confirm`, and `force` when the file still verifies ok. Order, so a failure leaves a clear state:
 *   1. the audit events (one transaction, all tenants; real OS user, sha256 of the archive, last line, status) -- nothing else changed yet;
 *   2. rename the file to <file>.<timestamp>.bad (kept as evidence, never deleted);
 *   3. write the new file; its first line SIGNS rotatedFrom = {sha256 of the archive, archive name, time}, so the restart is visible
 *      to every later verify even if the audit events are deleted from the database.
 * If step 2 or 3 fails the old file is put back and the error says what to do. Steps 2-3 failing after step 1 leaves the events in the
 * chain; a retry adds a second event, which is expected.
 */
export async function rotateAnchor(db: Db, opts: RotateOpts = {}): Promise<{ archived: string; sha256: string; oldLastN: number; lastN: number }> {
  const { key: rawKey, file, domain: rawDomain } = anchorSettings(opts);
  const key = requireKey(rawKey);
  const domain = requireDomain(rawDomain);
  const fi = inspectFile(file);
  if (fi.state === 'absent') throw new AnchorError('there is no anchor file to rotate');
  if (fi.state === 'unreadable' || (fi.state === 'insecure_file' && /symbolic/.test(fi.reason ?? ''))) throw new AnchorError(`${fi.reason}; not rotating (inspect it by hand)`);
  mkdirSync(dirname(file), { recursive: true });
  return withLock(file, async () => {
    const st = await anchorState(db, { key: rawKey, file, domain: rawDomain });
    if (st.lastN === null) throw new AnchorError('the anchor file has no lines to rotate; remove the empty file by hand');
    if (String(opts.confirm ?? '') !== String(st.lastN)) throw new AnchorError(`rotation needs --confirm ${st.lastN} (the old file's last line number); the old file's state is: ${st.report.ok ? 'ok' : st.report.tenants.map((t) => `${t.tenant} ${t.status}`).join(', ') || st.report.reason}`);
    if (st.report.ok && !opts.force) throw new AnchorError('the old anchor file still verifies ok; refusing to rotate it without --force');
    const bytes = readFileSync(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const at = (opts.now?.() ?? new Date()).toISOString();
    const archived = `${file}.${at.replace(/[:.]/g, '-')}.bad`;
    const osUser = userInfo().username;
    const stateText = st.report.ok ? 'ok' : st.report.tenants.map((t) => `${t.tenant}:${t.status}`).join(',') || (st.report.reason ?? 'unknown');
    // 1. all events in one transaction, before anything is renamed
    await tx(db, async (c) => {
      const tenants = (await c.query('select distinct tenant_id from audit_events order by tenant_id')).rows.map((r) => r.tenant_id as string);
      for (const t of tenants) await audit(c, { tenantId: t, actor: osUser, action: 'audit.anchor.rotated', subject: 'audit-anchor', result: 'ok', correlationId: 'anchor-rotate-' + at,
        detail: { archive: archived.split('/').pop(), archiveSha256: sha256, oldLastLine: st.lastN, stateBefore: stateText, forced: !!opts.force, osUser, ...(opts.actorNote ? { note: opts.actorNote } : {}) } });
      if (opts.failAfter === 'audit') throw new Error('injected failure after the audit events');
    });
    // 2 + 3. rename, then the new file with the signed rotatedFrom; on failure the old file goes back
    try {
      renameSync(file, archived);
      if (opts.failAfter === 'rename') throw new Error('injected failure after the rename');
      const w = await appendCheckpoint(db, { key, rawKey, file, domain, rawDomain, now: opts.now, rotatedFrom: { sha256, archive: archived.split('/').pop()!, at } });
      return { archived, sha256, oldLastN: st.lastN, lastN: w.lastN };
    } catch (e) {
      let restored = false;
      try { if (inspectFile(file).state === 'absent') { renameSync(archived, file); restored = true; } else if (inspectFile(file).state === 'ok') { /* the new file exists, the old one is archived */ } } catch { /* reported below */ }
      throw new AnchorError(restored
        ? `rotation failed after its audit events were recorded (${(e as Error).message}); the old file was put back. Fix the cause and run the rotation again (a second audit.anchor.rotated event is expected).`
        : `rotation failed (${(e as Error).message}) and the old file could not be put back automatically: it is at ${archived}. Recovery: if ${file} does not exist, run \`mv ${archived} ${file}\`, then repeat the rotation.`);
    }
  });
}
