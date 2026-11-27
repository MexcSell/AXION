import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliSettings, engineerArgs, reviewerArgs, runEngineer, runReviewer, WORKSHOP_DEFAULTS, ENGINEER_TOOLS, existingModifyFiles } from './workshop.ts';
import type { Exec, ExecOpts, RunResult } from './workshop.ts';
import { loadRules } from './gates.ts';
import { LOG_OPTS } from '../guard/effects-docker.ts';

const RULES = loadRules();

/** a change dir with an exported tree: two existing files under modify: rules, one ordinary file */
function changeDir(extra: string[] = []): string {
  const d = mkdtempSync(join(tmpdir(), 'axion-ws-test-'));
  for (const f of ['server/test/a.test.ts', 'server/test/deep/b.test.ts', 'web/scripts/x.sh', 'web/src/c.ts', ...extra]) {
    mkdirSync(join(d, 'tree', f, '..'), { recursive: true });
    writeFileSync(join(d, 'tree', f), 'x');
  }
  return d;
}
const CHANGE = changeDir();
const EXISTING = ['server/test/a.test.ts', 'server/test/deep/b.test.ts', 'web/scripts/x.sh'];
const MODEL = 'claude-opus-5-5';
const mission = { id: 'M-7', title: 'Bigger button', text: 'Make it bigger', criteria: ['40px'] };

const CONSTRAINT_FLAGS = ['-p', '--model', MODEL, '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config',
  '--disable-slash-commands', '--no-session-persistence', '--permission-mode', 'dontAsk'];

test('cliSettings: allow only the five file tools, scoped to /work', () => {
  const s = cliSettings(RULES) as { permissions: { allow: string[]; deny: string[] } };
  assert.deepEqual(s.permissions.allow, ['Read(//work/**)', 'Glob(//work/**)', 'Grep(//work/**)', 'Edit(//work/**)', 'Write(//work/**)']);
  assert.ok(!JSON.stringify(s).includes('Bash'));
});

test('cliSettings: Edit and Write denied directory-wide on every plain protected pattern, never on a modify: one (R27), and on git files', () => {
  const s = cliSettings(RULES, EXISTING) as { permissions: { deny: string[] } };
  const deny = s.permissions.deny;
  for (const r of RULES) {
    const p = r.replace(/^modify:/, '');
    const plain = !r.startsWith('modify:');
    assert.equal(deny.includes(`Edit(//work/${p})`), plain, `Edit ${r}`);
    assert.equal(deny.includes(`Write(//work/${p})`), plain, `Write ${r}`);
  }
  assert.ok(!deny.some((d) => /\((?:\/\/work\/)?(?:server\/test|web\/scripts)\/\*\*\)$/.test(d)), 'no directory-wide modify: deny');
  for (const p of ['.claude/**', '**/CLAUDE.md', '**/.mcp.json', '.github/**', '.vscode/**']) assert.ok(deny.includes(`Write(//work/${p})`), `R26 ${p}`);
  for (const p of ['**/.git/**', '**/.git*', '**/.gitattributes']) {
    assert.ok(deny.includes(`Edit(//work/${p})`) && deny.includes(`Write(//work/${p})`), p);
  }
});

test('R27: the existing files under modify: rules get exact Edit and Write denies, in order, nothing else', () => {
  const deny = (cliSettings(RULES, EXISTING) as { permissions: { deny: string[] } }).permissions.deny;
  for (const f of EXISTING) assert.ok(deny.includes(`Edit(//work/${f})`) && deny.includes(`Write(//work/${f})`), f);
  assert.ok(!deny.some((d) => d.includes('web/src/c.ts')));
  const none = (cliSettings(RULES) as { permissions: { deny: string[] } }).permissions.deny;
  assert.ok(!none.some((d) => d.includes('server/test/a.test.ts')));
});

test('R27: a path with characters outside [A-Za-z0-9_./@+-] (or not canonical) is refused', () => {
  for (const bad of ['server/test/a b.ts', 'server/test/a*.ts', 'server/test/[x].ts', 'server/test/a).ts', 'server/test/!a', 'server/test/a\\b', '/etc/x', 'server/test/../x', 'server/test/a\n.ts', 'server/test/ä.ts']) {
    assert.throws(() => cliSettings(RULES, [bad]), /unusable file name/, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => cliSettings(RULES, ['server/test/@x/a+b_c-d.e.test.ts']));
});

test('R27: existingModifyFiles walks the tree (files and symlinks, not directories) with the guard globs', () => {
  const d = changeDir(['server/test/fixtures/data.json', 'server/testx/no.ts']);
  symlinkSync('/proc/self/environ', join(d, 'tree', 'server/test/link'));
  assert.deepEqual(existingModifyFiles(join(d, 'tree'), RULES), [
    'server/test/a.test.ts', 'server/test/deep/b.test.ts', 'server/test/fixtures/data.json', 'server/test/link', 'web/scripts/x.sh',
  ]);
});

test('R27: runEngineer refuses the run (no docker call) when a modify: file name is unusable or the tree is missing', async () => {
  const d = changeDir(['server/test/a b.test.ts']);
  const { exec, calls } = fakeExec();
  const r = await runEngineer({ changeDir: d, mission, attempt: 1 }, exec, cfg);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /unusable file name/);
  const r2 = await runEngineer({ changeDir: '/nonexistent/axion-ws', mission, attempt: 1 }, exec, cfg);
  assert.equal(r2.ok, false);
  assert.match(r2.error ?? '', /tree/);
  assert.equal(calls.length, 0);
});

