# c46 review: six-dimension scorecard (independent)

Reviewed `c46-six-dimensions` at `c905b51` (base `7a139d8`). Lane left at `c905b51`, tree clean, ports 9590/9592/9593 free.

## Verdict: PASS-WITH-FIXES

The read model is honest where it matters. There is no composite, DEMO and simulated rows are excluded at the source, visibility uses the scorecard predicate, MIN_N is applied by one predicate, and the trend uses the equal previous window. Two things are not honest enough to merge as they are: the Environmental indicator's label and mapping (F1), and the "not enough evidence (n = 0)" text shown for cells that are hidden or unmeasured (F2). Both are small fixes.

## Evidence I ran
- Server `tsc --noEmit`: clean.
- Full vitest: 60 files, 1722 tests, all passed. 46 are c46 tests (36 pure and 10 route, per the report).
- `api-c46.mjs` (E2E ports 9592/9593): 23/23 PASS, no page errors.
- API-mode `a11y-check`: 41 views, 65 dialogs, 0 violations. Run twice. The 10 "probe ... fail" lines are the script's deliberate injected 500s (c23), not defects.
- Mutation 1: removed `!x.simulated` from the delegation filter. Two tests failed ("simulated and DEMO rows change no value", company and department). Good.
- Mutation 2: removed `!x.simulated` from the first-attempt review filter. All tests still passed. This is an equivalent mutant, not a test gap: the same rows are dropped by `realTasks` and `c.live`. The flag is redundant there and is only load-bearing in the cross-family cell.
- Screenshots (light and dark) viewed. I did not start a separate dev server for DL-98. `api-c46` drives the real dialog at 1366x768 (box 1040x657, no scroll), and both themes are in the screenshots.

## Confirmed findings

### F1 (medium) "Environmental" does not measure the environment
`server/src/company/dimensions.ts:27-33` maps FM-1.4 (loss of conversation history) and FM-2.1 (conversation reset) to `environmental`.
- In the frozen taxonomy (`shared/contracts/src/failures.ts:15-60`) these sit in FC1 "System Design Issues" and FC2 "Inter-Agent Misalignment". They are agent and context-management failures, not external-world ones (websites, sessions, model outages).
- The comment says AXION's own reading is that platform limits and restarts cause these. A confirmed human tag cannot establish that cause.
- The research notes (`phase2/research-org-verified.md`) give no basis for an environment dimension in MAST, and the taxonomy has no environment-type mode at all.
- The cell label "Tagged failures of environment type" and the `?` text "environment-type ... context-loss mode" therefore overstate what it measures.
- The sample is also self-selected: only failed or retried tasks that someone chose to tag and confirm. The evidence sentence discloses this. The label does not.
- Scenario: a team tags 3 context-loss failures. The Environmental row shows 100% environment failures, and the reader concludes websites and models are the problem.
- Fix, either of these:
  - Rename the cell to "Context-loss failures (FM-1.4, FM-2.1)" and say in the `?` that it is a proxy.
  - Leave Environmental with only its two unmeasured cells until Stage 7, and move the context-loss cell to Cognitive.
- The test at `dimensions.test.ts:246` only checks coverage of the map. It would not catch a wrong mapping.

### F2 (medium) A hidden or unmeasured cell reads as "not enough evidence (n = 0)"
- Admin-only cells for a member return `none`, `n = 0` and a sentence about administrators (`dimensions.ts:151,164,179,191,197`). The cell face shows "not enough evidence (n = 0)" (`web/src/dialogs/defs/dimensions.tsx:46`). The real reason is only in the hover tooltip and the `?`.
- The unmeasured cells (`environmental.site_navigation`, `environmental.model_availability`, `evolutionary.verdict_outcomes`) also show "not enough evidence (n = 0)". Only the small grey line below says "not measured yet".
- "n = 0" is false for a member. The admin may have many grants. It breaks "unknown stays unknown" in a quiet way: the member thinks there is nothing there.
- Recommendation: add `state: 'hidden' | 'unmeasured'` (or a `reason` field) to the contract.
  - Hidden cells: "hidden for your role".
  - Unmeasured cells: "not measured until Stage 7".
  - Set `n` to null for both, since n is not 0.
  - Show the reason on the face of the cell, not only in the tooltip.
