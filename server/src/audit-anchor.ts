import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.ts';
import { canonical } from './approvals/service.ts';
import { verifyChain } from './audit.ts';

/**
 * c49 (P5b): an audit-chain anchor held OUTSIDE the database. The chain (c31) proves internal consistency only: someone who can
 * write the DB can drop the newest rows or rehash everything. A checkpoint of every tenant's head, signed with a key that lives in
 * the server environment and appended to a file, makes both attacks detectable.
 *
 * File format: JSON lines, append-only. Each line is { v, n, batch, i, of, tenant, seq, rowHash, at, anchoredAt, sig }:
 *   n = 1-based line counter of the whole file (a deleted or inserted line leaves a gap),
 *   batch/i/of = the checkpoint a line belongs to, its position and the batch size (a half-deleted last checkpoint shows),
 *   sig = HMAC-SHA256(key, canonical(all other fields)).
 * Limits (honest): deleting the WHOLE final checkpoint, or the file itself plus the key, cannot be detected from the file; a
 * single-tenant checkpoint is one line, so deleting that last line looks like "never anchored later". Whoever holds the key can
 * forge anything. Keep the key off the database host and copy the file off-host to close those.
 */
export const MIN_KEY_BYTES = 32;
export const DEFAULT_ANCHOR_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'audit-anchors.jsonl');

export type AnchorStatus = 'ok' | 'truncated' | 'rewritten' | 'bad_signature' | 'anchor_missing' | 'rolled_back';
export interface AnchorLine { v: 1; n: number; batch: string; i: number; of: number; tenant: string; seq: number; rowHash: string; at: string; anchoredAt: string; sig: string }
export interface TenantAnchor { tenant: string; status: AnchorStatus; anchoredSeq: number | null; anchoredAt: string | null; reason?: string }
export interface AnchorReport { ok: boolean; configured: boolean; lastAnchorAt: string | null; lines: number; tenants: TenantAnchor[]; reason?: string }

export class AnchorError extends Error { constructor(m: string) { super(m); this.name = 'AnchorError'; } }

export interface AnchorSettings { key?: string; file?: string }
/** Key and file path come from the environment (a test may pass them in). The key is never returned to callers outside this module's HMAC. */
export function anchorSettings(over: AnchorSettings = {}, env: NodeJS.ProcessEnv = process.env): { key: string | undefined; file: string } {
  return { key: over.key ?? (env.AUDIT_ANCHOR_KEY || undefined), file: over.file ?? (env.AUDIT_ANCHOR_FILE || DEFAULT_ANCHOR_FILE) };
}
/** Fails closed: a missing or short key is an error, never a weaker signature. The message never contains the key. */
export function requireKey(key: string | undefined): Buffer {
  if (!key) throw new AnchorError('AUDIT_ANCHOR_KEY is not set');
  const b = Buffer.from(key, 'utf8');
  if (b.length < MIN_KEY_BYTES) throw new AnchorError(`AUDIT_ANCHOR_KEY is too short (need at least ${MIN_KEY_BYTES} bytes)`);
  return b;
}

type Unsigned = Omit<AnchorLine, 'sig'>;
const sign = (key: Buffer, l: Unsigned) => createHmac('sha256', key).update(canonical(l)).digest('hex');
const sameSig = (a: string, b: string) => { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };

