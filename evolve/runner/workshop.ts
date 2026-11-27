// The Workshop (evolution step 2): the engineer and reviewer agents run the Claude CLI (Claude 1 only) in a throw-away
// container of the Workshop image (evolve/docker/workshop.Dockerfile):
//   - uid 1000, read-only root, tmpfs /tmp and HOME=/home/w, no capabilities, no-new-privileges, pids/memory limits;
//   - network axion-workshop (internal, inhibit_ipv4) whose only way out is axion-egress (api.anthropic.com:443);
//   - the only host mount: the engineer's exported tree <changeDir>/tree at /work (the reviewer gets none); never a git
//     directory, the Docker socket or the DB;
//   - the token reaches the container only through the root-only --env-file (CLAUDE_CODE_OAUTH_TOKEN=<TOKEN1>), never argv;
//   - the CLI: the Global Constraints flag set, tools Read,Edit,Write,Glob,Grep (engineer) or none (reviewer), dontAsk, and
//     the settings below (allow scoped to /work, deny protected paths and git files for Edit/Write, deny Read — which also
//     governs Grep and Glob — on /proc, /etc, /srv, /root, HOME and /tmp). Verified against the real CLI 2.1.325 (Task 3).
// Prompts go on stdin (a diff can exceed the 128 KB argv string limit). At the wall cap the container is killed.

import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { LOG_OPTS } from '../guard/effects-docker.ts';
import { engineerPrompt, parseReport, parseReview, reviewerPrompt } from './prompts.ts';
import type { Mission } from './prompts.ts';
import { loadRules } from './gates.ts';

