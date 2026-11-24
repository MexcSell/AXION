// Request decider (c94, R6-1 first slice). Given a VALID execution profile, it DECIDES allow or deny, with a reason, for requested
// URLs (with their redirect chains) and file paths. It ENFORCES NOTHING: no sandbox, no proxy, no socket, no file system access, and no
// DNS (the module never resolves a name, so a name that points at a private address is a job for the future proxy: next phase, owner point O1).
//
// URLs: there is no second parser. The origin of every URL and of every redirect hop comes from originOfUrl (browser/schema.ts), which
// calls the c36/c56 normaliseOrigin. That normaliser refuses IP literals in every spelling (decimal, octal, hex, short forms, IPv4-mapped
// IPv6, any IPv6), metadata and internal names, userinfo, backslashes, percent-encoding in the host, wildcards, trailing dots and look-alike
// hosts. The one function added here, urlWithinGrantedOrigins, compares the normalised origin (scheme, host, port) with the granted list.
// IP-encoding and redirect checks follow the SSRF guidance in the MCP security best practices "by analogy" (that text is about MCP clients
// fetching OAuth URLs, not agent browsing).
// Host case: host names are case-insensitive, so https://GOOD.com is the granted origin https://good.com once normalised and is allowed.
// Look-alikes that fold to the granted name only under Unicode case folding (Kelvin sign, fullwidth letters) are refused by the normaliser.
import { originOfUrl } from '../browser/schema.ts';
import { validateExecProfile } from './validator.ts';
import { BUILTIN_CREDENTIAL_PATTERNS, isUnder, matchesAnyPattern, normaliseAbsolutePath } from './paths.ts';
import type { ExecProfile } from '../../../shared/contracts/src/exec-profile.ts';

export const DECISION_REASONS = [
  'allowed', 'profile_invalid', 'request_malformed', 'item_malformed', 'too_many_items',
  'scheme_not_https', 'ip_literal_denied', 'internal_host', 'lookalike_host', 'url_refused', 'origin_not_granted', 'port_mismatch',
  'redirect_internal', 'redirect_not_granted', 'too_many_redirects',
  'path_credential_file', 'path_traversal', 'path_encoded', 'path_not_absolute', 'path_wildcard', 'path_outside_scope', 'path_write_readonly',
] as const;
export type DecisionReason = (typeof DECISION_REASONS)[number];
export interface ItemDecision { kind: 'url' | 'path' | 'request'; input: unknown; allow: boolean; reason: DecisionReason; detail?: string }
export interface UrlRequest { url: string; /** Every hop the browser followed, absolute URLs, in order. */ redirects?: string[] }
export interface PathRequest { path: string; access: 'read' | 'write' }
export interface ExecRequest { urls?: UrlRequest[]; paths?: PathRequest[] }
export interface RequestDecision { allowed: boolean; items: ItemDecision[] }

export const MAX_REDIRECTS = 10;

const INTERNAL = new Set(['reserved_name', 'metadata_name', 'single_label']);
const LOOKALIKE = new Set(['idna_mapped', 'idn_not_supported', 'mixed_script', 'confusable_char', 'whole_script_confusable', 'unsupported_script', 'bad_charset', 'invalid_punycode']);

export type UrlCheck = { ok: true; origin: string } | { ok: false; reason: 'scheme_not_https' | 'ip_literal_denied' | 'internal_host' | 'lookalike_host' | 'url_refused' | 'origin_not_granted' | 'port_mismatch'; detail?: string };

