import { makePool } from './db.ts';
import { migrate } from './migrate.ts';
import { configFromEnv } from './config.ts';

const [dir = 'up', target] = process.argv.slice(2);
const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 1);
const v = await migrate(pool, dir === 'down' ? 'down' : 'up', target === undefined ? undefined : Number(target));
console.log(`schema at version ${v}`);
await pool.end();
