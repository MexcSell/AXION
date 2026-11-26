import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploy, Busy, STEPS } from './deploy.ts';
import type { Effects, HistoryEntry, DeployRequest, Change, Slot } from './deploy.ts';
import { parseRules } from './classify.ts';
import { readState } from './state.ts';
import type { GuardState } from './state.ts';

const LIVE = 'a'.repeat(40);
const SHA = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);
const LIVE_IMAGE = 'aaaaaaaaaaaa-20261125T100000Z';
const IMAGE = 'bbbbbbbbbbbb-20261126T120000Z';
const RULES = parseRules(readFileSync(new URL('../protected.txt', import.meta.url), 'utf8'));

const INITIAL: GuardState = {
  active: 'blue', activeImage: LIVE_IMAGE, activeSha: LIVE, previousImage: 'dddddddddddd-20261124T000000Z', previousSha: 'd'.repeat(40),
  frontPort: 5290, database: 'axion_restore_check',
};

type Call = [string, ...unknown[]];
type Cfg = {
  live: string; diff: Change[]; ancestor: boolean;
  checks: { ok: boolean; passed: number; log: string }; boot: boolean;
  smoke: { ok: boolean; commit: string | null }; watch: { ok: boolean; reason?: string };
  throwIn?: string; // name of an effect whose first call throws
  hook?: Record<string, () => Promise<void> | void>; // runs inside the named effect, after it is recorded
};

function setup(over: Partial<Cfg> = {}, initial: GuardState | null = INITIAL) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  if (initial) writeFileSync(join(dir, 'state.json'), JSON.stringify(initial));
  const cfg: Cfg = {
    live: LIVE, diff: [{ path: 'web/src/pages/Home.tsx', status: 'M' }], ancestor: true,
    checks: { ok: true, passed: 100, log: 'tests 100 pass' }, boot: true,
    smoke: { ok: true, commit: SHA }, watch: { ok: true }, ...over,
  };
  const calls: Call[] = [];
  const history: HistoryEntry[] = [];
  let held = false;
  let thrown = false;
  const eff = async <T>(name: string, args: unknown[], value: T): Promise<T> => {
    calls.push([name, ...args]);
    await cfg.hook?.[name]?.();
    if (cfg.throwIn === name && !thrown) { thrown = true; throw new Error(`${name} exploded`); }
    return value;
  };
  const fx: Effects = {
    lock: async () => {
      if (held) throw new Busy();
      held = true;
      calls.push(['lock']);
      return async () => { held = false; calls.push(['unlock']); };
    },
    liveSha: () => eff('liveSha', [], cfg.live),
    diff: (base, sha) => eff('diff', [base, sha], cfg.diff),
    isAncestor: (a, b) => eff('isAncestor', [a, b], cfg.ancestor),
    build: (sha) => eff('build', [sha], IMAGE),
    checks: (image) => eff('checks', [image], cfg.checks),
    bootOffline: (image) => eff('bootOffline', [image], cfg.boot),
    backup: () => eff('backup', [], '/srv/axion-evolve/backups/axion-20261126.dump'),
    migrate: (image) => eff('migrate', [image], undefined),
    startSlot: (slot, image) => eff('startSlot', [slot, image], undefined),
    smoke: (slot) => eff('smoke', [slot], cfg.smoke),
    drain: (slot) => eff('drain', [slot], undefined),
    switchTo: (slot) => eff('switchTo', [slot], undefined),
    stopSlot: (slot) => eff('stopSlot', [slot], undefined),
    watch: (slot, ms) => eff('watch', [slot, ms], cfg.watch),
    record: async (entry) => { history.push(entry); },
    advance: async (sha) => { await eff('advance', [sha], undefined); cfg.live = sha; },
  };
  const req: DeployRequest = { sha: SHA, watchMs: 1234, baselinePassed: 100, active: 'blue', stateDir: dir, rules: RULES };
  const names = () => calls.map((c) => c[0]);
  return { dir, cfg, calls, history, fx, req, names };
}

const PRE_SWITCH: Call[] = [
  ['lock'], ['liveSha'], ['diff', LIVE, SHA], ['isAncestor', LIVE, SHA], ['build', SHA], ['checks', IMAGE], ['bootOffline', IMAGE],
  ['backup'],
];

