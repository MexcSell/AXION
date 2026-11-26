import type pg from 'pg';
import { connectClient } from './db.ts';
import { LOCK_KEY_SQL } from './locks.ts';

/**
 * Evolve step 1: during a blue/green switch two instances share one database. Work that must run once per site (the chat responder's
 * startup sweep, the approval-expiry sweep, resuming unfinished staffing) runs only in the instance that holds a PostgreSQL session
 * advisory lock. Mode 'always' (the default, and every test) is leader at once, so today's behaviour is unchanged.
 * The lock is held by one dedicated connection: when that connection dies the lock is gone, so a leader that loses it calls onLost
 * and stops (main.ts exits; Docker restarts the slot as a standby). The key is scoped to the current schema like the other locks.
 */
export interface Leader {
  isLeader(): boolean;
  /** run fn once when this instance becomes the leader (at once if it already is) */
  onAcquire(fn: () => void | Promise<void>): void;
  close(): Promise<void>;
}

export interface LeaderOptions {
  databaseUrl: string;
  schema?: string;
  mode: 'always' | 'lock';
  pollMs?: number;
  onLost: () => void;
}

export function startLeader(o: LeaderOptions): Leader {
  const fns: (() => void | Promise<void>)[] = [];
  let leader = o.mode === 'always';
  let closed = false;
  let client: pg.Client | undefined;
  let timer: NodeJS.Timeout | undefined;
  let lostCalled = false;
  const run = (fn: () => void | Promise<void>) => { try { void Promise.resolve(fn()).catch(() => {}); } catch { /* a failing job must not take the leader down */ } };
  const api: Leader = {
    isLeader: () => leader,
    onAcquire(fn) { if (leader) run(fn); else fns.push(fn); },
    async close() { closed = true; if (timer) clearTimeout(timer); await drop(); },
  };
  if (o.mode === 'always') return api;

  if (o.schema && !/^[a-z_][a-z0-9_]*$/.test(o.schema)) throw new Error('bad schema name');
  const pollMs = o.pollMs ?? 2000;

  async function drop() { const c = client; client = undefined; if (c) await c.end().catch(() => {}); }
  async function lose() {
    if (lostCalled) return;
    const wasLeader = leader;
    leader = false;
    await drop();
    if (wasLeader && !closed) { lostCalled = true; o.onLost(); }
  }

  async function poll() {
    timer = undefined;
    if (closed || lostCalled) return;
    try {
      if (!client) {
        const c = await connectClient({ connectionString: o.databaseUrl, ...(o.schema ? { options: `-c search_path=${o.schema}` } : {}) });
        if (closed) { await c.end().catch(() => {}); return; }
        c.on('error', () => { if (client === c) void lose(); }); // the session (and with it the lock) is gone
        client = c;
      }
      if (leader) await client.query('select 1'); // notice a dead connection even when no error event arrived
      else {
        const r = await client.query(`select pg_try_advisory_lock(${LOCK_KEY_SQL}) as got`, ['axion-leader']);
        if (r.rows[0].got && !closed) { leader = true; fns.splice(0).forEach(run); }
      }
    } catch {
      if (leader) { await lose(); } else await drop(); // a standby just reconnects on the next poll
    }
    if (!closed && !lostCalled) { timer = setTimeout(() => { void poll(); }, pollMs); timer.unref(); }
  }
  void poll();
  return api;
}
