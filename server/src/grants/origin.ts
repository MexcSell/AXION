// normaliseOrigin(): the exact-origin normaliser behind site grants (c36). A security boundary: it FAILS CLOSED.
// Pure: no DNS, no network, no clock. Uses only Node's built-in URL / url.domainToASCII / domainToUnicode.
//
// Design: the WHATWG URL parser is forgiving on purpose (it strips tabs and newlines, turns \ into /, trims spaces, reads
// 0x7f.1 as an IPv4 address, folds fullwidth letters). That is exactly what an attacker plays with. So the structure of the
// input is checked by hand on the raw string first, label by label, and the URL parser is used only at the end as a
// consistency check on the result. When anything is unclear the answer is a refusal with a reason code.
//
// Script rule (documented choice): a non-ASCII label is accepted only if it is a pure single-script label.
//  - letters must all belong to ONE script (Latin, Cyrillic, Greek, Han, ... from a fixed list; any other script is refused);
//  - Latin labels may carry non-ASCII letters only when they are an ASCII base letter plus combining marks (u-umlaut, e-acute)
//    or one of ss, ae, oe, o-stroke; look-alikes such as dotless i, script g or l-with-stroke are refused;
//  - a Cyrillic or Greek label made only of letters that look like Latin letters is refused (whole-script confusable);
//  - a label with a non-ASCII char must survive the IDNA round trip unchanged (no folding, no dropped chars, no new dots).
// Why: a grant is matched by exact string equality of normal forms, so a look-alike can never equal a granted origin. These
// rules also stop an administrator from being tricked into granting a look-alike by mistake.
import { domainToASCII, domainToUnicode } from 'node:url';

export const REFUSAL_REASONS = [
  'not_string', 'empty', 'too_long', 'control_or_space', 'backslash', 'percent_encoding', 'wildcard', 'query_or_fragment', 'userinfo',
  'scheme_required', 'scheme_not_https', 'path', 'empty_host', 'ip_literal', 'bad_port', 'trailing_dot', 'empty_label', 'host_too_long',
  'label_too_long', 'bad_label', 'invalid_punycode', 'idna_mapped', 'bad_charset', 'mixed_script', 'unsupported_script', 'confusable_char',
  'whole_script_confusable', 'metadata_name', 'reserved_name', 'single_label', 'unparseable',
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];
export type OriginResult = { ok: true; origin: string } | { ok: false; reason: RefusalReason };
export interface OriginOptions { /** Test-only. Production code never passes it. It only allows the http scheme, never an internal host. */ allowInsecureHttpForTests?: boolean }

/** Plain-language text for each reason, shown by the validate endpoint and the grant dialog. */
export const REFUSAL_TEXT: Readonly<Record<RefusalReason, string>> = Object.freeze({
  not_string: 'The origin must be text.',
  empty: 'Enter an origin such as https://example.com.',
  too_long: 'That is too long to be an origin.',
  control_or_space: 'Spaces, control characters and invisible characters are not allowed.',
  backslash: 'Backslashes are not allowed: browsers read them as a slash.',
  percent_encoding: 'Percent-encoding is not allowed in an origin.',
  wildcard: 'Wildcards are not allowed: a grant covers one exact origin.',
  query_or_fragment: 'An origin has no query (?) or fragment (#).',
  userinfo: 'A user name or password (name@host) is not allowed: it can hide the real host.',
  scheme_required: 'Start with https:// (for example https://example.com).',
  scheme_not_https: 'Only https:// origins can be granted.',
  path: 'An origin has no path. Use https://example.com, not a page address.',
  empty_host: 'The host name is missing.',
  ip_literal: 'IP addresses are not allowed (including decimal, octal, hex and IPv6 forms).',
  bad_port: 'The port must be a number from 1 to 65535 without leading zeros.',
  trailing_dot: 'A trailing dot is not allowed.',
  empty_label: 'The host has an empty part (two dots in a row, or a leading dot).',
  host_too_long: 'The host name is longer than 253 characters.',
  label_too_long: 'A part of the host name is longer than 63 characters.',
  bad_label: 'Host parts may only use letters, digits and single hyphens, and cannot start or end with a hyphen.',
  invalid_punycode: 'A punycode (xn--) part is not valid.',
  idna_mapped: 'The host contains characters that browsers rewrite (fullwidth letters, other dots, hidden characters).',
  bad_charset: 'The host contains characters that are not letters or digits.',
  mixed_script: 'The host mixes alphabets (for example Cyrillic and Latin letters).',
  unsupported_script: 'That alphabet is not supported for grants.',
  confusable_char: 'The host contains a letter that looks like a different letter.',
  whole_script_confusable: 'Every letter of that host part looks like a Latin letter.',
  metadata_name: 'Cloud metadata names are never granted.',
  reserved_name: 'Local, internal and reserved names cannot be granted.',
  single_label: 'The host needs a domain such as example.com.',
  unparseable: 'That origin could not be checked safely.',
});