const AT_FMT = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

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
  const { key: rawKey, file } = anchorSettings(opts);
  const heads = (await db.query('select tenant_id, max(seq)::bigint as seq from audit_events group by tenant_id order by tenant_id')).rows
    .filter((r) => !opts.tenant || r.tenant_id === opts.tenant) as { tenant_id: string; seq: string }[];
  const missing = (reason: string): AnchorReport => ({ ok: false, configured: false, lastAnchorAt: null, lines: 0, reason,
    tenants: heads.map((h) => ({ tenant: h.tenant_id, status: 'anchor_missing', anchoredSeq: null, anchoredAt: null, reason })) });
  let key: Buffer;
  try { key = requireKey(rawKey); } catch (e) { return missing((e as Error).message); }
  if (!existsSync(file)) return missing('no anchor file yet (run npm run audit:anchor)');

  const lines = readLines(file);
  const status = new Map<string, TenantAnchor>();
  const note = (tenant: string, s: AnchorStatus, reason: string, l?: AnchorLine) => {
    const rank: Record<AnchorStatus, number> = { ok: 0, anchor_missing: 0, rewritten: 1, truncated: 2, rolled_back: 3, bad_signature: 4 };
    const cur = status.get(tenant);
    if (!cur) { status.set(tenant, { tenant, status: s, anchoredSeq: l?.seq ?? null, anchoredAt: l?.anchoredAt ?? null, ...(s === 'ok' ? {} : { reason }) }); return; }
    if (rank[s] > rank[cur.status]) { cur.status = s; cur.reason = reason; }
    if (l && (cur.anchoredSeq === null || l.seq > cur.anchoredSeq)) { cur.anchoredSeq = l.seq; cur.anchoredAt = l.anchoredAt; }
  };

  // 1. signatures; a bad line cannot be trusted for anything else, not even its tenant name, so it taints every tenant
  const good: AnchorLine[] = [];
  let badAt = 0;
  lines.forEach((l, idx) => {
    if (!l || !wellFormed(l) || !sameSig(l.sig, sign(key, (({ sig: _s, ...rest }) => rest)(l)))) { if (!badAt) badAt = idx + 1; return; }
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

/** Exclusive lock file, so two operators never both pick the same next counter. Stale locks are not guessed at: the error says where. */
function withLock<T>(file: string, fn: () => T): T {
  const lock = file + '.lock';
  let fd: number;
  try { fd = openSync(lock, 'wx', 0o600); } catch { throw new AnchorError('another anchor write is running (remove the .lock file next to the anchor file if it is stale)'); }
  try { return fn(); } finally { closeSync(fd); try { unlinkSync(lock); } catch { /* gone */ } }
}

export interface WriteResult { file: string; batch: string; written: { tenant: string; seq: number }[] }
/**
 * Append a signed checkpoint of every tenant's head. Heads are read in ONE repeatable-read snapshot. Refuses (and writes nothing) when
 * the key is missing/short, when a tenant's chain does not verify (never sign a broken chain), or when the existing anchor file already
 * fails verification (never extend a tampered file). The file is created with mode 600 and fsynced.
 */
export async function writeAnchor(db: Db, opts: AnchorSettings & { now?: () => Date } = {}): Promise<WriteResult> {
  const { key: rawKey, file } = anchorSettings(opts);
  const key = requireKey(rawKey);
  if (existsSync(file)) {
    const rep = await verifyAnchors(db, { key: rawKey, file });
    const bad = rep.tenants.find((t) => t.status !== 'ok' && t.status !== 'anchor_missing');
    if (bad || (!rep.configured)) throw new AnchorError(`the existing anchor file does not verify (${bad ? `${bad.tenant}: ${bad.status}` : rep.reason}); not extending it`);
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
  mkdirSync(dirname(file), { recursive: true });
  return withLock(file, () => {
    const existing = existsSync(file) ? readLines(file).length : 0;
    const batch = randomUUID();
    const anchoredAt = (opts.now?.() ?? new Date()).toISOString();
    const out = heads.map((h, i): AnchorLine => {
      const u: Unsigned = { v: 1, n: existing + i + 1, batch, i: i + 1, of: heads.length, tenant: h.tenant_id, seq: Number(h.seq), rowHash: h.row_hash, at: h.at, anchoredAt };
      return { ...u, sig: sign(key, u) };
    });
    const fd = openSync(file, 'a', 0o600);
    try { writeSync(fd, out.map((l) => JSON.stringify(l) + '\n').join('')); fsyncSync(fd); } finally { closeSync(fd); }
    try { chmodSync(file, 0o600); } catch { /* not ours to change */ }
    return { file, batch, written: out.map((l) => ({ tenant: l.tenant, seq: l.seq })) };
  });
}
