import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval, consumeApproval, loadBoundAction, digestV2, digestV3, digestOf, rowDigest, currentDigestVersion, boundActionOf, type BoundAction } from '../src/approvals/service.ts';
import { tx } from '../src/db.ts';
import { GOLDEN_V1, GOLDEN_V2, V3_ACTION, V3_SPEC_DIGEST, V3_NULL_SPEC_DIGEST, MUST_DIFFER, MUST_MATCH, MUST_REFUSE, CAPS, PROFILE_SHA, THRESHOLDS_A3 } from './phaseA/digest-fixtures.ts';

/** Phase A, A3: approval digest v3 (v2 + execution profile hash + run caps). OFF unless APPROVAL_DIGEST_VERSION=3. Nothing executes. */
const v3 = (patch: Record<string, unknown> = {}) => ({ ...V3_ACTION, ...patch, ...(patch.runCaps && typeof patch.runCaps === 'object' ? { runCaps: { ...CAPS, ...(patch.runCaps as object) } } : {}) }) as unknown as BoundAction;

describe('v1 and v2 digests are exactly what they were (golden values from the code before this phase)', () => {
  it('v1: digestOf and rowDigest reproduce all golden values', () => {
    expect(GOLDEN_V1.length).toBe(THRESHOLDS_A3.goldenV1);
    for (const g of GOLDEN_V1) {
      expect(digestOf(g.missionId, g.kind, g.payload)).toBe(g.digest);
      expect(rowDigest({ mission_id: g.missionId, kind: g.kind, payload: g.payload, digest_version: 1 })).toBe(g.digest);
      expect(rowDigest({ mission_id: g.missionId, kind: g.kind, payload: g.payload })).toBe(g.digest); // a row with no version is v1
      expect(rowDigest({ mission_id: g.missionId, kind: g.kind, payload: g.payload, digest_version: null })).toBe(g.digest);
    }
  });
  it('v2: digestV2 and rowDigest (from a stored row) reproduce all golden values', () => {
    expect(GOLDEN_V2.length).toBe(THRESHOLDS_A3.goldenV2);
    for (const g of GOLDEN_V2) {
      const a = g.action as BoundAction;
      expect(digestV2(a)).toBe(g.digest);
      const row = { tenant_id: a.tenantId, mission_id: a.missionId, task_id: a.taskId ?? null, kind: a.kind, origin: a.origin ?? null, target: a.target ?? null, payload: a.payload, risk: a.tier, requested_by: a.requestedBy, agent_id: 'x', expires_at: a.expiresAt, digest_version: 2 };
      expect(rowDigest(row)).toBe(g.digest);
      expect(rowDigest({ ...row, exec_profile_sha256: null, run_caps: null })).toBe(g.digest); // the new columns do not touch a v2 row
    }
  });
});

describe('v3 digest', () => {
  it('equals the sha256 of the hand-written canonical string (profile and caps bound, and both null)', () => {
    expect(digestV3(V3_ACTION as unknown as BoundAction)).toBe(V3_SPEC_DIGEST);
    expect(digestV3({ ...V3_ACTION, execProfileSha256: null, runCaps: null } as unknown as BoundAction)).toBe(V3_NULL_SPEC_DIGEST);
    expect(digestV3({ ...V3_ACTION, execProfileSha256: undefined, runCaps: undefined } as unknown as BoundAction)).toBe(V3_NULL_SPEC_DIGEST); // absent counts as null
  });
  it('is never the v2 digest of the same action, even with nothing bound', () => {
    const { execProfileSha256: _p, runCaps: _c, ...plain } = V3_ACTION;
    expect(digestV3(V3_ACTION as unknown as BoundAction)).not.toBe(digestV2(plain as BoundAction));
    expect(digestV3({ ...plain, execProfileSha256: null, runCaps: null } as unknown as BoundAction)).not.toBe(digestV2(plain as BoundAction));
  });
  it(`a change after approval makes the digest differ: ${MUST_DIFFER.length} single changes (profile hash, each of the six caps up and down, removals)`, () => {
    expect(MUST_DIFFER.length).toBeGreaterThanOrEqual(THRESHOLDS_A3.minDiffer);
    const base = digestV3(V3_ACTION as unknown as BoundAction);
    const seen = new Set([base]);
    for (const c of MUST_DIFFER) {
      const d = digestV3(v3(c.patch));
      expect(d, c.id).not.toBe(base);
      expect(seen.has(d), `${c.id} collides with another change`).toBe(false);
      seen.add(d);
    }
  });
  it('the same action spelled another way keeps its digest', () => {
    const base = digestV3(V3_ACTION as unknown as BoundAction);
    for (const c of MUST_MATCH) expect(digestV3(v3(c.patch)), c.id).toBe(base);
  });
  it('partial, fractional, negative, NaN, string or extra caps and a malformed profile hash are refused, never hashed', () => {
    for (const c of MUST_REFUSE) expect(() => digestV3({ ...V3_ACTION, ...c.patch } as unknown as BoundAction), c.id).toThrow();
  });
  it('still covers every v2 field (a changed kind, tier, expiry or payload is another digest)', () => {
    const base = digestV3(V3_ACTION as unknown as BoundAction);
    for (const p of [{ kind: 'release' }, { tier: 'R4' }, { expiresAt: '2026-11-25T10:00:00.001Z' }, { payload: { url: 'https://b.example' } }, { tenantId: 't-2' }, { requestedBy: 'u' }, { origin: 'https://a.example' }]) {
      expect(digestV3({ ...V3_ACTION, ...p } as unknown as BoundAction), JSON.stringify(p)).not.toBe(base);
    }
  });
});

