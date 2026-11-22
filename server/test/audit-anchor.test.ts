import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type pg from 'pg';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, symlinkSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { makeSchema, makeTestApp, withAdmin, TEST_DB, type TestApp } from './helpers.ts';
import { audit, chainHash, verifyChain, GENESIS } from '../src/audit.ts';
import { writeAnchor, verifyAnchors, rotateAnchor, requireKey, anchorSettings, AnchorError, MIN_KEY_BYTES } from '../src/audit-anchor.ts';
import { assertLaneWipe } from '../scripts/lane-db-guard.ts';

const KEY = randomBytes(32).toString('hex');
const DOM = 'test-deployment';
const put = (pool: pg.Pool, n: number, tenantId: string) =>
  audit(pool, { tenantId, actor: 'u1', action: 'test.event', subject: 'x' + n, result: 'ok', correlationId: 'c' + n, detail: { n } });
async function tamper(pool: pg.Pool, sql: string, params: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('alter table audit_events disable trigger user');
    try { await c.query(sql, params); } finally { await c.query('alter table audit_events enable trigger user'); }
  } finally { c.release(); }
}
/** The attacker's best move: rewrite every row of a tenant with recomputed hashes (the chain stays internally consistent). */
async function rehashAll(pool: pg.Pool, tenant: string, edit: (n: number) => string = (n) => `{"n":${n},"evil":true}`) {
  const c = await pool.connect();
  try {
    await c.query('alter table audit_events disable trigger user');
    const rows = (await c.query(`select seq, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at, actor, action, subject, result, correlation_id from audit_events where tenant_id=$1 order by seq`, [tenant])).rows;
    let prev = GENESIS;
    for (const r of rows) {
      const detail = JSON.parse(edit(Number(r.seq)));
      const h = chainHash(prev, { tenantId: tenant, seq: Number(r.seq), at: r.at, actor: r.actor, action: r.action, subject: r.subject, result: r.result, correlationId: r.correlation_id, detail });
      await c.query('update audit_events set detail=$3, prev_hash=$4, row_hash=$5 where tenant_id=$1 and seq=$2', [tenant, r.seq, JSON.stringify(detail), prev, h]);
      prev = h;
    }
    await c.query('alter table audit_events enable trigger user');
  } finally { c.release(); }
}

