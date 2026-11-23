import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type Browser, type TestApp } from './helpers.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { tx } from '../src/db.ts';
import { normalisePath, isGuardedPath, releaseDigest, GUARDED_SQL } from '../src/releases/guard.ts';

/**
 * c76 R1 (PARKED, owner Q11): release, last-good and rollback-target RECORDS. Nothing here releases, deploys, restarts or rolls back.
 */
let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
beforeEach(async () => { second = undefined; t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 }); A = await withAdmin(t.app); });
afterEach(async () => { await t.close(); });

const KIND = 'release-record'; // the dedicated R4 kind (F4)
let n = 0;
const key = () => ({ 'idempotency-key': 'r' + Date.now() + n++ });
const mission = async () => (await A.admin.req('POST', '/missions', { text: 'Ship the thing.', files: [], shared: false }, key())).body.mission.id as string;
const ask = (missionId: string, kind: string, payload: Record<string, unknown> = { x: 1 }) => tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId, agentId: 'release-01', kind, title: 'T', detail: 'd', payload, expiresInMin: 60 } as any));
// F1: the person who decides the R4 must not be the person who records the release, so guarded releases need a second administrator
let second: Awaited<ReturnType<typeof A.member>> | undefined;
const secondAdmin = async () => {
  if (!second) { second = await A.member('Second'); await t.pool.query(`update users set role='admin' where id=$1`, [second.id]); }
  return second;
};
const decide = async (id: string, decision: 'approved' | 'denied' = 'approved', by?: Browser) => {
  const who = by ?? (await secondAdmin()).b;
  const a = (await who.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === id);
  return who.req('POST', `/approvals/${id}/decision`, { decision, digest: a.digest, reason: 'ok' }, key());
};
const release = (body: Record<string, unknown>) => A.admin.req('POST', '/releases', body, key());
const plain = { version: '1.0.1', what: 'Copy changes on the about page.', changePaths: ['web/src/pages/About.tsx'] };
const count = async (tbl: string) => Number((await t.pool.query(`select count(*) from ${tbl}`)).rows[0].count);
const guardedBody = (over: Record<string, unknown> = {}) => ({ version: '2.0.0', what: 'Touches the policy.', changePaths: ['server/src/policy/baseline.ts', 'web/src/a.tsx'], ...over });
const r4 = async (b = guardedBody(), payload?: Record<string, unknown>) => {
  const m = await mission();
  const a = await ask(m, KIND, payload ?? { releaseDigest: releaseDigest('t-1', b.version as string, b.changePaths as string[]) });
  expect((await decide(a.id)).status).toBe(200);
  return a.id as string;
};

describe('guardrail path rule (pure)', () => {
  it('normalises, and refuses a path that escapes, hides in an encoding or is empty', () => {
    expect(normalisePath('./Server\\Src//Policy/../policy/x.ts')).toEqual({ ok: true, path: 'Server/Src/policy/x.ts' });
    for (const bad of ['', '   ', '../etc/passwd', 'a/../../b', '/abs/path', 'a%2fb', 'a\u0000b', 'x'.repeat(301)]) expect(normalisePath(bad), JSON.stringify(bad).slice(0, 30)).toMatchObject({ ok: false });
  });
  it('flags policy, approvals, audit, locks and migrations, case-insensitively and across look-alike characters', () => {
    for (const p of ['server/src/policy/baseline.ts', 'server/src/approvals/service.ts', 'server/src/audit.ts', 'server/src/audit-anchor.ts', 'server/src/locks.ts', 'server/migrations/0056_x.up.sql', 'SERVER/SRC/POLICY/X.TS', 'server/src/ｐｏｌｉｃｙ/x.ts']) {
      const n = normalisePath(p);
      expect(n.ok && isGuardedPath(n.path), p).toBe(true);
    }
    for (const p of ['web/src/pages/About.tsx', 'README.md', 'server/src/missions/routes.ts', 'web/src/styles/theme.css']) expect(isGuardedPath(p), p).toBe(false);
  });
  it('the TypeScript rule and the database trigger rule agree on every probe', async () => {
    const probes = ['server/src/policy/baseline.ts', 'server/src/approvals/x.ts', 'server/src/audit.ts', 'server/src/locks.ts', 'server/migrations/1.sql', 'web/src/pages/About.tsx', 'docs/policy-notes.md', 'x/auditors.txt', 'a/lockstep.ts', 'a/migrationsx/b', 'ｐｏｌｉｃｙ/x'];
    for (const p of probes) {
      const sql = (await t.pool.query(`select (${GUARDED_SQL('$1::text')}) as g`, [p])).rows[0].g;
      expect(sql, p).toBe(isGuardedPath(p));
    }
  });
  it('the release digest binds tenant, version and the sorted paths', () => {
    const d = releaseDigest('t-1', '1.0.0', ['b', 'a']);
    expect(releaseDigest('t-1', '1.0.0', ['a', 'b'])).toBe(d);
    expect(new Set([d, releaseDigest('t-2', '1.0.0', ['a', 'b']), releaseDigest('t-1', '1.0.1', ['a', 'b']), releaseDigest('t-1', '1.0.0', ['a'])]).size).toBe(4);
  });
});

