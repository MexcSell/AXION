import { describe, it, expect } from 'vitest';
import { makeSchema } from './helpers.ts';
import { STALE_BEFORE_SQL, STALE_FLAG, STALE_JOINS } from '../src/company/stale.ts';

/**
 * c71 fix round (F1): the freshness rule of a task review (c51), every branch, in BOTH SQL forms: STALE_BEFORE_SQL (per row, a correlated sub-select) and
 * STALE_JOINS + STALE_FLAG (batch, a lateral join). A review is stale when the task has a later attempt than the one the review judged, or when the
 * latest attempt started (strictly) after the review was created. The expected value is computed here in plain JS from that sentence, not from either SQL.
 *
 * Cases (exhaustive over the branches, 0 to 3 attempts): each attempt's started_at is null, before, equal to or after the review's created_at; the review's
 * attempt_id is null, a dangling id, or each of the task's attempts. That covers: review created before the latest attempt started; null attempt_id; a task with
 * reviews and no attempts; null started_at; equal timestamps.
 */
const REVIEW_AT = Date.parse('2026-11-01T12:00:00.000Z');
const STARTS = { null: null, before: REVIEW_AT - 60_000, equal: REVIEW_AT, after: REVIEW_AT + 60_000 } as const;
type St = keyof typeof STARTS;

interface Case { task: string; starts: St[]; attemptRef: number | 'null' | 'dangling' }
function cases(): Case[] {
  const out: Case[] = [];
  const all = Object.keys(STARTS) as St[];
  const combos = (n: number): St[][] => (n === 0 ? [[]] : combos(n - 1).flatMap((c) => all.map((s) => [...c, s])));
  for (let n = 0; n <= 3; n++) for (const starts of combos(n)) for (const ref of ['null', 'dangling', ...Array.from({ length: n }, (_, i) => i + 1)] as Case['attemptRef'][]) out.push({ task: `T${out.length}`, starts, attemptRef: ref });
  return out;
}
/** The rule, from the sentence above. */
function expected(c: Case): boolean {
  const n = c.starts.length;
  if (n === 0) return false; // no attempt at all: nothing newer than the review
  const judged = typeof c.attemptRef === 'number' ? c.attemptRef : 0; // null or dangling attempt_id counts as attempt 0
  const latest = STARTS[c.starts[n - 1]];
  return judged < n || (latest !== null && REVIEW_AT < latest);
}

describe('review freshness truth table: STALE_BEFORE_SQL and STALE_JOINS/STALE_FLAG against the rule', () => {
  it('every case: both forms equal the rule, and every branch is reached', async () => {
    const s = await makeSchema({ migrate: false });
    const c = await s.pool.connect();
    try {
      // temp tables shadow the real ones for this connection only (no foreign keys to satisfy)
      await c.query(`create temp table task_attempts (id bigint primary key, task_id text not null, attempt_no int not null, started_at timestamptz)`);
      await c.query(`create temp table task_reviews (id text primary key, task_id text not null, attempt_id bigint, created_at timestamptz not null)`);
      const cs = cases();
      let id = 0;
      for (const k of cs) {
        const ids: number[] = [];
        for (let i = 0; i < k.starts.length; i++) {
          ids.push(++id);
          const st = STARTS[k.starts[i]];
          await c.query(`insert into task_attempts values ($1, $2, $3, ${st === null ? 'null' : 'to_timestamp($4 / 1000.0)'})`, st === null ? [id, k.task, i + 1] : [id, k.task, i + 1, st]);
        }
        const ref = k.attemptRef === 'null' ? null : k.attemptRef === 'dangling' ? 999_999 : ids[k.attemptRef - 1];
        await c.query(`insert into task_reviews values ($1, $2, $3, to_timestamp($4 / 1000.0))`, ['R-' + k.task, k.task, ref, REVIEW_AT]);
      }
      const old = new Map((await c.query(`select r.task_id, (${STALE_BEFORE_SQL('r')} is not null) as stale from task_reviews r`)).rows.map((r) => [r.task_id as string, r.stale as boolean]));
      const join = new Map((await c.query(`select r.task_id, ${STALE_FLAG('r')} as stale from task_reviews r ${STALE_JOINS('r')}`)).rows.map((r) => [r.task_id as string, r.stale as boolean]));
      expect(old.size).toBe(cs.length);
      let stale = 0;
      for (const k of cs) {
        const want = expected(k);
        expect(old.get(k.task), `STALE_BEFORE_SQL ${JSON.stringify(k)}`).toBe(want);
        expect(join.get(k.task), `STALE_JOINS/STALE_FLAG ${JSON.stringify(k)}`).toBe(want);
        if (want) stale++;
      }
      expect(cs.length).toBeGreaterThan(300);
      expect(stale).toBeGreaterThan(100);
      expect(cs.length - stale).toBeGreaterThan(30);
      // the named branches, spelled out (each is also inside the loop)
      const pick = (f: (k: Case) => boolean) => cs.filter(f);
      expect(pick((k) => k.starts.length === 1 && k.starts[0] === 'after' && k.attemptRef === 1).every((k) => old.get(k.task) && join.get(k.task))).toBe(true); // review created before the latest attempt started
      expect(pick((k) => k.starts.length === 1 && k.starts[0] === 'equal' && k.attemptRef === 1).every((k) => !old.get(k.task) && !join.get(k.task))).toBe(true); // equal timestamps: fresh
      expect(pick((k) => k.starts.length === 1 && k.starts[0] === 'null' && k.attemptRef === 1).every((k) => !old.get(k.task) && !join.get(k.task))).toBe(true); // null started_at: only the attempt number decides
      expect(pick((k) => k.starts.length === 0).every((k) => !old.get(k.task) && !join.get(k.task))).toBe(true); // reviews without any attempt: fresh
      expect(pick((k) => k.starts.length >= 1 && k.attemptRef === 'null').every((k) => old.get(k.task) && join.get(k.task))).toBe(true); // null attempt_id with attempts: stale
    } finally { c.release(); await s.drop(); }
  });
});
