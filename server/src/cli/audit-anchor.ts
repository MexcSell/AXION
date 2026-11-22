import { makePool } from '../db.ts';
import { configFromEnv } from '../config.ts';
import { writeAnchor, rotateAnchor, anchorSettings } from '../audit-anchor.ts';

// `npm run audit:anchor`: appends a signed checkpoint of every tenant's audit head to the anchor file (operator command, never a timer).
// `npm run audit:anchor -- --rotate` archives a file that no longer verifies (never deletes) and records that in the audit log.
// Needs AUDIT_ANCHOR_KEY (>= 32 bytes) in the environment. Exit 0 when written, 1 when refused. Prints no key and no file contents.
const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 2);
let code = 0;
try {
  if (process.argv.includes('--rotate')) {
    const r = await rotateAnchor(pool);
    console.log(`audit anchor file archived as ${r.archived} (kept as evidence) and the archive event recorded in the audit log; run npm run audit:anchor to start a new file`);
  } else {
    const r = await writeAnchor(pool);
    console.log(`audit anchor written: ${r.written.map((w) => `${w.tenant}@${w.seq}`).join(', ')} -> ${anchorSettings().file}`);
    console.log(`copy off-host: line ${r.lastN} sig ${r.lastSig.slice(0, 12)}`);
  }
} catch (e) {
  console.error(`audit anchor NOT written: ${(e as Error).message}`);
  code = 1;
}
await pool.end();
process.exit(code);
