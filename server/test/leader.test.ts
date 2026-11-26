import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLeader, type Leader } from '../src/leader.ts';
import { makePool } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { makeSchema, makeTestApp, withAdmin, TEST_DB } from './helpers.ts';
import type { CloudAdapter } from '../src/cloud/claude-cli.ts';
import type { FastifyInstance } from 'fastify';

/** Evolve step 1: during a blue/green switch two instances share one database; singleton background work runs only where the lock is held. */
const until = async (cond: () => boolean | Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('condition not reached in ' + ms + ' ms');
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const open: { close: () => Promise<void> }[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close().catch(() => {}); });
const lead = (o: Parameters<typeof startLeader>[0]): Leader => { const l = startLeader(o); open.push(l); return l; };

describe('leader lock', () => {
  it('mode always is leader at once and runs onAcquire once', async () => {
    const l = lead({ databaseUrl: TEST_DB(), mode: 'always', onLost: () => {} });
    expect(l.isLeader()).toBe(true);
    let n = 0;
    l.onAcquire(() => { n++; });
    await sleep(100);
    expect(n).toBe(1);
  });

  it('mode lock: of two leaders on the same database only one holds the lock', async () => {
    const s = await makeSchema({ migrate: false });
    try {
      const a = lead({ databaseUrl: TEST_DB(), schema: s.schema, mode: 'lock', pollMs: 50, onLost: () => {} });
      const b = lead({ databaseUrl: TEST_DB(), schema: s.schema, mode: 'lock', pollMs: 50, onLost: () => {} });
      await until(() => a.isLeader() || b.isLeader());
      await sleep(250); // several polls: the other one must stay a standby
      expect([a.isLeader(), b.isLeader()].filter(Boolean)).toHaveLength(1);
    } finally { while (open.length) await open.pop()!.close(); await s.drop(); }
  });

  it('the lock is per schema: the same name in another schema is a different lock', async () => {
    const s1 = await makeSchema({ migrate: false }), s2 = await makeSchema({ migrate: false });
    try {
      const a = lead({ databaseUrl: TEST_DB(), schema: s1.schema, mode: 'lock', pollMs: 50, onLost: () => {} });
      const b = lead({ databaseUrl: TEST_DB(), schema: s2.schema, mode: 'lock', pollMs: 50, onLost: () => {} });
      await until(() => a.isLeader() && b.isLeader());
    } finally { while (open.length) await open.pop()!.close(); await s1.drop(); await s2.drop(); }
  });

  it('the standby takes over within two polls after the holder closes, and runs onAcquire once', async () => {
    const s = await makeSchema({ migrate: false });
    try {
      const pollMs = 100;
      const a = lead({ databaseUrl: TEST_DB(), schema: s.schema, mode: 'lock', pollMs, onLost: () => {} });
      await until(() => a.isLeader());
      let n = 0;
      const b = lead({ databaseUrl: TEST_DB(), schema: s.schema, mode: 'lock', pollMs, onLost: () => {} });
      b.onAcquire(() => { n++; });
      await sleep(3 * pollMs);
      expect(b.isLeader()).toBe(false);
      expect(n).toBe(0);
      const closedAt = Date.now();
      await a.close();
      await until(() => b.isLeader(), 2 * pollMs + 500); // two polls plus connection time
      expect(Date.now() - closedAt).toBeLessThan(2 * pollMs + 500);
      await sleep(3 * pollMs);
      expect(n).toBe(1);
    } finally { while (open.length) await open.pop()!.close(); await s.drop(); }
  });

  it('a lost lock connection calls onLost once and stops polling', async () => {
    const s = await makeSchema({ migrate: false });
    try {
      let lost = 0;
      const a = lead({ databaseUrl: TEST_DB(), schema: s.schema, mode: 'lock', pollMs: 50, onLost: () => { lost++; } });
      await until(() => a.isLeader());
      const admin = makePool(TEST_DB(), undefined, 1);
      // kill only the session that holds THIS schema's leader key (an advisory key is split into classid = high 32 bits, objid = low 32 bits); other tests' locks stay
      await admin.query(`select pg_terminate_backend(pid) from pg_locks where locktype='advisory' and granted and pid <> pg_backend_pid()
        and ((classid::int8 << 32) | objid::int8) = hashtextextended($1::text || ':axion-leader', 0)`, [s.schema]);
      await admin.end();
      await until(() => lost > 0);
      await sleep(250);
      expect(lost).toBe(1);
      expect(a.isLeader()).toBe(false);
    } finally { while (open.length) await open.pop()!.close(); await s.drop(); }
  });
});

