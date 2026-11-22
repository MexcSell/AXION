import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { domainToASCII } from 'node:url';
import { registrableDomain } from '../src/grants/psl.ts';
import { normaliseOrigin } from '../src/grants/origin.ts';

// c56 item 3: the PSL project's published test vectors (CC0), run against our algorithm and our origin normaliser.
const text = readFileSync(new URL('./fixtures/test_psl.txt', import.meta.url), 'utf8');
const vectors = [...text.matchAll(/^checkPublicSuffix\((null|'[^']*'),\s*(null|'[^']*')\);/gm)].map((m) => [m[1] === 'null' ? null : m[1].slice(1, -1), m[2] === 'null' ? null : m[2].slice(1, -1)] as const);
const RESERVED = new Set(['example']);
const ascii = (s: string) => /^[\x00-\x7f]*$/.test(s);

describe('psl test vectors', () => {
  it('parses the whole vector file', () => { expect(vectors.length).toBeGreaterThanOrEqual(70); });
  it.each(vectors.map((v) => [String(v[0]), v] as const))('registrableDomain(%s)', (_n, [input, want]) => {
    const got = registrableDomain(input as string);
    // the published expectations are lowercase; unicode ones are compared in their ASCII form
    expect(got).toBe(want === null ? null : ascii(want) ? want : domainToASCII(want));
  });
  describe('as grant origins', () => {
    const host = vectors.filter(([i]) => i !== null && ascii(i) && !i.startsWith('.') && i.includes('.') && !i.includes('xn--') && !/[A-Z]/.test(i) && !RESERVED.has(i.split('.').pop()!));
    it('has vectors that apply to hostnames we accept', () => { expect(host.length).toBeGreaterThan(40); });
    it.each(host.map((v) => [v[0]!, v] as const))('https://%s', (_n, [input, want]) => {
      const r = normaliseOrigin('https://' + input);
      if (want === null) expect(r).toEqual({ ok: false, reason: 'public_suffix' }); // the host is itself a public suffix
      else expect(r).toEqual({ ok: true, origin: 'https://' + input }); // a registrable domain or a name under one is accepted as the exact origin
    });
  });
  describe('IDN entries stay refused (c36; P4a is separate)', () => {
    const idn = vectors.filter(([i]) => i !== null && (!ascii(i) || i.includes('xn--')) && !i.startsWith('.'));
    it('has IDN vectors', () => { expect(idn.length).toBeGreaterThan(10); });
    it.each(idn.map((v) => [v[0]!] as const))('https://%s is refused', (input) => { expect(normaliseOrigin('https://' + input).ok).toBe(false); });
  });
});
