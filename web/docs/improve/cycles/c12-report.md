# Cycle 12 report: throughput and trend against the previous period (lane w10, theme B2)

Branch `improve-30h` lane w10. No migration, no new event, no loosened rule. The numbers still come only from recorded rows.

## What was built
- **Contracts** (`shared/contracts/src/company.ts`): `ScorecardRow` gains `previous: {value|null, n}` and `trend: 'up'|'down'|'flat'|null`; `CompanyScorecardDto` gains `previousFrom/previousTo`; new `ThroughputDto`.
- **Pure functions** (`server/src/company/scorecard.ts`):
  - `computeRows` is the old computation. `computeScorecard` runs it for the window and for the previous equal-length window (it ends 1 ms before this one starts, so nothing counts twice) and adds `previous` and `trend`.
  - `trendOf`: **null** when either value is null or either n is below `MIN_N` (3). Otherwise flat within ±1 point (rates), ±0.1 h (times) or equal (counts); else up/down. The arrow says "higher or lower", not "better or worse".
  - `computeThroughput`: contiguous weekly buckets, oldest first, `{from,to,started,finished}` counts only. Each week uses the scorecard's own rules.
- **Routes** (`server/src/company/routes.ts`): the loader is shared, so `/company/scorecard` and the new `GET /company/throughput?weeks=8&includeDemo=0|1` use `VISIBLE_SQL`, the tenant filter and DEMO exclusion exactly as in cycle 2. `weeks` is 1..26 (zod; else 400). Anonymous is 401.
- **Web** (api mode): `api/throughput.ts` (same cache and refresh tick as the scorecard, cleared on sign-out), `components/viz/ThroughputChart.tsx` (SVG paired bars, one shared scale, counts), scorecard rows show `↑ 40.0%` (arrow + previous value, tooltip with the previous n) only when the trend is non-null, help `company.scorecard` explains the rule and `scorecard.throughput` is new, CSS in `theme/pages.css`.

## Evidence
- **RED:** `server/test/scorecard-trend.test.ts` run against the old source: 10 failed, 1 passed (the "current values unchanged" case).
- **GREEN:** the same file plus `scorecard.test.ts`: 31 pass. `server/test/throughput.test.ts`: 5 pass (route privacy: 401/400, fresh DB zeros and no trend, Mina's/Kenji's private missions, DEMO, other tenant, deleted and older-than-8-weeks missions never counted, previous-window privacy, trend appears only at n >= 3 both sides).
- Whole server suite: 26 files, 347 tests pass. Web `tsc` clean.
- `web/scripts/api-c12.mjs` (run through `api-e2e.sh` on ports 6092/6093): ALL PASS, 10 checks (fresh DB: no arrows, chart 8 weeks 0/0 and equal to the server; 3 canceled missions give 3/3 in the last week on both chart and server, live without reload; still no arrow because the previous period has n < 3; the `?` text explains the rule; a mocked non-null trend shows the arrow and previous value on that row only).
- `node scripts/ov-fit.mjs`: NO SCROLL ANYWHERE in demo mode (dev server 6090) and in api mode.
- verify-all (demo): see the last section.

## Pass threshold
1. Server (rows, route, VISIBLE_SQL/tenant/DEMO, pure and route tests): PASS.
2. Web (previous value and arrow only when non-null, `?` rule, SVG chart, ov-fit NO SCROLL demo and api): PASS.
3. `api-c12.mjs` (fresh DB no arrows, chart equals server): PASS.
4. Whole suite and verify-all green: see below.

## Files
`shared/contracts/src/company.ts`, `server/src/company/{scorecard,routes}.ts`, `server/test/{scorecard-trend,throughput}.test.ts`, `web/src/api/{scorecard,throughput}.ts`, `web/src/components/viz/ThroughputChart.tsx`, `web/src/components/layout/CommandCenter.tsx`, `web/src/theme/pages.css`, `web/src/help/registry.ts`, `web/scripts/api-c12.mjs`, screenshot `web/docs/screenshots/improve-c12-scorecard-trend-dark.png` (the arrow on failure rate comes from the mocked answer).

## Concerns
- Real arrows cannot appear from user actions alone yet: a previous period with n >= 3 needs missions finished 7+ days ago, and the browser check shows the arrow only through a mocked response. The server route test covers the real path with SQL fixtures.
- A count row's trend needs n >= 3 on both sides, where n is the count itself (`started`, `finished`) or completions (`completed_unverified`).
- Throughput weeks use the scorecard's "last final transition at or before the week end", so a mission that fails then retries and completes can count as finished in two different weeks. This is the same rule as the windowed scorecard.
- A stash `stash@{0}` (WIP on c07-bundle-split) exists in the shared repo. It is not mine. Early in this task I ran one `git stash push` / `pop` pair on my own files for the RED run, before the no-stash rule arrived. My pop restored only my files, and I used no stash after that.
