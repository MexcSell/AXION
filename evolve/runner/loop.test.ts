// The runner loop (loop.ts) against fake effects: every effect is recorded in `calls`, every mission write in `writes`.
// The real gates() run on the fake diffs (protected paths, secrets, flags), so those paths are tested end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { approve, claimsToday, once, rollbackStreak, runForever, startup, StillDeploying } from './loop.ts';
import type { DeployAnswer, GuardStep, HistoryEntry, RunnerEffects, WriteResult } from './loop.ts';
import type { Mission } from './prompts.ts';
import type { EngineerResult } from './workshop.ts';
import type { ClassifyInput } from '../guard/classify.ts';
import { secretForms } from './gates.ts';
import { AGENTS, CAPS, TIMING } from './config.ts';

const SECRET = ['sk', 'ant', 'oat01', randomBytes(24).toString('base64url')].join('-');
const BASE = 'b'.repeat(40);
const shaOf = (n: number) => String(n).repeat(40);
const T0 = Date.parse('2026-11-27T10:00:00Z');

const diffOf = (file: string, added: string[]) =>
  [`diff --git a/${file} b/${file}`, 'index 1111111..2222222 100644', `--- a/${file}`, `+++ b/${file}`,
    `@@ -1,1 +1,${added.length + 1} @@`, ' ctx', ...added.map((l) => `+${l}`), ''].join('\n');
const CLEAN = { text: diffOf('web/src/a.ts', ['export const a = 1;']), files: [{ path: 'web/src/a.ts', status: 'M' }] as ClassifyInput[], stat: ' web/src/a.ts | 1 +' };

const mission = (id = 'M-1'): Mission => ({ id, title: 'Make the button blue', text: 'Please make it blue.', criteria: ['blue'], owner: 'Luca' });
const live = (): DeployAnswer => ({ code: 0, result: { outcome: 'live', image: 'axion-app:x' }, stderr: '' });
const rejected = (step: string, reason: string): DeployAnswer => ({ code: 1, result: { outcome: 'rejected', failedStep: step, reason }, stderr: '' });
const rolledBack = (): DeployAnswer => ({ code: 1, result: { outcome: 'rolled_back', failedStep: 'watch', reason: 'watch failed: 3 consecutive bad polls' }, stderr: '' });
const busy = (): DeployAnswer => ({ code: 4, result: null, stderr: 'a deploy is already running' });

type Write = { kind: 'progress' | 'finish' | 'approved'; id: string; body: Record<string, any> };

type Script = {
  missions: Mission[];
  history: HistoryEntry[];
  halted: () => { halted: boolean; reason?: string };
  paused: () => string | null;
  lockFree: boolean;
  engineer: (o: { attempt: number; feedback?: string }) => EngineerResult;
  commit: (attempt: number) => string | null;
  diff: (attempt: number, sha: string) => { text: string; files: ClassifyInput[]; stat: string };
  typecheck: (attempt: number) => { ok: boolean; log: string };
  reviewer: (attempt: number) => { ok: boolean; concerns: string[] };
  /** `history`: what the Guard's history.jsonl records for that deploy (default: the same as `result`) */
  deploys: (DeployAnswer & { history?: DeployAnswer['result'] })[];
  steps: GuardStep[];
  progress: (body: Record<string, any>, n: number) => WriteResult;
  approved: () => WriteResult;
  refs: Record<string, string>;
  liveSha: string;
  guardOutcome: (sha: string) => DeployAnswer['result'];
  guardBusy: () => boolean;
  stopping: () => boolean;
  finish: (body: Record<string, any>) => WriteResult;
  secrets: () => string[];
};

