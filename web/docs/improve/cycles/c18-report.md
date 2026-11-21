# Cycle 18 (lane w16): Agent Profile fits one screen at 1366x768

## Change
- `AgentProfile.tsx`: the tab strip uses the existing icon-first `collapse` mode (as Missions does).
- `Tabs.tsx`: in collapse mode every tab gets `aria-label` (label plus count), because a hidden text label left the icon-only tab without an accessible name. Tooltip (`title`) was already there for unselected tabs.
- `overview-org-agent.css`: (1) the profile strip shows labels only when it is at least 1180px wide (ten tabs need about 1150px; the shared 980px default left "Audit" clipped); (2) on short desktop screens (min-width 1280, max-height 860) the hero keeps its 3 columns (160px card, identity, 280px numbers) with tighter number tiles instead of wrapping the numbers below. Large screens (height above 860) are untouched.

## Measure (fit-check, all routes x tabs)
| Size | Before | After |
|---|---|---|
| 1366x768 | 10 BAD, all `agentProfile` tabs, mainOver 13px (Evolution/Audit tab clipped) | ALL FIT |
| 1280x760 | 10 BAD, all `agentProfile` tabs, mainOver 166px (hero numbers wrapped below) | ALL FIT |
| 1672x941 | ALL FIT | ALL FIT |

Note: fit-check only measures `main` overflow, so the 13px figure was the tab strip wrapping to a second row. An intermediate attempt (hero only) still showed ALL FIT-class numbers while the last tab was clipped; the screenshot caught it, hence the 1180px threshold.

## Look and behaviour
- Screenshots: `docs/improve/cycles/c18-shots/profile-1672.png` (labels on every tab, same as before), `profile-1366.png` and `profile-1280.png` (icons for unselected tabs, selected tab labelled, all ten visible).
- 1672: no CSS rule changed for that size (strip is wider than 1180px, height above 860), so the look is identical. No "before" screenshot was kept (stash is forbidden, no second tree).
- Tabs component logic unchanged (roving focus, arrows, Home/End); `api-improve.mjs` clicks the tabs by role and name and passes.

## Verification
- `tsc --noEmit`: clean. `verify-all`: typecheck+build, crawl (77 views, no problems), deep crawl, dialog smoke 106 checks 0 failures, help keys, fs guard OK. One flake in `flows.mjs` ("Modal focus trap", on /agents) during a loaded run; two reruns of flows.mjs pass it.
- `api-improve.mjs`: 83/83.
- `api-stage6.mjs`: 34/35. The one FAIL (`page.reload` timeout at the long-thread paging step, line 235) is **pre-existing**: it fails identically with my changes reverted (run with `git checkout -- src`, then reapplied), and is about mission threads, not profiles.

## Concerns
- `api-stage6.mjs` reload timeout is a baseline failure to be looked at separately.
- The verify-all flows modal check is timing sensitive under machine load.
