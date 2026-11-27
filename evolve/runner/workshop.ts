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
// Prompts go on stdin (a diff can exceed the 128 KB argv string limit). At the wall cap the container is killed, removed
// and confirmed gone (containerAlive otherwise). CLI errors and reviewer concerns have every secret form redacted.

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { globToRegExp, isCanonicalPath } from '../guard/classify.ts';
import { LOG_OPTS } from '../guard/effects-docker.ts';
import { engineerPrompt, parseReport, parseReview, reviewerPrompt } from './prompts.ts';
import type { Mission } from './prompts.ts';
import { loadRules, redactSecrets, SAFE_PATH } from './gates.ts';

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
  /**
   * secret values (secrets/*.env): every form of them is redacted from CLI errors, refusals and reviewer concerns, on the
   * raw text before any cut or quoting (I3). Required and non-empty: runEngineer/runReviewer throw otherwise (fail closed).
   */
  secrets: string[];
};

/** everything but `secrets`, which the caller must always supply (the values of secrets/*.env) */
export const WORKSHOP_DEFAULTS: Omit<WorkshopConfig, 'secrets'> = {
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

function checkSecrets(cfg: WorkshopConfig) {
  const s = (cfg as Partial<WorkshopConfig>).secrets;
  if (!Array.isArray(s) || s.length === 0 || !s.every((v) => typeof v === 'string')) {
    throw new Error('WorkshopConfig.secrets is required (the secrets/*.env values); refusing to run without redaction');
  }
}

/** characters a path may have to be written into a permission rule (no glob, escape, quote or bracket characters) */
/** largest --settings JSON passed in argv (one argv string may be at most 131072 bytes) */
export const MAX_SETTINGS = 120_000;

/**
 * The files (and symlinks; never followed) of an exported tree that existing `modify:` rules cover, as sorted repo-relative
 * paths, matched with the Guard's globs. Throws when the tree cannot be read.
 */
export function existingModifyFiles(treeDir: string, protectedPatterns: string[]): string[] {
  const res = protectedPatterns.filter((r) => r.startsWith('modify:')).map((r) => globToRegExp(r.slice('modify:'.length)));
  if (res.length === 0) return [];
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(treeDir, rel), { withFileTypes: true })) {
      const p = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (res.some((re) => re.test(p))) out.push(p);
    }
  };
  walk('');
  return out.sort();
}

/**
 * The --settings JSON for every Workshop run.
 *  - every plain protected rule (and the git rules): Edit and Write denied directory-wide;
 *  - a `modify:` rule (new files allowed, e.g. server/test/**): NO directory-wide deny (R27; with CLI 2.1.325 an Edit deny
 *    on a directory also refuses Write of a new file there); instead the files that already exist under it in the exported
 *    tree (`existingModify`, from existingModifyFiles) get exact Edit and Write denies, so they cannot be changed;
 *  - Read (which governs Grep and Glob too) denied on /proc, /etc, /srv, /root, HOME and /tmp.
 * Throws on an `existingModify` path that is not canonical or has characters outside SAFE_PATH (it would not be a literal rule).
 */
export function cliSettings(protectedPatterns: string[], existingModify: string[] = [], secrets: string[] = []): object {
  const at = (p: string) => `/${WORK}/${p}`; // `//work/…`: an absolute path in the CLI's rule syntax
  for (const p of existingModify) {
    // redact the raw name first, then cut and quote (a cut or JSON escaping would leave a partial, unredactable value)
    if (!isCanonicalPath(p) || !SAFE_PATH.test(p)) throw new Error(`unusable file name under a modify: rule: ${JSON.stringify(redactSecrets(p, secrets).slice(0, 120))}`);
  }
  const writeDeny = [...protectedPatterns.filter((r) => !r.startsWith('modify:')), ...GIT_RULES, ...existingModify]
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
type CliOutcome = { ok: true; result: string; denials: number } | { ok: false; timedOut: boolean; error: string; containerAlive?: true };

const tail = (s: string, n = 400) => (s.length > n ? `…${s.slice(-n)}` : s).trim();
const NO_SUCH = /no such (container|object)/i;
const DOCKER_T = { timeoutMs: 60_000 };

/** `docker kill`, tried twice; an already stopped or removed container counts as killed */
async function kill(x: Exec, name: string): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const r = await x.run('docker', ['kill', name], DOCKER_T).catch(() => null);
    if (r && (r.code === 0 || NO_SUCH.test(r.stderr) || /is not running/i.test(r.stderr))) return;
  }
}

