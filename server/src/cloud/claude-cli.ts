import type { CloudModelCheck } from '../../../shared/contracts/src/index.ts';
import { checkCache } from './check-cache.ts';
import { providerCheck } from './provider-check.ts';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * The live cloud model (owner request 2026-11-24): the ONE server file that starts a process.
 *
 * Why the CLI: CLAUDE_CODE_OAUTH_TOKEN is a Claude Code credential. A direct Messages API probe on 2026-11-24 was refused (one 429 "Error"), and the server never
 * presents itself as Claude Code to get around that. The `claude` CLI is the supported consumer of that token, so the server runs
 * `claude -p` locked down:
 *  - no tools (`--tools ""`): the model cannot run a command, read or write a file, or fetch anything;
 *  - no settings, hooks, plugins, MCP servers, skills or saved sessions (`--setting-sources ""`, `--strict-mcp-config`,
 *    `--disable-slash-commands`, `--no-session-persistence`), and a HOME of its own, so nothing from this host's Claude setup loads;
 *  - a child environment holding only PATH, that HOME and the token (no DATABASE_URL, no other secret);
 *  - the prompt on stdin (never in argv, where `ps` would show it), a hard timeout, a cap on what is read back;
 *  - error text is scrubbed of the token before it goes anywhere.
 * Mission execution stays off: missions, tasks and routing never call this. Callers: the cloud routes and, since 2026-11-25, the GM and agent
 * direct-chat responder (conversations/responder.ts).
 */
export interface CloudCallInput { prompt: string; system: string; model: string }
export interface CloudCallResult { text: string; durationMs: number; usage: { input: number; output: number } }
export type CloudFailure = 'timeout' | 'limited' | 'failed';
export class CloudCallError extends Error {
  constructor(public kind: CloudFailure, message: string) { super(message); }
}
/** What the routes see. Tests hand in a fake; the token stays inside the closure of the real one. */
export interface CloudAdapter {
  /** route id: `claude-1` for CLAUDE_CODE_OAUTH_TOKEN1, `claude` for an unnumbered CLAUDE_CODE_OAUTH_TOKEN */
  readonly id: string;
  /** shown on the website: "Claude 1" */
  readonly label: string;
  /** the env var that holds the token (a name, never the value) */
  readonly tokenVar: string;
  readonly model: string;
  readonly previousCheck?: CloudModelCheck | null;
  refresh(): Promise<CloudModelCheck>;
  complete(input: Omit<CloudCallInput, 'model'>): Promise<CloudCallResult>;
}

const MODEL_RE = /^claude-[a-z0-9-]{1,60}$/;
const OUT_CAP = 2_000_000; // bytes read from the CLI; more is cut and the call fails

/** The CLI path: CLAUDE_BIN, else the first `claude` on PATH, else ~/.local/bin/claude. */
export function findClaudeBin(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CLAUDE_BIN) return existsSync(env.CLAUDE_BIN) ? env.CLAUDE_BIN : null;
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  if (env.HOME) dirs.push(join(env.HOME, '.local', 'bin'));
  for (const d of dirs) { const p = join(d, 'claude'); try { if (statSync(p).isFile()) return p; } catch { /* next */ } }
  return null;
}

export function cliArgs(model: string, system: string, stream = false): string[] {
  if (!MODEL_RE.test(model)) throw new Error('invalid model id');
  return ['-p', '--model', model, '--output-format', stream ? 'stream-json' : 'json', ...(stream ? ['--input-format', 'stream-json', '--verbose'] : []), '--system-prompt', system,
    '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence'];
}

export interface ClaudeCliOptions { id?: string; label?: string; tokenVar?: string; token: string; model: string; bin: string; home: string; timeoutMs: number }