function assertLiveUntouched(calls: Call[]) {
  assert.ok(!calls.some((c) => c[0] === 'switchTo'), 'never switched');
  assert.ok(!calls.some((c) => c[0] === 'stopSlot' && c[1] === 'blue'), 'live slot never stopped');
  assert.ok(!calls.some((c) => c[0] === 'advance'), 'never advanced');
  assert.ok(!calls.some((c) => c[0] === 'startSlot' && c[1] === 'blue'), 'live slot never restarted');
}

async function stateOf(dir: string) { return readState(dir); }

test('happy path runs the steps in order and ends live; advance(sha) only after watch passed', async () => {
  const s = setup();
  const r = await deploy(s.fx, s.req);
  assert.deepEqual(r, { outcome: 'live', image: IMAGE });
  assert.deepEqual(s.calls, [
    ...PRE_SWITCH,
    ['startSlot', 'green', IMAGE], ['smoke', 'green'], ['drain', 'blue'], ['switchTo', 'green'], ['watch', 'green', 1234],
    ['advance', SHA], ['unlock'],
  ]);
  // every step's start and end were recorded, in order, then the outcome
  const steps = s.history.filter((h) => h.event !== 'outcome').map((h) => `${h.step}:${h.event}`);
  assert.deepEqual(steps, STEPS.flatMap((st) => [`${st}:start`, `${st}:end`]));
  assert.ok(s.history.filter((h) => h.event === 'end').every((h) => h.ok === true));
  assert.ok(s.history.every((h) => h.sha === SHA && typeof h.at === 'string'));
  const last = s.history.at(-1)!;
  assert.equal(last.event, 'outcome');
  assert.equal(last.outcome, 'live');
  assert.equal(last.image, IMAGE);
  // the migrate step was skipped (no approval, no migrations) and says so
  assert.match(s.history.find((h) => h.step === 'migrate' && h.event === 'end')!.detail ?? '', /skipped/);
  // state: the candidate is live, the old one is previous, no deploy in progress, unknown fields kept
  assert.deepEqual(await stateOf(s.dir), {
    active: 'green', activeImage: IMAGE, activeSha: SHA, previousImage: LIVE_IMAGE, previousSha: LIVE,
    frontPort: 5290, database: 'axion_restore_check',
  });
});

test('a protected hit without approvedSha === sha returns needs_owner and never builds', async () => {
  const s = setup({ diff: [{ path: 'web/src/a.ts', status: 'M' }, { path: 'evolve/guard/deploy.ts', status: 'M' }] });
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'needs_owner');
  assert.deepEqual(r.hits, ['evolve/guard/deploy.ts']);
  assert.equal(r.base, LIVE);
  assert.match(r.reason ?? '', /evolve\/guard\/deploy\.ts/);
  assert.deepEqual(s.calls, [['lock'], ['liveSha'], ['diff', LIVE, SHA], ['unlock']]);
  assert.equal(s.history.at(-1)!.outcome, 'needs_owner');
  assert.deepEqual(await stateOf(s.dir), INITIAL);
});

test('approval for another sha does not count', async () => {
  const s = setup({ diff: [{ path: 'server/src/auth/session.ts', status: 'M' }] });
  const r = await deploy(s.fx, { ...s.req, approvedSha: OTHER, approvedBase: LIVE });
  assert.equal(r.outcome, 'needs_owner');
  assert.ok(!s.names().includes('build'));
  // approved for exactly this sha: it proceeds
  const t = setup({ diff: [{ path: 'server/src/auth/session.ts', status: 'M' }] });
  assert.equal((await deploy(t.fx, { ...t.req, approvedSha: SHA, approvedBase: LIVE })).outcome, 'live');
  // a renamed protected file is caught by its old path
  const u = setup({ diff: [{ path: 'server/src/x.ts', status: 'R', oldPath: 'server/src/auth/session.ts' }] });
  assert.deepEqual((await deploy(u.fx, u.req)).hits, ['server/src/auth/session.ts']);
});

