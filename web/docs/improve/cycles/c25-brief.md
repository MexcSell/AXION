# Cycle 25 (lane w23): test hygiene and small web fixes batch

## Hypothesis
Reviews left a set of test-quality and small web items that keep costing time:
- **Over-broad assertions:** api-improve.mjs:303 and :376 (cycle 1/4 checks) ban the word "coverage" and *any* button on
  proposal cards. The meaningful rules are "no invented percentages" and "members see no decision buttons". Narrow them
  to exactly that, so later features can say "coverage" honestly (cycle 20 had to avoid the word).
- **Duplicated guards:** each api script has its own lane-database guard regex. Move it into one helper in
  `scripts/_session.mjs` that all api scripts use, accepting `axion_e2e` / `axion_e2e<N>` and refusing everything else.
- **Fixed sleeps:** remaining `waitForTimeout` fixed sleeps in `scripts/*.mjs` → condition waits. List them first and
  convert each, or justify the one that must stay.
- **The `?` label:** cycle 7 left "Help: Help" until the registry loads. Show a sensible label immediately.
- **Deferred web minors** from `web/docs/stage6-ledger.md` and the cycle 4 review: thread count drift on replays, stale
  scroll anchor during a slow older-page load, `fetchPart`/`loadOlder` 404 not calling missionGone, `featuredAgents` and
  `threadMessages` dead code, `HUMAN` constant duplicated. Fix the safe ones, with checks where possible, and list the
  rest.

## Measure and pass threshold (fixed now)
1. **Before:** count fixed sleeps, duplicated guards and the over-broad assertions.
2. **After:**
   - over-broad assertions narrowed, never removed: each must still fail on the defect it guards (prove it with a forced
     failure);
   - one shared guard;
   - fixed sleeps reduced to 0, or listed;
   - each web minor fixed or listed.
3. All api scripts pass (`api-stage6`'s known reload stall excepted, noted). verify-all is green, with FAIL lines grepped.

## Lane
You are lane w23: worktree `/home/luca/AXION-w23` (branched from improve-30h at f169636, with cycles 1–3, 5 and 7 merged), port base 7300: dev 7390, e2e 7392/7393, database `axion_e2e23`, override config `/home/luca/AXION-lanes/vite-w23.config.ts`, `OUT=/tmp/axion-verify-w23` for verify-all. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly: never git stash, every heavy run goes through `heavy.sh` (vitest gets --maxWorkers=2 automatically), never dispatch subagents. **verify-all's exit code is not trustworthy yet** (lane w19 is fixing it): grep its output for FAIL and report every FAIL line honestly. Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
