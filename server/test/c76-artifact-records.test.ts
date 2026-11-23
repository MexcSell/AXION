import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';

/**
 * c76 A1 (PARKED, owner Q11): artifact METADATA and immutable versions. No file is stored and none can be downloaded.
 */
let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
beforeEach(async () => { t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 }); A = await withAdmin(t.app); });
afterEach(async () => { await t.close(); });

let n = 0;
const key = () => ({ 'idempotency-key': 'a' + Date.now() + n++ });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const v = (s: string, over: Record<string, unknown> = {}) => ({ sha256: sha(s), sizeBytes: s.length, mediaType: 'text/markdown', producer: 'writer-01', producerKind: 'agent', ...over });
const create = (name: string, over: Record<string, unknown> = {}) => A.admin.req('POST', '/artifacts', { name, version: v(name), ...over }, key());
const addVersion = (id: string, s: string, over: Record<string, unknown> = {}) => A.admin.req('POST', `/artifacts/${id}/versions`, v(s, over), key());
const count = async (tbl: string) => Number((await t.pool.query(`select count(*) from ${tbl}`)).rows[0].count);

describe('artifact metadata', () => {
  it('records an artifact with its first immutable version: sha256, size, media type and producer', async () => {
    const r = await create('Quarterly summary');
    expect(r.status).toBe(201);
    expect(r.body.artifact).toMatchObject({ name: 'Quarterly summary', versionCount: 1, latest: { version: 1, sha256: sha('Quarterly summary'), sizeBytes: 17, mediaType: 'text/markdown', producer: 'writer-01', producerKind: 'agent' } });
    expect(r.body.artifact.id).toMatch(/^ART-[0-9A-F]{32}$/);
    const au = (await t.pool.query(`select action, result, detail from audit_events where action like 'artifact.%'`)).rows;
    expect(au).toEqual([expect.objectContaining({ action: 'artifact.create', result: 'ok' })]);
  });
  it('a new version is numbered by the server, 1, 2, 3, and the old ones are kept as they were', async () => {
    const id = (await create('Report')).body.artifact.id;
    const v2 = await addVersion(id, 'second draft');
    expect(v2.status).toBe(201);
    expect(v2.body.version).toMatchObject({ version: 2, sha256: sha('second draft') });
    expect((await addVersion(id, 'third draft', { mediaType: 'application/pdf', producer: 'mina', producerKind: 'user' })).body.version.version).toBe(3);
    const d = (await A.admin.req('GET', `/artifacts/${id}`)).body;
    expect(d.artifact).toMatchObject({ versionCount: 3, latest: { version: 3, mediaType: 'application/pdf' } });
    expect(d.versions.map((x: any) => [x.version, x.sha256])).toEqual([[3, sha('third draft')], [2, sha('second draft')], [1, sha('Report')]]);
    const list = (await A.admin.req('GET', '/artifacts')).body;
    expect(list.artifacts).toHaveLength(1);
    expect(list.artifacts[0].versionCount).toBe(3);
  });
  it('20 concurrent new versions get 20 distinct numbers with no gap', async () => {
    const id = (await create('Busy')).body.artifact.id;
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => addVersion(id, 'c' + i)));
    expect(rs.map((r) => r.status)).toEqual(Array(20).fill(201));
    const nums = (await t.pool.query('select version from artifact_versions where artifact_id=$1 order by version', [id])).rows.map((r) => r.version);
    expect(nums).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });
  it('refuses a malformed hash, size, media type or producer; a repeat of the latest hash; a duplicate name; an unknown artifact; and members', async () => {
    for (const bad of [{ sha256: 'ABC' }, { sha256: sha('x').toUpperCase() }, { sizeBytes: -1 }, { sizeBytes: 1.5 }, { sizeBytes: 2 ** 41 }, { mediaType: 'nonsense' }, { mediaType: 'text/ plain' }, { producer: '' }, { producerKind: 'robot' }, { extra: 1 }])
      expect((await create('Bad ' + JSON.stringify(bad).slice(0, 20), { version: { ...v('x'), ...bad } })).status, JSON.stringify(bad)).toBe(400);
    expect(await count('artifacts')).toBe(0);
    const id = (await create('Once')).body.artifact.id;
    expect((await addVersion(id, 'Once')).status).toBe(409); // identical to the latest version: nothing new to record
    expect((await create('Once')).status).toBe(409);
    expect((await addVersion('ART-00000000000000000000000000000000', 'x')).status).toBe(404);
    expect((await A.admin.req('GET', '/artifacts/not-an-id')).status).toBe(404);
    const mina = (await A.member('Mina')).b;
    expect((await mina.req('POST', '/artifacts', { name: 'M', version: v('M') }, key())).status).toBe(403);
    expect((await mina.req('GET', '/artifacts')).status).toBe(403);
    expect(await count('artifact_versions')).toBe(1);
  });
});

