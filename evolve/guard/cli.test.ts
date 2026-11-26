import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, UsageError, formatStatus, rollback, main } from './cli.ts';
import type { Effects, HistoryEntry, Slot } from './deploy.ts';
import { readState } from './state.ts';
import type { GuardState } from './state.ts';
import { fakeHost, health } from './testing.ts';

const SHA = 'b'.repeat(40);
const LIVE = 'a'.repeat(40);
const PREV = 'd'.repeat(40);
const IMG = 'bbbbbbbbbbbb-20261126T120000Z';
const LIVE_IMG = 'aaaaaaaaaaaa-20261125T100000Z';
const PREV_IMG = 'dddddddddddd-20261124T000000Z';

test('parseArgs: deploy with defaults and with every flag', () => {
  assert.deepEqual(parseArgs(['deploy', 'evolve/main']), {
    cmd: 'deploy', ref: 'evolve/main', watchS: 600, expectLeader: true, drainS: 5,
  });
  assert.deepEqual(parseArgs(['deploy', SHA, '--approve', SHA, '--approve-base', LIVE, '--watch', '120', '--front-port', '5290',
    '--database', 'axion_restore_check', '--no-expect-leader', '--drain', '0']), {
    cmd: 'deploy', ref: SHA, approve: SHA, approveBase: LIVE, watchS: 120, frontPort: 5290, database: 'axion_restore_check',
    expectLeader: false, drainS: 0,
  });
  assert.deepEqual(parseArgs(['status']), { cmd: 'status' });
  assert.deepEqual(parseArgs(['rollback']), { cmd: 'rollback' });
  assert.deepEqual(parseArgs(['revert']), { cmd: 'revert' });
  assert.deepEqual(parseArgs(['history']), { cmd: 'history', n: 20 });
  assert.deepEqual(parseArgs(['history', '5']), { cmd: 'history', n: 5 });
  assert.deepEqual(parseArgs(['front-port', '5291']), { cmd: 'front-port', port: 5291 });
  assert.deepEqual(parseArgs(['--help']), { cmd: 'help' });
  assert.deepEqual(parseArgs(['help']), { cmd: 'help' });
  assert.deepEqual(parseArgs([]), { cmd: 'help' });
});

test('parseArgs: refuses bad input with a usage error', () => {
  const bad: string[][] = [
    ['frobnicate'], ['deploy'], ['deploy', 'a', 'b'], ['deploy', '--watch', '10'], ['deploy', '-x'], ['deploy', 'main', '--wat', '1'],
    ['deploy', 'main', '--watch'], ['deploy', 'main', '--watch', '0'], ['deploy', 'main', '--watch', '1.5'], ['deploy', 'main', '--watch', 'abc'],
    ['deploy', 'main', '--front-port', '0'], ['deploy', 'main', '--front-port', '80'], ['deploy', 'main', '--front-port', '1023'],
    ['deploy', 'main', '--front-port', '70000'], ['front-port', '443'], ['deploy', 'main', '--database', 'x;y'],
    ['deploy', 'main', '--database', 'Axion-1'], ['deploy', 'main', '--approve', 'HEAD'], ['deploy', 'main', '--approve', SHA.toUpperCase()],
    ['deploy', 'main', '--approve-base', LIVE], ['deploy', 'main', '--drain', '-1'], ['deploy', 'main', '--drain', '601'],
    ['deploy', 'a..b'], ['deploy', 'main@{1}'], ['deploy', 'main', '--approve', SHA, '--approve', SHA],
    ['history', '0'], ['history', 'x'], ['history', '1', '2'], ['front-port'], ['front-port', 'abc'], ['status', 'extra'], ['rollback', '--force'], ['revert', 'abc'],
  ];
  for (const argv of bad) assert.throws(() => parseArgs(argv), UsageError, argv.join(' '));
});

const SAMPLE: GuardState = {
  active: 'green', activeImage: IMG, activeSha: SHA, previousImage: LIVE_IMG, previousSha: LIVE,
  frontPort: 5290, database: 'axion_restore_check',
};

test('status output from a sample state.json', () => {
  assert.equal(formatStatus(SAMPLE), [
    'active slot: green',
    `  image:    ${IMG}`,
    `  commit:   ${SHA}`,
    `previous:   ${LIVE_IMG} (commit ${LIVE})`,
    'front port: 5290',
    'database:   axion_restore_check',
    'no deploy in progress',
  ].join('\n'));
  assert.equal(formatStatus({ ...SAMPLE, previousImage: null, previousSha: null, deploying: { sha: SHA, step: 'switch', startedAt: '2026-11-26T12:00:00.000Z' } }), [
    'active slot: green',
    `  image:    ${IMG}`,
    `  commit:   ${SHA}`,
    'previous:   none',
    'front port: 5290',
    'database:   axion_restore_check',
    `UNFINISHED DEPLOY of ${SHA} at step switch (started 2026-11-26T12:00:00.000Z): run \`axion-guard rollback\``,
  ].join('\n'));
  assert.equal(formatStatus(null), 'no active slot\nfront port: 5290 (default)\ndatabase:   axion (default)\nno deploy in progress');
  assert.match(formatStatus({ active: 'blue', activeImage: null, activeSha: null, previousImage: null, previousSha: null, frontPort: 5299 }),
    /^no active slot\nfront port: 5299\n/);
});

