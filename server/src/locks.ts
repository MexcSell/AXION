import type { Tx } from './db.ts';

/**
 * Transaction-level advisory lock keys, scoped to the current schema (like the audit-chain and events locks, c31).
 * Production has one schema, so the exclusivity is unchanged there. In the test database every test file has its own
 * schema with the same tenant and agent ids; an unscoped key (hashtext('agent-ver:t-1:coder-01')) let a test that parks
 * a writer on its own schema's lock stall another schema's writer past its 5 s lock_timeout (500s in unrelated tests).
 * LOCK_KEY_SQL takes the lock name as $1; tests that look the key up in pg_locks use the same expression.
 */
export const LOCK_KEY_SQL = "hashtextextended(current_schema() || ':' || $1, 0)";
export const advisoryXactLock = (c: Tx, name: string) => c.query(`select pg_advisory_xact_lock(${LOCK_KEY_SQL})`, [name]);
/**
 * A lock named `prefix + lower(name)` where the folding is PostgreSQL's lower(), the function a lower(name) unique index uses.
 * Folding in JS (toLowerCase) disagrees with it for some names (İ, Greek final sigma), so two names the index treats as equal
 * could take different locks and race into a unique violation.
 */
export const advisoryXactLockLower = (c: Tx, prefix: string, name: string) =>
  c.query(`select pg_advisory_xact_lock(${LOCK_KEY_SQL.replace('$1', "($1 || lower($2))")})`, [prefix, name]);