test('R27: a tree whose exact rules would not fit in one argv string refuses the run', async () => {
  const d = changeDir(Array.from({ length: 2600 }, (_, i) => `server/test/generated/file-${String(i).padStart(5, '0')}.test.ts`));
  const { exec, calls } = fakeExec();
  const r = await runEngineer({ changeDir: d, mission, attempt: 1 }, exec, cfg);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /settings are too large/);
  assert.equal(calls.length, 0);
});

test('cliSettings: Read (which also governs Grep and Glob) is denied on /proc, /etc, /srv, /root, HOME and /tmp', () => {
  const deny = (cliSettings([]) as { permissions: { deny: string[] } }).permissions.deny;
  for (const d of ['proc', 'etc', 'srv', 'root', 'home/w', 'tmp']) {
    assert.ok(deny.includes(`Read(//${d})`) && deny.includes(`Read(//${d}/**)`), d);
  }
});

test('engineerArgs / reviewerArgs: exactly the constraint flags; tools Read,Edit,Write,Glob,Grep or none; no Bash', () => {
  const settings = cliSettings(RULES);
  assert.deepEqual(engineerArgs({ model: MODEL, settings }), [...CONSTRAINT_FLAGS, '--settings', JSON.stringify(settings), '--tools', 'Read,Edit,Write,Glob,Grep']);
  assert.deepEqual(reviewerArgs({ model: MODEL, settings }), [...CONSTRAINT_FLAGS, '--settings', JSON.stringify(settings), '--tools', '']);
  assert.equal(ENGINEER_TOOLS, 'Read,Edit,Write,Glob,Grep');
  for (const a of [engineerArgs({ model: MODEL, settings }), reviewerArgs({ model: MODEL, settings })]) {
    assert.ok(!a.some((x) => /bash|webfetch|websearch/i.test(x.replace(JSON.stringify(settings), ''))));
    assert.ok(!a.includes('--dangerously-skip-permissions') && !a.includes('--allowedTools'));
  }
  assert.throws(() => engineerArgs({ model: 'gpt; rm', settings }), /model/);
});

type Call = { cmd: string; args: string[]; opts?: ExecOpts };

/**
 * A recording fake Exec. `docker run` answers `runAnswer`; with `hang`, it only ends after a working `docker kill <name>`
 * (or `rm -f`). `killFails`: kill answers an error and stops nothing. `alive`: the container never goes away (rm -f fails,
 * inspect finds it). `runRejects`: the docker client itself fails (e.g. the backstop timeout).
 */
