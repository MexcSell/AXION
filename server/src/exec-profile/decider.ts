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
  'allowed', 'profile_invalid',
  'scheme_not_https', 'ip_literal_denied', 'internal_host', 'lookalike_host', 'url_refused', 'origin_not_granted', 'port_mismatch',
  'redirect_internal', 'redirect_not_granted', 'too_many_redirects',
  'path_credential_file', 'path_traversal', 'path_encoded', 'path_not_absolute', 'path_wildcard', 'path_outside_scope', 'path_write_readonly',
] as const;
export type DecisionReason = (typeof DECISION_REASONS)[number];
export interface ItemDecision { kind: 'url' | 'path'; input: unknown; allow: boolean; reason: DecisionReason; detail?: string }
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

const valid = (p: unknown): ExecProfile | null => { const v = validateExecProfile(p); return v.ok ? v.profile : null; };
const profileInvalid = (kind: 'url' | 'path', input: unknown): ItemDecision => ({ kind, input, allow: false, reason: 'profile_invalid' });

export function decideUrl(profileInput: unknown, req: UrlRequest): ItemDecision {
  const profile = valid(profileInput);
  if (!profile) return profileInvalid('url', req.url);
  const granted = profile.network.allowedOrigins;
  const main = urlWithinGrantedOrigins(req.url, granted);
  if (!main.ok) return { kind: 'url', input: req.url, allow: false, reason: main.reason, ...(main.detail ? { detail: main.detail } : {}) };
  const hops = req.redirects ?? [];
  if (hops.length > MAX_REDIRECTS) return { kind: 'url', input: req.url, allow: false, reason: 'too_many_redirects' };
  for (const [i, h] of hops.entries()) {
    const c = urlWithinGrantedOrigins(h, granted);
    if (c.ok) continue;
    const internal = c.reason === 'ip_literal_denied' || c.reason === 'internal_host';
    return { kind: 'url', input: req.url, allow: false, reason: internal ? 'redirect_internal' : 'redirect_not_granted', detail: `hop ${i + 1}: ${c.reason}` };
  }
  return { kind: 'url', input: req.url, allow: true, reason: 'allowed' };
}

export function decidePath(profileInput: unknown, req: PathRequest): ItemDecision {
  const profile = valid(profileInput);
  if (!profile) return profileInvalid('path', req.path);
  const deny = (reason: DecisionReason): ItemDecision => ({ kind: 'path', input: req.path, allow: false, reason });
  const n = normaliseAbsolutePath(req.path);
  if (!n.ok) return deny(n.problem === 'traversal' ? 'path_traversal' : n.problem === 'encoded' ? 'path_encoded' : n.problem === 'wildcard' ? 'path_wildcard' : 'path_not_absolute');
  if (matchesAnyPattern(n.path, [...BUILTIN_CREDENTIAL_PATTERNS, ...profile.filesystem.forbiddenPatterns])) return deny('path_credential_file');
  const { writablePaths, readOnlyPaths } = profile.filesystem;
  if (writablePaths.some((d) => isUnder(n.path, normaliseAbsolutePath(d).ok ? (normaliseAbsolutePath(d) as { path: string }).path : '\0'))) return { kind: 'path', input: req.path, allow: true, reason: 'allowed' };
  if (readOnlyPaths.some((d) => isUnder(n.path, (normaliseAbsolutePath(d) as { path: string }).path))) return req.access === 'read' ? { kind: 'path', input: req.path, allow: true, reason: 'allowed' } : deny('path_write_readonly');
  return deny('path_outside_scope');
}

export function decideRequests(profileInput: unknown, request: ExecRequest): RequestDecision {
  const items: ItemDecision[] = [];
  for (const u of request.urls ?? []) items.push(decideUrl(profileInput, u));
  for (const p of request.paths ?? []) items.push(decidePath(profileInput, p));
  return { allowed: items.length > 0 && items.every((i) => i.allow), items };
}
