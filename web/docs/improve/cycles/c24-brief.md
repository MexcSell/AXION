# Cycle 24 (lane w22): the new features work at phone width

## Hypothesis
The original prototype was checked at 390 / 900 / 1280 px (Stage 1–4 gallery). Since then Stage 5–6 and this loop added
many api-mode surfaces that were only checked on desktop:
- sign-in and waiting screens, chat dock and channels;
- Proposals with History and rollback, version proposals and mentoring (if merged by then);
- scorecard and trend panel, Departments facts, reliability chips, Help › New Features.

The owner may open the app on a phone through the tunnel. Make sure every api-mode page and dialog is usable at 390×844
and 900×1000: no horizontal page scroll, no clipped controls, tap targets at least 40 px, dialogs fit and scroll inside.

## Measure and pass threshold (fixed now)
1. **A new script, `web/scripts/api-mobile.mjs`,** run through `api-e2e.sh`. It visits every api-mode route and tab and
   opens every dialog reachable from them, at 390×844 and 900×1000. It records:
   - horizontal overflow (`documentElement.scrollWidth > innerWidth`);
   - elements clipped off-screen;
   - buttons smaller than 40×40 px.
   **Before** numbers first.
2. **After:** 0 horizontal overflow and 0 clipped primary controls at both sizes. List any remaining small tap targets
   with a reason.
3. **No desktop change:** fit-check at 1672×941 / 1366×768 / 1280×760 stays as it is on your base, and demo mode is
   unchanged (verify-all, with FAIL lines grepped).
4. Screenshots of 4 key screens at 390 px, before and after.

## Lane
You are lane w22: worktree `/home/luca/AXION-w22` (branched from improve-30h at f169636, with cycles 1–3, 5 and 7 merged), port base 7200: dev 7290, e2e 7292/7293, database `axion_e2e22`, override config `/home/luca/AXION-lanes/vite-w22.config.ts`, `OUT=/tmp/axion-verify-w22` for verify-all. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly: never git stash, every heavy run goes through `heavy.sh` (vitest gets --maxWorkers=2 automatically), never dispatch subagents. **verify-all's exit code is not trustworthy yet** (lane w19 is fixing it): grep its output for FAIL and report every FAIL line honestly. Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