function fake(s: Partial<Script> = {}) {
  const calls: string[] = [];
  const writes: Write[] = [];
  const history: HistoryEntry[] = [...(s.history ?? [])];
  const queue = [...(s.missions ?? [mission()])];
  const deploys = [...(s.deploys ?? [live()])];
  const refs: Record<string, string> = { ...(s.refs ?? {}) };
  const recorded: Record<string, DeployAnswer['result']> = {};
  let now = T0;
  let paused: string | null = null;
  let progressN = 0;
  const engineerInputs: { attempt: number; feedback?: string }[] = [];
  const reviewerDiffs: string[] = [];
  const deployInputs: { ref: string; sha: string; approve?: { sha: string; base: string } }[] = [];
  let attemptNow = 0;
  const fx: RunnerEffects = {
    missions: {
      async halted() { calls.push('halted'); return s.halted?.() ?? { halted: false }; },
      async recover() { calls.push('recover'); return []; },
      async next() { calls.push('next'); return queue.shift() ?? null; },
      async progress(id, body) {
        calls.push(`progress:${body.evolve.state ?? '-'}`);
        writes.push({ kind: 'progress', id, body });
        return s.progress?.(body, ++progressN) ?? { ok: true };
      },
      async finish(id, body) { calls.push(`finish:${body.outcome}`); writes.push({ kind: 'finish', id, body }); return s.finish?.(body) ?? { ok: true }; },
      async approved(id) { calls.push('approved'); writes.push({ kind: 'approved', id, body: {} }); return s.approved?.() ?? { ok: true }; },
    },
    async secrets() { return s.secrets?.() ?? [SECRET, 'pw-' + 'x'.repeat(20)]; },
    async paused() { return s.paused?.() ?? paused; },
    async writePaused(reason) { calls.push('writePaused'); paused = reason; },
    async clearPaused() { const was = paused !== null; paused = null; return was; },
    async readHistory() { return history.map((e) => ({ ...e })); },
    async appendHistory(e) { history.push({ at: new Date(now).toISOString(), ...e }); },
    async lock() {
      calls.push('lock');
      if (s.lockFree === false) return null;
      return async () => { calls.push('unlock'); };
    },
    async sweep() { calls.push('sweep'); return []; },
    async killWorkers() { calls.push('killWorkers'); return []; },
    async liveSha() { return s.liveSha ?? BASE; },
    async exportTree(id, attempt, base) { calls.push(`export:a${attempt}`); attemptNow = attempt; assert.equal(base, s.liveSha ?? BASE); return `/changes/${id}/a${attempt}`; },
    async engineer(o) {
      calls.push(`engineer:a${o.attempt}`);
      engineerInputs.push({ attempt: o.attempt, feedback: o.feedback });
      return s.engineer?.(o) ?? { ok: true, report: `{"goal":"blue","changed":"a.ts"}`, timedOut: false };
    },
    async commit(o) {
      calls.push('commit');
      assert.equal(o.parent, s.liveSha ?? BASE);
      return s.commit ? s.commit(attemptNow) : shaOf(attemptNow);
    },
    async injectFailure(o) { calls.push('inject'); assert.equal(o.parent, shaOf(attemptNow)); return 'f'.repeat(40); },
    async diff(_dir, base, sha) {
      calls.push(`diff:${sha.slice(0, 1)}`);
      assert.equal(base, s.liveSha ?? BASE);
      return s.diff?.(attemptNow, sha) ?? CLEAN;
    },
    async importObjects() { calls.push('import'); },
    async typecheck() { calls.push('typecheck'); return s.typecheck?.(attemptNow) ?? { ok: true, log: '' }; },
    async reviewer(o) { calls.push('reviewer'); reviewerDiffs.push(o.diff); return s.reviewer?.(attemptNow) ?? { ok: true, concerns: [] }; },
    async resolveRef(ref) { return refs[ref] ?? null; },
    async setRef(ref, sha) { calls.push(`setRef:${ref}`); refs[ref] = sha; },
    async deleteRef(ref) { calls.push(`deleteRef:${ref}`); delete refs[ref]; },
    async removeChange(id) { calls.push(`remove:${id}`); },
    async deploy(o, onStep) {
      calls.push('deploy');
      deployInputs.push(o);
      const { history, ...a }: DeployAnswer & { history?: DeployAnswer['result'] } = deploys.shift() ?? live();
      if (a.code !== 4) {
        for (const st of s.steps ?? []) onStep(st);
        recorded[o.sha] = history !== undefined ? history : a.result;
      }
      return a;
    },
    async guardOutcome(sha) { return s.guardOutcome?.(sha) ?? recorded[sha] ?? null; },
    holdsLock: () => true,
    async guardBusy() { return s.guardBusy?.() ?? false; },
    now: () => now,
    async sleep(ms) { calls.push(`sleep:${ms}`); now += ms; },
    log() {},
    stopping: () => s.stopping?.() ?? false,
  };
  const finish = () => writes.filter((w) => w.kind === 'finish');
  return { fx, calls, writes, history, refs, engineerInputs, reviewerDiffs, deployInputs, finish, isPaused: () => paused };
}

/** `want` appears in `calls` in this order (other calls may sit between) */
function inOrder(calls: string[], want: string[]) {
  let i = 0;
  for (const c of calls) if (c === want[i]) i++;
  assert.equal(i, want.length, `expected in order: ${want.join(' → ')}\ngot: ${calls.join(' → ')}`);
}
const noSecret = (v: unknown) => {
  const s = JSON.stringify(v);
  for (const f of secretForms(SECRET)) assert.ok(!s.includes(f), 'a form of the secret reached the mission');
};

test('happy path: claim → engineer → commit → gates → typecheck → reviewer → push → Guard → completed with the commit', async () => {
  const f = fake({ steps: [{ step: 'build', event: 'start' }, { step: 'build', event: 'end', ok: true, detail: 'axion-app:x' }] });
  const r = await once(f.fx, { inject: false });
  assert.equal(r.kind, 'change');
  inOrder(f.calls, ['lock', 'sweep', 'recover', 'halted', 'next', 'export:a1', 'engineer:a1', 'commit', 'diff:1', 'import',
    'typecheck', 'reviewer', 'setRef:incoming/evolve-M-1-a1', 'deploy', 'finish:completed', 'deleteRef:incoming/evolve-M-1-a1', 'remove:M-1', 'unlock']);
  const [fin] = f.finish();
  assert.equal(fin.body.evolve.commit, shaOf(1));
  assert.equal(fin.body.evolve.base, BASE);
  assert.equal(fin.body.evolve.attempt, 1);
  assert.deepEqual(f.deployInputs[0], { ref: 'incoming/evolve-M-1-a1', sha: shaOf(1) });
  // Guard steps mirrored by release-01; the report only after the gates
  const byRelease = f.writes.filter((w) => w.kind === 'progress' && w.body.by === AGENTS.release);
  assert.ok(byRelease.some((w) => /build/.test(w.body.text)), 'Guard steps are mirrored');
  const ids = new Set(f.writes.filter((w) => w.kind === 'progress').map((w) => w.body.by));
  for (const id of [AGENTS.gm, AGENTS.reviewer, AGENTS.release]) assert.ok(ids.has(id), id);
  assert.ok(f.writes.some((w) => w.body.by === AGENTS.engineer), 'the engineer reports too');
  const firstReport = f.writes.findIndex((w) => w.body.evolve?.report !== undefined);
  assert.ok(firstReport > f.writes.findIndex((w) => w.body.evolve?.commit !== undefined) - 1);
  for (const w of f.writes.filter((x) => x.kind === 'progress')) assert.ok(['claimed', 'working', 'checking', 'deploying'].includes(w.body.evolve.state), w.body.evolve.state);
  assert.deepEqual(f.history.map((h) => h.event), ['claim', 'deploy', 'end']);
  assert.equal(f.history.at(-1)!.outcome, 'live');
  assert.equal(f.calls.filter((c) => c === 'inject').length, 0);
});