test('base check: a candidate that does not contain the live sha is rejected before build', async () => {
  const s = setup({ ancestor: false });
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'rejected');
  assert.equal(r.failedStep, 'base');
  assert.deepEqual(s.calls, [['lock'], ['liveSha'], ['diff', LIVE, SHA], ['isAncestor', LIVE, SHA], ['unlock']]);
  assert.deepEqual(await stateOf(s.dir), INITIAL);
});

test('redeploying the live sha passes the base check with an empty diff', async () => {
  const s = setup({ live: SHA, diff: [] }, { ...INITIAL, activeImage: IMAGE, activeSha: SHA });
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'live');
  assert.deepEqual(s.calls.slice(0, 4), [['lock'], ['liveSha'], ['diff', SHA, SHA], ['isAncestor', SHA, SHA]]);
});

test('failing checks, a test count below baseline, failed offline boot or failed smoke → rejected; live slot never stopped or switched', async () => {
  const cases: [Partial<Cfg>, string, boolean][] = [
    [{ checks: { ok: false, passed: 100, log: 'x failed' } }, 'checks', false],
    [{ checks: { ok: true, passed: 99, log: '' } }, 'checks', false],
    [{ boot: false }, 'boot', false],
    [{ smoke: { ok: false, commit: SHA } }, 'smoke', true],
    [{ throwIn: 'build' }, 'build', false],
    [{ throwIn: 'checks' }, 'checks', false],
    [{ throwIn: 'backup' }, 'backup', false],
    [{ throwIn: 'startSlot' }, 'start', true],
    [{ throwIn: 'smoke' }, 'smoke', true],
    [{ throwIn: 'drain' }, 'drain', true],
  ];
  for (const [over, step, started] of cases) {
    const s = setup(over);
    const r = await deploy(s.fx, s.req);
    const label = JSON.stringify(over);
    assert.equal(r.outcome, 'rejected', label);
    assert.equal(r.failedStep, step, label);
    assert.ok(r.reason, label);
    assertLiveUntouched(s.calls);
    // a started candidate is stopped again; nothing else is
    assert.deepEqual(s.calls.filter((c) => c[0] === 'stopSlot'), started ? [['stopSlot', 'green']] : [], label);
    assert.deepEqual(s.calls.at(-1), ['unlock'], label);
    const end = s.history.find((h) => h.step === step && h.event === 'end')!;
    assert.equal(end.ok, false, label);
    assert.equal(s.history.at(-1)!.outcome, 'rejected', label);
    assert.equal(s.history.at(-1)!.failedStep, step, label);
    assert.deepEqual(await stateOf(s.dir), INITIAL, label);
  }
  // the test count may equal the baseline
  const eq = setup({ checks: { ok: true, passed: 100, log: '' } });
  assert.equal((await deploy(eq.fx, { ...eq.req, baselinePassed: 100 })).outcome, 'live');
  const below = setup({ checks: { ok: true, passed: 100, log: '' } });
  const rb = await deploy(below.fx, { ...below.req, baselinePassed: 101 });
  assert.equal(rb.failedStep, 'checks');
  assert.match(rb.reason ?? '', /100.*101/);
});

