/**
 * The framework-free part of the scorecard client cache (improvement cycle 2, fix round m2), tested by
 * server/test/scorecard-cache.test.ts:
 *  - one request per key and refresh tick, however many components ask;
 *  - a slower, older read (success or failure) never overwrites a newer entry;
 *  - clear() (sign-out) starts a new generation: a response still in flight from the previous session is dropped, and
 *    the next session reads again even with the same key and tick.
 */
export interface CacheEntry<T> { data: T | null; error: string | null; tick: number }

export function makeScorecardCache<T>(fetcher: (query: string) => Promise<T>, errorText: (e: unknown) => string) {
  let gen = 0;
  let byKey: Record<string, CacheEntry<T>> = {};
  const inflight = new Set<string>();
  const subs = new Set<(byKey: Record<string, CacheEntry<T>>) => void>();
  const emit = () => subs.forEach((f) => f(byKey));
  const put = (g: number, key: string, tick: number, next: (cur: CacheEntry<T> | undefined) => CacheEntry<T>) => {
    if (g !== gen) return; // a previous session's response
    const cur = byKey[key];
    if (cur && cur.tick > tick) return; // a newer read already landed
    byKey = { ...byKey, [key]: next(cur) };
    emit();
  };
  return {
    get: (key: string): CacheEntry<T> | undefined => byKey[key],
    subscribe(f: (byKey: Record<string, CacheEntry<T>>) => void) { subs.add(f); return () => { subs.delete(f); }; },
    load(key: string, query: string, tick: number): Promise<void> | undefined {
      const g = gen;
      const once = `${g}|${key}|${tick}`;
      if (inflight.has(once)) return undefined;
      inflight.add(once);
      return fetcher(query).then(
        (data) => put(g, key, tick, () => ({ data, error: null, tick })),
        (e) => put(g, key, tick, (cur) => ({ data: cur?.data ?? null, error: errorText(e), tick })),
      ).finally(() => { inflight.delete(once); });
    },
    clear() { gen++; inflight.clear(); byKey = {}; emit(); },
  };
}
