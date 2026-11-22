# c63 review: organisation-level failure learning (R3-8), branch c63-failure-learning, df8c17e..6b0946c

Verdict: **CLEAR AFTER FIXES** (one should-fix in the lane, two integrator actions that must be written into the merge notes).

## What I ran (lane worktree /home/luca/AXION-w61, through heavy.sh, ports 11190/11191, DB axion_e2e12, load 12)
- `vitest failure-detection failure-patterns failures failure-attribution`, serial: 4 files, 58/58 passed (c33 and c60 files untouched).
- `api-e2e.sh api-c63.mjs`: 23/23 PASS, incl. fit at 1366x768 in dark and light (dialog top 37, bottom 731, no hidden scroll).
- `api-e2e.sh api-c60.mjs`: 10/10 PASS (the attribution section in the enlarged dialog still works).
- No "too many connections" this time. No process left running (ports 11190-11193 checked free afterwards). I did not rerun the full vitest, a11y or verify-all; I rely on the report for those.

## Findings

### F1 (should-fix, integrator): c59 field is `channel`, not `originChannel`
- c59 (/home/luca/AXION-w58, 67b40ed) `ProposeArgs` is `{... correlationId; channel?: OriginChannel }` (server/src/agents/playbooks.ts:172). There is no `originChannel` property. The brief, the c63 report (concern 1) and the review request all say `originChannel: 'tool_output'`. In an object literal that is a TypeScript excess-property error, but if the integrator casts or spreads it, the key is silently ignored and the row is classed `agent_output`/`agent`.
- Fix at merge, in server/src/failures/patterns.ts, the one `proposeLesson(c, { tenantId, agentId, proposedBy: SYSTEM_PROPOSER, kind: 'agent', text, sources, correlationId })` call: add `channel: 'tool_output'`.
- Is it correct under c59's rules? Yes.
  - origin.ts `resolveOrigin`: requested = `tool_output`; the sources are `failure_tag` only, so `refs` (lesson/skill sources) = 0 and it returns `{channel:'tool_output', cls:'tool'}` (origin.ts:36-43). No ceiling problem.
  - Trigger `origin_before_insert` (0044:42-50): channel is not 'derived', refs = 0, class 'tool' is kept, row returned.
  - CHECKs `lesson_origin_channel` (tool_output with tool) and `lesson_origin_agent` (proposed_by_kind 'agent', class <> 'human', channel <> 'human_entry') both hold.
  - `kind: 'agent'` is required by c59's `proposeLesson` (it throws ORIGIN_NOT_ALLOWED otherwise), and c63 already passes it. `derived` is NOT usable here: it needs lesson/skill sources, which these rows do not have.
  - c59's contribution trigger logs a `proposed` line with actor `failure-pattern-review`, kind `agent`, class tool (proposeLesson calls setActor), `asserted` true. Nothing in the c63 call path breaks.
- Also at merge: add to failure-patterns.test.ts an assertion `origin_channel = 'tool_output' and origin_class = 'tool'` on the opened candidate, otherwise nothing guards this. Without the fix the c59 trigger would not reject, it would quietly label the rows `agent_output`, which is the wrong direction (overstates trust).
- Lane-side: correct the property name in the report (concern 1).

