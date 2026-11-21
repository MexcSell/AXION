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
| 2. 0 states without live region, one shared component, errors `role=alert` | PASS for the inventory; slow probe saw "Loading proposals…" and "Loading instances…" announced on 3 pages, fail probe saw alerts on all 6 |
| 2. script checks live regions and Tab wrap; passes demo and api | PASS: demo 50 views, 55 dialogs, 0 violations; api 40 views, 55 dialogs, 0 violations |
| 3. no visual change | PASS: failed-load screenshots of /overview, live instances and proposals, before vs after: 10 / 0 / 9 of 1.57 M pixels differ (animation noise). `web/scripts/shot-c23.mjs` |
| 4. verify-all, api-improve, api-stage6 | see below |

RED evidence: before the fixes the script's api-mode probe found the loading text with no status ancestor (f51f788 + original src); demo run on the base src (without c16 files) gave 29 violations.

## Concerns
- The slow probe did not catch a loading text on /overview, live-instances and proposals (the data arrives or is cached before the audit), so those three are covered by the fail probe and by grep only.
- The first api run reported 4 WRAP violations (conversation-thread, mission-create); root cause was the script counting a disabled button, not Modal.
- Modal.tsx and Form.tsx come from c16; merge c16 first or expect an identical-content merge.