function fakeExec(o: { runAnswer?: Partial<RunResult>; hang?: boolean; killFails?: boolean; alive?: boolean; runRejects?: boolean } = {}) {
  const calls: Call[] = [];
  let release: (() => void) | null = null;
  let running = false;
  const exec: Exec = {
    async run(cmd, args, opts) {
      calls.push({ cmd, args: [...args], ...(opts ? { opts } : {}) });
      if (args[0] === 'run') {
        if (o.runRejects) { running = true; throw new Error('docker run timed out after 1 ms'); }
        if (o.hang) {
          running = true;
          await new Promise<void>((r) => { release = r; });
          return { code: 137, stdout: '', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '', ...o.runAnswer };
      }
      if (args[0] === 'kill') {
        if (o.killFails || o.alive) return { code: 1, stdout: '', stderr: 'Error response from daemon: cannot kill container: timeout' };
        running = false; release?.();
      }
      if (args[0] === 'rm' && running) {
        if (o.alive) return { code: 1, stdout: '', stderr: 'Error response from daemon: could not remove' };
        running = false; release?.();
      }
      if (args[0] === 'container' && args[1] === 'inspect') {
        return running ? { code: 0, stdout: 'running\n', stderr: '' } : { code: 1, stdout: '', stderr: `Error: No such container: ${args[args.length - 1]}` };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    sleep(ms, signal) {
      // the wall cap "expires" at once when the run hangs; a sleep without a signal (grace waits) ends at once
      if (o.hang || !signal) return Promise.resolve();
      return new Promise((r) => signal.addEventListener('abort', () => r(), { once: true }));
    },
  };
  return { exec, calls };
}

const envelope = (result: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, num_turns: 3, permission_denials: [], ...extra });

const cfg = { ...WORKSHOP_DEFAULTS, image: 'axion-workshop:abc123def456', rules: RULES };

test('runEngineer: removes a leftover container, then the exact docker run argv; the prompt goes on stdin', async () => {
  const { exec, calls } = fakeExec({ runAnswer: { stdout: envelope('done <report>{"goal":"g"}</report>') } });
  const r = await runEngineer({ changeDir: CHANGE, mission, attempt: 2, feedback: 'tsc failed' }, exec, cfg);
  assert.deepEqual(r, { ok: true, report: '{"goal":"g"}', timedOut: false, denials: 0 });
  assert.deepEqual(calls[0].args, ['rm', '-f', 'axion-workshop-M-7-a2']);
  const settings = cliSettings(RULES, EXISTING);
  assert.deepEqual(calls[1].cmd, 'docker');
  assert.deepEqual(calls[1].args, [
    'run', '--rm', '-i', '--name', 'axion-workshop-M-7-a2', '--network', 'axion-workshop', ...LOG_OPTS,
    '--user', '1000:1000', '--read-only', '--tmpfs', '/tmp', '--tmpfs', '/home/w', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--pids-limit', '512', '--memory', '4g',
    '-v', `${CHANGE}/tree:/work`, '--env-file', '/srv/axion-evolve/secrets/workshop.env',
    '-e', 'HOME=/home/w', '-e', 'HTTPS_PROXY=http://axion-egress:3128', '-e', 'NO_PROXY=', '-e', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
    '-w', '/work', 'axion-workshop:abc123def456', 'claude', ...engineerArgs({ model: MODEL, settings }),
  ]);
  assert.match(calls[1].opts?.input ?? '', /Make it bigger/);
  assert.match(calls[1].opts?.input ?? '', /tsc failed/);
  assert.equal(calls.length, 2);
  assert.ok(!calls.some((c) => c.args.some((a) => a.includes('docker.sock') || a.includes('postgresql'))));
});

test('runEngineer: at the wall cap the container is killed (docker kill) and the result says timedOut', async () => {
  const { exec, calls } = fakeExec({ hang: true });
  const r = await runEngineer({ changeDir: CHANGE, mission, attempt: 1 }, exec, cfg);
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.equal(r.containerAlive, undefined);
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2)), [['rm', '-f'], ['run', '--rm'], ['kill', 'axion-workshop-M-7-a1'], ['rm', '-f'], ['container', 'inspect']]);
  assert.equal(calls[4].args[calls[4].args.length - 1], 'axion-workshop-M-7-a1');
});

test('I5: a failed docker kill is retried, then rm -f; the container is confirmed gone with docker inspect', async () => {
  const { exec, calls } = fakeExec({ hang: true, killFails: true });
  const r = await runEngineer({ changeDir: CHANGE, mission, attempt: 1 }, exec, cfg);
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.equal(r.containerAlive, undefined);
  assert.deepEqual(calls.map((c) => c.args[0] === 'container' ? 'inspect' : c.args[0]), ['rm', 'run', 'kill', 'kill', 'rm', 'inspect']);
});

test('I5: a container that cannot be removed is a hard error (containerAlive), for a timeout and for a failed docker client', async () => {
  for (const mode of [{ hang: true, alive: true }, { runRejects: true, alive: true }]) {
    const { exec, calls } = fakeExec(mode);
    const r = await runEngineer({ changeDir: CHANGE, mission, attempt: 1 }, exec, cfg);
    assert.equal(r.ok, false);
    assert.equal(r.containerAlive, true);
    assert.match(r.error ?? '', /still exists.*do not use the tree/);
    assert.ok(calls.filter((c) => c.args[0] === 'container' && c.args[1] === 'inspect').length >= 2, 'inspected after each rm -f');
  }
  const rv = await runReviewer({ mission, diff: '+x\n' }, fakeExec({ hang: true, alive: true }).exec, cfg);
  assert.equal(rv.ok, false);
  assert.ok(rv.concerns.some((c) => /still exists/.test(c)));
});

test('I5: a failed docker client (not a timeout) is cleaned up the same way', async () => {
  const { exec, calls } = fakeExec({ runRejects: true });
  const r = await runEngineer({ changeDir: CHANGE, mission, attempt: 1 }, exec, cfg);
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, false);
  assert.equal(r.containerAlive, undefined);
  assert.deepEqual(calls.map((c) => c.args[0] === 'container' ? 'inspect' : c.args[0]), ['rm', 'run', 'kill', 'rm', 'inspect']);
});