export function claudeCliAdapter(o: ClaudeCliOptions): CloudAdapter {
  if (!o.token) throw new Error('no token');
  if (!MODEL_RE.test(o.model)) throw new Error('invalid model id');
  const token = o.token;
  const cache = checkCache(o.home, o.model, token);
  const scrub = (s: string) => s.split(token).join('<token>').slice(0, 400);
  const run = (args: string[], input: string) => new Promise<{ out: string; err: string; code: number | null }>((resolve, reject) => {
    mkdirSync(o.home, { recursive: true, mode: 0o700 });
    const child = spawn(o.bin, args, {
      cwd: o.home,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: o.home, CLAUDE_CONFIG_DIR: join(o.home, '.claude'), CLAUDE_CODE_OAUTH_TOKEN: token, DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = ''; let done = false;
    const finish = (f: () => void) => { if (done) return; done = true; clearTimeout(timer); f(); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(() => reject(new CloudCallError('timeout', `no answer within ${Math.round(o.timeoutMs / 1000)} s`))); }, o.timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => { out += d; if (out.length > OUT_CAP) { child.kill('SIGKILL'); finish(() => reject(new CloudCallError('failed', 'the answer was too large'))); } });
    child.stderr.on('data', (d: string) => { if (err.length < 8000) err += d; });
    child.on('error', (e) => finish(() => reject(new CloudCallError('failed', scrub('could not start the model CLI: ' + e.message)))));
    child.on('close', (code) => finish(() => resolve({ out, err, code })));
    child.stdin.on('error', () => { /* the child exited early; close reports it */ });
    child.stdin.end(input);
  });
  return {
    id: o.id ?? 'claude', label: o.label ?? 'Claude', tokenVar: o.tokenVar ?? 'CLAUDE_CODE_OAUTH_TOKEN',
    model: o.model, previousCheck: cache.read(),
    async refresh() {
      const messages = [
        { type: 'control_request', request_id: 'account', request: { subtype: 'initialize' } },
        { type: 'control_request', request_id: 'usage', request: { subtype: 'get_usage', skip_behaviors: true } },
        { type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content: 'Reply with the single word pong.' } },
      ];
      const { out, code } = await run(cliArgs(o.model, 'Answer the connection test briefly.', true), messages.map(m => JSON.stringify(m)).join('\n') + '\n');
      const check = providerCheck(out, code);
      try { cache.write(check); }
      catch { console.warn('Cloud provider check could not be saved for the next startup.'); }
      return check;
    },
    async complete(input) {
      const started = Date.now();
      const { out, err, code } = await run(cliArgs(o.model, input.system), input.prompt);
      let j: { is_error?: boolean; result?: unknown; subtype?: string; usage?: { input_tokens?: number; output_tokens?: number }; api_error_status?: unknown } | undefined;
      try { j = JSON.parse(out); } catch { /* reported below */ }
      if (!j || code !== 0 || j.is_error || typeof j.result !== 'string') {
        const why = j?.is_error ? `${j.subtype ?? 'error'}${j.api_error_status ? ' (' + String(j.api_error_status) + ')' : ''}: ${typeof j.result === 'string' ? j.result : ''}` : `exit ${code}: ${err || out}`;
        const limited = j?.api_error_status === 429 || (j?.is_error && typeof j.result === 'string' && /(?:hit your (?:usage )?limit|usage limit reached)/i.test(j.result));
        throw new CloudCallError(limited ? 'limited' : 'failed', scrub(why.trim()));
      }
      return { text: j.result, durationMs: Date.now() - started, usage: { input: Number(j.usage?.input_tokens ?? 0), output: Number(j.usage?.output_tokens ?? 0) } };
    },
  };
}

const TOKEN_VAR = /^CLAUDE_CODE_OAUTH_TOKEN(\d{0,2})$/;
/**
 * One adapter per token in the environment (owner 2026-11-24): CLAUDE_CODE_OAUTH_TOKEN1 -> "Claude 1" (id claude-1), TOKEN2 -> "Claude 2", and an
 * unnumbered CLAUDE_CODE_OAUTH_TOKEN -> "Claude" (id claude). Each has its own model (CLOUD_MODEL<n>, else CLOUD_MODEL, else claude-opus-5-5) and
 * its own private CLI home under `homeRoot` (each token is a separate account, so their CLI state never mixes). No token = an empty list.
 */
export function cloudAdaptersFromEnv(env: NodeJS.ProcessEnv, homeRoot: string): CloudAdapter[] {
  const vars = Object.keys(env).filter((k) => TOKEN_VAR.test(k) && (env[k] ?? '').trim()).sort((a, b) => Number(a.slice(23) || 0) - Number(b.slice(23) || 0));
  if (!vars.length) return [];
  const bin = findClaudeBin(env);
  if (!bin) { console.warn(`cloud models: ${vars.join(', ')} set but the claude CLI was not found (set CLAUDE_BIN); the cloud models stay off`); return []; }
  const t = Number(env.CLOUD_MODEL_TIMEOUT_MS || 120_000);
  if (!Number.isInteger(t) || t < 5_000 || t > 600_000) throw new Error('CLOUD_MODEL_TIMEOUT_MS must be a whole number from 5000 to 600000');
  return vars.map((tokenVar) => {
    const n = TOKEN_VAR.exec(tokenVar)![1];
    const modelVar = n ? `CLOUD_MODEL${n}` : 'CLOUD_MODEL';
    const model = (env[modelVar] ?? '').trim() || (env.CLOUD_MODEL ?? '').trim() || 'claude-opus-5-5';
    if (!MODEL_RE.test(model)) throw new Error(`${modelVar} must look like claude-<name>`);
    const id = n ? `claude-${Number(n)}` : 'claude';
    return claudeCliAdapter({ id, label: n ? `Claude ${Number(n)}` : 'Claude', tokenVar, token: env[tokenVar]!.trim(), model, bin, home: join(homeRoot, id), timeoutMs: t });
  });
}