export type RunResult = { code: number; stdout: string; stderr: string };
export type ExecOpts = { input?: string; timeoutMs?: number };
export interface Exec {
  /** Runs `cmd` with `args` (no shell); `input` is written to stdin. Resolves with the exit code; rejects only if it cannot run or times out. */
  run(cmd: string, args: string[], opts?: ExecOpts): Promise<RunResult>;
  /** Resolves after `ms`, or early when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const ENGINEER_TOOLS = 'Read,Edit,Write,Glob,Grep';
export const WORK = '/work';
export const HOME = '/home/w';
const MODEL_RE = /^claude-[a-z0-9-]{1,60}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,40}$/;
const OUT_CAP = 16 * 1024 * 1024;
/** absolute directories the agents may not read (Read rules also cover Grep and Glob, verified in Task 3) */
const NO_READ = ['/proc', '/etc', '/srv', '/root', HOME, '/tmp'];
/** git internals and attributes (the runner commits from its own git dir; still never let the agent write them) */
const GIT_RULES = ['**/.git/**', '**/.git*', '**/.gitattributes'];

export type WorkshopConfig = {
  image: string;
  network: string;
  /** root-only file holding CLAUDE_CODE_OAUTH_TOKEN=<TOKEN1> */
  envFile: string;
  proxyUrl: string;
  /** container names: <namePrefix>-<mission>-a<n>[-review] */
  namePrefix: string;
  model: string;
  engineerCapMs: number;
  reviewerCapMs: number;
  /** a larger diff is not sent to the reviewer (not ok) */
  maxReviewDiff: number;
  /** protected rules (the runner's installed evolve/protected.txt) */
  rules: string[];
};

export const WORKSHOP_DEFAULTS: WorkshopConfig = {
  image: 'axion-workshop:current',
  network: 'axion-workshop',
  envFile: '/srv/axion-evolve/secrets/workshop.env',
  proxyUrl: 'http://axion-egress:3128',
  namePrefix: 'axion-workshop',
  model: 'claude-opus-5-5',
  engineerCapMs: 30 * 60_000,
  reviewerCapMs: 5 * 60_000,
  maxReviewDiff: 400_000,
  get rules() { return loadRules(); },
};

/** The --settings JSON for every Workshop run. `protectedPatterns` are evolve/protected.txt rules (`modify:` ones denied as well). */
export function cliSettings(protectedPatterns: string[]): object {
  const at = (p: string) => `/${WORK}/${p}`; // `//work/…`: an absolute path in the CLI's rule syntax
  const writeDeny = [...protectedPatterns.map((r) => r.replace(/^modify:/, '')), ...GIT_RULES]
    .flatMap((p) => [`Edit(${at(p)})`, `Write(${at(p)})`]);
  const readDeny = NO_READ.flatMap((d) => [`Read(/${d})`, `Read(/${d}/**)`]);
  return {
    permissions: {
      allow: ['Read', 'Glob', 'Grep', 'Edit', 'Write'].map((t) => `${t}(/${WORK}/**)`),
      deny: [...new Set([...writeDeny, ...readDeny])],
    },
  };
}

function baseArgs(model: string, settings: object): string[] {
  if (!MODEL_RE.test(model)) throw new Error('invalid model id');
  return ['-p', '--model', model, '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands',
    '--no-session-persistence', '--permission-mode', 'dontAsk', '--settings', JSON.stringify(settings)];
}

/** the claude argv of an engineer run (the prompt goes on stdin) */
export function engineerArgs(o: { model: string; settings: object }): string[] {
  return [...baseArgs(o.model, o.settings), '--tools', ENGINEER_TOOLS];
}

/** the claude argv of a reviewer run: no tools (the prompt, with the diff, goes on stdin) */
export function reviewerArgs(o: { model: string; settings: object }): string[] {
  return [...baseArgs(o.model, o.settings), '--tools', ''];
}

function dockerRun(cfg: WorkshopConfig, name: string, mount: string | null, claudeArgs: string[]): string[] {
  return [
    'run', '--rm', '-i', '--name', name, '--network', cfg.network, ...LOG_OPTS,
    '--user', '1000:1000', '--read-only', '--tmpfs', '/tmp', '--tmpfs', HOME, '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--pids-limit', '512', '--memory', '4g',
    ...(mount ? ['-v', `${mount}:${WORK}`] : []),
    '--env-file', cfg.envFile,
    '-e', `HOME=${HOME}`, '-e', `HTTPS_PROXY=${cfg.proxyUrl}`, '-e', 'NO_PROXY=', '-e', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
    '-w', mount ? WORK : HOME, cfg.image, 'claude', ...claudeArgs,
  ];
}

type Envelope = { is_error?: unknown; subtype?: unknown; result?: unknown; permission_denials?: unknown };
type CliOutcome = { ok: true; result: string; denials: number } | { ok: false; timedOut: boolean; error: string };

const tail = (s: string, n = 400) => (s.length > n ? `…${s.slice(-n)}` : s).trim();

/** one containerised CLI run: remove a leftover of the same name, run, kill at the cap, parse the JSON envelope */
async function cliRun(x: Exec, name: string, args: string[], input: string, capMs: number): Promise<CliOutcome> {
  await x.run('docker', ['rm', '-f', name], { timeoutMs: 60_000 });
  const ac = new AbortController();
  let timedOut = false;
  const run = x.run('docker', args, { input, timeoutMs: capMs + 120_000 });
  const cap = x.sleep(capMs, ac.signal).then(() => {
    if (ac.signal.aborted) return;
    timedOut = true;
    return x.run('docker', ['kill', name], { timeoutMs: 60_000 }).catch(() => undefined);
  });
  let r: RunResult;
  try {
    r = await run;
  } catch (e) {
    ac.abort();
    await cap;
    if (!timedOut) await x.run('docker', ['kill', name], { timeoutMs: 60_000 }).catch(() => undefined);
    return { ok: false, timedOut, error: e instanceof Error ? e.message : String(e) };
  }
  ac.abort();
  await cap;
  if (timedOut) return { ok: false, timedOut: true, error: `killed at the wall cap (${Math.round(capMs / 1000)} s)` };
  if (r.code !== 0 && r.stdout.trim() === '') return { ok: false, timedOut: false, error: `exit ${r.code}: ${tail(r.stderr)}` };
  let env: Envelope;
  try {
    env = JSON.parse(r.stdout.trim()) as Envelope;
  } catch {
    return { ok: false, timedOut: false, error: `unparsable CLI output (exit ${r.code})` };
  }
  if (env.is_error !== false || env.subtype !== 'success' || typeof env.result !== 'string') {
    return { ok: false, timedOut: false, error: `CLI error: ${String(env.subtype)} (exit ${r.code})` };
  }
  return { ok: true, result: env.result, denials: Array.isArray(env.permission_denials) ? env.permission_denials.length : 0 };
}

function checkMission(m: Mission, attempt: number) {
  if (!ID_RE.test(m.id)) throw new Error(`invalid mission id: ${JSON.stringify(m.id)}`);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 99) throw new Error(`invalid attempt: ${attempt}`);
}

