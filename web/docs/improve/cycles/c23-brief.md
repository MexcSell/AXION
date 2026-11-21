# Cycle 23 (lane w21): loading states are announced (accessibility H6)

## Hypothesis
The cycle 16 review found that api-mode loading and busy texts sit in plain divs with no `role="status"` or
`aria-live`, so a screen reader user never hears that data is loading or failed to load. Examples:
- "Loading instances…" in `Agents.tsx` around :278;
- AgentProfile around :198 and :483;
- ServerProposals around :147;
- JobSearch around :173;
- the cycle 4 retry and error states in `missionControl` consumers.

Also, the a11y script's focus-trap test doesn't check that Tab wraps from last to first.

## Measure and pass threshold (fixed now)
1. **Inventory** every loading, busy and error state in api mode (grep plus the a11y script) and record the count without
   `role=status`/`aria-live` **before**.
2. **After:**
   - 0 such states without a live region; use one shared `<LiveStatus>` component or attribute pattern, not ad-hoc
     markup;
   - errors use `role="alert"` where appropriate;
   - `web/scripts/a11y-check.mjs` gains checks for live regions on loading states and for Tab wrap-around in dialogs;
   - the script passes in demo and api mode.
3. No visual change: compare screenshots of 3 pages showing a loading or error state. Use a condition or a mocked slow
   route to capture them.
4. `verify-all` (with FAIL lines grepped), `api-improve.mjs` and `api-stage6.mjs` (known reload stall excepted) stay green.

## Lane
You are lane w21: worktree `/home/luca/AXION-w21` (branched from improve-30h at f169636, with cycles 1–3, 5 and 7 merged), port base 7100: dev 7190, e2e 7192/7193, database `axion_e2e21`, override config `/home/luca/AXION-lanes/vite-w21.config.ts`, `OUT=/tmp/axion-verify-w21` for verify-all. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly: never git stash, every heavy run goes through `heavy.sh` (vitest gets --maxWorkers=2 automatically), never dispatch subagents. **verify-all's exit code is not trustworthy yet** (lane w19 is fixing it): grep its output for FAIL and report every FAIL line honestly. Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
