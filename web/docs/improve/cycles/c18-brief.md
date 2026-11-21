# Cycle 18 (lane w16): code health H5, the Agent Profile fits one screen at 1366×768

## Hypothesis
The owner's layout rule: on desktop no page scrolls as a whole, every page fills exactly one screen, and pages fit at
≥1280×760. `fit-check` gate. The Agent Profile (`/agents/<id>`) fails at 1366×768: its tab bar overflows by about
13 px and the "Evolution" tab is partly hidden (reported by cycles 5 and 6; it predates them).

Make the profile fit without losing anything. The tab row goes icon-first when narrow, which is the owner's style and
the pattern Missions already uses ("icon-first when narrow"). Keep every tab reachable and labelled through tooltip and
aria-label, and keep the look at large sizes identical.

## Measure and pass threshold (fixed now)
1. **Before:**
   - run `BASE=http://127.0.0.1:6690 node scripts/fit-check.mjs 1366 768` and record the exact failures;
   - run it again at 1280×760 and 1672×941.
2. **After:** `fit-check` reports ALL FIT at 1280×760, 1366×768 and 1672×941 for every route it checks, not only the
   profile. No other page may start failing.
3. **Look and behaviour:**
   - screenshots of the profile before and after at 1672×941 (must look the same) and 1366×768 (tabs fit);
   - every tab still opens by click and keyboard;
   - `verify-all` is green, and the api-mode checks `api-stage6.mjs` and `api-improve.mjs` pass (they open profiles).

## Lane
You are lane w16:
- worktree `/home/luca/AXION-w16`;
- port base 6600: dev 6690, e2e 6692/6693;
- database `axion_e2e16`;
- override config `/home/luca/AXION-lanes/vite-w16.config.ts`.

Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly, including never using git stash and routing every heavy run
through `heavy.sh`. Safety rules are in `/home/luca/AXION/web/docs/improve/PROCESS.md`. Owner UI rules: icon-first,
animated, `?` help, fits one screen. Use the shared PageFrame / TopBoard patterns.
