// Consistent backup (review: restore check must not drift): pg_dump runs on an exported snapshot, and the row counts in
// the manifest come from that same snapshot. The uploads folder is archived next to the dump.
// Usage: node --env-file=.env scripts/db-backup.mjs   (BACKUP_DIR, BACKUP_SOURCE_URL optional)
import pg from 'pg';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync, readdirSync, rmSync, existsSync, chmodSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.env.BACKUP_SOURCE_URL || process.env.DATABASE_URL;
const dir = process.env.BACKUP_DIR || join(here, '..', '..', 'backups');
export const TABLES = ['tenants', 'users', 'devices', 'sessions', 'audit_events', 'missions', 'mission_revisions', 'mission_runs', 'tasks', 'uploads', 'idempotency_keys', 'events', 'approval_requests', 'approval_decisions', 'notifications', 'notification_reads', 'schema_migrations'];
mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const base = join(dir, `axion-${stamp}`);
const run = (cmd, args) => new Promise((ok, bad) => { const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] }); p.on('exit', (c) => (c === 0 ? ok() : bad(new Error(`${cmd} exited ${c}`)))); });

const c = new pg.Client({ connectionString: src });
await c.connect();
await c.query('begin isolation level repeatable read read only');
const snap = (await c.query('select pg_export_snapshot() as s')).rows[0].s;
const counts = {};
for (const t of TABLES) counts[t] = Number((await c.query(`select count(*) from ${t}`)).rows[0].count);
await run('pg_dump', ['-Fc', '--no-owner', `--snapshot=${snap}`, '-d', src, '-f', base + '.dump.part']);
await c.query('commit');
await c.end();
renameSync(base + '.dump.part', base + '.dump'); chmodSync(base + '.dump', 0o600);
const uploads = process.env.UPLOAD_DIR || join(here, '..', 'data', 'uploads');
let uploadsFile = null;
if (existsSync(uploads) && readdirSync(uploads).length) /* tar only when there are files */ { await run('tar', ['-czf', base + '.uploads.tar.gz', '-C', uploads, '.']); chmodSync(base + '.uploads.tar.gz', 0o600); uploadsFile = `axion-${stamp}.uploads.tar.gz`; }
writeFileSync(base + '.json', JSON.stringify({ createdAt: new Date().toISOString(), snapshot: snap, counts, uploads: uploadsFile }, null, 2), { mode: 0o600 });
// keep the newest 14 backups
const dumps = readdirSync(dir).filter((f) => /^axion-.*\.dump$/.test(f)).sort().reverse();
for (const f of dumps.slice(14)) for (const ext of ['.dump', '.json', '.uploads.tar.gz']) rmSync(join(dir, f.replace(/\.dump$/, ext)), { force: true });
console.log(`backup: ${base}.dump (${statSync(base + '.dump').size} bytes), manifest ${counts.missions} missions / ${counts.events} events${uploadsFile ? ', uploads archived' : ''}`);
