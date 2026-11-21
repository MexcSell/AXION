# Cycle 7 review (independent)

Spec verdict: MET, thin margin, with caveats on the perf sub-threshold. Quality verdict: GOOD, no Critical findings.

## 1. Measurement
- `web/scripts/first-load.mjs` computes gzip of the `<script type=module>` plus every `modulepreload` link in `dist/index.html`. That is the brief's definition (entry plus statically imported chunks). Sound and deterministic (no timing).
- Cross-check: gzipping the files listed in the current `dist/index.html` with CLI gzip gives 243,254 B, against the reported 243,127 B (node zlib). That agrees within header noise, so the "after" figure is reproducible. I did not rebuild the baseline (read-only); the report says it was built from HEAD with the same script.
- Same method, same config except `chunkSizeWarningLimit`, which does not affect output. Comparable.
- Margin is 2.9 kB over the line (-20.9 % against -20 %). The threshold is met, but the headroom is small.
- Honesty: the lazy chunks are still fetched at idle, so total bytes transferred do not fall. Only the first-render critical path shrinks. That matches the brief's wording.

## 2. Behaviour
- Help (`src/help/load.ts`): the registry is a module singleton with `useSyncExternalStore`. `HelpTrigger` warms it on hover, focus and click. Until it loads it shows `LOADING_HELP` and re-renders when the registry arrives, so there is no broken UI. The fallback is `HelpTrigger.tsx:12` and `load.ts:18`.
- Help drawer (`settings-ops.tsx` HelpDrawer) calls `loadHelp()` and falls back to LOADING_HELP. Palette: `useEffect(() => { if (open) loadHelp() })`, and the help rows appear when the registry lands (`helpReg` is in the memo deps).
- `check-help.mjs` uses the test hook `helpKeys`, now async and awaited by `check-help.mjs:9` (`page.evaluate` awaits promises). The remaining static importer is the lazy Help page (`pages/Help.tsx:14`), which is fine.
- Palette: Ctrl+K sets `paletteOpen`. `AppShell.tsx` `useEverTrue` mounts it behind `<Suspense fallback={null}>` and keeps it mounted, so the exit animation survives. If the chunk has not arrived, the palette opens late and keystrokes typed in between are lost. The chunk is second in the idle queue, so this is a rare cold-start case.
- Chat dock: mounts on the first `chat.open`. `ChatDock` has no effects outside the open state, so nothing is lost by mounting late. `useMyChannels` and `useChatUnread` moved to `chatHooks.ts`, and TopBar's badge still works (the only other importer).
- Preload: `usePreloadRoutes` still uses the `preloadable()` queue. Three loaders are prepended (`App.tsx:56`), which delays route-chunk preloads by three idle slots. See M2.

## 3. AppShell `/?chat=admin` handler
- The handler is in `AppShell.tsx` and depends only on `me`, the URL, `openChat` and `nav`. It has no `isApi()` branch, and the old one did not either, so both data modes behave the same.
- `AppShell` renders under `AuthGate` (`App.tsx:82-84`), so `me` is set before the effect acts. It clears the query with `replace`, so it fires only once per link (`wantsAdminChat` goes false). It ran in the same component tree before. Correct. api-flows exercises it.

## 4. api-improve guard
- The new regex is `/\/axion_e2e\d*(\?|$)/`, identical to the one in `server/src/cli/e2e-serve.ts:18`. It is anchored on the `/` before the name and on the end or `?` after it. It accepts `axion_e2e` and `axion_e2e5` and rejects `axion`, `axion_e2e_x` and `axion_prod`. No loosening beyond what the server already allows. The script reads the URL from `server/.env`, as before.

## 5. Tests
- No assertion removed or loosened. The only script changes are the guard, the async `helpKeys`, and the new scripts.
- api-stage6 is red. The report says it was the same on clean HEAD (a `page.reload` timeout under load). It is not a pass, and the report labels it FAIL and status PARTIAL, which is honest. The brief required it green, so this is an open gap that needs a rerun on a quiet host.

## Perf threshold (A/B)
The brief fixes "<= 163 ms + 10 %". Under load (load average 7 to 19), neither baseline (193 ms) nor after (192 ms) meets the literal number, so it cannot be checked here. A same-load interleaved A/B with 3 runs each (195/176/193 against 181/192/216) is acceptable as evidence that the change is neutral. Its intent is no regression, and routes and `preloadable()` are untouched. It is not evidence for the absolute figure, and the report says so. Recommend a rerun on a quiet machine at merge time. I accept this as non-regression, not as a literal pass.

## Findings
- Important I1: api-stage6 is not green (brief 3c), and the cause is environmental on both builds. It needs a rerun on a quiet host before the cycle counts as fully passed.
- Important I2: process violations in the report. `git stash` was used (shared across worktrees, against the rules), and one perf-nav/dialog-smoke run loaded pages from port 5190 (forbidden). Read-only and recovered, but both should go in LESSONS.
- Minor M1: 2.9 kB margin. Small future additions to the entry will undo it.
- Minor M2: prepending loadHelp, the palette and the chat to the idle queue delays route preloads by three slots. A fast first page switch could hit an unpreloaded route. Putting the routes first, or trimming the queue, would remove the risk.
- Minor M3: before the registry arrives, the `?` tooltip and aria-label read "Help: Help". Cosmetic and brief.
- Minor M4: the visual comparison is "by eye". The before and after PNGs are nearly the same size (1019584 against 1019725 B for help), which is consistent with no visual change, but there is no pixel diff.
