// axion-evolve's command line (cli.ts): argument parsing, exit codes, and the file-only commands against fake effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { main, onceCode, parseArgs, UsageError } from './cli.ts';
import type { HistoryEntry, RunnerEffects } from './loop.ts';

test('parseArgs: the commands; run takes nothing (never --inject-failure); once takes only --inject-failure', () => {
  assert.deepEqual(parseArgs(['run']), { cmd: 'run' });
  assert.deepEqual(parseArgs(['once']), { cmd: 'once', inject: false });
  assert.deepEqual(parseArgs(['once', '--inject-failure']), { cmd: 'once', inject: true });
  assert.deepEqual(parseArgs(['approve', 'M-12']), { cmd: 'approve', mission: 'M-12' });
  assert.deepEqual(parseArgs(['pause', 'owner', ' says  so']), { cmd: 'pause', reason: 'owner says so' });
  assert.deepEqual(parseArgs([]), { cmd: 'help' });
  assert.deepEqual(parseArgs(['sweep']), { cmd: 'sweep' });
  for (const bad of [['sweep', 'x'], ['run', '--inject-failure'], ['run', 'x'], ['once', '--inject'], ['once', '--inject-failure', 'x'], ['approve'], ['approve', 'a', 'b'], ['status', 'x'], ['resume', 'x'], ['deploy']]) {
    assert.throws(() => parseArgs(bad), UsageError, bad.join(' '));
  }
});

test('onceCode: 0 live, 1 any other end, 3 needs owner, 4 busy, 5 nothing claimed', () => {
  const ch = (outcome: string) => ({ kind: 'change' as const, outcome: { mission: 'M-1', outcome: outcome as 'live', attempt: 1, reason: '' } });
  assert.equal(onceCode(ch('live')), 0);
  assert.equal(onceCode(ch('needs_owner')), 3);
  for (const o of ['rolled_back', 'rejected', 'failed', 'stopped', 'gone', 'error']) assert.equal(onceCode(ch(o)), 1, o);
  assert.equal(onceCode({ kind: 'busy' }), 4);
  for (const k of [{ kind: 'idle' as const }, { kind: 'paused' as const, reason: 'x' }, { kind: 'halted' as const, reason: 'x' }, { kind: 'cap' as const, count: 12 }]) assert.equal(onceCode(k), 5);
});

function fakeFx() {
  const hist: HistoryEntry[] = [];
  let paused: string | null = null;
  const fx = {
    async paused() { return paused; },
    async writePaused(r: string) { paused = r; },
    async clearPaused() { const w = paused !== null; paused = null; return w; },
    async readHistory() { return hist; },
    async appendHistory(e: Omit<HistoryEntry, 'at'>) { hist.push({ at: '2026-11-27T00:00:00Z', ...e }); },
    async guardBusy() { return false; },
    now: () => Date.parse('2026-11-27T12:00:00Z'),
    lockFree: false,
    log() {},
    killed: 0,
    async lock() { return (fx as any).lockFree ? async () => {} : null; },
    async killWorkers() { (fx as any).killed++; return ['axion-workshop-M-1-a1']; },
    holds: true,
    holdsLock() { return (fx as any).holds; },
  } as unknown as RunnerEffects;
  return { fx, hist, isPaused: () => paused };
}

test('pause / resume / status: PAUSED written and removed, history lines, status text; usage errors exit 2', async () => {
  const f = fakeFx();
  const out: string[] = [];
  const deps = { env: { AXION_GUARD_ROOT: '/nonexistent-root' }, out: (s: string) => out.push(s), err: (s: string) => out.push(s), effects: () => f.fx, noSignals: true };
  assert.equal(await main(['pause', 'testing'], deps), 0);
  assert.match(f.isPaused()!, /paused by the owner at .*: testing/);
  assert.equal(await main(['status'], deps), 0);
  assert.match(out.join('\n'), /paused: YES/);
  assert.match(out.join('\n'), /changes today \(UTC\): 0 of 12/);
  assert.equal(await main(['resume'], deps), 0);
  assert.equal(f.isPaused(), null);
  assert.deepEqual(f.hist.map((h) => h.event), ['pause', 'resume']);
  assert.equal(await main(['run', '--inject-failure'], deps), 2);
  assert.equal(await main(['once'], deps), 4, 'the lock is held → busy');
  assert.match(out.at(-1)!, /"kind":"busy"/);
});

