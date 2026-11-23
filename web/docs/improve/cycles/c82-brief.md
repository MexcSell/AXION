# c82 brief: 390 px tab strips and two harness races (H16, H22)

**Lane:** w80 (`/home/luca/AXION-w80`, branch `c82-tabstrip`), from improve-30h at the commit that adds this brief (batches through 37 merged). Ports 13090–13093. E2E DB **axion_e2e16** (reused; edit the lane `server/.env` after `new-lane.sh`). **Web and web/scripts only. No server change, no migration.**
**This lane touches `web/` and must merge before the 16:00Z web freeze, so it must be done (committed, checks run, report written) by about 12:00Z.** That leaves time for review and a fix round. If you are short of time, cut scope and say which items are NOT MET. Never hand back late.
**Sources:** BACKLOG rows H16 and H22, `cycles/c54-review.md` and its re-review, and the owner's rules in memory: every page fits one screen, shared PageFrame, the look matches the reference.

**HARD RULE:** never connect to, query or read the live `axion` database in any form, and never use ports 5190/5191. Use your lane's ports and `axion_e2e16` only.

## Items (each RED first, then GREEN, each its own commit)
1. **Open-check.** On your base, take 390 px captures, demo and api, of every tab strip: System Operations (all tabs and sub-tabs), Overview (5 tabs), Agents, Agent Profile, Missions and Notifications. Show whether labels overlap or clip today. Save the screenshots and name them in the report.
2. **Label-overlap probe (H16).** Add a probe to `api-mobile.mjs`, or a new `scripts/api-c82-tabs.mjs` the api-mobile run calls. For every visible tab in every strip, at 390 px and also at 1280×760, check two things:
   - the label's text box intersects no other tab's box;
   - text is never clipped (`scrollWidth > clientWidth` on the label) unless a deliberate icon-only state applies with an accessible name.
   - Show the probe RED on the base overlap from item 1. Also show it RED on an injected overlap (for example, a CSS mutation through `page.addStyleTag`) before any fix.
3. **Fix (H16).** At narrow widths, collapse tabs to icon-first with the label in `aria-label` and a tooltip. Alternatively, let the strip scroll horizontally with visible affordances; pick what fits the existing tab component and the reference look, and say why. No overlap and no clipped label at 390 px, and the 1366×768 and 1280×760 layouts stay pixel-equivalent (fit-check ALL FIT in both modes).
4. **Tab-strip effects (c54 re-review).**
   - The selected-tab scroll effect depends on `[value, tabs]`, and `tabs` is a new array every render, so a parent re-render can snap a scrolled strip back. Key it on the tab ids (a joined string), and show the snap-back RED in a test first.
   - Scroll a focused, non-selected tab fully out of the 28 px edge fade.
5. **H22 (1): fit-check wait.** `fit-check.mjs` judges the page after a fixed 600 ms wait. Once it showed `BAD /agents/coder-01?tab=performance mainOver 0 regions []`, with main not rendered yet. Replace the fixed wait with a condition: main has rendered content and the route's ready marker or settle() holds, with a bounded timeout. A timeout is a FAIL line that says "not rendered", not a fit verdict. Never loosen the fit thresholds.
6. **H22 (2): deep-crawl network change.** `crawl-deep.mjs` once failed on `net::ERR_NETWORK_CHANGED`, a browser network event. Treat exactly that error as a harness retry: retry the page once, print a `RETRIED` line with the error, and count it in the summary. A second failure is still a FAIL. No other error class may be retried.

## Checks before hand-back
- On your own dev server and e2e ports:
  - verify-all (own OUT dir);
  - fit-check demo and api at 1366×768 and 1280×760;
  - a11y both modes (0 violations);
  - api-mobile full, with `DATA_MODE=api` (0 FAIL; the new probe included);
  - api-c46 and api-c68 (they own tab strips);
  - before/after screenshots at 390 px and 1366×768.
- Run all of these through `heavy.sh`, with the load average printed.

## Standing rules
PHASE2.md "Standing rules for every Wave 5+ brief" apply. In api mode never wait for networkidle and add no fixed sleeps.

## Report
`cycles/c82-report.md`. Follow the LANES.md Finishing rule, including the committed-diff check.
