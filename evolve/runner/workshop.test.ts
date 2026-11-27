import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliSettings, engineerArgs, reviewerArgs, runEngineer, runReviewer, WORKSHOP_DEFAULTS, ENGINEER_TOOLS } from './workshop.ts';
import type { Exec, ExecOpts, RunResult } from './workshop.ts';
import { loadRules } from './gates.ts';
import { LOG_OPTS } from '../guard/effects-docker.ts';

const RULES = loadRules();
const MODEL = 'claude-opus-5-5';
const mission = { id: 'M-7', title: 'Bigger button', text: 'Make it bigger', criteria: ['40px'] };

const CONSTRAINT_FLAGS = ['-p', '--model', MODEL, '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config',
  '--disable-slash-commands', '--no-session-persistence', '--permission-mode', 'dontAsk'];

test('cliSettings: allow only the five file tools, scoped to /work', () => {
  const s = cliSettings(RULES) as { permissions: { allow: string[]; deny: string[] } };
  assert.deepEqual(s.permissions.allow, ['Read(//work/**)', 'Glob(//work/**)', 'Grep(//work/**)', 'Edit(//work/**)', 'Write(//work/**)']);
  assert.ok(!JSON.stringify(s).includes('Bash'));
});

test('cliSettings: Edit and Write are denied on every protected pattern (modify: ones too) and on git files', () => {
  const s = cliSettings(RULES) as { permissions: { deny: string[] } };
  const deny = s.permissions.deny;
  for (const r of RULES) {
    const p = r.replace(/^modify:/, '');
    assert.ok(deny.includes(`Edit(//work/${p})`), `Edit ${p}`);
    assert.ok(deny.includes(`Write(//work/${p})`), `Write ${p}`);
  }
  for (const p of ['**/.git/**', '**/.git*', '**/.gitattributes']) {
    assert.ok(deny.includes(`Edit(//work/${p})`) && deny.includes(`Write(//work/${p})`), p);
  }
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

/** A recording fake Exec. `docker run` answers `runAnswer`; with `hang`, it only ends after `docker kill <name>`. */
function fakeExec(o: { runAnswer?: Partial<RunResult>; hang?: boolean } = {}) {
  const calls: Call[] = [];
  let release: (() => void) | null = null;
  const exec: Exec = {
    async run(cmd, args, opts) {
      calls.push({ cmd, args: [...args], ...(opts ? { opts } : {}) });
      if (args[0] === 'run') {
        if (o.hang) {
          await new Promise<void>((r) => { release = r; });
          return { code: 137, stdout: '', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '', ...o.runAnswer };
      }
      if (args[0] === 'kill') release?.();
      return { code: 0, stdout: '', stderr: '' };
    },
    sleep(ms, signal) {
      // the wall cap "expires" at once when the run hangs; otherwise it waits for the abort
      if (o.hang) return Promise.resolve();
      return new Promise((r) => signal?.addEventListener('abort', () => r(), { once: true }));
    },
  };
  return { exec, calls };
}

const envelope = (result: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, num_turns: 3, permission_denials: [], ...extra });

const cfg = { ...WORKSHOP_DEFAULTS, image: 'axion-workshop:abc123def456', rules: RULES };

test('runEngineer: removes a leftover container, then the exact docker run argv; the prompt goes on stdin', async () => {
  const { exec, calls } = fakeExec({ runAnswer: { stdout: envelope('done <report>{"goal":"g"}</report>') } });
  const r = await runEngineer({ changeDir: '/srv/axion-evolve/work/M-7', mission, attempt: 2, feedback: 'tsc failed' }, exec, cfg);
  assert.deepEqual(r, { ok: true, report: '{"goal":"g"}', timedOut: false, denials: 0 });
  assert.deepEqual(calls[0].args, ['rm', '-f', 'axion-workshop-M-7-a2']);
  const settings = cliSettings(RULES);
  assert.deepEqual(calls[1].cmd, 'docker');
  assert.deepEqual(calls[1].args, [
    'run', '--rm', '-i', '--name', 'axion-workshop-M-7-a2', '--network', 'axion-workshop', ...LOG_OPTS,
    '--user', '1000:1000', '--read-only', '--tmpfs', '/tmp', '--tmpfs', '/home/w', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--pids-limit', '512', '--memory', '4g',
    '-v', '/srv/axion-evolve/work/M-7/tree:/work', '--env-file', '/srv/axion-evolve/secrets/workshop.env',
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
  const r = await runEngineer({ changeDir: '/srv/axion-evolve/work/M-7', mission, attempt: 1 }, exec, cfg);
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2)), [['rm', '-f'], ['run', '--rm'], ['kill', 'axion-workshop-M-7-a1']]);
});

test('runEngineer: a CLI error, unparsable output or a missing report block is not ok', async () => {
  for (const [answer, why] of [
    [{ code: 1, stdout: '', stderr: 'boom' }, /exit 1/],
    [{ stdout: 'not json' }, /unparsable/],
    [{ stdout: envelope('x', { is_error: true, subtype: 'error_max_turns' }) }, /error_max_turns/],
    [{ stdout: envelope('I changed things') }, /no report/],
  ] as const) {
    const { exec } = fakeExec({ runAnswer: answer });
    const r = await runEngineer({ changeDir: '/w/M-7', mission, attempt: 1 }, exec, cfg);
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