- Keep the evidence sentence for hover and the `?`.

### F3 (low-medium) Snapshot and retroactive drift weakens trends
- The route reads 13+ queries through `Promise.all` on the pool. They are not one transaction or snapshot (`dimensions-routes.ts:42-62`). The single `now()` is read first, so it is consistent as a clock, but rows can change between queries.
- Most of the pure code bounds by `c.to`. These do not:
  - Briefs (`:53`) and `agent_instances` membership are current-state. A brief attached after a delegation retroactively makes that delegation, including those in the previous window, count as briefed.
  - Task `status` and `attempts` are current. A task reviewed in the previous window as one-attempt, then retried, leaves the previous window's sample. Previous values drift as time passes.
  - Lessons: `withdrawn_in_version` has no timestamp (`dimensions.ts:182-186`). The previous window's rollback rate is "as recorded now". The help text says "as recorded now", so it is disclosed. But the trend arrow compares two different time bases.
- Fix: run the loader in one `REPEATABLE READ` transaction. State in the `?` which cells use current state, or suppress trend on those cells.

### F4 (low) Site grants cell label
`capability.site_grants` is labelled "Site grants active", but it counts only grants issued inside the window (`dimensions.ts:~162`). A grant issued 60 days ago and still active is not counted in the 30d view. The evidence sentence says so. The label should say "of those issued in the window" or the cell should be a snapshot of all grants active at `to`.

### F5 (low) Scope claims in the UI overreach
- The tooltip says "missions you can see" on every cell (`dimensions.tsx:36`). Playbooks, promotions, rollbacks and org revisions are tenant-wide, not mission-scoped.
- The footer says "simulated and DEMO rows never counted" (`:90`). Lessons, promotions, rollbacks and playbooks have no simulated or DEMO flag, so nothing excludes them. They come from real admin actions and are probably fine, but the sentence is stronger than the code.
- Fix: per-cell scope wording ("all agents in this company") for the tenant-wide cells.

### F6 (low) Approval decision time
It uses `min(decided_at)`, the first decision (`dimensions-routes.ts:49`). Expired and undecided approvals are left out, which is survivorship. The `?` says "decided approvals", so it is disclosed. Consider counting the undecided ones in the evidence.

### F7 (low, UI) Layout and emphasis
- In the playbook cell the trend arrow wraps above the "0" (screenshot: arrow over the previous value). `.dim-cv` needs `flex-wrap: nowrap`, or the arrow should sit beside the value.
- "100%" at n = 4 is the largest thing in the dialog. There is no colour scale, so it does not read as a grade. A smaller type size for low n (for example below 10) would make it more honest.
- The evidence sentence, the most important text, appears only on hover or focus. It is unreachable on touch. Show it inline for `none` cells at least.

## Per-cell table (18 cells)

| Cell | Matches label and `?` | n, window, MIN_N | Excl. sim/DEMO | Trend |
|---|---|---|---|---|
| cognitive.first_attempt_verified | Yes (latest review, accepted, evidence, not producer or owner, 1 attempt) | n = reviewed first-attempt tasks, in window, MIN_N 3 | review flag, `realTasks`, `c.live` | equal prev window |
| cognitive.stalled_missions | Yes, uses shared `stallCheck` | n = missions with an entry in the window | `demo` and `c.scope` | yes |
| capability.playbook_items | Departure OK (accepted items per active agent, snapshot). The `?` says it. n = active agents (not items). Value 0 with n = 24 is honest | MIN_N on agents | agents are tenant-wide, no flag | snapshot as of prev `to` |
| capability.first_pass | Yes | floor 5, window, charged to owner | `t.simulated` | yes |
| capability.site_grants | Count, see F4. Admin only | n = grants issued in window | via visible live missions | yes |
| environmental.env_tagged | See F1 | n = tagged failed or retried tasks | `t.simulated` | yes |
| site_navigation, model_availability | Unmeasured, always n = 0 (see F2) | - | - | null |
| collective.briefed_delegations | Yes ("valid brief" = row exists; briefs are validated on write) | n = delegations in window | both tables flagged | yes (see F3) |
| collective.cross_family_reviews | Redefinition is disclosed and sound: the server forbids same-family agent reviews, so the metric says something real. The people-written count is in the evidence | n = reviews | flag | yes |
| collective.approval_decision_h | Median of the first decision (F6) | n = decided | `demo` | yes |
| knowledge x3 | Correct. Duplicates closed by the system are excluded from "decided". Admin only (F2) | per cell | none exists | prev drift (F3) |
| evolutionary.promotions, rollbacks, org_revisions | Correct. The starting chart is excluded | counts, MIN_N | no flag exists | yes |
| evolutionary.verdict_outcomes | Unmeasured, n = 0 | - | - | null |

