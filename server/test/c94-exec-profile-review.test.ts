import { describe, it, expect } from 'vitest';
import { validateExecProfile } from '../src/exec-profile/validator.ts';
import { decideUrl, decidePath, decideRequests } from '../src/exec-profile/decider.ts';
import { goodProfile } from './fixtures/exec-profile-good.ts';

// c94 review round: profile accessors (TOCTOU), pattern ReDoS, sensitive scopes.
describe('profile snapshot: accessors and proxies', () => {
  it('a getter that changes between reads cannot smuggle an origin past validation', () => {
    const p = goodProfile() as any; let reads = 0;
    Object.defineProperty(p.network, 'allowedOrigins', { enumerable: true, get() { reads++; return reads <= 3 ? ['https://good.com'] : ['https://evil.com']; } });
    const v = validateExecProfile(p);
    expect(v.ok).toBe(false);
    expect(decideUrl(p, { url: 'https://evil.com/' }).allow).toBe(false);
    expect(decideUrl(p, { url: 'https://good.com/' }).allow).toBe(false);
  });
  it.each([
    ['getter on a top-level field', (p: any) => { Object.defineProperty(p, 'name', { enumerable: true, get: () => 'x' }); }],
    ['getter inside limits', (p: any) => { Object.defineProperty(p.limits, 'pids', { enumerable: true, get: () => 10 }); }],
    ['getter on an array element', (p: any) => { Object.defineProperty(p.network.allowedOrigins, 0, { enumerable: true, get: () => 'https://good.com' }); }],
    ['proxy as the network block', (p: any) => { p.network = new Proxy(p.network, {}); }],
    ['proxy as an array', (p: any) => { p.filesystem.writablePaths = new Proxy(p.filesystem.writablePaths, {}); }],
    ['proxy as the profile', (p: any) => new Proxy(p, {})],
    ['symbol key', (p: any) => { p[Symbol('x')] = 1; }],
    ['non-plain prototype', (p: any) => Object.setPrototypeOf(p.limits, { extra: 1 })],
    ['class instance', (p: any) => { p.network = new (class N { default = 'deny'; allowedOrigins = []; blockedRanges = []; })(); }],
    ['function value', (p: any) => { p.name = () => 'x'; }],
    ['cycle', (p: any) => { p.self = p; }],
  ])('refuses %s', (_n, mut) => {
    const p = goodProfile(); const r = mut(p); const input = r !== undefined ? r : p;
    expect(validateExecProfile(input).ok).toBe(false);
    expect(decideRequests(input, { urls: [{ url: 'https://good.com/' }] }).allowed).toBe(false);
  });
  it('the returned profile is a detached clone: changing the input later does not change it', () => {
    const p = goodProfile(); const v = validateExecProfile(p);
    p.network.allowedOrigins.push('https://evil.com'); p.limits.pids = 1;
    expect(v.ok && v.profile.network.allowedOrigins).toEqual(['https://good.com', 'https://api.example.org:8443']);
    expect(v.ok && v.profile.limits.pids).toBe(128);
  });
});

describe('pattern ReDoS', () => {
  it('refuses hostile patterns as bad_pattern', () => {
    for (const g of ['**/'.repeat(8) + 'zz', '**/'.repeat(10) + 'zz', '**/'.repeat(60) + 'zz', '*'.repeat(50) + 'a', 'a'.repeat(300), '**/a/**/b/**/c/**/d/**/e']) {
      const p = goodProfile(); p.filesystem.forbiddenPatterns = [g];
      const r = validateExecProfile(p);
      expect(r.ok, g.slice(0, 30)).toBe(false);
      if (!r.ok) expect(r.refusals.map((x) => x.code)).toContain('bad_pattern');
    }
    const many = goodProfile(); many.filesystem.forbiddenPatterns = Array.from({ length: 40 }, (_, i) => `**/x${i}`);
    expect(validateExecProfile(many).ok).toBe(false);
  });
  it('a worst-case allowed pattern decides a 4096-char path in under 50 ms', () => {
    const p = goodProfile(); p.filesystem.forbiddenPatterns = ['**/a*a*a*a*a*a*a*a*a*b', '**/**/*?*?*?*?*z'];
    const path = '/work/out/' + 'a'.repeat(4096 - 10);
    expect(path.length).toBe(4096);
    decidePath(p, { path, access: 'write' });
    const t = performance.now();
    const d = decidePath(p, { path, access: 'write' });
    expect(performance.now() - t).toBeLessThan(50);
    expect(d.allow).toBe(true);
  });
  it('glob semantics still hold', () => {
    const p = goodProfile(); p.filesystem.forbiddenPatterns = ['**/secret-?/**', '**/*.tok'];
    for (const [path, allow] of [['/work/out/secret-1/a', false], ['/work/out/secret-12/a', true], ['/work/out/a/b.tok', false], ['/work/out/b.TOK', false], ['/work/out/b.tokx', true]] as const) expect(decidePath(p, { path, access: 'write' }).allow, path).toBe(allow);
  });
});

describe('sensitive scopes', () => {
  it.each(['/etc', '/etc/ssl', '/proc', '/proc/self', '/root', '/root/work', '/sys', '/sys/fs', '/dev', '/dev/shm', '/'])('refuses %s as writable and as read-only scope', (d) => {
    for (const key of ['writablePaths', 'readOnlyPaths'] as const) {
      const p = goodProfile(); p.filesystem[key] = [d];
      const r = validateExecProfile(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusals.map((x) => x.code)).toContain('path_too_broad');
    }
  });
  it('does not refuse look-alike names', () => {
    const p = goodProfile(); p.filesystem.readOnlyPaths = ['/etcetera/data', '/devices/x', '/rooted'];
    expect(validateExecProfile(p).ok).toBe(true);
  });
});