const MAX_INPUT = 300;
const refuse = (reason: RefusalReason): OriginResult => ({ ok: false, reason });
const ok = (origin: string): OriginResult => ({ ok: true, origin });

// Whitespace, C0/C1 controls, no-break and invisible/format characters, bidi controls, variation selectors, BOM.
// eslint-disable-next-line no-control-regex
const hex = (n: number) => String.fromCharCode(0x5c) + 'u' + n.toString(16).padStart(4, '0');
const INVISIBLE_RANGES: [number, number][] = [[0, 0x20], [0x7f, 0xa0], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180e], [0x1680, 0x1680], [0x2000, 0x200f], [0x2028, 0x202f], [0x205f, 0x206f], [0x3000, 0x3000], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xffff]];
const INVISIBLE = new RegExp('[' + INVISIBLE_RANGES.map(([a, b]) => hex(a) + '-' + hex(b)).join('') + hex(0xd800) + '-' + hex(0xdfff) + ']', 'u'); // with the u flag a lone surrogate matches, a valid pair does not
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const LDH = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const METADATA = new Set(['metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'instance-data.ec2.internal', 'metadata.azure.internal', 'metadata.tencentyun.com', 'metadata.platformequinix.com', 'kubernetes.default.svc']);
// Last labels that never name a public site: loopback, local network, reserved-for-documentation names that never resolve.
const RESERVED_TLD = new Set(['localhost', 'local', 'internal', 'arpa', 'localdomain', 'lan', 'intranet', 'corp', 'home', 'private', 'invalid', 'test', 'example', 'onion', 'svc', 'cluster']);

const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Arabic', 'Hebrew', 'Thai', 'Devanagari', 'Bengali', 'Tamil', 'Telugu', 'Armenian', 'Georgian'] as const;
const SCRIPT_RE = SCRIPTS.map((s) => [s, new RegExp(`^\\p{Script=${s}}$`, 'u')] as const);
const scriptOf = (ch: string): string | null => { for (const [s, re] of SCRIPT_RE) if (re.test(ch)) return s; return null; };
// Cyrillic and Greek letters that are drawn like Latin letters. A label made only of these can imitate a Latin name.
const LATIN_LOOKALIKE: Readonly<Record<string, ReadonlySet<string>>> = {
  Cyrillic: new Set([...'\u0430\u0441\u0435\u043e\u0440\u0445\u0443\u0456\u0458\u0455\u0501\u051b\u051d\u04bb\u04cf\u043a\u043c\u0442\u043d\u0432']),
  Greek: new Set([...'\u03bf\u03bd\u03b1\u03c1\u03c4\u03c5\u03b9\u03ba\u03b5\u03c7\u03f2\u03b2']),
};
const LATIN_EXTRA_OK = new Set([...'\u00df\u00e6\u0153\u00f8']);

type Label = { ok: true; ascii: string } | { ok: false; reason: RefusalReason };
const bad = (reason: RefusalReason): Label => ({ ok: false, reason });

/** Charset and script rules for the DECODED form of a label that contains non-ASCII letters. */
function checkUnicodeLabel(u: string): RefusalReason | null {
  if (!/^[\p{L}\p{M}\p{Nd}-]+$/u.test(u)) return 'bad_charset';
  const letters = [...u].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return 'bad_charset';
  if (/^\p{M}/u.test(u) || u.startsWith('-') || u.endsWith('-')) return 'bad_label';
  const scripts = new Set<string>();
  for (const c of letters) { const s = scriptOf(c); if (!s) return 'unsupported_script'; scripts.add(s); }
  if (scripts.size > 1) return 'mixed_script';
  const [script] = [...scripts];
  if (script === 'Latin') {
    for (const c of letters) {
      if (c.charCodeAt(0) < 128 || LATIN_EXTRA_OK.has(c)) continue;
      const base = c.normalize('NFD');
      if (!(base.length > 1 && base.charCodeAt(0) < 128 && /^\p{M}+$/u.test(base.slice(1)))) return 'confusable_char';
    }
  } else if (script === 'Cyrillic' || script === 'Greek') {
    if (letters.every((c) => LATIN_LOOKALIKE[script].has(c))) return 'whole_script_confusable';
  }
  return null;
}

function labelToAscii(raw: string): Label {
  const lower = raw.toLowerCase().normalize('NFC');
  if (/^[\x00-\x7f]*$/.test(lower)) {
    if (lower.length > 63) return bad('label_too_long');
    if (!/^[a-z0-9-]+$/.test(lower)) return bad('bad_label');
    if (lower.startsWith('xn--')) {
      const dec = domainToUnicode(lower);
      if (!dec || dec === lower || dec.includes('.') || /^[\x00-\x7f]*$/.test(dec)) return bad('invalid_punycode');
      if (domainToASCII(dec) !== lower) return bad('invalid_punycode');
      const r = checkUnicodeLabel(dec);
      return r ? bad(r) : { ok: true, ascii: lower };
    }
    if (!LDH.test(lower)) return bad('bad_label');
    if (lower.slice(2, 4) === '--') return bad('bad_label'); // reserved for IDNA
    return { ok: true, ascii: lower };
  }
  const ascii = domainToASCII(lower);
  if (!ascii) return bad('idna_mapped');
  if (ascii.includes('.') || !ascii.startsWith('xn--')) return bad('idna_mapped'); // IDNA folded or dropped something
  if (domainToUnicode(ascii) !== lower) return bad('idna_mapped');
  if (ascii.length > 63) return bad('label_too_long');
  const r = checkUnicodeLabel(lower);
  return r ? bad(r) : { ok: true, ascii };
}

export function normaliseOrigin(input: unknown, opts: OriginOptions = {}): OriginResult {
  try { return normalise(input, opts); } catch { return refuse('unparseable'); }
}

function normalise(input: unknown, opts: OriginOptions): OriginResult {
  if (typeof input !== 'string') return refuse('not_string');
  if (input === '') return refuse('empty');
  if (input.length > MAX_INPUT) return refuse('too_long');
  if (INVISIBLE.test(input)) return refuse('control_or_space');
  if (input.includes('\\')) return refuse('backslash');
  if (input.includes('%')) return refuse('percent_encoding');
  if (input.includes('*')) return refuse('wildcard');
  if (input.includes('?') || input.includes('#')) return refuse('query_or_fragment');
  if (input.includes('@')) return refuse('userinfo');

  const m = SCHEME.exec(input);
  if (!m) return refuse('scheme_required');
  const scheme = m[1].toLowerCase();
  if (scheme !== 'https' && !(scheme === 'http' && opts.allowInsecureHttpForTests === true)) return refuse('scheme_not_https');
  const afterScheme = input.slice(m[0].length);
  if (!afterScheme.startsWith('//')) return refuse('scheme_required');
  const rest = afterScheme.slice(2);
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? '' : rest.slice(slash);
  if (authority === '') return refuse('empty_host');
  if (path !== '' && path !== '/') return refuse('path');

  if (authority.startsWith('[')) return refuse('ip_literal');
  const colons = authority.split(':').length - 1;
  if (colons > 1) return refuse('ip_literal');
  let hostRaw = authority;
  let port: number | null = null;
  if (colons === 1) {
    const i = authority.indexOf(':');
    hostRaw = authority.slice(0, i);
    const p = authority.slice(i + 1);
    if (!/^[1-9][0-9]{0,4}$/.test(p) || Number(p) > 65535) return hostRaw === '' ? refuse('empty_host') : refuse('bad_port');
    port = Number(p);
  }
  if (hostRaw === '') return refuse('empty_host');
  if (hostRaw.endsWith('.')) return refuse('trailing_dot');
  const parts = hostRaw.split('.');
  if (parts.some((p) => p === '')) return refuse('empty_label');
  if (hostRaw.length > 253 * 2) return refuse('host_too_long'); // cheap bound before IDNA work

  const ascii: string[] = [];
  for (const p of parts) { const l = labelToAscii(p); if (!l.ok) return refuse(l.reason); ascii.push(l.ascii); }
  const host = ascii.join('.');
  if (host.length > 253) return refuse('host_too_long');
  const last = ascii[ascii.length - 1];
  if (/^(?:[0-9]+|0x[0-9a-f]*)$/.test(last)) return refuse('ip_literal'); // the WHATWG "ends in a number" rule: IPv4 in any spelling
  if (!/^[a-z]/.test(last)) return refuse('bad_label'); // a TLD starts with a letter or xn--
  if (METADATA.has(host)) return refuse('metadata_name');
  if (RESERVED_TLD.has(last)) return refuse('reserved_name');
  if (ascii.length < 2) return refuse('single_label');

  const def = scheme === 'https' ? 443 : 80;
  const origin = `${scheme}://${host}${port !== null && port !== def ? ':' + port : ''}`;
  // consistency check: the standard parser must agree with the hand-built result exactly
  const u = new URL(origin);
  if (u.origin !== origin || u.username || u.password || u.hostname !== host) return refuse('unparseable');
  return ok(origin);
}