### F2 (should-fix): late tagging is not stated where the number is shown
- The value is `now()` at tag time minus the stored attempt finish (service.ts `secondsSinceFailure`), clamped at 0. A failure a person saw on Monday and tagged on Friday shows "4 d".
- The dialog line reads `Found by <channel> after 2 h 5 min` (web/src/dialogs/defs/failure-tags.tsx, tag list `data-detected-after`). That reads as time-to-detection.
- Help: `failure.detect` says only "The time between the failure and your tag is worked out by the server", and `failure.detect.channel` says "The time since the failure is added by the server". Neither says that tagging late makes the number larger, or that it is not time-to-detection. The report states it (limits, concern 3) but the UI and help do not.
- Fix: UI line "tagged 2 h 5 min after the failure" (not "found ... after"), and one sentence in the `failure.detect` help: "It measures to when the tag was made, so tagging late makes it longer; it is not the time it took to notice."
- Positive: the caller cannot influence it. Body is `.strict()` (api-c63 shows 400 for `detectedAfterSeconds`); the SQL reads only `task_attempts.finished_at/started_at` of a failed attempt, which a user cannot write (attempt rows are written by the system, tasks/routes.ts:87 uses `now()`). The only caller lever is which subject they tag (task vs one of its attempts), which picks a different attempt's finish time; minor and not a timestamp supplied by the caller. No occurrence timestamp is accepted anywhere.

### F3 (minor): detection fields, optional/enum/write-once, append-only: holds
- Six nullable columns, closed CHECK lists, `detected_after` needs a channel, "other" needs a note (0047 up). Route validates the same lists (zod enums from the shared lists) and `cleanDetection` repeats them for direct callers.
- Guard `failure_tags_guard` replaced: the decision UPDATE cannot change any of the six columns; the DELETE/TRUNCATE/demo-purge branches are copied unchanged from 0028. Only 0028 and 0047 define it (grep), so the down migration restoring 0028 is right. Tests: failure-detection.test.ts:109-111 (raw UPDATE and decision UPDATE with a changed column both refused); failures.test.ts:205-211 and :301 (DELETE, TRUNCATE, purge) pass against the new guard. There is no new-column-specific DELETE/TRUNCATE test, but the same trigger covers it.
- `failure_pattern_candidates`: UPDATE/DELETE row trigger and TRUNCATE statement trigger, purge exception only for DELETE; tested (failure-patterns.test.ts:182-190).
- Minor honesty point: `fields.detectedAfter.missing` counts every confirmed tag without a value, including tags with no channel, for which the value is not applicable. The "not recorded" figure for detected-after therefore mixes "not applicable" and "no failure time stored". Acceptable, but say so in `failure.missing` or restrict it to tags with a channel.

