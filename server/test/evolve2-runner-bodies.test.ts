import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { runCli } from '../src/cli/evolve-missions.ts';
import { approve, once } from '../../evolve/runner/loop.ts';
import type { DeployAnswer, HistoryEntry, MissionCli, RunnerEffects, WriteResult } from '../../evolve/runner/loop.ts';

// Evolution step 2 fix wave, M12: the runner's real loop (evolve/runner/loop.ts) writes every progress and finish body it
// builds through the REAL mission CLI (runCli, its zod schemas, the state machine) against this file's schema. Everything
// else the loop needs (git, the Workshop, the typecheck, the Guard) is a small fake. If the runner's bodies and the CLI's
// schemas drift apart, a write here is refused (exit 2) and the runner's `write` throws: these tests fail.
let t: TestApp;
let n = 0;
const key = () => ({ 'idempotency-key': 'evo2fw-' + Date.now() + '-' + n++ });
let A: Awaited<ReturnType<typeof withAdmin>>;

beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 100_000 });
  A = await withAdmin(t.app);
});
afterEach(async () => { await t?.close(); t = undefined as never; });

const BASE = 'b'.repeat(40);
const shaOf = (k: number) => String(k).repeat(40);
const SECRET = 'fw2-secret-' + 'q'.repeat(24);
const diffOf = (file: string, added: string[]) =>
  [`diff --git a/${file} b/${file}`, 'index 1111111..2222222 100644', `--- a/${file}`, `+++ b/${file}`,
    `@@ -1,1 +1,${added.length + 1} @@`, ' ctx', ...added.map((l) => `+${l}`), ''].join('\n');

/** the mission CLI in-process: exit 0 → ok, exit 1 → a refusal, anything else (exit 2 = a body the schema refused) throws */
function realMissions(bodies: { cmd: string; body: unknown; code: number; out: unknown }[]): MissionCli {
  const call = async (argv: string[], body?: unknown) => {
    const r = await runCli(argv, { pool: t.pool, stdin: async () => (body === undefined ? '' : JSON.stringify(body)) });
    bodies.push({ cmd: argv[0], body, code: r.code, out: r.out });
    return r;
  };
  const write = async (argv: string[], body?: unknown): Promise<WriteResult> => {
    const r = await call(argv, body);
    if (r.code === 0) return { ok: true };
    if (r.code === 1 && typeof r.out.error === 'string' && r.out.error !== 'failed') return { ok: false, refusal: r.out as { error: string } };
    throw new Error(`evolve-missions ${argv[0]}: exit ${r.code} ${JSON.stringify(r.out)}`);
  };
  return {
    async halted() { const r = await call(['halted']); return { halted: r.out.halted === true, ...(typeof r.out.reason === 'string' ? { reason: r.out.reason } : {}) }; },
    async recover() { const r = await call(['recover']); return (r.out.recovered as string[]) ?? []; },
    async next() {
      const r = await call(['next']);
      if (r.out.halted === true) return { mission: null, halted: String(r.out.reason) };
      const m = r.out.mission as { id: string; title: string; text: string; criteria: string[]; owner: string } | null;
      return { mission: m };
    },
    async file(owner, text) { const r = await call(['file', '--owner', owner, '--text', text]); return { id: String(r.out.id) }; },
    progress: (id, body) => write(['progress', id], body),
    finish: (id, body) => write(['finish', id], body),
    approved: (id) => write(['approved', id]),
  };
}

type Plan = {
  reviewer?: (attempt: number) => { ok: boolean; concerns: string[] };
  diff?: (attempt: number) => { text: string; files: { path: string; status: 'A' | 'M' | 'D' | 'R' }[]; stat: string };
  deploys?: DeployAnswer[];
  /** runs after each mission write (e.g. to pause the mission through the API) */
  afterWrite?: (cmd: string, body: any) => Promise<void>;
};

