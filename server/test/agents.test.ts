import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, makeSchema, type TestApp, type Browser } from './helpers.ts';
import { migrate } from '../src/migrate.ts';
import { seedCompany } from '../src/agents/seed.ts';
import { createOrgRevision } from '../src/agents/org.ts';
import { tx } from '../src/db.ts';
import { AGENTS } from '../../web/src/data/agents.ts';

let t: TestApp;
let admin: Browser;
let member: Browser;
let n = 0;
const key = () => ({ 'idempotency-key': 'k' + n++ });

beforeAll(async () => {
  t = await makeTestApp();
  const w = await withAdmin(t.app);
  admin = w.admin;
  member = (await w.member('Mia')).b;
});
afterAll(async () => { await t.close(); });

const count = async (sql: string) => (await t.pool.query(sql)).rows[0].n as number;

describe('seeding', () => {
  it('is idempotent: every fixture agent, one version each, one org revision', async () => {
    expect(AGENTS.length).toBe(24); // 18 base agents + 6 derived (u1)
    await tx(t.app.db, (c) => seedCompany(c, 't-1'));
    await tx(t.app.db, (c) => seedCompany(c, 't-1'));
    expect(await count('select count(*)::int n from agent_definitions')).toBe(AGENTS.length);
    expect(await count('select count(*)::int n from agent_versions')).toBe(AGENTS.length);
    expect(await count('select count(*)::int n from org_revisions')).toBe(1);
    expect(await count('select count(*)::int n from org_edges')).toBe(AGENTS.length - 1); // every agent but GM has a manager
  });

  it('GET /agents returns the UI shape with demo-fixture provenance', async () => {
    const r = await member.req('GET', '/agents');
    expect(r.status).toBe(200);
    expect(r.body.agents.length).toBe(AGENTS.length);
    const coder = r.body.agents.find((a: any) => a.id === 'coder-01');
    const fx = AGENTS.find((a) => a.id === 'coder-01')!;
    expect(coder.provenance).toEqual({ source: 'demo-fixture', sample: null, window: '90d' });
    expect(coder.versionLabel).toBe(fx.version);
    expect(coder.version).toBe(fx.version);
    expect(coder.versionId).toBeTruthy();
    expect(coder.skills).toEqual(fx.skills);
    expect(coder.model).toBe(fx.model);
    expect(coder.metrics).toEqual(fx.metrics);
    expect(coder.managerId).toBe('gm');
    expect(coder.duty).toBe(fx.duty);
    const site = r.body.agents.find((a: any) => a.id === 'site-upwork');
    expect(site.parentId).toBe('homepage-01');
    expect(site.site).toBe('upwork.com');
  });

  it('GET /agents requires sign-in; GET /agents/:id has versions; unknown id is 404', async () => {
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/agents' });
    expect(anon.statusCode).toBe(401);
    const r = await member.req('GET', '/agents/gm');
    expect(r.body.agent.versions.length).toBe(1);
    expect((await member.req('GET', '/agents/nope')).status).toBe(404);
  });
});

