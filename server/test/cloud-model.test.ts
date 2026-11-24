import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { claudeCliAdapter, cloudAdaptersFromEnv, cliArgs, CloudCallError, type CloudAdapter } from '../src/cloud/claude-cli.ts';

/** Owner requests 2026-11-24: the live cloud models, one per CLAUDE_CODE_OAUTH_TOKEN<n>. Routes run against FAKE adapters; the CLI runner runs a FAKE `claude` script. No test reaches the network. */
const SECRET = 'sk-ant-oat01-TEST-SECRET-never-shown';

function fakeAdapter(n: number, behave: (prompt: string, system: string) => Promise<{ text: string }> | { text: string }): CloudAdapter & { calls: { prompt: string; system: string }[] } {
  const calls: { prompt: string; system: string }[] = [];
  return { id: `claude-${n}`, label: `Claude ${n}`, tokenVar: `CLAUDE_CODE_OAUTH_TOKEN${n}`, model: n === 1 ? 'claude-opus-5-5' : 'claude-sonnet-5-5', calls,
    complete: async (i) => { calls.push(i); const r = await behave(i.prompt, i.system); return { text: r.text, durationMs: 12, usage: { input: 7, output: 3 } }; } };
}
const C1 = '/cloud-models/claude-1/complete', C2 = '/cloud-models/claude-2/complete';

