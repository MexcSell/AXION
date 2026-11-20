import { makePool } from '../db.ts';
import { configFromEnv, DEFAULT_TENANT } from '../config.ts';
import { seedDemo, clearDemo } from '../seed/demo.ts';

const cmd = process.argv[2];
const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 2);
if (cmd === 'seed') {
  const admin = (await pool.query(`select id from users where tenant_id=$1 and role='admin' and status='approved' order by created_at limit 1`, [DEFAULT_TENANT])).rows[0];
  if (!admin) { console.error('No administrator yet: connect once in the browser first (the first account becomes the administrator).'); process.exit(1); }
  console.log(await seedDemo(pool, DEFAULT_TENANT, admin.id));
} else if (cmd === 'clear') {
  console.log(await clearDemo(pool, DEFAULT_TENANT));
} else { console.error('usage: demo.ts seed|clear'); process.exit(2); }
await pool.end();