test('protected hit → needs_owner with the hit list and the approve command; held at incoming/…; nothing typechecked, reviewed or deployed', async () => {
  const f = fake({ diff: () => ({ text: diffOf('evolve/x.ts', ['x']), files: [{ path: 'evolve/x.ts', status: 'A' }], stat: '' }) });
  await once(f.fx, { inject: false });
  for (const c of ['typecheck', 'reviewer', 'deploy']) assert.ok(!f.calls.includes(c), c);
  assert.ok(f.calls.includes('setRef:incoming/evolve-M-1-a1'));
  assert.ok(!f.calls.some((c) => c.startsWith('deleteRef')), 'the held ref stays');
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'needs_owner');
  assert.ok(fin.body.evolve.hits.some((h: string) => h.includes('evolve/x.ts')));
  assert.match(fin.body.text, /axion-evolve approve M-1/);
  assert.equal(f.refs['incoming/evolve-M-1-a1'], shaOf(1));
  const held = f.history.find((h) => h.event === 'held')!;
  assert.deepEqual([held.mission, held.ref, held.commit, held.base], ['M-1', 'incoming/evolve-M-1-a1', shaOf(1), BASE]);
});

test('a flag (absolute URL) → needs_owner too', async () => {
  const f = fake({ diff: () => ({ text: diffOf('web/src/a.ts', ['fetch("https://evil.example/x")']), files: CLEAN.files, stat: '' }) });
  await once(f.fx, { inject: false });
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'needs_owner');
  assert.ok(fin.body.evolve.hits.some((h: string) => /flag/.test(h)));
  assert.ok(!f.calls.includes('deploy'));
});

test('secret hit → failed; no push, no import, no deploy; neither the value nor the report reaches the mission', async () => {
  const f = fake({
    engineer: () => ({ ok: true, report: `I put ${SECRET} in a.ts`, timedOut: false }),
    diff: () => ({ text: diffOf('web/src/a.ts', [`const t = "${SECRET}";`]), files: CLEAN.files, stat: ' web/src/a.ts | 1 +' }),
  });
  await once(f.fx, { inject: false });
  for (const c of ['import', 'typecheck', 'reviewer', 'deploy']) assert.ok(!f.calls.includes(c), c);
  assert.ok(!f.calls.some((c) => c.startsWith('setRef')));
  assert.ok(f.calls.includes('remove:M-1'), 'the tree (and its scratch objects) are deleted');
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'failed');
  assert.match(fin.body.text, /secret/i);
  assert.equal(fin.body.evolve.report, undefined);
  assert.equal(fin.body.evolve.commit, undefined);
  assert.equal(fin.body.evolve.filesChanged, undefined);
  noSecret(f.writes);
  noSecret(f.history);
});

test('reviewer not ok on attempt 1, ok on attempt 2: the concerns are the feedback; completed at attempt 2', async () => {
  const f = fake({ reviewer: (a) => (a === 1 ? { ok: false, concerns: ['no test for the new colour'] } : { ok: true, concerns: [] }) });
  await once(f.fx, { inject: false });
  assert.equal(f.engineerInputs.length, 2);
  assert.equal(f.engineerInputs[0].feedback, undefined);
  assert.match(f.engineerInputs[1].feedback!, /no test for the new colour/);
  assert.equal(f.calls.filter((c) => c === 'deploy').length, 1);
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'completed');
  assert.equal(fin.body.evolve.attempt, 2);
  assert.equal(fin.body.evolve.commit, shaOf(2));
});

test('typecheck fails → the next attempt gets the last 80 lines of the errors (redacted) as feedback; no review, no deploy for it', async () => {
  const log = Array.from({ length: 200 }, (_, i) => `src/x.ts(${i},1): error TS2322: line ${i}${i === 199 ? ` ${SECRET}` : ''}`).join('\n');
  const f = fake({ typecheck: (a) => (a === 1 ? { ok: false, log } : { ok: true, log: '' }) });
  await once(f.fx, { inject: false });
  const fb = f.engineerInputs[1].feedback!;
  assert.match(fb, /line 199/);
  assert.doesNotMatch(fb, /line 119\b/);
  assert.match(fb, /line 120\b/);
  assert.ok(!fb.includes(SECRET));
  assert.deepEqual(f.calls.filter((c) => c === 'reviewer' || c === 'deploy'), ['reviewer', 'deploy']);
  noSecret(f.writes);
});

