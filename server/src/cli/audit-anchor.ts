import { makePool } from '../db.ts';
import { configFromEnv } from '../config.ts';
import { writeAnchor, anchorSettings } from '../audit-anchor.ts';

// `npm run audit:anchor`: appends a signed checkpoint of every tenant's audit head to the anchor file (operator command, never a timer).
// Needs AUDIT_ANCHOR_KEY (>= 32 bytes) in the environment. Exit 0 when written, 1 when refused. Prints no key and no file contents.
const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 2);
let code = 0;
try {
  const r = await writeAnchor(pool);
  console.log(`audit anchor written: ${r.written.map((w) => `${w.tenant}@${w.seq}`).join(', ')} -> ${anchorSettings().file}`);
} catch (e) {
  console.error(`audit anchor NOT written: ${(e as Error).message}`);
  code = 1;
}
await pool.end();
process.exit(code);
