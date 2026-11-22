// Public Suffix List algorithm (c56) over the pinned snapshot in public_suffix_list.dat (see its manifest; MPL-2.0 data).
// Pure, synchronous, no network: the list is read once from the vendored file. Both the ICANN and PRIVATE sections count.
// Algorithm (publicsuffix.org/list): match the rules against the labels; an exception rule (!) wins and its suffix is the rule
// minus its first label; otherwise the rule with the most labels wins (a wildcard * matches exactly one label); if no rule
// matches, the implicit rule "*" makes the last label the suffix. The registrable domain is the suffix plus one label.
// Rules written in Unicode are converted to their ASCII (punycode) form, so lookups always use ASCII hosts.
import { readFileSync } from 'node:fs';
import { domainToASCII } from 'node:url';

const normal = new Set<string>();
const wildcard = new Set<string>(); // stored without the leading "*."
const exception = new Set<string>(); // stored without the leading "!"

function load(): number {
  const text = readFileSync(new URL('./public_suffix_list.dat', import.meta.url), 'utf8');
  let n = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim().split(/\s/)[0]; // a rule ends at the first whitespace; "//" lines are comments
    if (!line || line.startsWith('//')) continue;
    const bang = line.startsWith('!');
    const body = bang ? line.slice(1) : line;
    const star = body.startsWith('*.');
    const ascii = domainToASCII((star ? body.slice(2) : body).toLowerCase());
    if (!ascii) continue;
    (bang ? exception : star ? wildcard : normal).add(ascii);
    n++;
  }
  return n;
}
export const PSL_RULE_COUNT = load();

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
