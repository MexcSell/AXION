# c68 review: operator attention queue "Needs you" (R3-9), branch c68-attention-queue, 24a8f05..6a52faf

Reviewer run, read-only on the lane. Ports 11690-11693 only, DB axion_e2e7, every heavy run through heavy.sh, no "too many connections" seen. All my processes are stopped (the vite on 11690 was killed by its own PID after checking its cwd was the lane; 11692/11693 are stopped by api-e2e.sh). Probe scripts and the mutation copy live in the scratchpad (`probe/`, `mut/`), not in the lane. Lane `git status` is clean.

## What I ran
| Check | Result |
|---|---|
| server and web `tsc` | clean |
| `vitest run test/c68-*.test.ts test/contracts` (lane) | 8 files, 77/77 |
| api-c68 (api mode, 11692/3) | all PASS (33 lines, 20 rows, 23 items) |
| fit-check 1366x768, demo | `ALL FIT`; `/overview?tab=needs-you mainOver 0 regions [[487,0]]` |
| a11y api | `42 views, 65 dialogs, 0 violations` |
| My own api probe (`probe/probe.mjs`, `probe2.mjs`) | privacy, thresholds, hostile strings, keyboard; findings below |
| My own mutation runs on a copy of the lane | per-loader mutations; findings below |
| TopBoard tab strips, 6 routes at 1366 and 390 | no regression at 1366; see F9 |

## Verdict: CLEAR AFTER FIXES (two should-fix, rest minor)

## Findings

### F1 (should-fix) A stale review is listed for tasks that cannot be reviewed yet
`server/src/attention/queue.ts` `staleReviews` filters only `t.status <> 'canceled'`. The review route accepts only `passed` (or `failed` with a non-accepting verdict): `server/src/tasks/reviews.ts:33-36` (`reviewable`), 409 `TASK_NOT_REVIEWABLE` otherwise.
Evidence: seeded a task with an accepted review of attempt 1 and an unfinished attempt 2, status `running` and then `retry_ready`. Both appear in the admin queue (probe2: `stale review on RUNNING task listed: true | on retry_ready listed: true`). The row says "Review the latest attempt", but the person has no way to review it until the task finishes. This is the normal state of every retry in flight, so it will be a steady source of "needs you" rows that need nobody. It also breaks the honest-"why" aim: the screen says a person is needed when the system is waiting on an agent.
Fix: restrict to the statuses `reviewable()` accepts (reuse it), and add a test with a running and a retry_ready task. The api-c68 harness and `c68-fixtures` build the stale case on a `passed` task with an unfinished attempt 2, so they never see it.

### F2 (should-fix) Keyboard: Enter and ArrowRight on a focused row act on the wrong row
`web/src/features/attention/NeedsYou.tsx:64`: Enter/ArrowRight call `e.preventDefault(); setLevel('evidence')` and never `pick(rows[i])`. `preventDefault` on Enter also cancels the button's click, so Enter does not select the row it is on.
Evidence (probe.mjs, api mode, 1366): focus row 3 by Tab/focus, press Enter -> selected index stays 0, level becomes Evidence, and the detail pane still shows row 0's "R4 approval ... production_deploy". A keyboard or screen-reader user presses Enter on row 3 and is shown the evidence of row 1. Space and click do select (inconsistent). api-c68 only tests "ArrowDown then Enter", where ArrowDown has already selected, so it passes.
Fix: in `onKey`, call `pick(rows[i].id)` before `setLevel('evidence')` (or drop the Enter override and let click select). Add a check: Tab to a non-selected row, press Enter, assert the detail pane shows that row.

### F3 (should-fix) The failure action text cannot be followed, and one failure can hide another
a) `ATTENTION_REASONS.failure_no_detection.action` and `evidence.ts` say "Tag the same task again with the detection channel". c63 made detection fields write-once, and `failure_tags_live` (migration 0028, unique on tenant/subject/taxonomy/mode where status<>'rejected') blocks a second tag of the same mode. c63 report concern 3 says the real path is "reject and re-tag". The action label "Add the detection channel" promises something the screen and API do not offer.
b) The exclusion `not exists (... same subject_kind/subject_id ... detection_channel is not null)` in `undetectedFailures` is per subject, not per tag. Seeded a subject with mode FM-1.4 confirmed with no channel and FM-2.1 confirmed with a channel: the FM-1.4 failure leaves the queue (probe: `failure with a channel-tagged sibling on same subject not listed`). FM-1.4's detection is still unknown. This is a hide that is not an explicit fold, against "nothing is hidden except by explicit fold". The help text does state the subject rule, so it is disclosed, but it is not what the row's why says ("A confirmed FM-x failure has no recorded detection channel").
Fix: reword the action to "reject the tag and tag it again with the channel" (or whatever c63 allows), and make the exclusion per mode (same subject and same mode_id), or state the cross-mode rule in the sentence.

