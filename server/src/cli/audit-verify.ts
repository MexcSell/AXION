import { makePool } from '../db.ts';
import { configFromEnv, DEFAULT_TENANT } from '../config.ts';
import { verifyChain } from '../audit.ts';
import { verifyAnchors } from '../audit-anchor.ts';

// `npm run audit:verify [tenant]`: read-only. Exit 0 only when the chain is intact AND every anchored head is still in it (c49).
// No key or no anchor file is reported as "not verifiable" and exits 1 (never as ok).
const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 2);
const tenant = process.argv[2] ?? DEFAULT_TENANT;
let code = 1;
try {
const r = await verifyChain(pool, tenant);
console.log(r.ok ? `audit chain OK for ${tenant}: ${r.checked} rows` : `audit chain BROKEN for ${tenant} at seq ${r.firstBadSeq}: ${r.reason} (${r.checked} rows fine before it)`);
const a = await verifyAnchors(pool, { tenant });
for (const t of a.tenants) console.log(`audit anchor ${t.status === 'ok' ? 'OK' : t.status.toUpperCase()} for ${t.tenant}${t.anchoredSeq ? ` (anchored through seq ${t.anchoredSeq})` : ''}${t.reason ? `: ${t.reason}` : ''}`);
if (a.rotatedFrom) console.log(`audit anchor file restarted on ${a.rotatedFrom.at} (previous file archived as ${a.rotatedFrom.archive}, sha256 ${a.rotatedFrom.sha256.slice(0, 12)})`);
if (!a.tenants.length) console.log(`audit anchor not verifiable: ${a.reason ?? 'nothing to check'}`);
code = r.ok && a.ok ? 0 : 1;
} catch (e) {
  console.error(`audit verify failed: ${(e as Error).message}`);
} finally { await pool.end(); }
process.exit(code);
