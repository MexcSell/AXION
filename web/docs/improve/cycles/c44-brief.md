# c44 brief: page- and store-level cost of a live message burst (Wave 4 · page performance)

**Lane:** w43 (branched from improve-30h at the current tip; c26 virtualisation is merged). Ports are 9390 (dev), 9391 (preview) and 9392–9393 (e2e). E2E DB **axion_e2e16**. No migration.
**Source:** the c26 report §9 (threshold NOT MET). After virtualisation, a 1,000-message burst still costs a mean long-task total of 1,385 ms (worst merged period 464–518 ms). With the burst's thread off screen (`FLOOR=1`) the cost is 1,007 ms, so most of what remains is page- and store-level rather than the thread.

## Hypothesis
Three page/store costs make up most of the floor:
1. `useData.setState({ lastEventAt })` runs once per SSE event (`web/src/api/events.ts`, about line 71) and re-renders every subscriber, including the Overview tab about 400 times per burst.
2. `Missions.tsx` (about lines 136 and 476) subscribes to the whole mission-control entry, so every thread write re-renders the page.
3. The conversation flush interval is fixed, so render work is not batched under load.

Coalescing (1), narrowing the selectors in (2) and, only if needed, making (3) adaptive should cut the floor and the full burst. Behaviour must not change.

## Build (measure first)
1. **Baseline on your base, with the same method and script as c26:** `REPS=3 FILL=1000 node scripts/api-c26.mjs` and `FLOOR=1`, through api-e2e.sh and heavy.sh. Summarise with c22's summariser. Record the base hash. **Do not change the measurement method** (merge rule, whole-trace headline). Method changes are the owner's decision; you may add a secondary number, clearly labelled.
2. Profile which components render per event: React Profiler, or a render counter built for development only. Do not ship the counter.
3. Fix in this order, re-measuring after each step and keeping a step only if it helps:
   - **lastEventAt:** coalesce it, for example to at most once per animation frame or 250 ms, or read it with a non-reactive getter where only "freshness" is shown. The live freshness indicator must still update within 1 s.
   - **Missions selectors:** narrow them with `useShallow` or per-field selectors so a thread write does not re-render the page shell.
   - **Adaptive flush:** only if the first two steps leave the threshold unmet. Bound it (for example 50–400 ms) and keep the pinned reader pinned.
4. Behaviour must stay intact: SSE resume and dedup, the "N new" pill, pinning, unread counts, LiveStatus, and the freshness dot.

## Pass threshold (fixed; same script, method, machine and REPS=3 as c26; mean of 3)
- Long-task total for the FILL 1,000 burst: **≤ 887 ms** (c26's original bar, 30 % of the 2,958 ms before-run).
- Floor (`FLOOR=1`) long-task total: **at least 30 % below your own measured base floor**.
- Worst merged period ≤ 250 ms. This is reported honestly; if it is NOT MET, say so.
- Green: api-c26.mjs behaviour checks, `api-c22.mjs SIZES=130,1000 REPS=3`, api-stage6.mjs, api-improve.mjs, `DATA_MODE=api a11y-check.mjs` 0 violations, verify-all 10/10, flows.mjs, web tsc.
- No assertion loosened.

Report load averages next to every timing table. A run at load > 12 is repeated or flagged.

## Report
`cycles/c44-report.md`: before/after tables (whole trace, 3 reps, with load), which step bought what, files, and concerns.
