import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normaliseOrigin } from '../src/grants/origin.ts';

// c36: the exact-origin normaliser is a security boundary. Every hostile entry carries the reason it must be refused for.
const hostile = JSON.parse(readFileSync(new URL('./fixtures/hostile-origins.json', import.meta.url), 'utf8')) as { input: unknown; reason: string; why: string }[];
const benign = JSON.parse(readFileSync(new URL('./fixtures/benign-origins.json', import.meta.url), 'utf8')) as { input: string; origin: string }[];

describe('normaliseOrigin: hostile corpus', () => {
  it('has at least 60 entries, each with a stated reason', () => {
    expect(hostile.length).toBeGreaterThanOrEqual(60);
    for (const h of hostile) { expect(h.reason.length).toBeGreaterThan(2); expect(h.why.length).toBeGreaterThan(8); }
  });
  it.each(hostile.map((h, i) => [i, typeof h.input === 'string' ? JSON.stringify(h.input).slice(0, 60) : JSON.stringify(h.input), h] as const))('refuses #%i %s', (_i, _n, h) => {
    const r = normaliseOrigin(h.input as string);
    expect(r.ok, h.why).toBe(false);
    if (!r.ok) expect(r.reason, h.why).toBe(h.reason);
  });
});

describe('normaliseOrigin: benign corpus', () => {
  it('has at least 15 entries', () => { expect(benign.length).toBeGreaterThanOrEqual(15); });
  it.each(benign.map((b) => [b.input, b] as const))('accepts %s with the exact normal form', (_n, b) => {
    expect(normaliseOrigin(b.input)).toEqual({ ok: true, origin: b.origin });
  });
  it('is idempotent: a normal form normalises to itself', () => {
    for (const b of benign) expect(normaliseOrigin(b.origin)).toEqual({ ok: true, origin: b.origin });
  });
});

describe('normaliseOrigin: options and fail-closed behaviour', () => {
  it('refuses http unless the explicit test-only flag is set, and still drops its default port', () => {
    expect(normaliseOrigin('http://example.com')).toEqual({ ok: false, reason: 'scheme_not_https' });
    expect(normaliseOrigin('http://example.com:80', { allowInsecureHttpForTests: true })).toEqual({ ok: true, origin: 'http://example.com' });
    expect(normaliseOrigin('http://localhost', { allowInsecureHttpForTests: true }).ok).toBe(false); // the flag never opens internal names
  });
  it('never throws on any input type', () => {
    for (const v of [undefined, null, 1, true, {}, [], () => 1, Symbol('x'), 10n, '\ud800', 'https://\ud800.com']) expect(() => normaliseOrigin(v as never)).not.toThrow();
    for (const v of [undefined, null, 1, true, {}, []]) expect(normaliseOrigin(v as never).ok).toBe(false);
  });
  it('every accepted origin is an exact round trip through the WHATWG parser and has no path', () => {
    for (const b of benign) { const o = normaliseOrigin(b.input); if (o.ok) { expect(new URL(o.origin).origin).toBe(o.origin); expect(o.origin).not.toMatch(/^https:\/\/[^/]+\/./); } }
  });
  it('a grant check is an exact string match: a lookalike of a normal form never equals it', () => {
    const a = normaliseOrigin('https://paypal.com');
    for (const v of ['https://pаypal.com', 'https://paypal.com.evil.com', 'https://paypal.co', 'https://www.paypal.com', 'https://paypal.com:8443']) {
      const r = normaliseOrigin(v);
      if (r.ok && a.ok) expect(r.origin).not.toBe(a.origin);
    }
  });
});

describe('normaliseOrigin: mutation fuzz (deterministic)', () => {
  // Property: whatever is accepted is a plain lowercase ASCII https origin, whose host is public-looking and re-normalises to itself.
  it('20000 mutations of corpus entries: every accepted result obeys the invariants', () => {
    let seed = 36;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const nasty = ['.', '..', '@', ':', '/', '\\', '%2e', '%', '#', '?', ' ', '\t', '\n', '\u0000', '​', '。', '．', 'а', 'ο', 'ı', '[', ']', '*', 'xn--', '0x', '127.', '--', '-', '_', '💩', '­', '‮'];
    const base = [...benign.map((b) => b.input), ...hostile.filter((h) => typeof h.input === 'string').map((h) => h.input as string)];
    let accepted = 0;
    for (let i = 0; i < 20000; i++) {
      let s = base[rnd(base.length)];
      for (let k = 0, n = 1 + rnd(3); k < n; k++) {
        const at = rnd(s.length + 1), op = rnd(3);
        s = op === 0 ? s.slice(0, at) + nasty[rnd(nasty.length)] + s.slice(at) : op === 1 ? s.slice(0, at) + s.slice(at + 1 + rnd(2)) : s.slice(0, at) + nasty[rnd(nasty.length)] + s.slice(at + 1);
      }
      const r = normaliseOrigin(s);
      if (!r.ok) continue;
      accepted++;
      expect(r.origin, JSON.stringify(s)).toMatch(/^https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9](:[1-9][0-9]{0,4})?$/);
      const host = r.origin.slice(8).replace(/:\d+$/, '');
      const labels = host.split('.');
      expect(labels.length, JSON.stringify(s)).toBeGreaterThanOrEqual(2);
      expect(labels.every((l) => l.length >= 1 && l.length <= 63), JSON.stringify(s)).toBe(true);
      expect(labels[labels.length - 1], JSON.stringify(s)).toMatch(/^[a-z]/);
      expect(host, JSON.stringify(s)).not.toMatch(/(^|\.)(localhost|local|internal|arpa|invalid)$/);
      expect(normaliseOrigin(r.origin), JSON.stringify(s)).toEqual(r);
    }
    expect(accepted).toBeGreaterThan(100); // the fuzz really exercised the accept path
  });
});