describe('F4: the database repeats the whole binding, the kind is dedicated, and a locked-recheck denial is audited', () => {
  const rawInsert = (a: string, over: { paths?: string; version?: string; by?: string } = {}) => t.pool.query(
    `insert into releases(id, tenant_id, version, what, change_paths, guarded_paths, guardrail_approval_id, released_by) values ('REL-R'||substr(md5(random()::text),1,8),'t-1',$2,'w',$1::text[],$1::text[],$3,$4)`,
    [over.paths ?? '{server/src/audit.ts}', over.version ?? '9', a, over.by ?? A.adminId]);
  const bound = async (kind = KIND, payload?: Record<string, unknown>, version = '9') => {
    const m = await mission();
    const a = await ask(m, kind, payload ?? { releaseDigest: releaseDigest('t-1', version, ['server/src/audit.ts']) });
    await decide(a.id);
    return a.id as string;
  };
  it('the dedicated kind is an R4 in the baseline policy; an R4 of another kind (a real deploy) is refused and stays unspent', async () => {
    const id = await bound('production_deploy', undefined, '2.0.0');
    const b = guardedBody();
    const m = await mission();
    const dep = await ask(m, 'production_deploy', { releaseDigest: releaseDigest('t-1', b.version as string, b.changePaths as string[]) }); await decide(dep.id);
    const r = await release({ ...b, guardrailApprovalId: dep.id });
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('approval_wrong_kind');
    expect((await t.pool.query('select consumed_at from approval_requests where id=$1', [dep.id])).rows[0].consumed_at).toBeNull();
    await expect(rawInsert(id)).rejects.toThrow(/kind/);
  });
  it('the trigger refuses an unbound digest, an unspent approval, a spent one used before, and an expired one', async () => {
    await expect(bound(KIND, { releaseDigest: 'f'.repeat(64) }).then((a) => rawInsert(a))).rejects.toThrow(/bound/);
    const ok = await bound();
    await expect(rawInsert(ok)).rejects.toThrow(/spent|consumed/); // decided but not consumed by the recorder
    await t.pool.query(`update approval_requests set consumed_at=now(), consumed_by=$2 where id=$1`, [ok, A.adminId]);
    await expect(rawInsert(ok, { version: 'other' })).rejects.toThrow(/bound/); // the digest binds the version too
    await expect(rawInsert(ok)).resolves.toBeTruthy();
    await expect(rawInsert(ok)).rejects.toThrow(/unique|duplicate/); // one approval, one release
    const old = await bound(KIND, { releaseDigest: releaseDigest('t-1', '10', ['server/src/audit.ts']) });
    await t.pool.query('alter table approval_requests disable trigger approval_requests_guard');
    try { await t.pool.query(`update approval_requests set consumed_at=now(), consumed_by=$2, expires_at=now() - interval '1 hour' where id=$1`, [old, A.adminId]); } finally { await t.pool.query('alter table approval_requests enable trigger approval_requests_guard'); }
    await expect(rawInsert(old, { version: '10' })).rejects.toThrow(/expired/);
  });
  it('the SQL release digest equals the TypeScript one, for mixed case, accents, astral characters and order', async () => {
    for (const paths of [['b/Z.ts', 'a/z.ts', 'B/a.ts'], ['café/x.ts', 'Zoo/y.ts'], ['\u{20000}/a.ts', 'z\uFF5A/a.ts', 'a"b/c\\d'.replace('\\', '_')]]) {
      const ps = paths.map((x) => x.normalize('NFKC'));
      const sql = (await t.pool.query(`select release_digest('t-1', '1.0.0', $1::text[]) as d`, [ps])).rows[0].d;
      expect(sql, JSON.stringify(ps)).toBe(releaseDigest('t-1', '1.0.0', ps));
    }
  });
  it('a denial found at the locked recheck (a concurrent identical release) is audited and the loser is 403', async () => {
    const b = guardedBody();
    const id = await r4(b);
    const rs = await Promise.all([release({ ...b, guardrailApprovalId: id }), release({ ...b, guardrailApprovalId: id })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 403]);
    expect(await count('releases')).toBe(1);
    const d = (await t.pool.query(`select detail from audit_events where action='release.record' and result='denied'`)).rows;
    expect(d.map((x) => x.detail.reason)).toEqual(['approval_already_used']);
  });
});

