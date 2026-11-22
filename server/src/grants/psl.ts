// Public Suffix List algorithm (c56) over the pinned snapshot in public_suffix_list.dat (see its manifest; MPL-2.0 data).
// Pure, synchronous, no network: the list is read once from the vendored file. Both the ICANN and PRIVATE sections count.
// Algorithm (publicsuffix.org/list): match the rules against the labels; an exception rule (!) wins and its suffix is the rule
// minus its first label; otherwise the rule with the most labels wins (a wildcard * matches exactly one label); if no rule
// matches, the implicit rule "*" makes the last label the suffix. The registrable domain is the suffix plus one label.
// Rules written in Unicode are converted to their ASCII (punycode) form, so lookups always use ASCII hosts.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

type Tables = { normal: Set<string>; wildcard: Set<string>; exception: Set<string>; count: number };
const MIN_RULES = 8000; // the real list has about 10,500 rules; a file with fewer is truncated or wrong
// Rules that must be present in any genuine snapshot (a normal rule, a private-section rule, a wildcard and its exception).
const SENTINELS = { normal: ['co.uk', 'github.io'], wildcard: ['ck'], exception: ['www.ck'] };

/**
 * Parse a snapshot, failing closed: throw when its SHA-256 differs from the manifest hash, or when it has too few rules or lacks
 * a sentinel rule. A thrown error at import stops the server from starting, so a corrupt list never silently accepts suffixes.
 * Takes the content and the expected hash so tests can exercise bad snapshots without touching the real file.
 */
export function parseSnapshot(text: string, expectedSha256: string): Tables {
  const got = createHash('sha256').update(text, 'utf8').digest('hex');
  if (got !== expectedSha256) throw new Error(`Public suffix list snapshot does not match its manifest (SHA-256 ${got}, expected ${expectedSha256})`);
  const t: Tables = { normal: new Set(), wildcard: new Set(), exception: new Set(), count: 0 }; // wildcard and exception stored without "*." / "!"
  for (const raw of text.split('\n')) {
    const line = raw.trim().split(/\s/)[0]; // a rule ends at the first whitespace; "//" lines are comments
    if (!line || line.startsWith('//')) continue;
    const bang = line.startsWith('!');
    const body = bang ? line.slice(1) : line;
    const star = body.startsWith('*.');
    const ascii = domainToASCII((star ? body.slice(2) : body).toLowerCase());
    if (!ascii) continue;
    (bang ? t.exception : star ? t.wildcard : t.normal).add(ascii);
    t.count++;
  }
  if (t.count < MIN_RULES) throw new Error(`Public suffix list snapshot has only ${t.count} rules (minimum ${MIN_RULES}): truncated or empty`);
  for (const k of ['normal', 'wildcard', 'exception'] as const) {
    for (const r of SENTINELS[k]) if (!t[k].has(r)) throw new Error(`Public suffix list snapshot lacks the sentinel ${k} rule "${r}"`);
  }
  return t;
}

function loadReal(): Tables {
  const dir = new URL('./', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('public_suffix_list.manifest.json', dir), 'utf8')) as { list: { sha256: string } };
  return parseSnapshot(readFileSync(new URL('public_suffix_list.dat', dir), 'utf8'), manifest.list.sha256);
}
const { normal, wildcard, exception, count } = loadReal();
export const PSL_RULE_COUNT = count;

const split = (host: string): string[] | null => {
  if (typeof host !== 'string' || host === '' || host.startsWith('.') || host.endsWith('.')) return null;
  const ascii = /^[\x00-\x7f]*$/.test(host) ? host.toLowerCase() : domainToASCII(host.toLowerCase());
  if (!ascii) return null;
  const labels = ascii.split('.');
  return labels.some((l) => l === '') ? null : labels;
};

/** Number of labels (from the right) that form the public suffix of the labels. */
function suffixLength(labels: string[]): number {
  const n = labels.length;
  let best = 1; // the implicit "*" rule
  for (let i = 0; i < n; i++) {
    const cand = labels.slice(i).join('.');
    if (exception.has(cand)) return n - i - 1; // an exception rule prevails; it is the longest match for its own labels
    if (normal.has(cand)) best = Math.max(best, n - i);
    if (i + 1 < n && wildcard.has(labels.slice(i + 1).join('.'))) best = Math.max(best, n - i);
  }
  return best;
}

/** The public suffix of a host (ASCII form, lowercase), or null for input that is not a host. */
export function publicSuffixOf(host: string): string | null {
  const labels = split(host);
  return labels ? labels.slice(labels.length - suffixLength(labels)).join('.') : null;
}
/** The registrable domain (suffix plus one label), or null when the host is itself a public suffix or not a host. */
export function registrableDomain(host: string): string | null {
  const labels = split(host);
  if (!labels) return null;
  const k = suffixLength(labels);
  return labels.length > k ? labels.slice(labels.length - k - 1).join('.') : null;
}
/** True when the whole host is a public suffix: a name that would cover every site under it. */
export function isPublicSuffix(host: string): boolean {
  const labels = split(host);
  return !!labels && suffixLength(labels) >= labels.length;
}