test('the Guard rejects at checks → the reason is the next attempt\'s feedback; then live', async () => {
  const f = fake({ deploys: [rejected('checks', 'checks failed: FAIL test/colour.test.ts > is blue'), live()] });
  await once(f.fx, { inject: false });
  assert.match(f.engineerInputs[1].feedback!, /FAIL test\/colour\.test\.ts > is blue/);
  assert.match(f.engineerInputs[1].feedback!, /checks/);
  assert.ok(f.calls.includes('deleteRef:incoming/evolve-M-1-a1'), 'the rejected attempt\'s ref goes');
  const retry = f.writes.find((w) => w.kind === 'progress' && w.body.evolve.guard?.outcome === 'rejected');
  assert.ok(retry, 'the rejection is reported with guard info');
  assert.equal(retry!.body.evolve.state, 'working', 'a retried attempt is reported as working (progress refuses rejected)');
  assert.equal(f.finish()[0].body.outcome, 'completed');
  assert.deepEqual(f.history.map((h) => h.event), ['claim', 'deploy', 'retry', 'deploy', 'end']);
});

test('three rejects → failed (state rejected), three engineer runs and three deploys', async () => {
  const f = fake({ deploys: [1, 2, 3].map(() => rejected('build', 'web build failed: x.tsx')) });
  const r = await once(f.fx, { inject: false });
  assert.equal(f.calls.filter((c) => c.startsWith('engineer')).length, CAPS.attempts);
  assert.equal(f.calls.filter((c) => c === 'deploy').length, 3);
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'failed');
  assert.equal(fin.body.evolve.state, 'rejected');
  assert.equal(r.kind === 'change' && r.outcome.outcome, 'rejected');
});

test('a Guard rejection at another step (smoke) is not retried: failed', async () => {
  const f = fake({ deploys: [rejected('smoke', 'smoke checks failed')] });
  await once(f.fx, { inject: false });
  assert.equal(f.calls.filter((c) => c.startsWith('engineer')).length, 1);
  assert.equal(f.finish()[0].body.outcome, 'failed');
});

test('the Guard is busy twice, then live: waits 60 s between tries', async () => {
  const f = fake({ deploys: [busy(), busy(), live()] });
  await once(f.fx, { inject: false });
  assert.equal(f.calls.filter((c) => c === 'deploy').length, 3);
  assert.equal(f.calls.filter((c) => c === `sleep:${TIMING.busyWaitMs}`).length, 2);
  assert.equal(f.finish()[0].body.outcome, 'completed');
});

test('the Guard stays busy for 30 min → failed, honest reason', async () => {
  const f = fake({ deploys: Array.from({ length: 100 }, busy) });
  await once(f.fx, { inject: false });
  assert.ok(f.calls.filter((c) => c === 'deploy').length <= 31);
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'failed');
  assert.match(fin.body.text, /busy/);
});

test('two consecutive rolled-back changes → PAUSED written; the next tick claims nothing', async () => {
  const f = fake({ missions: [mission('M-1'), mission('M-2'), mission('M-3')], deploys: [rolledBack(), rolledBack()] });
  const a = await once(f.fx, { inject: false });
  assert.equal(a.kind === 'change' && a.outcome.outcome, 'rolled_back');
  assert.equal(f.isPaused(), null, 'one rollback does not pause');
  assert.equal(f.finish()[0].body.evolve.state, 'rolled_back');
  await once(f.fx, { inject: false });
  assert.ok(f.calls.includes('writePaused'));
  assert.match(f.isPaused()!, /rolled back/);
  const nextCalls = f.calls.filter((c) => c === 'next').length;
  const c = await once(f.fx, { inject: false });
  assert.equal(c.kind, 'paused');
  assert.equal(f.calls.filter((x) => x === 'next').length, nextCalls, 'nothing claimed while paused');
});

test('rollbackStreak: a live change or a resume breaks the streak; changes that never deployed are ignored', () => {
  const e = (event: HistoryEntry['event'], outcome?: string): HistoryEntry => ({ at: '2026-11-27T00:00:00Z', event, ...(outcome ? { outcome } : {}) });
  assert.equal(rollbackStreak([e('end', 'rolled_back'), e('end', 'failed'), e('end', 'rolled_back')]), 2);
  assert.equal(rollbackStreak([e('end', 'rolled_back'), e('end', 'live'), e('end', 'rolled_back')]), 1);
  assert.equal(rollbackStreak([e('end', 'rolled_back'), e('resume'), e('end', 'rolled_back')]), 1);
  assert.equal(rollbackStreak([]), 0);
});

test('a halt → nothing claimed', async () => {
  const f = fake({ halted: () => ({ halted: true, reason: 'global: owner' }) });
  const r = await once(f.fx, { inject: false });
  assert.equal(r.kind, 'halted');
  assert.ok(!f.calls.includes('next'));
  assert.equal(f.writes.length, 0);
});

test('PAUSED → nothing claimed', async () => {
  const f = fake({ paused: () => 'paused by the owner' });
  const r = await once(f.fx, { inject: false });
  assert.equal(r.kind, 'paused');
  assert.ok(!f.calls.includes('next'));
});

test('the runner lock is held (an approve runs) → once answers busy and touches nothing', async () => {
  const f = fake({ lockFree: false });
  const r = await once(f.fx, { inject: false });
  assert.equal(r.kind, 'busy');
  assert.deepEqual(f.calls, ['lock']);
});

