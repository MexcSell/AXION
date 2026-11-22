import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import pg from 'pg';
import { makeSchema } from './helpers.ts';
import { LOCK_KEY_SQL, advisoryXactLock } from '../src/locks.ts';
import { tx } from '../src/db.ts';

// Every advisory lock key must be schema-scoped through src/locks.ts. A global key (hashtext('agent-ver:t-1:coder-01'),
// a constant like 1) lets one test schema's parked writer stall another schema's writers past their 5 s lock_timeout,
// which is how the integration runs got random 500s (batch 7 and batch 9). This guard stops a merge from adding one back.
const ROOT = join(import.meta.dirname, '..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|mts)$/.test(n) ? [p] : [];
});

describe('advisory locks go through the schema-scoped helper', () => {
  it('no pg_advisory_* call in server/src or server/test bypasses LOCK_KEY_SQL (src/locks.ts is the only exception)', () => {
    const bad: string[] = [];
    for (const f of [...files(join(ROOT, 'src')), ...files(join(ROOT, 'test'))]) {
      const rel = relative(ROOT, f);
      if (rel === join('src', 'locks.ts') || rel === join('test', 'advisory-locks.test.ts')) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/pg_(?:try_)?advisory_(?:xact_)?(?:un)?lock(?:_shared)?\(/g)) {
        const rest = src.slice(m.index! + m[0].length, m.index! + m[0].length + 20);
        if (!rest.startsWith('${LOCK_KEY_SQL})')) bad.push(`${rel}:${src.slice(0, m.index).split('\n').length}: ${m[0]}${rest.split('\n')[0]}`);
      }
    }
    expect(bad, 'use advisoryXactLock(c, name) or `pg_advisory_*(${LOCK_KEY_SQL})` with the name as $1').toEqual([]);
  });

  it('the same name in two schemas gives two different keys, and the same schema the same key', async () => {
    const a = await makeSchema({ migrate: false }), b = await makeSchema({ migrate: false });
    try {
      const key = async (p: pg.Pool) => (await p.query(`select ${LOCK_KEY_SQL} as k`, ['agent-ver:t-1:coder-01'])).rows[0].k as string;
      expect(await key(a.pool)).toBe(await key(a.pool));
      expect(await key(a.pool)).not.toBe(await key(b.pool));
      // a lock held in schema a does not block the same name in schema b
      const hold = await a.pool.connect();
      try {
        await hold.query('begin');
        await advisoryXactLock(hold as never, 'agent-ver:t-1:coder-01');
        const t0 = Date.now();
        await tx(b.pool as never, (c) => advisoryXactLock(c, 'agent-ver:t-1:coder-01'));
        expect(Date.now() - t0).toBeLessThan(2000);
      } finally { await hold.query('rollback'); hold.release(); }
    } finally { await a.drop(); await b.drop(); }
  });
});