function root(state: GuardState | null) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-cli-'));
  mkdirSync(join(dir, 'secrets'));
  writeFileSync(join(dir, 'secrets', 'live.env'), 'DATABASE_URL=postgresql:///axion?host=/var/run/postgresql&user=axion\n');
  if (state) writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  return dir;
}

function cli(dir: string, f: ReturnType<typeof fakeHost>) {
  const out: string[] = [];
  const err: string[] = [];
  const run = (argv: string[]) => main(argv, { env: { AXION_GUARD_ROOT: dir }, host: f.host, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { run, out, err };
}

test('main status prints the state.json summary; a missing state.json → "no active slot"', async () => {
  const dir = root(SAMPLE);
  const f = fakeHost();
  const c = cli(dir, f);
  assert.equal(await c.run(['status']), 0);
  assert.equal(c.out.join('\n'), formatStatus(SAMPLE));
  const c2 = cli(root(null), f);
  assert.equal(await c2.run(['status']), 0);
  assert.match(c2.out.join('\n'), /^no active slot/);
  assert.equal(f.calls.length, 0, 'status runs no command');
});

// ---- rollback, one test per row of the table in deploy.ts ----

function fakeFx(live = LIVE) {
  const calls: string[] = [];
  const history: HistoryEntry[] = [];
  const fx: Pick<Effects, 'switchTo' | 'stopSlot' | 'liveSha' | 'record'> = {
    switchTo: async (s: Slot) => { calls.push(`switchTo ${s}`); },
    stopSlot: async (s: Slot) => { calls.push(`stopSlot ${s}`); },
    liveSha: async () => { calls.push('liveSha'); return live; },
    record: async (e) => { history.push(e); },
  };
  return { fx, calls, history };
}

const BLUE_LIVE: GuardState = {
  active: 'blue', activeImage: LIVE_IMG, activeSha: LIVE, previousImage: PREV_IMG, previousSha: PREV, frontPort: 5290, database: 'axion',
};
const dep = (step: string) => ({ sha: SHA, step, startedAt: '2026-11-26T12:00:00.000Z' }) as GuardState['deploying'];
const AFTER_SWITCH: GuardState = {
  active: 'green', activeImage: IMG, activeSha: SHA, previousImage: LIVE_IMG, previousSha: LIVE, frontPort: 5290, database: 'axion',
};

test('rollback: nothing in progress → "nothing to do", no effect', async () => {
  const dir = root(BLUE_LIVE);
  const t = fakeFx();
  assert.match(await rollback(t.fx, dir), /nothing to do/);
  assert.deepEqual(t.calls, []);
  assert.deepEqual(t.history, []);
});

test('rollback before the switch (lock … drain): stop the candidate slot, clear deploying', async () => {
  for (const step of ['lock', 'build', 'start', 'smoke', 'drain']) {
    const dir = root({ ...BLUE_LIVE, deploying: dep(step) });
    const t = fakeFx();
    await rollback(t.fx, dir);
    assert.deepEqual(t.calls, ['stopSlot green'], step);
    assert.deepEqual(await readState(dir), BLUE_LIVE);
    assert.equal(t.history[0].event, 'outcome');
    assert.equal(t.history[0].outcome, 'rolled_back');
    assert.equal(t.history[0].failedStep, step);
  }
});

test('rollback at switch: back to the active slot, stop the other; first deploy: only stop the other', async () => {
  const dir = root({ ...BLUE_LIVE, deploying: dep('switch') });
  const t = fakeFx();
  await rollback(t.fx, dir);
  assert.deepEqual(t.calls, ['switchTo blue', 'stopSlot green']);
  assert.deepEqual(await readState(dir), BLUE_LIVE);
  const first: GuardState = { active: 'blue', activeImage: null, activeSha: null, previousImage: null, previousSha: null, frontPort: 5290 };
  const d2 = root({ ...first, deploying: dep('switch') });
  const t2 = fakeFx();
  await rollback(t2.fx, d2);
  assert.deepEqual(t2.calls, ['stopSlot green']);
  assert.deepEqual(await readState(d2), first);
});

test('rollback at watch: switch to the previous slot, stop the candidate, state flipped back', async () => {
  const dir = root({ ...AFTER_SWITCH, deploying: dep('watch') });
  const t = fakeFx();
  await rollback(t.fx, dir);
  assert.deepEqual(t.calls, ['switchTo blue', 'stopSlot green']);
  assert.deepEqual(await readState(dir), {
    active: 'blue', activeImage: LIVE_IMG, activeSha: LIVE, previousImage: null, previousSha: null, frontPort: 5290, database: 'axion',
    lastChecksPassed: null, previousChecksPassed: null,
  });
  // I6: the test-count floor goes back with the commit
  const d3 = root({ ...AFTER_SWITCH, lastChecksPassed: 4900, previousChecksPassed: 4836, deploying: dep('watch') });
  await rollback(fakeFx().fx, d3);
  assert.deepEqual([(await readState(d3))?.lastChecksPassed, (await readState(d3))?.previousChecksPassed], [4836, null]);
  // first deploy watched: nothing to switch back to
  const d2 = root({ ...AFTER_SWITCH, previousImage: null, previousSha: null, deploying: dep('watch') });
  const t2 = fakeFx();
  await rollback(t2.fx, d2);
  assert.deepEqual(t2.calls, ['stopSlot green']);
  assert.equal((await readState(d2))?.activeImage, null);
  assert.equal((await readState(d2))?.active, 'blue');
});

test('rollback at record: evolve/main already at the candidate → only clear deploying; otherwise as for watch', async () => {
  const dir = root({ ...AFTER_SWITCH, deploying: dep('record') });
  const t = fakeFx(SHA);
  assert.match(await rollback(t.fx, dir), /already live/);
  assert.deepEqual(t.calls, ['liveSha']);
  assert.deepEqual(await readState(dir), AFTER_SWITCH);
  assert.equal(t.history[0].outcome, 'live');
  assert.equal(t.history[0].failedStep, undefined);
  const d2 = root({ ...AFTER_SWITCH, deploying: dep('record') });
  const t2 = fakeFx(LIVE);
  await rollback(t2.fx, d2);
  assert.deepEqual(t2.calls, ['liveSha', 'switchTo blue', 'stopSlot green']);
  assert.equal((await readState(d2))?.active, 'blue');
});

test('rollback: a failing switch back keeps deploying for another try', async () => {
  const dir = root({ ...AFTER_SWITCH, deploying: dep('watch') });
  const t = fakeFx();
  t.fx.switchTo = async () => { throw new Error('front unreachable'); };
  await assert.rejects(rollback(t.fx, dir), /front unreachable/);
  assert.equal((await readState(dir))?.deploying?.step, 'watch');
});

test('main rollback twice: the first switches back through Docker, the second is a no-op', async () => {
  const dir = root({ ...AFTER_SWITCH, deploying: dep('watch') });
  const f = fakeHost();
  f.sim.add('axion-blue', { running: false, restart: 'no' });
  f.sim.add('axion-green', { running: true });
  f.sim.add('axion-front', { ports: '{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"5290"}]}' });
  f.sim.health.set('axion-blue', health({ commit: LIVE }));
  f.fetchAnswers.set('http://127.0.0.1:5290/api/v1/health', [health({ commit: LIVE, leader: true })]);
  const c = cli(dir, f);
  assert.equal(await c.run(['rollback']), 0, c.err.join('\n'));
  assert.equal(f.sim.ctrs.get('axion-blue')?.running, true);
  assert.equal(f.sim.ctrs.get('axion-green')?.running, false);
  assert.equal(f.sim.ctrs.get('axion-green')?.restart, 'no');
  assert.equal((await readState(dir))?.active, 'blue');
  assert.match(readFileSync(join(dir, 'front', 'default.conf'), 'utf8'), /server axion-blue:4190 resolve;/);
  const n = f.calls.length;
  assert.equal(await c.run(['rollback']), 0);
  assert.match(c.out.at(-1)!, /nothing to do/);
  assert.equal(f.calls.length, n, 'the second rollback runs no command');
  assert.ok(!existsSync(join(dir, 'guard.lock')), 'lock released');
  const hist = readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(hist.length, 1);
  assert.equal(hist[0].outcome, 'rolled_back');
});

test('main: a held lock → exit 4 (busy) before any command', async () => {
  const dir = root(BLUE_LIVE);
  writeFileSync(join(dir, 'guard.lock'), `${process.pid}\n`);
  const f = fakeHost();
  const c = cli(dir, f);
  for (const argv of [['deploy', 'evolve/main'], ['rollback'], ['front-port', '5291']]) {
    assert.equal(await c.run(argv), 4);
    assert.match(c.err.at(-1)!, /busy|already running/i);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(readFileSync(join(dir, 'guard.lock'), 'utf8').trim(), String(process.pid), 'someone else\'s lock is left alone');
});

test('main deploy: a protected change → exit 3 with the exact approval command; nothing built', async () => {
  const dir = root(null);
  const f = fakeHost((c) => {
    if (c.cmd !== 'git') return undefined;
    const a = c.args.slice(2).join(' ');
    if (a === 'rev-parse --verify evolve/main^{commit}') return { stdout: `${SHA}\n` };
    if (a === 'rev-parse --verify refs/heads/evolve/main^{commit}') return { stdout: `${LIVE}\n` };
    if (a === `diff --name-status -z -M ${LIVE} ${SHA}`) return { stdout: 'M\0evolve/guard/deploy.ts\0A\0web/src/x.ts\0' };
    return { code: 128, stderr: `fatal: unexpected ${a}` };
  });
  const c = cli(dir, f);
  assert.equal(await c.run(['deploy', 'evolve/main']), 3, c.err.join('\n'));
  const text = c.out.join('\n');
  assert.match(text, /needs_owner/);
  assert.match(text, /evolve\/guard\/deploy\.ts/);
  assert.ok(text.includes(`axion-guard deploy ${SHA} --approve ${SHA} --approve-base ${LIVE}`), text);
  assert.deepEqual(f.calls.filter((x) => x.cmd === 'docker').map((x) => x.args.join(' ')), [
    'ps -a --format {{.Names}}', 'network ls --format {{.Name}}', 'volume ls --format {{.Name}}',
    'image ls --format {{.Tag}} axion-app', 'image ls --format {{.Tag}} axion-checks', 'image ls --format {{.Tag}} axion-build',
  ], 'only the leftover sweep and the image retention (I7: after every outcome); nothing built');
  assert.ok(!existsSync(join(dir, 'guard.lock')));
  const st = await readState(dir);
  assert.equal(st?.pending, undefined, 'pending dropped after needs_owner');
  assert.equal(st?.frontPort, undefined, 'nothing promoted');
});

test('main deploy: --approve without --approve-base binds the approval to the live commit read now', async () => {
  const dir = root(null);
  let diffs = 0;
  const f = fakeHost((c) => {
    if (c.cmd !== 'git') return { code: 1, stderr: 'stop here' };
    const a = c.args.slice(2).join(' ');
    if (a === `rev-parse --verify ${SHA}^{commit}`) return { stdout: `${SHA}\n` };
    if (a === 'rev-parse --verify refs/heads/evolve/main^{commit}') return { stdout: `${LIVE}\n` };
    if (a.startsWith('diff')) { diffs++; return { stdout: 'M\0evolve/guard/deploy.ts\0' }; }
    if (a.startsWith('merge-base')) return { code: 0 };
    return { code: 1, stderr: 'stop here' };
  });
  const c = cli(dir, f);
  const code = await c.run(['deploy', SHA, '--approve', SHA]);
  assert.equal(diffs, 1);
  assert.match(c.out.join('\n'), new RegExp(`approval of ${SHA} bound to base ${LIVE}`));
  assert.equal(code, 1, 'got past the approval (stopped later at build)');
  assert.match(c.out.join('\n'), /rejected.*build/s);
});

test('main front-port: stores the port and moves the front of a live site', async () => {
  const dir = root(BLUE_LIVE);
  const f = fakeHost();
  f.sim.add('axion-blue', { running: true });
  f.sim.add('axion-front', { ports: '{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"5290"}]}' });
  f.sim.health.set('axion-blue', health({ commit: LIVE, leader: true }));
  f.fetchAnswers.set('http://127.0.0.1:5291/api/v1/health', [health({ commit: LIVE, leader: true })]);
  const c = cli(dir, f);
  assert.equal(await c.run(['front-port', '5291']), 0, c.err.join('\n'));
  assert.equal((await readState(dir))?.frontPort, 5291);
  assert.ok(f.lines().includes('docker rename axion-front axion-front-old'));
  assert.ok(!f.sim.ctrs.has('axion-front-old'), 'the old front is removed once the new one runs');
  assert.match(f.sim.ctrs.get('axion-front')!.ports!, /"HostPort":"5291"/);
  // nothing live: only stored
  const d2 = root(null);
  const g = fakeHost();
  const c2 = cli(d2, g);
  assert.equal(await c2.run(['front-port', '5299']), 0);
  assert.equal((await readState(d2))?.frontPort, 5299);
  assert.equal(g.calls.length, 0);
});

test('main history n prints the last n entries', async () => {
  const dir = root(null);
  const lines = [
    { at: '2026-11-26T12:00:00.000Z', sha: SHA, step: 'build', event: 'start' },
    { at: '2026-11-26T12:01:00.000Z', sha: SHA, step: 'build', event: 'end', ok: true, detail: IMG },
    { at: '2026-11-26T12:02:00.000Z', sha: SHA, step: 'checks', event: 'end', ok: false, detail: 'checks failed' },
    { at: '2026-11-26T12:02:01.000Z', sha: SHA, step: 'record', event: 'outcome', outcome: 'rejected', failedStep: 'checks', reason: 'checks failed' },
  ];
  writeFileSync(join(dir, 'history.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const c = cli(dir, fakeHost());
  assert.equal(await c.run(['history', '2']), 0);
  assert.deepEqual(c.out, [
    `2026-11-26T12:02:00.000Z bbbbbbbbbbbb checks end FAILED checks failed`,
    `2026-11-26T12:02:01.000Z bbbbbbbbbbbb record outcome rejected (failed at checks) checks failed`,
  ]);
  const c2 = cli(root(null), fakeHost());
  assert.equal(await c2.run(['history']), 0);
  assert.deepEqual(c2.out, ['no history yet']);
});

test('main: usage errors exit 2 with the usage text', async () => {
  const c = cli(root(null), fakeHost());
  assert.equal(await c.run(['deploy']), 2);
  assert.match(c.err.join('\n'), /usage: axion-guard/);
  assert.equal(await c.run(['help']), 0);
  assert.match(c.out.join('\n'), /axion-guard deploy <ref>/);
});

// ---- a whole deploy through main(), every effect on the fake host (wiring of CLI → core → adapters) ----

function deployHost(dir: string, watchAnswers: string[]) {
  let main = LIVE;
  const f = fakeHost((c) => {
    const a = c.args;
    if (c.cmd === 'id') return { stdout: a[0] === '-u' ? '998\n' : '997\n' };
    if (c.cmd === 'tar') return {};
    if (c.cmd.endsWith('/backup.sh')) return { stdout: `${dir}/backups/axion-1.dump\n` };
    if (c.cmd === 'git') {
      const g = a.slice(2).join(' ');
      if (g === 'rev-parse --verify evolve/main^{commit}' || g === `rev-parse --verify ${SHA}^{commit}`) return { stdout: `${SHA}\n` };
      if (g === 'rev-parse --verify refs/heads/evolve/main^{commit}') return { stdout: `${main}\n` };
      if (g === `diff --name-status -z -M ${LIVE} ${SHA}`) return { stdout: 'M\0web/src/pages/Home.tsx\0' };
      if (g === `merge-base --is-ancestor ${LIVE} ${SHA}`) return { code: 0 };
      if (g.startsWith('archive ')) return {};
      if (g === `ls-tree -r -z --name-only ${SHA}`) return { stdout: 'web/src/pages/Home.tsx\0' };
      if (g === `update-ref refs/heads/evolve/main ${SHA} ${LIVE}`) { main = SHA; return {}; }
      return { code: 128, stderr: `fatal: unexpected git ${g}` };
    }
    if (a[0] === 'run' && a.some((x) => x.startsWith('axion-checks:'))) {
      const out = a.find((x) => x.endsWith(':/out'))!.slice(0, -':/out'.length);
      writeFileSync(join(out, 'summary.json'), JSON.stringify({ passed: 4836, failed: 0, skipped: 36, seconds: 1, ok: true, steps: {} }));
      return { stdout: 'checks ok\n' };
    }
    if (a[0] === 'exec' && a[1].includes('-boot-') && a.at(-1)!.endsWith('/health')) return { stdout: health({ commit: SHA, leader: true }) };
    if (a[0] === 'logs') return { stdout: '' };
    return undefined;
  });
  f.sim.add('axion-blue', { running: true });
  f.sim.add('axion-front', { ports: '{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"5290"}]}' });
  f.sim.health.set('axion-blue', health({ commit: LIVE, leader: true }));
  f.sim.health.set('axion-green', health({ commit: SHA }));
  f.fetchAnswers.set('http://127.0.0.1:5291/api/v1/health', watchAnswers);
  mkdirSync(join(dir, 'repo.git', 'info'), { recursive: true });
  writeFileSync(join(dir, 'repo.git', 'info', 'attributes'), '* -export-ignore -export-subst\n');
  return f;
}

test('main deploy end to end (fake host): live on green, front moved to the new port, state.json keeps port and database', async () => {
  const dir = root(BLUE_LIVE);
  const f = deployHost(dir, [health({ commit: SHA, leader: true })]);
  let during = null as GuardState | null;
  const origRun = f.host.run;
  f.host.run = async (cmd, args, opts) => {
    if (cmd === 'git' && args[2] === 'diff') during = await readState(dir);
    return origRun(cmd, args, opts);
  };
  const c = cli(dir, f);
  assert.equal(await c.run(['deploy', 'evolve/main', '--front-port', '5291', '--watch', '20', '--drain', '1']), 0, c.err.join('\n') + c.out.join('\n'));
  const s = await readState(dir);
  assert.equal(s?.active, 'green');
  assert.equal(s?.activeSha, SHA);
  assert.equal(s?.previousImage, LIVE_IMG);
  assert.equal(s?.frontPort, 5291);
  assert.equal(s?.database, 'axion');
  assert.equal(s?.deploying, undefined);
  assert.equal(s?.pending, undefined, 'pending promoted and removed');
  assert.deepEqual(during?.pending, { frontPort: 5291, database: 'axion' }, 'pending on disk before the core ran');
  assert.equal(during?.frontPort, 5290, 'the stored port stays the old one while the deploy runs');
  assert.equal(f.sim.ctrs.get('axion-blue')?.running, false, 'old slot retired');
  assert.equal(f.sim.ctrs.get('axion-blue')?.restart, 'no');
  assert.equal(f.sim.ctrs.get('axion-green')?.restart, 'unless-stopped');
  assert.ok(f.lines().includes(`git --git-dir ${dir}/repo.git update-ref refs/heads/evolve/main ${SHA} ${LIVE}`));
  assert.ok(f.lines().includes('docker image ls --format {{.Tag}} axion-app'), 'image retention ran');
  assert.ok(!existsSync(join(dir, 'guard.lock')));
  const outcome = readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.equal(outcome.outcome, 'live');
});

test('main deploy end to end (fake host): a failing watch rolls back to blue; the front stays on the port it now listens on', async () => {
  const dir = root(BLUE_LIVE);
  const bad = health({ ok: false, commit: SHA, leader: true });
  const f = deployHost(dir, [health({ commit: SHA, leader: true }), bad, bad, bad, health({ commit: LIVE, leader: true })]);
  const c = cli(dir, f);
  assert.equal(await c.run(['deploy', 'evolve/main', '--front-port', '5291', '--watch', '60']), 1);
  assert.match(c.out.join('\n'), /rolled_back at watch/);
  const s = await readState(dir);
  assert.equal(s?.active, 'blue');
  assert.equal(s?.activeSha, LIVE);
  assert.equal(s?.frontPort, 5291, 'switchTo(blue) ran with the deploy\'s port, so state.json must say so');
  assert.equal(s?.pending, undefined);
  assert.equal(f.sim.ctrs.get('axion-blue')?.running, true);
  assert.equal(f.sim.ctrs.get('axion-green')?.running, false);
  assert.ok(!f.lines().some((l) => l.includes('update-ref')), 'evolve/main never moved');
  assert.ok(f.lines().includes('docker image ls --format {{.Tag}} axion-app'), 'I7: image retention after a rollback too');
});

test('main deploy: --database defaults to axion; without the flag it is refused while the live slot uses another database', async () => {
  const live = { ...BLUE_LIVE, database: 'axion_restore_check' };
  const dir = root(live);
  const f = fakeHost((c) => {
    if (c.cmd !== 'git') return undefined;
    const a = c.args.slice(2).join(' ');
    if (a === 'rev-parse --verify evolve/main^{commit}') return { stdout: `${SHA}\n` };
    if (a === 'rev-parse --verify refs/heads/evolve/main^{commit}') return { stdout: `${LIVE}\n` };
    if (a === `diff --name-status -z -M ${LIVE} ${SHA}`) return { stdout: 'M\0evolve/guard/deploy.ts\0' };
    return { code: 128, stderr: `fatal: unexpected ${a}` };
  });
  const c = cli(dir, f);
  assert.equal(await c.run(['deploy', 'evolve/main']), 1);
  assert.match(c.err.join('\n'), /live slot uses database axion_restore_check; pass --database explicitly/);
  assert.equal(f.calls.length, 0, 'refused before any command');
  assert.deepEqual(await readState(dir), live, 'state.json untouched');
  // with the flag it proceeds (here to needs_owner); moving to another database warns
  assert.equal(await c.run(['deploy', 'evolve/main', '--database', 'axion_restore_check']), 3, c.err.join('\n'));
  assert.equal(await c.run(['deploy', 'evolve/main', '--database', 'axion']), 3);
  assert.match(c.err.at(-1)!, /warning: the live slot uses database axion_restore_check, this deploy uses axion/);
  // a live slot on axion (the default): no flag needed
  const d2 = root(BLUE_LIVE);
  const c2 = cli(d2, f);
  assert.equal(await c2.run(['deploy', 'evolve/main']), 3, c2.err.join('\n'));
  assert.deepEqual(c2.err, []);
});

test('pending front port/database: shown by status, cleared by every rollback row, promoted by the "already live" row', async () => {
  const pending = { frontPort: 5291, database: 'axion_restore_check' };
  assert.match(formatStatus({ ...AFTER_SWITCH, pending, deploying: dep('watch') }),
    /pending \(deploy in progress\): front port 5291, database axion_restore_check\nUNFINISHED DEPLOY/);
  for (const [step, st] of [['build', BLUE_LIVE], ['switch', BLUE_LIVE], ['watch', AFTER_SWITCH]] as const) {
    const dir = root({ ...st, pending, deploying: dep(step) });
    await rollback(fakeFx().fx, dir);
    const after = await readState(dir);
    assert.equal(after?.pending, undefined, step);
    assert.equal(after?.frontPort, 5290, `${step}: the stored port stays`);
    assert.equal(after?.database, 'axion', `${step}: the stored database stays`);
  }
  const dir = root({ ...AFTER_SWITCH, pending, deploying: dep('record') });
  await rollback(fakeFx(SHA).fx, dir);
  assert.deepEqual(await readState(dir), { ...AFTER_SWITCH, frontPort: 5291, database: 'axion_restore_check' });
  // record, evolve/main not moved: back to blue, pending dropped
  const d2 = root({ ...AFTER_SWITCH, pending, deploying: dep('record') });
  await rollback(fakeFx(LIVE).fx, d2);
  const a2 = await readState(d2);
  assert.equal(a2?.pending, undefined);
  assert.equal(a2?.frontPort, 5290);
});

test('main deploy sweeps leftovers of a killed run under the lock before anything else', async () => {
  const dir = root(BLUE_LIVE);
  mkdirSync(join(dir, 'work', 'checks-abc'), { recursive: true });
  const f = deployHost(dir, [health({ commit: SHA, leader: true })]);
  const orig = f.host.run;
  f.host.run = async (cmd, args, opts) => {
    if (args.join(' ') === 'ps -a --format {{.Names}}') { f.calls.push({ cmd, args }); return { code: 0, stdout: 'axion-checks-0a1b2c3d-pg\naxion-blue\n', stderr: '' }; }
    return orig(cmd, args, opts);
  };
  const c = cli(dir, f);
  await c.run(['deploy', 'evolve/main', '--front-port', '5291', '--watch', '20']);
  const l = f.lines();
  assert.equal(l[0], 'docker ps -a --format {{.Names}}', 'the sweep runs first');
  assert.equal(l[1], 'docker rm -f -v axion-checks-0a1b2c3d-pg');
  assert.ok(l.indexOf('docker rm -f -v axion-checks-0a1b2c3d-pg') < l.findIndex((x) => x.startsWith('git ')));
  assert.match(c.out.join('\n'), /removed leftovers of an earlier run: axion-checks-0a1b2c3d-pg, .*work\/checks-abc/);
});

// ---- fix wave: revert (I5) and the rising test floor (I6) ----

const REVERTABLE: GuardState = {
  active: 'green', activeImage: IMG, activeSha: SHA, previousImage: LIVE_IMG, previousSha: LIVE, frontPort: 5290, database: 'axion',
  lastChecksPassed: 4900, previousChecksPassed: 4836,
};

/** a fake host after a deploy went live on green: blue retired (stopped) with the previous image; evolve/main at SHA */
function revertHost(dir: string, opts: { blueImage?: string; blueCommit?: string; casFails?: boolean } = {}) {
  let main = SHA;
  const f = fakeHost((c) => {
    const a = c.args;
    if (c.cmd === 'id') return { stdout: a[0] === '-u' ? '998\n' : '997\n' };
    if (c.cmd === 'git') {
      const g = a.slice(2).join(' ');
      if (g === 'rev-parse --verify refs/heads/evolve/main^{commit}') return { stdout: `${main}\n` };
      if (g === `update-ref refs/heads/evolve/main ${LIVE} ${SHA}`) {
        if (opts.casFails) return { code: 128, stderr: 'fatal: cannot lock ref' };
        main = LIVE; return {};
      }
      return { code: 128, stderr: `fatal: unexpected git ${g}` };
    }
    if (a[0] === 'logs') return { stdout: '' };
    return undefined;
  });
  f.sim.add('axion-green', { running: true, image: `axion-app:${IMG}` });
  f.sim.add('axion-blue', { running: false, restart: 'no', image: opts.blueImage ?? `axion-app:${LIVE_IMG}` });
  f.sim.add('axion-front', { ports: '{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"5290"}]}' });
  f.sim.health.set('axion-green', health({ commit: SHA, leader: true }));
  f.sim.health.set('axion-blue', health({ commit: opts.blueCommit ?? LIVE, leader: true }));
  f.fetchAnswers.set('http://127.0.0.1:5290/api/v1/health', [health({ commit: LIVE, leader: true })]);
  return { f, main: () => main };
}

const historyOf = (dir: string) => readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as HistoryEntry);

test('revert: the previous slot is started again and served, evolve/main moved back by CAS, previous cleared; a second revert has nothing to do', async () => {
  const dir = root(REVERTABLE);
  const { f, main: ref } = revertHost(dir);
  const c = cli(dir, f);
  assert.equal(await c.run(['revert']), 0, c.err.join('\n'));
  assert.match(c.out.join('\n'), /reverted: blue serves a{40} .*green \(b{40}\) is stopped; evolve\/main moved back/);
  const l = f.lines();
  const at = (x: string) => { const i = l.indexOf(x); assert.ok(i >= 0, `missing ${x}`); return i; };
  // the stopped previous slot holds the previous image: restarted, healthy with the previous commit, front switched, green retired
  assert.ok(at('docker container inspect --format {{.Config.Image}} axion-blue') < at('docker start axion-blue'));
  assert.ok(at('docker start axion-blue') < at('docker exec axion-front nginx -s reload'));
  assert.ok(at('docker exec axion-front nginx -s reload') < at('docker stop -t 30 axion-green'));
  assert.ok(at('docker stop -t 30 axion-green') < at(`git --git-dir ${dir}/repo.git update-ref refs/heads/evolve/main ${LIVE} ${SHA}`));
  assert.equal(f.find('docker run').length, 0, 'no new container: the retired slot is reused');
  assert.equal(ref(), LIVE);
  assert.equal(f.sim.ctrs.get('axion-blue')?.running, true);
  assert.equal(f.sim.ctrs.get('axion-blue')?.restart, 'unless-stopped');
  assert.equal(f.sim.ctrs.get('axion-green')?.running, false);
  assert.equal(f.sim.ctrs.get('axion-green')?.restart, 'no');
  assert.deepEqual(await readState(dir), {
    active: 'blue', activeImage: LIVE_IMG, activeSha: LIVE, previousImage: null, previousSha: null, frontPort: 5290, database: 'axion',
    lastChecksPassed: 4836, previousChecksPassed: null,
  });
  const h = historyOf(dir);
  assert.deepEqual(h.map((e) => `${e.step}:${e.event}:${e.outcome ?? ''}`), ['switch:start:', 'record:outcome:reverted']);
  assert.ok(h.every((e) => e.sha === LIVE));
  assert.ok(!existsSync(join(dir, 'guard.lock')));
  // safe to run twice
  const before = f.calls.length;
  const c2 = cli(dir, f);
  assert.equal(await c2.run(['revert']), 0);
  assert.match(c2.out.join('\n'), /nothing to revert/);
  assert.equal(f.calls.length, before, 'nothing ran');
});

test('revert: when the idle slot holds another image (a later rejected candidate), the previous image is started there first', async () => {
  const dir = root(REVERTABLE);
  const { f } = revertHost(dir, { blueImage: `axion-app:${PREV_IMG}` });
  const c = cli(dir, f);
  assert.equal(await c.run(['revert']), 0, c.err.join('\n'));
  const run = f.find('docker run');
  assert.equal(run.length, 1);
  assert.ok(run[0].args.includes(`axion-app:${LIVE_IMG}`) && run[0].args.includes('axion-blue'), run[0].args.join(' '));
  const l = f.lines();
  const rmAt = l.indexOf('docker rm axion-blue');
  assert.ok(rmAt >= 0 && rmAt < l.indexOf(['docker', ...run[0].args].join(' ')), 'the stopped container with the other image is replaced');
  assert.equal((await readState(dir))?.activeImage, LIVE_IMG);
});

test('revert refuses: an unfinished deploy, nothing live, evolve/main not at the live commit; nothing changes', async () => {
  const cases: [GuardState | null, RegExp, string?][] = [
    [{ ...REVERTABLE, deploying: { sha: PREV, step: 'build', startedAt: '2026-11-26T12:00:00.000Z' } }, /unfinished deploy .*axion-guard rollback/],
    [null, /nothing is live/],
    [{ ...REVERTABLE, activeSha: PREV }, /evolve\/main is at b{40}, state.json says the live commit is d{40}/],
  ];
  for (const [st, re] of cases) {
    const dir = root(st);
    const { f } = revertHost(dir);
    const c = cli(dir, f);
    assert.equal(await c.run(['revert']), 1);
    assert.match(c.err.join('\n'), re);
    assert.equal(f.calls.filter((x) => x.cmd === 'docker' || x.args.includes('update-ref')).length, 0);
    assert.deepEqual(await readState(dir), st);
  }
  // no previous kept (first deploy, or already reverted/rolled back): nothing to revert, exit 0
  const dir = root({ ...REVERTABLE, previousImage: null, previousSha: null });
  const c = cli(dir, revertHost(dir).f);
  assert.equal(await c.run(['revert']), 0);
  assert.match(c.out.join('\n'), /nothing to revert/);
});

test('revert: the previous slot reporting another commit is never routed to; the front stays on the live slot', async () => {
  const dir = root(REVERTABLE);
  const { f, main: ref } = revertHost(dir, { blueCommit: PREV });
  // the front keeps serving green's commit (blue is never routed to)
  f.fetchAnswers.set('http://127.0.0.1:5290/api/v1/health', [health({ commit: SHA, leader: true })]);
  const c = cli(dir, f);
  assert.equal(await c.run(['revert']), 1);
  assert.match(c.err.join('\n'), /revert failed \(cannot switch to axion-blue: it reports commit d{40}, expected a{40}\); rolled back/);
  assert.equal(ref(), SHA, 'evolve/main unchanged');
  assert.equal(f.sim.ctrs.get('axion-green')?.running, true, 'green keeps serving');
  assert.equal(f.sim.ctrs.get('axion-blue')?.running, false, 'blue stopped again');
  const s = await readState(dir);
  assert.deepEqual(s, { ...REVERTABLE }, 'state as before, no marker');
});

test('revert: a failed compare-and-swap of evolve/main switches back to the live slot (rollback table, step record)', async () => {
  const dir = root(REVERTABLE);
  const { f, main: ref } = revertHost(dir, { casFails: true });
  f.fetchAnswers.set('http://127.0.0.1:5290/api/v1/health', [health({ commit: LIVE, leader: true }), health({ commit: SHA, leader: true })]);
  const c = cli(dir, f);
  assert.equal(await c.run(['revert']), 1);
  assert.match(c.err.join('\n'), /cannot lock ref/);
  assert.equal(ref(), SHA);
  assert.equal(f.sim.ctrs.get('axion-green')?.running, true);
  assert.equal(f.sim.ctrs.get('axion-blue')?.running, false);
  const s = await readState(dir);
  assert.equal(s?.deploying, undefined);
  assert.deepEqual([s?.active, s?.activeImage, s?.activeSha, s?.lastChecksPassed], ['green', IMG, SHA, 4900]);
});

test('deploy (I6): the test floor is the larger of baseline.json and the live commit\'s passed count', async () => {
  const { checksFloor } = await import('./cli.ts');
  assert.equal(checksFloor(4836, null), 4836);
  assert.equal(checksFloor(4836, { ...REVERTABLE, lastChecksPassed: 4900 }), 4900);
  assert.equal(checksFloor(4836, { ...REVERTABLE, lastChecksPassed: 100 }), 4836);
  assert.equal(checksFloor(4836, { ...REVERTABLE, lastChecksPassed: null }), 4836);
  // end to end: a candidate passing 4836 tests is rejected when the live commit passed 4900
  const dir = root({ ...BLUE_LIVE, lastChecksPassed: 4900 });
  const f = deployHost(dir, [health({ commit: SHA, leader: true })]);
  const c = cli(dir, f);
  assert.equal(await c.run(['deploy', 'evolve/main']), 1);
  assert.match(c.out.join('\n'), /test floor 4900 \(live commit's checks; baseline 4836\)/);
  assert.match(c.out.join('\n'), /rejected at checks: passed tests 4836 below the baseline 4900/);
});
