import { makePool } from '../db.ts';
import { configFromEnv, DEFAULT_TENANT } from '../config.ts';
import { approveNewestDevice } from '../auth/service.ts';

const name = process.argv.slice(2).join(' ').trim();
if (!name) { console.error('usage: npm run admin:approve-device -- <user name>'); process.exit(2); }
const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 1);
const r = await approveNewestDevice(pool, DEFAULT_TENANT, name);
console.log(r.approved ? `approved device "${r.device}" for ${name}` : `nothing approved: ${r.reason}`);
await pool.end();
process.exit(r.approved ? 0 : 1);