### F4 (minor): recurrence rule: correct at the boundaries, idempotent, no playbook path
- Threshold: `rows.length < 3 || departments.length < 2` (patterns.ts) with `distinct on (t.id)`, so a task and its attempt are one failure. Tests 2/2 no, 3/1 no, 3/2 yes on the third confirmation (failure-patterns.test.ts:57-76); all pass.
- Race: the lock is `advisoryXactLock(c, 'failure-pattern:<tenant>:<mode>:<days>')` from locks.ts (schema-scoped). It is taken after the tag row UPDATE inside the confirming transaction. Default READ COMMITTED (db.ts `tx`), so after waiting on the lock the second transaction's next statement sees the first one's commit and returns `already_open`. Sound; no deadlock cycle (two modes, two locks, one tag row each). The test at :114-123 fires three real concurrent confirmations on top of two existing failures and asserts one candidate.
- Window: `f.created_at > now() - make_interval(days => 30) and f.created_at <= now()`, all SQL, tag creation time. Matches c33. See F6 for the edge convention against c54.
- No playbook path: patterns.ts contains no `playbooks` write (test greps it); the proposer is kind agent with no `submitted_by`, so c41's CHECK stops the system deciding; accept goes through c41's route. Sound.
- Cross-department agent: the agent with the most failures, lowest id on ties. It is deterministic and rejectable, and the text says so ("rejecting it changes nothing"); sound as a convention, but the candidate then sits on one agent's lesson list although the pattern is organisational. Fine for this cycle (the report's concern 2).
- Department counting, things that can miscount (all minor, mostly documented):
  - Current owner, not owner at failure time (documented, concern 4). A reassignment or an agent's `dept` edit changes the count retroactively. The stored `departments` snapshot on the link row is what the candidate was made from.
  - `dept` is free text (<= 60 chars) compared exactly: "Engineering" and "engineering" count as two departments and can satisfy the 2-department rule. Consider `lower(btrim(dept))` for the distinct count.
  - A person who tags and confirms their own tags (self-confirmed) counts; one admin can manufacture the pattern. The output is only a proposal for review, so low risk, but `selfConfirmed` could be excluded or reported on the candidate.
  - After a decision, a single new confirmed tag reopens the candidate on the old evidence plus that one (`new_evidence` is any tag decided after the last candidate's `created_at`). A rejected lesson can come back after one more failure. Acceptable; say so in help or require the new failures to add up to a fresh 3/2.
  - `new_evidence` compares `decided_at` (transaction start time) with the previous candidate's `created_at` (also transaction start time). A confirmation whose transaction began before the candidate's but committed after is treated as old evidence although the candidate did not see it. Narrow, minor.
- The extreme-length text case: 5 departments of 60 characters, the longest mode name, 4-digit counts gives 593 characters against c41's 600 limit (I computed it with the real taxonomy). It fits with 7 to spare. If a longer constant is ever added to the text, proposeLesson throws a 400 inside the confirming transaction and the person's confirmation fails. Consider truncating the names or wrapping the evaluation so a failure there never blocks a confirmation (minor).

### F5 (should-fix for the integrator): c54 merge
c54 (/home/luca/AXION-w53, 78e149f) changes the same two places in failures:
- routes.ts: `windowOf(q.window)` becomes `tx(app.db, async (c) => failureModeCounts(c, ctx, await dbWindow(c, q.window), q.includeDemo === '1'))`, importing `dbWindow` from `../company/clock.ts` instead of `windowOf` (c54 made `windowOf(w, now)` require `now`, scorecard.ts). c63 still calls the one-argument `windowOf`, so the merged tree will fail tsc if c63's line is kept.
- service.ts `failureModeCounts`: c54's bound is the closed ms-grid `date_trunc('milliseconds', f.created_at) >= date_trunc('milliseconds', now()) - ($6::double precision * interval '1 millisecond') and f.created_at <= now()` with parameter `w.to.getTime() - w.from.getTime()`; c63's is `f.created_at > now() - make_interval(days => $6::int)` with `WINDOW_DAYS[w.window]`. Both parameterise `$6`, so a textual merge conflict is certain.
How to merge:
1. routes.ts: take c54's counts handler and import (`dbWindow`, `tx` already imported). Keep c63's other changes (requireAdmin, the patterns route, DetectionIn, listFailurePatterns); the import line for `windowOf` goes away if nothing else in the file uses it.
2. service.ts: keep c63's whole select list, `group by 1..9` and the detection accumulation. Replace only the predicate and parameters with c54's: `date_trunc('milliseconds', f.created_at) >= date_trunc('milliseconds', now()) - ($6::double precision * interval '1 millisecond') and f.created_at <= now()` and `$6 = w.to.getTime() - w.from.getTime()`. Delete c63's local `WINDOW_DAYS` constant (c54's clock.ts exports a `WINDOW_DAYS` too; do not import both). `humanOnly.window` still comes from `w.window`, unchanged.
3. patterns.ts `qualifying()` also has a window bound (`f.created_at > now() - make_interval(days => $4::int)`). That is an open lower edge, the counts view will be closed after step 2, so a tag exactly 30 days old is in the counts and out of the pattern. Change it to the same closed ms-grid predicate (`... >= date_trunc('milliseconds', now()) - ($4::int * interval '1 day')`), ideally from one shared SQL fragment in clock.ts. c54's own tests (clock-bounds.test.ts) will not cover the pattern query; add one boundary test.
4. Run failure-detection, failure-patterns, failures, clock-bounds and the contract coverage test after merging.

