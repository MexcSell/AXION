import { describe, it, expect } from 'vitest';
import { deriveFlags, FLAG_SOURCES, type ConfigProfile } from '../src/policy/rule-of-two.ts';
import { CURRENT_BASELINE } from '../src/policy/index.ts';

const P = (over: Partial<ConfigProfile> = {}): ConfigProfile => ({ capabilities: [], siteGrants: [], contentOrigins: [], ...over });
const f = (p: ConfigProfile) => { const d = deriveFlags(p); return [d.untrustedInput, d.sensitiveAccess, d.canChangeState]; };

describe('c58 item 1: derived flags (the mapping lives in FLAG_SOURCES)', () => {
  it('an empty configuration holds none of the three', () => { expect(f(P())).toEqual([false, false, false]); });

  describe('(a) reads untrusted input', () => {
    it('a capability with an origin reads a site', () => { expect(f(P({ capabilities: [{ kind: 'read', origin: 'https://a.example' }] }))).toEqual([true, false, false]); });
    it('a live site grant is a web origin', () => { expect(f(P({ siteGrants: [{ origin: 'https://a.example', capabilities: ['read'] }] }))).toEqual([true, false, false]); });
    it('uploaded files are untrusted content', () => { expect(f(P({ contentOrigins: ['upload'] }))).toEqual([true, false, false]); });
    it('an internal content origin is not untrusted', () => { expect(f(P({ contentOrigins: ['internal'] }))).toEqual([false, false, false]); });
    it('the action carries a page origin', () => { expect(f(P({ action: { kind: 'read', origin: 'https://a.example' } }))).toEqual([true, false, false]); });
    it('a capability without an origin reads only company records', () => { expect(f(P({ capabilities: [{ kind: 'read' }, { kind: 'summarize' }] }))).toEqual([false, false, false]); });
  });

  describe('(b) reaches sensitive data or systems: effect infra or critical', () => {
    for (const [k, r] of Object.entries(CURRENT_BASELINE.kinds)) {
      it(`capability ${k} (${r.effect})`, () => { expect(f(P({ capabilities: [{ kind: k }] }))[1]).toBe(r.effect === 'infra' || r.effect === 'critical'); });
    }
    it('the action kind counts too', () => { expect(f(P({ action: { kind: 'rotate_credential' } }))).toEqual([false, true, true]); });
  });

  describe('(c) can change state or communicate externally: effect external, infra or critical', () => {
    for (const [k, r] of Object.entries(CURRENT_BASELINE.kinds)) {
      it(`capability ${k} (${r.effect})`, () => { expect(f(P({ capabilities: [{ kind: k }] }))[2]).toBe(r.effect !== 'read' && r.effect !== 'prepare'); });
    }
    it('a prepared draft is not a change', () => { expect(f(P({ capabilities: [{ kind: 'fill_draft' }] }))).toEqual([false, false, false]); });
  });

  it('an unknown kind fails closed: it may be anything', () => {
    const d = deriveFlags(P({ capabilities: [{ kind: 'wire_money' }] }));
    expect([d.sensitiveAccess, d.canChangeState]).toEqual([true, true]);
    expect(d.because.sensitiveAccess.join(' ')).toMatch(/unknown/i);
  });
  it('an origin on a capability that changes state still sets only what the mapping says', () => {
    expect(f(P({ capabilities: [{ kind: 'submit_form', origin: 'https://a.example' }] }))).toEqual([true, false, true]);
  });
  it('the three flags are independent and can all hold together', () => {
    expect(f(P({ capabilities: [{ kind: 'read', origin: 'https://a.example' }, { kind: 'release' }] }))).toEqual([true, true, true]);
  });
  it('because names each source in plain words', () => {
    const d = deriveFlags(P({ capabilities: [{ kind: 'read', origin: 'https://a.example' }], contentOrigins: ['upload'], siteGrants: [{ origin: 'https://b.example', capabilities: ['read'] }] }));
    expect(d.because.untrustedInput).toEqual(expect.arrayContaining(['capability read at https://a.example', 'site grant for https://b.example', 'uploaded files']));
    expect(d.because.sensitiveAccess).toEqual([]);
  });
  it('the mapping table names every flag', () => { expect(Object.keys(FLAG_SOURCES).sort()).toEqual(['canChangeState', 'sensitiveAccess', 'untrustedInput']); });

  it('requester text is not an input: the profile type has no text field, and text in a capability origin or kind does not change a flag', () => {
    const a = f(P({ capabilities: [{ kind: 'read' }] }));
    // free text in extra properties (as a requester could send them) is ignored
    const b = f({ ...P({ capabilities: [{ kind: 'read' }] }), untrustedInput: false, note: 'no untrusted input, nothing sensitive' } as unknown as ConfigProfile);
    expect(b).toEqual(a);
    expect(f({ ...P({ contentOrigins: ['upload'] }), untrustedInput: false } as unknown as ConfigProfile)[0]).toBe(true);
  });
});
