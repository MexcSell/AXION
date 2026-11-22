import type pg from 'pg';

/**
 * c70 (H14): a concurrency test must bound its OWN connections (the `axion` role is capped at 45 for every lane) and still prove the race.
 * `watch(pool)` records the most clients the pool ever held and the most that were busy at once. `lockWaits(sql)` polls pg_stat_activity
 * from a separate connection and counts the moments a backend was blocked on a lock whose query text matches `like`: proof that the
 * sessions really queued on one row, not that they ran one after the other.
 */
export const MAX_TEST_CONNECTIONS = 8;

export function watch(pool: pg.Pool) {
  const s = { peakClients: 0, peakBusy: 0 };
  const sample = () => { s.peakClients = Math.max(s.peakClients, pool.totalCount); s.peakBusy = Math.max(s.peakBusy, pool.totalCount - pool.idleCount); };
  pool.on('connect', sample); pool.on('acquire', sample);
  return s;
}

export function lockWaits(observer: pg.Pool, like: string) {
  const s = { samples: 0, waitingBackends: 0, maxWaiting: 0 };
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      const n = Number((await observer.query(`select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid() and query ilike $1`, [like])).rows[0].n);
      s.samples++; s.waitingBackends += n; s.maxWaiting = Math.max(s.maxWaiting, n);
      await new Promise((r) => setTimeout(r, 2));
    }
  })();
  return { stats: s, stop: async () => { stop = true; await loop; return s; } };
}