function fakeRunner(plan: Plan = {}) {
  const history: HistoryEntry[] = [];
  const bodies: { cmd: string; body: unknown; code: number; out: unknown }[] = [];
  const refs: Record<string, string> = {};
  const recorded: Record<string, DeployAnswer['result']> = {};
  const deploys = [...(plan.deploys ?? [])];
  const missions = realMissions(bodies);
  const wrapped: MissionCli = {
    ...missions,
    async progress(id, body) { const r = await missions.progress(id, body); await plan.afterWrite?.('progress', body); return r; },
    async finish(id, body) { const r = await missions.finish(id, body); await plan.afterWrite?.('finish', body); return r; },
  };
  let attemptNow = 0;
  let now = Date.parse('2026-11-27T10:00:00Z');
  let paused: string | null = null;
  const fx: RunnerEffects = {
    missions: wrapped,
    async secrets() { return [SECRET]; },
    async paused() { return paused; },
    async writePaused(r) { paused = r; },
    async clearPaused() { const was = paused !== null; paused = null; return was; },
    async readHistory() { return history.map((e) => ({ ...e })); },
    async appendHistory(e) { history.push({ at: new Date(now).toISOString(), ...e }); },
    async lock() { return async () => {}; },
    async sweep() { return []; },
    async killWorkers() { return []; },
    holdsLock: () => true,
    async liveSha() { return BASE; },
    async exportTree(id, attempt) { attemptNow = attempt; return `/changes/${id}/a${attempt}`; },
    async engineer(o) { return { ok: true, report: `{"goal":"denser rows","changed":"web/src/a.ts","attempt":${o.attempt}}`, timedOut: false }; },
    async commit() { return shaOf(attemptNow); },
    async injectFailure() { throw new Error('not in this test'); },
    async diff() { return plan.diff?.(attemptNow) ?? { text: diffOf('web/src/a.ts', [`export const rows = ${attemptNow};`]), files: [{ path: 'web/src/a.ts', status: 'M' }], stat: ' web/src/a.ts | 1 +' }; },
    async importObjects() {},
    async typecheck() { return { ok: true, log: '' }; },
    async reviewer() { return plan.reviewer?.(attemptNow) ?? { ok: true, concerns: [] }; },
    async resolveRef(ref) { return refs[ref] ?? null; },
    async setRef(ref, sha) { refs[ref] = sha; },
    async deleteRef(ref) { delete refs[ref]; },
    async removeChange() {},
    async deploy(o, onStep) {
      const a = deploys.shift() ?? { code: 0, result: { outcome: 'live' }, stderr: '' };
      onStep({ step: 'build', event: 'start' });
      onStep({ step: 'build', event: 'end', ok: true, detail: 'axion-app:x' });
      recorded[o.sha] = a.result;
      return a;
    },
    async guardOutcome(sha) { return recorded[sha] ?? null; },
    async guardBusy() { return false; },
    async guardDeploying() { return null; },
    async wentLive() { return null; },
    now: () => now,
    async sleep(ms) { now += ms; },
    log() {},
    stopping: () => false,
  };
  return { fx, bodies, history, refs };
}

const pres = async (id: string) => (await t.pool.query('select status, presentation from missions where id=$1', [id])).rows[0] as { status: string; presentation: Record<string, any> };
const fileOne = async (text: string) => {
  const r = await runCli(['file', '--owner', 'Luca', '--text', text], { pool: t.pool });
  expect(r.code, JSON.stringify(r.out)).toBe(0);
  return String(r.out.id);
};

