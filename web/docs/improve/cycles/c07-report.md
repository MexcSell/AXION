# Cycle 7 report: smaller first load (code health, H2)

Branch `c07-bundle-split`, worktree `/home/luca/AXION-w5`. Status: **PARTIAL (threshold met, margin thin; one api check red on the baseline too)**.

## Method (fixed before the change)
"First-load JS for /missions" = gzip size of the entry chunk plus every chunk statically imported before first render
(the `<script type=module>` and all `<link rel=modulepreload>` in `dist/index.html`). Script: `web/scripts/first-load.mjs`
(prints the STATIC number; it also prints a network number that includes the idle preloader, which is polluted and not used).

    cd web && npm run build && node node_modules/vite/bin/vite.js preview --port 5591 --strictPort &
    CHROME=/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome node scripts/first-load.mjs http://127.0.0.1:5591

Threshold (fixed): STATIC gzip drops by at least 20 percent: from 307,502 B to at most 246,001 B.

## Before / after
| | before | after |
|---|---|---|
| STATIC first-load gzip | 307,502 B (300.3 kB, 8 files) | **243,127 B (237.4 kB, 15 files)**, -20.9 % |
| index chunk | 510.0 kB (165.3 kB gz) | 356.3 kB (114.2 kB gz) |
| Chips chunk | 351.6 kB (121.6 kB gz) | 278.6 kB (95.1 kB gz) |
| warning limit | 1500 | 400 (largest chunk now 356 kB, so the build is warning-free) |

Margin over the threshold is 2.9 kB (1.2 %): thin but measured the same way before and after (baseline built from `HEAD` in a scratch copy).

## Why "Chips" was 343 kB
Inspected with `vite build --sourcemap` and the sourcemap's module list. "Chips" is not Chips.tsx: it is the shared-module bucket
that the bundler named after its first member. It holds react-router, motion (framer-motion/motion-dom), radix tooltip/popover plus
floating-ui, lucide icons, and **the whole help registry** (`help/registry.ts` plus `help/pages/*`, about 75 kB source), pulled in
because `HelpTrigger` (used on every page) imported `getHelp` statically and the registry globs all page files eagerly.
The index chunk also carried `CommandPalette`, `ChatDock` (-> ChannelChat -> ChatView -> ThreadMinimap) which are not on the first screen.

## Seams split
1. **Help registry** (`src/help/load.ts`, new): `HelpTrigger`, the help drawer dialog and the command palette use `useHelpRegistry()`; the
   registry loads in its own chunk (`registry-*.js`, 26.8 kB gz) first in the idle preload queue, or on `?` hover/focus/click, or when the palette or drawer opens.
   Until then a `?` has the label "Help" and the popover says "Loading the help text...". `main.tsx` `helpKeys()` is async.
2. **Command palette**: lazy in `AppShell`, mounted the first time `paletteOpen` is true and kept mounted (exit animation stays). Preloaded when idle.
3. **Chat dock**: lazy the same way (first `chat.open`). The unread hooks moved to `features/chat/chatHooks.ts` so `TopBar` does not pull the dock.
   The notification route `/?chat=admin` handler moved from `ChatDock` to `AppShell`, otherwise the lazy mount missed the URL (found by `api-flows`, "following the notification opens the administrators line"; fixed, now PASS).
4. Route chunks, `preloadable()` and the idle preloader are unchanged; the palette/chat/help loaders are added to the preload queue.

**Tried and rejected: `manualChunks` vendor split** (react/motion/radix groups via rolldown `codeSplitting.groups`): static first load rose to 248,565 B
(fails the threshold; more, smaller files compress worse and the libraries are all needed on first render anyway). Not committed.
No new dependencies.

## Pass threshold
| item | result | evidence |
|---|---|---|
| 1. STATIC gzip -20 % | PASS | 307,502 -> 243,127 (-20.9 %) |
| 2a. median page switch not worse than baseline +10 % | PASS as an A/B, see caveat | perf-nav on dev, same machine state: baseline (HEAD copy) medians 195/176/193 ms, after 181/192/216 ms (median of medians 193 vs 192). Absolute numbers are far above the quiet-machine 163 ms because the host had load average 7 to 19 (other lanes); against the literal 163 + 10 % = 179 ms neither version qualifies under this load. |
| 2b. verify-all green | PASS | build, crawl (77 views), deep crawl, flows, auth flow, u1 flows, dialog smoke 106 checks 0 failures, dialog ids, help keys, fs guard |
| 2c. api-auth-flow, api-flows, api-improve | PASS | 121 PASS, 0 FAIL (final run) |
| 2c. api-stage6 | **FAIL, same on baseline** | `page.reload` times out at line 235 after 34 PASS, identically with my changes removed (verified on clean HEAD) and with them; environment/load issue (load average up to 19), not caused by this change. Not otherwise verified past that step. |
| 2d. fit checks | PASS | `fit-check.mjs`: ALL FIT (77 views) |
| 3. no visual change | PASS (by eye) | `docs/screenshots/improve-c07-{before,after}-{missions,agents,help}.png` (production previews, same script `scripts/shot-c07.mjs`; the help shot opens the first `?` popover) |

## Files changed
`vite.config.ts` (warning limit 400), `src/help/load.ts` (new), `src/features/chat/chatHooks.ts` (new), `src/App.tsx`, `src/components/layout/{AppShell,CommandPalette,TopBar}.tsx`, `src/components/ui/HelpTrigger.tsx`, `src/dialogs/defs/settings-ops.tsx`, `src/features/chat/ChatDock.tsx`, `src/main.tsx`,
`scripts/first-load.mjs`, `scripts/shot-c07.mjs` (new), `scripts/api-improve.mjs` (guard regex now accepts `axion_e2e<N>`, as `e2e-serve.ts` already does; without it the lane database `axion_e2e5` is rejected).

## Concerns
- Thin margin (2.9 kB). Further cuts would need lazy HeroScene/Charts or splitting `api/missionControl`, `data/models` (not done: look/behaviour risk).
- Dev server in this worktree returns 403 for fonts because `node_modules` is a symlink outside `server.fs.allow`; I used a config outside the repo (never committed) for the dev server and measurements. The first dialog-smoke run without it showed 1 failure from that 403, not from the code.
- A `?` hovered before the registry arrives shows a generic label for a moment; the aria-label also becomes specific only afterwards.
- I accidentally used `git stash` (shared between worktrees); work was recovered from the stash commit and the stash is now empty. One perf-nav/dialog-smoke run briefly loaded pages from port 5190 by mistake (read-only; no writes).
