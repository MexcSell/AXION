import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { valueOrderProblems, orderedArrays, ratedLists, monotone } from './contracts/value-order.ts';

/**
 * c78 (H20): the value-based no-leaderboard check. The c72 reviewer's probes (a renamed value field, a comparator that calls an unrelated function,
 * a list of two) must now fail it. The last test sends them through a real route of a real app.
 */
let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });

const agents = [{ id: 'a', pct: 90 }, { id: 'b', pct: 70 }, { id: 'c', pct: 80 }, { id: 'd', pct: 60 }];
const IDS: ReadonlySet<string> = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
const score = (x: { pct: number }) => x.pct;

describe('value-based order check, pure', () => {
  it('flags a list ordered by a field called pct, however the comparator was written', () => {
    const viaFunction = [...agents].sort((p, q) => score(q) - score(p)); // a comparator calling an unrelated function: invisible to a source scan
    const p = valueOrderProblems('GET /x', { leaders: viaFunction }, IDS);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/GET \/x: leaders\[\] is ordered descending by pct \(90, 80, 70, 60\)/);
    expect(valueOrderProblems('GET /x', { zz: [...agents].sort((p2, q) => p2.pct - q.pct) }, IDS)[0]).toMatch(/ascending by pct/);
  });
  it('sees a rating nested in an object, under any name', () => {
    const rows = agents.map((a) => ({ agent: a.id, stats: { whatever: a.pct * 3 } })).sort((p, q) => q.stats.whatever - p.stats.whatever);
    expect(valueOrderProblems('GET /y', { rows }, IDS)[0]).toMatch(/rows\[\] is ordered descending by stats\.whatever/);
  });
  it('accepts a mixed order, ties, short lists and lists of non-objects', () => {
    expect(valueOrderProblems('GET /ok', { xs: agents }, IDS)).toEqual([]); // 90, 70, 80, 60
    expect(valueOrderProblems('GET /ok', { xs: [{ v: 1 }, { v: 1 }, { v: 2 }] }, IDS)).toEqual([]); // only two distinct values
    expect(valueOrderProblems('GET /ok', { xs: [{ v: 1 }, { v: 2 }] }, IDS)).toEqual([]);
    expect(valueOrderProblems('GET /ok', { xs: [3, 2, 1], ys: ['a', 'b'] }, IDS)).toEqual([]);
    // a list that names no agent (versions, messages, missions sorted by time on purpose) is out of scope, however it is ordered
    expect(valueOrderProblems('GET /ok', { versions: [{ version: 3 }, { version: 2 }, { version: 1 }] }, IDS)).toEqual([]);
    expect(monotone([1, 2, 2, 3])).toBe('asc');
    expect(monotone([3, 3, 3])).toBeNull();
  });
  it('flags a list of two or more entries that carry a field the registry marks as a rating, in any order', () => {
    const two = { top: [{ agentId: 'a', adjusted: { value: 90 } }, { agentId: 'b', adjusted: { value: 70 } }] };
    expect(ratedLists(two, ['adjusted.value'])).toEqual([{ path: 'top[]', field: 'adjusted.value', n: 2 }]);
    expect(ratedLists({ top: [two.top[0]] }, ['adjusted.value'])).toEqual([]); // one agent: its own vector
    expect(ratedLists(two, [])).toEqual([]); // nothing marked
    expect(orderedArrays(two, IDS)).toEqual([]); // two entries are too few for the order scan, which is why the registry check exists
  });
});

describe('through a real route', () => {
  it('a route that answers with real agents sorted by a renamed rating, through an unrelated function, is caught on its live response', async () => {
    t = await makeTestApp({
      demoSeed: true,
      configure: (app: any) => {
        app.get('/api/v1/__probe/leaders', async () => {
          const rows = (await app.db.query('select id from agent_definitions order by id limit 8')).rows as { id: string }[];
          const pcts = rows.map((_, i) => ((i * 37) % 11) * 10 + i); // distinct rating-like values, not in id order
          return { leaders: rows.map((r, i) => ({ agent: r.id, pct: pcts[i] })).sort((p, q) => score(q) - score(p)) };
        });
      },
    });
    const A = await withAdmin(t.app);
    const r = await A.admin.req('GET', '/__probe/leaders');
    expect(r.status).toBe(200);
    expect(r.body.leaders.length).toBeGreaterThanOrEqual(3);
    const known = new Set<string>(((await A.admin.req('GET', '/agents')).body.agents as { id: string }[]).map((x) => x.id)); // what the coverage run collects from its own GET /agents
    expect(valueOrderProblems('GET /__probe/leaders', r.body, known)[0]).toMatch(/leaders\[\] is ordered descending by pct/);
  });
});