Window cells use the previous window ending 1 ms before `from`, the same rule as the scorecard.

## No composite
- Confirmed. The contract (`shared/contracts/src/dimensions.ts`) has no total or score field at any level.
- Test `dimensions.test.ts:83` asserts the exact key sets, not only a name blacklist, so a renamed total would also fail.
- The help text states there is no total. There is no colour scale and no ring gauge in the UI. Rows are independent.
- One caution: the dialog still sits next to the old fixed `RingGauge value={98}` in Company Health (DEMO only, not in this diff).

## Visibility
- The mission-scoped loader uses `VISIBLE_SQL('$2','$3')` plus `not m.demo`, `deleted_at is null` and the tenant. This is the same predicate as `company/routes.ts`. `loadDeptRows` repeats it.
- The route test covers a private mission of the admin against a member, in every mission-scoped source, and sharing it afterwards.
- Department filter: a 404 for an unknown department versus 200 reveals nothing new. The `departments` list is derived from the tenant-wide agent catalog, which every signed-in user can already read. Counts only ever come from visible missions. No leak found.
- Plausible, not confirmed: an inactive-only department returns 404 while its name may be known from elsewhere. This is cosmetic.

## Dialog or page section?
- DL-98 as a modal is acceptable for a first slice. It fits 1366x768 exactly, has three entry points, animation, icons and a `?` on every control.
- The owner's stated rule is a shared PageFrame on every page. A permanent six-row read model is closer to a page. Recommend a follow-up that promotes it to an Operations or Overview tab and keeps the dialog as the quick view.
- The Company Health entry point shows the dialog with SAMPLE data inside a DEMO-only panel. It is labelled "(sample)". That is acceptable.

## Merge interplay and ids
- DL-98 and DL-99 appear in no other queued branch (c40, c44, c45, c47, c48, c49, c50). Their ledgers top out at DL-77, DL-90 and DL-95 only.
- c47 (`0037_eval_evidence`) adds `eval_runs.subject_proposal_id`, `judge_model_family`, `evaluator_id` and `override_reason`, with verdicts still computed on demand by `verdictV2` over stored runs.
  - So `evolutionary.verdict_outcomes` becomes feasible after c47, by running `verdictV2` per decided proposal over its stored runs in a loader. It would be derived from rows, not stored, so its honest cost is a loader that recomputes.
  - Recommend this as follow-up c46b. Do not wire it in this cycle.
  - The `?` and the cell reason already name c47.
- `git merge-tree` of c46 with c47 conflicts only in `web/src/pages/Agents.tsx`. That is because c47 is based on an older commit (`09dd6cb`), not because of c46. c47 needs a rebase on the integration branch first.
- c46 adds a shared `HelpTrigger` key set `dimensions.*` and `@contracts` exports. No collision found.

## Plausible, not confirmed
- P1: Playbook items counts `jsonb_array_length(items)` for all active agents regardless of whether items carry `contradiction` flags. Unverified whether a contradicted item should count as "in force".
- P2: Promotions and rollbacks for agents that are archived still count at company level (`agentIn` is true for any id when no department). Probably fine, but worth a test.
- P3: The `?` says lessons under review are visible to "administrators and their authors". The cell is `none` for authors too, so the wording promises more than the cell shows.

## Fix list before merge
1. F1: rename or remap the environment cell.
2. F2: add a distinct hidden or unmeasured state and show it on the face of the cell.
3. F7: fix the arrow wrap in the playbook cell.

F3 to F6 can be follow-ups. F4 and F5 are wording-only if the owner wants them in this cycle.