test('migrate runs only when approved and the diff has server/migrations/**', async () => {
  const mig: Change[] = [{ path: 'server/migrations/0066_x.up.sql', status: 'A' }, { path: 'web/src/a.ts', status: 'M' }];
  // approved + migrations: migrate(image) after backup, before the candidate starts
  const a = setup({ diff: mig });
  assert.equal((await deploy(a.fx, { ...a.req, approvedSha: SHA, approvedBase: LIVE })).outcome, 'live');
  const n = a.names();
  assert.deepEqual(a.calls.filter((c) => c[0] === 'migrate'), [['migrate', IMAGE]]);
  assert.ok(n.indexOf('backup') < n.indexOf('migrate') && n.indexOf('migrate') < n.indexOf('startSlot'));
  // approved but no migrations in the diff: no migrate
  const b = setup({ diff: [{ path: 'evolve/guard/x.ts', status: 'M' }] });
  assert.equal((await deploy(b.fx, { ...b.req, approvedSha: SHA, approvedBase: LIVE })).outcome, 'live');
  assert.ok(!b.names().includes('migrate'));
  // migrations without approval: needs_owner, never migrates
  const c = setup({ diff: mig });
  assert.equal((await deploy(c.fx, c.req)).outcome, 'needs_owner');
  assert.ok(!c.names().includes('migrate'));
  // even if the rules did not protect migrations, an unapproved change never migrates
  const c2 = setup({ diff: mig });
  assert.equal((await deploy(c2.fx, { ...c2.req, rules: [] })).outcome, 'live');
  assert.ok(!c2.names().includes('migrate'));
  assert.match(c2.history.find((h) => h.step === 'migrate' && h.event === 'end')!.detail ?? '', /not approved/);
  // a migration moved out of the folder still counts as touching migrations
  const d = setup({ diff: [{ path: 'server/old/0066.sql', status: 'R', oldPath: 'server/migrations/0066_x.up.sql' }] });
  await deploy(d.fx, { ...d.req, approvedSha: SHA, approvedBase: LIVE });
  assert.ok(d.names().includes('migrate'));
  // a failed migration is rejected before the candidate starts; live untouched
  const e = setup({ diff: mig, throwIn: 'migrate' });
  const re = await deploy(e.fx, { ...e.req, approvedSha: SHA, approvedBase: LIVE });
  assert.equal(re.outcome, 'rejected');
  assert.equal(re.failedStep, 'migrate');
  assert.ok(!e.names().includes('startSlot'));
  assertLiveUntouched(e.calls);
});

test('watch failure after switch → switchTo(previous), stopSlot(candidate), outcome rolled_back, no advance', async () => {
  const s = setup({ watch: { ok: false, reason: '3 bad health polls' } });
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'rolled_back');
  assert.equal(r.failedStep, 'watch');
  assert.match(r.reason ?? '', /3 bad health polls/);
  assert.equal(r.image, IMAGE);
  assert.deepEqual(s.calls.slice(PRE_SWITCH.length), [
    ['startSlot', 'green', IMAGE], ['smoke', 'green'], ['drain', 'blue'], ['switchTo', 'green'], ['watch', 'green', 1234],
    ['switchTo', 'blue'], ['stopSlot', 'green'], ['unlock'],
  ]);
  assert.equal(s.history.at(-1)!.outcome, 'rolled_back');
  assert.deepEqual(await stateOf(s.dir), INITIAL);
});

test('a throw in switch, watch or advance takes the rollback path', async () => {
  for (const [name, step] of [['switchTo', 'switch'], ['watch', 'watch'], ['advance', 'record']] as const) {
    const s = setup({ throwIn: name });
    const r = await deploy(s.fx, s.req);
    assert.equal(r.outcome, 'rolled_back', name);
    assert.equal(r.failedStep, step, name);
    assert.match(r.reason ?? '', /exploded/, name);
    const tail = s.calls.slice(-3);
    assert.deepEqual(tail, [['switchTo', 'blue'], ['stopSlot', 'green'], ['unlock']], name);
    assert.ok(!s.calls.some((c) => c[0] === 'advance') || name === 'advance', name);
    assert.deepEqual(await stateOf(s.dir), INITIAL, name);
  }
});

test('once advance(sha) succeeded nothing rolls back, even if recording the record step\'s end fails', async () => {
  const s = setup();
  const rec = s.fx.record;
  s.fx.record = async (e) => { if (e.step === 'record' && e.event === 'end' && e.ok) throw new Error('history disk full'); await rec(e); };
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'live');
  assert.match(r.reason ?? '', /history disk full/);
  assert.deepEqual(s.calls.slice(-3), [['watch', 'green', 1234], ['advance', SHA], ['unlock']]);
  assert.ok(!s.calls.some((c) => c[0] === 'switchTo' && c[1] === 'blue'));
  const st = await readState(s.dir);
  assert.equal(st!.active, 'green');
  assert.equal(st!.activeSha, SHA);
  assert.equal(st!.deploying, undefined);
  assert.equal(s.history.at(-1)!.outcome, 'live');
});