export type EngineerResult = { ok: boolean; report: string; timedOut: boolean; error?: string; denials?: number };

/**
 * One engineer attempt on the exported tree at <changeDir>/tree (owned by uid 1000). ok = the CLI finished without error and
 * the answer ends with a <report> block; `denials` = tool calls the permission layer refused. The tree holds the result.
 */
export async function runEngineer(
  o: { changeDir: string; mission: Mission; attempt: number; feedback?: string },
  x: Exec,
  cfg: WorkshopConfig = WORKSHOP_DEFAULTS,
): Promise<EngineerResult> {
  checkMission(o.mission, o.attempt);
  if (!isAbsolute(o.changeDir) || /[:,\0\n]/.test(o.changeDir) || o.changeDir.split('/').includes('..')) {
    throw new Error(`invalid changeDir: ${JSON.stringify(o.changeDir)}`);
  }
  const rules = cfg.rules;
  const name = `${cfg.namePrefix}-${o.mission.id}-a${o.attempt}`;
  const prompt = engineerPrompt({ mission: o.mission, attempt: o.attempt, feedback: o.feedback, protectedPatterns: rules });
  const args = dockerRun(cfg, name, `${o.changeDir.replace(/\/+$/, '')}/tree`, engineerArgs({ model: cfg.model, settings: cliSettings(rules) }));
  const r = await cliRun(x, name, args, prompt, cfg.engineerCapMs);
  if (!r.ok) return { ok: false, report: '', timedOut: r.timedOut, error: r.error };
  const report = parseReport(r.result);
  if (report === null) return { ok: false, report: '', timedOut: false, error: 'no report block in the answer', denials: r.denials };
  return { ok: true, report: report.slice(0, 10_000), timedOut: false, denials: r.denials };
}

/** The reviewer's verdict on the diff (no tools, no mount). Anything but a clear ok (unparsable, error, timeout, too big) is not ok. */
export async function runReviewer(
  o: { mission: Mission; diff: string; attempt?: number },
  x: Exec,
  cfg: WorkshopConfig = WORKSHOP_DEFAULTS,
): Promise<{ ok: boolean; concerns: string[] }> {
  const attempt = o.attempt ?? 1;
  checkMission(o.mission, attempt);
  if (o.diff.length > cfg.maxReviewDiff) return { ok: false, concerns: [`the diff is too large to review (${o.diff.length} characters)`] };
  const name = `${cfg.namePrefix}-${o.mission.id}-a${attempt}-review`;
  const args = dockerRun(cfg, name, null, reviewerArgs({ model: cfg.model, settings: cliSettings(cfg.rules) }));
  const r = await cliRun(x, name, args, reviewerPrompt({ mission: o.mission, diff: o.diff }), cfg.reviewerCapMs);
  if (!r.ok) return { ok: false, concerns: [`review did not complete: ${r.error}`] };
  return parseReview(r.result);
}

function collector() {
  const chunks: Buffer[] = [];
  let size = 0;
  return {
    add(b: Buffer) { chunks.push(b); size += b.length; while (size > OUT_CAP && chunks.length > 1) size -= chunks.shift()!.length; },
    text: () => Buffer.concat(chunks).toString('utf8'),
  };
}

/** The real Exec (argument arrays, never a shell; the host.ts pattern plus stdin). */
export const realExec: Exec = {
  run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      const out = collector();
      const err = collector();
      child.stdout.on('data', (b: Buffer) => out.add(b));
      child.stderr.on('data', (b: Buffer) => err.add(b));
      child.stdin.on('error', () => { /* the child closed stdin early; its exit code tells */ });
      child.stdin.end(opts.input ?? '');
      let timedOut = false;
      const timer = opts.timeoutMs
        ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
        }, opts.timeoutMs)
        : null;
      child.on('error', (e) => { if (timer) clearTimeout(timer); reject(new Error(`${cmd}: ${e.message}`)); });
      child.on('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        if (timedOut) { reject(new Error(`${cmd} ${args[0] ?? ''} timed out after ${opts.timeoutMs} ms`)); return; }
        resolve({ code: code ?? (signal ? 128 : 1), stdout: out.text(), stderr: err.text() });
      });
    });
  },
  sleep(ms, signal) {
    return new Promise((resolve) => {
      if (signal?.aborted) { resolve(); return; }
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  },
};