describe('audit anchor (c49)', () => {
  let s: Awaited<ReturnType<typeof makeSchema>>;
  let dir = '';
  let file = '';
  const o = () => ({ key: KEY, file, domain: DOM });
  // one scratch schema per test: a tampered tenant must never block the next test's anchor (writeAnchor refuses broken chains)
  beforeEach(async () => { s = await makeSchema(); dir = mkdtempSync(join(tmpdir(), 'axion-anchor-')); file = join(dir, 'audit-anchors.jsonl'); });
  afterEach(async () => { rmSync(dir, { recursive: true, force: true }); await s.drop(); });
  let tn = 0;
  /** a tenant of its own per test, so tests never see each other's rows */
  const fresh = async (n = 6) => { const t = 'ta-' + ++tn; for (let i = 1; i <= n; i++) await put(s.pool, i, t); return t; };
  const statusOf = async (t: string, over: Record<string, unknown> = {}) => (await verifyAnchors(s.pool, { ...o(), tenant: t, ...over })).tenants.find((x) => x.tenant === t)?.status;
  const lines = () => readFileSync(file, 'utf8').split('\n').filter(Boolean);

  describe('key handling (fail closed)', () => {
    it('requireKey refuses a missing key', () => { expect(() => requireKey(undefined)).toThrow(/not set/); expect(() => requireKey('')).toThrow(AnchorError); });
    it('requireKey refuses a key shorter than 32 bytes, and the message does not echo it', () => {
      const short = 'x'.repeat(MIN_KEY_BYTES - 1);
      try { requireKey(short); throw new Error('should have thrown'); } catch (e) { expect((e as Error).message).toMatch(/too short/); expect((e as Error).message).not.toContain(short); }
    });
    it('requireKey accepts exactly 32 bytes of varied content', () => { expect(requireKey('abcdefghijklmnopqrstuvwxyz012345').length).toBe(32); });
    it('counts bytes, not characters: 16 different two-byte characters are 32 bytes', () => { expect(requireKey('àáâãäåæçèéêëìíîï').length).toBe(32); expect(() => requireKey('àáâãäåæçèéêëìíî')).toThrow(/too short/); });
    it('P5: a repeated character or pattern meets the length but not the distinct-byte rule (8; a hex key has at most 16 symbols, so 16 would refuse good keys)', () => {
      for (const k of ['a'.repeat(32), 'ab'.repeat(16), '0123'.repeat(16), 'abcdefg'.repeat(5)]) expect(() => requireKey(k)).toThrow(/too repetitive/);
      expect(requireKey('0123456789abcd'.repeat(3)).length).toBe(42); // 14 distinct hex symbols: a normal random hex key
      for (let i = 0; i < 200; i++) expect(() => requireKey(randomBytes(32).toString('hex'))).not.toThrow();
      expect(requireKey(randomBytes(32).toString('hex')).length).toBe(64);
    });
    it('anchorSettings reads the key and file from the environment, and an override wins', () => {
      expect(anchorSettings({}, { AUDIT_ANCHOR_KEY: 'a', AUDIT_ANCHOR_FILE: '/x/y' })).toEqual({ key: 'a', file: '/x/y' });
      expect(anchorSettings({}, {}).key).toBeUndefined();
      expect(anchorSettings({}, {}).file).toMatch(/data[\\/]audit-anchors\.jsonl$/);
      expect(anchorSettings({ key: 'o', file: '/o' }, { AUDIT_ANCHOR_KEY: 'a', AUDIT_ANCHOR_FILE: '/x' })).toEqual({ key: 'o', file: '/o' });
    });
    it('writeAnchor with no key writes nothing', async () => {
      await fresh();
      await expect(writeAnchor(s.pool, { file, key: '' })).rejects.toThrow(/AUDIT_ANCHOR_KEY is not set/);
      expect(existsSync(file)).toBe(false);
    });
    it('writeAnchor with a short key writes nothing', async () => {
      await fresh();
      await expect(writeAnchor(s.pool, { file, key: 'short' })).rejects.toThrow(/too short/);
      expect(existsSync(file)).toBe(false);
    });
  });

  describe('writing', () => {
    it('writes one signed line per tenant head, file mode 600, no key in the file', async () => {
      const t = await fresh(4);
      const r = await writeAnchor(s.pool, o());
      expect(r.written.find((w) => w.tenant === t)?.seq).toBe(4);
      const ls = lines().map((l) => JSON.parse(l));
      const mine = ls.find((l) => l.tenant === t);
      expect(mine).toMatchObject({ v: 1, seq: 4 });
      expect(mine.rowHash).toMatch(/^[0-9a-f]{64}$/); expect(mine.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readFileSync(file, 'utf8')).not.toContain(KEY);
    });
    it('the anchored hash is the live head hash', async () => {
      const t = await fresh(3);
      await writeAnchor(s.pool, o());
      const head = (await s.pool.query('select row_hash from audit_events where tenant_id=$1 order by seq desc limit 1', [t])).rows[0].row_hash;
      expect(lines().map((l) => JSON.parse(l)).find((l) => l.tenant === t).rowHash).toBe(head);
    });
    it('appends: a second checkpoint adds lines and keeps the first', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o()); const n1 = lines().length; const first = lines()[0];
      await put(s.pool, 9, t);
      await writeAnchor(s.pool, o());
      expect(lines().length).toBe(n1 * 2); expect(lines()[0]).toBe(first);
      expect(lines().map((l) => JSON.parse(l).n)).toEqual(lines().map((_, i) => i + 1));
    });
    it('creates the missing directory', async () => {
      await fresh(1);
      const nested = join(dir, 'a', 'b', 'anchors.jsonl');
      await writeAnchor(s.pool, { ...o(), file: nested });
      expect(existsSync(nested)).toBe(true);
    });
    it('refuses to anchor a chain that does not verify', async () => {
      const t = await fresh(5);
      await tamper(s.pool, `update audit_events set detail='{"n":99}' where tenant_id=$1 and seq=3`, [t]);
      await expect(writeAnchor(s.pool, o())).rejects.toThrow(new RegExp(`${t} is broken at seq 3`));
      expect(existsSync(file)).toBe(false);
      await tamper(s.pool, `update audit_events set detail='{"n":3}' where tenant_id=$1 and seq=3`, [t]); // restore for the other tests
    });
    it('refuses to extend an anchor file that already fails verification, and leaves it as it was', async () => {
      await fresh(3);
      await writeAnchor(s.pool, o());
      const ls = lines(); const j = JSON.parse(ls[0]); j.seq = 1; ls[0] = JSON.stringify(j);
      writeFileSync(file, ls.join('\n') + '\n');
      const before = readFileSync(file, 'utf8');
      await expect(writeAnchor(s.pool, o())).rejects.toThrow(/does not verify/);
      expect(readFileSync(file, 'utf8')).toBe(before);
    });
    it('a leftover lock file stops a second writer with a clear message', async () => {
      await fresh(1);
      writeFileSync(file + '.lock', '');
      await expect(writeAnchor(s.pool, o())).rejects.toThrow(/another anchor write is running/);
    });
    it('two writers at once never reuse a line counter', async () => {
      await fresh(2);
      const rs = await Promise.allSettled([writeAnchor(s.pool, o()), writeAnchor(s.pool, o())]);
      expect(rs.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      const ns = lines().map((l) => JSON.parse(l).n);
      expect(ns).toEqual(ns.map((_, i) => i + 1));
    });
  });

  describe('verifying', () => {
    it('ok after a clean anchor, and still ok after the chain grew', async () => {
      const t = await fresh(4);
      await writeAnchor(s.pool, o());
      expect(await statusOf(t)).toBe('ok');
      await put(s.pool, 10, t); await put(s.pool, 11, t);
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t });
      expect(rep).toMatchObject({ ok: true, configured: true });
      expect(rep.tenants[0]).toMatchObject({ status: 'ok', anchoredSeq: 4 });
      expect(rep.lastAnchorAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    });
    it('deleting the newest N rows is `truncated` (the chain alone still says ok)', async () => {
      const t = await fresh(8);
      await writeAnchor(s.pool, o());
      await tamper(s.pool, `delete from audit_events where tenant_id=$1 and seq > 5`, [t]);
      expect(await verifyChain(s.pool, t)).toMatchObject({ ok: true, checked: 5 }); // the c31 limit: internally consistent
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t });
      expect(rep.ok).toBe(false);
      expect(rep.tenants[0]).toMatchObject({ status: 'truncated', anchoredSeq: 8 });
      expect(rep.tenants[0].reason).toMatch(/seq 8 is no longer in the chain/);
    });
    it('deleting just the newest one row is truncated too', async () => {
      const t = await fresh(3);
      await writeAnchor(s.pool, o());
      await tamper(s.pool, `delete from audit_events where tenant_id=$1 and seq = 3`, [t]);
      expect(await statusOf(t)).toBe('truncated');
    });
    it('deleting through the c31 purge path (axion.purge_demo) is still caught', async () => {
      const t = await fresh(4);
      await writeAnchor(s.pool, o());
      const c = await s.pool.connect();
      try {
        await c.query('begin'); await c.query(`set local axion.purge_demo = 'on'`);
        // the guard on audit_events has no purge exception (c31), so this must fail; the tail stays and the anchor stays ok
        await expect(c.query(`delete from audit_events where tenant_id=$1 and seq=4`, [t])).rejects.toThrow(/append-only/);
        await c.query('rollback');
      } finally { c.release(); }
      expect(await statusOf(t)).toBe('ok');
    });
    it('a full rehash with recomputed hashes is `rewritten` (the chain alone still says ok)', async () => {
      const t = await fresh(6);
      await writeAnchor(s.pool, o());
      await rehashAll(s.pool, t);
      expect(await verifyChain(s.pool, t)).toMatchObject({ ok: true, checked: 6 });
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t });
      expect(rep.tenants[0]).toMatchObject({ status: 'rewritten' });
      expect(rep.ok).toBe(false);
    });
    it('a rehash that also drops the tail is truncated', async () => {
      const t = await fresh(6);
      await writeAnchor(s.pool, o());
      await tamper(s.pool, `delete from audit_events where tenant_id=$1 and seq > 2`, [t]);
      await rehashAll(s.pool, t);
      expect(await statusOf(t)).toBe('truncated');
    });
    it('a rewrite of an older anchored row is found even after a later anchor', async () => {
      const t = await fresh(3);
      await writeAnchor(s.pool, o());
      await put(s.pool, 7, t); await put(s.pool, 8, t);
      await writeAnchor(s.pool, o());
      await rehashAll(s.pool, t, (n) => (n === 3 ? '{"n":3,"evil":1}' : `{"n":${n}}`));
      expect(await statusOf(t)).toBe('rewritten');
    });
    it('rows added after the anchor are not a problem (rewrite only after the anchor is invisible to it: stated limit)', async () => {
      const t = await fresh(3);
      await writeAnchor(s.pool, o());
      await put(s.pool, 4, t);
      await tamper(s.pool, `update audit_events set detail='{"n":"x"}' where tenant_id=$1 and seq=4`, [t]);
      expect(await statusOf(t)).toBe('ok'); // seq 4 is past the anchor: only the c31 chain check sees that edit
      expect((await verifyChain(s.pool, t)).ok).toBe(false);
    });
    it('editing a line of the anchor file is `bad_signature`', async () => {
      const t = await fresh(3);
      await writeAnchor(s.pool, o());
      const ls = lines().map((l) => JSON.parse(l));
      const i = ls.findIndex((l) => l.tenant === t); ls[i].seq = 1; // the attacker lowers the anchored seq
      writeFileSync(file, ls.map((l) => JSON.stringify(l)).join('\n') + '\n');
      expect(await statusOf(t)).toBe('bad_signature');
    });
    it('editing the anchored hash, or the tenant name, is bad_signature', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o());
      const ls = lines().map((l) => JSON.parse(l)); const i = ls.findIndex((l) => l.tenant === t);
      ls[i].rowHash = 'f'.repeat(64);
      writeFileSync(file, ls.map((l) => JSON.stringify(l)).join('\n') + '\n');
      expect(await statusOf(t)).toBe('bad_signature');
    });
    it('garbage in the file, or a wrong key, is bad_signature (never ok)', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o());
      expect(await statusOf(t, { key: randomBytes(32).toString('hex') })).toBe('bad_signature');
      writeFileSync(file, readFileSync(file, 'utf8') + 'not json\n');
      expect(await statusOf(t)).toBe('bad_signature');
    });
    it('a forged line signed by someone without the key is rejected', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o());
      const ls = lines().map((l) => JSON.parse(l)); const i = ls.findIndex((l) => l.tenant === t);
      ls[i].sig = ls[i].sig.replace(/^./, (c: string) => (c === '0' ? '1' : '0'));
      writeFileSync(file, ls.map((l) => JSON.stringify(l)).join('\n') + '\n');
      expect(await statusOf(t)).toBe('bad_signature');
    });
    it('no key is `anchor_missing`, never ok', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o());
      const rep = await verifyAnchors(s.pool, { file, tenant: t, key: '' });
      expect(rep).toMatchObject({ ok: false, configured: false });
      expect(rep.tenants[0]).toMatchObject({ status: 'anchor_missing' });
      expect(rep.tenants[0].reason).toMatch(/AUDIT_ANCHOR_KEY/);
    });
    it('a short key is anchor_missing too', async () => { const t = await fresh(1); expect(await statusOf(t, { key: 'short' })).toBe('anchor_missing'); });
    it('no file is `anchor_missing`', async () => {
      const t = await fresh(2);
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t });
      expect(rep).toMatchObject({ ok: false, configured: false, lastAnchorAt: null });
      expect(rep.tenants[0].status).toBe('anchor_missing');
    });
    it('a tenant that has rows but no anchor line is anchor_missing, not ok', async () => {
      const a = await fresh(2);
      await writeAnchor(s.pool, o());
      const b = await fresh(2);
      expect(await statusOf(b)).toBe('anchor_missing');
      expect(await statusOf(a)).toBe('ok');
    });
    it('a tenant whose rows are all gone is truncated', async () => {
      const t = await fresh(3);
      await writeAnchor(s.pool, o());
      await tamper(s.pool, `delete from audit_events where tenant_id=$1`, [t]);
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t });
      expect(rep.tenants.find((x) => x.tenant === t)?.status).toBe('truncated');
      expect(rep.ok).toBe(false);
    });
    it('without a tenant filter every tenant is reported, one bad tenant fails the whole', async () => {
      const a = await fresh(2); const b = await fresh(2);
      await writeAnchor(s.pool, o());
      await tamper(s.pool, `delete from audit_events where tenant_id=$1 and seq=2`, [b]);
      const rep = await verifyAnchors(s.pool, o());
      expect(rep.tenants.find((x) => x.tenant === a)?.status).toBe('ok');
      expect(rep.tenants.find((x) => x.tenant === b)?.status).toBe('truncated');
      expect(rep.ok).toBe(false);
    });
  });

  describe('rolled back (honest limits)', () => {
    it('deleting the last line of a multi-tenant checkpoint after a later write is `rolled_back`', async () => {
      const a = await fresh(2); const b = await fresh(2);
      await writeAnchor(s.pool, o());
      await put(s.pool, 50, a);
      await writeAnchor(s.pool, o()); // the second checkpoint holds every tenant in this schema
      const ls = lines(); writeFileSync(file, ls.slice(0, -1).join('\n') + '\n');
      const rep = await verifyAnchors(s.pool, o());
      expect(rep.ok).toBe(false);
      expect(rep.tenants.every((t) => t.status === 'rolled_back')).toBe(true);
      expect(rep.tenants[0].reason).toMatch(/last checkpoint has \d+ of \d+ lines/);
      void b;
    });
    it('deleting a line in the middle of the file is rolled_back (the counter has a gap)', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o()); await put(s.pool, 5, t); await writeAnchor(s.pool, o()); await put(s.pool, 6, t); await writeAnchor(s.pool, o());
      const ls = lines(); const keep = ls.filter((_, i) => i !== 1);
      writeFileSync(file, keep.join('\n') + '\n');
      expect(await statusOf(t)).toBe('rolled_back');
    });
    it('deleting the first line is rolled_back (the counter no longer starts at 1)', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o()); await put(s.pool, 5, t); await writeAnchor(s.pool, o());
      writeFileSync(file, lines().slice(1).join('\n') + '\n');
      expect(await statusOf(t)).toBe('rolled_back');
    });
    it('replaying an old line at the end (older seq after a newer one) is rolled_back', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o()); const old = lines().find((l) => JSON.parse(l).tenant === t)!;
      await put(s.pool, 5, t); await writeAnchor(s.pool, o());
      const r = JSON.parse(old); // re-sign is impossible without the key, so the replay keeps its old n and breaks the counter
      writeFileSync(file, readFileSync(file, 'utf8') + JSON.stringify(r) + '\n');
      expect(await statusOf(t)).toBe('rolled_back');
    });
    it('LIMIT: deleting the whole final single-tenant checkpoint cannot be seen from the file (ok, not a false alarm)', async () => {
      const t = 'solo-' + randomBytes(3).toString('hex');
      const sc = await makeSchema();
      try {
        await put(sc.pool, 1, t); await writeAnchor(sc.pool, o());
        await put(sc.pool, 2, t); await writeAnchor(sc.pool, o());
        writeFileSync(file, lines().slice(0, -1).join('\n') + '\n');
        const rep = await verifyAnchors(sc.pool, { ...o(), tenant: t });
        expect(rep.tenants[0]).toMatchObject({ status: 'ok', anchoredSeq: 1 }); // documented limit: undetectable; the older anchor still holds
      } finally { await sc.drop(); }
    });
  });


  describe('fix round (c49 review)', () => {
    it('F1: a correct signature followed by junk, or in upper case, is bad_signature', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o());
      for (const mutate of [(g: string) => g + 'zzzz', (g: string) => g.toUpperCase(), (g: string) => g.slice(0, 62)]) {
        const ls = lines().map((l) => JSON.parse(l)); const i = ls.findIndex((l) => l.tenant === t);
        const keep = ls[i].sig; ls[i].sig = mutate(keep);
        writeFileSync(file, ls.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 });
        expect(await statusOf(t)).toBe('bad_signature');
        ls[i].sig = keep; writeFileSync(file, ls.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 });
        expect(await statusOf(t)).toBe('ok');
      }
    });
    it('F2: a directory in place of the file reports ok:false with a reason (no throw), per tenant too', async () => {
      const t = await fresh(2);
      mkdirSync(file);
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t });
      expect(rep).toMatchObject({ ok: false, configured: true });
      expect(rep.reason).toMatch(/not a regular file/);
      expect(rep.tenants[0].status).toBe('unreadable');
      await expect(writeAnchor(s.pool, o())).rejects.toThrow(/not a regular file/);
    });
    it('F2: the route answers 200 ok:false (not 500) and the CLI exits 1 cleanly', async () => {
      const ta = await makeTestApp({ auditAnchor: { key: KEY, file, domain: DOM } });
      try {
        const A = await withAdmin(ta.app);
        mkdirSync(file);
        const r = await A.admin.req('GET', '/operations/anchors');
        expect(r.status).toBe(200); expect(r.body).toMatchObject({ ok: false, configured: true }); expect(r.body.reason).toMatch(/not a regular file/);
        const v = spawnSync('node', ['--import', 'tsx', 'src/cli/audit-verify.ts', 't-1'], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8',
          env: { ...process.env, DATABASE_URL: TEST_DB(), DATABASE_SCHEMA: ta.schema, AUDIT_ANCHOR_FILE: file, AUDIT_ANCHOR_KEY: KEY, AUDIT_ANCHOR_DOMAIN: DOM } });
        expect(v.status).toBe(1); expect(v.stderr).not.toMatch(/unhandled|EISDIR|at .*\.ts:/i); expect(v.stdout).toMatch(/UNREADABLE/);
      } finally { await ta.close(); }
    });
    it('F3: a symlink at the anchor path is refused for verify and for writing; the target is untouched', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o());
      const real = file + '.real'; writeFileSync(real, readFileSync(file), { mode: 0o600 }); rmSync(file); symlinkSync(real, file);
      const before = readFileSync(real, 'utf8');
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t });
      expect(rep).toMatchObject({ ok: false }); expect(rep.tenants[0].status).toBe('insecure_file'); expect(rep.reason).toMatch(/symbolic link/);
      await expect(writeAnchor(s.pool, o())).rejects.toThrow(/symbolic link/);
      expect(readFileSync(real, 'utf8')).toBe(before);
    });
    it('F3: a dangling symlink is not followed to create its target', async () => {
      await fresh(1);
      const target = join(dir, 'elsewhere.jsonl'); symlinkSync(target, file);
      await expect(writeAnchor(s.pool, o())).rejects.toThrow(/symbolic link/);
      expect(existsSync(target)).toBe(false);
    });
    it('F3: a group- or world-writable file is insecure_file; chmod 600 fixes it', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o());
      chmodSync(file, 0o666);
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t });
      expect(rep.ok).toBe(false); expect(rep.tenants[0].status).toBe('insecure_file'); expect(rep.reason).toMatch(/chmod 600/);
      await expect(writeAnchor(s.pool, o())).rejects.toThrow(/writable by group or others/);
      chmodSync(file, 0o620); expect(await statusOf(t)).toBe('insecure_file');
      chmodSync(file, 0o600); expect(await statusOf(t)).toBe('ok');
      chmodSync(file, 0o644); expect(await statusOf(t)).toBe('ok'); // readable by others is allowed; only writable is refused
    });
    it('P1: the lock is taken before anything else is read (a held lock touches neither the database nor the file)', async () => {
      await fresh(1);
      writeFileSync(file + '.lock', '');
      const boom = new Proxy({}, { get() { throw new Error('DB TOUCHED before the lock'); } }) as unknown as pg.Pool;
      await expect(writeAnchor(boom, o())).rejects.toThrow(/another anchor write is running/);
    });
    it('P1: writers racing with growing chains never produce an older head after a newer one', async () => {
      const t = await fresh(2);
      const w = async (i: number) => { await put(s.pool, 100 + i, t); try { await writeAnchor(s.pool, o()); } catch (e) { if (!/another anchor write/.test((e as Error).message)) throw e; } };
      await Promise.all([1, 2, 3, 4, 5, 6].map(w));
      const seqs = lines().map((l) => JSON.parse(l)).filter((l) => l.tenant === t).map((l) => l.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(await statusOf(t)).toBe('ok');
    });
    it('P2: a line signed for another deployment (domain) does not verify here', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, { ...o(), domain: 'deployment-A' });
      expect(await statusOf(t, { domain: 'deployment-A' })).toBe('ok');
      expect(await statusOf(t, { domain: 'deployment-B' })).toBe('bad_signature');
    });
    it('P2: the domain is REQUIRED: without it verify says not verifiable (anchor_missing, reason: no domain) and writing is refused', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o());
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t, domain: '' });
      expect(rep).toMatchObject({ ok: false, configured: false });
      expect(rep.tenants[0].status).toBe('anchor_missing'); expect(rep.reason).toMatch(/AUDIT_ANCHOR_DOMAIN is not set/);
      await expect(writeAnchor(s.pool, { ...o(), domain: '' })).rejects.toThrow(/AUDIT_ANCHOR_DOMAIN is not set/);
      await expect(rotateAnchor(s.pool, { ...o(), domain: '', confirm: 1 })).rejects.toThrow(/AUDIT_ANCHOR_DOMAIN is not set/);
    });
    it('P2: a restored copy under another schema (stand-in for another DB name) verifies ok with the same domain, and not with another', async () => {
      const t = await fresh(4);
      await writeAnchor(s.pool, o());
      const other = await makeSchema();
      try {
        await other.pool.query(`insert into audit_events(tenant_id, actor, action, subject, result, correlation_id, detail, at, seq, prev_hash, row_hash)
          select tenant_id, actor, action, subject, result, correlation_id, detail, at, seq, prev_hash, row_hash from ${s.schema}.audit_events order by id`);
        expect((await verifyChain(other.pool, t)).ok).toBe(true);
        const rep = await verifyAnchors(other.pool, { ...o(), tenant: t });
        expect(rep.ok).toBe(true); expect(rep.tenants[0].status).toBe('ok');
        expect((await verifyAnchors(other.pool, { ...o(), tenant: t, domain: 'some-other-deployment' })).tenants[0].status).toBe('bad_signature');
      } finally { await other.drop(); }
    });
    it('P2: AUDIT_ANCHOR_DOMAIN from the environment is used', () => { expect(anchorSettings({}, { AUDIT_ANCHOR_DOMAIN: 'prod-1' }).domain).toBe('prod-1'); });
    const breakFile = () => { const ls = lines(); const j = JSON.parse(ls[0]); j.seq = 1; writeFileSync(file, JSON.stringify(j) + '\n', { mode: 0o600 }); };
    it('rotate: needs the key', async () => {
      const t = await fresh(2); await writeAnchor(s.pool, o()); breakFile();
      await expect(rotateAnchor(s.pool, { ...o(), key: '', confirm: 1 })).rejects.toThrow(/AUDIT_ANCHOR_KEY is not set/);
      expect(existsSync(file)).toBe(true); void t;
    });
    it('rotate: needs --confirm with the old last line number, and says what it is', async () => {
      await fresh(2); await writeAnchor(s.pool, o()); breakFile();
      await expect(rotateAnchor(s.pool, o())).rejects.toThrow(/--confirm 1 /);
      await expect(rotateAnchor(s.pool, { ...o(), confirm: 7 })).rejects.toThrow(/--confirm 1 /);
      expect(existsSync(file)).toBe(true);
      expect((await s.pool.query(`select count(*)::int n from audit_events where action='audit.anchor.rotated'`)).rows[0].n).toBe(0);
    });
    it('rotate: refuses a file that still verifies ok unless --force', async () => {
      const t = await fresh(2); await writeAnchor(s.pool, o());
      await expect(rotateAnchor(s.pool, { ...o(), confirm: 1 })).rejects.toThrow(/still verifies ok.*--force/);
      expect(existsSync(file)).toBe(true);
      const r = await rotateAnchor(s.pool, { ...o(), confirm: 1, force: true });
      expect(r.oldLastN).toBe(1); expect(await statusOf(t)).toBe('ok');
      const ev = (await s.pool.query(`select detail from audit_events where tenant_id=$1 and action='audit.anchor.rotated'`, [t])).rows[0];
      expect(ev.detail.forced).toBe(true);
    });
    it('rotate: archives (kept), records the real OS user, signs rotatedFrom = sha256(archive) in line 1, and verify shows the restart', async () => {
      const t = await fresh(3);
      await writeAnchor(s.pool, o()); breakFile();
      const bad = readFileSync(file, 'utf8');
      expect(await statusOf(t)).toBe('bad_signature');
      await expect(writeAnchor(s.pool, o())).rejects.toThrow(/Recovery/);
      const r = await rotateAnchor(s.pool, { ...o(), confirm: 1, actorNote: 'ticket-42' });
      expect(r.archived).toMatch(/\.jsonl\.\d{4}-\d\d-\d\dT[\d-]+Z\.bad$/); expect(readFileSync(r.archived, 'utf8')).toBe(bad);
      expect(r.sha256).toBe(createHash('sha256').update(bad).digest('hex'));
      const ev = (await s.pool.query(`select actor, detail from audit_events where tenant_id=$1 and action='audit.anchor.rotated'`, [t])).rows;
      expect(ev).toHaveLength(1);
      expect(ev[0].actor).toBe(userInfo().username); expect(ev[0].actor).not.toBe('operator');
      expect(ev[0].detail).toMatchObject({ archiveSha256: r.sha256, oldLastLine: 1, osUser: userInfo().username, note: 'ticket-42', forced: false });
      expect(ev[0].detail.archive).toMatch(/\.bad$/); expect(ev[0].detail.stateBefore).toMatch(/bad_signature/);
      const first = JSON.parse(lines()[0]);
      expect(first.n).toBe(1); expect(first.rotatedFrom).toMatchObject({ sha256: r.sha256, archive: ev[0].detail.archive });
      expect(await statusOf(t)).toBe('ok');
      const rep = await verifyAnchors(s.pool, { ...o(), tenant: t });
      expect(rep.rotatedFrom).toMatchObject({ sha256: r.sha256 });
      expect((await verifyChain(s.pool, t)).ok).toBe(true);
    });
    it('rotate: rotatedFrom is signed: editing or removing it is bad_signature, and deleting the DB events does not hide it', async () => {
      const t = await fresh(2);
      await writeAnchor(s.pool, o()); breakFile();
      const r = await rotateAnchor(s.pool, { ...o(), confirm: 1 });
      await tamper(s.pool, `delete from audit_events where action='audit.anchor.rotated'`);
      // the DB events are gone, yet the signed first line still says the file was restarted (the chain tail changed, so only check the report)
      expect((await verifyAnchors(s.pool, { ...o(), tenant: t })).rotatedFrom?.sha256).toBe(r.sha256);
      const ls = lines().map((l) => JSON.parse(l)); const keep = JSON.stringify(ls[0]);
      ls[0].rotatedFrom.sha256 = 'f'.repeat(64); writeFileSync(file, ls.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 });
      expect(await statusOf(t)).toBe('bad_signature');
      delete ls[0].rotatedFrom; writeFileSync(file, ls.map((l) => JSON.stringify(l)).join('\n') + '\n', { mode: 0o600 });
      expect(await statusOf(t)).toBe('bad_signature'); void keep;
    });
    it('rotate: a failure while recording the events leaves the old file in place and nothing recorded', async () => {
      const t = await fresh(2); await writeAnchor(s.pool, o()); breakFile();
      const before = readFileSync(file, 'utf8');
      await expect(rotateAnchor(s.pool, { ...o(), confirm: 1, failAfter: 'audit' })).rejects.toThrow(/injected failure after the audit events/);
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(readdirSync(dir).filter((f) => f.endsWith('.bad'))).toEqual([]);
      expect((await s.pool.query(`select count(*)::int n from audit_events where tenant_id=$1 and action='audit.anchor.rotated'`, [t])).rows[0].n).toBe(0); // one transaction, rolled back
    });
    it('rotate: a failure after the rename puts the old file back and says what to do', async () => {
      await fresh(2); await writeAnchor(s.pool, o()); breakFile();
      const before = readFileSync(file, 'utf8');
      await expect(rotateAnchor(s.pool, { ...o(), confirm: 1, failAfter: 'rename' })).rejects.toThrow(/old file was put back.*rotation again/);
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(readdirSync(dir).filter((f) => f.endsWith('.bad'))).toEqual([]);
      const r = await rotateAnchor(s.pool, { ...o(), confirm: 1 }); // the retry works
      expect(r.oldLastN).toBe(1);
    });
    it('rotate refuses a symlink and a missing file', async () => {
      await fresh(1);
      await expect(rotateAnchor(s.pool, { ...o(), confirm: 1 })).rejects.toThrow(/no anchor file/);
      symlinkSync(join(dir, 'x'), file);
      await expect(rotateAnchor(s.pool, { ...o(), confirm: 1 })).rejects.toThrow(/symbolic link/);
    });
    it('rotate through the CLI: prints the old state first, needs --confirm, passes --actor', async () => {
      const t = await fresh(2);
      const run = (extra: string[]) => spawnSync('node', ['--import', 'tsx', 'src/cli/audit-anchor.ts', ...extra], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: TEST_DB(), DATABASE_SCHEMA: s.schema, AUDIT_ANCHOR_FILE: file, AUDIT_ANCHOR_KEY: KEY, AUDIT_ANCHOR_DOMAIN: DOM, LOG: '0' } });
      expect(run([]).status).toBe(0); breakFile();
      const no = run(['--rotate']);
      expect(no.status).toBe(1); expect(no.stdout).toMatch(/old anchor file: 1 lines, last line 1 sig [0-9a-f]{12}; state: .*bad_signature/); expect(no.stderr).toMatch(/--confirm 1/);
      const yes = run(['--rotate', '--confirm', '1', '--actor', 'INC-7']);
      expect(yes.status).toBe(0); expect(yes.stdout + yes.stderr).not.toContain(KEY);
      const v = spawnSync('node', ['--import', 'tsx', 'src/cli/audit-verify.ts', t], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: TEST_DB(), DATABASE_SCHEMA: s.schema, AUDIT_ANCHOR_FILE: file, AUDIT_ANCHOR_KEY: KEY, AUDIT_ANCHOR_DOMAIN: DOM } });
      expect(v.status).toBe(0); expect(v.stdout).toMatch(/audit anchor file restarted on \d{4}-.*previous file archived/);
      expect((await s.pool.query(`select detail from audit_events where action='audit.anchor.rotated' limit 1`)).rows[0].detail.note).toBe('INC-7');
    });
    it('the stale-lock message points at the runbook', async () => {
      await fresh(1); writeFileSync(file + '.lock', '');
      await expect(writeAnchor(s.pool, o())).rejects.toThrow(/Stale lock/);
    });
    it('writeAnchor returns the last line number and a signature prefix to copy off-host; the CLI prints them', async () => {
      await fresh(2);
      const w = await writeAnchor(s.pool, o());
      expect(w.lastN).toBe(lines().length); expect(w.lastSig).toBe(JSON.parse(lines()[lines().length - 1]).sig);
    });
    it('F8: the lane guard refuses another lane\'s database, a non-e2e name, a remote host and a missing confirmation', () => {
      const root = mkdtempSync(join(tmpdir(), 'axion-lane-')); mkdirSync(join(root, 'server'));
      const own = 'postgres://axion:pw@127.0.0.1:5432/axion_e2e4';
      writeFileSync(join(root, 'server', '.env'), `DATABASE_URL=postgres://axion:pw@127.0.0.1:5432/axion_lane_disabled\nE2E_DATABASE_URL=${own}\n`);
      try {
        expect(assertLaneWipe(own, root, 'axion_e2e4')).toBe('axion_e2e4');
        expect(() => assertLaneWipe('postgres://axion:pw@127.0.0.1:5432/axion_e2e1', root, 'axion_e2e1')).toThrow(/not this worktree's own/);
        expect(() => assertLaneWipe('postgres://axion:pw@127.0.0.1:5432/axion_e2e44', root, 'axion_e2e44')).toThrow(/not this worktree's own/);
        for (const n of ['axion', 'axion_test', 'axion_e2e', 'axion_e2e4x', 'axion_lane_disabled']) expect(() => assertLaneWipe(`postgres://axion:pw@127.0.0.1:5432/${n}`, root, n)).toThrow(/only axion_e2e<N>/);
        expect(() => assertLaneWipe('postgres://axion:pw@db.example.com:5432/axion_e2e4', root, 'axion_e2e4')).toThrow(/host/);
        expect(() => assertLaneWipe('postgres://axion:other@127.0.0.1:5432/axion_e2e4', root, 'axion_e2e4')).toThrow(/not this worktree's own/); // the FULL url
        for (const q of ['?host=db.example.com', '?sslmode=disable', '#frag']) { writeFileSync(join(root, 'server', '.env'), `E2E_DATABASE_URL=${own}${q}\n`); expect(() => assertLaneWipe(own + q, root, 'axion_e2e4')).toThrow(/query string or fragment/); }
        writeFileSync(join(root, 'server', '.env'), `E2E_DATABASE_URL=${own}\n`);
        expect(() => assertLaneWipe(own, root, undefined)).toThrow(/CONFIRM_WIPE=axion_e2e4/);
        expect(() => assertLaneWipe(own, root, 'axion_e2e1')).toThrow(/CONFIRM_WIPE/);
        expect(() => assertLaneWipe(undefined, root, 'x')).toThrow(/not set/);
        expect(() => assertLaneWipe(own, join(root, 'nowhere'), 'axion_e2e4')).toThrow(/no E2E_DATABASE_URL/);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  });

  describe('where the key goes', () => {
    const SRC = join(import.meta.dirname, '..', 'src');
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    it('only the anchor module, the config comment, the CLIs and the ops route mention the key', () => {
      const hits = walk(SRC).filter((f) => /AUDIT_ANCHOR_KEY|auditAnchor|anchorSettings|requireKey/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(SRC.length + 1)).sort();
      expect(hits).toEqual(['audit-anchor.ts', 'cli/audit-anchor.ts', 'config.ts', 'ops/routes.ts'].sort());
    });
    it('no console, logger or reply line in those files mentions the key', () => {
      for (const f of ['audit-anchor.ts', 'cli/audit-anchor.ts', 'cli/audit-verify.ts', 'ops/routes.ts']) {
        for (const [i, line] of readFileSync(join(SRC, f), 'utf8').split('\n').entries()) {
          if (/console\.|\.log\.|app\.log|req\.log|reply\./.test(line) && /KEY|\bkey\b|rawKey|auditAnchor/.test(line)) throw new Error(`${f}:${i + 1} may log or return the key: ${line.trim()}`);
        }
      }
    });
    it('the CLI never prints the key, on success or on refusal', () => {
      const env = { ...process.env, DATABASE_URL: TEST_DB(), DATABASE_SCHEMA: s.schema, AUDIT_ANCHOR_FILE: file, AUDIT_ANCHOR_DOMAIN: DOM, LOG: '0' };
      const bad = spawnSync('node', ['--import', 'tsx', 'src/cli/audit-anchor.ts'], { cwd: join(SRC, '..'), env: { ...env, AUDIT_ANCHOR_KEY: 'short-' + KEY.slice(0, 8) }, encoding: 'utf8' });
      expect(bad.status).toBe(1);
      expect(bad.stdout + bad.stderr).not.toContain(KEY.slice(0, 8));
    });
  });

  describe('the CLIs', () => {
    const run = (script: string, extra: Record<string, string>, args: string[] = []) =>
      spawnSync('node', ['--import', 'tsx', `src/cli/${script}.ts`, ...args], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: TEST_DB(), DATABASE_SCHEMA: s.schema, AUDIT_ANCHOR_FILE: file, AUDIT_ANCHOR_KEY: '', AUDIT_ANCHOR_DOMAIN: DOM, ...extra } });
    it('audit:anchor writes, audit:verify passes (exit 0) and reports the anchor', async () => {
      const t = await fresh(3);
      const a = run('audit-anchor', { AUDIT_ANCHOR_KEY: KEY });
      expect(a.status).toBe(0); expect(a.stdout).toMatch(/audit anchor written/); expect(a.stdout).toMatch(/copy off-host: line \d+ sig [0-9a-f]{12}\b/); expect(a.stdout + a.stderr).not.toContain(KEY);
      const v = run('audit-verify', { AUDIT_ANCHOR_KEY: KEY }, [t]);
      expect(v.status).toBe(0); expect(v.stdout).toMatch(new RegExp(`audit anchor OK for ${t}`));
    });
    it('audit:verify with no key exits 1 and says not verifiable', async () => {
      const t = await fresh(2);
      const v = run('audit-verify', {}, [t]);
      expect(v.status).toBe(1); expect(v.stdout).toMatch(/audit chain OK/); expect(v.stdout).toMatch(/ANCHOR_MISSING/);
    });
    it('audit:verify exits 1 on a truncated tail', async () => {
      const t = await fresh(5);
      expect(run('audit-anchor', { AUDIT_ANCHOR_KEY: KEY }).status).toBe(0);
      await tamper(s.pool, `delete from audit_events where tenant_id=$1 and seq>3`, [t]);
      const v = run('audit-verify', { AUDIT_ANCHOR_KEY: KEY }, [t]);
      expect(v.status).toBe(1); expect(v.stdout).toMatch(/TRUNCATED/);
    });
    it('audit:anchor with no key exits 1 and writes nothing', async () => {
      await fresh(1);
      const a = run('audit-anchor', {});
      expect(a.status).toBe(1); expect(a.stderr).toMatch(/NOT written/); expect(existsSync(file)).toBe(false);
    });
  });
});

