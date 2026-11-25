import { makePool } from '../db.ts';
import { configFromEnv, DEFAULT_TENANT } from '../config.ts';
import { clearDemo } from '../seed/demo.ts';

const cmd = process.argv[2];
const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 2);
if (cmd === 'clear') {
  console.log(await clearDemo(pool, DEFAULT_TENANT));
} else { console.error('usage: demo.ts clear'); process.exit(2); }
await pool.end();
