import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decideRequests, decideUrl, decidePath, urlWithinGrantedOrigins } from '../src/exec-profile/decider.ts';
import { goodProfile } from './fixtures/exec-profile-good.ts';

// c94 item 3, threshold (a): every must-deny fixture is denied (with the expected reason) and every explicitly granted case is allowed.
// The decider decides; it enforces nothing and makes no network or DNS call.
interface Fx { id: string; kind: 'url' | 'path'; input: string; redirects?: unknown[]; access?: 'read' | 'write'; expect: 'allow' | 'deny'; reason: string }
const fx = JSON.parse(readFileSync(new URL('./fixtures/exec-profile-requests.json', import.meta.url), 'utf8')) as Fx[];
const hostile = JSON.parse(readFileSync(new URL('./fixtures/hostile-origins.json', import.meta.url), 'utf8')) as { input: unknown; reason: string }[];
// c36 hostile origins that are still hostile when used as a full URL. Entries refused only because they carry a path, query or fragment
// are legitimate URLs on a granted origin, so they are left out (their point as ORIGINS is that a grant has none).
const reused = hostile.filter((h) => typeof h.input === 'string' && h.reason !== 'path' && h.reason !== 'query_or_fragment').map((h) => h.input as string);

const profile = goodProfile();
const decideFx = (f: Fx) => f.kind === 'url' ? decideUrl(profile, { url: f.input, redirects: f.redirects as string[] | undefined }) : decidePath(profile, { path: f.input, access: f.access! });

describe('exec profile decider: own fixtures', () => {
  it('has the required volume', () => {
    expect(fx.length).toBeGreaterThanOrEqual(60);
    expect(fx.filter((f) => f.expect === 'deny').length).toBeGreaterThanOrEqual(60);
    expect(fx.filter((f) => f.expect === 'allow').length).toBeGreaterThanOrEqual(10);
    expect(reused.length).toBeGreaterThanOrEqual(100);
  });
  it.each(fx.map((f) => [f.id, JSON.stringify(f.input).slice(0, 50), f] as const))('%s %s', (_id, _n, f) => {
    const d = decideFx(f);
    expect(d.allow, `${f.id}: ${JSON.stringify(f.input)} -> ${d.reason}`).toBe(f.expect === 'allow');
    expect(d.reason).toBe(f.reason);
  });
  it('threshold a: 100% of must-deny denied, 100% of granted allowed', () => {
    const denyMiss = fx.filter((f) => f.expect === 'deny' && decideFx(f).allow);
    const allowMiss = fx.filter((f) => f.expect === 'allow' && !decideFx(f).allow);
    expect(denyMiss.map((f) => f.id)).toEqual([]);
    expect(allowMiss.map((f) => f.id)).toEqual([]);
  });
});

describe('exec profile decider: reused c36 hostile-origins corpus, as requested URLs against https://good.com', () => {
  it.each(reused.map((s, i) => [i, JSON.stringify(s).slice(0, 60), s] as const))('denies #%i %s', (_i, _n, s) => {
    const d = decideUrl(profile, { url: s });
    expect(d.allow, s).toBe(false);
    expect(d.reason).not.toBe('allowed');
  });
});

describe('exec profile decider: whole requests and the single URL function', () => {
  it('returns one decision per item, and denies the whole request when any item is denied', () => {
    const r = decideRequests(profile, { urls: [{ url: 'https://good.com/a' }, { url: 'https://evil.com/' }], paths: [{ path: '/work/out/a', access: 'write' }, { path: '/work/out/.env', access: 'read' }] });
    expect(r.items.map((i) => i.allow)).toEqual([true, false, true, false]);
    expect(r.items.map((i) => i.reason)).toEqual(['allowed', 'origin_not_granted', 'allowed', 'path_credential_file']);
    expect(r.allowed).toBe(false);
    const ok = decideRequests(profile, { urls: [{ url: 'https://good.com/a', redirects: ['https://good.com/b'] }], paths: [{ path: '/work/in/x', access: 'read' }] });
    expect(ok.allowed).toBe(true);
  });
  it('an empty request is not an allow', () => {
    expect(decideRequests(profile, { urls: [], paths: [] }).allowed).toBe(false);
  });
  it('an invalid profile denies every item', () => {
    const p = goodProfile() as any; p.network.default = 'allow';
    const r = decideRequests(p, { urls: [{ url: 'https://good.com/' }], paths: [{ path: '/work/out/a', access: 'write' }] });
    expect(r.allowed).toBe(false);
    expect(r.items.every((i) => !i.allow && i.reason === 'profile_invalid')).toBe(true);
  });
  it('with no allowed origins, no URL is allowed', () => {
    const p = goodProfile(); p.network.allowedOrigins = [];
    expect(decideUrl(p, { url: 'https://good.com/' }).allow).toBe(false);
  });
  it('a profile forbidden pattern denies a path inside the scope', () => {
    const p = goodProfile(); p.filesystem.forbiddenPatterns.push('**/secret-notes/**');
    expect(decidePath(p, { path: '/work/out/secret-notes/a.txt', access: 'write' })).toMatchObject({ allow: false, reason: 'path_credential_file' });
  });
  it('urlWithinGrantedOrigins checks scheme, host and port against the granted list and returns the origin', () => {
    const g = ['https://good.com', 'https://api.example.org:8443'];
    expect(urlWithinGrantedOrigins('https://good.com:443/x', g)).toEqual({ ok: true, origin: 'https://good.com' });
    expect(urlWithinGrantedOrigins('https://api.example.org:8443/x', g)).toEqual({ ok: true, origin: 'https://api.example.org:8443' });
    expect(urlWithinGrantedOrigins('https://good.com:8443/x', g)).toMatchObject({ ok: false, reason: 'port_mismatch' });
    expect(urlWithinGrantedOrigins('http://good.com/', g)).toMatchObject({ ok: false, reason: 'scheme_not_https' });
  });
  it('makes no network or DNS call', async () => {
    const dns = await import('node:dns'); const net = await import('node:net');
    const calls: string[] = [];
    const spies = [['lookup', dns], ['resolve', dns], ['connect', net]] as const;
    const orig = spies.map(([k, m]) => (m as any)[k]);
    spies.forEach(([k, m]) => { (m as any)[k] = () => { calls.push(k); throw new Error('network'); }; });
    try { for (const f of fx) decideFx(f); } finally { spies.forEach(([k, m], i) => { (m as any)[k] = orig[i]; }); }
    expect(calls).toEqual([]);
  });
});
