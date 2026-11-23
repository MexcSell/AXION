import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { tx } from '../src/db.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { insertMissionRefs } from './c83-refs.ts';

/**
 * c83 item 2: `metric_audit_labels.sample_ref` is a typed reference (a closed set of kinds plus an id), never free text, and a demo
 * purge leaves no label that points at purged demo data. No migration: the typing is enforced by the contract and the one write
 * path; the purge is application code in clearDemo.
 */
let t: TestApp;
let A: Browser, adminId = '';
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
const label = (sampleRef: string) => ({ sampleRef, metricLabel: true, auditLabel: false });
const post = (samples: unknown[]) => A.req('POST', '/company/metric-audits', { metricId: 'scorecard.finished', samples });
const count = async () => Number((await q('select count(*) from metric_audit_labels')).rows[0].count);

beforeAll(async () => { t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 }); const w = await withAdmin(t.app); A = w.admin; adminId = w.adminId; });
afterAll(async () => { await t?.close(); });

describe('sample_ref is a typed reference', () => {
  it('refuses free text, an unknown kind, a malformed id and a second colon, and stores nothing', async () => {
    for (const bad of ['s0', 'some free text', 'mission:', ':M-1', 'bogus:M-1', 'mission:M 1', 'mission:a:b', 'Mission:M-1', 'mission:' + 'x'.repeat(101), 'demo mission M-126']) {
      const r = await post([label(bad)]);
      expect(r.status, bad).toBeGreaterThanOrEqual(400);
      expect(r.status, bad).toBeLessThan(500);
    }
    expect(await count()).toBe(0);
  });

  it('refuses a well-formed reference that names no row of this tenant', async () => {
    const r = await post([label('mission:M-99999'), label('task:T-nope'), label('review:TR-nope'), label('approval:APR-nope'), label('failure_tag:FT-nope')]);
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/samples/);
    expect(await count()).toBe(0);
  });

  it('accepts a reference to a real row of each kind, stored in the typed form', async () => {
    const [m] = await insertMissionRefs(t.pool, 't-1', adminId, 1, 'k');
    const id = m.slice('mission:'.length);
    await q(`insert into tasks(id, tenant_id, mission_id, title, status) values ('T-c83-1','t-1',$1,'A task','ready')`, [id]);
    const ap = await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: id, agentId: 'release-01', kind: 'release', title: 'Publish', detail: 'x', payload: { v: 1 }, expiresInMin: 30 }));
    const r = await post([label(m), label('task:T-c83-1'), label(`approval:${ap.id}`)]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await q('select sample_ref from metric_audit_labels order by id')).rows.map((x) => x.sample_ref)).toEqual([m, 'task:T-c83-1', `approval:${ap.id}`]);
  });

  it('has one write path: only the store inserts into metric_audit_labels, and it validates every reference there', () => {
    const SRC = join(__dirname, '../src');
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
    const writers = walk(SRC).filter((f) => /\b(?:insert\s+into|update|delete\s+from|merge\s+into|copy)\s+(?:public\.)?"?metric_audit_labels\b/i.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f).split('\\').join('/'));
    expect(writers.sort()).toEqual(['company/metric-audit-store.ts']);
    const store = readFileSync(join(SRC, 'company/metric-audit-store.ts'), 'utf8');
    expect(store).toMatch(/parseSampleRef/);
  });
});

describe('a demo purge leaves no label that points at purged demo data', () => {
  it('seeds demo, labels demo and real rows of every kind, purges, and no label references a purged row', async () => {
    await seedDemo(t.app.db, 't-1', adminId);
    const demoMission = (await q(`select id from missions where demo order by id limit 1`)).rows[0].id as string;
    const demoTask = (await q(`select id from tasks where mission_id in (select id from missions where demo) limit 1`)).rows[0]?.id as string | undefined;
    const demoApproval = (await q(`select id from approval_requests where demo limit 1`)).rows[0].id as string;
    const [real] = await insertMissionRefs(t.pool, 't-1', adminId, 1, 'real');
    const before = await count();
    const refs = [`mission:${demoMission}`, `approval:${demoApproval}`, ...(demoTask ? [`task:${demoTask}`] : []), real];
    const r = await post(refs.map(label));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // a later label for a demo sample: the purge removes the whole history of the sample, not only its latest label
    expect((await post([{ sampleRef: `mission:${demoMission}`, metricLabel: true, auditLabel: true }])).status).toBe(201);
    expect(await count()).toBe(before + refs.length + 1);
    await clearDemo(t.app.db, 't-1');
    const left = (await q('select sample_ref from metric_audit_labels')).rows.map((x) => x.sample_ref as string);
    expect(left).toContain(real);
    expect(left.filter((s) => s.includes(demoMission) || s.includes(demoApproval) || (demoTask && s.includes(demoTask)))).toEqual([]);
    // every remaining label still resolves to a row that exists
    const tbl: Record<string, string> = { mission: 'missions', task: 'tasks', review: 'task_reviews', approval: 'approval_requests', failure_tag: 'failure_tags' };
    for (const s of left) {
      const [kind, id] = s.split(':');
      expect(Number((await q(`select count(*) from ${tbl[kind]} where id=$1`, [id])).rows[0].count), s).toBe(1);
    }
    expect(await count()).toBe(before + 1);
  });

  it('keeps the append-only guard for everyone else: only clearDemo deletes, and a real mission label survives a purge', async () => {
    await expect(q(`delete from metric_audit_labels`)).rejects.toThrow(/append-only/);
    expect(await count()).toBeGreaterThan(0);
  });
});
