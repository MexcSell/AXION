# Cycle 23 review (branch c23-live-regions, worktree AXION-w21)

Verdict: spec = PARTIAL (threshold 4 honestly NOT MET; threshold 2 "0 states without a live region" is over-claimed). Quality = GOOD with Important gaps. Read-only review of the diff; nothing was run.

## 1. LiveStatus ARIA (correct)
- components/ui/LiveStatus.tsx:9: role=status for loading, role=alert for error. No aria-live on top of the role, so no double announcement (role=status implies polite, role=alert assertive). A plain div replaces a plain div, so the layout does not change.
- Used on elements that mount with their text. Their DOM is replaced when the data arrives, so there is no re-announcement per render. Concern (Minor): live regions inserted already filled are announced unreliably by some screen readers (status more than alert). The brief's "present before its text changes" is not met by the design; these are mount-with-text regions. Acceptable, but say so.
- CommandCenter.tsx:108 flips the same node between status and alert. Changing a role on a mounted node is not reliably announced (Minor).
- ChatView.tsx:252: role=status/alert on the empty block nested inside the thread's role=log aria-live=polite (:251). Nesting alert inside a polite log risks a double or odd announcement (Minor). The role is picked by regex on the title text (`/^(Loading|Could not)/`), which is brittle: a changed wording silently loses the region. The script's text check would catch it, only in api mode.
- AppShell.tsx PageSkeleton: role=status with aria-label and no text, aria-busy removed. Screen readers do not reliably speak an aria-label on a status node (Minor). The script cannot see it (no text, no data-state).
- PageFrame.tsx KpiTile: role=status chosen by `/…$/.test(k.text)`. A heuristic in shared UI; it also fires in demo mode for any KPI text that ends in an ellipsis (DOM attribute only, no visual change). Minor.

## 2. Inventory completeness (api-mode paths)
Covered and correct: Agents LiveInstances, AgentProfile x3, ServerProposals, VersionProposals, CommandCenter, JobSearch (:174, see note), PartStatus, ChatView (Messenger and ChannelChat), agent-versions diff, error banners already role=alert.
Missed (api only):
- Important: dialogs/defs/org-proposals.tsx:117 "Checking on the server…" (dry run, `dry.state==='checking'`) has no live region, and org-proposals.tsx:87 chip "loading chart…" and agent-versions.tsx:95 chip "loading…" are not live. The script's busy-text scan only looks inside `main *, .page *`, and dialogs render in a portal, so the dialog audit never sees them. Same class of state the cycle names ("busy").
- Minor: agent-versions.tsx:135 "Loading versions…" (rollback dialog `err`) is only a disabled-submit reason and is not shown as text (the hint is rendered only in the propose dialog :112); not a gap.
- Minor: busy button labels ("Connecting…" AuthGate:150, "Adding…" mission-add:102) change in place; the button name changes but nothing is announced. Arguably out of scope; the cycle brief says "busy".
- Minor: JobSearch.tsx:174 is in a mock page (js-page-mock) fed by a simulated store; fine either way.
- Not a gap: AuthGate, TopBar conn-badge and ChatView loadingOlder already had role=status; News "Searching sources…" is demo only.
So "0 states without a live region" (report threshold 2 PASS) is not true for api-mode dialogs.

## 3. No visual change / demo
No CSS file in the diff; no CSS or JS selector on [role=status|alert] (grep). LiveStatus keeps className and style. The remaining changes are attributes. Demo mode: the ChatView, KpiTile and PageSkeleton edits also run in demo but only add attributes. The pixel comparison (10 / 0 / 9 of 1.57 M differing) is reasonable and disclosed as animation noise; it covers failed-load only, not a loading state (brief allowed either).

## 4. a11y script
Real: the demo run caught 29 violations on the base (RED evidence in the report); the text/`data-state=loading` and error checks fail when a leaf text matching `loading|reading … …` is outside a live ancestor (a11y-check.mjs, new block after "cycle 23").
- Important: the slow and fail probes (end of script) assert nothing about presence. If no loading text is shown (3 of 6 pages show none, per the report) the probe passes vacuously; likewise a deleted live region on a page that renders no text passes. They only print `probe` lines. Over-permissive: the claim "the script checks live regions" depends on the text being visible at the audit moment.
- Important: loading checks run only on `main *, .page *, .sc-empty`; dialogs (portal) are excluded from the busy-text check, which is why the missed dialog items above are invisible. The probes cover 6 pages, none a mission page (PartStatus, Messenger) even though the route regex includes mission paths; those are covered by grep only.
- Tab wrap check is correct in principle: focus last visible enabled control, press Tab, expect index 0; Shift+Tab from first expects last; indexes assigned in DOM order; disabled controls excluded (the disabled-button false positive fix is right). Weaknesses (Minor): skipped silently when fewer than 2 controls or when the earlier trap test failed; DOM order is assumed to equal tab order (positive tabindex or radio groups would mis-report, in the failing direction, so not permissive); stale `data-a11y-i` attributes are left on nodes (dialog nodes are removed, harmless).
- Demo run (50 views, 0 violations) never exercises api-only loading branches; the api run is the only real signal, and it was reported once.

## 5. Honesty of NOT MET
Good: threshold 4 is labelled NOT MET with cause (590 s timeout, run incomplete, 0 FAIL lines before the cut), api-improve and api-stage6 not run, and a request to the controller. Concerns disclosed (3 of 6 slow probes). Minus: threshold 2 is labelled PASS for "the inventory" while the inventory missed the dialog states above, and the report says "~14" with no list of searched patterns. Also Modal.tsx/Form.tsx are taken from c16 (identical, disclosed); merge order c16 first.

## Findings
- Important: api-mode dialog busy states without live region (org-proposals.tsx:117, chips :87 / agent-versions.tsx:95) are missed and invisible to the script; threshold 2 "0 states" over-claimed.
- Important: slow/fail probes have no assertion (vacuous pass); loading checks exclude dialogs and mission pages.
- Minor: ChatView nested alert inside role=log; regex-chosen roles (ChatView, KpiTile); PageSkeleton status without text; role flip at CommandCenter.
- Threshold 4 NOT MET: stays open; integrator must run verify-all, api-improve, api-stage6.
