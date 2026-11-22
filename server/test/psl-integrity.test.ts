import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseSnapshot } from '../src/grants/psl.ts';

// c56 fix round, ruling 1: a bad snapshot must make the loader throw (the server then refuses to start), never fail open.
const dir = new URL('../src/grants/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('public_suffix_list.manifest.json', dir), 'utf8')) as { list: { sha256: string } };
const real = readFileSync(new URL('public_suffix_list.dat', dir), 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('psl snapshot integrity at load', () => {
  it('accepts the real snapshot with its manifest hash', () => {
    const t = parseSnapshot(real, manifest.list.sha256);
    expect(t.count).toBeGreaterThan(8000);
  });
  it('throws on an empty file', () => { expect(() => parseSnapshot('', manifest.list.sha256)).toThrow(/public suffix list/i); });
  it('throws on a truncated file', () => { expect(() => parseSnapshot(real.slice(0, Math.floor(real.length / 2)), manifest.list.sha256)).toThrow(/public suffix list/i); });
  it('throws on a one-byte edit', () => {
    const i = real.indexOf('co.uk');
    const edited = real.slice(0, i) + 'cx' + real.slice(i + 2);
    expect(() => parseSnapshot(edited, manifest.list.sha256)).toThrow(/sha-256/i);
  });
  it('sanity floor: a self-consistent hash does not save an empty or truncated file', () => {
    expect(() => parseSnapshot('', sha(''))).toThrow(/rules|sentinel/i);
    const half = real.slice(0, Math.floor(real.length / 2));
    expect(() => parseSnapshot(half, sha(half))).toThrow(/rules|sentinel/i);
  });
  it('sentinel rules are required', () => {
    const noSentinel = real.split('\n').filter((l) => l.trim() !== 'github.io').join('\n');
    expect(() => parseSnapshot(noSentinel, sha(noSentinel))).toThrow(/sentinel/i);
    const noEx = real.split('\n').filter((l) => l.trim() !== '!www.ck').join('\n');
    expect(() => parseSnapshot(noEx, sha(noEx))).toThrow(/sentinel/i);
  });
});