### F6 (minor): "Found only by a person" share and its wording
- Null below 5, and the rule is applied to the denominator actually divided by (`have.channel >= 5`), not to confirmed n: 7 confirmed with 4 recorded channels gives null (service.ts; api-c63 shows "—, n=1, last 30 days, needs 5" then 60% at n=5; the contract DTO carries n, `withChannel`, window and minN).
- Wording: the row shows "Found only by a person 60% n=5, last 30 days · not recorded: 1 of 6 (17%) have no 'found by'". The caveats (tagger's own account, D2 is one author on one runtime, no rate, n counts only failures with a recorded way) are in the `failure.humanOnly` help text and match the evidence-honesty rules; D1's 24% appears nowhere (grep of the diff). OK.
- Minor: the share is shown as a bare percentage on the face of the dialog and the "own account / not a rate" caveat is only behind the `?`. Consider "3 of 5 recorded" instead of "60%" so it cannot be read as a rate of all failures. The label "found only by a person" is a stronger claim than the channel it counts (`human_review` help: "Nothing else flagged it first"); `audit` and `reported_later` are also people. Not a blocker.
- Minor: the `failure.patterns` help text tells ordinary readers to use `GET /company/failure-patterns`. There is no UI that lists patterns (report concern 7); the help is the only place they surface, plus Playbooks. Say so or drop the route name from the help.

### F7 (pass): UI
- Dialog enlarged lg to xl; at 1366x768 it measured 694 px high inside a 768 px viewport, dark and light, with a tag, counts and the share present (api-c63 and my own run). I looked at improve-c63-counts-light.png: the four selects are in two columns under the modes, labels are not truncated in the closed selects, nothing clips.
- `?` per field (`failure.detect.*`) and per chosen value (`failure.detect.<field>.<value>`); every value of all three lists has an entry (loops over the shared lists, api-c63 "4 values chosen: 9 help buttons", "the ? beside a value explains it in plain words").
- a11y: each select has a `<label htmlFor>`; the note input has `aria-label`; icons are `aria-hidden`; the report gives 0 violations in demo and api modes (not re-run by me). The c60 attribution section: api-c60 10/10 in the lane.

### F8 (pass): contracts
- Registry: `'GET /company/failure-patterns': { v: C.failurePatterns, admin: true }`; validators for FailureTagDto's six fields, FailureDetectionDto, FailurePatternsDto; coverage run calls the route and fills every field; exercised.ts and allowlists.ts untouched. The route uses `requireAdmin` (auth/session.ts:82-85, 403 for any non-admin), and the test asserts a member gets 403. The route lists only this tenant's rows (`where p.tenant_id = $1`). Admin-only is real.
- The OTel mapping, pinned list and docs got matching entries; `detection_note` is a pointer by default (content). Migration number 0047 does not clash with any other lane (0045 c60, 0046 c61, 0048 c64, 0050 c66).

## Summary table
| # | Severity | Item |
|---|---|---|
| F1 | should-fix (integrator) | c59 call: property is `channel: 'tool_output'`, not `originChannel`; add a test assertion |
| F2 | should-fix (lane) | detected-after shown as "after X" and not stated as "to when it was tagged" in UI and help |
| F5 | should-fix (integrator) | c54 merge steps; also align `qualifying()` lower bound with c54's closed edge |
| F3, F4, F6 | minor | missing count mixes N/A; dept case variants; self-confirmed counts; reopen on one new failure; text-length margin; bare percentage; help names an API route |
| F7, F8 | pass | UI fit/help/a11y; contracts and admin-only route |

## Verdict: CLEAR AFTER FIXES
1. Lane: reword the per-tag detected-after line and add the late-tagging sentence to the `failure.detect` help (F2); correct `originChannel` to `channel` in the report (F1).
2. Integrator, c59 merge: add `channel: 'tool_output'` at the one `proposeLesson` call in server/src/failures/patterns.ts and assert `origin_channel='tool_output'`, `origin_class='tool'` in the pattern test.
3. Integrator, c54 merge: steps 1 to 4 under F5, including the `qualifying()` bound.