describe('cloud model routes (two fake adapters)', () => {
  let t: TestApp; let admin: Browser; let mina: Browser;
  let mode: 'ok' | 'json' | 'slow' | 'timeout' | 'fail' = 'ok';
  let release: (() => void) | null = null;
  const fake = fakeAdapter(1, async (prompt) => {
    if (mode === 'json') return { text: '```json\n{"a":1}\n```' };
    if (mode === 'slow') { await new Promise<void>((r) => { release = r; }); return { text: 'late' }; }
    if (mode === 'timeout') throw new CloudCallError('timeout', 'no answer within 5 s');
    if (mode === 'fail') throw new CloudCallError('failed', `rejected for ${SECRET}`);
    return { text: `echo: ${prompt}` };
  });
  const fake2 = fakeAdapter(2, (prompt) => ({ text: `two: ${prompt}` }));
  const status = async (b: Browser, id = 'claude-1') => (await b.req('GET', '/cloud-models')).body.models.find((m: { id: string }) => m.id === id);
  beforeAll(async () => {
    t = await makeTestApp({ cloudModels: [fake, fake2], writeLimits: { cloud: { max: 50, windowMs: 60_000 } } });
    const w = await withAdmin(t.app); admin = w.admin; mina = (await w.member('Mina')).b;
  });
  afterAll(async () => { await t?.close(); });

  it('status: every signed-in person sees both models and their token VARIABLE names, never a token; only admins may prompt', async () => {
    const a = await admin.req('GET', '/cloud-models');
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ maxInFlight: 2, canPrompt: true, models: [
      { id: 'claude-1', label: 'Claude 1', provider: 'anthropic', transport: 'claude-code-cli', tokenVar: 'CLAUDE_CODE_OAUTH_TOKEN1', model: 'claude-opus-5-5', inFlight: 0, lastCall: null },
      { id: 'claude-2', label: 'Claude 2', provider: 'anthropic', transport: 'claude-code-cli', tokenVar: 'CLAUDE_CODE_OAUTH_TOKEN2', model: 'claude-sonnet-5-5', inFlight: 0, lastCall: null },
    ] });
    const m = await mina.req('GET', '/cloud-models');
    expect(m.body.canPrompt).toBe(false);
    expect(JSON.stringify([a.body, m.body])).not.toMatch(/sk-ant|oat01/);
  });

  it('each id reaches its own model; the audit row names it and has sizes and timing, never the prompt or the answer', async () => {
    mode = 'ok';
    const r = await admin.req('POST', C1, { prompt: 'hello private words' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: 'claude-1', model: 'claude-opus-5-5', text: 'echo: hello private words', truncated: false, format: 'text', validJson: null, durationMs: 12, usage: { input: 7, output: 3 } });
    expect(fake.calls.at(-1)!.system).not.toMatch(/JSON/);
    const r2 = await admin.req('POST', C2, { prompt: 'second' });
    expect(r2.body).toMatchObject({ id: 'claude-2', model: 'claude-sonnet-5-5', text: 'two: second' });
    expect([fake.calls.length, fake2.calls.length]).toEqual([1, 1]);
    const rows = (await t.pool.query(`select subject, result, detail from audit_events where action='model.cloud.complete' order by seq`)).rows;
    expect(rows.map((x) => x.subject)).toEqual(['claude-1:claude-opus-5-5', 'claude-2:claude-sonnet-5-5']);
    expect(rows[0].detail).toMatchObject({ format: 'text', promptChars: 19, answerChars: 25, usageIn: 7, usageOut: 3 });
    expect(JSON.stringify(rows.map((x) => x.detail))).not.toMatch(/private|echo|second|two:/);
    expect((await status(admin)).lastCall).toMatchObject({ ok: true, durationMs: 12 });
  });

  it('an unknown id is 404 and calls nothing', async () => {
    const n = fake.calls.length + fake2.calls.length;
    const r = await admin.req('POST', '/cloud-models/claude-9/complete', { prompt: 'hi' });
    expect([r.status, r.body.code]).toEqual([404, 'NOT_FOUND']);
    expect(fake.calls.length + fake2.calls.length).toBe(n);
  });

  it('json format asks for JSON and reports whether the reply parses (a fenced block counts)', async () => {
    mode = 'json';
    const r = await admin.req('POST', C1, { prompt: 'give json', format: 'json' });
    expect(r.body).toMatchObject({ format: 'json', validJson: true });
    expect(fake.calls.at(-1)!.system).toMatch(/exactly one JSON value/);
  });

  it('a member is refused (403) and no model is called', async () => {
    const n = fake.calls.length + fake2.calls.length;
    for (const u of [C1, C2]) expect((await mina.req('POST', u, { prompt: 'hi' })).status).toBe(403);
    expect(fake.calls.length + fake2.calls.length).toBe(n);
  });

  it('validation: empty, too long, wrong format or an extra field is 400 VALIDATION', async () => {
    for (const body of [{}, { prompt: '   ' }, { prompt: 'x'.repeat(8001) }, { prompt: 'x', format: 'yaml' }, { prompt: 'x', model: 'other' }]) {
      const r = await admin.req('POST', C1, body);
      expect(r.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(r.body.code).toBe('VALIDATION');
    }
  });

  it('timeout is 504 MODEL_TIMEOUT and a failure is 502 MODEL_FAILED; the reason (with the token) never reaches the browser', async () => {
    mode = 'timeout';
    const a = await admin.req('POST', C1, { prompt: 'hi' });
    expect([a.status, a.body.code, a.body.retryable]).toEqual([504, 'MODEL_TIMEOUT', true]);
    mode = 'fail';
    const b = await admin.req('POST', C1, { prompt: 'hi' });
    expect([b.status, b.body.code]).toEqual([502, 'MODEL_FAILED']);
    expect(JSON.stringify(b.body)).not.toMatch(/sk-ant|SECRET|rejected/);
    const audits = (await t.pool.query(`select detail::text d from audit_events where action='model.cloud.complete' and result='error'`)).rows;
    expect(audits.length).toBe(2);
    expect(audits.map((x) => x.d).join()).not.toMatch(/SECRET|sk-ant/);
    expect((await status(admin)).lastCall.ok).toBe(false);
    expect((await status(admin, 'claude-2')).lastCall.ok).toBe(true); // each model keeps its own last call
  });

  it('at most two calls at once per model: the third is 429 MODEL_BUSY, while the other model still answers', async () => {
    mode = 'slow';
    const releases: (() => void)[] = [];
    const p1 = admin.req('POST', C1, { prompt: 'one' });
    await new Promise((r) => setTimeout(r, 50)); releases.push(release!);
    const p2 = admin.req('POST', C1, { prompt: 'two' });
    await new Promise((r) => setTimeout(r, 50)); releases.push(release!);
    expect((await status(admin)).inFlight).toBe(2);
    const third = await admin.req('POST', C1, { prompt: 'three' });
    expect([third.status, third.body.code]).toEqual([429, 'MODEL_BUSY']);
    expect((await admin.req('POST', C2, { prompt: 'free' })).status).toBe(200);
    releases.forEach((f) => f());
    expect((await p1).status).toBe(200); expect((await p2).status).toBe(200);
    expect((await status(admin)).inFlight).toBe(0);
  });
});

