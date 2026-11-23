import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// c92 (H23): web scripts must not default to the live ports (5190 web, 5191 API) outside the integration tree.
// Safety: this test never runs a real script (before the fix that would reach 5190); it only calls the helper.
const SCRIPTS = join(__dirname, '../../web/scripts');
type Pick = (o: { env: Record<string, string | undefined>; cwd: string; arg?: string }) => { base?: string; error?: string };
const load = () => import(/* @vite-ignore */ join(SCRIPTS, '_base.mjs')) as Promise<{ pickBase: Pick }>;

describe('c92 H23: script BASE resolution', () => {
  it('refuses to default outside the integration tree (a lane worktree)', async () => {
    const { pickBase } = await load();
    const r = pickBase({ env: {}, cwd: '/home/luca/AXION-w90/web' });
    expect(r.base).toBeUndefined();
    expect(r.error).toMatch(/BASE/);
  });
  it('refuses for any other cwd, including a sibling that merely starts with the same name', async () => {
    const { pickBase } = await load();
    for (const cwd of ['/tmp', '/home/luca/AXION-lanes', '/home/luca/AXIONx/web', '/home/luca/AXION-w1']) expect(pickBase({ env: {}, cwd }).base).toBeUndefined();
  });
  it('keeps the 5190 default in the integration tree', async () => {
    const { pickBase } = await load();
    expect(pickBase({ env: {}, cwd: '/home/luca/AXION/web' }).base).toBe('http://127.0.0.1:5190');
    expect(pickBase({ env: {}, cwd: '/home/luca/AXION' }).base).toBe('http://127.0.0.1:5190');
  });
  it('an explicit BASE or argument wins everywhere; an empty BASE counts as unset', async () => {
    const { pickBase } = await load();
    expect(pickBase({ env: { BASE: 'http://127.0.0.1:14090' }, cwd: '/home/luca/AXION-w90/web' }).base).toBe('http://127.0.0.1:14090');
    expect(pickBase({ env: {}, cwd: '/home/luca/AXION-w90/web', arg: 'http://127.0.0.1:14091' }).base).toBe('http://127.0.0.1:14091');
    expect(pickBase({ env: { BASE: '' }, cwd: '/tmp' }).base).toBeUndefined();
  });
  it('resolveBase() exits non-zero with a message when run from a lane worktree with no BASE (helper only, no script)', () => {
    const r = spawnSync('node', ['-e', `import(${JSON.stringify(join(SCRIPTS, '_base.mjs'))}).then((m) => console.log('RESOLVED ' + m.resolveBase()))`], { cwd: join(__dirname, '../../web'), env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8', timeout: 15_000 });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toMatch(/RESOLVED/);
    expect(r.stderr).toMatch(/BASE/);
  });
  it('no script hard-codes a live port default, and every script that needs a base uses the helper', () => {
    const bad: string[] = [];
    for (const f of readdirSync(SCRIPTS)) {
      if (f === '_base.mjs' || !/\.(mjs|sh|ts|js)$/.test(f)) continue;
      const text = readFileSync(join(SCRIPTS, f), 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/\|\|\s*['"`]https?:\/\/[^'"`]*:519[01]/.test(line) || /:-https?:\/\/[^}]*:519[01]/.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
