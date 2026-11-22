import { makePool } from '../db.ts';
import { configFromEnv, DEFAULT_TENANT } from '../config.ts';
import { exportMissionToFile, parseExportArgs, USAGE } from '../otel/cli.ts';

// `npm run export:otlp -- <missionId>` (c60, R2-8): read-only on the database, writes one local OTLP-JSON file. Not a route.
// Nothing is sent anywhere: no collector, no network. Content (titles, notes, step text) is off unless --include-content.
let code = 1;
try {
  const args = parseExportArgs(process.argv.slice(2));
  const cfg = configFromEnv();
  const pool = makePool(cfg.databaseUrl, cfg.schema, 2);
  try {
    const r = await exportMissionToFile(pool, { tenant: args.tenant ?? DEFAULT_TENANT, missionId: args.missionId, out: args.out, includeContent: args.includeContent, force: args.force });
    console.log(`wrote ${r.spans} spans to ${r.out} (content ${r.includeContent ? 'INCLUDED' : 'off: pointers only'})`);
    code = 0;
  } finally { await pool.end(); }
} catch (e) {
  console.error(`export failed: ${(e as Error).message}`);
  if (/mission id is required|Unknown option|needs a value|Unexpected argument/.test((e as Error).message)) console.error(USAGE);
}
process.exit(code);
