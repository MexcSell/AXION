import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { canonical } from '../approvals/service.ts';

/**
 * c76 R1: the guardrail-path rule for RELEASE RECORDS (spec section 13.3). A release record whose change touches the policy, the
 * approvals, the audit trail, the locks or the migrations is refused unless an R4 approval bound to that exact release is named.
 * This module only classifies paths. It never reads or writes a file and never runs anything.
 *
 * The rule errs on the side of "guarded": a path segment that STARTS WITH one of these names (policy or policies, approval(s), audit..., lock(s), migration(s), migrate, guardrail(s), metric-audit(s))
 * and continues with a separator, dot, dash, underscore or the end counts. `server/src/audit-anchor.ts` and `docs/policy-notes.md` are guarded on purpose.
 * The same expression lives in the 0056 trigger (GUARDED_SQL); a test checks that the two agree.
 */
export const GUARDED_RE_SOURCE = '(^|/)(polic(y|ies)|approvals?|audit[a-z_-]*|locks?|migrations?|migrate|guardrails?|metric-audits?)([/._-]|$)';
const GUARDED_RE = new RegExp(GUARDED_RE_SOURCE);
export const MAX_PATH_LEN = 300;

/** Fold width and compatibility forms (NFKC) and case, so a full-width or upper-case spelling cannot slip past. */
const fold = (p: string) => p.normalize('NFKC').toLowerCase();
export const isGuardedPath = (p: string): boolean => GUARDED_RE.test(fold(p));
/** The same test as SQL, for the table trigger; `expr` is a SQL text expression. */
export const GUARDED_SQL = (expr: string) => `lower(normalize(${expr}, NFKC)) ~ '${GUARDED_RE_SOURCE}'`;

export type PathResult = { ok: true; path: string } | { ok: false; reason: string };
/**
 * A change path is stored in one normal form: NFKC (case kept), forward slashes, no `.` or empty segments. A path that climbs out (`..`), is absolute,
 * has a control character, a percent escape or a drive colon is refused (fail closed: an encoded spelling is never decoded for it).
 */
export function normalisePath(input: string): PathResult {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PATH_LEN) return { ok: false, reason: 'A path must be 1 to 300 characters.' };
  if (/[\u0000-\u001f\u007f%:]|\p{Cf}/u.test(input)) return { ok: false, reason: 'A path cannot hold control characters, percent escapes or a colon.' };
  const f = input.trim().normalize('NFKC').replace(/\\/g, '/');
  if (f.startsWith('/')) return { ok: false, reason: 'A path must be relative to the repository root.' };
  const n = posix.normalize(f).replace(/^(\.\/)+/, '');
  if (n === '.' || n === '' || n === '..' || n.startsWith('../') || n.split('/').includes('..')) return { ok: false, reason: 'A path cannot be empty or climb out of the repository.' };
  return { ok: true, path: n.replace(/\/$/, '') };
}

/** What an R4 approval must carry in its payload as `releaseDigest` to be bound to this release (tenant, version and the path set). */
export const releaseDigest = (tenantId: string, version: string, paths: readonly string[]): string =>
  createHash('sha256').update(canonical({ v: 1, tenantId, version, changePaths: [...paths].sort() })).digest('hex');