test('I3: secret values (any form) are redacted from the CLI error and the reviewer concerns', async () => {
  const secret = 'pw' + 'a1b2c3d4e5f6a7b8';
  const scfg = { ...cfg, secrets: [secret] };
  const r = await runEngineer({ changeDir: CHANGE, mission, attempt: 1 }, fakeExec({ runAnswer: { code: 1, stderr: `auth failed for ${secret} (${Buffer.from(secret).toString('hex')})` } }).exec, scfg);
  assert.ok(!(r.error ?? '').includes(secret) && !(r.error ?? '').includes(Buffer.from(secret).toString('hex')), r.error ?? '');
  assert.match(r.error ?? '', /\[redacted\]/);
  const rv = await runReviewer({ mission, diff: '+x\n' }, fakeExec({ runAnswer: { stdout: envelope(`{"ok": false, "concerns": ["it adds ${secret}"]}`) } }).exec, scfg);
  assert.deepEqual(rv, { ok: false, concerns: ['it adds [redacted]'] });
  const rv2 = await runReviewer({ mission, diff: '+x\n' }, fakeExec({ runAnswer: { code: 1, stderr: `bad ${secret}` } }).exec, scfg);
  assert.ok(!rv2.concerns.join(' ').includes(secret));
});

test('runEngineer: a CLI error, unparsable output or a missing report block is not ok', async () => {
  for (const [answer, why] of [
    [{ code: 1, stdout: '', stderr: 'boom' }, /exit 1/],
    [{ stdout: 'not json' }, /unparsable/],
    [{ stdout: envelope('x', { is_error: true, subtype: 'error_max_turns' }) }, /error_max_turns/],
    [{ stdout: envelope('I changed things') }, /no report/],
  ] as const) {
    const { exec } = fakeExec({ runAnswer: answer });
    const r = await runEngineer({ changeDir: CHANGE, mission, attempt: 1 }, exec, cfg);
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, false);
    assert.match(r.error ?? '', why);
  }
});

test('runEngineer: bad ids, attempts or change dirs are refused before any docker call', async () => {
  const { exec, calls } = fakeExec();
  await assert.rejects(runEngineer({ changeDir: '/w/x', mission: { ...mission, id: '../x' }, attempt: 1 }, exec, cfg), /mission id/);
  await assert.rejects(runEngineer({ changeDir: '/w/x', mission, attempt: 0 }, exec, cfg), /attempt/);
  await assert.rejects(runEngineer({ changeDir: 'rel/x', mission, attempt: 1 }, exec, cfg), /changeDir/);
  await assert.rejects(runEngineer({ changeDir: '/w/x:/etc', mission, attempt: 1 }, exec, cfg), /changeDir/);
  assert.equal(calls.length, 0);
});

test('runReviewer: no tools, no mount, diff on stdin; the JSON answer decides', async () => {
  const { exec, calls } = fakeExec({ runAnswer: { stdout: envelope('```json\n{"ok": false, "concerns": ["no test"]}\n```') } });
  const r = await runReviewer({ mission, diff: '+x\n', attempt: 1 }, exec, cfg);
  assert.deepEqual(r, { ok: false, concerns: ['no test'] });
  const run = calls.find((c) => c.args[0] === 'run')!;
  assert.ok(!run.args.includes('-v'));
  assert.equal(run.args[run.args.indexOf('--name') + 1], 'axion-workshop-M-7-a1-review');
  assert.deepEqual(run.args.slice(run.args.indexOf('claude') + 1), reviewerArgs({ model: MODEL, settings: cliSettings(RULES) }));
  assert.match(run.opts?.input ?? '', /\+x/);
});

test('runReviewer: unparsable, CLI failure, timeout or an oversized diff → not ok with a reason', async () => {
  const r1 = await runReviewer({ mission, diff: '+x\n' }, fakeExec({ runAnswer: { stdout: envelope('looks good to me') } }).exec, cfg);
  assert.equal(r1.ok, false);
  assert.ok(r1.concerns.length > 0);
  const r2 = await runReviewer({ mission, diff: '+x\n' }, fakeExec({ runAnswer: { code: 1, stderr: 'boom' } }).exec, cfg);
  assert.equal(r2.ok, false);
  const t = fakeExec({ hang: true });
  const r3 = await runReviewer({ mission, diff: '+x\n' }, t.exec, cfg);
  assert.equal(r3.ok, false);
  assert.ok(t.calls.some((c) => c.args[0] === 'kill'));
  const big = fakeExec();
  const r4 = await runReviewer({ mission, diff: 'x'.repeat(cfg.maxReviewDiff + 1) }, big.exec, cfg);
  assert.equal(r4.ok, false);
  assert.equal(big.calls.length, 0);
});
