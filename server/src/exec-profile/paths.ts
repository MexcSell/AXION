// Path helpers shared by the exec-profile validator and decider (c94). PURE: strings only, no file system access, no symlink
// resolution (a symlink inside a granted directory is an ENFORCEMENT problem for the future sandbox, not something a decider can see).
import { posix } from 'node:path';

/** Credential files that are forbidden in every profile, whatever the profile says. A profile's own patterns are added to these. */
export const BUILTIN_CREDENTIAL_PATTERNS: readonly string[] = Object.freeze([
  '**/.env', '**/.env.*', '**/*.env', '**/.envrc',
  '**/.aws/**', '**/.azure/**', '**/.config/gcloud/**', '**/.config/gh/**', '**/.kube/**', '**/.docker/config.json',
  '**/.ssh/**', '**/id_rsa*', '**/id_ed25519*', '**/id_ecdsa*', '**/id_dsa*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.kdbx',
  '**/.npmrc', '**/.pypirc', '**/.netrc', '**/.git-credentials', '**/.gnupg/**', '**/.pgpass', '**/credentials', '**/credentials.json',
  '**/service-account*.json', '**/.vault-token', '**/secrets.yml', '**/secrets.yaml',
  '/etc/shadow', '/etc/sudoers', '/etc/sudoers.d/**', '/proc/*/environ', '/proc/*/mem',
]);

export const MAX_PATTERN_LENGTH = 128;
export const MAX_PATTERNS = 32;
export const MAX_DOUBLE_STAR = 3;

/** Case folding for matching: lower-case one character at a time, and the final sigma folds to the ordinary small sigma (so capital sigma, sigma and final sigma all match each other). Over-matching is the safe side for a forbidden-pattern list. */
const foldChar = (ch: string): string => { const l = ch.toLowerCase(); return l === '\u03c2' ? '\u03c3' : l; };
type Tok = { t: 'lit'; c: number } | { t: 'any1' } | { t: 'star' } | { t: 'dstar' } | { t: 'dslash' };
/** `**` crosses directories, `**` + `/` matches zero or more whole directories, `*` and `?` stay inside one path segment. Consecutive `**` + `/` collapse.
 *  A literal is the lower-case code unit of its character; a character whose lower-case form is not one code unit gets -1 and never matches
 *  (the validator refuses such patterns, c99 X1-3, so only a hand-built call can reach that). */
function tokenise(glob: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { i += 2; if (out[out.length - 1]?.t !== 'dslash') out.push({ t: 'dslash' }); } else { i += 1; if (out[out.length - 1]?.t !== 'dstar') out.push({ t: 'dstar' }); }
    } else if (c === '*') { if (out[out.length - 1]?.t !== 'star') out.push({ t: 'star' }); }
    else if (c === '?') out.push({ t: 'any1' });
    else { const l = foldChar(c); out.push({ t: 'lit', c: l.length === 1 ? l.charCodeAt(0) : -1 }); }
  }
  return out;
}

/** Why a forbidden-pattern text is refused, or null. Bounded so matching cost stays small and predictable. */
export function patternProblem(g: unknown): string | null {
  if (typeof g !== 'string' || g === '') return 'empty or not text';
  if (g.length > MAX_PATTERN_LENGTH) return `longer than ${MAX_PATTERN_LENGTH} characters`;
  if (/[\p{Cc}\p{Cf}\p{Cs}\\]/u.test(g)) return 'control characters or backslash';
  // c99 X1-3: a character whose lower-case form has another length (U+0130 becomes two code units) would sit in the token list as a
  // literal that can never equal one path character, so the pattern would silently never match. Refuse it instead.
  for (const ch of g) if (ch.toLowerCase().length !== ch.length) return 'a character whose lower-case form changes length';
  if ((g.match(/\*\*/g) ?? []).length > MAX_DOUBLE_STAR) return `more than ${MAX_DOUBLE_STAR} "**"`;
  if ((g.match(/\*/g) ?? []).length > 12 || (g.match(/\?/g) ?? []).length > 12) return 'too many wildcards';
  return null;
}

/** A path prepared once for matching against many patterns: lower-cased code units. */
export interface PreparedPath { codes: Uint16Array; n: number }
export function preparePath(path: string): PreparedPath {
  // folded ONE CHARACTER AT A TIME, like the pattern literals: String.toLowerCase() on the whole text turns a word-final capital sigma into the
  // final form, which a per-character pattern never matched (c99: the same silent miss as U+0130)
  let p = '';
  for (const ch of path) p += foldChar(ch);
  const codes = new Uint16Array(p.length);
  for (let i = 0; i < p.length; i++) codes[i] = p.charCodeAt(i);
  return { codes, n: p.length };
}
const SLASH = 47;

/** Glob match by dynamic programming over (pattern token, path position): O(tokens x path length), no backtracking, so no ReDoS. Case-insensitive, anchored.
 *  Returns the final reachability row: row[k] is 1 when the pattern matches exactly the first k characters of the prepared text (every step only looks at
 *  characters it consumes or the one before, so one pass over `path + "/"` answers both "matches path" and "matches path as a directory").
 *  c99: two buffers are reused and each step only visits the window [lo, hi] of positions still reachable; a step that reaches nothing ends the match. */
