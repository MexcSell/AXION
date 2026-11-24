import { describe, it, expect } from 'vitest';
import { decideRequests } from '../src/exec-profile/decider.ts';
import { goodProfile } from './fixtures/exec-profile-good.ts';

// c99 X1-2b (review round, the cap must not be read twice): a list is copied once, so a Proxy that answers `length` differently on each read cannot get past the cap.
const goodPaths = (n: number) => Array.from({ length: n }, () => ({ path: '/work/out/a.txt', access: 'write' as const }));
/** a Proxy over `n` good items whose `length` is given by `answer(readIndex)` */
const lying = (n: number, answer: (read: number) => number) => { let reads = 0; return { proxy: new Proxy(goodPaths(n), { get(t, k, r) { if (k === 'length') return answer(reads++); return Reflect.get(t, k, r); } }), reads: () => reads }; };

describe('c99 X1-2b: lists are read once', () => {
  it('two proxies that say 0 on the first read and 256 afterwards: never more than 256 items are decided', () => {
    const a = lying(256, (i) => (i === 0 ? 0 : 256)); const b = lying(256, (i) => (i === 0 ? 0 : 256));
    const d = decideRequests(goodProfile(), { urls: b.proxy, paths: a.proxy } as never);
    expect(d.items.length).toBeLessThanOrEqual(256);
    expect(a.reads()).toBe(1); expect(b.reads()).toBe(1);
  });
  it('a length that alternates 0, 256, 0, 256 cannot double the cap', () => {
    const mk = () => lying(256, (i) => (i % 2 === 0 ? 0 : 256));
    const a = mk(); const b = mk();
    const d = decideRequests(goodProfile(), { urls: b.proxy, paths: a.proxy } as never);
    expect(d.items.length).toBeLessThanOrEqual(256);
  });
  it('a length that keeps growing is read once and the loop stops there', () => {
    const g = lying(10, (i) => 10 + i);
    const d = decideRequests(goodProfile(), { paths: g.proxy } as never);
    expect(g.reads()).toBe(1);
    expect(d.items.length).toBeLessThanOrEqual(10);
  });
  it('two honest lists of 256 each are over the cap together, and the check uses the copies', () => {
    const d = decideRequests(goodProfile(), { urls: Array.from({ length: 256 }, () => ({ url: 'https://good.com/' })), paths: goodPaths(256) });
    expect(d.allowed).toBe(false);
    expect(d.items.length).toBe(1);
    expect(d.items[0].reason).toBe('too_many_items');
  });
  it('a length that is not a non-negative integer is a malformed request, not a pass', () => {
    for (const len of [-1, 1.5, NaN, Infinity]) {
      const a = lying(3, () => len);
      const d = decideRequests(goodProfile(), { paths: a.proxy } as never);
      expect(d.allowed, String(len)).toBe(false);
    }
  });
});
