# Cycle 28 (lane w26): the command palette flake, plus two small gaps

## Hypothesis
The demo-mode `flows.mjs` step "Command palette navigates (Ctrl+K)" fails intermittently in full verify-all runs (batches 1
and 3), then "Theme toggle switches html data-theme" times out because the palette stays open over the top bar. It
passes when flows runs alone.

The integrator's reading of `CommandPalette.tsx` (not proven): opening the palette starts loading the lazy help
registry (cycle 7 made it lazy), and the query is reset in an effect. Either can change the first result between filling
the query and pressing Enter.

A real user may see the same race: type fast, press Enter, and land on the wrong page, or have the query wiped.

## Scope
1. **Root cause.** Reproduce under load first: run flows ≥20× with parallel CPU load from a build loop on your lane, and
   count failures. Then fix the app if it's an app race (the query must never be reset after the user types; Enter must
   act on the results for the query actually typed, and if results are still loading, wait or act once they arrive),
   and/or the test if the test races. Never weaken the check. After the fix: 0 failures in 20 runs under the same load.
2. **Gap from batch 3:** `web/src/api/events.ts` sign-out cleanup does not cancel c05's version-proposals refresh. Fix
   it, with a check: sign out while a refresh is pending, and the new session sees no stale data.
3. **Gap from c04:** "Loading history…" in `OrgHistory.tsx` isn't wrapped in c23's `LiveStatus`. Wrap it; a11y-check
   stays at 0 violations.

## Measure and pass threshold (fixed now)
- Flows palette step: failures before (N/20 under load), then 0/20 after under the same load.
- Items 2 and 3 fixed, each with a check that fails first.
- verify-all: all 10 steps pass. api-e2e standard set green (api-stage6 94/94). a11y-check: 0 violations.

## Lane
You are lane w26:
- worktree `/home/luca/AXION-w26`, branched from improve-30h at f400a39 (everything through c14 merged);
- port base 7600: dev 7690, e2e 7692/7693;
- database `axion_e2e26`;
- override config `/home/luca/AXION-lanes/vite-w26.config.ts`;
- `OUT=/tmp/axion-verify-w26`.

Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly: never git stash, every heavy run goes through heavy.sh
(your CPU-load loop counts as heavy: keep it short and bounded), never dispatch subagents, commit often. Safety rules:
`/home/luca/AXION/web/docs/improve/PROCESS.md`.
