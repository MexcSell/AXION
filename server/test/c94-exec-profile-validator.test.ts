import { describe, it, expect } from 'vitest';
import { validateExecProfile, REFUSAL_CODES } from '../src/exec-profile/validator.ts';
import { execProfileSha256 } from '../src/exec-profile/hash.ts';
import { goodProfile } from './fixtures/exec-profile-good.ts';

// c94 item 2, threshold (b): every unsafe profile is refused, each with its reason code. The validator decides; it enforces nothing.
type Mut = (p: any) => unknown;
const bad: [string, string, Mut][] = [
  ['permissive default: allow', 'permissive_default', (p) => { p.network.default = 'allow'; }],
  ['permissive default: allow-all text', 'permissive_default', (p) => { p.network.default = 'allow_all'; }],
  ['permissive default: missing', 'permissive_default', (p) => { delete p.network.default; }],
  ['permissive default: boolean true', 'permissive_default', (p) => { p.network.default = true; }],
  ['permissive default: Deny wrong case', 'permissive_default', (p) => { p.network.default = 'Deny'; }],
  ['wildcard origin: star', 'wildcard_origin', (p) => { p.network.allowedOrigins = ['*']; }],
  ['wildcard origin: subdomain star', 'wildcard_origin', (p) => { p.network.allowedOrigins.push('https://*.good.com'); }],
  ['wildcard origin: scheme star', 'wildcard_origin', (p) => { p.network.allowedOrigins.push('*://good.com'); }],
  ['wildcard origin: partial star', 'wildcard_origin', (p) => { p.network.allowedOrigins.push('https://good*.com'); }],
  ['missing memory limit', 'missing_limit', (p) => { delete p.limits.memoryMb; }],
  ['missing cpu limit', 'missing_limit', (p) => { delete p.limits.cpuMillis; }],
  ['missing pids limit', 'missing_limit', (p) => { delete p.limits.pids; }],
  ['missing wall time limit', 'missing_limit', (p) => { delete p.limits.wallTimeSec; }],
  ['missing limits block', 'missing_limit', (p) => { delete p.limits; }],
  ['limit zero means unlimited', 'limit_out_of_range', (p) => { p.limits.memoryMb = 0; }],
  ['limit negative', 'limit_out_of_range', (p) => { p.limits.pids = -1; }],
  ['limit Infinity', 'limit_out_of_range', (p) => { p.limits.wallTimeSec = Infinity; }],
  ['limit NaN', 'limit_out_of_range', (p) => { p.limits.cpuMillis = NaN; }],
  ['limit absurdly large', 'limit_out_of_range', (p) => { p.limits.memoryMb = 10_000_000; }],
  ['limit fractional', 'limit_out_of_range', (p) => { p.limits.pids = 1.5; }],
  ['limit as text', 'limit_out_of_range', (p) => { p.limits.memoryMb = '512'; }],
  ['missing tier', 'missing_tier', (p) => { delete p.tier; }],
  ['tier null', 'missing_tier', (p) => { p.tier = null; }],
  ['unknown tier', 'bad_tier', (p) => { p.tier = 'none'; }],
  ['tier host', 'bad_tier', (p) => { p.tier = 'host'; }],
  ['untrusted class on the weakest tier', 'untrusted_weakest_tier', (p) => { p.untrustedContent = true; p.tier = 'process'; }],
  ['untrusted flag missing', 'missing_untrusted_flag', (p) => { delete p.untrustedContent; }],
  ['untrusted flag as text', 'missing_untrusted_flag', (p) => { p.untrustedContent = 'false'; }],
  ['unknown top-level field', 'unknown_field', (p) => { p.extra = 1; }],
  ['unknown network field', 'unknown_field', (p) => { p.network.allowAll = true; }],
  ['unknown limits field', 'unknown_field', (p) => { p.limits.unlimited = true; }],
  ['unknown filesystem field', 'unknown_field', (p) => { p.filesystem.default = 'allow'; }],
  ['wrong version', 'bad_version', (p) => { p.version = 2; }],
  ['missing version', 'bad_version', (p) => { delete p.version; }],
  ['http origin', 'origin_invalid', (p) => { p.network.allowedOrigins.push('http://good.com'); }],
  ['IP literal origin', 'origin_invalid', (p) => { p.network.allowedOrigins.push('https://127.0.0.1'); }],
  ['origin with a path', 'origin_invalid', (p) => { p.network.allowedOrigins.push('https://good.com/x'); }],
  ['origin not normalised (upper case)', 'origin_not_normalised', (p) => { p.network.allowedOrigins.push('https://GOOD.com'); }],
  ['origin is internal', 'origin_invalid', (p) => { p.network.allowedOrigins.push('https://metadata.google.internal'); }],
  ['allowed origins not an array', 'bad_field_type', (p) => { p.network.allowedOrigins = 'https://good.com'; }],
  ['blocked ranges missing', 'blocked_ranges_incomplete', (p) => { p.network.blockedRanges = []; }],
  ['blocked ranges lack metadata range', 'blocked_ranges_incomplete', (p) => { p.network.blockedRanges = p.network.blockedRanges.filter((r: string) => r !== '169.254.0.0/16'); }],
  ['blocked range not a CIDR', 'bad_cidr', (p) => { p.network.blockedRanges.push('localhost'); }],
  ['no credential patterns', 'missing_credential_patterns', (p) => { p.filesystem.forbiddenPatterns = []; }],
  ['writable path is the root', 'path_too_broad', (p) => { p.filesystem.writablePaths = ['/']; }],
  ['read-only path is the root', 'path_too_broad', (p) => { p.filesystem.readOnlyPaths = ['/']; }],
  ['writable path relative', 'path_not_absolute', (p) => { p.filesystem.writablePaths = ['work/out']; }],
  ['writable path with traversal', 'path_traversal', (p) => { p.filesystem.writablePaths = ['/work/../etc']; }],
  ['writable path with wildcard', 'path_wildcard', (p) => { p.filesystem.writablePaths = ['/work/*']; }],
  ['writable path inside a credential dir', 'path_forbidden', (p) => { p.filesystem.writablePaths = ['/home/a/.ssh']; }],
  ['writable path with NUL', 'path_not_absolute', (p) => { p.filesystem.writablePaths = ['/work/o\0ut']; }],
  ['not an object', 'not_object', () => 'profile'],
  ['null', 'not_object', () => null],
  ['array', 'not_object', () => []],
  ['name empty', 'bad_field_type', (p) => { p.name = ''; }],
  ['task class missing', 'bad_field_type', (p) => { delete p.taskClass; }],
];