describe('GET /operations/anchors', () => {
  let t: TestApp; let dir = ''; let file = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axion-anchor-')); file = join(dir, 'a.jsonl'); });
  afterEach(async () => { await t.close(); rmSync(dir, { recursive: true, force: true }); });

  it('an admin sees the status of their tenant; a member gets 403; a signed-out caller 401', async () => {
    t = await makeTestApp({ auditAnchor: { key: KEY, file, domain: DOM } });
    const A = await withAdmin(t.app); const m = await A.member('Mina');
    const before = await A.admin.req('GET', '/operations/anchors');
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ configured: false, ok: false, lastAnchorAt: null });
    expect(before.body.tenants[0].status).toBe('anchor_missing');
    await writeAnchor(t.pool, { key: KEY, file, domain: DOM });
    const after = await A.admin.req('GET', '/operations/anchors');
    expect(after.body).toMatchObject({ configured: true, ok: true });
    expect(after.body.tenants).toHaveLength(1);
    expect(after.body.tenants[0]).toMatchObject({ tenant: 't-1', status: 'ok' });
    expect(after.body.lastAnchorAt).toMatch(/^\d{4}-/);
    expect((await m.b.req('GET', '/operations/anchors')).status).toBe(403);
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/operations/anchors' });
    expect(anon.statusCode).toBe(401);
  });
  it('shows truncated after a tail delete, and the response carries no key, file path or hash', async () => {
    t = await makeTestApp({ auditAnchor: { key: KEY, file, domain: DOM } });
    const A = await withAdmin(t.app);
    await writeAnchor(t.pool, { key: KEY, file, domain: DOM });
    await tamper(t.pool, `delete from audit_events where tenant_id='t-1' and seq = (select max(seq) from audit_events where tenant_id='t-1')`);
    const r = await A.admin.req('GET', '/operations/anchors');
    expect(r.body.ok).toBe(false);
    expect(r.body.tenants[0].status).toBe('truncated');
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(KEY); expect(text).not.toContain(dir); expect(text).not.toContain('audit-anchors'); expect(text).not.toMatch(/[0-9a-f]{64}/);
  });
  it('another tenant is never listed', async () => {
    t = await makeTestApp({ auditAnchor: { key: KEY, file, domain: DOM } });
    const A = await withAdmin(t.app);
    await put(t.pool, 1, 'other-tenant');
    await writeAnchor(t.pool, { key: KEY, file, domain: DOM });
    const r = await A.admin.req('GET', '/operations/anchors');
    expect(r.body.tenants.map((x: any) => x.tenant)).toEqual(['t-1']);
  });
  it('shows when the anchor file was restarted by a rotation (restartedAt), and null before', async () => {
    t = await makeTestApp({ auditAnchor: { key: KEY, file, domain: DOM } });
    const A = await withAdmin(t.app);
    await writeAnchor(t.pool, { key: KEY, file, domain: DOM });
    expect((await A.admin.req('GET', '/operations/anchors')).body.restartedAt).toBeNull();
    await rotateAnchor(t.pool, { key: KEY, file, domain: DOM, confirm: 1, force: true });
    const r = await A.admin.req('GET', '/operations/anchors');
    expect(r.body).toMatchObject({ ok: true }); expect(r.body.restartedAt).toMatch(/^\d{4}-/);
    expect(JSON.stringify(r.body)).not.toMatch(/\.bad|[0-9a-f]{64}/);
  });
  it('without AUDIT_ANCHOR_DOMAIN the route says not verifiable', async () => {
    t = await makeTestApp({ auditAnchor: { key: KEY, file, domain: '' } });
    const A = await withAdmin(t.app);
    const r = await A.admin.req('GET', '/operations/anchors');
    expect(r.body).toMatchObject({ ok: false, configured: false }); expect(r.body.reason).toMatch(/AUDIT_ANCHOR_DOMAIN/);
  });
  it('is rate limited per session', async () => {
    t = await makeTestApp({ auditAnchor: { key: KEY, file, domain: DOM } });
    const A = await withAdmin(t.app);
    let last = 0;
    for (let i = 0; i < 13; i++) last = (await A.admin.req('GET', '/operations/anchors')).status;
    expect(last).toBe(429);
  });
});