/** The one new function: a full URL against the granted origins. Scheme, host and port must all equal a granted origin (after normalisation). */
export function urlWithinGrantedOrigins(url: unknown, granted: readonly string[]): UrlCheck {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return { ok: false, reason: 'scheme_not_https' };
  if (url.length > MAX_URL) return { ok: false, reason: 'url_refused', detail: 'too_long' };
  const o = originOfUrl(url);
  if (!o.ok) {
    if (o.reason === 'ip_literal') return { ok: false, reason: 'ip_literal_denied', detail: o.reason };
    if (INTERNAL.has(o.reason)) return { ok: false, reason: 'internal_host', detail: o.reason };
    if (LOOKALIKE.has(o.reason)) return { ok: false, reason: 'lookalike_host', detail: o.reason };
    return { ok: false, reason: 'url_refused', detail: o.reason };
  }
  // originOfUrl looks only at the authority. The rest (path, query, fragment) must not carry whitespace, controls, backslashes or invisible characters.
  const rest = url.slice(url.indexOf('//') + 2 + url.slice(url.indexOf('//') + 2).search(/[/?#]|$/));
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Z}\\\u034f\u115f\u1160\u3164\uffa0\ufe00-\ufe0f]/u.test(rest)) return { ok: false, reason: 'url_refused', detail: 'control_or_space' };
  if (granted.includes(o.origin)) return { ok: true, origin: o.origin };
  const m = /^(https:\/\/[^:]+)(?::\d+)?$/.exec(o.origin);
  if (m && granted.some((g) => g.replace(/:\d+$/, '') === m[1])) return { ok: false, reason: 'port_mismatch' };
  return { ok: false, reason: 'origin_not_granted' };
}

/** c99 X1-2: most items (URLs plus paths) one decideRequests call will look at; one over and the WHOLE call is denied with too_many_items. */
export const MAX_REQUEST_ITEMS = 256;
const MAX_URL = 4096;

/** A copy of a plain data object: own enumerable data properties only. Throws on accessors, proxies that throw, and non-plain prototypes, so a hostile object is never trusted. */
function plain(v: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not a plain object');
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new Error('odd prototype');
  const out: Record<string, unknown> = Object.create(null);
  for (const k of Reflect.ownKeys(v)) {
    if (typeof k !== 'string' || !allowed.includes(k)) throw new Error('unknown field');
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !('value' in d)) throw new Error('accessor');
    out[k] = d.value;
  }
  return out;
}
class TooMany extends Error {}
/** Copies a list ONCE: `length` is read a single time, then exactly that many data elements are read. A Proxy whose length changes between reads cannot get past the cap. */
function list(v: unknown, cap = MAX_REQUEST_ITEMS): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error('not a list');
  const len = v.length;
  if (typeof len !== 'number' || !Number.isInteger(len) || len < 0) throw new Error('not a list');
  if (len > cap) throw new TooMany('too many');
  const out: unknown[] = [];
  for (let i = 0; i < len; i++) { const d = Object.getOwnPropertyDescriptor(v, i); if (!d || !('value' in d)) throw new Error('hole or accessor'); out.push(d.value); }
  return out;
}

const malformed = (kind: ItemDecision['kind'], reason: 'request_malformed' | 'item_malformed'): ItemDecision => ({ kind, input: undefined, allow: false, reason });
const shown = (v: unknown): unknown => (typeof v === 'string' ? v.slice(0, 200) : undefined);

