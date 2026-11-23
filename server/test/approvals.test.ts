import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { createNotification } from '../src/notifications/routes.ts';
import { tx } from '../src/db.ts';

let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
let mina: { b: Browser; id: string };
let kenji: { b: Browser; id: string };
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  A = await withAdmin(t.app);
  mina = await A.member('Mina');
  kenji = await A.member('Kenji');
});
afterEach(async () => { await t.close(); });

let n = 0;
const create = (b: Browser, body: Record<string, unknown> = {}) => b.req('POST', '/missions', { text: 'Publish the homepage preview.', files: [], shared: false, ...body }, { 'idempotency-key': 'k' + Date.now() + n++ });
const ask = (missionId: string, over: Record<string, unknown> = {}) => tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId, agentId: 'release-01', kind: 'release', title: 'Publish homepage v2.1', detail: 'Release-01 asks to publish.', payload: { version: 'v2.1' }, expiresInMin: 60, ...over }));

describe('approvals', () => {
  it('lists approvals of visible missions only, with a digest', async () => {
    const m = (await create(mina.b)).body.mission;
    const a = await ask(m.id);
    const mine = (await mina.b.req('GET', '/approvals')).body.approvals;
    expect(mine.map((x: any) => x.id)).toEqual([a.id]);
    expect(mine[0]).toMatchObject({ missionId: m.id, status: 'pending', risk: 'high', riskTier: 'R3', kind: 'release' });
    expect(mine[0].digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await kenji.b.req('GET', '/approvals')).body.approvals).toEqual([]);
    const k = await kenji.b.req('POST', `/approvals/${a.id}/decision`, { decision: 'approved', digest: mine[0].digest });
    expect(k.status).toBe(404);
  });

  it('decides once; a mismatched digest or an expired request is stale', async () => {
    const m = (await create(mina.b)).body.mission;
    const a = await ask(m.id, { kind: 'submit_form' });
    const bad = await mina.b.req('POST', `/approvals/${a.id}/decision`, { decision: 'approved', digest: '0'.repeat(64) });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('APPROVAL_STALE');
    const ok = await mina.b.req('POST', `/approvals/${a.id}/decision`, { decision: 'approved', digest: a.digest, reason: 'looks good' });
    expect(ok.status).toBe(200);
    expect(ok.body.approval.status).toBe('approved');
    const again = await A.admin.req('POST', `/approvals/${a.id}/decision`, { decision: 'denied', digest: a.digest });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('APPROVAL_ALREADY_DECIDED');
    const old = await ask(m.id, { kind: 'submit_form', expiresInMin: -1 });
    const exp = await mina.b.req('POST', `/approvals/${old.id}/decision`, { decision: 'approved', digest: old.digest });
    expect(exp.status).toBe(409);
    expect(exp.body.code).toBe('APPROVAL_STALE');
    const decisions = (await t.pool.query('select count(*)::int n from approval_decisions')).rows[0].n;
    expect(decisions).toBe(1);
    await expect(t.pool.query('update approval_decisions set decision=$1', ['denied'])).rejects.toThrow(/append-only/);
  });

  it('the last pending approval moves a waiting mission back to running', async () => {
    const m = (await create(mina.b)).body.mission;
    await t.pool.query(`update missions set status='waiting_approval' where id=$1`, [m.id]);
    const a = await ask(m.id, { kind: 'submit_form' });
    await mina.b.req('POST', `/approvals/${a.id}/decision`, { decision: 'approved', digest: a.digest });
    expect((await mina.b.req('GET', `/missions/${m.id}`)).body.mission.status).toBe('running');
  });
});

describe('notifications', () => {
  it('a new user request notifies every admin, not members; read state is per user', async () => {
    await new Browser(t.app).connect('Tomo', 'tomopass');
    const adm = (await A.admin.req('GET', '/notifications')).body;
    const req = adm.notifications.find((x: any) => x.title.includes('Tomo'));
    expect(req).toBeTruthy();
    expect(req.category).toBe('approval');
    expect((await mina.b.req('GET', '/notifications')).body.notifications.some((x: any) => x.title.includes('Tomo'))).toBe(false);
    expect((await A.admin.req('POST', `/notifications/${req.id}/ack`, {})).status).toBe(200);
    expect((await A.admin.req('GET', '/notifications')).body.read).toContain(req.id);
    expect((await mina.b.req('GET', '/notifications')).body.read).not.toContain(req.id);
  });

  it('mission notices follow mission visibility; ack-all marks the given ids', async () => {
    const m = (await create(mina.b)).body.mission;
    await tx(t.app.db, (c) => createNotification(c, { tenantId: 't-1', missionId: m.id, severity: 'info', category: 'mission', title: 'Summary updated', body: 'x' }));
    expect((await mina.b.req('GET', '/notifications')).body.notifications.some((x: any) => x.missionId === m.id)).toBe(true);
    expect((await kenji.b.req('GET', '/notifications')).body.notifications.some((x: any) => x.missionId === m.id)).toBe(false);
    // c81: ack-all marks only notices the caller can see; ids that do not exist, or that Mina may not see, store nothing (this test used to ack the made-up ids N-1 and N-2)
    const mine = (await mina.b.req('GET', '/notifications')).body.notifications.map((x: any) => x.id as string);
    const r = await mina.b.req('POST', '/notifications/ack-all', { ids: [...mine, 'N-1', 'N-2'] });
    expect(r.status).toBe(200);
    const read = (await mina.b.req('GET', '/notifications')).body.read;
    expect(read).toEqual(expect.arrayContaining(mine));
    expect(read).not.toContain('N-1');
    expect(read).not.toContain('N-2');
  });
});

describe('execution guard (Stage 5: nothing executes)', () => {
  it('creating and starting a mission creates no tasks and runs stay disabled', async () => {
    const m = (await create(mina.b)).body.mission;
    await mina.b.req('POST', `/missions/${m.id}/actions/start`, {}, { 'idempotency-key': 's' + n++ });
    expect((await t.pool.query('select count(*)::int n from tasks')).rows[0].n).toBe(0);
    const runs = (await t.pool.query('select execution from mission_runs')).rows;
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.execution === 'disabled')).toBe(true);
  });

  it('no server module imports a process, browser or model runner', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    walk(join(import.meta.dirname, '..', 'src'));
    for (const f of ['features/mission/staffing-plan.ts', 'data/agents.ts', 'data/missions.ts', 'data/types.ts']) files.push(join(import.meta.dirname, '..', '..', 'web', 'src', f)); // the web files the server imports
    const banned = /from ['"](node:)?(child_process|worker_threads|cluster)['"]|from ['"](playwright|puppeteer|openai|@anthropic-ai\/[^'"]+|ollama|bullmq|pg-boss)['"]|\bspawn\(|\bexecFile?\(|\bfetch\(/;
    const hits = files.filter((f) => banned.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
    expect(files.length).toBeGreaterThan(15);
  });
});