describe('the runner loop through the real mission CLI (M12: bodies and schemas cannot drift)', () => {
  it('a reviewer retry then live: every progress/finish body is accepted; attempt 2 starts with attempt 1\'s change fields cleared (M4)', async () => {
    const id = await fileOne('Make the missions list denser.');
    const seenAtAttempt2: Record<string, unknown>[] = [];
    const f = fakeRunner({
      reviewer: (a) => (a === 1 ? { ok: false, concerns: ['no test for the new density'] } : { ok: true, concerns: [] }),
      afterWrite: async (cmd, body) => { if (cmd === 'progress' && body.clear && body.evolve.attempt === 2) seenAtAttempt2.push((await pres(id)).presentation.evolve); },
    });
    const r = await once(f.fx, { inject: false });
    expect(r.kind === 'change' && r.outcome.outcome, JSON.stringify(f.bodies.filter((b) => b.code !== 0))).toBe('live');
    expect(f.bodies.filter((b) => b.code !== 0)).toEqual([]);
    expect(f.bodies.filter((b) => b.cmd === 'progress').length).toBeGreaterThan(8);
    const m = await pres(id);
    expect(m.status).toBe('completed');
    expect(m.presentation.evolve).toMatchObject({ state: 'live', attempt: 2, commit: shaOf(2), base: BASE, guard: { outcome: 'live' } });
    expect(m.presentation.evolve.report).toContain('"attempt":2');
    // M4: right after attempt 2's first write nothing of attempt 1's commit, files, report or checks is left
    expect(seenAtAttempt2).toHaveLength(1);
    for (const k of ['commit', 'filesChanged', 'diffStat', 'report', 'checks', 'guard', 'hits']) expect(seenAtAttempt2[0][k], k).toBeUndefined();
    expect(seenAtAttempt2[0]).toMatchObject({ state: 'working', attempt: 2, base: BASE });
    const log = (m.presentation.staffing.log as { by: string; text: string }[]).map((x) => x.by);
    expect(log).toEqual(expect.arrayContaining(['gm', 'web-dev-01', 'tester-01', 'release-01']));
    expect(JSON.stringify(m.presentation)).not.toContain(SECRET);
  });

  it('a protected change (R34: typechecked and reviewed first) waits for the owner; approve deploys it and completes the mission', async () => {
    const id = await fileOne('Tighten the Guard check.');
    const f = fakeRunner({
      diff: () => ({ text: diffOf('evolve/guard/x.ts', ['export const x = 1;']), files: [{ path: 'evolve/guard/x.ts', status: 'A' }], stat: ' evolve/guard/x.ts | 1 +' }),
      reviewer: () => ({ ok: true, concerns: ['touches the Guard: the owner decides'] }),
    });
    const r = await once(f.fx, { inject: false });
    expect(r.kind === 'change' && r.outcome.outcome).toBe('needs_owner');
    expect(f.bodies.filter((b) => b.code !== 0)).toEqual([]);
    let m = await pres(id);
    expect(m.status).toBe('waiting_approval');
    expect(m.presentation.evolve).toMatchObject({ state: 'needs_owner', commit: shaOf(1), hits: ['protected: evolve/guard/x.ts'] });
    expect(m.presentation.summary).toContain('reviewer (tester-01) accepted the change. Notes: touches the Guard');
    expect(m.presentation.summary).toContain(`axion-evolve approve ${id}`);
    const a = await approve(f.fx, id);
    expect(a.code, a.message).toBe(0);
    expect(f.bodies.filter((b) => b.code !== 0)).toEqual([]);
    m = await pres(id);
    expect(m.status).toBe('completed');
    expect(m.presentation.evolve).toMatchObject({ state: 'live', commit: shaOf(1) });
  });

  it('three Guard rejections at checks end the mission failed (state rejected) with the reason; a rolled-back deploy ends rolled_back', async () => {
    const id = await fileOne('Add a filter.');
    const rej = (): DeployAnswer => ({ code: 1, result: { outcome: 'rejected', failedStep: 'checks', reason: 'checks failed: 2 failed\nFAIL x.test.ts' }, stderr: '' });
    const f = fakeRunner({ deploys: [rej(), rej(), rej()] });
    await once(f.fx, { inject: false });
    expect(f.bodies.filter((b) => b.code !== 0)).toEqual([]);
    const m = await pres(id);
    expect(m.status).toBe('failed');
    expect(m.presentation.evolve).toMatchObject({ state: 'rejected', attempt: 3, guard: { outcome: 'rejected', failedStep: 'checks' } });
    const id2 = await fileOne('Add a sort.');
    const g = fakeRunner({ deploys: [{ code: 1, result: { outcome: 'rolled_back', failedStep: 'watch', reason: 'watch failed' }, stderr: '' }] });
    await once(g.fx, { inject: false });
    expect(g.bodies.filter((b) => b.code !== 0)).toEqual([]);
    expect((await pres(id2)).presentation.evolve).toMatchObject({ state: 'rolled_back', guard: { outcome: 'rolled_back', failedStep: 'watch' } });
  });

  it('I3: the owner pauses the mission mid-change → the next write is refused, the change stops and recover marks it failed (not left working)', async () => {
    const id = await fileOne('Rename a label.');
    let paused = false;
    const f = fakeRunner({
      afterWrite: async (cmd, body) => {
        if (!paused && cmd === 'progress' && body.by === 'tester-01') {
          paused = true;
          expect((await A.admin.req('POST', `/missions/${id}/actions/pause`, {}, key())).status).toBe(200);
        }
      },
    });
    const r = await once(f.fx, { inject: false });
    expect(r.kind === 'change' && r.outcome.outcome).toBe('gone');
    const m = await pres(id);
    expect(m.status).toBe('paused');
    expect(m.presentation.evolve.state).toBe('failed');
    expect(f.bodies.some((b) => b.cmd === 'progress' && b.code === 1)).toBe(true);
    expect(f.bodies.filter((b) => b.cmd === 'recover').length).toBe(2);
  });

  it('a body the CLI would refuse (an unknown evolve key) is exit 2, so drift is loud', async () => {
    const id = await fileOne('Anything.');
    await runCli(['next'], { pool: t.pool });
    const bad = await runCli(['progress', id], { pool: t.pool, stdin: async () => JSON.stringify({ by: 'gm', text: 'x', evolve: { state: 'working', nope: 1 } }) });
    expect(bad.code).toBe(2);
    const badClear = await runCli(['progress', id], { pool: t.pool, stdin: async () => JSON.stringify({ by: 'gm', text: 'x', evolve: { state: 'working' }, clear: ['state'] }) });
    expect(badClear.code).toBe(2);
  });
});
