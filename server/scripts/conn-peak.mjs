// c93: samples pg_stat_activity for ONE test database (default: the DB named in TEST_DATABASE_URL), one connection of its own.
// Never point it at the live database. Usage: node scripts/conn-peak.mjs out.jsonl   (stop with SIGTERM; prints peak on exit)
import pg from 'pg';
import { writeFileSync, appendFileSync } from 'node:fs';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL missing');
const dbname = new URL(url).pathname.slice(1);
if (dbname === 'axion') throw new Error('refusing to sample the live database');
const out = process.argv[2];
writeFileSync(out, '');
const c = new pg.Client({ connectionString: url, application_name: 'conn-peak' });
await c.connect();
let peak = 0, stop = false;
const done = () => { stop = true; };
process.on('SIGTERM', done); process.on('SIGINT', done);
while (!stop) {
  const r = await c.query(`select count(*)::int n from pg_stat_activity where datname = $1 and usename = 'axion' and pid <> pg_backend_pid()`, [dbname]);
  const n = r.rows[0].n; peak = Math.max(peak, n);
  appendFileSync(out, JSON.stringify({ t: Date.now(), n }) + '\n');
  await new Promise((r) => setTimeout(r, 50));
}
await c.end();
console.log(`peak=${peak} db=${dbname}`);