describe('version dispatch is explicit and fails closed', () => {
  const row = { tenant_id: 't-1', mission_id: 'M-1', kind: 'release', payload: { a: 1 }, risk: 'R3', requested_by: 'u', agent_id: 'a', expires_at: '2026-11-25T10:00:00.000Z' };
  it('an unknown version never verifies against any stored digest', () => {
    for (const v of [0, 4, 5, 99, -1, 2.5, '3', 'v3', NaN]) {
      const d = rowDigest({ ...row, digest_version: v });
      expect(d, String(v)).not.toMatch(/^[0-9a-f]{64}$/);
      for (const other of [digestOf('M-1', 'release', { a: 1 }), digestV2(boundActionOf({ ...row, digest_version: 2 })), digestV3(boundActionOf({ ...row, digest_version: 3 }))]) expect(d).not.toBe(other);
    }
  });
  it('a v3 row is not verified as v1 or v2', () => {
    const d3 = rowDigest({ ...row, digest_version: 3 });
    expect(d3).toMatch(/^[0-9a-f]{64}$/);
    expect(d3).not.toBe(rowDigest({ ...row, digest_version: 2 }));
    expect(d3).not.toBe(rowDigest({ ...row, digest_version: 1 }));
  });
  it('a stored row whose caps or profile cannot be hashed never verifies (it is stale, not "no caps")', () => {
    const d = rowDigest({ ...row, digest_version: 3, run_caps: { maxSteps: 1 }, exec_profile_sha256: PROFILE_SHA });
    expect(d).not.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the switch: APPROVAL_DIGEST_VERSION', () => {
  it('is OFF unless the value is exactly 3', () => {
    expect(currentDigestVersion({})).toBe(2);
    expect(currentDigestVersion({ APPROVAL_DIGEST_VERSION: undefined })).toBe(2);
    expect(currentDigestVersion({ APPROVAL_DIGEST_VERSION: '2' })).toBe(2);
    for (const v of ['', ' 3', '3 ', '03', '3.0', 'three', '4', '1', 'true', '-3']) expect(currentDigestVersion({ APPROVAL_DIGEST_VERSION: v }), JSON.stringify(v)).toBe(2);
    expect(currentDigestVersion({ APPROVAL_DIGEST_VERSION: '3' })).toBe(3);
  });
});

describe('rows in the database: v1, v2 and v3 side by side', () => {
  let t: TestApp;
  let A: Awaited<ReturnType<typeof withAdmin>>;
  let n = 0;
  const saved = process.env.APPROVAL_DIGEST_VERSION;
  beforeAll(async () => { t = await makeTestApp({ staffingStepMs: 60_000 }); A = await withAdmin(t.app); }, 60_000);
  afterAll(async () => { await t?.close(); });
  afterEach(() => { if (saved === undefined) delete process.env.APPROVAL_DIGEST_VERSION; else process.env.APPROVAL_DIGEST_VERSION = saved; });
  const mission = async () => (await A.admin.req('POST', '/missions', { text: 'Publish the homepage preview.', files: [], shared: false }, { 'idempotency-key': 'a3-' + Date.now() + n++ })).body.mission.id as string;
  const ask = (missionId: string, extra: Record<string, unknown> = {}) => tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId, agentId: 'release-01', kind: 'release', title: 'T', detail: 'd', payload: { x: n++ }, expiresInMin: 60, ...extra } as any));
  const decide = async (id: string) => {
    const a = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === id);
    return A.admin.req('POST', `/approvals/${id}/decision`, { decision: 'approved', digest: a.digest, reason: 'ok' }, { 'idempotency-key': 'd3-' + Date.now() + n++ });
  };
  const action = (id: string) => tx(t.app.db, (c) => loadBoundAction(c, 't-1', id));
  const consume = (id: string, a: BoundAction) => tx(t.app.db, (c) => consumeApproval(c, { approvalId: id, action: a, by: 'executor-1' }));
  const row = async (id: string) => (await t.pool.query('select * from approval_requests where id=$1', [id])).rows[0];
  const v1Row = async (missionId: string, id: string) => {
    await t.pool.query('alter table approval_requests disable trigger approval_requests_insert_guard');
    try {
      await t.pool.query(`insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, detail, risk, payload, action_digest, expires_at) values ($1,'t-1',$2,'release-01','release','Old','d','R3',$3,$4, now() + interval '1 hour')`,
        [id, missionId, JSON.stringify({ f: 1 }), digestOf(missionId, 'release', { f: 1 })]);
    } finally { await t.pool.query('alter table approval_requests enable trigger approval_requests_insert_guard'); }
  };

  it('with the switch OFF (the default) a new request is v2 with nothing bound, and passing a profile or caps is refused rather than silently dropped', async () => {
    delete process.env.APPROVAL_DIGEST_VERSION;
    const m = await mission();
    const r = await ask(m);
    expect(await row(r.id)).toMatchObject({ digest_version: 2, exec_profile_sha256: null, run_caps: null });
    await expect(ask(m, { execProfileSha256: PROFILE_SHA })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(ask(m, { runCaps: CAPS })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('with the switch ON a request binds the profile hash and caps: v3 row, stored columns, server-recomputed digest, and the decision route accepts it', async () => {
    process.env.APPROVAL_DIGEST_VERSION = '3';
    const m = await mission();
    const r = await ask(m, { execProfileSha256: PROFILE_SHA, runCaps: CAPS });
    const x = await row(r.id);
    expect(x).toMatchObject({ digest_version: 3, exec_profile_sha256: PROFILE_SHA });
    expect(x.run_caps).toEqual(CAPS);
    expect(rowDigest(x)).toBe(x.action_digest);
    expect(r.digest).toBe(x.action_digest);
    const dto = (await A.admin.req('GET', '/approvals')).body.approvals.find((d: any) => d.id === r.id);
    expect(dto).toMatchObject({ digestVersion: 3, digest: x.action_digest });
    expect((await decide(r.id)).status).toBe(200);
    const a = await action(r.id);
    expect(a).toMatchObject({ execProfileSha256: PROFILE_SHA, runCaps: CAPS });
    await consume(r.id, a);
  });

  it('after approval, every single change to the profile hash or a cap is refused at consume, and the exact action still goes through once', async () => {
    process.env.APPROVAL_DIGEST_VERSION = '3';
    const m = await mission();
    const r = await ask(m, { execProfileSha256: PROFILE_SHA, runCaps: CAPS });
    await decide(r.id);
    const a = await action(r.id);
    let refused = 0;
    for (const c of MUST_DIFFER) {
      const presented = { ...a, ...(c.patch.execProfileSha256 !== undefined ? { execProfileSha256: c.patch.execProfileSha256 } : {}), ...(c.patch.runCaps !== undefined ? { runCaps: c.patch.runCaps === null ? null : { ...CAPS, ...c.patch.runCaps } } : {}) } as BoundAction;
      await expect(consume(r.id, presented), c.id).rejects.toMatchObject({ code: 'APPROVAL_DIGEST_MISMATCH' });
      refused++;
    }
    for (const c of MUST_REFUSE) await expect(consume(r.id, { ...a, ...c.patch } as unknown as BoundAction), c.id).rejects.toMatchObject({ code: 'APPROVAL_DIGEST_MISMATCH' });
    expect(refused).toBe(MUST_DIFFER.length);
    expect((await row(r.id)).consumed_at).toBeNull(); // none of the refusals spent it
    await consume(r.id, a);
    await expect(consume(r.id, a)).rejects.toMatchObject({ code: 'APPROVAL_ALREADY_CONSUMED' });
  });

  it('a v3 request with nothing supplied binds explicit nulls, and a profile or caps cannot be added at consume', async () => {
    process.env.APPROVAL_DIGEST_VERSION = '3';
    const m = await mission();
    const r = await ask(m);
    expect(await row(r.id)).toMatchObject({ digest_version: 3, exec_profile_sha256: null, run_caps: null });
    await decide(r.id);
    const a = await action(r.id);
    expect(a).toMatchObject({ execProfileSha256: null, runCaps: null });
    await expect(consume(r.id, { ...a, execProfileSha256: PROFILE_SHA })).rejects.toMatchObject({ code: 'APPROVAL_DIGEST_MISMATCH' });
    await expect(consume(r.id, { ...a, runCaps: CAPS })).rejects.toMatchObject({ code: 'APPROVAL_DIGEST_MISMATCH' });
    await consume(r.id, a);
  });

  it('a v3 request with a malformed profile hash or caps is refused at request time (VALIDATION) and writes no row', async () => {
    process.env.APPROVAL_DIGEST_VERSION = '3';
    const m = await mission();
    const before = (await t.pool.query('select count(*)::int n from approval_requests')).rows[0].n;
    for (const c of MUST_REFUSE) await expect(ask(m, c.patch), c.id).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await t.pool.query('select count(*)::int n from approval_requests')).rows[0].n).toBe(before);
  });

  it('v1, v2 and v3 rows side by side each verify with their own version and consume', async () => {
    const m = await mission();
    await v1Row(m, 'APR-a3-v1');
    delete process.env.APPROVAL_DIGEST_VERSION;
    const r2 = await ask(m);
    process.env.APPROVAL_DIGEST_VERSION = '3';
    const r3 = await ask(m, { execProfileSha256: PROFILE_SHA, runCaps: CAPS });
    const rows = await Promise.all(['APR-a3-v1', r2.id, r3.id].map(row));
    expect(rows.map((x) => x.digest_version)).toEqual([1, 2, 3]);
    for (const x of rows) expect(rowDigest(x), `v${x.digest_version}`).toBe(x.action_digest);
    for (const id of ['APR-a3-v1', r2.id, r3.id]) { expect((await decide(id)).status).toBe(200); await consume(id, await action(id)); }
    // a v2 action presented against the v3 row (or the reverse) is a different digest
    const m2 = await mission();
    const r4 = await ask(m2, { execProfileSha256: PROFILE_SHA, runCaps: CAPS });
    await decide(r4.id);
    const a4 = await action(r4.id);
    const { execProfileSha256: _p, runCaps: _c, ...asV2 } = a4;
    expect(digestV2(asV2 as BoundAction)).not.toBe((await row(r4.id)).action_digest);
  });

  it('the database keeps the bound profile hash and caps immutable, allows v3 rows, refuses other versions, and still refuses new v1 rows', async () => {
    process.env.APPROVAL_DIGEST_VERSION = '3';
    const m = await mission();
    const r = await ask(m, { execProfileSha256: PROFILE_SHA, runCaps: CAPS });
    await expect(t.pool.query(`update approval_requests set run_caps = run_caps || '{"maxSteps": 9999}'::jsonb where id=$1`, [r.id])).rejects.toThrow(/immutable/);
    await expect(t.pool.query(`update approval_requests set exec_profile_sha256 = $2 where id=$1`, [r.id, 'cd'.repeat(32)])).rejects.toThrow(/immutable/);
    await expect(t.pool.query(`update approval_requests set exec_profile_sha256 = null where id=$1`, [r.id])).rejects.toThrow(/immutable/);
    const ins = (v: number) => t.pool.query(`insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, payload, action_digest, digest_version, expires_at) values ($1,'t-1',$2,'release-01','release','T','R3','{}','x',$3, now() + interval '1 hour')`, ['APR-a3-v' + v + '-' + n++, m, v]);
    await expect(ins(4)).rejects.toThrow();
    await expect(ins(1)).rejects.toThrow(/digest v2 or v3/);
    await ins(3);
    // a malformed stored profile hash or caps object is refused by the table itself
    await expect(t.pool.query(`insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, payload, action_digest, digest_version, exec_profile_sha256, expires_at) values ('APR-a3-bad1','t-1',$1,'release-01','release','T','R3','{}','x',3,'nothex', now() + interval '1 hour')`, [m])).rejects.toThrow();
  });

  it('a tampered stored cap makes the row stale: the recomputed digest no longer matches, and consume refuses', async () => {
    process.env.APPROVAL_DIGEST_VERSION = '3';
    const m = await mission();
    const r = await ask(m, { execProfileSha256: PROFILE_SHA, runCaps: CAPS });
    await decide(r.id);
    const good = await action(r.id);
    const c = await t.pool.connect();
    try { // Test-DB-only: the guard trigger is switched off inside the test, as a tamperer with table rights would
      await c.query('alter table approval_requests disable trigger approval_requests_guard');
      try { await c.query(`update approval_requests set run_caps = run_caps || '{"maxSteps": 5000}'::jsonb where id=$1`, [r.id]); } finally { await c.query('alter table approval_requests enable trigger approval_requests_guard'); }
    } finally { c.release(); }
    const x = await row(r.id);
    expect(rowDigest(x)).not.toBe(x.action_digest); // stale: attention and the decision route compare exactly this
    await expect(consume(r.id, good)).rejects.toMatchObject({ code: 'APPROVAL_DIGEST_MISMATCH' }); // the executor still presents what was approved
    await expect(consume(r.id, await action(r.id))).rejects.toMatchObject({ code: 'APPROVAL_DIGEST_MISMATCH' }); // and presenting the tampered caps does not help
  });
});
