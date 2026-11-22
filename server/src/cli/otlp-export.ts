import { makePool } from '../db.ts';
import { DEFAULT_TENANT } from '../config.ts';
import { describeExport, exportMissionToFile, parseExportArgs, resolveDatabaseUrl, USAGE } from '../otel/cli.ts';

// `npm run export:otlp -- <missionId> --database-url-env VAR` (c60, R2-8): writes one local OTLP-JSON file. Not a route. There is no default
// database: the operator names the environment variable that holds the URL. All reads run in one REPEATABLE READ READ ONLY transaction
// (default_transaction_read_only is on for the connection too). Nothing is sent anywhere: no collector, no network beyond the database.
// Content (titles, notes, step text) is off unless --include-content. An operator tool: tenant scope, no per-person visibility.
let code = 1;
try {
  const args = parseExportArgs(process.argv.slice(2));
  const url = resolveDatabaseUrl(args, process.env);
  const pool = makePool(url, process.env.DATABASE_SCHEMA || undefined, 2);
  pool.on('connect', (c) => { void c.query('set default_transaction_read_only = on'); });
  try {
    const r = await exportMissionToFile(pool, { tenant: args.tenant ?? DEFAULT_TENANT, missionId: args.missionId, out: args.out, includeContent: args.includeContent, force: args.force });
    console.log(describeExport(r));
    code = 0;
  } finally { await pool.end(); }
} catch (e) {
  console.error(`export failed: ${(e as Error).message}`);
  if (/mission id is required|Unknown option|needs a value|Unexpected argument|--database-url-env is required|is not set/.test((e as Error).message)) console.error(USAGE);
}
process.exit(code);
