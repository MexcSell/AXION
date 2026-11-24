import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import { validateExecProfile } from '../src/exec-profile/validator.ts';
import { decideRequests, decideUrl, decidePath, MAX_REQUEST_ITEMS } from '../src/exec-profile/decider.ts';
import { goodProfile } from './fixtures/exec-profile-good.ts';

// c99 X1-2: at most 256 items per decide call, and a stated time bound for a hostile but valid profile.

describe('c99 X1-2: item cap per decide call', () => {
  const urls = (n: number) => Array.from({ length: n }, () => ({ url: 'https://good.com/a' }));
  const paths = (n: number) => Array.from({ length: n }, () => ({ path: '/work/out/a.txt', access: 'write' as const }));
  it('states the cap', () => { expect(MAX_REQUEST_ITEMS).toBe(256); });
  it('exactly the cap is decided normally', () => {
    const d = decideRequests(goodProfile(), { urls: urls(100), paths: paths(156) });
    expect(d.allowed).toBe(true); expect(d.items.length).toBe(256);
  });
  it.each([
    ['257 urls', { urls: urls(257) }],
    ['257 paths', { paths: paths(257) }],
    ['200 urls + 57 paths', { urls: urls(200), paths: paths(57) }],
    ['a sparse array of a million', { urls: new Array(1_000_000) }],
    ['1001 paths (old cap)', { paths: paths(1001) }],
  ])('denies the whole call for %s with too_many_items', (_n, req) => {
    const d = decideRequests(goodProfile(), req);
    expect(d.allowed).toBe(false);
    expect(d.items.length).toBe(1);
    expect(d.items[0].reason).toBe('too_many_items');
    expect(d.items[0].allow).toBe(false);
  });
  it('an over-cap request is denied even when every item is good, and also with an invalid profile', () => {
    expect(decideRequests(goodProfile(), { urls: urls(257) }).allowed).toBe(false);
    const bad = goodProfile(); (bad as any).tier = 'nope';
    const d = decideRequests(bad, { paths: paths(300) });
    expect(d.allowed).toBe(false);
  });
  it('single-item entry points are one item each', () => {
    expect(decideUrl(goodProfile(), { url: 'https://good.com/' }).allow).toBe(true);
    expect(decidePath(goodProfile(), { path: '/work/out/a', access: 'write' }).allow).toBe(true);
  });
  it('time bound: a hostile-but-valid profile with the maximum number of items finishes within 20 s', () => {
    const p = goodProfile();
    // 32 patterns of 128 characters with the allowed wildcard budget, matched against the longest allowed path
    p.filesystem.forbiddenPatterns = Array.from({ length: 32 }, (_, i) => '**/' + 'a*'.repeat(10) + 'a'.repeat(100 - (i % 3)) + 'b');
    expect(validateExecProfile(p).ok).toBe(true);
    const long = '/work/out/' + 'a'.repeat(4096 - 10);
    const req = { paths: Array.from({ length: MAX_REQUEST_ITEMS }, () => ({ path: long, access: 'write' as const })) };
    decideRequests(p, { paths: [req.paths[0]] }); // warm up
    const load = os.loadavg()[0].toFixed(2);
    const t = performance.now();
    const d = decideRequests(p, req);
    const ms = performance.now() - t;
    console.info('C99 X1-2 time: %d items of %d chars, %s ms, load average %s', d.items.length, long.length, ms.toFixed(0), load);
    expect(d.items.length).toBe(MAX_REQUEST_ITEMS);
    expect(ms).toBeLessThan(20_000);
  });
});

