import { makePool } from '../db.ts';
import { configFromEnv } from '../config.ts';
import { writeAnchor, rotateAnchor, anchorState, anchorSettings } from '../audit-anchor.ts';

// `npm run audit:anchor`: appends a signed checkpoint of every tenant's audit head to the anchor file (operator command, never a timer).
// `npm run audit:anchor -- --rotate --confirm <old last line n> [--force] [--actor note]` archives the old file (never deletes) and starts a new one.
// Needs AUDIT_ANCHOR_KEY (>= 32 bytes) and AUDIT_ANCHOR_DOMAIN in the environment. Exit 0 when written, 1 when refused. Prints no key and no file contents.
const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 2);
let code = 0;
try {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  if (process.argv.includes('--rotate')) {
    const st = await anchorState(pool);
    console.log(`old anchor file: ${st.lines} lines, last line ${st.lastN ?? '-'}${st.lastSig ? ` sig ${st.lastSig.slice(0, 12)}` : ''}; state: ${st.report.ok ? 'ok' : st.report.tenants.map((t) => `${t.tenant} ${t.status}${t.anchoredSeq ? ` (anchored through seq ${t.anchoredSeq})` : ''}`).join(', ') || (st.report.reason ?? 'unknown')}`);
    const r = await rotateAnchor(pool, { confirm: arg('--confirm'), force: process.argv.includes('--force'), actorNote: arg('--actor') });
    console.log(`audit anchor file archived as ${r.archived} (kept as evidence, sha256 ${r.sha256.slice(0, 12)}), the event recorded in the audit log, and a new file started (line ${r.lastN} sig prefix: see audit:verify)`);
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
