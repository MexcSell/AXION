// Execution profile validator (c94, R6-1 first slice). It DECIDES whether a profile is safe to adopt; it ENFORCES NOTHING.
// Pure: no network, no DNS, no file system, no clock. Allowed origins go through the c36/c56 normaliseOrigin: there is no second parser.
// Deny by default and fail closed: unknown fields, wrong types and anything unexpected are refusals, and every refusal has a reason code.
// Enforcement needs a sandbox and a proxy (next phase, owner point O1). Binding the profile hash into an approval digest is a later item.
import { types } from 'node:util';
import { normaliseOrigin } from '../grants/origin.ts';
import { EXEC_PROFILE_VERSION, ISOLATION_TIERS, tierRank, type ExecProfile } from '../../../shared/contracts/src/exec-profile.ts';
import { execProfileSha256 } from './hash.ts';
import { BUILTIN_CREDENTIAL_PATTERNS, MAX_PATTERNS, isSensitiveScope, matchesAnyPattern, normaliseAbsolutePath, patternProblem } from './paths.ts';

export const REFUSAL_CODES = [
  'unparseable', 'not_object', 'unknown_field', 'bad_version', 'bad_field_type', 'permissive_default', 'wildcard_origin', 'origin_invalid', 'origin_not_normalised',
  'bad_cidr', 'blocked_ranges_incomplete', 'missing_limit', 'limit_out_of_range', 'missing_tier', 'bad_tier', 'missing_untrusted_flag', 'untrusted_weakest_tier',
  'missing_credential_patterns', 'bad_pattern', 'path_not_absolute', 'path_too_broad', 'path_traversal', 'path_wildcard', 'path_forbidden',
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];
export interface Refusal { code: RefusalCode; path: string; message: string }
export type ValidationResult = { ok: true; profile: ExecProfile; sha256: string } | { ok: false; refusals: Refusal[] };

