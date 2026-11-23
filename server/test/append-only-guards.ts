import type pg from 'pg';

/**
 * c80 item 1 (R4-6): discover append-only tables from the catalog of a migrated schema and check all four guards on each.
 * A table is "append-only" when a BEFORE trigger on it (enabled or not) covers TRUNCATE, or covers UPDATE/DELETE with a function that
 * says "append-only" when it raises. (Mutable-with-identity-guard tables, e.g. agent_version_proposals, say neither, so they are out.)
 * A table with no guard trigger at all cannot be discovered from the catalog; the FLOOR list in c80-guards.test.ts pins today's set.
 */
export type Guard = 'update' | 'delete' | 'truncate' | 'purge_demo';
export interface GuardViolation { table: string; guard: Guard; why: string }

interface Trg { table: string; name: string; enabled: boolean; update: boolean; delete: boolean; truncate: boolean; before: boolean; src: string }

async function triggers(pool: pg.Pool): Promise<Trg[]> {
  const r = await pool.query(`
    select c.relname as t, g.tgname as name, g.tgenabled <> 'D' as enabled, g.tgtype::int as ty, p.prosrc as src
      from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_proc p on p.oid = g.tgfoid
     where c.relnamespace = current_schema()::regnamespace and not g.tgisinternal`);
  return r.rows.map((x) => ({ table: x.t, name: x.name, enabled: x.enabled, before: (x.ty & 2) !== 0 && (x.ty & 64) === 0, delete: (x.ty & 8) !== 0, update: (x.ty & 16) !== 0, truncate: (x.ty & 32) !== 0, src: x.src as string }));
}
const raises = (t: Trg) => /raise\s+exception/i.test(t.src);

export async function discoverAppendOnly(pool: pg.Pool): Promise<string[]> {
  const set = new Set<string>();
  for (const t of await triggers(pool)) {
    if (!t.before || !raises(t)) continue;
    if (t.truncate || ((t.update || t.delete) && /append-only/i.test(t.src))) set.add(t.table);
  }
  return [...set].sort();
}

/** Tables that demo data cascades into: every table with a boolean `demo` column, then every table reached by ON DELETE CASCADE foreign keys. */
async function demoReachable(pool: pg.Pool): Promise<Set<string>> {
  const roots = (await pool.query(`select c.relname t from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = current_schema()::regnamespace and c.relkind = 'r' and a.attname = 'demo' and not a.attisdropped`)).rows.map((x) => x.t as string);
  const fks = (await pool.query(`select pc.relname as parent, cc.relname as child from pg_constraint k join pg_class pc on pc.oid = k.confrelid join pg_class cc on cc.oid = k.conrelid where k.contype = 'f' and k.confdeltype = 'c' and cc.relnamespace = current_schema()::regnamespace`)).rows;
  const seen = new Set<string>(roots);
  for (let grew = true; grew;) { grew = false; for (const f of fks) if (seen.has(f.parent) && !seen.has(f.child)) { seen.add(f.child); grew = true; } }
  return seen;
}

/** The exception is the transaction-local flag axion.purge_demo, or (approval_decisions, 0004) "the parent row is already gone", which only a cascade from a purged request can produce. */
const PURGE_OK = /axion\.purge_demo|tg_op\s*=\s*'DELETE'\s+and\s+not\s+exists\s*\(\s*select[^;]*\bold\./i;

export async function checkAppendOnlyGuards(pool: pg.Pool): Promise<GuardViolation[]> {
  const all = await triggers(pool);
  const tables = await discoverAppendOnly(pool);
  const reach = await demoReachable(pool);
  const out: GuardViolation[] = [];
  for (const table of tables) {
    const live = all.filter((t) => t.table === table && t.enabled && t.before && raises(t));
    const upd = live.filter((t) => t.update), del = live.filter((t) => t.delete), trn = live.filter((t) => t.truncate);
    if (!upd.length) out.push({ table, guard: 'update', why: 'no enabled BEFORE UPDATE trigger that raises' });
    if (!del.length) out.push({ table, guard: 'delete', why: 'no enabled BEFORE DELETE trigger that raises' });
    if (!trn.length) out.push({ table, guard: 'truncate', why: 'no enabled BEFORE TRUNCATE trigger that raises' });
    // The purge exception: a DELETE guard on a table that clearDemo cascades into must let `axion.purge_demo = on` through, or clearDemo breaks.
    if (reach.has(table)) for (const t of del) if (!PURGE_OK.test(t.src)) out.push({ table, guard: 'purge_demo', why: `${t.name} blocks DELETE but does not honour axion.purge_demo (clearDemo cascades into this table)` });
    // TRUNCATE behaviour, where the engine reaches the trigger (a table referenced by a foreign key fails earlier with 0A000: the catalog check above stands).
    if (trn.length) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        try { await c.query(`truncate table "${table}"`); out.push({ table, guard: 'truncate', why: 'TRUNCATE succeeded' }); }
        catch (e) { const code = (e as { code?: string }).code; if (code !== 'P0001' && code !== '0A000') out.push({ table, guard: 'truncate', why: `TRUNCATE failed with ${code}, not a guard exception` }); }
      } finally { await c.query('rollback').catch(() => {}); c.release(); }
    }
  }
  return out;
}