export function globRow(glob: string, pp: PreparedPath): Uint8Array {
  const toks = tokenise(glob);
  const { codes: p, n } = pp;
  let dp = new Uint8Array(n + 2); let nx = new Uint8Array(n + 2);
  dp[0] = 1;
  let lo = 0; let hi = 0; // every nonzero position of dp lies in [lo, hi]
  for (const tk of toks) {
    let nlo = n + 1; let nhi = -1;
    if (tk.t === 'lit') {
      const c = tk.c;
      for (let i = lo; i <= hi && i < n; i++) if (dp[i] === 1 && p[i] === c) { nx[i + 1] = 1; if (nhi < 0) nlo = i + 1; nhi = i + 1; }
    } else if (tk.t === 'any1') {
      for (let i = lo; i <= hi && i < n; i++) if (dp[i] === 1 && p[i] !== SLASH) { nx[i + 1] = 1; if (nhi < 0) nlo = i + 1; nhi = i + 1; }
    } else if (tk.t === 'star') {
      let run = 0;
      for (let j = lo; j <= n; j++) {
        run = dp[j] === 1 || (run === 1 && j > 0 && p[j - 1] !== SLASH) ? 1 : 0;
        if (run === 1) { nx[j] = 1; if (nhi < 0) nlo = j; nhi = j; } else if (j > hi) break;
      }
    } else if (tk.t === 'dstar') {
      for (let j = lo; j <= n; j++) nx[j] = 1;
      nlo = lo; nhi = n;
    } else {
      let seen = 0;
      for (let j = lo; j <= n; j++) {
        if (dp[j] === 1) { nx[j] = 1; seen = 1; if (nhi < 0) nlo = j; nhi = j; }
        else if (seen === 1 && j > 0 && p[j - 1] === SLASH) { nx[j] = 1; if (nhi < 0) nlo = j; nhi = j; }
      }
    }
    if (nhi < 0) return new Uint8Array(n + 2);
    dp.fill(0, lo, Math.min(n + 2, hi + 1)); // the old row becomes the next scratch row: keep the "all zero outside the window" invariant
    const t = dp; dp = nx; nx = t; lo = nlo; hi = nhi;
  }
  return dp;
}
export const globMatchPrepared = (glob: string, pp: PreparedPath): boolean => globRow(glob, pp)[pp.n] === 1;
export const globMatch = (glob: string, path: string): boolean => globMatchPrepared(glob, preparePath(path));

export type PathProblem = 'not_string' | 'not_absolute' | 'traversal' | 'encoded' | 'wildcard';
/** Strict absolute-path normaliser: refuses (never repairs) relative paths, NUL, backslash, `..` segments, percent-encoding and wildcards.
 *  Collapses duplicate slashes, `.` segments and a trailing slash. */
export function normaliseAbsolutePath(p: unknown): { ok: true; path: string } | { ok: false; problem: PathProblem } {
  if (typeof p !== 'string') return { ok: false, problem: 'not_string' };
  if (p.length === 0 || p.length > 4096 || !p.startsWith('/') || p.includes('\0') || p.includes('\\') || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(p)) return { ok: false, problem: 'not_absolute' };
  if (/%[0-9a-f]{2}/i.test(p)) return { ok: false, problem: 'encoded' };
  if (/[*?[\]{}]/.test(p)) return { ok: false, problem: 'wildcard' };
  if (p.split('/').some((s) => s === '..' || /^\.{2,}$/.test(s))) return { ok: false, problem: 'traversal' };
  return { ok: true, path: posix.normalize(p).replace(/(.)\/$/, '$1') };
}

/** True when `path` is `dir` or lies under it (segment boundary, so /work/out2 is not under /work/out). Both must be normalised. */
export const isUnder = (path: string, dir: string): boolean => path === dir || path.startsWith(dir === '/' ? '/' : dir + '/');

export function matchesAnyPattern(path: string, patterns: readonly string[]): boolean {
  const dir = path.endsWith('/') ? path : path + '/'; // a credential DIRECTORY is forbidden too, not only what is inside it
  const pp = preparePath(dir); // one pass over the directory form answers both questions (see globRow)
  const k = dir === path ? pp.n : pp.n - 1; // the length of the lower-cased path itself (lower-casing can change a length)
  for (const g of patterns) { const row = globRow(g, pp); if (row[k] === 1 || row[pp.n] === 1) return true; }
  return false;
}

/** Directories that are never a scope (and everything under them): they hold the system's own state and credentials. /proc/self/root reaches the whole file system. */
export const SENSITIVE_ROOTS: readonly string[] = Object.freeze(['/etc', '/proc', '/root', '/sys', '/dev', '/var/run', '/run']);
export const isSensitiveScope = (path: string): boolean => path === '/' || SENSITIVE_ROOTS.some((r) => isUnder(path, r));
