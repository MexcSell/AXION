# c74 brief: the dev server watches shared contracts (H19)

**Lane:** w72 (`/home/luca/AXION-w72`, branch `c74-shared-watch`), from improve-30h at the commit that adds this brief. Ports 12290–12293. E2E DB **axion_e2e15** (reused). No migration. **Web config only.**

**Problem:** the live dev server on 5190 has stopped noticing changes under `shared/contracts` three times after merges. Each time it kept serving old modules, and 5 of 10 verify-all steps failed until a restart. See BACKLOG H19 and LESSONS ("A stale dev server is a recurring failure").

## Items
1. **Reproduce (RED).** Start a dev server on your port 12290, with the same command shape as 5190 (see STATE.md). Change a file under `shared/contracts/src/` the way a merge does: an atomic rename and a new file added to `index.ts`. Show the served module (`curl /@fs/.../shared/contracts/src/index.ts`) stays stale. Record exactly which kind of change is missed, and when.
2. **Fix.** Pick the smallest correct change in `web/vite.config.ts`. Options:
   - an explicit `server.watch` that includes `../shared`, with `followSymlinks` and polling only if necessary;
   - or a resolve alias that keeps `shared` inside Vite's watched graph.

   Explain why the default missed it. Don't break the lanes' override configs (`/home/luca/AXION-lanes/vite-wL.config.ts` merge the base config) or the e2e Vite.
3. **GREEN.** Repeat the same change sequence 10 times; the served module must update every time. Add the reproduction as a script under `web/scripts/` that the integrator can run.
4. **Docs.** Add one line to QUEUE.md's standard checks text in your branch: after any merge touching `shared/`, curl a served contracts file and expect the new export.

## Pass threshold
- RED reproduced, GREEN 10/10.
- verify-all 10/10 and fit-check (demo) on your dev server.
- web tsc clean.

## Report
`cycles/c74-report.md`. Follow the LANES.md Finishing rule, including the committed-diff check.
