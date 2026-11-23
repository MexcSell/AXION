# c88 brief: org proposal evidence for members, and the column guard scope (T2, M2d)

**Lane:** w86 (`/home/luca/AXION-w86`, branch `c88-evidence-scope`), from improve-30h at the commit that adds this brief (batches through 42 merged). Ports 13690–13693. E2E DB **axion_e2e13** (reused; edit the lane `server/.env` after `new-lane.sh`). **Server, contracts and tests only: no file under `web/src` may change. No migration.**

**Sources:**
- c87's FINDING (see `cycles/c87-report.md` and `c87-review.md`, once c87 lands; until then this brief is the spec):
  - `GET /organization/proposals` is `requireUser`, and every proposal's stored `result.evidence` (`server/src/organization/evidence.ts:48-111`, written at creation by an admin) counts open tasks, failures and approvals over **all** non-demo missions, private ones included;
  - a member reads it: for example, the load_imbalance fact "Agents with at least one open task" moves 1 → 2 when another member's private mission gets an open task.
- BACKLOG M2d.
- c64's proposal code (`organization/proposals.ts`, evidence.ts, `cycles/c64-*.md`).
- How the web renders evidence: `web/src/dialogs/defs/org-proposals.tsx`, `web/src/features/agents/ServerProposals.tsx`. Read them; don't change them.

**HARD RULE:** never connect to, query or read the live `axion` database in any form. Never run migrate, demo:* or audit:* CLIs.

## Items (each RED first, then GREEN, each its own commit)
1. **T2: member view of evidence.**
   - For a non-admin caller, every proposal read (list and detail, plus any other route returning `result.evidence`) must not expose counts computed over missions the caller can't see.
   - The fix: for non-admins, replace each evidence fact's numeric value, and any subject list derived from mission data, with a hidden state. Keep the trigger kinds and the `supported` flag only if they don't depend on hidden data; otherwise hide them too, and say which you chose and why.
   - Admins are unchanged. The stored row is unchanged, because this is a read-time redaction.
   - The DTO/validator change uses nullable fields or an explicit `hidden: true` per fact, and adds no c50 allowlist line.
   - Read the web renderers: they must show something sensible ("visible to administrators") and never `null`/`undefined`/`NaN`. **You may not edit `web/src`.** If the web would render badly, stop and report exactly what it would show; the controller decides.
   - Test: member and admin over the same proposal, before and after another member's private mission gains an open task. The member's response is identical in both; the admin's changes.
2. **M2d: column guard scope.** Add `server/src/organization/plan-metrics.ts` (c85's observation counts per registry metric) to the c83 loader scan. Each unit's reads must be declared, either against the metric's registry entry or in a reviewed `PLAN_UNIT_READS` table next to it. Show RED on an injected undeclared column read in plan-metrics.ts.
   - `server/src/forecasts/` is not a registry metric, so state that in the scan's header as an explicit exclusion with that reason.
3. **Sweep check.** If the c87 in-tenant sweep (`server/test/tenant/vis*.ts`) is on your base, its FINDINGS entry for `/organization/proposals` must be removed and the sweep must pass. If c87 is not yet merged on your base, say so; the integrator removes the entry at merge.

## Standing rules
PHASE2.md "Standing rules for every Wave 5+ brief" apply. No c79 or c87 exceptions.

## Pass threshold
- Items 1–2 RED → GREEN.
- test/tenant green.
- Full serial vitest with no failure, or every failure named.
- tsc clean in server and web.
- Diff stat: no `web/src` file and no migration.

## Report
`cycles/c88-report.md`. Follow the LANES.md Finishing rule. **Deadline:** hand back by about 12:30Z.
