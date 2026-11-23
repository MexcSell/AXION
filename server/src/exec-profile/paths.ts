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

const ESC = /[.+^${}()|[\]\\]/g;
/** `**` crosses directories, `*` and `?` stay inside one path segment. Anchored, case-insensitive. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(ESC, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
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
  for (const g of patterns) if (globToRegExp(g).test(path)) return true;
  return false;
}