test('a failed switch back leaves the deploy marked unfinished for `axion-guard rollback` and throws', async () => {
  const s = setup({ watch: { ok: false, reason: 'down' } });
  let switches = 0;
  const orig = s.fx.switchTo;
  s.fx.switchTo = async (slot) => { switches++; await orig(slot); if (switches === 2) throw new Error('front gone'); };
  await assert.rejects(deploy(s.fx, s.req), /rollback failed.*front gone/);
  const st = await stateOf(s.dir);
  assert.equal(st!.deploying?.step, 'watch');
  assert.equal(st!.active, 'green');
  assert.deepEqual(s.calls.at(-1), ['unlock']);
  assert.ok(!s.names().includes('advance'));
});

test('smoke must report the candidate\'s commit; another commit → rejected', async () => {
  for (const commit of [OTHER, null, SHA.slice(0, 12)]) {
    const s = setup({ smoke: { ok: true, commit } });
    const r = await deploy(s.fx, s.req);
    assert.equal(r.outcome, 'rejected', String(commit));
    assert.equal(r.failedStep, 'smoke');
    assertLiveUntouched(s.calls);
    assert.deepEqual(s.calls.filter((c) => c[0] === 'stopSlot'), [['stopSlot', 'green']]);
  }
});

test('a second deploy while the lock is held → Busy, no effect called', async () => {
  let releaseBuild!: () => void;
  const parked = new Promise<void>((res) => { releaseBuild = res; });
  let reachedBuild!: () => void;
  const atBuild = new Promise<void>((res) => { reachedBuild = res; });
  const s = setup({ hook: { build: async () => { reachedBuild(); await parked; } } });
  const first = deploy(s.fx, s.req);
  await atBuild; // first deploy holds the lock and is parked inside build
  const callsBefore = s.calls.length;
  const historyBefore = s.history.length;
  const stateBefore = readFileSync(join(s.dir, 'state.json'), 'utf8');
  await assert.rejects(deploy(s.fx, { ...s.req, sha: OTHER }), Busy);
  assert.equal(s.calls.length, callsBefore, 'no effect called');
  assert.equal(s.history.length, historyBefore, 'nothing recorded');
  assert.equal(readFileSync(join(s.dir, 'state.json'), 'utf8'), stateBefore, 'state untouched');
  releaseBuild();
  assert.equal((await first).outcome, 'live');
  // the lock was released in finally: a third deploy can run (green is live now)
  assert.equal((await deploy(s.fx, { ...s.req, active: 'green' })).outcome, 'live');
  assert.equal((await readState(s.dir))!.active, 'blue');
});

test('the lock is released even when an effect throws unexpectedly', async () => {
  const s = setup();
  s.fx.record = async () => { throw new Error('disk full'); };
  await assert.rejects(deploy(s.fx, s.req));
  assert.deepEqual(s.calls.at(-1), ['unlock']);
});

test('state.json shows deploying with the step after switch, and is cleared after rollback', async () => {
  const seen: Record<string, GuardState | null> = {};
  const s = setup({
    watch: { ok: false, reason: 'errors in log' },
    hook: {
      build: async () => { seen.build = await readState(s.dir); },
      switchTo: async () => { if (!seen.switch) seen.switch = await readState(s.dir); },
      watch: async () => { seen.watch = await readState(s.dir); },
    },
  });
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'rolled_back');
  // before the switch: the old slot is still active; the step is shown
  assert.equal(seen.build!.active, 'blue');
  assert.equal(seen.build!.deploying!.step, 'build');
  assert.equal(seen.switch!.active, 'blue');
  assert.equal(seen.switch!.activeImage, LIVE_IMAGE);
  assert.deepEqual({ ...seen.switch!.deploying, startedAt: 'x' }, { sha: SHA, step: 'switch', startedAt: 'x' });
  // after the switch: enough to undo it alone (Guard killed here → `axion-guard rollback`)
  const { deploying, ...rest } = seen.watch!;
  assert.deepEqual(rest, {
    active: 'green', activeImage: IMAGE, activeSha: SHA, previousImage: LIVE_IMAGE, previousSha: LIVE,
    frontPort: 5290, database: 'axion_restore_check',
  });
  assert.equal(deploying!.sha, SHA);
  assert.equal(deploying!.step, 'watch');
  assert.ok(!Number.isNaN(Date.parse(deploying!.startedAt)));
  assert.equal(deploying!.startedAt, seen.switch!.deploying!.startedAt);
  // after the rollback: back to the state before the deploy, nothing in progress
  assert.deepEqual(await readState(s.dir), INITIAL);
  assert.equal(JSON.parse(readFileSync(join(s.dir, 'state.json'), 'utf8')).deploying, undefined);
});

