import { describe, it, expect } from 'vitest';
import { makeScorecardCache } from '../../web/src/api/scorecardCache.ts';

// Cycle 2 fix round m2: the web's scorecard cache (framework-free part of web/src/api/scorecard.ts).
// A response from a previous session never lands after a sign-out; an older read never overwrites a newer one.
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { p, resolve, reject };
}
function harness() {
  const calls: { query: string; d: ReturnType<typeof deferred<number>> }[] = [];
  const cache = makeScorecardCache<number>((query) => { const d = deferred<number>(); calls.push({ query, d }); return d.p; }, (e) => String(e));
  return { cache, calls };
}

describe('scorecard client cache', () => {
  it('clear() (sign-out) drops a response still in flight, and the next session reads again with the same key and tick', async () => {
    const { cache, calls } = harness();
    const first = cache.load('30d|0', 'q', 0);
    cache.clear();
    calls[0].d.resolve(111); // user A's numbers arrive after the sign-out
    await first;
    expect(cache.get('30d|0')).toBeUndefined();
    const second = cache.load('30d|0', 'q', 0); // user B, same key and tick: not skipped as "in flight"
    expect(calls.length).toBe(2);
    calls[1].d.resolve(222);
    await second;
    expect(cache.get('30d|0')).toMatchObject({ data: 222, error: null });
  });

  it('a slower, older read never overwrites a newer one', async () => {
    const { cache, calls } = harness();
    const a = cache.load('k', 'q', 1);
    const b = cache.load('k', 'q', 2);
    calls[1].d.resolve(2); await b;
    calls[0].d.resolve(1); await a;
    expect(cache.get('k')).toMatchObject({ data: 2, tick: 2 });
  });

  it('a failed newer read keeps its tick, so a stale older success cannot overwrite it afterwards', async () => {
    const { cache, calls } = harness();
    const a = cache.load('k', 'q', 1);
    const b = cache.load('k', 'q', 2);
    calls[1].d.reject('down'); await b;
    expect(cache.get('k')).toMatchObject({ data: null, error: 'down', tick: 2 });
    calls[0].d.resolve(1); await a;
    expect(cache.get('k')).toMatchObject({ data: null, error: 'down', tick: 2 });
  });

  it('one request per key and tick, however many readers ask', () => {
    const { cache, calls } = harness();
    cache.load('k', 'q', 3); cache.load('k', 'q', 3);
    expect(calls.length).toBe(1);
  });
});
