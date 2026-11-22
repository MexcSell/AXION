import { makePool } from '../db.ts';
import { configFromEnv, DEFAULT_TENANT } from '../config.ts';
import { verifyChain } from '../audit.ts';

// `npm run audit:verify [tenant]`: read-only. Exit 0 when the chain is intact, 1 when it is not.
const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 2);
const tenant = process.argv[2] ?? DEFAULT_TENANT;
const r = await verifyChain(pool, tenant);
console.log(r.ok ? `audit chain OK for ${tenant}: ${r.checked} rows` : `audit chain BROKEN for ${tenant} at seq ${r.firstBadSeq}: ${r.reason} (${r.checked} rows fine before it)`);
await pool.end();
process.exit(r.ok ? 0 : 1);
