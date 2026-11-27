// The runner's real effects (effects.ts) against a temporary root: real git (bare repo, scratch object dir, the commit
// built from an exported tree), a fake `docker` (a recording Proc), a fake axion-guard script. No real Docker, no /srv.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, chmodSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { injectFailurePatch, makeEffects, parseGuardResult, parseEnvValues, realProc, TYPECHECK_SCRIPT } from './effects.ts';
import type { Proc } from './effects.ts';
import { runnerPaths, CAPS, HISTORY_KEEP } from './config.ts';
import { classify } from '../guard/classify.ts';
import { gates, loadRules } from './gates.ts';

const isRoot = process.getuid?.() === 0;
const SECRET = ['sk', 'ant', 'oat01', randomBytes(24).toString('base64url')].join('-');

function git(gitDir: string, args: string[], input?: string) {
  const r = spawnSync('git', ['--git-dir', gitDir, ...args], { encoding: 'utf8', input, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', HOME: '/nonexistent', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** a root with repo.git holding evolve/main = one commit (web/src/a.ts, .gitignore ignoring *.log), state.json, secrets */
function world(o: { proc?: Proc; guardBin?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'evolve-runner-'));
  const repo = join(root, 'repo.git');
  git(repo, ['init', '-q', '--bare']);
  mkdirSync(join(repo, 'info'), { recursive: true });
  writeFileSync(join(repo, 'info', 'attributes'), '* -export-ignore -export-subst\n');
  const src = join(root, 'src');
  mkdirSync(join(src, 'web', 'src'), { recursive: true });
  writeFileSync(join(src, 'web', 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(src, '.gitignore'), '*.log\n');
  const env = { ...process.env, GIT_DIR: repo, GIT_WORK_TREE: src, GIT_INDEX_FILE: join(root, 'idx'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const a of [['add', '-A'], ['commit', '-q', '-m', 'base']]) {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['update-ref', 'refs/heads/evolve/main', base]);
  mkdirSync(join(root, 'secrets'), { mode: 0o700 });
  writeFileSync(join(root, 'secrets', 'workshop.env'), `CLAUDE_CODE_OAUTH_TOKEN=${SECRET}\n`, { mode: 0o600 });
  writeFileSync(join(root, 'secrets', 'live.env'), '# comment\nSHORT=abc\nPASSWORD="quoted-value-123456"\nEMPTY=\n'
    + 'DATABASE_URL=postgresql:///axion?host=/var/run/postgresql&user=axion\nAUDIT_ANCHOR_DOMAIN=anchors.example.invalid\nCHAT_MODEL=claude-opus-5-5\n'
    + 'SESSION_SECRET=session-value-0123456789\n', { mode: 0o600 });
  writeFileSync(join(root, 'state.json'), JSON.stringify({ active: 'blue', activeImage: 'abc123-20261127T000000Z', activeSha: base, previousImage: null, previousSha: null, database: 'axion' }));
  mkdirSync(join(root, 'guard'), { recursive: true });
  writeFileSync(join(root, 'guard', 'INSTALLED_COMMIT'), `${'a1b2c3d4e5f6'.padEnd(40, '0')}\n`);
  const paths = runnerPaths({ AXION_GUARD_ROOT: root });
  const logs: string[] = [];
  const fx = makeEffects({ paths, proc: o.proc, guardBin: o.guardBin, log: (m) => logs.push(m), uidGid: '999:999', workerIds: '64999:64998' });
  return { root, repo, base, paths, fx, logs };
}

/** a Proc that records docker calls and answers them from `answer`; everything else runs for real */
function dockerFake(answer: (args: string[], input: string) => { code: number; stdout?: string; stderr?: string }) {
  const calls: { args: string[]; input: string }[] = [];
  const proc: Proc = async (cmd, args, o = {}) => {
    if (cmd !== 'docker') return realProc(cmd, args, o);
    calls.push({ args, input: o.input ?? '' });
    const a = answer(args, o.input ?? '');
    return { code: a.code, stdout: a.stdout ?? '', stderr: a.stderr ?? '', truncated: false };
  };
  return { proc, calls };
}

test('exportTree: git archive of the base into <changes>/<id>/a<n>/tree, owned by the worker uid (axion-ws), no .git', { skip: !isRoot && 'needs root (chown)' }, async () => {
  const w = world();
  const dir = await w.fx.exportTree('M-1', 1, w.base);
  assert.equal(dir, join(w.paths.changes, 'M-1', 'a1'));
  assert.equal(readFileSync(join(dir, 'tree', 'web', 'src', 'a.ts'), 'utf8'), 'export const a = 1;\n');
  assert.equal(statSync(join(dir, 'tree', 'web', 'src', 'a.ts')).uid, 64999);
  assert.equal(statSync(join(dir, 'tree')).uid, 64999);
  assert.equal(statSync(join(dir, 'tree')).gid, 64998);
  assert.ok(!existsSync(join(dir, 'tree', '.git')));
  assert.ok(!existsSync(join(dir, 'tree.tar')));
  assert.equal(statSync(w.paths.changes).mode & 0o777, 0o700);
});

test('commit: built from the tree in a scratch object dir (repo.git untouched until import), parent = base, AXION engineer; null when unchanged', { skip: !isRoot && 'needs root (chown)' }, async () => {
  const w = world();
  const dir = await w.fx.exportTree('M-1', 1, w.base);
  assert.equal(await w.fx.commit({ changeDir: dir, parent: w.base, message: 'nothing' }), null, 'no change → null');
  writeFileSync(join(dir, 'tree', 'web', 'src', 'a.ts'), 'export const a = 2;\n');
  writeFileSync(join(dir, 'tree', 'web', 'debug.log'), 'ignored by .gitignore, still committed (exact tree)\n');
  const sha = (await w.fx.commit({ changeDir: dir, parent: w.base, message: 'evolve(M-1): a\n' }))!;
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.throws(() => git(w.repo, ['cat-file', '-e', `${sha}^{commit}`]), 'not in repo.git before the import');
  const d = await w.fx.diff(dir, w.base, sha);
  assert.match(d.text, /^\+export const a = 2;$/m);
  assert.deepEqual(d.files.map((f) => `${f.status} ${f.path}`).sort(), ['A web/debug.log', 'M web/src/a.ts']);
  assert.match(d.stat, /a\.ts/);
  await w.fx.importObjects(dir, w.base, sha);
  assert.equal(git(w.repo, ['rev-parse', `${sha}^`]), w.base);
  assert.equal(git(w.repo, ['log', '-1', '--format=%an <%ae>', sha]), 'AXION engineer <engineer@axion.invalid>');
  assert.equal(git(w.repo, ['log', '-1', '--format=%s', sha]), 'evolve(M-1): a');
  await w.fx.setRef('incoming/evolve-M-1-a1', sha);
  assert.equal(await w.fx.resolveRef('incoming/evolve-M-1-a1'), sha);
  await w.fx.deleteRef('incoming/evolve-M-1-a1');
  assert.equal(await w.fx.resolveRef('incoming/evolve-M-1-a1'), null);
  await assert.rejects(w.fx.setRef('evolve/main', sha), /incoming\/evolve-/);
});

test('a secret written by the engineer never reaches repo.git: the scratch objects go with the change', { skip: !isRoot && 'needs root (chown)' }, async () => {
  const w = world();
  const dir = await w.fx.exportTree('M-2', 1, w.base);
  writeFileSync(join(dir, 'tree', 'web', 'src', 'a.ts'), `export const t = "${SECRET}";\n`);
  const sha = (await w.fx.commit({ changeDir: dir, parent: w.base, message: 'x' }))!;
  const blob = spawnSync('git', ['hash-object', '--stdin'], { input: `export const t = "${SECRET}";\n`, encoding: 'utf8' }).stdout.trim();
  assert.ok(readdirSync(join(dir, 'objects')).length > 0);
  await w.fx.removeChange('M-2');
  assert.ok(!existsSync(join(w.paths.changes, 'M-2')));
  for (const o of [sha, blob]) assert.throws(() => git(w.repo, ['cat-file', '-e', o]), `${o} must not be in repo.git`);
  const all = spawnSync('grep', ['-rlF', SECRET, w.repo], { encoding: 'utf8' });
  assert.equal(all.stdout, '', 'no file under repo.git holds the value');
});

test('diff: a diff over the cap is refused (fail closed, never gated in part)', { skip: !isRoot && 'needs root (chown)' }, async () => {
  const w = world();
  const fx = makeEffects({ paths: w.paths, log: () => {}, uidGid: '999:999', workerIds: '64999:64998', maxDiffBytes: 2000 });
  const dir = await fx.exportTree('M-3', 1, w.base);
  writeFileSync(join(dir, 'tree', 'web', 'src', 'big.ts'), 'x'.repeat(5000) + '\n');
  const sha = (await fx.commit({ changeDir: dir, parent: w.base, message: 'x' }))!;
  await assert.rejects(fx.diff(dir, w.base, sha), /larger than/);
});

test('injectFailurePatch: the anchor is in today\'s server/src/app.ts exactly once; the patch touches no protected path and raises no flag', () => {
  const app = readFileSync(new URL('../../server/src/app.ts', import.meta.url), 'utf8');
  const patched = injectFailurePatch(app);
  assert.notEqual(patched, app);
  assert.match(patched, /addHook\('onRequest'/);
  assert.match(patched, /leaderMode/);
  assert.match(patched, /isLeader\(\)/);
  assert.match(patched, /503/);
  assert.throws(() => injectFailurePatch('const x = 1;\n'), /anchor/);
  assert.throws(() => injectFailurePatch(app + app), /anchor/);
  assert.deepEqual(classify([{ path: 'server/src/app.ts', status: 'M' }], loadRules()).hits, []);
  const added = patched.split('\n').filter((l) => !app.split('\n').includes(l));
  const diff = ['diff --git a/server/src/app.ts b/server/src/app.ts', '--- a/server/src/app.ts', '+++ b/server/src/app.ts', `@@ -1,1 +1,${added.length} @@`, ...added.map((l) => `+${l}`), ''].join('\n');
  const g = gates({ diff, files: [{ path: 'server/src/app.ts', status: 'M' }], secrets: [SECRET], report: '', message: 'evolve: injected failure' });
  assert.deepEqual(g, { protectedHits: [], secretHits: [], flags: [] });
});

test('injectFailure: a commit on the engineer\'s commit that changes server/src/app.ts only', { skip: !isRoot && 'needs root (chown)' }, async () => {
  const w = world();
  const dir = await w.fx.exportTree('M-4', 1, w.base);
  mkdirSync(join(dir, 'tree', 'server', 'src'), { recursive: true });
  writeFileSync(join(dir, 'tree', 'server', 'src', 'app.ts'), readFileSync(new URL('../../server/src/app.ts', import.meta.url), 'utf8'));
  const eng = (await w.fx.commit({ changeDir: dir, parent: w.base, message: 'eng' }))!;
  const inj = await w.fx.injectFailure({ changeDir: dir, parent: eng });
  const d = await w.fx.diff(dir, eng, inj);
  assert.deepEqual(d.files, [{ path: 'server/src/app.ts', status: 'M' }]);
  await w.fx.importObjects(dir, w.base, inj);
  assert.equal(git(w.repo, ['rev-parse', `${inj}^`]), eng);
});

test('secrets (R28): values of 12+ characters of TOKEN/KEY/SECRET/PASS/PWD/CREDENTIAL/COOKIE/SESSION keys only, quotes stripped', async () => {
  const w = world();
  const s = await w.fx.secrets();
  assert.deepEqual(s.sort(), [SECRET, 'quoted-value-123456', 'session-value-0123456789'].sort());
  for (const not of ['postgresql:///axion?host=/var/run/postgresql&user=axion', 'anchors.example.invalid', 'claude-opus-5-5', 'abc']) assert.ok(!s.includes(not), not);
  assert.deepEqual(parseEnvValues("# x\nA_KEY='single-quoted-value'\nB_TOKEN=short\n export C_PWD=exported-value-xyz\nURL=https://not-a-secret.example\nDB_PASSWORD=pw-value-0123456\nx_cookie_name=cookie-value-12345\n"),
    ['single-quoted-value', 'exported-value-xyz', 'pw-value-0123456', 'cookie-value-12345']);
});

test('the Workshop runs get the caps of config.ts (CAPS.engineerMs / CAPS.reviewerMs), the guard-commit image and the secrets', { skip: !isRoot && 'needs root (chown)' }, async () => {
  const sleeps: number[] = [];
  const runs: string[][] = [];
  const exec = {
    async run(_c: string, args: string[]) { runs.push(args); return { code: 1, stdout: '', stderr: 'no daemon' }; },
    async sleep(ms: number, signal?: AbortSignal) { sleeps.push(ms); if (ms > 60_000) await new Promise<void>((r) => { if (signal?.aborted) r(); else signal?.addEventListener('abort', () => r(), { once: true }); }); },
  };
  const w = world();
  const fx = makeEffects({ paths: w.paths, exec, log: () => {}, uidGid: '999:999', workerIds: '64999:64998' });
  const dir = await fx.exportTree('M-8', 1, w.base);
  await fx.engineer({ changeDir: dir, mission: { id: 'M-8', title: 't', text: 'x', criteria: [] }, attempt: 1 });
  await fx.reviewer({ mission: { id: 'M-8', title: 't', text: 'x', criteria: [] }, diff: 'd', attempt: 1 });
  assert.ok(sleeps.includes(CAPS.engineerMs), String(sleeps));
  assert.ok(sleeps.includes(CAPS.reviewerMs), String(sleeps));
  const run = runs.find((a) => a[0] === 'run')!;
  assert.ok(run.includes('axion-workshop:a1b2c3d4e5f6'));
  assert.equal(run[run.indexOf('--env-file') + 1], w.paths.workshopEnv);
  assert.equal(run[run.indexOf('--user') + 1], '64999:64998', 'R31: the worker uid, never 1000');
});

test('mission CLI: the exact docker argv (live image from state.json, DB socket, -w /app/server, tsx), stdin for progress; refusals and failures', async () => {
  const answers: Record<string, { code: number; stdout: string }> = {
    halted: { code: 0, stdout: '{"halted":false}\n' },
    next: { code: 0, stdout: '{"mission":{"id":"M-9","title":"t","text":"x","criteria":["c"],"owner":"Luca"}}\n' },
    progress: { code: 1, stdout: '{"error":"mission_not_running","status":"paused"}\n' },
    finish: { code: 2, stdout: '{"error":"bad_input","detail":"x"}\n' },
    recover: { code: 0, stdout: '{"recovered":["M-1"]}\n' },
  };
  const f = dockerFake((args) => answers[args[args.indexOf('src/cli/evolve-missions.ts') + 1]] ?? { code: 1, stdout: '' });
  const w = world({ proc: f.proc });
  assert.deepEqual(await w.fx.missions.halted(), { halted: false });
  const a = f.calls[0].args;
  const name = a[a.indexOf('--name') + 1];
  assert.match(name, /^axion-evolve-cli-[0-9a-f]{8}$/);
  assert.deepEqual(a, ['run', '--rm', '-i', '--name', name, '--network', 'none', '--user', '999:999', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3',
    '-v', '/var/run/postgresql:/var/run/postgresql', '-e', 'DATABASE_URL=postgresql:///axion?host=/var/run/postgresql&user=axion',
    '-w', '/app/server', 'axion-app:abc123-20261127T000000Z', 'node', '--import', 'tsx', 'src/cli/evolve-missions.ts', 'halted']);
  assert.deepEqual(await w.fx.missions.next(), { id: 'M-9', title: 't', text: 'x', criteria: ['c'], owner: 'Luca' });
  const body = { by: 'gm', text: 'hi', evolve: { state: 'working' as const } };
  assert.deepEqual(await w.fx.missions.progress('M-9', body), { ok: false, refusal: { error: 'mission_not_running', status: 'paused' } });
  const p = f.calls.at(-1)!;
  assert.deepEqual(p.args.slice(-2), ['progress', 'M-9']);
  assert.deepEqual(JSON.parse(p.input), body);
  await assert.rejects(w.fx.missions.finish('M-9', { outcome: 'failed', text: 'x', evolve: {} }), /exit 2/);
  assert.deepEqual(await w.fx.missions.recover(), ['M-1']);
  // fail closed: a failing halt check is a halt
  answers.halted = { code: 1, stdout: '{"error":"failed","code":"ECONNREFUSED"}\n' };
  assert.equal((await w.fx.missions.halted()).halted, true);
  answers.halted = { code: 0, stdout: 'garbage\n' };
  assert.equal((await w.fx.missions.halted()).halted, true);
  for (const c of f.calls) assert.ok(!JSON.stringify(c.args).includes(SECRET));
});

test('mission CLI: no live image in state.json → an error, nothing run', async () => {
  const f = dockerFake(() => ({ code: 0, stdout: '{}' }));
  const w = world({ proc: f.proc });
  writeFileSync(join(w.root, 'state.json'), JSON.stringify({ active: 'blue', activeImage: null, activeSha: null, previousImage: null }));
  await assert.rejects(w.fx.missions.next(), /live image/);
  assert.equal((await w.fx.missions.halted()).halted, true);
  assert.equal(f.calls.length, 0);
});

test('typecheck: the exported commit read-only at /cand in a no-network read-only container of the live image; tsc via node, never npm/npx, never over /app', { skip: !isRoot && 'needs root (chown)' }, async () => {
  const f = dockerFake((args) => (args[0] === 'run'
    ? { code: 2, stdout: '== server\nsrc/x.ts(1,1): error TS2322: nope\nAXION-TC server=2 web=0\n' }
    : { code: 0 }));
  const w = world({ proc: f.proc });
  const r = await w.fx.typecheck({ changeDir: join(w.paths.changes, 'M-5', 'a1'), sha: w.base, name: 'M-5-a1' });
  assert.equal(r.ok, false);
  assert.match(r.log, /TS2322/);
  const run = f.calls.find((c) => c.args[0] === 'run')!.args;
  for (const flag of ['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--user', '64999:64998']) assert.ok(run.includes(flag), flag);
  assert.ok(!run.includes('1000:1000'));
  const v = run[run.indexOf('-v') + 1];
  assert.equal(v, `${join(w.paths.changes, 'M-5', 'a1', 'check')}:/cand:ro`);
  assert.equal(run.filter((x) => x === '-v').length, 1, 'one mount only');
  assert.ok(!run.some((x) => /:\/app(\/|:|$)/.test(x)), 'nothing mounted over /app');
  assert.ok(run.includes('axion-app:abc123-20261127T000000Z'));
  assert.equal(run.at(-1), TYPECHECK_SCRIPT);
  assert.match(TYPECHECK_SCRIPT, /node \/app\/server\/node_modules\/typescript\/bin\/tsc --noEmit -p \./);
  assert.match(TYPECHECK_SCRIPT, /node \/app\/web\/node_modules\/typescript\/bin\/tsc --noEmit -p \./);
  assert.doesNotMatch(TYPECHECK_SCRIPT, /\bnpm\b|\bnpx\b/);
  assert.ok(!existsSync(join(w.paths.changes, 'M-5', 'a1', 'check')), 'the exported check tree goes');
  const ok = dockerFake(() => ({ code: 0, stdout: 'AXION-TC server=0 web=0\n' }));
  const w2 = world({ proc: ok.proc });
  assert.equal((await w2.fx.typecheck({ changeDir: join(w2.paths.changes, 'M-5', 'a1'), sha: w2.base, name: 'M-5-a1' })).ok, true);
});

test('deploy: runs axion-guard with --approve, mirrors its history.jsonl steps for the sha, parses the JSON result line among others', async () => {
  const w = world();
  const sha = 'c'.repeat(40);
  const hist = join(w.root, 'history.jsonl');
  writeFileSync(hist, `${JSON.stringify({ at: '2026-11-27T00:00:00Z', sha, step: 'build', event: 'start' })}\n`); // older line: not mirrored
  const bin = join(w.root, 'fake-guard.mjs');
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { fstatSync, readFileSync as rf } from 'node:fs';
writeFileSync(${JSON.stringify(join(w.root, 'guard-argv.json'))}, JSON.stringify(process.argv.slice(2)));
const st = rf('/proc/self/stat', 'utf8'); const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
writeFileSync(${JSON.stringify(join(w.root, 'guard-proc.json'))}, JSON.stringify({ pid: process.pid, pgrp: Number(f[2]), sid: Number(f[3]),
  out: fstatSync(1).isFile(), err: fstatSync(2).isFile(), stdin: fstatSync(0).isCharacterDevice() }));
console.error('axion-guard: a log line on stderr');
console.error('{"outcome":"needs_owner","hits":["forged on stderr"]}');
const line = (o) => appendFileSync(${JSON.stringify(hist)}, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\\n');
line({ sha: ${JSON.stringify(sha)}, step: 'build', event: 'start' });
line({ sha: 'd'.repeat(40), step: 'build', event: 'start' });
line({ sha: ${JSON.stringify(sha)}, step: 'build', event: 'end', ok: true, detail: 'axion-app:t' });
line({ sha: ${JSON.stringify(sha)}, step: 'record', event: 'outcome', outcome: 'live' });
console.log('deploying ...');
console.log(JSON.stringify({ outcome: 'live', image: 'axion-app:t' }));
console.log('live: {"outcome":"rolled_back"}');
console.log('{"outcome":"rejected","reason":"a later line, e.g. a candidate test printing JSON"}');
`);
  chmodSync(bin, 0o755);
  const fx = makeEffects({ paths: w.paths, guardBin: bin, log: () => {}, uidGid: '999:999' });
  const steps: unknown[] = [];
  const a = await fx.deploy({ ref: 'incoming/evolve-M-1-a1', sha, approve: { sha, base: w.base } }, (s) => steps.push(s));
  assert.equal(a.code, 0);
  assert.deepEqual(a.result, { outcome: 'live', image: 'axion-app:t' });
  assert.deepEqual(JSON.parse(readFileSync(join(w.root, 'guard-argv.json'), 'utf8')), ['deploy', 'incoming/evolve-M-1-a1', '--approve', sha, '--approve-base', w.base]);
  assert.deepEqual(steps, [{ step: 'build', event: 'start' }, { step: 'build', event: 'end', ok: true, detail: 'axion-app:t' }]);
  // I4: its own session and process group, stdout/stderr into a file (no pipe), stdin /dev/null; the file goes afterwards
  const p = JSON.parse(readFileSync(join(w.root, 'guard-proc.json'), 'utf8'));
  const me = readFileSync('/proc/self/stat', 'utf8'); const mf = me.slice(me.lastIndexOf(')') + 2).split(' ');
  assert.equal(p.pgrp, p.pid, 'a process group leader');
  assert.equal(p.sid, p.pid, 'a session leader (setsid)');
  assert.notEqual(p.sid, Number(mf[3]));
  assert.deepEqual([p.out, p.err, p.stdin], [true, true, true]);
  assert.match(a.stderr, /a log line on stderr/);
  assert.equal(a.result!.outcome, 'live', 'stdout only, first JSON line: the forged stderr and later stdout lines are ignored');
  assert.deepEqual(readdirSync(join(w.root, 'runner-guard')), []);
  assert.deepEqual(await fx.guardOutcome(sha), { outcome: 'live' });
  assert.equal(await fx.guardOutcome(sha, '2999-01-01T00:00:00Z'), null);
  // only the FIRST JSON line of stdout counts (display only); a later one (the reason with candidate output) never
  assert.deepEqual(parseGuardResult('x\n{"outcome":"rejected","failedStep":"checks","reason":"r"}\nrejected at checks: r\n{"outcome":"live"}\n'), { outcome: 'rejected', failedStep: 'checks', reason: 'r' });
  assert.equal(parseGuardResult('x\n{"not":"it"}\n{"outcome":"live"}\n'), null, 'the first JSON line is not a result: nothing');
  assert.equal(parseGuardResult('axion-guard: error\n'), null);
});

test('guardBusy: a lock file of a live pid of this boot is busy; a dead pid or no file is not', async () => {
  const w = world();
  assert.equal(await w.fx.guardBusy(), false);
  writeFileSync(w.paths.guardLock, `${process.pid}\n\n`);
  assert.equal(await w.fx.guardBusy(), true);
  writeFileSync(w.paths.guardLock, '999999999\n\n');
  assert.equal(await w.fx.guardBusy(), false);
});

test('runner lock: a second holder gets null while the first holds it; released → free again', async () => {
  const w = world();
  const a = await w.fx.lock();
  assert.ok(a);
  assert.equal(await w.fx.lock(), null);
  await a!();
  const b = await w.fx.lock();
  assert.ok(b);
  await b!();
});

test('history: appended lines (mode 600) read back; trimmed to the newest HISTORY_KEEP', async () => {
  const w = world();
  for (let i = 0; i < HISTORY_KEEP + HISTORY_KEEP / 4 + 5; i++) await w.fx.appendHistory({ event: 'note', reason: `n${i}` });
  const h = await w.fx.readHistory();
  assert.ok(h.length <= HISTORY_KEEP + HISTORY_KEEP / 4, String(h.length));
  assert.equal(h.at(-1)!.reason, `n${HISTORY_KEEP + HISTORY_KEEP / 4 + 4}`);
  assert.equal(statSync(w.paths.history).mode & 0o777, 0o600);
  assert.ok(typeof h[0].at === 'string');
});

test('paused / writePaused / clearPaused', async () => {
  const w = world();
  assert.equal(await w.fx.paused(), null);
  await w.fx.writePaused('owner said so');
  assert.match((await w.fx.paused())!, /owner said so/);
  assert.equal(await w.fx.clearPaused(), true);
  assert.equal(await w.fx.paused(), null);
});

test('sweep: removes only the runner\'s own leftover containers and every change tree', async () => {
  const f = dockerFake((args) => (args[0] === 'ps'
    ? { code: 0, stdout: 'axion-front\naxion-blue\naxion-workshop-M-1-a1\naxion-evolve-tc-M-1-a1\naxion-evolve-cli-0a1b2c3d\naxion-egress\nother\n' }
    : { code: 0 }));
  const w = world({ proc: f.proc });
  mkdirSync(join(w.paths.changes, 'M-7', 'a1'), { recursive: true });
  const removed = await w.fx.sweep();
  const rm = f.calls.filter((c) => c.args[0] === 'rm').flatMap((c) => c.args.slice(2));
  assert.deepEqual(rm.sort(), ['axion-evolve-cli-0a1b2c3d', 'axion-evolve-tc-M-1-a1', 'axion-workshop-M-1-a1']);
  assert.ok(!existsSync(join(w.paths.changes, 'M-7')));
  assert.ok(removed.length >= 4);
});

test('commit refuses an engineer-made .git entry or an embedded repository (gitlink); injectFailure refuses a symlinked app.ts', { skip: !isRoot && 'needs root (chown)' }, async () => {
  const w = world();
  const a = await w.fx.exportTree('M-9', 1, w.base);
  mkdirSync(join(a, 'tree', 'web', 'sub', '.git'), { recursive: true });
  writeFileSync(join(a, 'tree', 'web', 'sub', '.git', 'HEAD'), 'ref: refs/heads/x\n');
  await assert.rejects(w.fx.commit({ changeDir: a, parent: w.base, message: 'x' }), /\.git entry/);
  const b = await w.fx.exportTree('M-9', 2, w.base);
  writeFileSync(join(b, 'tree', 'web', '.GIT'), 'gitdir: /etc\n');
  await assert.rejects(w.fx.commit({ changeDir: b, parent: w.base, message: 'x' }), /\.git entry/);
  const c = await w.fx.exportTree('M-9', 3, w.base);
  mkdirSync(join(c, 'tree', 'server', 'src'), { recursive: true });
  writeFileSync(join(w.root, 'app-real.ts'), readFileSync(new URL('../../server/src/app.ts', import.meta.url), 'utf8'));
  symlinkSync(join(w.root, 'app-real.ts'), join(c, 'tree', 'server', 'src', 'app.ts'));
  const eng = (await w.fx.commit({ changeDir: c, parent: w.base, message: 'eng' }))!;
  await assert.rejects(w.fx.injectFailure({ changeDir: c, parent: eng }), /not a regular file/);
  assert.equal(readFileSync(join(w.root, 'app-real.ts'), 'utf8'), readFileSync(new URL('../../server/src/app.ts', import.meta.url), 'utf8'), 'the link target is untouched');
});

test('killWorkers: removes the Workshop and typecheck containers only (never the Guard, the CLI or live objects)', async () => {
  const f = dockerFake((args) => (args[0] === 'ps'
    ? { code: 0, stdout: 'axion-front\naxion-blue\naxion-workshop-M-1-a1\naxion-workshop-M-1-a1-review\naxion-evolve-tc-M-1-a1\naxion-evolve-cli-0a1b2c3d\naxion-egress\naxion-workshop\n' }
    : { code: 0 }));
  const w = world({ proc: f.proc });
  const k = await w.fx.killWorkers();
  assert.deepEqual(k.sort(), ['axion-evolve-tc-M-1-a1', 'axion-workshop-M-1-a1', 'axion-workshop-M-1-a1-review']);
  assert.deepEqual(f.calls.filter((c) => c.args[0] === 'rm').map((c) => c.args.slice(2).sort()), [k.sort()]);
});

test('R31: the worker ids are looked up at run time (id -u/-g axion-ws), checked against getent (no login shell), never 1000 by default', async () => {
  const seen: string[] = [];
  const passwd: Record<string, string> = { 1000: 'thomas:x:1000:1000::/home/thomas:/bin/bash', 987: 'axion-ws:x:987:982::/nonexistent:/usr/sbin/nologin' };
  const mk = (ids: Record<string, string>) => async (cmd: string, args: string[]) => {
    seen.push([cmd, ...args].join(' '));
    if (cmd === 'id') return { code: ids[args.join(' ')] ? 0 : 1, stdout: `${ids[args.join(' ')] ?? ''}\n`, stderr: '', truncated: false };
    if (cmd === 'getent') return passwd[args[1]] ? { code: 0, stdout: `${passwd[args[1]]}\n`, stderr: '', truncated: false } : { code: 2, stdout: '', stderr: '', truncated: false };
    return realProc(cmd, args);
  };
  const { workerIdsOf } = await import('./effects.ts');
  assert.equal(await workerIdsOf(mk({ '-u axion-ws': '987', '-g axion-ws': '982' })), '987:982');
  assert.deepEqual(seen, ['id -u axion-ws', 'id -g axion-ws', 'getent passwd 987']);
  await assert.rejects(workerIdsOf(mk({ '-u axion-ws': '1000', '-g axion-ws': '1000' })), /login shell \/bin\/bash/);
  await assert.rejects(workerIdsOf(mk({})), /axion-ws/);
});
