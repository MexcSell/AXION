# Cycle 23 report (lane w21): loading and failed-load states are announced

## Inventory before (grep at f169636, api-mode only)
About 14 loading / failed-load states had no live region: CommandCenter scorecard (1), VersionProposals (1), ServerProposals (1),
PartStatus loading + error (2), AgentProfile instances x2 and versions (3), Agents live instances (1), JobSearch preview (1),
ChatView empty "Loading the conversation…" / "Could not load…" (1, shared by ChannelChat and Messenger), PageSkeleton
(aria-busy only, not a live region) (1), agent-versions dialog diff "Loading…" (1). Error banners (`oa-banner`) already carried `role="alert"`.
(The brief asked for a count from the a11y script too; the c16 script only saw transient text and reported 0, see the cycle 16 review.)

## Changes
- New shared `web/src/components/ui/LiveStatus.tsx`: `kind="loading"` gives `role="status"`, `kind="error"` gives `role="alert"`; the caller keeps its own class and style, so nothing visual is added.
- Used in Agents, AgentProfile (3 places), ServerProposals, VersionProposals, JobSearch, CommandCenter scorecard.
- Attribute only (the markup is owned by shared components): PartStatus (status / alert), ChatView empty state (status / alert), PageSkeleton (`role=status`), PageFrame KpiTile text ending in an ellipsis, agent-versions dialog diff.
- a11y script: live-region checks on loading and error states, Tab and Shift+Tab wrap-around in every dialog, and api-mode probes that hold (slow) or fail (500) the data requests of 6 pages and print the live regions seen.
- Script fixes found while running: wrap check ignores disabled controls (motion buttons keep `tabindex=0` when disabled, a false positive); the slow probe waits for the shell first.
- Took `Modal.tsx` and `Form.tsx` unchanged from branch c16-accessibility (identical files; the lane base lacked them, and without them the script reports 29 violations in demo mode: 23 NAME, 2 TRAP, 2 ESC, 2 FOCUS). They merge cleanly with c16.

## Results
| Threshold | Result |
|---|---|
| 1. inventory before | PASS (~14 above) |
| 2. 0 states without live region, one shared component, errors `role=alert` | OVERCLAIMED in the first round (dialog busy states were missed); see Fix round for the honest result. First-round text: slow probe saw "Loading proposals…" and "Loading instances…" announced on 3 pages, fail probe saw alerts on all 6 |
| 2. script checks live regions and Tab wrap; passes demo and api | PASS: demo 50 views, 55 dialogs, 0 violations; api 40 views, 55 dialogs, 0 violations |
| 3. no visual change | PASS: failed-load screenshots of /overview, live instances and proposals, before vs after: 10 / 0 / 9 of 1.57 M pixels differ (animation noise). `web/scripts/shot-c23.mjs` |
| 4. verify-all, api-improve, api-stage6 | first round NOT MET (superseded by the Fix round, now run): verify-all was cut by my 590 s timeout during crawl-deep (0 FAIL lines before the cut, run incomplete); api-improve and api-stage6 were not run. Only attributes and one new component changed, but this is unproven. Controller should run them. |

RED evidence: before the fixes the script's api-mode probe found the loading text with no status ancestor (f51f788 + original src); demo run on the base src (without c16 files) gave 29 violations.

## Concerns
- The slow probe did not catch a loading text on /overview, live-instances and proposals (the data arrives or is cached before the audit), so those three are covered by the fail probe and by grep only.
- The first api run reported 4 WRAP violations (conversation-thread, mission-create); root cause was the script counting a disabled button, not Modal.
- Modal.tsx and Form.tsx come from c16; merge c16 first or expect an identical-content merge.

## Fix round (review c23-review.md)
- I1: dialog busy states now have live regions: org-proposals "Checking on the server…" (`role=status`), chip "loading chart…" and agent-versions chip "loading…" (chips wrapped in `<span role="status">`). The script's busy-text and loading-text scans now cover `[aria-modal=true] *` as well as `main *, .page *`.
- Honest re-inventory (api mode, searched: `Loading…`, `Reading…`, `Checking…`, `loading…` chips, `could not be read`, `not loaded`, `Could not load`, `data-state=loading|error`, `usePartStatus`, Messenger/ChannelChat empty titles, KPI `text:` tiles, PageSkeleton). Every one of these now sits in a live region. Left out on purpose and not announced: busy button labels that change in place ("Connecting…", "Adding…", "Saving…" on buttons), and the mock job-search preview (simulated store). The claim is "0 known loading/failed-load text states without a live region", checked by script only on the 9 probed pages and the 55 dialogs.
- I2: probes now assert. Each page needs a loading (slow) and a failed-load (fail) text in `role=status` / `role=alert` matching a pattern, or an explicit `none` reason (none was needed). Nine pages: overview, live instances, proposals, development, agent profile (two tabs), mission hierarchy, task flow, conversations (M-125). A deleted live region now fails with `LIVEPROBE`. Two pages (live instances, development) show the whole-page skeleton while held; its sr-only "Loading…" is what is asserted.
- Minors: ChatView state moved out of the `role=log`: a new `emptyState` prop (`loading` | `error`, set by ChannelChat and Messenger) renders an sr-only status/alert sibling outside the log, and the visible empty block is `aria-hidden` then (no double announcement, no title regex). KpiTile takes a `live` prop (set in CommandCenter only for api-mode loading / unavailable tiles; demo unchanged). PageSkeleton has sr-only "Loading…". CommandCenter renders a separate keyed element per state instead of flipping the role.
- Note: live regions that mount already filled are announced unreliably by some screen readers; accepted.
- Results: a11y script api 40 views / 55 dialogs 0 violations; demo 50 / 55, 0; api-improve 83/83; api-stage6 34/35 (the one failure is the known `page.reload` 30 s stall); verify-all (own OUT /tmp/axion-verify-w21): 0 FAIL lines, all stages ran to the end (typecheck+build, crawls, flows, auth flow, dialog smoke 110 checks 0 failures, ids, help keys, fs guard).
- Not re-measured: the pixel comparison was taken before the fix round; the fix round changes only attributes, sr-only nodes (absolute, 1px) and one span wrapper around two dialog chips.

## Fix round 2 (re-review)
- Problem: the first fix put `aria-hidden` on the visible chat error block (it holds the error detail and a focusable Retry) and spoke only the title through an sr-only twin.
- Fix: the twin and `aria-hidden` are gone. The empty/error block itself is the live region (`role=alert` for error, `role=status` for loading), so its title, detail and Retry stay visible and reachable. To avoid nesting it in `role=log` without moving it (which would change the layout), the `.thread-body` drops `role=log` / `aria-live` only while `emptyState` is set; it is a plain container then, and the log returns once messages load. The element and styles are unchanged (the coordinator suggested a sibling outside the log; this reaches the same result with no layout risk).
- Screenshot before/after of the failed conversation (mission M-125 conversations, mocked 500; `scripts/shot-c23.mjs`): 8 of 1.57 M pixels differ, overview 2: no visual change. The error block shows title, "Request failed (500)." and Retry.
- a11y script: new `HIDDENFOCUS` check (no focusable element inside `[aria-hidden=true]`) in the per-view audit and the dialogs.
- Results: a11y api 40 views / 55 dialogs 0 violations; demo 50 / 55, 0; api-improve 83/83; api-stage6 34/35 (known `page.reload` 30 s stall); verify-all (own OUT): 0 FAIL lines, all stages ran, dialog smoke 110 checks 0 failures.