/** `docker rm -f` then `docker container inspect` until the container is confirmed gone (two rounds, 500 ms apart); false = it still exists */
async function ensureGone(x: Exec, name: string): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    if (i > 0) await x.sleep(500);
    await x.run('docker', ['rm', '-f', name], DOCKER_T).catch(() => null);
    const r = await x.run('docker', ['container', 'inspect', '--format', '{{.State.Status}}', name], DOCKER_T).catch(() => null);
    if (r && r.code !== 0 && NO_SUCH.test(r.stderr)) return true;
  }
  return false;
}

/**
 * One containerised CLI run: remove a leftover of the same name, run, kill at the cap, parse the JSON envelope.
 * After ANY non-ok outcome (timeout, failed docker client, signal-killed client, lost daemon connection, a CLI error) the
 * container is killed, removed and confirmed gone (I5); if it still exists the outcome says containerAlive: the caller
 * must not diff or commit the tree (the container may still write to /work). Raw texts are redacted before any cut.
 */
async function cliRun(x: Exec, name: string, args: string[], input: string, capMs: number, secrets: string[]): Promise<CliOutcome> {
  const red = (t: string) => redactSecrets(t, secrets);
  await x.run('docker', ['rm', '-f', name], DOCKER_T);
  const ac = new AbortController();
  const runP = x.run('docker', args, { input, timeoutMs: capMs + 120_000 }).then((r) => ({ r }), (e: unknown) => ({ e }));
  const first = await Promise.race([runP, x.sleep(capMs, ac.signal).then(() => 'cap' as const)]);
  ac.abort();
  let done: { r: RunResult } | { e: unknown } | null = first === 'cap' ? null : first;
  const timedOut = done === null;
  if (timedOut) {
    await kill(x, name);
    // the docker client ends once the container is gone; bounded wait (the client has its own backstop timeout)
    done = await Promise.race([runP, x.sleep(30_000).then(() => null)]);
  }
  const outcome = ((): CliOutcome => {
    if (timedOut) return { ok: false, timedOut: true, error: `killed at the wall cap (${Math.round(capMs / 1000)} s)` };
    if (done === null || 'e' in done) {
      const e = done === null ? 'no result' : done.e;
      return { ok: false, timedOut: false, error: `docker client failed: ${tail(red(e instanceof Error ? e.message : String(e)))}` };
    }
    const r = done.r;
    if (r.code !== 0 && r.stdout.trim() === '') return { ok: false, timedOut: false, error: `exit ${r.code}: ${tail(red(r.stderr))}` };
    let env: Envelope;
    try {
      env = JSON.parse(r.stdout.trim()) as Envelope;
    } catch {
      return { ok: false, timedOut: false, error: `unparsable CLI output (exit ${r.code})` };
    }
    if (env.is_error !== false || env.subtype !== 'success' || typeof env.result !== 'string') {
      return { ok: false, timedOut: false, error: `CLI error: ${tail(red(String(env.subtype)), 80)} (exit ${r.code})` };
    }
    return { ok: true, result: env.result, denials: Array.isArray(env.permission_denials) ? env.permission_denials.length : 0 };
  })();
  if (outcome.ok) return outcome;
  if (!timedOut) await kill(x, name);
  if (!(await ensureGone(x, name))) {
    return { ...outcome, containerAlive: true, error: `${outcome.error}; container ${name} still exists after kill and rm -f: do not use the tree` };
  }
  return outcome;
}

function checkMission(m: Mission, attempt: number) {
  if (!ID_RE.test(m.id)) throw new Error(`invalid mission id: ${JSON.stringify(m.id)}`);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 99) throw new Error(`invalid attempt: ${attempt}`);
}