test('first deploy (no state.json): goes live; a watch failure stops the candidate with nothing to switch back to', async () => {
  const s = setup({}, null);
  assert.equal((await deploy(s.fx, s.req)).outcome, 'live');
  assert.deepEqual(await readState(s.dir), {
    active: 'green', activeImage: IMAGE, activeSha: SHA, previousImage: null, previousSha: null,
  });
  const f = setup({ watch: { ok: false, reason: 'down' } }, null);
  const r = await deploy(f.fx, f.req);
  assert.equal(r.outcome, 'rolled_back');
  assert.deepEqual(f.calls.slice(-4), [['switchTo', 'green'], ['watch', 'green', 1234], ['stopSlot', 'green'], ['unlock']]);
  assert.deepEqual(await readState(f.dir), {
    active: 'blue', activeImage: null, activeSha: null, previousImage: null, previousSha: null,
  });
});

test('an unfinished deploy in state.json (Guard killed) → rejected until `axion-guard rollback` clears it', async () => {
  const s = setup({}, { ...INITIAL, deploying: { sha: OTHER, step: 'watch', startedAt: '2026-11-26T10:00:00.000Z' } });
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'rejected');
  assert.equal(r.failedStep, 'lock');
  assert.match(r.reason ?? '', /unfinished deploy/);
  assert.deepEqual(s.calls, [['lock'], ['unlock']]);
  assert.equal((await readState(s.dir))!.deploying!.sha, OTHER);
});

test('a live commit that differs from state.json activeSha → rejected at base, before build', async () => {
  const s = setup({ live: OTHER });
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'rejected');
  assert.equal(r.failedStep, 'base');
  assert.ok(!s.names().includes('build'));
  assert.deepEqual(await readState(s.dir), INITIAL);
});

test('state.json naming a different active slot than the request → rejected before anything runs', async () => {
  const s = setup({}, { ...INITIAL, active: 'green' });
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'rejected');
  assert.equal(r.failedStep, 'lock');
  assert.deepEqual(s.calls, [['lock'], ['unlock']]);
  assert.ok(existsSync(join(s.dir, 'state.json')));
  assert.equal((await readState(s.dir))!.active, 'green');
});

test('approval is bound to the base too: another base, or no base, does not count (R9)', async () => {
  const diff: Change[] = [{ path: 'server/src/auth/session.ts', status: 'M' }];
  for (const approval of [{ approvedSha: SHA, approvedBase: OTHER }, { approvedSha: SHA }]) {
    const s = setup({ diff });
    const r = await deploy(s.fx, { ...s.req, ...approval });
    assert.equal(r.outcome, 'needs_owner', JSON.stringify(approval));
    assert.equal(r.base, LIVE);
    assert.ok(!s.names().includes('build'));
    assert.equal(s.history.at(-1)!.base, LIVE);
  }
  // migrations approved for another base never migrate
  const m = setup({ diff: [{ path: 'server/migrations/0066_x.up.sql', status: 'A' }] });
  assert.equal((await deploy(m.fx, { ...m.req, approvedSha: SHA, approvedBase: OTHER })).outcome, 'needs_owner');
  assert.ok(!m.names().includes('migrate'));
});

test('the test-count floor rejects a missing or non-integer count', async () => {
  for (const checks of [{ ok: true, passed: NaN, log: '' }, { ok: true, log: '' }, { ok: true, passed: 100.5, log: '' },
    { ok: true, passed: '100', log: '' }, { ok: 1, passed: 100, log: '' }]) {
    const s = setup({ checks: checks as Cfg['checks'] });
    const r = await deploy(s.fx, s.req);
    assert.equal(r.outcome, 'rejected', JSON.stringify(checks));
    assert.equal(r.failedStep, 'checks', JSON.stringify(checks));
    assertLiveUntouched(s.calls);
  }
});