describe('exec profile validator: unsafe profiles are refused', () => {
  it('has at least 15 refusal fixtures and a code for each', () => {
    expect(bad.length).toBeGreaterThanOrEqual(15);
    for (const [, code] of bad) expect(REFUSAL_CODES).toContain(code);
  });
  it.each(bad)('refuses: %s (%s)', (_n, code, mut) => {
    const p = goodProfile();
    const replaced = mut(p);
    const r = validateExecProfile(replaced !== undefined ? replaced : p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusals.map((x) => x.code)).toContain(code);
      for (const x of r.refusals) { expect(x.message.length).toBeGreaterThan(8); expect(typeof x.path).toBe('string'); }
    }
  });
  it('100% of the fixtures are refused (threshold b)', () => {
    let refused = 0;
    for (const [, , mut] of bad) { const p = goodProfile(); const rep = mut(p); if (!validateExecProfile(rep !== undefined ? rep : p).ok) refused++; }
    expect(refused).toBe(bad.length);
  });
});

describe('exec profile validator: the good profile', () => {
  it('is accepted and returns the canonical sha256', () => {
    const r = validateExecProfile(goodProfile());
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.sha256).toBe(execProfileSha256(goodProfile())); expect(r.profile).toEqual(goodProfile()); }
  });
  it('accepts a trusted class on the process tier, and an untrusted class on container or microvm', () => {
    for (const [untrusted, tier, ok] of [[false, 'process', true], [true, 'container', true], [true, 'microvm', true], [true, 'process', false]] as const) {
      const p = goodProfile(); p.untrustedContent = untrusted; p.tier = tier;
      expect(validateExecProfile(p).ok).toBe(ok);
    }
  });
  it('accepts an empty allowed-origin list (no network at all)', () => {
    const p = goodProfile(); p.network.allowedOrigins = [];
    expect(validateExecProfile(p).ok).toBe(true);
  });
  it('does not throw on hostile input and does not mutate it', () => {
    for (const v of [undefined, 1, true, 10n, Symbol('x'), () => 1, Object.create(null), new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } })]) {
      expect(() => validateExecProfile(v as never)).not.toThrow();
      expect(validateExecProfile(v as never).ok).toBe(false);
    }
    const p = goodProfile(); const before = JSON.stringify(p); validateExecProfile(p); expect(JSON.stringify(p)).toBe(before);
  });
});
