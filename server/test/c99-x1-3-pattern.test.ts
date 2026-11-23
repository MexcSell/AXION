import { describe, it, expect } from 'vitest';
import { validateExecProfile } from '../src/exec-profile/validator.ts';
import { decidePath } from '../src/exec-profile/decider.ts';
import { goodProfile } from './fixtures/exec-profile-good.ts';

// c99 X1-3: patterns whose lower-case form silently never matches are refused or made to match.
const refusalCodes = (p: unknown): string[] => { const r = validateExecProfile(p); return r.ok ? [] : r.refusals.map((x) => x.code); };

describe('c99 X1-3: patterns whose lower-case form changes length are refused', () => {
  it.each([
    ['U+0130 dotted capital I', '**/İ.key'],
    ['U+0130 at the start', 'İnternal/**'],
    ['U+0130 mid-name', '**/confİg/*'],
    ['U+0130 twice', '**/İİ'],
  ])('refuses %s as bad_pattern', (_n, g) => {
    const p = goodProfile(); p.filesystem.forbiddenPatterns = [g];
    expect(refusalCodes(p)).toContain('bad_pattern');
  });
  it('refuses it in any position of the list, naming that entry', () => {
    const p = goodProfile(); p.filesystem.forbiddenPatterns = ['**/.env', '**/ok', '**/İx'];
    const r = validateExecProfile(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals.find((x) => x.code === 'bad_pattern')?.path).toBe('filesystem.forbiddenPatterns[2]');
  });
  it('ordinary non-ASCII patterns that keep their length are still accepted', () => {
    for (const g of ['**/café/*', '**/Über/**', '**/Ж.key', '**/Σx']) {
      const p = goodProfile(); p.filesystem.forbiddenPatterns = [g];
      expect(validateExecProfile(p).ok, g).toBe(true);
    }
  });
  it('a path containing U+0130 is decided without error', () => {
    const d = decidePath(goodProfile(), { path: '/work/out/İ.txt', access: 'write' });
    expect(['allowed', 'path_credential_file', 'path_not_absolute']).toContain(d.reason);
  });
});

describe('c99 X1-3: capital sigma (its lower-case form depends on the neighbours)', () => {
  const sigma = (pattern: string, path: string) => {
    const p = goodProfile(); p.filesystem.forbiddenPatterns = [pattern];
    return decidePath(p, { path, access: 'write' }).allow === false; // true when the pattern caught the path
  };
  it('a pattern ending in capital sigma matches a path ending in capital sigma, final sigma and plain small sigma', () => {
    for (const path of ['/work/out/a\u03a3', '/work/out/a\u03c2', '/work/out/a\u03c3', '/work/out/A\u03a3']) expect(sigma('**/a\u03a3', path), path).toBe(true);
  });
  it('a pattern with small sigma matches a path with capital sigma at the end', () => {
    for (const path of ['/work/out/a\u03a3', '/work/out/a\u03c2', '/work/out/a\u03c3']) expect(sigma('**/a\u03c3', path), path).toBe(true);
  });
  it('sigma in the middle of a name matches too, and an unrelated name does not', () => {
    expect(sigma('**/\u03a3x*', '/work/out/\u03c3xy')).toBe(true);
    expect(sigma('**/a\u03a3', '/work/out/b\u03a3')).toBe(false);
  });
});

