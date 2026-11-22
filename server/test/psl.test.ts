import { describe, it, expect } from 'vitest';
import { isPublicSuffix, publicSuffixOf, registrableDomain, PSL_RULE_COUNT } from '../src/grants/psl.ts';
import { normaliseOrigin, REFUSAL_TEXT } from '../src/grants/origin.ts';

// c56 item 2: the PSL algorithm (normal, wildcard and exception rules; ICANN and PRIVATE sections) over the pinned snapshot.
describe('psl algorithm', () => {
  it('loads a full snapshot, not a hand-written list', () => { expect(PSL_RULE_COUNT).toBeGreaterThan(8000); });
  it('plain, wildcard and exception rules', () => {
    expect(publicSuffixOf('foo.co.uk')).toBe('co.uk');
    expect(publicSuffixOf('a.b.test.ck')).toBe('test.ck'); // *.ck
    expect(publicSuffixOf('www.ck')).toBe('ck'); // !www.ck
    expect(publicSuffixOf('www.city.kawasaki.jp')).toBe('kawasaki.jp'); // !city.kawasaki.jp
    expect(isPublicSuffix('x.kawasaki.jp')).toBe(true);
    expect(isPublicSuffix('city.kawasaki.jp')).toBe(false);
  });
  it('private section rules count as suffixes', () => {
    expect(isPublicSuffix('myshopify.com')).toBe(true);
    expect(isPublicSuffix('s3.amazonaws.com')).toBe(true);
    expect(isPublicSuffix('eu-1.compute.amazonaws.com')).toBe(true); // *.compute.amazonaws.com
    expect(isPublicSuffix('shop.myshopify.com')).toBe(false);
  });
  it('an unlisted TLD falls back to the implicit * rule', () => {
    expect(publicSuffixOf('a.b.nosuchtld')).toBe('nosuchtld');
    expect(registrableDomain('a.b.nosuchtld')).toBe('b.nosuchtld');
  });
});

describe('normaliseOrigin refuses public suffixes from the full list', () => {
  const refused = ['https://test.ck', 'https://x.kawasaki.jp', 'https://myshopify.com', 'https://eu-1.compute.amazonaws.com', 'https://ide.kyoto.jp', 'https://uk.com', 'https://co.uk', 'https://github.io', 'https://s3.amazonaws.com:8443'];
  it.each(refused)('refuses %s with public_suffix', (o) => { expect(normaliseOrigin(o)).toEqual({ ok: false, reason: 'public_suffix' }); });
  const accepted: [string, string][] = [['https://www.ck', 'https://www.ck'], ['https://city.kawasaki.jp', 'https://city.kawasaki.jp'], ['https://shop.myshopify.com', 'https://shop.myshopify.com'], ['https://user.github.io', 'https://user.github.io'], ['https://example.co.uk', 'https://example.co.uk']];
  it.each(accepted)('accepts %s', (i, o) => { expect(normaliseOrigin(i)).toEqual({ ok: true, origin: o }); });
  it('the refusal text explains a public suffix in plain words', () => {
    expect(REFUSAL_TEXT.public_suffix).toMatch(/public suffix/i);
    expect(REFUSAL_TEXT.public_suffix).toMatch(/shared|everyone|every site/i);
    expect(REFUSAL_TEXT.public_suffix).toMatch(/github\.io/);
  });
});