test('bin/axion-evolve runs the installed copy of cli.ts with node; the unit runs it as a restartable service that is never killed with the Guard', () => {
  const bin = readFileSync(new URL('../bin/axion-evolve', import.meta.url), 'utf8');
  assert.match(bin, /^exec node \/srv\/axion-evolve\/guard\/evolve\/runner\/cli\.ts "\$@"$/m);
  const unit = readFileSync(new URL('./axion-evolve.service', import.meta.url), 'utf8');
  for (const l of ['ExecStart=/usr/local/bin/axion-evolve run', 'Restart=on-failure', 'RestartSec=30', 'KillMode=process', 'WantedBy=multi-user.target',
    // the Guard started from the unit runs backup.sh, which needs /usr/sbin/runuser
    'Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']) {
    assert.ok(unit.split('\n').includes(l), l);
  }
});

test('sweep: skipped while a live runner holds the lock; otherwise removes the workers; the unit runs it after every stop', async () => {
  const f = fakeFx();
  const out: string[] = [];
  const deps = { env: { AXION_GUARD_ROOT: '/nonexistent-root' }, out: (s: string) => out.push(s), err: (s: string) => out.push(s), effects: () => f.fx, noSignals: true };
  assert.equal(await main(['sweep'], deps), 0);
  assert.match(out.at(-1)!, /holds runner\.lock; nothing removed/);
  assert.equal((f.fx as any).killed, 0);
  (f.fx as any).lockFree = true;
  assert.equal(await main(['sweep'], deps), 0);
  assert.match(out.at(-1)!, /removed axion-workshop-M-1-a1/);
  const unit = readFileSync(new URL('./axion-evolve.service', import.meta.url), 'utf8');
  assert.ok(unit.split('\n').includes('ExecStopPost=/usr/local/bin/axion-evolve sweep'));
});

test('a stop signal in once/approve/run removes the Workshop containers at once and stops after the step; a second one exits 130', async () => {
  for (const cmd of [['once'], ['approve', 'M-1'], ['run']]) {
    const f = fakeFx();
    const box: { h?: (sig: string) => void } = {};
    const exits: number[] = [];
    let stopping: (() => boolean) | null = null;
    const deps = { env: { AXION_GUARD_ROOT: '/nonexistent-root' }, out: () => {}, err: () => {}, onSignal: (h: (s: string) => void) => { box.h = h; },
      exit: (c: number) => { exits.push(c); },
      effects: (o: { stopping: () => boolean }) => { stopping = o.stopping; (f.fx as any).stopping = o.stopping; (f.fx as any).sleep = async () => {}; return f.fx; } };
    const p = main(cmd, deps);
    assert.ok(box.h, `${cmd[0]} installs a handler`);
    box.h!('SIGINT');
    assert.equal(stopping!(), true);
    await p;
    await new Promise((r) => setImmediate(r));
    assert.equal((f.fx as any).killed, 1, cmd[0]);
    box.h!('SIGINT');
    assert.deepEqual(exits, [130]);
  }
});

test('the stop handler removes containers only while this process holds runner.lock', async () => {
  const f = fakeFx();
  (f.fx as any).holds = false;
  const box: { h?: (sig: string) => void } = {};
  const msgs: string[] = [];
  await main(['once'], { env: { AXION_GUARD_ROOT: '/nonexistent-root' }, out: () => {}, err: (m: string) => msgs.push(m), onSignal: (h) => { box.h = h; }, exit: () => {}, effects: () => f.fx });
  box.h!('SIGTERM');
  await new Promise((r) => setImmediate(r));
  assert.equal((f.fx as any).killed, 0);
  assert.ok(msgs.some((m) => /not holding runner\.lock/.test(m)));
});