describe('F3: the guard also covers the migration runner, guardrails, metric audits and policies', () => {
  it.each(['server/src/migrate.ts', 'server/src/migrate-cli.ts', 'server/src/organization/guardrails.ts', 'server/src/company/metric-audit.ts', 'server/src/policies/x.ts', 'server/src/company/metric-audits.ts'])('%s is guarded, in TypeScript and in the database', async (p) => {
    expect(isGuardedPath(p), p).toBe(true);
    expect((await t.pool.query(`select (${GUARDED_SQL('$1::text')}) as g`, [p])).rows[0].g).toBe(true);
    expect((await release({ version: 'f3', what: 'x', changePaths: [p] })).status).toBe(403);
  });
  it('near misses stay unguarded', () => { for (const p of ['server/src/migrated-users.ts', 'web/src/pages/Policing.tsx', 'docs/metric-auditing.md']) expect(isGuardedPath(p), p).toBe(false); });
});

describe('release records', () => {
  it('records a release with who, what, version and the approvals it came from; nothing else happens', async () => {
    const m = await mission();
    const src = await ask(m, 'merge_source');
    await decide(src.id);
    const r = await release({ ...plain, fromApprovals: [src.id] });
    expect(r.status).toBe(201);
    expect(r.body.release).toMatchObject({ version: '1.0.1', what: plain.what, changePaths: plain.changePaths, guardedPaths: [], fromApprovals: [src.id], guardrailApprovalId: null, releasedBy: expect.any(String) });
    expect(r.body.release.id).toMatch(/^REL-[0-9A-F]{32}$/);
    const list = (await A.admin.req('GET', '/releases')).body;
    expect(list.releases.map((x: any) => x.id)).toEqual([r.body.release.id]);
    expect(list.lastGood).toBeNull();
    expect((await t.pool.query(`select count(*)::int as n from events where type like 'release.%' or type like 'deploy.%'`)).rows[0].n).toBe(0);
    const au = (await t.pool.query(`select action, result from audit_events where action like 'release.%'`)).rows;
    expect(au).toEqual([{ action: 'release.record', result: 'ok' }]);
  });
  it('refuses a duplicate version, a bad version, no paths, unknown or undecided approvals, and members', async () => {
    expect((await release(plain)).status).toBe(201);
    expect((await release(plain)).status).toBe(409);
    for (const bad of [{ ...plain, version: 'v 1' }, { ...plain, version: '' }, { ...plain, changePaths: [] }, { ...plain, version: '4', what: '' }, { ...plain, version: '5', extra: 1 }]) expect((await release(bad)).status, JSON.stringify(bad)).toBe(400); // the body schema
    expect((await release({ ...plain, version: '3', changePaths: ['../x'] })).status).toBe(422); // a path that climbs out
    const m = await mission();
    const pending = await ask(m, 'merge_source');
    expect((await release({ ...plain, version: '6', fromApprovals: [pending.id] })).status).toBe(422);
    expect((await release({ ...plain, version: '7', fromApprovals: ['APR-nope'] })).status).toBe(422);
    expect((await release({ ...plain, version: '8', guardrailApprovalId: pending.id })).status).toBe(422); // an unguarded release carries no guardrail approval
    const mina = (await A.member('Mina')).b;
    expect((await mina.req('POST', '/releases', { ...plain, version: '9' }, key())).status).toBe(403);
    expect((await mina.req('GET', '/releases')).status).toBe(403);
  });
});