describe('cloud model routes without a token, and the per-session limit', () => {
  let t: TestApp; let admin: Browser;
  beforeAll(async () => { t = await makeTestApp({ writeLimits: { cloud: { max: 2, windowMs: 60_000 } } }); admin = (await withAdmin(t.app)).admin; });
  afterAll(async () => { await t?.close(); });
  it('not configured: the list is empty and a prompt is 503 MODEL_NOT_CONFIGURED', async () => {
    expect((await admin.req('GET', '/cloud-models')).body).toEqual({ models: [], maxInFlight: 2, canPrompt: true });
    const r = await admin.req('POST', C1, { prompt: 'hi' });
    expect([r.status, r.body.code]).toEqual([503, 'MODEL_NOT_CONFIGURED']);
  });
  it('the "cloud" bucket limits prompts per session across all models (here 2 a minute; the default is 10)', async () => {
    await admin.req('POST', C2, { prompt: 'hi' });
    const r = await admin.req('POST', C1, { prompt: 'hi' });
    expect([r.status, r.body.code]).toEqual([429, 'RATE_LIMITED']);
  });
});

describe('claude CLI runner (fake claude script, no network)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axion-cloud-'));
  const home = join(dir, 'home');
  const log = join(dir, 'log.json');
  const bin = join(dir, 'claude');
  // The fake records argv, env, cwd and stdin, then behaves as FAKE_MODE (read from the prompt, since the env is stripped)
  writeFileSync(bin, `#!${process.execPath}
const fs = require('fs');
let input = '';
process.stdin.on('data', (d) => input += d).on('end', () => {
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd(), input }));
  if (input.startsWith('SLEEP')) return setTimeout(() => {}, 60000);
  if (input.startsWith('EXIT')) { process.stderr.write('boom ' + process.env.CLAUDE_CODE_OAUTH_TOKEN); process.exit(3); }
  if (input.startsWith('APIERR')) { process.stdout.write(JSON.stringify({ type: 'result', is_error: true, subtype: 'success', api_error_status: 401, result: 'bad token ' + process.env.CLAUDE_CODE_OAUTH_TOKEN })); return; }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'pong', usage: { input_tokens: 11, output_tokens: 2 } }));
});
`);
  chmodSync(bin, 0o755);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (prompt: string, timeoutMs = 10_000) => claudeCliAdapter({ token: SECRET, model: 'claude-opus-5-5', bin, home, timeoutMs }).complete({ prompt, system: 'sys' });

  it('answers through the CLI with every tool, setting source, MCP server and saved session off', async () => {
    process.env.DATABASE_URL_PROBE = 'must-not-leak';
    const r = await run('ping please');
    expect(r).toMatchObject({ text: 'pong', usage: { input: 11, output: 2 } });
    const l = JSON.parse(readFileSync(log, 'utf8'));
    expect(l.argv).toEqual(['-p', '--model', 'claude-opus-5-5', '--output-format', 'json', '--system-prompt', 'sys', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence']);
    expect(l.input).toBe('ping please'); // the prompt goes on stdin, never in argv
    expect(l.argv.join(' ')).not.toMatch(/ping please|sk-ant/);
    expect(l.cwd).toBe(home);
    expect(Object.keys(l.env).filter((k) => !/^(PATH|HOME|CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH_TOKEN|DISABLE_AUTOUPDATER|DISABLE_TELEMETRY|DISABLE_ERROR_REPORTING|PWD|SHLVL|_)$/.test(k))).toEqual([]);
    expect(l.env.HOME).toBe(home);
    expect(l.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(SECRET);
    expect(existsSync(home)).toBe(true);
    delete process.env.DATABASE_URL_PROBE;
  });

  it('a CLI error, an API error and a timeout are typed failures with the token scrubbed', async () => {
    const e1 = await run('EXIT').catch((e) => e);
    expect(e1).toBeInstanceOf(CloudCallError); expect(e1.kind).toBe('failed');
    expect(e1.message).toMatch(/exit 3/); expect(e1.message).not.toContain(SECRET);
    const e2 = await run('APIERR').catch((e) => e);
    expect(e2.kind).toBe('failed'); expect(e2.message).toMatch(/401/); expect(e2.message).toContain('<token>'); expect(e2.message).not.toContain(SECRET);
    const e3 = await run('SLEEP', 400).catch((e) => e);
    expect(e3.kind).toBe('timeout');
  });

  it('model ids are checked (no flag injection), and the env decides whether the model is on', () => {
    expect(() => cliArgs('--dangerously-skip-permissions', 's')).toThrow(/model/);
    expect(() => claudeCliAdapter({ token: SECRET, model: 'gpt-5', bin, home, timeoutMs: 5000 })).toThrow(/model/);
    const T = (n: string) => SECRET + n;
    expect(cloudAdaptersFromEnv({}, home)).toEqual([]);
    expect(cloudAdaptersFromEnv({ CLAUDE_CODE_OAUTH_TOKEN1: '  ' }, home)).toEqual([]);
    expect(cloudAdaptersFromEnv({ CLAUDE_CODE_OAUTH_TOKEN1: T('1'), CLAUDE_BIN: join(dir, 'missing') }, home)).toEqual([]);
    // TOKEN1 and TOKEN2 (the owner's .env), plus a TOKEN10 to prove numeric order; unrelated names are ignored
    const list = cloudAdaptersFromEnv({ CLAUDE_CODE_OAUTH_TOKEN2: T('2'), CLAUDE_CODE_OAUTH_TOKEN10: T('10'), CLAUDE_CODE_OAUTH_TOKEN1: T('1'), CLAUDE_CODE_OAUTH_TOKENX: 'x', CLAUDE_BIN: bin, CLOUD_MODEL2: 'claude-sonnet-5-5' }, home);
    expect(list.map((a) => [a.id, a.label, a.tokenVar, a.model])).toEqual([
      ['claude-1', 'Claude 1', 'CLAUDE_CODE_OAUTH_TOKEN1', 'claude-opus-5-5'],
      ['claude-2', 'Claude 2', 'CLAUDE_CODE_OAUTH_TOKEN2', 'claude-sonnet-5-5'],
      ['claude-10', 'Claude 10', 'CLAUDE_CODE_OAUTH_TOKEN10', 'claude-opus-5-5'],
    ]);
    expect(JSON.stringify(list)).not.toContain(SECRET); // tokens live in closures, not on the objects
    expect(cloudAdaptersFromEnv({ CLAUDE_CODE_OAUTH_TOKEN: T('0'), CLAUDE_BIN: bin, CLOUD_MODEL: 'claude-haiku-5-5' }, home).map((a) => [a.id, a.label, a.model])).toEqual([['claude', 'Claude', 'claude-haiku-5-5']]);
    expect(() => cloudAdaptersFromEnv({ CLAUDE_CODE_OAUTH_TOKEN1: T('1'), CLAUDE_BIN: bin, CLOUD_MODEL1: 'x; rm' }, home)).toThrow(/CLOUD_MODEL1/);
    expect(() => cloudAdaptersFromEnv({ CLAUDE_CODE_OAUTH_TOKEN1: T('1'), CLAUDE_BIN: bin, CLOUD_MODEL_TIMEOUT_MS: '10' }, home)).toThrow(/TIMEOUT/);
  });

  it('each token runs with its own token and its own private home (separate accounts never share CLI state)', async () => {
    const [a1, a2] = cloudAdaptersFromEnv({ CLAUDE_CODE_OAUTH_TOKEN1: SECRET + 'one', CLAUDE_CODE_OAUTH_TOKEN2: SECRET + 'two', CLAUDE_BIN: bin }, home);
    await a1.complete({ prompt: 'p1', system: 's' });
    const l1 = JSON.parse(readFileSync(log, 'utf8'));
    await a2.complete({ prompt: 'p2', system: 's' });
    const l2 = JSON.parse(readFileSync(log, 'utf8'));
    expect([l1.env.CLAUDE_CODE_OAUTH_TOKEN, l2.env.CLAUDE_CODE_OAUTH_TOKEN]).toEqual([SECRET + 'one', SECRET + 'two']);
    expect([l1.env.HOME, l2.env.HOME]).toEqual([join(home, 'claude-1'), join(home, 'claude-2')]);
    expect([l1.cwd, l2.cwd]).toEqual([join(home, 'claude-1'), join(home, 'claude-2')]);
  });
});
