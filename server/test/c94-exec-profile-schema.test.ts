import { describe, it, expect } from 'vitest';
import { EXEC_PROFILE_VERSION, ISOLATION_TIERS, tierRank, canonicalJson } from '../../shared/contracts/src/exec-profile.ts';
import { execProfileSha256 } from '../src/exec-profile/hash.ts';
import { goodProfile } from './fixtures/exec-profile-good.ts';

// c94 item 1: the versioned execution profile and its canonical sha256. This is a record shape only; nothing here enforces anything.
describe('exec profile schema', () => {
  it('is versioned and has three ordered isolation tiers, process the weakest', () => {
    expect(EXEC_PROFILE_VERSION).toBe(1);
    expect([...ISOLATION_TIERS]).toEqual(['process', 'container', 'microvm']);
    expect(tierRank('process')).toBeLessThan(tierRank('container'));
    expect(tierRank('container')).toBeLessThan(tierRank('microvm'));
  });
  it('hash is 64 hex chars, deterministic, and independent of key order', () => {
    const a = goodProfile();
    const h = execProfileSha256(a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(execProfileSha256(goodProfile())).toBe(h);
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse())));
    expect(execProfileSha256(reordered)).toBe(h);
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
  it('hash changes when ANY field changes (every leaf mutated one at a time)', () => {
    const base = execProfileSha256(goodProfile());
    const seen = new Set<string>([base]);
    const paths: (string | number)[][] = [];
    const walk = (v: unknown, p: (string | number)[]) => {
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...p, i])); paths.push([...p, v.length]); }
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...p, k]);
      else paths.push(p);
    };
    walk(goodProfile(), []);
    expect(paths.length).toBeGreaterThanOrEqual(25);
    for (const p of paths) {
      const o = goodProfile() as unknown as Record<string | number, unknown>;
      let cur: Record<string | number, unknown> = o;
      for (const k of p.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
      const last = p[p.length - 1];
      const old = cur[last];
      cur[last] = typeof old === 'number' ? old + 1 : typeof old === 'boolean' ? !old : typeof old === 'string' ? old + 'x' : 'added';
      const h = execProfileSha256(o as never);
      expect(h, `mutating ${p.join('.')}`).not.toBe(base);
      seen.add(h);
    }
    expect(seen.size).toBe(paths.length + 1);
  });
});
