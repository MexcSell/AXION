// c73 (P4c): how old is the pinned public suffix snapshot? Shown in System Operations health, with a warning past 90 days.
// The snapshot is refreshed only by a reviewed commit that replaces public_suffix_list.dat and its manifest (see the manifest's
// note); nothing here fetches, and no route refreshes it. The age is the manifest's list date against the DATABASE date, computed
// in SQL (the app clock is never the bound, same rule as every expiry in the server).
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { PSL_RULE_COUNT } from './psl.ts';

export const PSL_WARN_AFTER_DAYS = 90;

/** '2026-11-21_04-33-45_UTC' (the manifest's listVersion) to '2026-11-21'. Throws on anything else, so a bad manifest is loud. */
export function pslVersionDate(listVersion: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})_\d{2}-\d{2}-\d{2}_UTC$/.exec(listVersion);
  const ok = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31;
  if (!m || !ok) throw new Error(`Public suffix list version "${listVersion}" is not YYYY-MM-DD_HH-MM-SS_UTC`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export interface PslHealth { listVersion: string; date: string; ageDays: number; warnAfterDays: number; stale: boolean; rules: number }

/** Pure: the health record for a snapshot of the given age. Stale strictly past the limit; a future-dated snapshot is not stale. */
export function pslSnapshotHealth(i: { listVersion: string; ageDays: number; rules: number }): PslHealth {
  return { listVersion: i.listVersion, date: pslVersionDate(i.listVersion), ageDays: i.ageDays, warnAfterDays: PSL_WARN_AFTER_DAYS, stale: i.ageDays > PSL_WARN_AFTER_DAYS, rules: i.rules };
}

const manifestVersion = (): string => (JSON.parse(readFileSync(new URL('public_suffix_list.manifest.json', import.meta.url), 'utf8')) as { listVersion: string }).listVersion;

/** The snapshot's health now. `listVersion` is a parameter so tests can age it; production reads the manifest. */
export async function readPslHealth(db: Pick<Pool, 'query'>, listVersion: string = manifestVersion()): Promise<PslHealth> {
  const date = pslVersionDate(listVersion);
  const r = await db.query(`select ((now() at time zone 'utc')::date - $1::date)::int as d`, [date]);
  return pslSnapshotHealth({ listVersion, ageDays: r.rows[0].d as number, rules: PSL_RULE_COUNT });
}