describe('create', () => {
  const body = { id: 'tax-01', name: 'Tax-01', role: 'finance', dept: 'Finance', duty: 'Tax preparation', description: 'Prepares tax filings.', model: 'claude-sonnet-5-5', skills: ['Tax law'] };
  it('members get 403', async () => {
    expect((await member.req('POST', '/agents', body, key())).status).toBe(403);
    expect((await member.req('PATCH', '/agents/gm', { name: 'X' }, { 'if-match': '1' })).status).toBe(403);
  });
  it('needs an Idempotency-Key', async () => {
    expect((await admin.req('POST', '/agents', body)).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('a duplicate role is ROLE_TAKEN, a duplicate duty (any case) is DUTY_TAKEN', async () => {
    const r1 = await admin.req('POST', '/agents', { ...body, role: 'manager' }, key());
    expect(r1.status).toBe(409); expect(r1.body.code).toBe('ROLE_TAKEN');
    const r2 = await admin.req('POST', '/agents', { ...body, duty: 'general manager' }, key());
    expect(r2.status).toBe(409); expect(r2.body.code).toBe('DUTY_TAKEN');
  });
  it('creates the agent with a first version, an event and an org edge; replays idempotently', async () => {
    const k = key();
    const r = await admin.req('POST', '/agents', body, k);
    expect(r.status).toBe(201);
    expect(r.body.agent.versionLabel).toBe('v1.0.0');
    expect(r.body.agent.managerId).toBe('gm');
    const again = await admin.req('POST', '/agents', body, k);
    expect(again.status).toBe(201);
    expect(await count(`select count(*)::int n from agent_definitions where id='tax-01'`)).toBe(1);
    expect(await count(`select count(*)::int n from events where type='agent.created' and subject_id='tax-01'`)).toBe(1);
    expect(await count('select count(*)::int n from org_revisions')).toBe(2);
    const dup = await admin.req('POST', '/agents', { ...body, id: 'tax-02', name: 'Tax-02', duty: 'Other duty' }, key());
    expect(dup.body.code).toBe('ROLE_TAKEN');
  });
});

describe('update and versions', () => {
  it('a name-only PATCH edits the definition and creates no version', async () => {
    const before = (await admin.req('GET', '/agents/tester-01'));
    const id = before.body.agent.id;
    const rv = before.body.agent.rowVersion;
    const r = await admin.req('PATCH', `/agents/${id}`, { name: 'QA-Prime' }, { 'if-match': String(rv) });
    expect(r.status).toBe(200);
    expect(r.body.agent.name).toBe('QA-Prime');
    expect(r.body.agent.rowVersion).toBe(rv + 1);
    expect(await count(`select count(*)::int n from agent_versions where agent_id='${id}'`)).toBe(1);
    expect(await count(`select count(*)::int n from events where type='agent.updated' and subject_id='${id}'`)).toBe(1);
  });

  it('a skills PATCH creates v(n+1); the old row is unchanged and immutable', async () => {
    const g = await admin.req('GET', '/agents/coder-01');
    const old = g.body.agent;
    const r = await admin.req('PATCH', '/agents/coder-01', { skills: [...old.skills, 'Rust'] }, { 'if-match': String(old.rowVersion) });
    expect(r.status).toBe(200);
    expect(r.body.agent.versions.length).toBe(2);
    expect(r.body.agent.versionId).not.toBe(old.versionId);
    expect(r.body.agent.versionLabel).not.toBe(old.versionLabel);
    expect(r.body.agent.skills).toContain('Rust');
    const rows = (await t.pool.query(`select * from agent_versions where agent_id='coder-01' order by seq`)).rows;
    expect(rows[0].id).toBe(old.versionId);
    expect(rows[0].skills).toEqual(old.skills);
    expect(rows[1].parent_version_id).toBe(rows[0].id);
    expect(rows[1].seq).toBe(2);
    expect(await count(`select count(*)::int n from events where type='agent.versionCreated' and subject_id='coder-01'`)).toBe(1);
    await expect(t.pool.query(`update agent_versions set model='x'`)).rejects.toThrow(/agent_versions is append-only/);
    await expect(t.pool.query(`delete from agent_versions`)).rejects.toThrow(/agent_versions is append-only/);
  });

  it('PATCH needs If-Match (428) and a stale one is 409', async () => {
    expect((await admin.req('PATCH', '/agents/gm', { name: 'GM2' })).status).toBe(428);
    const r = await admin.req('PATCH', '/agents/gm', { name: 'GM2' }, { 'if-match': '999' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONFLICT');
  });

  it('a PATCH with the same skills creates no version', async () => {
    const g = (await admin.req('GET', '/agents/ops-01')).body.agent;
    const r = await admin.req('PATCH', '/agents/ops-01', { skills: g.skills }, { 'if-match': String(g.rowVersion) });
    expect(r.status).toBe(200);
    expect(r.body.agent.versions.length).toBe(1);
  });
});

describe('organization graph', () => {
  it('GET /organization/graph and /revisions', async () => {
    const g = await member.req('GET', '/organization/graph');
    expect(g.status).toBe(200);
    expect(g.body.revision.seq).toBeGreaterThanOrEqual(1);
    expect(g.body.edges.every((e: any) => e.supervisorId && e.subordinateId)).toBe(true);
    const r = await member.req('GET', '/organization/revisions');
    expect(r.body.revisions.length).toBe(g.body.revision.seq);
  });

  it('an edge set with a cycle (or a self-edge) is 422 ORG_CYCLE and nothing is stored', async () => {
    const before = await count('select count(*)::int n from org_revisions');
    const cyc = [{ supervisorId: 'ops-01', subordinateId: 'tester-01' }, { supervisorId: 'tester-01', subordinateId: 'ops-01' }];
    await expect(tx(t.app.db, (c) => createOrgRevision(c, { tenantId: 't-1', edges: cyc, note: 'x', createdBy: 'u' }))).rejects.toMatchObject({ code: 'ORG_CYCLE', status: 422 });
    await expect(tx(t.app.db, (c) => createOrgRevision(c, { tenantId: 't-1', edges: [{ supervisorId: 'gm', subordinateId: 'gm' }], note: 'x', createdBy: 'u' }))).rejects.toMatchObject({ code: 'ORG_CYCLE' });
    expect(await count('select count(*)::int n from org_revisions')).toBe(before);
  });

  it('org_edges and org_revisions are append-only', async () => {
    await expect(t.pool.query(`update org_edges set edge_type='x'`)).rejects.toThrow(/org_edges is append-only/);
    await expect(t.pool.query(`delete from org_revisions`)).rejects.toThrow(/org_revisions is append-only/);
  });
});

describe('migration 0006', () => {
  it('up → down → up works', async () => {
    const s = await makeSchema({ migrate: false });
    await migrate(s.pool, 'up');
    await migrate(s.pool, 'down', 5);
    const tabs = (await s.pool.query(`select table_name from information_schema.tables where table_schema=$1`, [s.schema])).rows.map((r) => r.table_name);
    expect(tabs).not.toContain('agent_versions');
    await migrate(s.pool, 'up');
    await migrate(s.pool, 'down', 0);
    await migrate(s.pool, 'up');
    await s.drop();
  });
});