function urlWith(profile: ExecProfile, raw: unknown): ItemDecision {
  let url: unknown; let redirects: unknown[] = [];
  try {
    const o = plain(raw, ['url', 'redirects']);
    if (typeof o.url !== 'string') throw new Error('url');
    url = o.url;
    redirects = o.redirects === undefined ? [] : list(o.redirects, 1000);
  } catch { return malformed('url', 'item_malformed'); }
  const granted = profile.network.allowedOrigins;
  const main = urlWithinGrantedOrigins(url, granted);
  if (!main.ok) return { kind: 'url', input: shown(url), allow: false, reason: main.reason, ...(main.detail ? { detail: main.detail } : {}) };
  if (redirects.length > MAX_REDIRECTS) return { kind: 'url', input: shown(url), allow: false, reason: 'too_many_redirects' };
  for (const [i, h] of redirects.entries()) {
    const c = urlWithinGrantedOrigins(h, granted);
    if (c.ok) continue;
    // a hop with a wrong scheme is still tagged internal when its host is (so the audit tag says what the hop was aiming at)
    const asHttps = c.reason === 'scheme_not_https' && typeof h === 'string' ? urlWithinGrantedOrigins('https://' + h.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\//i, ''), granted) : c;
    const internal = c.reason === 'ip_literal_denied' || c.reason === 'internal_host' || (!asHttps.ok && (asHttps.reason === 'ip_literal_denied' || asHttps.reason === 'internal_host'));
    return { kind: 'url', input: shown(url), allow: false, reason: internal ? 'redirect_internal' : 'redirect_not_granted', detail: `hop ${i + 1}: ${c.reason}` };
  }
  return { kind: 'url', input: shown(url), allow: true, reason: 'allowed' };
}

function pathWith(profile: ExecProfile, raw: unknown): ItemDecision {
  let path: string; let access: 'read' | 'write';
  try {
    const o = plain(raw, ['path', 'access']);
    if (typeof o.path !== 'string' || (o.access !== 'read' && o.access !== 'write')) throw new Error('shape');
    path = o.path; access = o.access;
  } catch { return malformed('path', 'item_malformed'); }
  const deny = (reason: DecisionReason): ItemDecision => ({ kind: 'path', input: shown(path), allow: false, reason });
  const n = normaliseAbsolutePath(path);
  if (!n.ok) return deny(n.problem === 'traversal' ? 'path_traversal' : n.problem === 'encoded' ? 'path_encoded' : n.problem === 'wildcard' ? 'path_wildcard' : 'path_not_absolute');
  if (matchesAnyPattern(n.path, [...BUILTIN_CREDENTIAL_PATTERNS, ...profile.filesystem.forbiddenPatterns])) return deny('path_credential_file');
  // scope entries were validated as normal absolute paths, so they are compared as they are
  if (profile.filesystem.writablePaths.some((d) => isUnder(n.path, d))) return { kind: 'path', input: shown(path), allow: true, reason: 'allowed' };
  if (profile.filesystem.readOnlyPaths.some((d) => isUnder(n.path, d))) return access === 'read' ? { kind: 'path', input: shown(path), allow: true, reason: 'allowed' } : deny('path_write_readonly');
  return deny('path_outside_scope');
}

/** Every public entry point catches everything and answers deny. It never throws and never answers allow by default. */
function guarded(profileInput: unknown, kind: 'url' | 'path', raw: unknown): ItemDecision {
  try {
    const v = validateExecProfile(profileInput);
    if (!v.ok) return { kind, input: undefined, allow: false, reason: 'profile_invalid' };
    return kind === 'url' ? urlWith(v.profile, raw) : pathWith(v.profile, raw);
  } catch { return malformed(kind, 'item_malformed'); }
}
export const decideUrl = (profileInput: unknown, req: unknown): ItemDecision => guarded(profileInput, 'url', req);
export const decidePath = (profileInput: unknown, req: unknown): ItemDecision => guarded(profileInput, 'path', req);

export function decideRequests(profileInput: unknown, request: unknown): RequestDecision {
  try {
    const v = validateExecProfile(profileInput);
    let urls: unknown[]; let paths: unknown[];
    try {
      const r = plain(request, ['urls', 'paths']);
      // each list is copied once (its length is read once); the cap is then checked on the COPIES, so nothing the caller does after this point matters
      urls = list(r.urls); paths = list(r.paths);
      if (urls.length + paths.length > MAX_REQUEST_ITEMS) throw new TooMany('too many');
    } catch (e) {
      if (e instanceof TooMany) return { allowed: false, items: [{ kind: 'request', input: undefined, allow: false, reason: 'too_many_items' }] };
      return { allowed: false, items: [malformed('request', 'request_malformed')] };
    }
    const items: ItemDecision[] = [];
    for (const [kind, raws] of [['url', urls], ['path', paths]] as const) {
      for (const raw of raws) {
        if (!v.ok) { items.push({ kind, input: undefined, allow: false, reason: 'profile_invalid' }); continue; }
        try { items.push(kind === 'url' ? urlWith(v.profile, raw) : pathWith(v.profile, raw)); } catch { items.push(malformed(kind, 'item_malformed')); }
      }
    }
    if (!v.ok && items.length === 0) items.push({ kind: 'request', input: undefined, allow: false, reason: 'profile_invalid' });
    return { allowed: items.length > 0 && items.every((i) => i.allow), items };
  } catch { return { allowed: false, items: [malformed('request', 'request_malformed')] }; }
}
