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

type Tok = { t: 'lit'; c: string } | { t: 'any1' } | { t: 'star' } | { t: 'dstar' } | { t: 'dslash' };
/** `**` crosses directories, `**` + `/` matches zero or more whole directories, `*` and `?` stay inside one path segment. Consecutive `**` + `/` collapse. */
function tokenise(glob: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { i += 2; if (out[out.length - 1]?.t !== 'dslash') out.push({ t: 'dslash' }); } else { i += 1; if (out[out.length - 1]?.t !== 'dstar') out.push({ t: 'dstar' }); }
    } else if (c === '*') { if (out[out.length - 1]?.t !== 'star') out.push({ t: 'star' }); }
    else if (c === '?') out.push({ t: 'any1' });
    else out.push({ t: 'lit', c: c.toLowerCase() });
  }
  return out;
}

/** Why a forbidden-pattern text is refused, or null. Bounded so matching cost stays small and predictable. */
export function patternProblem(g: unknown): string | null {
  if (typeof g !== 'string' || g === '') return 'empty or not text';
  if (g.length > MAX_PATTERN_LENGTH) return `longer than ${MAX_PATTERN_LENGTH} characters`;
  if (/[\p{Cc}\p{Cf}\p{Cs}\\]/u.test(g)) return 'control characters or backslash';
  if ((g.match(/\*\*/g) ?? []).length > MAX_DOUBLE_STAR) return `more than ${MAX_DOUBLE_STAR} "**"`;
  if ((g.match(/\*/g) ?? []).length > 12 || (g.match(/\?/g) ?? []).length > 12) return 'too many wildcards';
  return null;
}

/** Glob match by dynamic programming over (pattern token, path position): O(tokens x path length), no backtracking, so no ReDoS. Case-insensitive, anchored. */
export function globMatch(glob: string, path: string): boolean {
  const toks = tokenise(glob);
  const p = path.toLowerCase();
  const n = p.length;
  let dp = new Uint8Array(n + 1); dp[0] = 1;
  for (const tk of toks) {
    const nx = new Uint8Array(n + 1);
    if (tk.t === 'lit') { for (let i = 0; i < n; i++) if (dp[i] && p[i] === tk.c) nx[i + 1] = 1; }
    else if (tk.t === 'any1') { for (let i = 0; i < n; i++) if (dp[i] && p[i] !== '/') nx[i + 1] = 1; }
    else if (tk.t === 'star') { let run = 0; for (let j = 0; j <= n; j++) { run = dp[j] || (run && j > 0 && p[j - 1] !== '/') ? 1 : 0; nx[j] = run; } }
    else if (tk.t === 'dstar') { let run = 0; for (let j = 0; j <= n; j++) { if (dp[j]) run = 1; nx[j] = run; } }
    else { let seen = 0; for (let j = 0; j <= n; j++) { if (dp[j]) nx[j] = 1; if (j > 0 && p[j - 1] === '/' && seen) nx[j] = 1; if (dp[j]) seen = 1; } }
    dp = nx;
  }
  return dp[n] === 1;
}

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
  for (const g of patterns) if (globMatch(g, path) || globMatch(g, dir)) return true;
  return false;
}

/** Directories that are never a scope (and everything under them): they hold the system's own state and credentials. /proc/self/root reaches the whole file system. */
export const SENSITIVE_ROOTS: readonly string[] = Object.freeze(['/etc', '/proc', '/root', '/sys', '/dev']);
export const isSensitiveScope = (path: string): boolean => path === '/' || SENSITIVE_ROOTS.some((r) => isUnder(path, r));