describe('the guardrail-path denial', () => {
  it('refuses a release whose change touches a guarded path when no approval is bound, and audits the denial', async () => {
    const r = await release(guardedBody());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('POLICY_DENIED');
    expect(await count('releases')).toBe(0);
    const au = (await t.pool.query(`select result, detail from audit_events where action='release.record'`)).rows;
    expect(au).toHaveLength(1);
    expect(au[0].result).toBe('denied');
    expect(au[0].detail.guardedPaths).toEqual(['server/src/policy/baseline.ts']);
  });
  it('each of the five guarded areas is refused on its own', async () => {
    for (const [i, p] of ['server/src/policy/x.ts', 'server/src/approvals/x.ts', 'server/src/audit.ts', 'server/src/locks.ts', 'server/migrations/0099_x.up.sql'].entries())
      expect((await release({ version: 'g' + i, what: 'x', changePaths: [p] })).status, p).toBe(403);
    expect(await count('releases')).toBe(0);
  });
  it('an obfuscated spelling of a guarded path is still guarded', async () => {
    for (const [i, p] of ['./server/../server/src/policy/x.ts', 'SERVER\\SRC\\APPROVALS\\x.ts', 'server/src/ｌｏｃｋｓ.ts'].entries()) expect((await release({ version: 'o' + i, what: 'x', changePaths: [p] })).status, p).toBe(403);
  });
  it('is refused when the approval is the wrong tier, pending, denied, bound to other paths, or from another kind of request', async () => {
    const b = guardedBody();
    const m = await mission();
    const digest = releaseDigest('t-1', b.version as string, b.changePaths as string[]);
    const r3 = await ask(m, 'release', { releaseDigest: digest }); await decide(r3.id);
    const pending = await ask(m, KIND, { releaseDigest: digest });
    const denied = await ask(m, KIND, { releaseDigest: digest }); await decide(denied.id, 'denied');
    const other = await ask(m, KIND, { releaseDigest: releaseDigest('t-1', b.version as string, ['elsewhere.txt']) }); await decide(other.id);
    const none = await ask(m, KIND, { x: 1 }); await decide(none.id);
    for (const [why, id] of Object.entries({ r3: r3.id, pending: pending.id, denied: denied.id, otherPaths: other.id, noDigest: none.id, unknown: 'APR-nope' }))
      expect((await release({ ...b, guardrailApprovalId: id })).status, why).toBe(403);
    expect(await count('releases')).toBe(0);
  });
  it('is recorded with a bound, decided R4 approval, which is spent: a second release cannot reuse it', async () => {
    const b = guardedBody();
    const id = await r4(b);
    const ok = await release({ ...b, guardrailApprovalId: id });
    expect(ok.status).toBe(201);
    expect(ok.body.release).toMatchObject({ guardedPaths: ['server/src/policy/baseline.ts'], guardrailApprovalId: id });
    expect((await t.pool.query('select consumed_at from approval_requests where id=$1', [id])).rows[0].consumed_at).toBeTruthy();
    expect((await release({ ...b, version: '2.0.0b', guardrailApprovalId: id })).status).toBe(403); // digest binds the version too
    const again = await release({ ...b, guardrailApprovalId: id });
    expect([409, 403]).toContain(again.status);
    expect(await count('releases')).toBe(1);
  });
  it('the database refuses a guarded release row with no R4 approval even if the service were bypassed', async () => {
    const ins = (paths: string, ap: string | null) => t.pool.query(`insert into releases(id, tenant_id, version, what, change_paths, guarded_paths, guardrail_approval_id, released_by) values ('REL-X','t-1','9','w',$1::text[],$1::text[],$2,'u')`, [paths, ap]);
    await expect(ins('{server/src/policy/a.ts}', null)).rejects.toThrow(/guarded/);
    await expect(ins('{server/src/policy/a.ts}', 'APR-nope')).rejects.toThrow();
    // a lie in guarded_paths is caught too: the trigger recomputes from change_paths
    await expect(t.pool.query(`insert into releases(id, tenant_id, version, what, change_paths, guarded_paths, released_by) values ('REL-Y','t-1','8','w','{server/src/audit.ts}','{}','u')`)).rejects.toThrow(/guarded/);
    const m = await mission();
    const wrong = await ask(m, 'release'); await decide(wrong.id);
    await expect(ins('{server/src/policy/a.ts}', wrong.id)).rejects.toThrow(/R4/);
    expect(await count('releases')).toBe(0);
  });
});

