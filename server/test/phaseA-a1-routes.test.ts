import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { tx } from '../src/db.ts';
import { saveTrajectory } from '../src/trajectory/recorder.ts';
import { TRAJECTORIES } from './phaseA/trajectory-fixtures.ts';
import { runFixture } from './phaseA/trajectory-executor.ts';

/** Phase A, A1: GET /runs/trajectories and GET /runs/trajectories/:id. Administrators only, read only. Nothing executes. */
let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
let mem: { b: { req: (...x: any[]) => Promise<any> } };
const fx = (id: string) => TRAJECTORIES.find((x) => x.id === id)!;
const put = (id: string, runId: string, tenant = 't-1', over: { piiFields?: string[] } = {}) => tx(t.app.db, (c) => saveTrajectory(c, tenant, runFixture(fx(id), { runId, tenantId: tenant, ...over }).built, 'executor-fake'));
beforeAll(async () => {
  t = await makeTestApp(); A = await withAdmin(t.app); mem = await A.member('Mina');
  await put('t02', 'RUN-r-known');
  await put('t19', 'RUN-r-unknown');
  await put('t09', 'RUN-r-stopped');
  await put('t01', 'RUN-r-other-tenant', 'someone-else');
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('GET /runs/trajectories', () => {
  it('administrators only', async () => {
    expect((await mem.b.req('GET', '/runs/trajectories')).status).toBe(403);
    expect((await mem.b.req('GET', '/runs/trajectories/RUN-r-known')).status).toBe(403);
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/runs/trajectories' });
    expect(anon.statusCode).toBe(401);
  });
  it('lists this tenant\'s runs newest first with cost, claim and step counts, and never another tenant\'s', async () => {
    const r = await A.admin.req('GET', '/runs/trajectories');
    expect(r.status).toBe(200);
    const ids = r.body.runs.map((x: any) => x.id);
    expect(ids).toEqual(['RUN-r-stopped', 'RUN-r-unknown', 'RUN-r-known']);
    const byId = Object.fromEntries(r.body.runs.map((x: any) => [x.id, x]));
    expect(byId['RUN-r-known']).toMatchObject({ steps: 3, executedSteps: 3, cost: { status: 'known', micros: 600, text: '600 micro-units' }, claim: { label: 'verified', text: 'verified' }, tokens: 60 });
    expect(byId['RUN-r-unknown'].cost).toMatchObject({ status: 'unknown', micros: null, lowerBoundMicros: 100, missingSteps: 1, text: 'unknown' });
    expect(byId['RUN-r-unknown'].tokens).toBeNull();
    expect(byId['RUN-r-stopped']).toMatchObject({ steps: 3, executedSteps: 2, finalClaim: 'failure', claim: { label: 'no_success_claimed' } });
    expect(JSON.stringify(r.body)).not.toContain('RUN-r-other-tenant');
  });
  it('limit is bounded and must be a number', async () => {
    expect((await A.admin.req('GET', '/runs/trajectories?limit=1')).body.runs).toHaveLength(1);
    expect((await A.admin.req('GET', '/runs/trajectories?limit=0')).status).toBe(400);
    expect((await A.admin.req('GET', '/runs/trajectories?limit=999')).status).toBe(400);
    expect((await A.admin.req('GET', '/runs/trajectories?limit=abc')).status).toBe(400);
  });
});

describe('GET /runs/trajectories/:id', () => {
  it('returns the steps, the chain status, the cost and the claim', async () => {
    const r = await A.admin.req('GET', '/runs/trajectories/RUN-r-known');
    expect(r.status).toBe(200);
    expect(r.body.chain).toEqual({ status: 'verified', checked: 3, firstBadSeq: null, reason: null, anchor: 'ok' });
    expect(r.body.run).toMatchObject({ id: 'RUN-r-known', taskClass: 'web-research', headHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(r.body.steps.map((s: any) => s.seq)).toEqual([1, 2, 3]);
    expect(r.body.steps[0]).toMatchObject({ tool: 'browse', executed: true, ok: true, toolCostMicros: 100, tokens: 10, decision: { profile: { allowed: true, reason: 'allowed' }, caps: { action: 'continue', reason: null } } });
    expect(r.body.envCheck).toMatchObject({ runId: 'RUN-r-known' });
  });
  it('shows a stopped run with its stop reason, and an unknown cost as unknown', async () => {
    const r = await A.admin.req('GET', '/runs/trajectories/RUN-r-stopped');
    expect(r.body.steps[2]).toMatchObject({ executed: false, ok: null, toolCostMicros: null, decision: { caps: { action: 'stop', reason: 'step_budget' } } });
    expect((await A.admin.req('GET', '/runs/trajectories/RUN-r-unknown')).body.run.cost.status).toBe('unknown');
  });
  it('404 for an unknown id and for another tenant\'s run', async () => {
    expect((await A.admin.req('GET', '/runs/trajectories/RUN-nope')).status).toBe(404);
    expect((await A.admin.req('GET', '/runs/trajectories/RUN-r-other-tenant')).status).toBe(404);
  });
  it('reports a broken chain when a row was altered behind the server\'s back', async () => {
    await put('t02', 'RUN-r-tampered');
    const c = await t.pool.connect();
    try {
      await c.query('alter table trajectory_steps disable trigger user');
      try { await c.query(`update trajectory_steps set tool_cost_micros = 1 where run_id='RUN-r-tampered' and seq=1`); } finally { await c.query('alter table trajectory_steps enable trigger user'); }
    } finally { c.release(); }
    const r = await A.admin.req('GET', '/runs/trajectories/RUN-r-tampered');
    expect(r.status).toBe(200);
    expect(r.body.chain).toMatchObject({ status: 'broken', reason: 'step_hash_mismatch', firstBadSeq: 1, anchor: 'ok' });
  });
  it('arguments are served redacted: a seeded secret never leaves the server', async () => {
    const f = { ...fx('t18'), steps: [{ ...fx('t18').steps[0], args: { text: 'use password=Tr0ub4dor&3 and mail ann@mail.test', api_key: 'AbCdEf0123456789xyz' } }] };
    await tx(t.app.db, (c) => saveTrajectory(c, 't-1', runFixture(f, { runId: 'RUN-r-secret', tenantId: 't-1' }).built, 'executor-fake'));
    const r = await A.admin.req('GET', '/runs/trajectories/RUN-r-secret');
    const text = JSON.stringify(r.body);
    for (const sec of ['Tr0ub4dor&3', 'ann@mail.test', 'AbCdEf0123456789xyz']) expect(text).not.toContain(sec);
    expect(r.body.steps[0].redactions).toBeGreaterThanOrEqual(3);
  });
});

describe('read only', () => {
  it('there is no write route for trajectories: POST, PUT, PATCH and DELETE are not found', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await A.admin.req(m, '/runs/trajectories', {}, { 'idempotency-key': 'x' + m })).status, m).toBe(404);
      expect((await A.admin.req(m, '/runs/trajectories/RUN-r-known', {}, { 'idempotency-key': 'y' + m })).status, m).toBe(404);
    }
  });
});
