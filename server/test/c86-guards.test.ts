import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeSchema } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';
import { discoverAppendOnly, checkAppendOnlyGuards } from './append-only-guards.ts';
import { lintMigration } from './migration-lint.ts';
import { rankingKeyProblems, ratedListProblems } from './contracts/no-ranking.ts';
import { valueOrderProblems, RATING_FIELDS } from './contracts/value-order.ts';
import { ledgerOf, FORECAST_METHOD } from '../../shared/contracts/src/index.ts';

// c86 items 4 and 5: the migration, the guards, and no leaderboard.
const MIG = listMigrations().find((m) => m.name === '0059_forecasts')!;

describe('migration 0059 (the forecast ledger)', () => {
  it('applies on a database that has NOT got 0058 (the other lane\'s table), reverses cleanly, and applies again', async () => {
    const s = await makeSchema({ migrate: false });
    try {
      await migrate(s.pool, 'up', 53);
      const has = async () => (await s.pool.query(`select 1 from information_schema.tables where table_schema=current_schema() and table_name='forecasts'`)).rowCount === 1;
      expect(await has()).toBe(false);
      await s.pool.query(MIG.up);                       // 0059 alone, with 0054..0058 absent
      expect(await has()).toBe(true);
      expect(await discoverAppendOnly(s.pool)).toContain('forecasts');
      await s.pool.query(MIG.down);
      expect(await has()).toBe(false);
      await s.pool.query(MIG.down);                     // re-runnable
      await migrate(s.pool, 'up');                      // and through the runner, with whatever else is in the tree
      expect(await has()).toBe(true);
    } finally { await s.drop(); }
  });

  it('the generated four-guards test covers the table: found by the catalog, all four guards present, demo purge works through the exception', async () => {
    const s = await makeSchema();
    try {
      expect(await discoverAppendOnly(s.pool)).toContain('forecasts');
      expect(await checkAppendOnlyGuards(s.pool)).toEqual([]);
    } finally { await s.drop(); }
  });

  it('passes the c80 lint, with its down file', () => {
    const ao = new Set(['audit_events', 'events', 'messages', 'task_reviews', 'approval_requests', 'mission_ledgers', 'forecasts']);
    expect(lintMigration({ name: MIG.name, up: MIG.up, down: MIG.down }, ao)).toEqual([]);
  });

  it('touches only its own objects and references only tasks, missions and tenants (so 0058 cannot be needed)', () => {
    const code = MIG.up.replace(/--.*$/gm, '');
    const refs = [...code.matchAll(/references\s+(\w+)/g)].map((m) => m[1]).sort();
    expect(refs).toEqual(['missions', 'tasks', 'tenants']);
    expect(code).not.toMatch(/alter\s+table\s+(?!forecasts)/i);
  });
});

describe('no leaderboard', () => {
  const rows = [1, 2, 3].map((i) => ({ id: 'F' + i, taskId: 'T' + i, missionId: 'M', taskTitle: 't', probability: '0.80', madeAt: '2026-01-01T00:00:00.000Z', firstVerdict: i === 1 ? 'accepted' : 'rejected', firstAt: '2026-01-02T00:00:00.000Z', inTime: true, voided: false, classId: 'research', difficulty: 3, baseN: 8, baseX: 5 }));
  const body = ledgerOf({ id: 'u', name: 'U' }, rows);

  it('a ledger carries no key that names a rank, position, score or direction, and no list of rated people', () => {
    expect(rankingKeyProblems(body, 'GET /me/forecasts')).toEqual([]);
    expect(ratedListProblems(body, 'GET /me/forecasts')).toEqual([]);
    expect(FORECAST_METHOD).not.toMatch(/rank|leaderboard/i);
  });

  it('the score fields are registered in RATING_FIELDS, and the c78 scan passes the own-record lists but flags a list of people (RED proof)', () => {
    for (const r of ['GET /me/forecasts', 'GET /users/:id/forecasts']) expect(RATING_FIELDS[r]).toEqual(expect.arrayContaining(['meanBrier', 'meanLogLoss', 'skill.skill', 'forecasts[].brier']));
    expect(valueOrderProblems('GET /me/forecasts', body, new Set())).toEqual([]);
    const board = { forecasters: [{ name: 'a', meanBrier: 0.1 }, { name: 'b', meanBrier: 0.2 }] };
    expect(valueOrderProblems('GET /me/forecasts', board, new Set())[0]).toMatch(/2 entries that carry the rating meanBrier/);
    expect(rankingKeyProblems({ ranking: [] }, 'GET /me/forecasts').length).toBe(1);
  });

  it('forecast code never sorts: the only order is the database\'s time order', () => {
    for (const f of [join('src', 'forecasts', 'ledger.ts'), join('src', 'forecasts', 'routes.ts'), join('..', 'shared', 'contracts', 'src', 'forecasts.ts')]) {
      expect(readFileSync(join(import.meta.dirname, '..', f), 'utf8'), f).not.toMatch(/\.sort\(|\.toSorted\(/);
    }
    expect(readdirSync(join(import.meta.dirname, '..', 'src', 'forecasts')).sort()).toEqual(['ledger.ts', 'routes.ts']);
  });
});