describe('F1: the decider of the R4 approval is not the person who records the release', () => {
  it('refuses with SELF_APPROVAL when the recorder decided the approval, audits it, and records nothing', async () => {
    const b = guardedBody();
    const m = await mission();
    const a = await ask(m, KIND, { releaseDigest: releaseDigest('t-1', b.version as string, b.changePaths as string[]) });
    expect((await decide(a.id, 'approved', A.admin)).status).toBe(200); // the recorder (administrator Luca) decides it himself
    const r = await release({ ...b, guardrailApprovalId: a.id });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SELF_APPROVAL');
    expect(await count('releases')).toBe(0);
    expect((await t.pool.query('select consumed_at from approval_requests where id=$1', [a.id])).rows[0].consumed_at).toBeNull();
    const au = (await t.pool.query(`select detail from audit_events where action='release.record' and result='denied'`)).rows;
    expect(au.map((x) => x.detail.reason)).toEqual(['approval_decided_by_recorder']);
  });
  it('a different administrator deciding it makes the same release recordable', async () => {
    const b = guardedBody();
    expect((await release({ ...b, guardrailApprovalId: await r4(b) })).status).toBe(201);
  });
  it('the database refuses it too, for a raw insert', async () => {
    const m = await mission();
    const a = await ask(m, KIND, { releaseDigest: releaseDigest('t-1', '7', ['server/src/audit.ts']) }); await decide(a.id, 'approved', A.admin); // otherwise bound, so the decider rule is what refuses
    await expect(t.pool.query(`insert into releases(id, tenant_id, version, what, change_paths, guarded_paths, guardrail_approval_id, released_by) values ('REL-Z','t-1','7','w','{server/src/audit.ts}','{server/src/audit.ts}',$1,$2)`, [a.id, A.adminId])).rejects.toThrow(/decided/);
  });
});

