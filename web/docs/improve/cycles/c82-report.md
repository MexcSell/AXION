# c82 report: 390 px tab strips (H16) and two harness races (H22)

Lane w80, branch `c82-tabstrip`, base `5891ad7`. Web and web/scripts only: no server file, no migration.
Dev server 13090, e2e 13092/13093, database `axion_e2e16`. Every heavy run went through `heavy.sh`; load averages are printed with each check below.

## Items

| # | Item | Verdict |
|---|---|---|
| 1 | Open-check at 390 px | PASS |
| 2 | Label-overlap probe, RED on base and on an injected overlap | PASS |
| 3 | Fix (H16), 1366x768 and 1280x760 pixel-equivalent | PASS |
| 4a | Selected-tab effect keyed on the tab ids, snap-back RED first | PASS |
| 4b | A focused non-selected tab scrolls fully out of the 28 px fade | PASS |
| 5 | H22 (1): fit-check waits for a rendered main | PASS |
| 6 | H22 (2): deep crawl retries exactly ERR_NETWORK_CHANGED once | PASS |

## 1. Open-check (base, 390 px, demo and api)
Screenshots before the fix: `c82/before/390-*.png` (Operations > Services / Agents / Models, Agents, Agent profile, Missions, Mission Control, Notifications, Overview). The probe (item 2) visited 80 views in each mode.
What the base showed at 390 px (probe RED, `c82/red-base.txt`):
- **System Operations sub-strips** (Agents views: Directory, Development, Lineage, ...; Models views): every label overlapped its neighbours and spilled out of its own tab (tabs squeezed to 38-45 px with 57-83 px of content). Also the agent status chips (All, Working, In Mission, Idle, Learning, Evolving) on the same page.
- **Mission workspace tabs** (the selected "Overview"/"Approvals (1)" label over the icons beside it) and **Agent profile sections** (selected "Profile"/"Performance" over its neighbours).
- Clean on base: System Operations main strip, Overview (5 tabs), Missions status filter, Notifications. They already scroll with the c54 edge fade.
Cause, one line: `.tab` is a shrinkable flex item (`flex: 0 1 auto`), so a strip in a narrow box squeezes every tab below its content instead of scrolling. The c68 rule `.tb-tabs > .tabs > .tab { flex: none }` fixed only the page-frame strip.

## 2. Probe (H16)
`scripts/api-c82-tabs.mjs`; `api-mobile.mjs` imports `probeStrips` and runs it on every route, every operations tab and every tab click (at both its sizes). For every visible tab in every strip:
- the label's box (icon, shown text and count) intersects no other tab's box;
- it sits inside its own tab (1 px tolerance);
- shown text is never clipped (`.tab-text` scrollWidth vs clientWidth), the label box does not spill out of its tab;
- an icon-only tab keeps an accessible name (aria-label);
- a tab cut by the strip edge needs the `data-fade` scroll affordance.
Standalone it covers 80 views (134 strips, 1058 tabs) at 390x844 and 1280x760.
- RED on base: `c82/red-base.txt`: 390 px, 7 Agent profile, 374 Agents views, 66 status chips, 10 Mission workspace, 133 Models views lines (the 1280 px size was clean).
- RED on an injected overlap (`INJECT=1`: `.tab { margin-right: -24px }` plus letter-spacing through an init style), Overview and Notifications, which are clean on base: 128 FAIL lines, `c82/red-injected.txt`.

## 3. Fix (H16)
Chosen: **the strip scrolls horizontally with the existing edge fade**; one rule, `.tabs > .tab { flex: none }` in `base.css`. Why not icon-collapse everywhere: the strips that overlapped already have icons only on some tabs (the sub-strips and status chips carry text labels and counts that would lose their meaning as bare icons), the Missions and Agent profile strips already collapse unselected tabs to icons (`collapse`), and the fade/scroll affordance (c54) plus the selected-tab-into-view effect already exist, so no new component state or look is needed. Strips that fit are untouched.
Evidence:
- Probe GREEN, demo (80 views, 134 strips, 1058 tabs) and api.
- `scripts/c82-pixel.mjs`: with the rule reverted by `addStyleTag` as "before", every `.tabs` strip screenshot at 1366x768 and 1280x760 is byte-identical to "after": ALL IDENTICAL, 40 views.
- fit-check ALL FIT at 1366x768 and 1280x760, demo and api (below).
- After screenshots: `c82/after/390-*.png`, and `c82/after/1366-*.png` (1366x768).

## 4. Tab-strip effects (c54 re-review), `scripts/api-c82-strip-effects.mjs` (390 px, Operations > Agents sub-strip)
- RED first (`c82/red-effects.txt`): (A) a parent re-render (typing in the search box) moved a scrolled strip 91 -> 6; (B) focusing a non-selected tab left it inside the fade (right edge -20 px, off the strip).
- Fix in `Tabs.tsx`: the effect depends on `[value, idKey]`, `idKey` the joined tab keys; a `reveal()` helper keeps a tab 32 px clear of both edges (28 px fade plus a breath), used by the selected-tab effect and by `onFocus` on every tab (scrollLeft clamps at both ends, where no fade is drawn).
- GREEN: A 715 -> 715 (unchanged); B from the start and from the end, the focused tab is >= 92 px clear on both sides.

## 5. H22 (1): fit-check wait
`fit-check.mjs`: the fixed 600 ms is replaced by `rendered()` (main holds a visible `.fit-scroll` or `.fit-fill` with height, bounded 10 s) and then `calm()` (finite animations finished, two frames painted). Not rendered is `FAIL <route> not rendered: ...` and counts as a failure, never a fit verdict. Thresholds untouched.
RED, the exact reported symptom, reproduced on demand: base script with a 2.5 s delay on the AgentProfile chunk and `domcontentloaded` navigation gives `BAD /agents/coder-01?tab=profile mainOver 0 regions []` on every tab. New script, same delay: ALL FIT. New script, chunk delayed 6 s with a 1.5 s bound: `FAIL ... not rendered`. (`c82/fit-wait-evidence.txt`; the self-test hooks `FIT_SLOW`, `FIT_NAV`, `FIT_RENDER_TIMEOUT` are documented in the script.)

## 6. H22 (2): deep-crawl network change
`crawl-deep.mjs`: only an error text matching `net::ERR_NETWORK_CHANGED` (a console error or a failed navigation) retries the page once; it prints `RETRIED <path> (harness retry, browser network change): ...`, counts it (`harness retries (ERR_NETWORK_CHANGED, once per page): N` in the summary) and keeps every other error of that attempt as a FAIL. A second network change on the retry, or any other error class, is a normal FAIL. Self-test (`FAKE_NETCHANGE=<path>=<times>`, `CRAWL_SMOKE=1`): once -> RETRIED, NO PROBLEMS, exit 0; twice -> RETRIED, then the FAIL line, exit 1. Base crawl with the error injected once: FAIL (`c82/crawl-retry-evidence.txt`).

## Checks
RESULTS_PLACEHOLDER

## Files changed
FILES_PLACEHOLDER

## Concerns
CONCERNS_PLACEHOLDER
