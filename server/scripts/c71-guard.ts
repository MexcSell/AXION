import { isE2eDatabaseUrl } from '../src/cli/e2e-url.ts';

/**
 * Guard for scripts/c71-scale.ts, which WIPES its database (migrate down 0). The project's e2e guard (isE2eDatabaseUrl: `axion_e2e` or
 * `axion_e2e<digits>`), a local host, no query string or fragment (pg honours `?host=`), and CONFIRM_WIPE=1 in the environment. The live `axion`
 * database, `axion_test` and every other name are refused. Throws on the first failed rule; touches no database.
 */
export function assertC71Wipe(target: string | undefined, confirm: string | undefined): string {
  if (!target) throw new Error('E2E_DATABASE_URL is not set');
  let u: URL;
  try { u = new URL(target); } catch { throw new Error('the target database URL does not parse'); }
  if (u.search !== '' || u.hash !== '') throw new Error('refusing a database URL with a query string or fragment (pg honours ?host=)');
  if (!isE2eDatabaseUrl(target)) throw new Error(`refusing to wipe "${decodeURIComponent(u.pathname.replace(/^\//, ''))}": only axion_e2e or axion_e2e<digits>`);
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw new Error(`refusing to wipe a database on host "${u.hostname}": only 127.0.0.1`);
  if (confirm !== '1') throw new Error('set CONFIRM_WIPE=1 to confirm that this database will be emptied');
  return decodeURIComponent(u.pathname.replace(/^\//, ''));
}