describe('last-good and rollback-target records', () => {
  const rec = async (version: string) => (await release({ version, what: 'w', changePaths: ['web/a.txt'] })).body.release.id as string;
  const mark = (id: string, body: Record<string, unknown>) => A.admin.req('POST', `/releases/${id}/marks`, body, key());
  it('keeps an append-only history; the pointer is the latest last_good mark', async () => {
    const a = await rec('1.0.0'), b = await rec('1.1.0');
    expect((await mark(a, { kind: 'last_good', reason: 'Checks passed.' })).status).toBe(201);
    expect((await A.admin.req('GET', '/releases')).body.lastGood).toMatchObject({ releaseId: a, version: '1.0.0', reason: 'Checks passed.' });
    expect((await mark(b, { kind: 'last_good' })).status).toBe(201);
    const l = (await A.admin.req('GET', '/releases')).body;
    expect(l.lastGood).toMatchObject({ releaseId: b, version: '1.1.0' });
    expect(l.marks).toHaveLength(2);
    expect(await count('release_marks')).toBe(2);
  });
  it('records a rollback target only from a release that was once marked last good, never itself, and performs no rollback', async () => {
    const a = await rec('1.0.0'), b = await rec('1.1.0'), c = await rec('1.2.0');
    expect((await mark(b, { kind: 'rollback_target', targetReleaseId: a })).status).toBe(422); // a was never last good
    await mark(a, { kind: 'last_good' });
    expect((await mark(b, { kind: 'rollback_target', targetReleaseId: a })).status).toBe(201);
    expect((await mark(b, { kind: 'rollback_target', targetReleaseId: b })).status).toBe(422);
    expect((await mark(b, { kind: 'rollback_target' })).status).toBe(422);
    expect((await mark(a, { kind: 'last_good', targetReleaseId: b })).status).toBe(422);
    expect((await mark(c, { kind: 'rollback_target', targetReleaseId: 'REL-00000000000000000000000000000000' })).status).toBe(404);
    expect((await mark('REL-00000000000000000000000000000000', { kind: 'last_good' })).status).toBe(404);
    const l = (await A.admin.req('GET', '/releases')).body;
    expect(l.rollbackTargets).toEqual([expect.objectContaining({ releaseId: b, targetReleaseId: a, targetVersion: '1.0.0' })]);
    expect(l.lastGood.releaseId).toBe(a); // recording a target moves nothing
  });
});

describe('append-only guards (releases, release_marks)', () => {
  const seed = async () => {
    const id = (await release(plain)).body.release.id as string;
    await A.admin.req('POST', `/releases/${id}/marks`, { kind: 'last_good' }, key());
    return id;
  };
  it.each(['releases', 'release_marks'])('%s refuses UPDATE, DELETE and TRUNCATE', async (tbl) => {
    await seed();
    await expect(t.pool.query(tbl === 'releases' ? `update releases set what='x'` : `update release_marks set reason='x'`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from ${tbl}`)).rejects.toThrow(/append-only/);
    // releases is referenced by release_marks, so PostgreSQL refuses its TRUNCATE before the trigger can; the trigger is checked to exist below
    await expect(t.pool.query(`truncate ${tbl}`)).rejects.toThrow(tbl === 'releases' ? /append-only|cannot truncate a table referenced/ : /append-only/);
    const trg = (await t.pool.query(`select count(*)::int as n from pg_trigger where tgrelid = $1::regclass and (tgtype & 32) = 32`, [tbl])).rows[0].n;
    expect(trg, 'a TRUNCATE trigger exists').toBe(1);
    expect(await count(tbl)).toBe(1);
  });
  it('the purge_demo exception lets a DELETE through, only inside a transaction that set it', async () => {
    await seed();
    const c = await t.pool.connect();
    try {
      await c.query('begin'); await c.query(`set local axion.purge_demo = 'on'`);
      await c.query('delete from release_marks'); await c.query('delete from releases'); await c.query('commit');
    } finally { c.release(); }
    expect(await count('releases')).toBe(0);
    expect((await t.pool.query(`show axion.purge_demo`).catch(() => ({ rows: [{ 'axion.purge_demo': '' }] }))).rows[0]['axion.purge_demo'] ?? '').not.toBe('on');
  });
  it('clearDemo still works with release rows present (they do not block the demo purge)', async () => {
    await seed();
    const { clearDemo } = await import('../src/seed/demo.ts');
    await expect(clearDemo(t.app.db, 't-1')).resolves.toBeTruthy();
  });
});

describe('records only: no route releases, deploys, restarts or rolls back', () => {
  it('the release routes are exactly the record routes, and no route anywhere is named deploy, restart or execute', () => {
    const all = t.app.routeTable.filter((r) => r.method !== 'HEAD').map((r) => `${r.method} ${r.url}`);
    expect(all.filter((r) => /\/releases/.test(r)).sort()).toEqual(['GET /api/v1/releases', 'POST /api/v1/releases', 'POST /api/v1/releases/:id/marks']);
    expect(all.filter((r) => /deploy|restart|execute|\/run\b/i.test(r))).toEqual([]);
    expect(all.filter((r) => /rollback/i.test(r) && /release/i.test(r))).toEqual([]); // the existing rollbacks are agent-playbook and organisation records, not releases
  });
});
