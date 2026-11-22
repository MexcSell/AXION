import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for scripts that WIPE a database (migrate down to 0). The target must be this worktree's own e2e database, proven by
 * comparing the FULL target URL with E2E_DATABASE_URL in this worktree's server/.env (the file, not the process environment), and
 * the host must be local. Any database not named axion_e2e<N> (axion, axion_test, ...) is refused, and the operator must confirm
 * the exact name with CONFIRM_WIPE=<dbname>. Throws on the first failed rule; touches no database.
 */
export function assertLaneWipe(target: string | undefined, worktreeRoot: string, confirm: string | undefined): string {
  if (!target) throw new Error('E2E_DATABASE_URL is not set');
  let u: URL;
  try { u = new URL(target); } catch { throw new Error('the target database URL does not parse'); }
  if (u.search !== '' || u.hash !== '') throw new Error('refusing a database URL with a query string or fragment (pg honours ?host=)');
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!/^axion_e2e\d+$/.test(name)) throw new Error(`refusing to wipe "${name}": only axion_e2e<N> databases may be wiped`);
  if (u.hostname !== '127.0.0.1') throw new Error(`refusing to wipe a database on host "${u.hostname}": only 127.0.0.1`);
  let own: string | undefined;
  try { own = readFileSync(join(worktreeRoot, 'server', '.env'), 'utf8').split('\n').find((l) => l.startsWith('E2E_DATABASE_URL='))?.slice('E2E_DATABASE_URL='.length).trim(); } catch { /* handled below */ }
  if (!own) throw new Error("this worktree's server/.env has no E2E_DATABASE_URL to compare with");
  if (own !== target) throw new Error("refusing to wipe: the target is not this worktree's own E2E_DATABASE_URL (server/.env)");
  if (confirm !== name) throw new Error(`set CONFIRM_WIPE=${name} to confirm that this database will be emptied`);
  return name;
}