describe('append-only guards (artifacts, artifact_versions)', () => {
  const seed = async () => { const id = (await create('Guarded')).body.artifact.id; await addVersion(id, 'two'); return id; };
  it.each([['artifacts', `update artifacts set name='x'`], ['artifact_versions', `update artifact_versions set sha256='${'0'.repeat(64)}'`], ['artifact_versions', `update artifact_versions set size_bytes=9`]])('%s refuses UPDATE: %s', async (tbl, upd) => {
    await seed();
    await expect(t.pool.query(upd)).rejects.toThrow(/append-only/);
  });
  it.each(['artifacts', 'artifact_versions'])('%s refuses DELETE and has a TRUNCATE trigger', async (tbl) => {
    await seed();
    await expect(t.pool.query(`delete from ${tbl}`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate ${tbl}`)).rejects.toThrow(tbl === 'artifacts' ? /append-only|cannot truncate a table referenced/ : /append-only/);
    expect((await t.pool.query(`select count(*)::int as n from pg_trigger where tgrelid = $1::regclass and (tgtype & 32) = 32`, [tbl])).rows[0].n).toBe(1);
    expect(await count(tbl)).toBeGreaterThan(0);
  });
  it('the purge_demo exception lets a DELETE through only inside a transaction that set it, and the cascade follows', async () => {
    await seed();
    await expect(t.pool.query('delete from artifacts')).rejects.toThrow(/append-only/); // outside the exception
    const c = await t.pool.connect();
    try { await c.query('begin'); await c.query(`set local axion.purge_demo = 'on'`); await c.query('delete from artifacts'); await c.query('commit'); } finally { c.release(); }
    expect(await count('artifacts')).toBe(0);
    expect(await count('artifact_versions')).toBe(0);
    await expect(t.pool.query('delete from artifacts')).resolves.toBeTruthy(); // nothing left to delete: no row trigger fires, but the flag did not leak either:
    const id = (await create('After')).body.artifact.id;
    await expect(t.pool.query('delete from artifacts where id=$1', [id])).rejects.toThrow(/append-only/);
  });
  it('the database numbers versions in sequence and keeps them inside their tenant, even for a raw insert', async () => {
    const id = (await create('Raw')).body.artifact.id;
    const ins = (ver: number, tenant = 't-1') => t.pool.query(`insert into artifact_versions(artifact_id, tenant_id, version, sha256, size_bytes, media_type, producer, producer_kind, recorded_by) values ($1,$2,$3,$4,1,'text/plain','p','user','u')`, [id, tenant, ver, sha('raw' + ver)]);
    await expect(ins(5)).rejects.toThrow(/in sequence/);
    await expect(ins(1)).rejects.toThrow();
    await expect(ins(2, 't-other')).rejects.toThrow();
    await expect(ins(2)).resolves.toBeTruthy();
  });
  it('clearDemo still works with artifacts present', async () => {
    await seed();
    const { clearDemo } = await import('../src/seed/demo.ts');
    await expect(clearDemo(t.app.db, 't-1')).resolves.toBeTruthy();
  });
});

describe('records only: no file storage and no download route', () => {
  it('the artifact routes are exactly the four metadata routes; nothing stores, serves or signs a file', () => {
    const all = t.app.routeTable.filter((r) => r.method !== 'HEAD').map((r) => `${r.method} ${r.url}`);
    expect(all.filter((r) => /\/artifacts/.test(r)).sort()).toEqual(['GET /api/v1/artifacts', 'GET /api/v1/artifacts/:id', 'POST /api/v1/artifacts', 'POST /api/v1/artifacts/:id/versions']);
    expect(all.filter((r) => /download|ticket|signed|content|bytes|blob/i.test(r))).toEqual([]);
  });
  it('no column of the artifact tables can hold content: no bytea, no large object, no path or url', async () => {
    const cols = (await t.pool.query(`select table_name, column_name, data_type from information_schema.columns where table_schema = current_schema() and table_name in ('artifacts','artifact_versions')`)).rows;
    expect(cols.filter((c) => c.data_type === 'bytea' || /path|url|content|blob|body|data/i.test(c.column_name))).toEqual([]);
  });
});