test('run: recover is called once at start (under the lock), then the loop polls', async () => {
  const f = fake({ missions: [] });
  await runForever(f.fx, { maxTicks: 3 });
  assert.equal(f.calls.filter((c) => c === 'recover').length, 1);
  assert.equal(f.calls.filter((c) => c === 'next').length, 3);
  inOrder(f.calls, ['lock', 'sweep', 'recover', 'unlock', 'lock', 'next', 'unlock', `sleep:${TIMING.pollMs}`]);
});

test('run never injects a failure', async () => {
  const f = fake();
  f.fx.injectFailure = async () => { throw new Error('inject reached from run'); };
  await runForever(f.fx, { maxTicks: 2 });
  assert.equal(f.finish()[0].body.outcome, 'completed');
});

test('day cap: 12 claims today → nothing claimed; claims of yesterday do not count', async () => {
  const today = Array.from({ length: CAPS.changesPerDay }, (): HistoryEntry => ({ at: '2026-11-27T01:00:00Z', event: 'claim', mission: 'M-0' }));
  const f = fake({ history: today });
  const r = await once(f.fx, { inject: false });
  assert.equal(r.kind, 'cap');
  assert.ok(!f.calls.includes('next'));
  const yesterday = today.map((e) => ({ ...e, at: '2026-11-26T23:59:59Z' }));
  const g = fake({ history: [...yesterday, ...today.slice(1)] });
  assert.equal((await once(g.fx, { inject: false })).kind, 'change');
  assert.equal(claimsToday(today, T0), CAPS.changesPerDay);
  assert.equal(claimsToday(yesterday, T0), 0);
});

test('no change → failed "no change", nothing reaches the Guard', async () => {
  const f = fake({ commit: () => null });
  await once(f.fx, { inject: false });
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'failed');
  assert.match(fin.body.text, /no change/i);
  for (const c of ['diff:1', 'typecheck', 'deploy']) assert.ok(!f.calls.includes(c), c);
});

test('the engineer times out → failed with an honest reason; nothing committed or deployed', async () => {
  const f = fake({ engineer: () => ({ ok: false, report: '', timedOut: true, error: 'killed at the wall cap (1800 s)' }) });
  await once(f.fx, { inject: false });
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'failed');
  assert.match(fin.body.text, /wall cap|timed out/);
  for (const c of ['commit', 'deploy']) assert.ok(!f.calls.includes(c), c);
});

test('the engineer\'s container could not be confirmed gone → failed, the tree is never committed', async () => {
  const f = fake({ engineer: () => ({ ok: false, report: '', timedOut: true, error: 'still exists', containerAlive: true }) });
  await once(f.fx, { inject: false });
  assert.ok(!f.calls.includes('commit'));
  assert.equal(f.finish()[0].body.outcome, 'failed');
});

test('the mission leaves running mid-change (progress refused) → the change stops cleanly: no more writes, no deploy', async () => {
  const f = fake({ progress: (b) => (b.by === AGENTS.reviewer ? { ok: false, refusal: { error: 'mission_not_running', status: 'paused' } } : { ok: true }) });
  const r = await once(f.fx, { inject: false });
  assert.equal(r.kind === 'change' && r.outcome.outcome, 'gone');
  const refused = f.writes.findIndex((w) => w.body.by === AGENTS.reviewer);
  assert.equal(f.writes.length, refused + 1, 'no write after the refusal (never retried)');
  assert.ok(!f.calls.includes('deploy'));
  assert.equal(f.finish().length, 0);
  assert.equal(f.history.at(-1)!.event, 'end');
  assert.equal(f.history.at(-1)!.outcome, 'gone');
});

test('a kill switch trips mid-change → finish failed with the reason; nothing deployed', async () => {
  let n = 0;
  const f = fake({ paused: () => (++n > 2 ? 'paused by the owner' : null) });
  await once(f.fx, { inject: false });
  assert.ok(!f.calls.includes('deploy'));
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'failed');
  assert.match(fin.body.text, /paused by the owner/);
});

test('once --inject-failure: the injected commit is gated, typechecked and deployed; the reviewer sees the engineer\'s diff only', async () => {
  const f = fake({
    diff: (_a, sha) => (sha === 'f'.repeat(40)
      ? { text: CLEAN.text + diffOf('server/src/app.ts', ['  app.addHook(\'onRequest\', …)']), files: [...CLEAN.files, { path: 'server/src/app.ts', status: 'M' }], stat: '' }
      : CLEAN),
    deploys: [rolledBack()],
  });
  const r = await once(f.fx, { inject: true });
  inOrder(f.calls, ['commit', 'inject', 'diff:f', 'typecheck', 'diff:1', 'reviewer', 'deploy']);
  assert.equal(f.reviewerDiffs[0], CLEAN.text);
  assert.equal(f.deployInputs[0].sha, 'f'.repeat(40));
  assert.equal(r.kind === 'change' && r.outcome.outcome, 'rolled_back');
  assert.equal(f.history.find((h) => h.event === 'deploy')!.injected, true);
  assert.equal(f.finish()[0].body.evolve.state, 'rolled_back');
});