test('a malformed request (sha not a full commit sha, bad baseline…) fails closed before any effect except lock', async () => {
  const bad: Partial<DeployRequest>[] = [
    { sha: 'evolve/x', approvedSha: 'evolve/x', approvedBase: LIVE }, { sha: SHA.slice(0, 12) }, { sha: SHA.toUpperCase() },
    { approvedSha: 'main' }, { approvedBase: 'HEAD' }, { baselinePassed: NaN }, { baselinePassed: undefined as unknown as number },
    { baselinePassed: -1 }, { watchMs: 0 }, { watchMs: NaN }, { active: 'red' as Slot }, { rules: undefined as unknown as string[] },
    { stateDir: '' },
  ];
  for (const over of bad) {
    const s = setup({ diff: [{ path: 'server/migrations/0066_x.up.sql', status: 'A' }] });
    const stateBefore = readFileSync(join(s.dir, 'state.json'), 'utf8');
    const r = await deploy(s.fx, { ...s.req, ...over });
    assert.equal(r.outcome, 'rejected', JSON.stringify(over));
    assert.equal(r.failedStep, 'lock');
    assert.match(r.reason ?? '', /invalid request/);
    assert.deepEqual(s.calls, [['lock'], ['unlock']], JSON.stringify(over));
    assert.equal(s.history.length, 0);
    assert.equal(readFileSync(join(s.dir, 'state.json'), 'utf8'), stateBefore);
  }
  // liveSha() returning something that is not a full sha is refused at classify
  const l = setup({ live: 'evolve/main' });
  const rl = await deploy(l.fx, l.req);
  assert.equal(rl.failedStep, 'classify');
  assert.ok(!l.names().includes('diff'));
});

test('advance throws and the switch back throws → deploy throws, state keeps deploying step record for rollback', async () => {
  const s = setup({ throwIn: 'advance' });
  const orig = s.fx.switchTo;
  let n = 0;
  s.fx.switchTo = async (slot) => { n++; await orig(slot); if (n === 2) throw new Error('front gone'); };
  await assert.rejects(deploy(s.fx, s.req), /rollback failed.*front gone.*deploying step record \(active green\)/);
  const st = await readState(s.dir);
  assert.deepEqual(st!.deploying && { sha: st!.deploying.sha, step: st!.deploying.step }, { sha: SHA, step: 'record' });
  assert.equal(st!.active, 'green');
  assert.equal(st!.previousSha, LIVE);
  assert.deepEqual(s.calls.at(-1), ['unlock']);
});

test('while advance runs, state.json shows deploying step record (a Guard killed here is resolvable)', async () => {
  let seen: GuardState | null = null;
  const s = setup({ hook: { advance: async () => { seen = await readState(s.dir); } } });
  assert.equal((await deploy(s.fx, s.req)).outcome, 'live');
  const st = seen as unknown as GuardState;
  assert.equal(st.deploying!.step, 'record');
  assert.equal(st.deploying!.sha, SHA);
  assert.equal(st.active, 'green');
  assert.equal(st.activeSha, SHA);
  assert.equal(st.previousSha, LIVE);
  assert.equal((await readState(s.dir))!.deploying, undefined);
});

test('switch back succeeds but stopping the candidate fails → rolled_back with the error, state on the previous slot (R9)', async () => {
  const s = setup({ watch: { ok: false, reason: 'down' } });
  const orig = s.fx.stopSlot;
  s.fx.stopSlot = async (slot) => { await orig(slot); throw new Error('docker hung'); };
  const r = await deploy(s.fx, s.req);
  assert.equal(r.outcome, 'rolled_back');
  assert.equal(r.failedStep, 'watch');
  assert.match(r.reason ?? '', /down.*switched back to blue, but stopping candidate green failed: docker hung/);
  assert.deepEqual(s.calls.slice(-3), [['switchTo', 'blue'], ['stopSlot', 'green'], ['unlock']]);
  assert.deepEqual(await readState(s.dir), INITIAL);
});

test('first deploy skips drain (no old slot) (R9)', async () => {
  const s = setup({}, null);
  assert.equal((await deploy(s.fx, s.req)).outcome, 'live');
  assert.ok(!s.names().includes('drain'));
  assert.match(s.history.find((h) => h.step === 'drain' && h.event === 'end')!.detail ?? '', /skipped: nothing live/);
});