describe('leader in the app', () => {
  const apps: FastifyInstance[] = [];
  let t: Awaited<ReturnType<typeof makeTestApp>> | undefined;
  const dirs: string[] = [];
  afterEach(async () => {
    while (apps.length) await apps.pop()!.close();
    await t?.close(); t = undefined;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const mk = async (schema: string, over: Record<string, unknown>) => {
    const uploadDir = mkdtempSync(join(tmpdir(), 'axion-up-')); dirs.push(uploadDir);
    const app = await buildApp({ databaseUrl: TEST_DB(), schema, logger: false, uploadDir, ...over });
    apps.push(app);
    return app;
  };

  it('the approval sweep and the responder sweep do not run in a standby app', async () => {
    t = await makeTestApp({}); // no model configured: the message stays waiting
    const A = await withAdmin(t.app);
    const r = await A.admin.req('POST', '/channels/gm/messages', { kind: 'command', text: 'Anyone there?' }, { 'idempotency-key': 'lead-1' });
    expect(r.status).toBe(201);
    const calls = { leader: 0, standby: 0 };
    const fake = (k: 'leader' | 'standby'): CloudAdapter => ({ id: 'claude-2', label: 'Claude 2', tokenVar: 'CLAUDE_CODE_OAUTH_TOKEN2', model: 'claude-opus-5-5',
      refresh: async () => ({ checkedAt: new Date().toISOString(), status: 'available', account: null, resetsAt: null, windows: [] }),
      complete: async () => { calls[k]++; return { text: 'Here.', durationMs: 5, usage: { input: 1, output: 1 } }; } });
    const lost = () => {};
    const first = await mk(t.schema, { leaderMode: 'lock', leaderPollMs: 50, onLeaderLost: lost, cloudModels: [fake('leader')] });
    await until(() => first.leader.isLeader());
    const second = await mk(t.schema, { leaderMode: 'lock', leaderPollMs: 50, onLeaderLost: lost, cloudModels: [fake('standby')] });
    expect(first.leader.isLeader()).toBe(true);
    expect(second.leader.isLeader()).toBe(false);
    await until(() => calls.leader > 0);
    await first.chatResponder.idle();
    await second.chatResponder.idle();
    await sleep(300);
    expect(calls).toEqual({ leader: 1, standby: 0 });
    const msgs = (await t.pool.query(`select count(*)::int n from messages where body='Here.'`)).rows[0].n;
    expect(msgs).toBe(1);
    expect((await second.inject({ method: 'GET', url: '/api/v1/health' })).json().leader).toBe(false);
    expect((await first.inject({ method: 'GET', url: '/api/v1/health' })).json().leader).toBe(true);
  });

  it('the staffing resume scan runs only after the lock is acquired', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000 }); // the mission stays unfinished
    const A = await withAdmin(t.app);
    const m = (await A.admin.req('POST', '/missions', { text: 'Research the market.', files: [], shared: false }, { 'idempotency-key': 'lead-2' })).body.mission;
    const stage = async () => (await t!.pool.query(`select presentation->'staffing'->>'stage' s from missions where id=$1`, [m.id])).rows[0].s as string;
    expect(await stage()).not.toBe('working');
    const holder = lead({ databaseUrl: TEST_DB(), schema: t.schema, mode: 'lock', pollMs: 50, onLost: () => {} });
    await until(() => holder.isLeader());
    const standby = await mk(t.schema, { leaderMode: 'lock', leaderPollMs: 50, staffingStepMs: 40 });
    await sleep(800); // far more than the steps needed: a standby must not have resumed anything
    expect(standby.leader.isLeader()).toBe(false);
    expect(await stage()).not.toBe('working');
    await holder.close();
    await until(async () => (await stage()) === 'working', 8000);
    expect(standby.leader.isLeader()).toBe(true);
  });

  it('health reports commit and leader', async () => {
    t = await makeTestApp({ commit: 'abc1234' });
    const r = await t.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(r.json()).toMatchObject({ ok: true, db: 'up', commit: 'abc1234', leader: true });
    const noCommit = await mk(t.schema, {});
    expect((await noCommit.inject({ method: 'GET', url: '/api/v1/health' })).json().commit).toBeNull();
  });
});