test('approve: approved → Guard deploy --approve <sha> --approve-base <live> → finish completed; the held ref goes', async () => {
  const held: HistoryEntry = { at: '2026-11-27T09:00:00Z', event: 'held', mission: 'M-1', attempt: 1, ref: 'incoming/evolve-M-1-a1', commit: shaOf(1), base: BASE };
  const f = fake({ history: [held], refs: { 'incoming/evolve-M-1-a1': shaOf(1) } });
  const r = await approve(f.fx, 'M-1');
  assert.equal(r.code, 0, r.message);
  inOrder(f.calls, ['lock', 'approved', 'deploy', 'finish:completed', 'deleteRef:incoming/evolve-M-1-a1', 'unlock']);
  assert.deepEqual(f.deployInputs[0], { ref: 'incoming/evolve-M-1-a1', sha: shaOf(1), approve: { sha: shaOf(1), base: BASE } });
  assert.ok(!f.calls.includes('recover'), 'approve never recovers');
});

test('approve refuses (nothing deployed) when the ref moved, evolve/main moved, the mission is not waiting, or nothing is held', async () => {
  const held: HistoryEntry = { at: '2026-11-27T09:00:00Z', event: 'held', mission: 'M-1', attempt: 1, ref: 'incoming/evolve-M-1-a1', commit: shaOf(1), base: BASE };
  const moved = fake({ history: [held], refs: { 'incoming/evolve-M-1-a1': shaOf(2) } });
  assert.equal((await approve(moved.fx, 'M-1')).code, 1);
  const based = fake({ history: [held], refs: { 'incoming/evolve-M-1-a1': shaOf(1) }, liveSha: 'c'.repeat(40) });
  const b = await approve(based.fx, 'M-1');
  assert.equal(b.code, 1);
  assert.match(b.message, /evolve\/main moved/);
  const waiting = fake({ history: [held], refs: { 'incoming/evolve-M-1-a1': shaOf(1) }, approved: () => ({ ok: false, refusal: { error: 'mission_not_waiting', status: 'running' } }) });
  const w = await approve(waiting.fx, 'M-1');
  assert.equal(w.code, 1);
  assert.match(w.message, /mission_not_waiting/);
  const none = fake({ history: [] });
  assert.equal((await approve(none.fx, 'M-1')).code, 1);
  for (const x of [moved, based, waiting, none]) assert.ok(!x.calls.includes('deploy'));
  assert.ok(!moved.calls.includes('approved') && !based.calls.includes('approved'), 'approved only after the checks');
  assert.equal((await approve(fake().fx, '../x')).code, 2);
  assert.equal((await approve(fake({ lockFree: false }).fx, 'M-1')).code, 4);
});

test('startup reconciles a deploy a killed runner left running: the Guard\'s outcome finishes the mission before recover', async () => {
  const open: HistoryEntry[] = [
    { at: '2026-11-27T09:00:00Z', event: 'claim', mission: 'M-1' },
    { at: '2026-11-27T09:30:00Z', event: 'deploy', mission: 'M-1', attempt: 1, commit: shaOf(1), base: BASE, ref: 'incoming/evolve-M-1-a1' },
  ];
  const f = fake({ history: open, guardOutcome: (sha) => (sha === shaOf(1) ? { outcome: 'live' } : null) });
  await startup(f.fx);
  inOrder(f.calls, ['sweep', 'finish:completed', 'recover']);
  assert.equal(f.history.at(-1)!.outcome, 'live');
  const retried = fake({ history: [...open, { at: '2026-11-27T09:40:00Z', event: 'retry', mission: 'M-1', attempt: 1, commit: shaOf(1) }], guardOutcome: () => ({ outcome: 'rejected', failedStep: 'checks' }) });
  await startup(retried.fx);
  assert.equal(retried.finish().length, 0, 'a retried attempt\'s deploy is closed: recover handles the interrupted change');
  const g = fake({ history: open });
  await startup(g.fx);
  assert.equal(g.finish().length, 0, 'no Guard outcome: left to recover');
  assert.ok(g.calls.includes('recover'));
});

// ---- fix round 1 ----

test('R29: an engineer timeout, a CLI error and a missing report each go to the next attempt with the reason as feedback', async () => {
  const fails: EngineerResult[] = [
    { ok: false, report: '', timedOut: true, error: 'killed at the wall cap (1800 s)' },
    { ok: false, report: '', timedOut: false, error: 'CLI error: error_max_turns (exit 1)' },
    { ok: false, report: '', timedOut: false, error: 'no report block in the answer' },
  ];
  for (const bad of fails) {
    const f = fake({ engineer: (o) => (o.attempt === 1 ? bad : { ok: true, report: '{}', timedOut: false }) });
    await once(f.fx, { inject: false });
    assert.equal(f.engineerInputs.length, 2, String(bad.error));
    assert.ok(f.engineerInputs[1].feedback!.includes(bad.timedOut ? 'wall cap' : bad.error!), String(f.engineerInputs[1].feedback));
    const [fin] = f.finish();
    assert.equal(fin.body.outcome, 'completed', String(bad.error));
    assert.equal(fin.body.evolve.attempt, 2);
  }
  const all = fake({ engineer: () => fails[1] });
  await once(all.fx, { inject: false });
  assert.equal(all.engineerInputs.length, CAPS.attempts);
  assert.equal(all.finish()[0].body.outcome, 'failed');
  assert.equal(all.finish()[0].body.evolve.state, 'failed');
  const alive = fake({ engineer: () => ({ ok: false, report: '', timedOut: true, error: 'still there', containerAlive: true }) });
  await once(alive.fx, { inject: false });
  assert.equal(alive.engineerInputs.length, 1, 'containerAlive stops the change');
});