export type EngineerResult = {
  ok: boolean; report: string; timedOut: boolean;
  /** why not ok; secret forms redacted */
  error?: string;
  denials?: number;
  /** the container could not be confirmed gone: do not diff or commit the tree (I5) */
  containerAlive?: true;
};

/**
 * One engineer attempt on the exported tree at <changeDir>/tree (owned by uid 1000). ok = the CLI finished without error and
 * the answer ends with a <report> block; `denials` = tool calls the permission layer refused. The tree holds the result.
 */
export async function runEngineer(
  o: { changeDir: string; mission: Mission; attempt: number; feedback?: string },
  x: Exec,
  cfg: WorkshopConfig,
): Promise<EngineerResult> {
  checkMission(o.mission, o.attempt);
  checkSecrets(cfg);
  if (!isAbsolute(o.changeDir) || /[:,\0\n]/.test(o.changeDir) || o.changeDir.split('/').includes('..')) {
    throw new Error(`invalid changeDir: ${JSON.stringify(o.changeDir)}`);
  }
  const rules = cfg.rules;
  const tree = `${o.changeDir.replace(/\/+$/, '')}/tree`;
  // R27: the existing files under modify: rules, read from the exported tree right before the run
  let settings: object;
  try {
    settings = cliSettings(rules, existingModifyFiles(tree, rules), cfg.secrets);
  } catch (e) {
    return { ok: false, report: '', timedOut: false, error: redactSecrets(`refused before the run (exported tree): ${e instanceof Error ? e.message : String(e)}`, cfg.secrets) };
  }
  // the settings travel as one argv string (Linux MAX_ARG_STRLEN 128 KiB; 852 rules ≈ 39 KB in Task 3): refuse well before it
  const size = JSON.stringify(settings).length;
  if (size > MAX_SETTINGS) return { ok: false, report: '', timedOut: false, error: `refused before the run: the settings are too large (${size} bytes, ${MAX_SETTINGS} allowed)` };
  const name = `${cfg.namePrefix}-${o.mission.id}-a${o.attempt}`;
  const prompt = engineerPrompt({ mission: o.mission, attempt: o.attempt, feedback: o.feedback, protectedPatterns: rules });
  const args = dockerRun(cfg, name, tree, engineerArgs({ model: cfg.model, settings }));
  const r = await cliRun(x, name, args, prompt, cfg.engineerCapMs, cfg.secrets);
  if (!r.ok) {
    return { ok: false, report: '', timedOut: r.timedOut, error: redactSecrets(r.error, cfg.secrets), ...(r.containerAlive ? { containerAlive: true as const } : {}) };
  }
  const report = parseReport(r.result);
  if (report === null) return { ok: false, report: '', timedOut: false, error: 'no report block in the answer', denials: r.denials };
  return { ok: true, report: report.slice(0, 10_000), timedOut: false, denials: r.denials };
}

/** The reviewer's verdict on the diff (no tools, no mount). Anything but a clear ok (unparsable, error, timeout, too big) is not ok. */
export async function runReviewer(
  o: { mission: Mission; diff: string; attempt?: number },
  x: Exec,
  cfg: WorkshopConfig,
): Promise<{ ok: boolean; concerns: string[] }> {
  const attempt = o.attempt ?? 1;
  checkMission(o.mission, attempt);
  checkSecrets(cfg);
  if (o.diff.length > cfg.maxReviewDiff) return { ok: false, concerns: [`the diff is too large to review (${o.diff.length} characters)`] };
  const name = `${cfg.namePrefix}-${o.mission.id}-a${attempt}-review`;
  const args = dockerRun(cfg, name, null, reviewerArgs({ model: cfg.model, settings: cliSettings(cfg.rules) }));
  const r = await cliRun(x, name, args, reviewerPrompt({ mission: o.mission, diff: o.diff }), cfg.reviewerCapMs, cfg.secrets);
  if (!r.ok) return { ok: false, concerns: [redactSecrets(`review did not complete: ${r.error}`, cfg.secrets)] };
  const v = parseReview(r.result);
  return { ok: v.ok, concerns: v.concerns.map((c) => redactSecrets(c, cfg.secrets)) };
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
