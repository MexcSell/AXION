# Cycle 7 (code health, H2): smaller first load

## Hypothesis
The production build ships a 543.9 kB main chunk (176.5 kB gzip) and a 343.3 kB "Chips" chunk (118.8 kB gzip). The
Chips chunk probably carries the help registry and other shared modules that every page pulls in. The owner complained
earlier about slow page switches and heavy load (Stage 5 performance pass). Splitting the bundle along natural seams
cuts what the browser must download and parse before the first screen. Candidate seams:
- vendor libraries: react / react-dom / router, motion, radix, lucide;
- the help registry, loaded lazily when the first `?` opens, or split per page;
- rarely used dialogs and pages, already lazy, so verify they stay that way.

Behaviour and look stay exactly the same.

## Measure and pass threshold (fixed now; never lowered)
1. Measured with `cd web && npm run build` (vite's report), then the same `perf-nav` command as the baseline:
   `CHROME=/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome node scripts/perf-nav.mjs`, against **your
   lane's dev server**. Note perf-nav's base argument / `BASE` env.
2. **Threshold:** the JavaScript the browser must load for the first screen of `/missions` (the entry chunk plus every
   chunk statically imported before first render, gzip) drops by **at least 20%** against the baseline, measured the
   same way before and after. Write the "before" number first, with the exact method, then change code.
3. **No regressions:**
   - the median page switch (perf-nav) is not worse than baseline + 10% (baseline 163 ms dev);
   - `verify-all.sh` is green, including the crawls, dialog smoke and help keys (help must still open everywhere);
   - the api-mode browser checks stay green: `api-auth-flow`, `api-flows`, `api-stage6`, `api-improve`;
   - the fit checks stay green.
4. No visual change. Compare 2–3 screenshots before and after (Missions, Agents, a dialog with `?` help open).

## Work
- **Measure first.** Write the method and the before number into the report.
- Use `build.rollupOptions.output.manualChunks` (or the Vite 8 equivalent) for vendor splitting, plus dynamic `import()`
  for the help registry and other heavy optional modules, keeping the `preloadable()` / idle-preload behaviour from the
  Stage 5 performance pass so page switches stay instant.
- Find out *why* "Chips" is 343 kB (e.g. `npx vite build` with a visualizer, or by inspecting the chunk's modules) and
  fix the cause: a shared module importing something heavy. Don't just rename the chunk.
- Don't add new runtime dependencies. A dev-only analyser is fine if it isn't committed as a runtime dependency.
- Keep `chunkSizeWarningLimit` honest: lower it to the new reality, or leave it, but say which.

## Lane setup (binding: you work in a separate git worktree, in parallel with other lanes)
- **Worktree:** `/home/luca/AXION-w5`, branch `c07-bundle-split`. Edit, build, test and commit **only** there.
- **Browser checks:**
  `cd /home/luca/AXION-w5/web && E2E_API_PORT=5592 E2E_WEB_PORT=5593 ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs`.
  The lane `.env` points at `axion_e2e5`.
- **Demo-mode suite and perf:**
  - start your own dev server: `setsid node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5590 --strictPort > /tmp/w5-vite.log 2>&1 &`
    (from `/home/luca/AXION-w5/web`);
  - run `BASE=http://127.0.0.1:5590 ./scripts/verify-all.sh`, plus perf-nav and the fit checks with the same base;
  - stop the server by port.
  - For a production-build measurement, use `vite preview` on port 5591 if needed.
- **Never:** 5190, 5191, other lanes' ports (529x, 539x, 549x); the real `axion` database; `npm run dev`, `migrate`,
  `demo:*`; `pkill -f`. Other lanes edit server code and agent/org UI in parallel, so keep your diff to build config and
  import boundaries.
- **Server tests** (only if you touch the server, which you shouldn't need to): `cd /home/luca/AXION-w5/server && npx vitest run`.
- **Commits:** on your branch, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't merge or push.