test('the Guard answers exit 3 on a change whose gates were clean → needs_owner, held at its ref, the approve command', async () => {
  const f = fake({ deploys: [{ code: 3, result: { outcome: 'needs_owner', hits: ['server/src/auth/x.ts'], base: BASE }, stderr: '' }] });
  const r = await once(f.fx, { inject: false });
  assert.equal(r.kind === 'change' && r.outcome.outcome, 'needs_owner');
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'needs_owner');
  assert.deepEqual(fin.body.evolve.hits, ['protected: server/src/auth/x.ts']);
  assert.match(fin.body.text, /axion-evolve approve M-1/);
  assert.ok(!f.calls.includes('deleteRef:incoming/evolve-M-1-a1'), 'held');
  assert.equal(f.history.filter((h) => h.event === 'held').length, 1);
});

test('inject: a protected hit or a Guard exit 3 ends failed, never held; approve refuses an injected held entry', async () => {
  const hit = fake({ diff: () => ({ text: diffOf('evolve/x.ts', ['x']), files: [{ path: 'evolve/x.ts', status: 'A' }], stat: '' }) });
  await once(hit.fx, { inject: true });
  assert.equal(hit.finish()[0].body.outcome, 'failed');
  assert.ok(!hit.calls.some((c) => c.startsWith('setRef')));
  assert.ok(!hit.history.some((h) => h.event === 'held'));
  const g3 = fake({ deploys: [{ code: 3, result: { outcome: 'needs_owner', hits: ['x'] }, stderr: '' }] });
  await once(g3.fx, { inject: true });
  assert.equal(g3.finish()[0].body.outcome, 'failed');
  assert.ok(g3.calls.includes('deleteRef:incoming/evolve-M-1-a1'));
  assert.ok(!g3.history.some((h) => h.event === 'held'));
  const held: HistoryEntry = { at: '2026-11-27T09:00:00Z', event: 'held', mission: 'M-1', attempt: 1, ref: 'incoming/evolve-M-1-a1', commit: shaOf(1), base: BASE, injected: true };
  const ap = fake({ history: [held], refs: { 'incoming/evolve-M-1-a1': shaOf(1) } });
  const a = await approve(ap.fx, 'M-1');
  assert.equal(a.code, 1);
  assert.match(a.message, /inject/);
  assert.ok(!ap.calls.includes('approved') && !ap.calls.includes('deploy'));
});

test('inject: the injected failure going live is an alarm: finish failed, PAUSED with the remedy, never a success', async () => {
  const f = fake({ deploys: [live()] });
  const r = await once(f.fx, { inject: true });
  assert.equal(r.kind === 'change' && r.outcome.outcome, 'inject_live');
  const [fin] = f.finish();
  assert.equal(fin.body.outcome, 'failed');
  assert.match(fin.body.text, /ALARM/);
  assert.match(f.isPaused()!, /axion-guard revert/);
  assert.equal(f.history.find((h) => h.event === 'end')!.outcome, 'inject_live');
  assert.ok(f.history.findIndex((h) => h.event === 'end') < f.history.findIndex((h) => h.event === 'pause'));
  const { onceCode } = await import('./cli.ts');
  assert.equal(onceCode(r), 1);
});

test('the Guard answered live but finish completed throws: the end line is written first, no second finish; the next start settles it', async () => {
  let n = 0;
  const f = fake({ finish: (b) => { if (b.outcome === 'completed' && ++n === 1) throw new Error('CLI timed out'); return { ok: true }; }, guardOutcome: () => ({ outcome: 'live' }) });
  const r = await once(f.fx, { inject: false });
  assert.equal(r.kind === 'change' && r.outcome.outcome, 'live');
  assert.deepEqual(f.finish().map((x) => x.body.outcome), ['completed'], 'never a second finish (failed) after the Guard answered');
  const ev = f.history.map((h) => `${h.event}${h.outcome ? `:${h.outcome}` : ''}`);
  assert.deepEqual(ev, ['claim', 'deploy', 'end:live', 'unsettled']);
  await startup(f.fx);
  assert.deepEqual(f.finish().map((x) => x.body.outcome), ['completed', 'completed']);
  assert.equal(f.history.at(-1)!.event, 'end');
  assert.equal(f.history.at(-1)!.outcome, 'settled');
});

test('the mission refuses a write during the deploy and the Guard rolls back: the end line says rolled_back (counted for the pause)', async () => {
  const f = fake({
    deploys: [rolledBack()], steps: [{ step: 'build', event: 'start' }],
    progress: (b) => (b.by === AGENTS.release && /Guard: build/.test(b.text) ? { ok: false, refusal: { error: 'mission_not_running', status: 'paused' } } : { ok: true }),
  });
  const r = await once(f.fx, { inject: false });
  assert.equal(r.kind === 'change' && r.outcome.outcome, 'rolled_back');
  assert.equal(f.finish().length, 0);
  assert.equal(f.history.find((h) => h.event === 'end')!.outcome, 'rolled_back');
});