### F4 (minor) Free text reaches the evidence level for approvals (Origin, Target), contradicting the code comment
`server/src/attention/evidence.ts` header says "no agent- or person-written text goes in". For approvals it shows `Origin` and `Target`, which are free-text columns (`origin text`, `target text`, migration 0029; set by the requesting agent). Probe: approval with a 3000-character `<img src=x onerror=alert(1)>` origin/target appears verbatim in `rows[].members[].evidence.facts` (18 KB response). It is not in any `why` or `check` (probe: no `onerror`/`KINDMARK` there), the unlisted-kind fix holds (`<b>KINDMARK</b>...` kind never appears anywhere), and React renders it as text (layout probe: no page scroll, no `dd` overflow, no `img`). The same two fields are already in `GET /approvals` for the same viewers, so this is not a privacy leak.
Fix: either cap the length and say it is agent-written in the label ("Origin (as the agent stated it)"), or fix the comment. A test on hostile origin/target would close it; `c68-detail` covers title and detail only.

### F5 (minor) Tab order makes the detail pane 43 Tab presses away
Rows (and each row's `?`) are all in the Tab order (the a11y fix 40b25d0 removed `tabindex=-1`). With 21 rows, probe2 measured 43 Tab presses from the first row to the Level control. Arrow keys move between rows, but a keyboard user must Tab through the whole list, or use arrows and Shift+Tab. A `role="listbox"` with roving tabindex (a composite widget, which a11y-check allows) or a skip link would fix it. Also `ArrowRight` inside the radiogroup did not move to the next level (focus text stayed "Activity"); that is the shared `Segmented`, not c68.

### F6 (minor) Waiting-time fallback is honest only at the third level
The row and Activity show "waiting 10 days" with no marker when the task has no `task.stateChanged` event and the creation time is used. Only the Evidence fact "Waiting measured from: the task's creation (no state change is stored)" says so (probe: a task created 10 days ago, no event, is listed with that fact). tasks has no `updated_at` (migration 0002), so the fallback is unavoidable. Suggest a "~" or "since creation" hint in the list time, because the number is shown as a fact on the first two levels. Also "no state change is stored" should read "no state-change event is stored".

### F7 (minor) Wording
Evidence fact "Tier: R2, decided by user": `approverFor('R2')` returns `user`, shown raw (only `owner` is mapped to "an administrator"). Screenshot hostile-evidence.png.

### F8 (minor, owner decision) Header aside hidden on this tab only
`Overview.tsx`: `aside={tab === 'Needs you' ? undefined : ...}`. Acceptable as shipped: documented, still `TopBoard`/PageFrame, KPI tiles stay, and it buys 13 visible rows in api mode (lane figure; fit-check and api-c68 confirm no page scroll). But it makes the header height depend on the tab: demo 227 px on Pulse and Portfolio, 179 px on Needs you (measured), so the whole page jumps by 48 px (more in api mode, where the scorecard is about 316 px) when switching. The owner's "shared PageFrame on every page" and "consistent" rules favour folding the header (TopBoard already has the fold chevron; it could start folded on this tab) over removing a section. I would accept this cycle and put the fold option to the owner; I would not block on it.

### F9 (minor) Global `.tb-tabs > .tabs > .tab { flex: none }`
Measured with and without the rule on Overview, Operations, Agents, Results and Notifications (Missions has no TopBoard strip): at 1366 identical (no overflow, nothing squeezed, no sideways page scroll). At 390 the rule changes every one of them from squeezed labels (5 of 5, 9 of 9, 8 of 8 tabs clipped) to a scrolling strip with the right edge fade (`data-fade="r"`), no sideways page scroll. So it fixes a latent squeeze on all those pages rather than regressing them. Residue: a user at 390 now scrolls a 935 px strip on Operations and Agents with only a fade as the hint. Fine. Not screenshotted (my screenshot output path failed, so the numbers above are the evidence).

### F10 (minor) Inner scroll vs the one-screen rule
`ny-rows` scrolls inside its panel past about 13 rows; `overview-fit.css` says Overview has no inner scrolling. Judgement: acceptable. The page never scrolls (fit-check `mainOver 0`, api-c68 `page 0`), other pages already use `fit-scroll` regions (fit-check lists regions on most routes), and a "show what fits" count would hide rows, which this cycle forbids. The stale sentence in `overview-fit.css` should be updated so it no longer claims no scrolling at all.

### F11 (minor) Test gaps found by mutation
I mutated each loader in a copy of the lane, keeping the bind parameters used (a naive `VISIBLE_SQL` -> `true` makes pg reject the query and fails everything, so it proves nothing; my first run did exactly that and I discarded it).
- Caught (1 to 2 tests each): every `VISIBLE_SQL` (approvals, reviews, waiting, failures), the lessons predicate (`or true`), the lessons `proposed_by` branch, the deleted-mission filter on approvals.
- **Not caught:** removing the `or l.submitted_by = $3` branch of the lessons loader (11/11 still pass), and `canAct: r.owner_id !== v.user.id` -> `true` for stale reviews (11/11 pass).
So the privacy suite does bite for the visibility rule itself, as the report claims, and the mutation evidence is acceptable in place of a RED for item 6 given every loader is covered. The `submitted_by` case (an agent-proposed lesson filed by a member; the source route shows it to that member) and the owner-cannot-review rule need a test each.

## Checks that came out clean
1. **Privacy, per row kind (probe, admin and member, same data).** Member item ids are a subset of the admin's; none of the four private-mission records leak; the member's approval set equals `GET /approvals` pending (7 vs 7). The R4 row a member sees locked (`canAct false`, "Policy: a R4 request can only be decided by an administrator.") carries the bound/recomputed digest, tier, flags and kind. Every one of those is already in the member's `GET /approvals` (`approvalDto` returns digest, ruleOfTwo, origin, target, riskTier to every visible viewer), so nothing extra leaks. Demo rows pass the same `VISIBLE_SQL` as `/approvals`. No user name or id appears in the member or admin response. The ranking of rows both people can see is identical (relative order of common single rows is the same): no per-person ranking. Lessons use the `/lessons` rule (admin, or `proposed_by`/`submitted_by` is me); proposals are tenant-wide like their routes.
2. **Why sentences.** Built in `why.ts` from tier, ids, numbers and enums only. The free-ish inputs: approval `kind` is checked against `CURRENT_BASELINE.kinds` with `hasOwnProperty` (markup kind never reaches a sentence: probe), agent ids are constrained slugs (`/^[a-z0-9][a-z0-9-]{0,39}$/`), mission/task/proposal ids are generated, `mode_id` is constrained `FM-n.n`, mechanism/control fields are CHECK enums. Max `why` length 123 characters. No claim of reduced error or safer approvals in any UI string, reason table or help entry (grep; the "so do not approve" text is a check, not a claim). Help states the ranking is a design choice.
3. **Ranking and collapse.** `rank.ts` is pure, order tier then expiry then age then id; two calls gave identical row order; member order is a restriction of the admin order. The 200-event fixture test passes (200 -> 38 rows, 162 folded, 5.26, 20 R3 rows never folded); it is a hand-built list (`item()`), so the ratio is a property of the fixture, as the report says. Totals add up in my probe too (admin 28 items, 21 rows, 7 folded; member 19, 12, 7). Only R2 approvals fold; reviews and waiting by mission, failures by mode, lessons by agent and reason; proposals never.
4. **Thresholds (probe, seeded either side of each).** Waiting 23 h absent, 25 h present; expired approval absent; canceled task absent; org proposal 47 h present, 49 h and past absent; failure 29 days present, 31 days absent. A failure leaves only by a 30-day age-out or by another confirmed tag with a channel on the same subject (see F3). c51 stale rule is the shared `STALE_BEFORE_SQL` (correct, but see F1 for the status gap); c63 uses `detection_channel is null`.
5. **Contracts.** Registry entry `GET /attention`, strict validators for every DTO and nested object, coverage calls for admin and member, no allowlist lines in the diff; contracts tests pass.
6. **a11y dialog count 65 vs c58's 66: not a dropped dialog in c68.** c68 touches no file under `web/src/dialogs`. `web/src/dialogs/defs/dimensions.tsx` was deleted by commit b0ddcf3 (c54 M1b: "Six dimensions is a tab ... instead of dialog DL-98"), and c59, c60, c61 and c63 already report 65. The report's "I did not find out why" can be closed with this.
7. **UI against the reference.** Screenshots in `shots-c68/` and my runs show the same panel, chip, icon and `?` language as the rest of the app, motion via the shared spring/fade, 13 rows at 1366x768 with no page scroll (dark and light), a stacked 390 px layout with no sideways scroll (api-c68 checks both), DEMO marks on demo rows and a DEMO tag on the demo sample, `?` per row and per code (sibling of the button, not inside it).

## Verdict
**CLEAR AFTER FIXES.** Required before merge:
1. F1: list a stale review only when the task is reviewable (reuse `reviewable()`), with a test for running and retry_ready.
2. F2: Enter/ArrowRight must select the focused row, with a browser check that Tab-then-Enter shows that row.
3. F3: correct the failure action text to the reject-and-retag path, and make the "has a detection channel" exclusion per mode (or state the rule in the sentence).

Should be done in the same round if cheap: F4 (label/cap/test for origin and target), F11 (two tests), F7 and the overview-fit.css comment. F5, F6, F8, F9, F10 can go to the backlog or the owner.
