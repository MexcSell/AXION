import { tx, type Db, type Tx } from '../db.ts';
import type { ScorecardWindow } from '../../../shared/contracts/src/index.ts';
import { windowOf } from './scorecard.ts';

/**
 * Improvement cycle 54 (H11): the one clock of a window read is the DATABASE's. `now()` is the start of the current
 * transaction, so every SQL bound written as `<= now()` and the JS window ends this returns are the same instant.
 *
 * EDGE CONVENTION (one, explicit): a window is the closed interval [to - N days, to] in milliseconds; the previous equal
 * window is [from - N days - 1 ms, from - 1 ms], so the two meet with no gap and no overlap. SQL only ever loads a SUPERSET
 * (upper bound `<= now()`, lower bound `now() - interval`, never a JS Date: pg hands timestamptz back with millisecond
 * precision, rows keep microseconds); the pure functions then place each row by its millisecond time against these dates.
 */
export const WINDOW_DAYS: Record<ScorecardWindow, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** The database clock (statement time inside a transaction: its start). Display and window maths only, never a SQL bound. */
export async function dbNow(c: Db | Tx): Promise<Date> {
  return new Date((await c.query(`select now() as now`)).rows[0].now);
}

/** `windowOf` with `to` = the database clock. */
export async function dbWindow(c: Db | Tx, w: ScorecardWindow) {
  return windowOf(w, await dbNow(c));
}

/** One transaction, one snapshot, one clock: REPEATABLE READ (set before the first statement), read only. Every statement of the read sees the same data and the same now(). */
export function snapshotTx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  return tx(db, async (c) => {
    await c.query('set transaction isolation level repeatable read read only');
    return fn(c);
  });
}

/**
 * c54/c63: the ONE closed-window predicate for a timestamptz column, on the millisecond grid: `[now() - ms, now()]`, both ends included at
 * millisecond precision, so a row exactly N days old is inside and the SQL agrees with `windowOf`. `msParam` is a SQL parameter ($n) holding
 * the window length in milliseconds. Used by the failure-mode counts and the c63 recurrence rule.
 */
export const sqlInWindow = (col: string, msParam: string): string =>
  `date_trunc('milliseconds', ${col}) >= date_trunc('milliseconds', now()) - (${msParam}::double precision * interval '1 millisecond') and ${col} <= now()`;