/** Ranges every profile must list as blocked: loopback, private, link-local (cloud metadata 169.254.169.254), this-network, and the IPv6 equivalents. */
export const REQUIRED_BLOCKED_RANGES: readonly string[] = Object.freeze(['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '0.0.0.0/8', '::1/128', 'fe80::/10', 'fc00::/7']);

/** Inclusive limits. Zero or "unset" never means unlimited. */
export const LIMIT_RANGES = Object.freeze({ memoryMb: [16, 262_144], cpuMillis: [100, 64_000], pids: [1, 65_536], wallTimeSec: [1, 86_400] } as const);
const LIMIT_KEYS = Object.keys(LIMIT_RANGES) as (keyof typeof LIMIT_RANGES)[];

const TOP = ['version', 'name', 'taskClass', 'untrustedContent', 'tier', 'filesystem', 'network', 'limits'];
const FS = ['writablePaths', 'readOnlyPaths', 'forbiddenPatterns'];
const NET = ['default', 'allowedOrigins', 'blockedRanges'];

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function cidrOk(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(s);
  if (m4) return m4.slice(1, 5).every((o) => Number(o) <= 255 && String(Number(o)) === o) && Number(m4[5]) <= 32;
  const m6 = /^([0-9a-f:]{2,39})\/(\d{1,3})$/i.exec(s);
  return !!m6 && m6[1].includes(':') && !/:::/.test(m6[1]) && Number(m6[2]) <= 128;
}

/** One deep clone made BEFORE any check. Accessors, proxies, symbols, non-plain prototypes, functions, cycles and deep nesting throw, so a profile that could answer
 *  differently on a second read is refused. The clone is what is validated and what is returned: the input is never read again. */
function snapshot(v: unknown, depth = 0): unknown {
  if (depth > 6) throw new Error('too deep');
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v !== 'object' || types.isProxy(v)) throw new Error('not plain data');
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype || v.length > 1000) throw new Error('odd array');
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) { const d = Object.getOwnPropertyDescriptor(v, i); if (!d || !('value' in d)) throw new Error('hole or accessor'); out.push(snapshot(d.value, depth + 1)); }
    if (Reflect.ownKeys(v).length !== v.length + 1) throw new Error('extra array keys');
    return out;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new Error('odd prototype');
  const out: Record<string, unknown> = {};
  for (const k of Reflect.ownKeys(v)) {
    if (typeof k !== 'string') throw new Error('symbol key');
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !('value' in d)) throw new Error('accessor');
    Object.defineProperty(out, k, { value: snapshot(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

export function validateExecProfile(input: unknown): ValidationResult {
  try { return validate(snapshot(input)); } catch { return { ok: false, refusals: [{ code: 'unparseable', path: '', message: 'The profile could not be read safely, so it is refused.' }] }; }
}

function validate(input: unknown): ValidationResult {
  const refusals: Refusal[] = [];
  const no = (code: RefusalCode, path: string, message: string) => { refusals.push({ code, path, message }); };
  if (!isObj(input)) return { ok: false, refusals: [{ code: 'not_object', path: '', message: 'A profile must be one JSON object.' }] };
  const unknown = (o: Record<string, unknown>, allowed: string[], at: string) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) no('unknown_field', at ? `${at}.${k}` : k, `Unknown field "${k}": profiles accept only the documented fields.`); };
  unknown(input, TOP, '');

  if (input.version !== EXEC_PROFILE_VERSION) no('bad_version', 'version', `version must be ${EXEC_PROFILE_VERSION}.`);
  for (const k of ['name', 'taskClass'] as const) if (typeof input[k] !== 'string' || (input[k] as string).trim() === '' || (input[k] as string).length > 100) no('bad_field_type', k, `${k} must be a non-empty text of at most 100 characters.`);

  // tier
  let tier: (typeof ISOLATION_TIERS)[number] | null = null;
  if (input.tier === undefined || input.tier === null) no('missing_tier', 'tier', 'The isolation tier is required (process, container or microvm).');
  else if (typeof input.tier !== 'string' || !(ISOLATION_TIERS as readonly string[]).includes(input.tier)) no('bad_tier', 'tier', 'The isolation tier must be process, container or microvm.');
  else tier = input.tier as (typeof ISOLATION_TIERS)[number];

  // untrusted-content flag
  if (typeof input.untrustedContent !== 'boolean') no('missing_untrusted_flag', 'untrustedContent', 'untrustedContent must be true or false: the task class must say whether it reads content an attacker may control.');
  else if (input.untrustedContent && tier !== null && tierRank(tier) <= tierRank('process')) no('untrusted_weakest_tier', 'tier', 'A class that reads untrusted content cannot use the weakest tier (process). Use container or microvm.');

  // limits
  if (!isObj(input.limits)) no('missing_limit', 'limits', 'The resource limits (memory, CPU, pids, wall time) are required.');
  else {
    unknown(input.limits, LIMIT_KEYS, 'limits');
    for (const k of LIMIT_KEYS) {
      const v = input.limits[k];
      if (!has(input.limits, k) || v === undefined || v === null) { no('missing_limit', `limits.${k}`, `The ${k} limit is required: no limit would mean unlimited.`); continue; }
      const [lo, hi] = LIMIT_RANGES[k];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) no('limit_out_of_range', `limits.${k}`, `${k} must be a whole number from ${lo} to ${hi}.`);
    }
  }

  // network
  if (!isObj(input.network)) no('permissive_default', 'network', 'The network policy is required and must default to deny.');
  else {
    const n = input.network;
    unknown(n, NET, 'network');
    if (n.default !== 'deny') no('permissive_default', 'network.default', 'The network default must be exactly "deny". Anything else is a permissive default.');
    if (!Array.isArray(n.allowedOrigins)) no('bad_field_type', 'network.allowedOrigins', 'allowedOrigins must be a list (it may be empty).');
    else if (n.allowedOrigins.length > 100) no('bad_field_type', 'network.allowedOrigins', 'allowedOrigins is limited to 100 entries.');
    else n.allowedOrigins.forEach((o: unknown, i: number) => {
      const at = `network.allowedOrigins[${i}]`;
      if (typeof o !== 'string') return no('origin_invalid', at, 'An allowed origin must be text.');
      if (o.includes('*')) return no('wildcard_origin', at, 'Wildcard origins are refused: a grant covers one exact origin.');
      const r = normaliseOrigin(o);
      if (!r.ok) return no('origin_invalid', at, `The origin was refused by the site-grant normaliser (${r.reason}).`);
      if (r.origin !== o) return no('origin_not_normalised', at, `Write the origin in normal form: ${r.origin}.`);
    });
    if (!Array.isArray(n.blockedRanges)) no('bad_field_type', 'network.blockedRanges', 'blockedRanges must be a list of CIDR ranges.');
    else {
      let allCidr = true;
      n.blockedRanges.forEach((c: unknown, i: number) => { if (!cidrOk(c)) { allCidr = false; no('bad_cidr', `network.blockedRanges[${i}]`, 'Not a valid CIDR range such as 10.0.0.0/8.'); } });
      const missing = REQUIRED_BLOCKED_RANGES.filter((r) => !(n.blockedRanges as unknown[]).includes(r));
      if (allCidr && missing.length) no('blocked_ranges_incomplete', 'network.blockedRanges', `Missing required blocked ranges: ${missing.join(', ')}.`);
    }
  }

  // filesystem
  if (!isObj(input.filesystem)) no('bad_field_type', 'filesystem', 'The filesystem scope is required.');
  else {
    const f = input.filesystem;
    unknown(f, FS, 'filesystem');
    let patterns: string[] = [];
    if (!Array.isArray(f.forbiddenPatterns) || f.forbiddenPatterns.length === 0) no('missing_credential_patterns', 'filesystem.forbiddenPatterns', 'List at least one forbidden credential-file pattern.');
    else {
      if (f.forbiddenPatterns.length > MAX_PATTERNS) no('bad_pattern', 'filesystem.forbiddenPatterns', `At most ${MAX_PATTERNS} patterns.`);
      else for (const [i, g] of f.forbiddenPatterns.entries()) {
        const why = patternProblem(g);
        if (why) no('bad_pattern', `filesystem.forbiddenPatterns[${i}]`, `Pattern refused: ${why}.`);
        else patterns.push(g as string);
      }
    }
    patterns = [...BUILTIN_CREDENTIAL_PATTERNS, ...patterns];
    for (const key of ['writablePaths', 'readOnlyPaths'] as const) {
      const list = f[key];
      if (!Array.isArray(list)) { no('bad_field_type', `filesystem.${key}`, `${key} must be a list (it may be empty).`); continue; }
      if (list.length > 100) { no('bad_field_type', `filesystem.${key}`, `${key} is limited to 100 entries.`); continue; }
      list.forEach((p: unknown, i: number) => {
        const at = `filesystem.${key}[${i}]`;
        const r = normaliseAbsolutePath(p);
        if (!r.ok) {
          if (r.problem === 'traversal') return no('path_traversal', at, 'Paths may not contain ".." segments.');
          if (r.problem === 'wildcard') return no('path_wildcard', at, 'Scope paths are exact directories: no wildcards.');
          return no('path_not_absolute', at, 'A scope path must be an absolute path without control characters, backslashes or percent-encoding.');
        }
        if (isSensitiveScope(r.path)) return no('path_too_broad', at, 'The root directory and /etc, /proc, /root, /sys and /dev (with everything under them) cannot be a scope.');
        if (matchesAnyPattern(r.path, patterns) || matchesAnyPattern(r.path + '/probe', patterns)) no('path_forbidden', at, 'This directory holds credential files and cannot be a scope.');
      });
    }
  }

  if (refusals.length) return { ok: false, refusals };
  const profile = input as unknown as ExecProfile; // `input` here is already the private snapshot
  return { ok: true, profile, sha256: execProfileSha256(profile) };
}