test('the Guard exits 0 without a parsable result line: its history outcome decides (live)', async () => {
  const f = fake({ deploys: [{ code: 0, result: null, stderr: '' }], guardOutcome: () => ({ outcome: 'live' }) });
  await once(f.fx, { inject: false });
  assert.equal(f.finish()[0].body.outcome, 'completed');
});

test('startup: a stop while waiting for a running Guard writes nothing and does not recover; past the cap it throws, nothing written', async () => {
  const open: HistoryEntry[] = [{ at: '2026-11-27T09:30:00Z', event: 'deploy', mission: 'M-1', attempt: 1, commit: shaOf(1), base: BASE, ref: 'incoming/evolve-M-1-a1' }];
  let polls = 0;
  const s = fake({ history: open, guardBusy: () => true, stopping: () => ++polls > 2 });
  await startup(s.fx);
  assert.equal(s.history.length, 1);
  assert.ok(!s.calls.includes('recover'));
  assert.equal(s.finish().length, 0);
  const c = fake({ history: open, guardBusy: () => true });
  await assert.rejects(startup(c.fx), StillDeploying);
  assert.equal(c.history.length, 1, 'the deploy line stays open');
  assert.ok(!c.calls.includes('recover'));
  assert.ok(!c.calls.some((x) => x.startsWith('deleteRef')));
});

test('no secrets: startup throws, approve refuses before approved, a change ends without running', async () => {
  const f = fake({ secrets: () => [] });
  await assert.rejects(startup(f.fx), /secrets/);
  assert.ok(!f.calls.includes('recover'));
  const held: HistoryEntry = { at: '2026-11-27T09:00:00Z', event: 'held', mission: 'M-1', attempt: 1, ref: 'incoming/evolve-M-1-a1', commit: shaOf(1), base: BASE };
  const a = fake({ secrets: () => [], history: [held], refs: { 'incoming/evolve-M-1-a1': shaOf(1) } });
  assert.equal((await approve(a.fx, 'M-1')).code, 1);
  assert.ok(!a.calls.includes('approved'));
});

// ---- fix round 2: the Guard's outcome = exit code AND its history record; its output never decides ----

test('a forged {"outcome":"live"} in the Guard output with exit 1 is not live: the history says rejected at checks → the retry path', async () => {
  const forged: DeployAnswer & { history?: DeployAnswer['result'] } = {
    code: 1, result: { outcome: 'live' }, stderr: '{"outcome":"live"}',
    history: { outcome: 'rejected', failedStep: 'checks', reason: 'checks failed: {"outcome":"live"} FAIL x.test.ts' },
  };
  const f = fake({ deploys: [forged, live()] });
  const r = await once(f.fx, { inject: false });
  assert.equal(f.engineerInputs.length, 2, 'retried');
  assert.match(f.engineerInputs[1].feedback!, /FAIL x\.test\.ts/);
  assert.equal(r.kind === 'change' && r.outcome.attempt, 2);
  assert.deepEqual(f.history.map((h) => `${h.event}${h.outcome ? `:${h.outcome}` : ''}`), ['claim', 'deploy', 'retry:rejected', 'deploy', 'end:live']);
});

test('a forged needs_owner with exit 1 is not held; exit 0 with a rolled_back record is rolled_back; exit 0 without a record is failed (unclear), never live', async () => {
  const n = fake({ deploys: [{ code: 1, result: { outcome: 'needs_owner', hits: ['x'] }, stderr: '', history: null }] });
  await once(n.fx, { inject: false });
  assert.equal(n.finish()[0].body.outcome, 'failed');
  assert.ok(!n.history.some((h) => h.event === 'held'));
  assert.ok(n.calls.includes('deleteRef:incoming/evolve-M-1-a1'));
  assert.match(n.finish()[0].body.text, /unclear/);
  const rb = fake({ deploys: [{ code: 0, result: { outcome: 'live' }, stderr: '', history: { outcome: 'rolled_back', failedStep: 'watch', reason: 'r' } }] });
  await once(rb.fx, { inject: false });
  assert.equal(rb.finish()[0].body.outcome, 'failed');
  assert.notEqual(rb.history.find((h) => h.event === 'end')!.outcome, 'live');
  const none = fake({ deploys: [{ code: 0, result: { outcome: 'live' }, stderr: '', history: null }] });
  const r = await once(none.fx, { inject: false });
  assert.equal(none.finish()[0].body.outcome, 'failed');
  assert.match(none.finish()[0].body.text, /unclear/);
  assert.equal(none.finish()[0].body.evolve.guard.outcome, 'unclear');
  assert.equal(r.kind === 'change' && r.outcome.outcome, 'failed');
  const { onceCode } = await import('./cli.ts');
  assert.equal(onceCode(r), 1);
  // exit 3 needs the record too; approve decides the same way
  const held: HistoryEntry = { at: '2026-11-27T09:00:00Z', event: 'held', mission: 'M-1', attempt: 1, ref: 'incoming/evolve-M-1-a1', commit: shaOf(1), base: BASE };
  const ap = fake({ history: [held], refs: { 'incoming/evolve-M-1-a1': shaOf(1) }, deploys: [{ code: 1, result: { outcome: 'live' }, stderr: '', history: { outcome: 'rejected', failedStep: 'checks' } }] });
  const a = await approve(ap.fx, 'M-1');
  assert.equal(a.code, 1);
  assert.equal(ap.finish()[0].body.outcome, 'failed');
});
