import { describe, it, expect } from 'vitest';
import { decideRequests, decideUrl, decidePath, DECISION_REASONS } from '../src/exec-profile/decider.ts';
import { validateExecProfile } from '../src/exec-profile/validator.ts';
import { goodProfile } from './fixtures/exec-profile-good.ts';

// c94 item 4: unknown fields, unparsable URLs and anything unexpected give deny, never allow. Nothing throws.
const profile = goodProfile();
const throwing = () => new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); }, has() { throw new Error('boom'); }, getOwnPropertyDescriptor() { throw new Error('boom'); } });
const denied = (r: { allowed: boolean; items: { allow: boolean }[] }) => { expect(r.allowed).toBe(false); expect(r.items.every((i) => !i.allow)).toBe(true); };

describe('fail closed: the request', () => {
  it('has reason codes for malformed requests and items', () => { expect(DECISION_REASONS).toContain('request_malformed'); expect(DECISION_REASONS).toContain('item_malformed'); });
  it.each([
    ['null', null], ['undefined', undefined], ['string', 'https://good.com'], ['number', 1], ['array', []], ['function', () => 1], ['symbol', Symbol('x')], ['bigint', 10n],
    ['unknown top-level field', { urls: [{ url: 'https://good.com/' }], extra: 1 }],
    ['__proto__ key', JSON.parse('{"urls":[{"url":"https://good.com/"}],"__proto__":{"x":1}}')],
    ['urls not an array', { urls: 'https://good.com/' }], ['urls an object', { urls: { url: 'https://good.com/' } }],
    ['paths not an array', { paths: '/work/out/a' }], ['neither list', {}],
    ['too many items', { urls: Array.from({ length: 5000 }, () => ({ url: 'https://good.com/' })) }],
    ['throwing proxy', throwing()],
    ['throwing getter', { get urls() { throw new Error('boom'); } }],
  ])('denies the whole request: %s', (_n, req) => {
    let r: ReturnType<typeof decideRequests> | undefined;
    expect(() => { r = decideRequests(profile, req as never); }).not.toThrow();
    denied(r!);
    expect(r!.items.length === 0 || r!.items.every((i) => i.reason === 'request_malformed' || i.reason === 'item_malformed')).toBe(true);
  });
});

describe('fail closed: items', () => {
  it.each([
    ['null item', null], ['string item', 'https://good.com/'], ['number item', 5], ['array item', ['https://good.com/']],
    ['unknown item field', { url: 'https://good.com/', method: 'POST' }], ['__proto__ in item', JSON.parse('{"url":"https://good.com/","__proto__":{"a":1}}')],
    ['url missing', {}], ['url number', { url: 5 }], ['url null', { url: null }], ['url object', { url: { href: 'https://good.com/' } }], ['url array', { url: ['https://good.com/'] }],
    ['redirects a string', { url: 'https://good.com/', redirects: 'https://good.com/' }], ['redirects an object', { url: 'https://good.com/', redirects: { 0: 'https://good.com/' } }], ['redirects null', { url: 'https://good.com/', redirects: null }],
    ['throwing item', throwing()],
  ])('url item is denied: %s', (_n, item) => {
    const r = decideRequests(profile, { urls: [item as never] });
    denied(r);
    expect(r.items.length).toBe(1);
    expect(r.items[0].reason).toBe('item_malformed');
  });
  it.each([
    ['null item', null], ['string item', '/work/out/a'], ['unknown item field', { path: '/work/out/a', access: 'write', mode: '777' }],
    ['path missing', { access: 'read' }], ['access missing', { path: '/work/out/a' }], ['access execute', { path: '/work/out/a', access: 'execute' }], ['access delete', { path: '/work/out/a', access: 'delete' }],
    ['access upper case', { path: '/work/out/a', access: 'WRITE' }], ['path number', { path: 5, access: 'read' }], ['path array', { path: ['/work/out/a'], access: 'read' }],
    ['throwing item', throwing()],
  ])('path item is denied: %s', (_n, item) => {
    const r = decideRequests(profile, { paths: [item as never] });
    denied(r);
    expect(r.items[0].reason).toBe('item_malformed');
  });
  it('one malformed item cannot hide inside a list of good ones', () => {
    const r = decideRequests(profile, { urls: [{ url: 'https://good.com/' }, null as never, { url: 'https://good.com/b' }] });
    expect(r.items.map((i) => i.allow)).toEqual([true, false, true]);
    expect(r.allowed).toBe(false);
  });
});

describe('fail closed: unparsable URLs and odd paths', () => {
  const urls = ['', ' ', 'https://', 'https://[', 'https://[::1', 'https:// ', 'https://good.com:99999999999999999999/', 'https://' + 'a'.repeat(5000) + '.com/', 'https://good.com/' + 'a'.repeat(100000), '\ud800', 'https://good.com/\ud800', 'https://good.com/\udfff', '::::', 'https://good.com:443:443/', 'https://good.com/\u0000', 'https://good.com/ ', 'https://good.com/ x', 'https://good.com/﻿'];
  it.each(urls.map((u) => [JSON.stringify(u).slice(0, 40), u] as const))('denies the URL %s without throwing', (_n, u) => {
    expect(() => decideUrl(profile, { url: u })).not.toThrow();
    expect(decideUrl(profile, { url: u }).allow).toBe(false);
  });
  it.each([['\ud800'], ['/work/out/\ud800'], ['/work/out/' + 'a'.repeat(100000)], ['/work/out/ x'], ['/work/out/‮x']])('denies the path %#', (p) => {
    expect(() => decidePath(profile, { path: p, access: 'read' })).not.toThrow();
    expect(decidePath(profile, { path: p, access: 'read' }).allow).toBe(false);
  });
});

describe('fail closed: the profile', () => {
  it.each([
    ['unknown top-level field', (p: any) => { p.shell = 'allow'; }], ['unknown network field', (p: any) => { p.network.proxy = 'x'; }],
    ['throwing getter on the profile', (p: any) => { Object.defineProperty(p, 'tier', { get() { throw new Error('boom'); }, enumerable: true }); }],
  ])('a profile with %s denies everything and never throws', (_n, mut) => {
    const p = goodProfile(); mut(p);
    let r: ReturnType<typeof decideRequests> | undefined;
    expect(() => { r = decideRequests(p, { urls: [{ url: 'https://good.com/' }], paths: [{ path: '/work/out/a', access: 'write' }] }); }).not.toThrow();
    denied(r!);
    expect(r!.items.every((i) => i.reason === 'profile_invalid')).toBe(true);
  });
  it('an unvalidated profile that is not an object denies everything', () => {
    for (const p of [null, undefined, 'x', 1, [], throwing()]) denied(decideRequests(p, { urls: [{ url: 'https://good.com/' }] }));
  });
  it('mutating the profile after validation cannot change a decision made from the copy', () => {
    const p = goodProfile(); const v = validateExecProfile(p);
    expect(v.ok).toBe(true);
    p.network.allowedOrigins.push('https://evil.com');
    if (v.ok) expect(decideUrl(v.profile, { url: 'https://evil.com/' }).allow).toBe(false);
  });
});
