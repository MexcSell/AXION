import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCliAdapter, cloudAdaptersFromEnv } from '../src/cloud/claude-cli.ts';

/** Evolve step 1: in the container the chat CLI reaches Anthropic only through the egress proxy; nothing else of the parent env may reach the child. */
const SECRET = 'sk-ant-oat01-TEST-SECRET-never-shown';
const BASE = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'DISABLE_ERROR_REPORTING', 'DISABLE_TELEMETRY', 'HOME', 'PATH'];
const PROXY = ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'HTTPS_PROXY', 'NO_PROXY'];

describe('claude child env and the egress proxy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axion-cloud-env-'));
  const home = join(dir, 'home');
  const log = join(dir, 'log.json');
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!${process.execPath}
let input = '';
process.stdin.on('data', (d) => input += d).on('end', () => {
  require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ env: process.env }));
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'pong', usage: { input_tokens: 1, output_tokens: 1 } }));
});
`);
  chmodSync(bin, 0o755);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const childKeys = async (parent: NodeJS.ProcessEnv) => {
    await claudeCliAdapter({ token: SECRET, model: 'claude-opus-5-5', bin, home, timeoutMs: 10_000, env: parent }).complete({ prompt: 'x', system: 's' });
    const env = JSON.parse(readFileSync(log, 'utf8')).env as Record<string, string>;
    return { env, keys: Object.keys(env).filter((k) => !/^(PWD|SHLVL|_|OLDPWD)$/.test(k)).sort() };
  };

  it('has no proxy keys when HTTPS_PROXY is unset or empty, even if NO_PROXY or other proxy variables are set', async () => {
    expect((await childKeys({ NO_PROXY: 'x', HTTP_PROXY: 'http://h:1', ALL_PROXY: 'http://h:1' })).keys).toEqual(BASE);
    expect((await childKeys({ HTTPS_PROXY: '' })).keys).toEqual(BASE);
  });

  it('gets exactly HTTPS_PROXY, NO_PROXY and CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC added when HTTPS_PROXY is set', async () => {
    const r = await childKeys({ HTTPS_PROXY: 'http://proxy.internal:3128', NO_PROXY: 'localhost,127.0.0.1', DATABASE_URL: 'postgresql://secret', HTTP_PROXY: 'http://other:1' });
    expect(r.keys).toEqual([...BASE, ...PROXY].sort());
    expect(r.env.HTTPS_PROXY).toBe('http://proxy.internal:3128');
    expect(r.env.NO_PROXY).toBe('localhost,127.0.0.1');
    expect(r.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(JSON.stringify(r.env)).not.toMatch(/secret|other:1/);
    expect((await childKeys({ HTTPS_PROXY: 'http://proxy.internal:3128' })).keys).toEqual([...BASE, ...PROXY].sort()); // NO_PROXY is carried even when the parent has none
  });

  it('cloudAdaptersFromEnv hands its env to the adapter, so a proxy in that env reaches the child', async () => {
    const env = { PATH: '', CLAUDE_BIN: bin, CLAUDE_CODE_OAUTH_TOKEN1: SECRET, HTTPS_PROXY: 'http://proxy.internal:3128' };
    const [a] = cloudAdaptersFromEnv(env, home);
    await a!.complete({ prompt: 'x', system: 's' });
    expect(JSON.parse(readFileSync(log, 'utf8')).env.HTTPS_PROXY).toBe('http://proxy.internal:3128');
  });
});
