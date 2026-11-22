# Improvement loop log

One entry per cycle: times (UTC), theme, hypothesis, measure + threshold (fixed before the change), commits, before → after, result, screenshots, lessons. Owner questions are queued at the bottom.

## Owner questions (queued, with the default the loop uses meanwhile)
- Q1 (from Stage 5): may any member who can see a shared mission decide its approvals? Default: yes (unchanged).

- Q5 (from cycle 5): should direct edits of an agent's model, skills or tools (Stage 6 Edit) require a version proposal and a second admin, as promotions do? Default: no; direct edits stay single-admin, audited and versioned.
- Q6 (from cycle 6): when several members of a department report to the GM, which one is the department "head"? The current rule is the one with the most members under it, then the lowest id, and the card shows a "1 of N → GM" chip. Default: keep it.
- Q7 (from cycle 11): when a new mission is staffed from the org chart, should recruits who report to the GM sit under the GM in the mission, or under the mission's executor? Default (D1): under the executor, because the GM isn't counted as an in-mission supervisor.
- Q8 (from cycle 26): long threads are virtualised; the message log no longer announces rows as they scroll into view, and a status line announces messages from others. Keyboard: ↑ ↓ PgUp PgDn Home End move between messages. This needs a check with a real screen reader (NVDA, VoiceOver) in browse mode, which this environment cannot do. Default: merged after fixes; owner to verify manually.

## Cycles

### Cycle 1: A1 org change proposals (start 11:41Z)
- Brief: cycles/c01-brief.md. Hypothesis, measure and threshold are in the brief (fixed before building).
- 12:35Z implementer done (67496df, a8007d8, ded4043): server 219→248, api-improve 29/29, all suites green. Review (c01-review.md): spec PASS; Important I-1 POST /agents org race (confirmed, made reachable by this feature), I-2 validateOrg accepts charts not rooted at GM. Fix round dispatched.
- 13:10Z fix round (a55c14a, 8c4cc3a): I-1 one lock-then-read path for every org revision write, with a deterministic race test (RED on the silent revert); I-2 new errors RETIRED_MANAGER, GM_HAS_MANAGER, NOT_UNDER_GM, DUPLICATE_LINE, and the apply path refuses invalid charts; Proposals refresh on org.* and agent.created; 128-bit ids. Re-review: all ADDRESSED, no new breakage.
- Result: PASS on all 4 threshold items.
  - Server tests 219 → 258.
  - api-improve 31/31; auth 15/15, flows 23/23, stage6 94/94 (one unreproduced 92/94 flake in the Edit-dialog step, watch it).
  - verify-all green.
  - Screenshot: docs/screenshots/improve-c01-proposals-dark.png.
- Live: backup axion-20261121T131238Z.dump, restore check PASS, API 5191 restarted (migration 13), health OK, /organization/proposals 401 (signed out).
- End 13:13Z (1 h 32 min).

### Cycle 2: B1 company scorecard (start 13:15Z)
- Implementer done (362c6ed, c615458): GET /company/scorecard (visible missions only, DEMO opt-in, n and evidence per row, null below n=3); api-mode Overview tile and scorecard panel, Missions header; the token tile and fake deltas are gone. Server tests 258 → 284; api-improve 50/50.
- Review (c02-review.md): spec PASS. I1 Active Agents tile untagged DEMO count; minors m1 to m7 (incl. m2 privacy: the cache can carry the previous user's counts). Fix round dispatched 14:14Z.
- Fix round (b87e473): I1 api-mode "Staffed Agents" counts live non-simulated instances on visible, non-DEMO missions; m1 every other fixture number on Overview tagged DEMO; m2 the scorecard cache drops results from a previous session; m3 condition wait; m4 test for the `to` boundary; m6 tasks.simulated is checked.
- Re-review: all ADDRESSED, no new breakage.
- Result: PASS on all threshold items. Server 284 → 290; api-improve 55/55; auth 15/15, flows 23/23, stage6 94/94; verify-all and ov-fit green. Screenshot: docs/screenshots/improve-c02-scorecard-dark.png.
- Still open (m5): the browser check proves only a 0.0% rate, because cancel is the only final state a user can reach.
- Queued owner question Q2: should the Active Missions and Pending Approvals tiles exclude DEMO missions in api mode? Default: they include them, and a later cycle adds an "includes DEMO" hint.
- End 14:45Z (cycle 2 took 3 h 30 min). Live restart deferred until the working tree is clean (cycle 3 is running in the same tree).

### Cycle 3: C1 agent reliability (start 14:40Z)
- Implementer done (dd6bbdd, df89618, fad7ac3): reliabilityOf plus one grouped query over visible missions; the reliability field on the agents routes; the Profile stat and Directory chips; live re-read. Server 290 → 321; api-improve 81/81.
- Review (c03-review.md): quality good, privacy holds in every sub-query.
  - I1: item 3b mislabelled "Met". Ruling: relabel it NOT MET, because a user can't reach n ≥ 5 until execution exists.
  - I2: a reassigned failure was charged to the new owner. Ruling: every outcome counts against the owner at that time.
  - Fix round dispatched.
- Fix round (46c1c45): I1 3b relabelled NOT MET everywhere; I2 outcomes count against the owner at that time (a reassigned failure isn't charged to the receiver); m2/m4/m10/m3/m7. Server 321 → 331; api-improve 83/83; auth 15/15, flows 23/23, stage6 94/94; verify-all green.
- Result: PARTIAL. Items 1, 2, 3a, 3c and 4 PASS. 3b is NOT MET: a user can't drive an agent to n ≥ 5 until execution exists. It is proven in route tests plus a labelled supplementary e2e step that writes rows directly.
- Queued owner questions:
  - Q3: the Agent Profile shows a DEMO "Reliability" fixture tile next to the measured Reliability stat. Rename the fixture tile? Default: keep both, each with its own chip.
  - Q4: DEMO fixture tasks have no recorded attempts, so they never count, even with includeSimulated. Default: fine, since DEMO data shouldn't feed measurements.
- Re-review: all ADDRESSED, no new breakage. Minor N1 (own-attempt time uses started_at only; the comment says "or finished") goes to the code-health batch. Q4 refined: DEMO attempt-less failures still count while attempt-less passes don't, which biases DEMO values downward. Default: leave it until execution records real attempts.
- Live (16:10Z): backup axion-20261121T161042Z.dump, restore check PASS, API 5191 restarted on 46c1c45 (cycles 1–3; no migration since 13). Health OK; scorecard, proposals and agents routes answer 401 when signed out.
- End 16:10Z.

### Cycle 4: A2+A3 org history, diff, rollback (lane w2, start 15:55Z)
- Implementer done (4a51e15, b064925, a501e3a, 5de9b3e, 5180d91 on c04-org-history): no migration. Server 321 → 343; api-improve 104/104; auth 15/15, flows 23/23, stage6 94/94 (one combined run 93/94 on the known agent-edit flake); verify-all green. All 4 threshold items PASS per the implementer. Independent review running.

## Parallel phase (from 16:30Z)
- Owner: "add 10 more workers; if there is no work, find a new way to update". 14 lanes now run: w2 c04, w3 c05, w4 c06, w5 c07, w6 c08 to w15 c17 (see STATE.md and LANES.md). A gate allows at most 3 concurrent heavy test runs, to protect the shared PostgreSQL server used by other apps.

### Cycle 7: H2 bundle split (lane w5)
- Implementer (163bf0a, 030937f): first-load JS for /missions 307,502 → 243,127 B gzip (−20.9%, threshold −20%). The help registry, command palette and chat dock now load on demand. The "Chips" chunk was a shared bucket holding the whole help registry through HelpTrigger's static import.
- Review (c07-review.md): spec MET (thin margin), quality GOOD. I1: api-stage6 red under host load (the same failure on baseline). I2: process slips (git stash, one read-only load from 5190), now in LESSONS.
- Ruling: no code fix round. api-stage6 and the literal perf threshold get re-verified on the integration tree at merge time, with lower load. The same-load A/B (193 vs 192 ms) is accepted as evidence of no regression.

### Cycle 5: C2 agent version proposals (lane w3)
- Implementer (5b95349, 7f5829a, d9c6f14, bd81462, 148e788): server 321 → 345, api-c05 31/31, verify-all green; all 4 threshold items PASS.
- Review (c05-review.md): spec PASS. Server design approved: every active-version writer takes the per-agent lock before reading. I1: committed node_modules symlink (blocks the merge). I2: help text overstated the two-admin rule. Fix round dispatched; owner question Q5 queued.
- Fix round (7a27cc5): symlink untracked, help text corrected (promotions need two admins; direct edits and rollbacks are single-admin, audited and versioned), minors m1, m2 and m4. Controller verified I1 and I2 directly (small diff). Cleared for merge; queued after c07.

### Cycle 13: C3 experiment verdict (lane w11)
- Implementer (3bc8555): pure verdict() with 39 tests; server 370 green.
- Review: spec PARTIAL. I1: the policy guard was bypassable (thresholds supplied by the caller). Ruling: thresholds come only from the in-module registry, by version.
- Fix (0945f6b): registry-only policies plus 4 bypass tests; server 371 green. Controller verified directly. Cleared, merge queued.

### Cycle 6: B3 department facts (lane w4)
- Implementer (a7423eb, b414a19, fd1c95e, c02006b): server 321 → 352, api-c06 25/25. Item 3 is NOT MET (the Agent Profile overflows at 1366×768; pre-existing, H5).
- Review (c06-review.md): spec PARTIAL (item 3), quality good, privacy holds.
  - I2: outcome attribution must follow cycle 3's corrected rule. Ruling: the owner at the time; finish time = greatest(...). Fix round dispatched.
  - I3: the head rule is queued as Q6.
- Cycle 4 fix round (6135779, 70d8989): History view now uses its own class; the Policies Revision History panel is pixel-identical to base (byte-identical PNGs); minors m1, m2, m4, m5 done. Server 343, api-improve 105/105, verify-all green. Controller verified the CSS diff. All 4 threshold items PASS. Cleared; merge queued after c13.

### Cycle 9: H1 server minors (lane w7)
- Implementer (d52f050 RED, f344340, 3e9f79e, 18dd102): items 1 to 7 fixed; server 337, stage6 94/94 on rerun, api-improve 83/83.
- Review: spec PARTIAL. I1: the Messenger composer still sends the fixture replyTo, so a reply to a backfilled question gets 422. Minors: owner and decider names show the viewer; the read-mark is dropped on close. Fix round dispatched.
- Lane setup fix (controller): lane Vite overrides allowed the whole worktree, which made fs-guard fail. Narrowed to web/ and shared/ (new-lane.sh updated).

### Cycle 17: owner guide (lane w15)
- Implementer (03c761f): a "New Features" Help tab with 14 plain-language pages and deep links (api-c17 22/22), 10 light-mode screenshots.
- Review: I1 "another person approves" must say a second administrator; I2 "instead of editing directly" is too absolute.
- Ruling: c17 merges after c04, c05 and c06, and its 3 pages are written as available features. Fix round dispatched.

### Cycle 12: B2 trend and throughput (lane w10)
- Implementer (fbd8930, 11aac51, 4bcb5cd): previous period plus trend on scorecard rows, GET /company/throughput, Overview arrows and chart; server 347, api-c12 10/10, ov-fit NO SCROLL.
- Review: spec PASS, quality good, privacy OK. I1: throughput double-counted a failed-then-completed mission. Ruling: count once, in the week of its last final transition. Minors: neutral arrow colour, help-text precision. Fix round dispatched.

### Cycle 10: P1 DB indexes and scale (lane w8)
- Implementer (50b1ca3): migration 0017 (5 indexes) plus a scale benchmark. p95: scorecard 36.5 → 27.4 ms, /agents 47.3 → 42.7 ms (cleanest run); noisy runs were above 50 ms.
- Review: spec PARTIAL. Ruling: relabel PARTIAL; keep the indexes (they match the hot predicates and are cheap); use exact migration-count assertions; the bench guard accepts only the lane's own DB. Fix round dispatched.

### Cycle 15: Q1 contract tests (lane w13)
- Implementer (b7cfb46, 02824ee, 38314e7): 56 routes and 23 event types validated; 3 contract drifts fixed on the contract side. The final full suite after a regex fix was not completed (gate queue), so the integrator must run it. Review running.
- Review: MET for its scope. I1: c09 unifies task.delegated and adds fields, so c15's strict validators would break after merge. Ruling: merge c15 after c09, with validators aligned now. I2: the full suite was never run after the fix. I3: a no-op subagent was dispatched against the rules (recorded). Fix round dispatched.
- Fix round (cdcc0d1): validators follow c09's contracts; temporary tolerances are marked "remove after c09 merge"; guards coverage widened; full server suite 337/337. Cleared to merge AFTER c09. The integrator must then tighten the tolerances.

### Cycle 11: A4 staffing follows org (lane w9)
- Implementer (365b15c to 7021f5d): new real missions are staffed from the active org revision (KIND_DEPT table, executor from the department head, managers from the org chart); DEMO is byte-identical (golden test). Server 331 → 342, api-c11 16/16, all suites green.
- Review: spec PASS, quality GOOD, no Critical or Important findings. D1 is queued as Q7. Minors (the help repeats the table, untested DEMO safeguard) are deferred. Cleared; merge after c04 (it shares org reading).

### Cycle 16: accessibility (lane w14)
- Implementer (173c2d3, 597c592): a11y-check script; 27 real violations → 0 in demo mode and 0 in api mode (Modal focus trap ignores disabled controls; Field names its control). No visual change. The script takes ~140 s, so it is outside verify-all.
- Review: PASS, no Critical or Important findings. Cleared for merge. Deferred: loading texts in plain divs have no role=status (backlog H6); the trap test does not check wrap-around.

### Incident: shared Postgres out of connections (~20:00Z)
- Two lanes hit "remaining connection slots are reserved" / "too many clients" during server test runs. The cause: raising the gate to 6 slots, with vitest opening a DB pool per worker. Other apps on the cluster (ajp held 36 connections) were at risk.
- Fix (20:05Z): `ALTER ROLE axion CONNECTION LIMIT 45` (AXION can never take more), and heavy.sh adds --maxWorkers=2 to every vitest run. No other database or role was touched.

### Cycle 6 fix round (34edb55)
- Outcomes count against the owner's department at the time (aligned with cycle 3); finish time is greatest(...); 3 new route tests; server 365/365 (one run needed --maxWorkers=2). Item 3 stays NOT MET (H5, lane w16). Cleared; merge queued.

### Cycle 10 fix round (56125ef)
- Verdict PARTIAL, raw bench output stored; exact migration assertions; the bench guard accepts only the lane's own DB. Cleared; merge queued (PARTIAL).

### Cycle 19: C4 mentoring plans (lane w17)
- Implementer (76bf6cb, 67b62c2, 4301f0a): migration 0023; server 358; api-c19 30/30.
- Review: PASS. I1: Learning/Evolving tiles show fixture numbers next to real plans. I2: committed node_modules symlink. Fix round dispatched.

### Cycle 7 merge (648e32b): integration result
- Merged with no conflicts. Server 331/331; auth 15/15, flows 23/23, api-improve 83/83; verify-all green; fit 77/77; ov-fit 32/32. First-load static set 243,175 B gzip (the new baseline).
- api-stage6: 34/35 in 7 of 7 runs, always at the reload after the 130-message burst (the page stays unresponsive ~50 s against a 30 s timeout). A/B: the same failure on 74117b8 (before c07), so c07 isn't the cause.
- Ruling: resume merges. stage6 counts as passed with its 34 checks before the reload; the reload stall is a known pre-existing issue (lane w6 investigates). A **quiet verification window** near the end of the loop runs api-stage6 in full plus perf-nav on the integrated tree. c05's m5 gate and c07's perf figure are deferred to that window.
- Fix round (6838952): node_modules symlink untracked; in api mode the Learning/Evolving tiles count real plans and proposals; try/finally in the test. Controller verified. Cleared; merge queued after c05.

### Finding: verify-all's exit code hides failures (~20:30Z)
- Lane w15 found that verify-all returned rc=0 while flows.mjs printed FAILs ("Hierarchy: click agent → conversation pane", sometimes "Conversations: mission agents pane" and "v1 → v2 migration"). Earlier "verify-all green" claims may hide flow failures.
- Actions: the integrator greps verify-all output for FAIL from now on and re-checks flows on the integrated tree (before and after the lanes). New lane w19, cycle 21: honest exit codes in every verification script, a per-step summary, and an honest run listing what fails today.

### Cycle 17 fix round (9d710af, e4bd746)
- Two-admin wording, no "instead of editing directly", pages for c04–c06 written as available, plain language, M2 link to /missions. api-c17 all PASS + 3 SKIP (to run after merge). Cleared; merge after c04, c05 and c06.

### Cycle 14: S1 security hardening (lane w12)
- Implementer (3a82013, bcb626a, 39130bd, 14e1124): security headers on every response; a strict CSP for the built app (style-src-elem unsafe-inline for react-remove-scroll); per-session write rate limits; CSRF and Origin enforced on all 10 routes added since Stage 5; npm audit 0. Server 385; all api checks pass under the CSP preview.
- Review: PASS/PASS. I1: the rate-limit map is hand-kept and misses c05/c19 governance writes. Ruling: the integrator adds them plus a route-table test at merge. Queued after c19.

### Cycle 20: A5 org coverage (lane w18)
- Implementer (0cdfc24, cfea9b1, df91e31): orgCoverage facts (roles covered/missing, duplicate roles, depts without head, span, depth) as warnings in dry runs, History and a Policies card; server 359, api-c20 14/14.
- Review: PASS/PASS, minors only. Deferred: narrow the older api-improve assertions that ban the word "coverage"; ? help on the coverage sections; the ROLE_CATALOG↔web roles check. Cleared; merge after c04.

### Cycle 18: H5 profile fit (lane w16)
- Implementer (787a79d): Agent Profile ALL FIT at 1366×768 and 1280×760 (was 10 BAD each); icon-first tabs plus aria-labels in the shared Tabs collapse mode; 1672 unchanged. Review: PASS/PASS. Cleared; merge after c16.

### 20:00Z: 4 new lanes (owner: "if there is no work, find a new way to update")
- w20 c22 long-thread performance (the 50 s reload stall: app-side fix, threshold ≤3 s / ≤5 s for 130 / 1,000 messages)
- w21 c23 live regions for loading states (a11y H6)
- w22 c24 phone-width fit for the new features (390 / 900 px)
- w23 c25 test hygiene: narrow over-broad assertions, a shared lane-DB guard, no fixed sleeps, deferred web minors
- Cycle 9 fix round (b67e7e3 to 4eb4651): the Messenger sends pendingQ.id (api-c09 6/6); decidedByName on approvals; channel read-mark flushed on close; test 4 precondition asserted. Server 338; verify-all fully green. stage6: the known reload stall. Controller verified. Cleared; merge before c15.
- Cycle 12 fix round (564f36f, 8d6da53): each finished mission is counted once, by its last terminal transition (new test); neutral arrow colour; precise help text. Server 348, api-c12 10/10, ov-fit NO SCROLL. Cleared; merge after c10.

### Integration pacing (19:12Z)
- c05 merged (6f8bd59). Each merge takes ~30 min of checks at load ~24, and 14 are queued. Ruling: batches of up to 3 non-conflicting branches, each merge its own commit with a quick server test, the full set once per batch, bisect on failure. Planned batches: [c13 c04 c11] [c16 c18 c06] [c10 c12 c19] [c14] [c20 c09 c15] [c17].

### Incident: all workers stopped (sign-in error, ~19:20Z)
- Every running agent (the integrator plus lanes w6, w19, w20, w21, w22, w23) ended with "Not logged in" at the same moment, and the session restarted. Nothing was lost in git: no merge was in progress, and c05 (6f8bd59) is merged. Lanes keep their uncommitted work in their worktrees. Dev server 5190 had died with the old session and was restarted at 20:11Z; the live API on 5191 stayed up.
- Recovery (20:11Z): a fresh integrator from MERGES.md and LOG.md; the lanes resumed by fresh agents that inspect and finish the predecessor's work.

### Cycle 23: live regions (lane w21)
- Implementer (f51f788 to 8ce7c29): shared LiveStatus; ~14 api-mode states fixed; a11y script reports 0 violations in demo and api mode; no visual change. Threshold 4 NOT MET (verify-all timed out; api-improve and stage6 not run).
- Review: PARTIAL. I1: dialog busy states missed (the scan did not cover portal dialogs), so threshold 2 was overclaimed. I2: the probes assert nothing. Fix round dispatched.

### Cycle 25: test hygiene (lane w23)
- Implementer (60ce95b, e119dd8, 15f8d0b, dde68e7): fixed sleeps in api scripts 28 → 4; one shared DB guard; over-broad assertions narrowed; found the demo flows "Hierarchy: click agent" failure (a fixed 500 ms sleep → condition wait); "Help: Help" label fixed.
- Review: PARTIAL. I1: three negative checks were weakened (calm() waits for no data). I2: inventedNumbers misses number-before-word. Fix round dispatched.

### Cycle 8: flaky checks (lane w6)
- Implementer (ce6a693 to de6e556): a REAL app race in loadAgents (a superseded load returned without applying, so AgentEdit adopted a stale rowVersion after 409) fixed, and api-c08 forces it (5/6 before, then 20/20 runs); the c01 expiry step made deterministic (reads held at the network); the Conversations step uses a condition wait. The Hierarchy step was left to c25.
- Review: code approved. Evidence gaps (report-only fix round). The api-stage6 20× threshold waits for c22 (quiet window). Merge after c25.
- c08 report fix (60ee4b7): evidence filled in from the raw summaries (now in c08-evidence/); thresholds labelled honestly (stage6 NOT MET; expiry race never RED; threshold 1 partial). Cleared; merge after c25.
- c23 fix round 1 (to 81770b5): I1/I2 and the minors ADDRESSED; a11y 0 violations in demo and api; verify-all 0 FAIL lines. The re-review found a NEW Important: the ChatView error block was aria-hidden while it holds the error text and the Retry button. Fix round 2 dispatched (the block moves outside role=log and becomes the live region itself; an assertion: nothing focusable inside aria-hidden).

### Cycle 21: honest exit codes (lane w19)
- Implementer (0b2422c, f43ab68): 11 demo-mode scripts exited 0 on failure and now exit 1; verify-all prints a per-step table and exits 1 on any failure (proven with a dead BASE: rc=1, 9 of 10 steps failed). The honest run on current code shows all 10 steps passing, so nothing was hidden in the current state.
- Review: PASS/PASS. The fs-guard probe was a poor injection (vite fs config unchanged). Cleared; merge as batch 2b.
- c25 fix round (6cfe24e, 1d0fd4a): the 3 absence checks are back to commented waits at their original durations (a forced defect fails exactly those 3); inventedNumbers catches numbers on both sides of the word (selftest 34 PASS); api-improve 83/83; full verify-all 0 FAIL lines. Controller verified. Cleared (batch 5b, before c08).

### Cycle 22: long-thread performance (lane w20)
- Root cause of the 50 s reload stall: the whole open thread re-rendered for EVERY live message and receipt (quadratic). Fix: batch live conversation events (≤60 ms, in order, other writers flush first); single-append fast path; cached formatters; memoised bubbles and minimap blocks; one ResizeObserver.
- Reload → interactive: 130 msgs 57–60 s → 1.9–2.3 s (threshold 3 s); 1,000 msgs >120 s → 2.4–2.8 s (threshold 5 s). api-stage6 94/94 again (one run hit the c08 agent-edit race, fixed in c08).
- Remaining: a LIVE 1,000-message burst still keeps the page busy while it arrives (needs virtualisation; backlog). Review (opus) running.
- c23 fix round 2 (acc0c0e): the twin and aria-hidden are removed; the ChatView empty/error block is itself the live region, and the thread drops role=log while in that state (layout unchanged, 8 of 1.57M pixels differ); new HIDDENFOCUS check; a11y 0 violations in demo and api; verify-all 0 FAIL lines. Controller verified. Cleared (batch 2c).
- c22 review: spec PASS, quality PASS; batching correct (arrival order, flush-before-write, cleared on sign-out and mission-gone). I1: the minimap does not re-measure when a row is replaced at the same count. Fix round dispatched.
- c22 fix round (cc55d91, 5c2a32e, 665d71a): the minimap re-measures when messages change (RED on 15ef55c, GREEN after); "N new" counter fixed; batching-order checks; the script exits 1 on a miss. 130 msgs 1.7–2.0 s, 1,000 msgs 2.7–3.3 s; api-c22 14/14; stage6 94/94; verify-all 0 FAIL lines. Controller verified. Cleared (batch 2d); the stage6 exception ends there.

### Cycle 24: phone-width fit (lane w22)
- Implementer (8bab3dd to bb0551b): touch.css gated at ≤900 px; at 390×844, FAIL lines 14 → 0 (dialogs larger than the screen, clipped controls); page overflow 0 at both sizes; desktop untouched.
- Review: PASS/PASS. Ruling on the claim: only the 390 px numbers are a valid before/after (same harness). The 900 px "291 → 109 small targets" is NOT a valid gain claim (different harness and state count) and is reported as "109 remaining, listed". Cleared (batch 5c).

### Live update (23:00Z)
- Backup axion-20261121T230013Z.dump; restore check PASS; API 5191 restarted on a67d2dd (cycles 1–7, 11, 13, 16, 18, 6, 21, 23, 22). Migrations 1–13 and 15 (14 unused). New routes answer 401 when signed out; health OK.

### Cycle 27: sweep of merged minors (lane w25)
- Fixed with RED/GREEN: c05 m7 (rollback reason removed from the public event), c05 m6 (refused rollback audited as denied), c11 m3 (help generated from KIND_DEPT), c06 DEMO tags on Operations tiles, ?chat=admin keeps the URL. Listed: c05 m8, c04 m6, c22 M2 (files owned by unmerged branches). Server 475; stage6 94/94; verify-all all 10 steps pass.
- Review: PASS/PASS, minors only. Cleared (batch 5d).

### Integration progress (00:10Z)
- Batches 1, 2, 2b, 2c, 2d and 3 merged and checked; batch 4 (c14 plus the rate-limit follow-up 6876fab covering every governance write, with a route-table test) merged, checks being re-run. Server tests 331 (start of the parallel phase) → 560. api-stage6 94/94 since c22. fit-check ALL FIT at all 3 desktop sizes since c18.
- Integrator #2 stopped after a long run; integrator #3 took over from QUEUE.md and MERGES.md.
- New lane w26 (c28): root cause of the flows palette/theme flake, plus 2 small gaps found during integration.
- Batch 4 verify-all (predecessor run): NEW flows FAIL "Modal focus trap + Escape returns focus: dialog not closed" (plus the known Hierarchy flake). Integrator #3 is classifying it (3 solo runs, then bisect 0ce1391 / 1358f91; suspects c16 Modal.tsx, c23).

### Cycle 28: command palette race (lane w26)
- A REAL user bug: the lazily mounted palette opened already visible, and its on-open reset wiped a fast first keystroke, so Enter ran "Add mission" (whose dialog then blocked the theme toggle). Fix: reset the query only after close; Enter waits for the help registry. Repro 5/5 → 0/5; flows 0/21 under load. Also fixed: sign-out cancels the version-proposals refresh; "Loading history…" and "Loading plans…" wrapped in LiveStatus. verify-all 10/10; stage6 94/94. Review running.
- New lane w27 (c29): the "Delete (archive)" flows failure (5/21 under load): root cause, possible demo-store race.
- c28 fix round (1cbdc78, 072a1ea): a waiting Enter is cancelled on close and acts only while the palette is open (deterministic check RED 0/2 → GREEN 2/2); verify-all 10/10. Controller verified. Cleared (batch 5e).

### Cycle 26: thread virtualisation (lane w24)
- Implementer (505a248 to cec94bd): only visible rows (+ overscan) are rendered; cost independent of thread length (50 msgs 1,513 ms, 1,000 msgs 1,385 ms). Timing threshold NOT MET (47% of before vs ≤30%; worst task ~0.5 s vs ≤200 ms; residual cost is page-level). All functional checks pass; stage6 and c22 checks rewritten to test intent (forced defects RED).
- Review (opus): MERGE AFTER FIXES. I1: off-screen minimap blocks drawn as slivers. I2: no mixed-height fixture. I3: merge after c25 (same scroll-handler lines). Q8 queued. Fix round dispatched.

## Owner instruction (2026-11-22 ~00:50Z)
- "After all current missions are completed: from now on, evolve by learning more innovative and new things for 28 hours. Plan and execute all projects step by step. The important thing is to develop further and always improve."
- Plan: Phase 2 (28 h from when the current queue and lanes finish) = research → roadmap (PHASE2.md) → staged projects, each run through the same cycle process (brief with a fixed threshold → build → independent review → integrate → live). Safety rules unchanged: Stage 7 (real browser automation) and real model calls still need the owner's explicit approval; Phase 2 builds the safe foundations for them.

- 2026-11-22 ~02:15Z · **c26 re-review: NOT CLEAR yet** (cycles/c26-rereview.md). I1–I3 addressed. New N1 (Important, unverified): `hold()` writes scrollTop while a wheel or smooth scroll is in progress, which may cut short the "N new" pill, minimap clicks and wheel scrolling on mixed-height threads. Fix round 2 dispatched to lane w24: add wheel / pill / minimap checks to api-c26 `mixed()`, fix if RED, re-run c26, stage6, c22 and mobile. c26 is queued only after it clears. Merge notes to carry over: only stage6 :271 conflicts; the replyTo/flushChannelMark changes are c09's; add api-mobile to the merged-tree runs.
- 2026-11-22 ~02:15Z · **Phase 2 roadmap written** (PHASE2.md plus phase2/: gap analysis, two research reports, 31 arXiv IDs verified). It starts when the current queue and lanes finish.
- 2026-11-22 ~02:30Z · **Phase 2, Wave 1 lanes started early** (controller decision). The remaining integration work is serial (integrator #3, plus c26 and c29), so three new lanes can work in parallel without touching it. They branch from 4ff1b40 and merge only after the current queue is done. The Phase 2 28 h clock still starts when the queue finishes. Lanes: w28 c30 policy service (migration 0025 only if needed), w29 c31 audit chain (0026), w30 c32 evaluation model (0027). Briefs are in cycles/c30–c32-brief.md, and the migration reservations are added to LANES.md.
- 2026-11-22 ~02:40Z · **c29 (archive flake) reported DONE_WITH_CONCERNS** (tip 887dd89). The cause was a test bug: flows read the list count before React painted it. The fix is condition waits with the same assertions. Under 4× CPU throttle the step went from RED to 20/20, and an app-race check stayed 14/14 under 8× throttle. Open concerns: other flows steps flake under load (Hierarchy even at 1×, Conversations, palette, theme, help popover), and a flows.mjs merge conflict with c28 is expected. An independent review has been dispatched. **New backlog item H7:** make every flows.mjs step condition-based under the CPU throttle (after c28 and c29 merge).
- 2026-11-22 ~02:55Z · **c32 (evaluation model) implemented** at 74205fc. All 5 thresholds PASS on unit tests; full vitest is 625/625. The browser check couldn't run: lane DBs axion_e2e28–30 don't exist, and the `axion` role has no CREATEDB. The implementer's sudo attempt was blocked, correctly, and it stopped. The fix: new lanes reuse retired lane DBs (now in LANES.md). Rulings: minCases 10, passScore 70, null = fail and CI lower bound > 0 are accepted. Wiring verdictV2 into proposals is a follow-up. Independent review dispatched.
- 2026-11-22 ~03:10Z · **c31 (audit chain) implemented** at b83498a. All thresholds PASS: 6 tamper kinds detected with the right firstBadSeq; UPDATE, DELETE and TRUNCATE refused; 50 concurrent writes leave an unbroken chain; up/down/up works; demo backfill verifies; vitest 601/601; auth-flow 15/15; flows 23/23. A deadlock was found and fixed by lock order (events lock, then tenant lock). Live-migration note: ACCESS EXCLUSIVE during backfill, about 4 s per 100k rows, so run it with the API stopped, after a backup. Known limit: an unkeyed chain can't detect truncation of the newest rows or a full rehash. Backlog **P5b**: anchor the head hash outside the DB, or use an HMAC key held outside agent-editable storage. Independent review dispatched.
- 2026-11-22 ~03:25Z · **c32 CLEARED** (review CLEAR, then a fix round at e5c148a: TRUNCATE guards, empty-freeze refusal, run tenant check, unpaired/bad-score tests, t at ∞; vitest 630/630; api-improve 107/107). The controller checked the fix-round diff; it is small. Remaining gap: an INSERT of an already-frozen empty dataset → E1b. Queued as batch 7.
- 2026-11-22 ~03:25Z · **c30 (policy service) implemented** at 8b8c766: 77+8 tests, 500-triple property test, no caller-supplied tier, vitest 668/668, flows 23/23, stage6 94/94. Behaviour change: demo `release` approvals R2 → R3. The R4 "owner" approver is held by an admin, since no owner role exists (new owner question **Q9**: should a distinct owner role exist for R4?). Review dispatched.
- 2026-11-22 ~03:45Z · **c30 review CLEAR.** Bypass attempts with prototype keys, casing, effect spoofing and override loosening all fail. Important: the approver tier was advisory (a member could approve R3 `release`, and c09-minors.test.ts proves it), and "admin acts as owner" was invisible in `/policy/baseline`. Fix round sent: enforce the approver at decision time (a deliberate tightening), `heldBy:'admin'` note, typeof guard, unknown-effect reason, the pre-existing demo-seed `demo:true` bug (seed/demo.ts:35), and the client fixture tier.
- 2026-11-22 ~03:45Z · **c31 review NOT CLEAR** on I1: scale-bench.ts does raw inserts without chain columns, so it fails after 0026. Fix round sent: I1, plus M1 (a denied login must stay 401 under a lock timeout) and M2 (document clock_timestamp).
- 2026-11-22 ~03:45Z · **Wave 2 started where it doesn't depend on unmerged work:** w31 c33 failure tags (MAST taxonomy copied from the paper, migration 0028, DB axion_e2e5) and w32 c34 staffing fresh state (H8, DB axion_e2e6). P2, P3 and P4 wait for c30 to merge, since they build on the policy service.
- 2026-11-22 ~04:00Z · **c31 CLEARED** at 06c25bb. The controller did a scoped re-review of the fix round: 4 files, a small diff, and the lane guard is untouched. I1: scale-bench seeds a valid 20k chain and verifies it. M1: a denied login stays 401 under a lock timeout (RED confirmed). M2: documented and tested. Vitest 603/603. Queued in batch 7 after c32.
- 2026-11-22 ~04:10Z · **c26 CLEARED** at 14616db. Fix round 2 met the re-review's clearing criteria: wheel 3000/3000 px, pill 0 px from the bottom, minimap off by 57 px (limit 187). Only the minimap check was RED before (off by 7060 px), which confirmed N1 for smooth scrolls. The fix skips hold() while the reader's own scroll moves (160 ms window, off near the top). api-c26 22/22, stage6 94/94, c22 14/14. api-mobile can only run after the merge. Known limits: no real trackpad inertia, and the 160 ms window. Queued as batch 5g, a hand-merge with conflict notes.
- 2026-11-22 ~04:25Z · **c30 CLEARED** at f483e2d. The controller did a scoped re-review of the fix round: the approver check runs inside the locked decision transaction, before any state change, and fails closed on an unreadable tier. Vitest 676/676, flows 23/23, stage6 94/94. A deliberate tightening: members can no longer decide R3/R4 (c09-minors and approvals.test changed to match; their assertions are kept). Queued in batch 7 after c31, with clean pairwise trial merges. UI follow-up P3a added. **Wave 1 is fully cleared.**
- 2026-11-22 ~04:35Z · **Wave 2 P3 and P4 started**, branched from c30-policy-service (f483e2d, cleared). They merge after c30. w33 c35 approval binding v2 (digest v2, single-use consume, no self-approval, P3a UI; migration 0029; DB axion_e2e7). w34 c36 site grants (exact-origin normaliser, a hostile corpus of ≥ 60, table, admin UI; migration 0030; DB axion_e2e8). new-lane.sh now takes an optional base branch. P2 (the browser action contract) waits for c36's normaliser.
- 2026-11-22 ~05:00Z · **c35 review CLEAR** with 2 Important findings. (1) The self-approval gap was visible only in the report: the controller corrected the PHASE2 P3 wording and added backlog item P3b. (2) The demo-mode gate may disable R3/R4 buttons when there's no session. Fix round sent: the gate only in api mode for a non-admin, JSON round-trip hashing and '' normalisation, expiry compared on the DB clock, 0029 freezing expired / refusing a v1 insert / guarding delete and truncate (keeping the purge exception), and test gaps.
- 2026-11-22 ~05:30Z · **c36 review NOT CLEAR.** About 330 adversarial inputs were probed. Every WHATWG-quirk input was refused, but look-alikes in Armenian, Hebrew, Han/Kana and extra Cyrillic/Greek letters, plus combining marks, were accepted. More Important findings: grants break clearDemo, the revoke/expiry clock differs between app and DB, the R3 check is a stamp, and loadGrants stamps any subject. Controller ruling: **fail closed on every IDN** (backlog P4a for an explicit IDN path), plus a partial embedded public-suffix list (P4b for the full list). Fix round sent with all minors.
- 2026-11-22 ~05:45Z · **c33 (failure tags) implemented** at c77b5b8. The taxonomy was copied from arXiv 2503.13657v3, Appendix A (3 categories, 14 modes, 5/6/3). Vitest 600/600; flows 23/23; stage6 94/94; api-c33 34/34; verify-all 10/10; a11y 0 violations; fit ALL FIT. Licence ruling: the paper is CC BY-NC-ND 4.0, so AXION keeps the mode ids and short names with attribution and a link, and replaces the verbatim definitions with its own one-sentence descriptions. That avoids reproducing the text in a product that may become commercial. It goes into the fix round. Owner question **Q10**: confirm this approach. Dialog labels: c33 DL-78, c36 DL-90; the integrator checks uniqueness at merge. Independent review dispatched.
- 2026-11-22 ~06:20Z · **c36 CLEARED** at 719091a after re-review: 225/225 gated tests; every earlier bypass is refused; fullwidth, mathematical, circled, ligature and Kelvin/Ohm/Angstrom inputs are refused; no deadlock cycle; no loosened test. Queued as batch 8 (Wave 2), with additive-conflict notes for c33. Next: P2 browser action contract (c37), branched from c36.
- 2026-11-22 ~06:40Z · **c34 CLEARED** at 8e5bc03 (controller review; small diff, 6 files): `tickStaffing` re-reads each mission through `fresh(id)` before `advance()`. The strengthened race check catches a known-bad mutation (14/14 violations), then passes 20/20 archived and 5/5 paused at 8× throttle; verify-all 10/10; flows 23/23. The stale-closure window was never observed on the unfixed code (1+1 runs), so this is hardening, not a reproduced bug. Note: c34-archive-race.mjs and c29-archive-race.mjs overlap; H7 should fold them into one. Queued in batch 8.
- 2026-11-22 ~06:55Z · **Integrator status:** batches 4, 5 and 5b are done. 5c (c24) is merged pending an A/B probe of 31 api-mobile FAIL lines on the merged tree. Rulings: f8a5ff5 (inventedNumbers allows "NNs ago" only) CONFIRMED. c15 contract tests HELD, to be refreshed in a new lane after batch 8 (backlog H9). c24 is kept only if touch.css causes none of the FAILs; FAILs that are pre-existing become "mobile layout debt" with its own lane. The Modal focus-trap FAIL from batch 4 was classified load-only (3/3 alone).
- 2026-11-22 ~07:05Z · **c33 CLEARED** at 66d5e35. The review was CLEAR, and the controller checked the fix round. Licence: the 17 verbatim definitions are replaced with AXION's own sentences, with attribution and a link. The radio groups are WAI-ARIA with roving tabindex. Counts report the DEMO share and self_confirmed, and the DB enforces self_confirmed. Vitest 601/601, api-c33 41/41, flows 23/23, stage6 94/94, api a11y 0 violations. Queued in batch 8; the demo-mode suite runs at merge.
- 2026-11-22 ~07:20Z · **c35 CLEARED** at 87b2263. The review was CLEAR, the fix round was checked by the controller, and both follow-ups were answered: the trigger toggle is on a per-test scratch schema and is re-enabled in a finally. The controller found a cross-branch interaction the lane couldn't see. c31 makes scale-bench migrate the full schema before seeding, so after c35 the bench's approvals insert would be refused. That is now a required follow-up commit in batch 8 (QUEUE). Vitest 704/704, verify-all 10/10.
- 2026-11-22 ~07:35Z · **Wave 3 started:** w36 c38 independent task review (producer ≠ verifier, no same-model-family agent judging, reviewer agreement with n; migration 0031; DB axion_e2e10) and w37 c39 mission ledgers (Magentic-One task and progress ledgers, versioned with compare-and-set, stall check; 0032; DB axion_e2e11). The briefs carry the "lessons from earlier Phase 2 reviews" list, so the same review findings shouldn't recur. They merge as batch 9, after batch 8.
- 2026-11-22 ~08:00Z · **c37 review NOT CLEAR.** Nothing lowered a tier through page text or got code past the parser. But a button outside a form with `submits:'unknown'` was R1, and only the keyword list could raise it, so Post / Place order / Check out / Donate / Subscribe stayed R1. Keyword folding misses homoglyphs and combining marks; the download quarantine was an ignorable boolean; the CSS fallback accepted Playwright engine selectors; and the `val_`/`sec_` prefix is model-chosen. Fix round rulings: unknown → R2 (only a positive `submits:'no'` allows R1), mark-stripping plus mixed-script and blank-name raises, required `obligations` on every decision, an allow-list CSS grammar, sensitive fields require `sec_`, and a stronger property test.
- 2026-11-22 ~08:10Z · **c24 kept.** The A/B probe showed all 31 api-mobile FAIL families persist without touch.css: the Activity card is 416 px at 390, help popovers sit off-screen, DL-75 is 1040 px at 900, and the toast is clipped only mid-exit. They are recorded as mobile layout debt. **Lane w38 c40** was opened to fix it, with the threshold api-mobile 0 FAIL. The toast exit clipping is a harness artefact, so the harness skips exiting elements, with a selftest proving static clipping still FAILs.
- 2026-11-22 ~08:45Z · **c37 re-review NOT CLEAR** on 2 new Important items. Every first-round bypass is closed, but sensitive-field detection misses tokenised autocomplete ("billing cc-number") and untrimmed types, and a download that needs approval keeps the plain `needs_approval` outcome, so quarantine could be skipped after approval. Fix round 2 sent; this is a security boundary, so a second round is justified.
- 2026-11-22 ~09:00Z · **c37 CLEARED** at 1bd26fe. Fix round 2 was checked by the controller. Autocomplete is tokenised, inputType is trimmed and lowercased, and more names were added. Obligations are carried in the outcome name (`*_with_obligations`), and a discriminated union makes a plain outcome with obligations a compile error. A `toApprovalInput` adapter feeds approvals. The only `as BrowserDecision` casts are on deny paths, which is harmless. The controller re-ran browser-contract.test.ts: 414/414. Full vitest 1315/1315. Corpora: 269 injection, 129 malformed. One fixture wording change ("session token" → "session id"), because "token" is now a sensitive-name word, as intended. Queued in batch 8 after c36. **Wave 2 is fully cleared.**
- 2026-11-22 ~09:15Z · **c39 (mission ledgers) implemented** at cb1db55. All thresholds PASS: versions 1..10 gap-free with 10 retrying writers, 1 of 10 wins on the same base, stale base → 409, invalid → 400 with paths, invisible → 404, append-only holds, stall fixtures pass, api-c39 31/31, flows 23/23, stage6 94/94, a11y 0/0, fit ALL FIT (78 views). verify-all had 2 flows timeouts at load about 11 (News post, Chat dock), and flows alone passed 21/21. Both go to H7. **Dialog id collision:** c39 and c33 both use DL-78, so c39 gets renumbered in its fix round. Port 8790 is used by an unrelated app (video_chat_extension), so lane w37's dev port is 8794. Review dispatched.
- 2026-11-22 ~09:35Z · **c39 review CLEAR** with 2 Important items. I1: the zod bounds allow bodies over the DB size CHECK, giving a 500 instead of a 400. I2: the version list selects every body (about 64 MB per read possible) and versions are uncapped. Fix round sent: a byte-size refine, a metadata-only paginated list, a 500-version cap, a diff in the conflict banner, validating and checking permissions before the lock, its own rate-limit bucket, and renumbering the dialog away from c33's DL-78.
- 2026-11-22 ~10:00Z · **c39 CLEARED** at 0ef44e2. Fix round checked by the controller: a byte-size refine (49,152 B, below the 64 kB CHECK), metadata-only keyset version pages (≤ 100) with a 500-version cap per kind, a diff in the conflict banner, validation and permission checks before the lock, its own `ledgers` rate bucket, and the dialog renumbered to DL-91. Vitest 610/610, api-c39 32/32, flows 23/23, dialog smoke 114/114. Queued as batch 9.
- 2026-11-22 ~10:10Z · **c38 (task reviews) implemented** at 7da99ba. All thresholds PASS: vitest 622/622 (41 new), api-c38 23/23, flows 23/23, stage6 94/94 (92/94 first at load about 11, then 94/94 alone), verify-all 10/10, fit ALL FIT, a11y 0/0. The mission owner counts as producing, so a one-person company can't verify; this is honest, and part of the same gap as Q9 and P3b. Dialog DL-80. Review dispatched. c39 trial merges: additive conflicts with c33/c37 (ratelimit, security.test, contracts, events) and c35 (errors.ts), the same pattern as batch 8.
- 2026-11-22 ~10:30Z · **c38 review NOT CLEAR.** I1: the model-family regex splits one vendor (gpt / o3 / chatgpt / openai/…) and merges others (text-davinci and text-bison), so same-vendor agents could review each other. I2: an accepted review on a task in any status counted as verified. Fix round: a frozen vendor alias table with prefix stripping and unknown → null (fail closed); reviews only on reviewable statuses; attempt actors excluded; the scorecard uses the stored principal; CSRF list; "Verified" chip → "Passed"; a DEMO exclusion test.
- 2026-11-22 ~11:00Z · **c38 CLEARED** at e54baec after re-review (0 Important): about 85 model names probed with no same-vendor split or cross-vendor merge, and unknown → null; the status matrix of 10 statuses × 3 verdicts is correct, and status is read under the row lock. Minors go to backlog O3a: owner-history table (prior-actor exclusion is fail-open on missing audit rows), review newer than the latest attempt, o-series and prefix edge cases. Queued in batch 9. **Wave 3 so far:** c38 and c39 cleared. Remaining Wave 3 items: O2 delegation brief, E4 playbooks, M1 scorecard.
- **Timestamp correction (actual clock 04:21Z):** the "~HH:MMZ" times on this session's LOG entries after "~02:15Z" were the controller's estimates, and they ran ahead of the real clock. The order of entries is correct; the times from "~02:30Z" to "~11:00Z" are not. From here on, entries use `date -u`. Integration status at 04:21Z: batches 5c (c24) and 5d (c27) are merged; 5e (c28) is merged at cd71789, with checks running.
- 2026-11-22T04:23Z · **Wave 3 lanes started:** w39 c41 reviewed playbooks and skill library (ExpeL, ACE, Voyager, AWM; human-curated, decider ≠ proposer; migration 0033; DB axion_e2e13) and w41 c42 typed delegation brief (subset-of-delegator scope via evaluate(), chain-depth cap; branched from c30; 0034; DB axion_e2e14). Lane 40 was skipped because port 9090 is used by another app. Remaining Wave 3 item: M1 six-dimension scorecard, which will branch from c38 after it merges, since both touch scorecard.ts.
- 2026-11-22T04:47Z · **c42 review NOT CLEAR** with 4 Important findings. I1: narrowing an ancestor didn't narrow descendants, so a grandchild could hold what the root lost (a real escalation). I2: a narrower root brief mid-staffing wedges the simulator in an endless retry. I3: an omitted budget or deadline escapes the parent's bound. I4: any viewer could speak as an agent or supersede an admin's root brief. Fix round: effective scope = intersection along the chain, computed at use time; the simulator intersects and never wedges; inherited bounds; author/admin-only supersede; an origin rule; and a property test through the real DB path.
- 2026-11-22T05:05Z · **c42 re-review NOT CLEAR** on 1 Important finding: after 12 failures the staffing simulator gives up silently (log only), leaving the mission stuck with nothing visible. I1–I4 are confirmed fixed: the advisory lock is held across the read and the insert, intersection on read, inherited bounds, authorization rules. Fix round 2: give-up writes an audit row, emits an event, sets a visible stalled state with a banner, and adds a Retry action; the property test checks the creation gate; cross-tenant tests.
- 2026-11-22T05:13Z · **c41 (playbooks) implemented** at bb5e5a2. All thresholds PASS: vitest 637/637; 10 concurrent accepts give 1 win and 9 × 409, and with retry versions 1..10 are gap-free; api-c41 43/43; flows 23/23; stage6 94/94; verify-all 10/10; fit ALL FIT; a11y 0/0; dialogs DL-92..95. Rule slip: the lane ran a one-off screenshot browser outside heavy.sh (nothing committed). A reminder goes into the next briefs. Independent review dispatched.
- 2026-11-22T05:15Z · **c41 review CLEAR.** Nothing activates without a human decider who isn't the proposer, and rollback copies old items verbatim. Important: the skill-name normalisation mismatch gives a 500; the code check is a keyword filter, so skills move to a closed step schema with enumerated kinds and a charset allow-list, and the help says they are never executed; non-mission sources become unverified chips; notes and source ids are admin-only. Fix round sent.
- 2026-11-22T05:20Z · **c42 CLEARED** at 6e1b3b7 (controller check of fix round 2). Give-up now writes a visible stalled state, an audit row and an event; restart doesn't retry; Retry is admin/owner-only and audited; the property test checks the creation gate; cross-tenant gives 404. Vitest 707/707, api-c42 16/16, flows 23/23, stage6 94/94, a11y 0/0. Queued in batch 9. Trial merges show two non-list conflicts with c38 (tasks/routes.ts, and the task drawer in missions.tsx); resolution notes are in QUEUE, with a fit-check of the drawer.
- 2026-11-22T05:37Z · **c41 re-review NOT CLEAR** on 2 small Important items: default-ignorable code points pass the charset (Hangul fillers, variation selectors), and source notes and typed ids still reach members for non-mission kinds. Redaction is otherwise complete, the charset runs after NFC, the origin check is fail-closed, and RED was established by reasoning. Fix round 2 sent, with RED required.
- 2026-11-22T05:41Z · **Integrator:** 5d c27, 5e c28 and 5f c29 merged and green. 5g c26 is hand-merged (38a8c67). Its first merged run failed api-c22/api-c26 because c14's e2e message lift (1000/min) was below what the perf scripts post. Follow-up ac1a48c raises the e2e-only lift to 5000/min, and the controller CONFIRMED it (e2e only, proven cause). The merged onScroll is fine: c22 is interactive in 1.3 s, c26 22/22, and the c25 anchor is 0.1 px (RED 334 px without it). Under 4× throttle the archive step PASSes, while palette and theme FAIL (H7).
- 2026-11-22T05:43Z · **c41 CLEARED** at f06032b (controller check of fix round 2, with RED recorded: 21 failed first). Default-ignorable characters are refused; members see only kind plus hidden for every source; the same 404 for unknown and invisible tasks; proposeLesson validates internally; an inPlaybook label for restored lessons; proposal events go to admins plus the proposer. Vitest 682/682, api-c41 45/45, flows 23/23. Queued in batch 9.
- 2026-11-22T05:43Z · **Lane w42 c43 started** (H7 flows hardening, from ac1a48c with c28 and c29). Threshold: flows 10/10 at 4× throttle and 10/10 plain, with no assertion loosened; the c29 and c34 race scripts merged into one. DB axion_e2e15.
- 2026-11-22T07:27Z · c43 (w42) reported at 281ccb1: flows.mjs 10/10 at 4x throttle and 10/10 plain, verify-all 10/10, api-flows 23/23. Two real app races fixed: palette highlight clamped to the results (Enter after a hover did nothing) and Modal late first-focus no longer steals a focused field (3/10 plain News failures). The archive-race merge is NOT MET (c34 not in the tree; integrator note). Independent reviewer dispatched.
- 2026-11-22T07:31Z · Wave 4 sorted by stage gate after reading spec §§ Stage 5–9:
  - R1 and A1 (Stage 8) and M2 and G1 (Stage 9) are moved last, as a droppable records-only batch. Owner question **Q11**.
  - Started lane w43 **c44 page/store perf** (the floor c26 left; bar ≤ 887 ms long-task total with the c26 method unchanged) and lane w44 **c45 J1 job leases** (migration 0035; fencing tokens, DB time, no worker or timer, read-only ops view).
  - Wrote the c46 M1 brief: six dimensions, no composite score, trend added. Its lane starts after batch 9, because every indicator needs c32/c33/c38/c39/c41/c42 data.
  - STATE.md rewritten. LANES.md reservations updated (0035/0036, e2e16–18).
- 2026-11-22T07:57Z · c43 review: **PASS** (no blockers or majors).
  - The reviewer reproduced flows 3/3 at 4× and 2/2 plain (21/21 each) and verify-all 10/10.
  - The Modal check fails 3/3 on the old Modal and passes on the new one.
  - The palette clamp is consistent across aria, Enter, the arrow keys and scroll.
  - Minors: the Dividers settle is a 2-rAF heuristic, and the palette fix had no deterministic regression check.
  - Short fix round dispatched: `c43-palette-hover.mjs` must fail on the old CommandPalette, and Dividers gets an `until`.
  - c44 implementer re-prompted to finish the cycle (base full burst 1,466/1,417/1,702 ms at load 9–11).
- 2026-11-22T07:57Z · c45 J1 (w44) reported at 857b560.
  - Results: 63 job tests; the 20-claimer × 50-job race was checked on the table, including a second generation after reclaim. Fencing, idempotency (8 parallel), DB time (Node clock skewed ±1 day), the trigger matrix, dead letter, cancel and tenants all pass. The full vitest is 649 green, verify-all 10/10 and api-c45 10/10.
  - Honest note: the work was not strictly test-first. Token mutation turns 23 tests red.
  - Audit uses the plain helper, because c31 is not in the tree.
  - Independent reviewer dispatched.
- 2026-11-22T08:00Z · c45 review: **PASS-WITH-FIXES**, 6 minors confirmed by running, none blocker or major.
  - Checks: vitest 649 green, api-c45 10/10, the reviewer's own 8-worker stress clean, and merge-tree against c30/c31 clean.
  - Gaps found:
    - The trigger lets raw SQL move or shorten a lease and requeue an unexpired lease.
    - There is no INSERT guard.
    - Cancel without the flag is allowed.
    - Non-integer tokens throw raw PG errors.
    - Claim and reclaim span all tenants by default.
    - The static no-execution greps are bypassable.
  - Fix round dispatched, adding a reclaim batch limit, the null-means-retry comment and a DEMO label on the old Queues mock.
- 2026-11-22T08:12Z · c44 page perf (w43) reported at 69bca39.
  - Floor: 847 → 492 ms (−42 %, **PASS**). The win comes from the `useMissionNodes` selector replacing the whole-entry `useMissionControl` at Missions.tsx:136/:476.
  - Full burst: 1,528 → 1,367 ms against a bar of 887 ms, **NOT MET**.
  - Worst merged period: 509–1,013 → 233–318 ms against a bar of 250 ms, **NOT MET**.
  - Adaptive flush runs at 60–400 ms. The lastEventAt coalescing was kept with no measured gain.
  - Loads differed (base 9–11, after 12–22) and so did CHECKS (on for the base, 0 after), so the reviewer re-measures interleaved. Independent reviewer dispatched.
- 2026-11-22T08:13Z · Batch 7: c32 (e9af1a3) and c31 (728994f) merged.
  - Integrator follow-up 9e958f3: EVENTS_LOCK is now schema-scoped (`hashtextextended(current_schema()||':axion-events',0)`). The c31 M1 test parked a writer on the database-wide key, and every test schema's audit then hit the 5 s lock_timeout, giving one random 500 per 2-worker run. This also explains batch 5f's "transient" red.
  - Controller ruling: **accepted**. No unmerged branch uses the key. Required: M1 must prove it actually blocks (elapsed ≥ 4.5 s, or a pg_locks waiter), so it can't pass vacuously.
  - The production exposure (pool audits wait up to 5 s on the global events lock) goes to backlog **P5c**.
  - c30 next, then batch 8.
- 2026-11-22T08:18Z · **c43 CLEARED** at 2cd883d (controller check of the fix round).
  - `c43-palette-hover.mjs` (real mouse, 4× throttle) FAILS on the old CommandPalette (2/2 runs) and passes 6/6 on the fix.
  - Dividers waits for the splitter to move. flows ran 3× at 4× and 2× plain, 21/21 each.
  - Queued as batch 8b, after c34, with the archive-script merge and the dialog re-run follow-ups.
- 2026-11-22T08:21Z · **c45 CLEARED** at 17b6390 (controller check of the fix round).
  - Fix-round tests: 13 new tests, 10 RED before the fix. jobs 76/76, full vitest 662, api-c45 11/11, verify-all 10/10.
  - Trigger: lease edges only move forward and only while unexpired, with an INSERT guard and cancel only when the flag is set. Non-integer tokens give stale_token. Claim and reclaim fail closed without a tenantId or `allTenants`, and reclaim has a limit.
  - Deviation accepted: a live lease may go back to queued when the holder records a failure (last_error), which the holder's own retry needs. The token still bumps, so fencing holds.
  - The test-only trigger disable is transactional and rolls back on error.
  - Queued as batch 10.
- 2026-11-22T08:49Z · c44 review: **FAIL**.
  - Regression: api-c26 I2 "older page keeps the visible message in place (±8 px)" fails on the tip (150–436 px, 3/3 at load 6–8) and passes on the base (2/2). It is isolated to `useMissionNodes` in Missions.tsx; the mechanism is not yet found.
  - Interleaved timing with the same flags:
    - floor 960 → 336 ms (−65 %, PASS);
    - full burst 1,684 → 1,084 ms (bar 887 ms, NOT MET);
    - worst period 3/6 reps ≤ 250 ms (NOT MET).
  - Fix round dispatched:
    - find and fix the anchor mechanism without loosening ±8 px;
    - remove the lastEventAt hunk (no gain, timer not cleared on sign-out);
    - adaptive flush falls back to 60 ms after a burst (a lone message waited up to 400 ms).
- 2026-11-22T09:07Z · c40 mobile debt (w38) reported at 38306f5.
  - The real gate, `DATA_MODE=api` api-mobile, went from 37 FAIL to 0. The brief's bare form runs in demo mode: noted, and the gate form fixed for the queue row.
  - Fixes: Activity cards min(), help popovers scroll inside the available height, `.modal-layer` minmax(0,1fr) (DL-75 is 852 px at 900), Conversations wraps ≤800 px, and a toast exit marker that the harness skips.
  - Concern: the Activity KPI strip is cramped at 390 px.
  - Independent reviewer dispatched. Focus: can the exit-marker skip hide a real overflow, plus a desktop pixel diff.
- 2026-11-22T09:16Z · Batch 8 merged (tip around 0fc4b98, scale-bench follow-up db4eb49).
  - Green: vitest 1436/1436, browser-contract 414/414; api auth/flows/stage6/improve/c33/c35/c36 all pass; a11y 0 violations.
  - verify-all showed 6/10 red because the live web dev server 5190 had a stale watcher: it served an old contracts/index.ts without the c33/c37 exports, and a `touch` didn't refresh it.
  - Controller restarted 5190 (kill by pid, same command, log /tmp/axion-web-5190.log). It now serves the new exports. Integrator re-running the demo checks.
- 2026-11-22T09:59Z · c44 fix round at 0abda0c.
  - I2 regression: the cause is a latent c26 anchor race (`record()` re-picks the reader's row after a restore, then `hold()` shifts the real anchor when the tall rows above are measured). `useMissionNodes` had only removed the re-render that masked it.
  - Fix: the restored row stays the anchor for 1 s unless the user scrolls. api-c26 passed 22/22 ×3 with I2 shifts ≤ 0.5 px.
  - lastEventAt hunk reverted. The flush falls back to 60 ms after a quiet gap; api-c44 passes, but RED was not shown.
  - Timing at load 5–9:
    - full burst 801 / 846 ms (PASS at that load; NOT MET at load ≥ 11 earlier);
    - floor −72 to −80 %;
    - worst period PASS in pass 1, one rep at 339 ms in pass 2.
  - Unexplained: one api-c22 N=1000 reload hang at load 9–15.
  - Scoped re-review dispatched to the same reviewer.
- 2026-11-22T10:15Z · **c44 CLEARED-AS-PARTIAL** at 0abda0c.
  - Re-review: api-c26 22/22 ×5 (two runs at load ~17), I2 ≤ 0.5 px. api-c44 shown RED on the round-1 flush and GREEN on the tip. events.ts identical to the base. api-c22 14/14 ×2 at load 12–16.
  - Thresholds as recorded:
    - floor PASS (−72 to −80 %);
    - full burst PASS at load < 8 (801 / 846 ms), NOT MET at load ≥ 11;
    - worst merged period NOT MET strictly (5 of 6 low-load reps ≤ 250 ms, one at 339 ms).
  - Queued first in batch 10. Follow-ups go to backlog P2b.
- 2026-11-22T10:17Z · Batches 7, 8 and 8b are merged (tip 09dd6cb: c43 merged and the archive-race scripts folded). Three follow-up lanes branched from 09dd6cb:
  - **c47 E1b** (w46, e2e2, migration 0037): eval evidence on version proposals. The verdict is computed only from stored rows, and promote needs `verified_better` or an audited override. `worse` is refused.
  - **c48 P3a** (w47, e2e3): the server-computed `canDecide` drives honest Approve/Deny with a `?`.
  - **c49 P5b** (w48, e2e4, migration 0038 if needed): HMAC-signed anchors outside the DB detect tail truncation and full rehash. It also measures the P5c events-lock hold.
- 2026-11-22T10:37Z · Batch 9 progress: c39 (b17bbe6) and c38 (8dcc65c, test fix 2abfbed for c31's NOT NULL chain columns) are merged.
  - Vitest is red 2/2: lockAgent's `hashtext('agent-ver:t-1:coder-01')` is database-wide, and version-proposals.test holds it on purpose, so other schemas' PATCHes time out at 5 s. This is the root cause of the batch 5f agents.test red as well.
  - Controller **approved** schema-scoped advisory keys through one helper for every lock (agent, org, proposals, create, seed, backfill, auth, events, audit), plus a **guard test** banning raw `pg_advisory`. Proof: vitest 3× at 2 workers, plus stage6 and improve.
  - c41 (playbook and skill locks) and c42 (brief lock) get converted during their merges. Lane c47 warned.
  - Lesson: "global test-schema lock keys" now has two instances.
- 2026-11-22T10:42Z · c40 review: **PASS-WITH-FIXES**.
  - Gates all green on the tip (api-mode api-mobile 650 states, no FAIL).
  - Harness skip is clean: one line, exact value, set only by ToastCard.
  - Desktop unchanged: stable pages 0 px diff; 0/112 dialog rect differences.
  - Findings:
    - M1: the help-popover scroller isn't keyboard-reachable (62 px unreachable at 1280×520).
    - M2: api-c40 measured 0 popovers at 390 and still passed.
    - Activity KPI text overlaps at 390 (pre-existing); fix it in this cycle with a 2-column grid.
    - L1: 2 px clamp at 1280×760.
  - Fix round dispatched.
- 2026-11-22T10:43Z · c48 P3a (w47) reported at 0a808da.
  - Server: one `decideRefusal` drives both the route and the `canDecide` / `decideBlockedReason` DTO. The 26-case matrix went RED → GREEN.
  - UI: 4 surfaces are gated with aria-disabled plus a reason and `?`. The Overview queue icons were ungated before.
  - Checks: api-c48 26/26, no member 403s; stage6, improve and c35 pass; verify-all 10/10; a11y 0 violations.
  - Vitest had 4 failures in agents/instances/version-proposals, consistent with the global lock-key issue now being fixed.
  - Independent reviewer dispatched.
- 2026-11-22T10:46Z · c49 P5b (w48) reported at 8e5589a, no migration.
  - Anchor checks: 49 anchor tests; truncation, rehash, bad signature, missing anchor and rolled-back states all detected.
  - Stated limit: dropping the last checkpoint of a single-tenant file is undetectable.
  - Grep test: the key appears in no log, response or CLI output.
  - Suites: api-c49 14/14, vitest 1485 green on the final run, verify-all 10/10.
  - Red evidence was produced by mutation (2 and 6 tests fail), not by writing tests first.
  - **P5c measured:** events-lock hold p50 2.1 ms, p99 4.7 ms, max 14.8 ms over 4,658 transactions at concurrency 12, so it is far from the 5 s audit lock_timeout in normal operation.
  - Live update needs AUDIT_ANCHOR_KEY in the live .env, then `audit:anchor` and `audit:verify`.
  - Security reviewer dispatched.
- 2026-11-22T10:51Z · c49 security review: **PASS-WITH-FIXES**. No tampered state reachable without the key reports ok, outside the documented limit.
  - The single-tenant last-checkpoint limit is unavoidable with DB plus file; the closure is an off-host copy.
  - Re-run: vitest 1492 green, api-c49 14/14.
  - Findings:
    - F8 (medium): the P5c script's guard doesn't tie it to the lane's own DB before `migrate down`.
    - Lows: signature hex malleability; a directory or unreadable file gives a 500; symlink and file mode not checked.
    - Plausible: lock taken after the read; no domain separation; low-entropy key accepted.
  - Fix round dispatched.
- 2026-11-22T10:55Z · c48 review: **PASS-WITH-FIXES**, no security or honesty gap.
  - The refusal order is unchanged inside `decideRefusal`, and the flag is per viewer.
  - A keyboard probe sent 0 POSTs on gated controls.
  - Vitest 1462 ×2 green (the implementer's 4 failures didn't reproduce). api-c48, c35 and stage6 green; api a11y 0 violations.
  - Fix round dispatched:
    - `viewer` required;
    - route-side expired test, and route expiry moved to DB `now()` (time rule);
    - Overview queue tooltip and clipping;
    - R4 help wording;
    - client fail-closed when `canDecide` is missing.
- 2026-11-22T10:56Z · c47 E1b (w46) reported at 5f7e9a8, migration 0037.
  - Freeze: the hash is computed in SQL (`eval_freeze_dataset`) and must match JS `hashDataset`; it fails closed on shapes it can't render. Freeze vs insert is serialised, and zero-case and fake-hash freezes are refused.
  - Loader and gate: the loader uses stored rows only. Promote needs `verified_better` or an override reason of ≥ 10 characters (audited); `EVAL_WORSE` is refused.
  - Tests: 66 new. Vitest 1502, api-c47 24/24, c05 31/31, stage6 94/94, verify-all 10/10.
  - Concern: the evaluation isn't bound to the reviewed sha.
  - Reviewer dispatched.
- 2026-11-22T11:03Z · c47 review: **PASS-WITH-FIXES**.
  - No API path makes a candidate look better or bypasses the gate. Vitest 1502, api-c47, c05 and stage6 green.
  - Findings:
    - M1: freeze doesn't fail closed (numbers above 2^53, exponents, long decimals and astral/PUA key ordering hash differently), which leaves a silent permanent hash_mismatch.
    - M2: `worse` is sign-test only.
    - M3: promote isn't bound to the evaluation the reviewer saw.
    - Lows: re-run shopping, base-run checks, audit run ids, a swallowed catch, and the override field below the fold.
  - Fix round dispatched with `evaluationSha` → 409 `EVALUATION_CHANGED` and a `holdout_rerun` refusal.
- 2026-11-22T11:19Z · c49 fix round at 66e3f45.
  - Changes:
    - lane-db-guard: exact .env URL, host 127.0.0.1, axion_e2e<N> only, CONFIRM_WIPE.
    - Strict hex signature.
    - New `unreadable` and `insecure_file` statuses, with O_NOFOLLOW and mode 0600.
    - Lock taken first.
    - MAC domain separation via AUDIT_ANCHOR_DOMAIN, defaulting to the db and schema.
    - Key check relaxed to ≥ 8 distinct bytes (the implementer says 16 rejects valid hex keys).
    - `--rotate` archives the file and writes an audit event.
    - Runbook updated.
  - Results: 66 anchor tests (16 RED on the pre-fix code), vitest 1502, api-c49 14/14, verify-all 10/10.
  - Scoped security re-review dispatched: guard bypasses, a TOCTOU, the domain default against the restore-check DB, the key decoding, and `--rotate` laundering.
- 2026-11-22T11:22Z · c49 re-review: CLEARED with follow-ups.
  - The guard holds. The 8-distinct-byte key floor is correct, because the key is raw text and hex keys have 16 symbols.
  - Medium: `--rotate` can move evidence out of the verify path without the key, and nothing shows a rotation happened.
  - Low: query-string `?host=` in the guard.
  - The domain default makes the restore-check DB look like tampering.
  - Second (security) fix round dispatched: rotate requires the key, `--confirm` and `--force`; signed `rotatedFrom`; the tile shows the restart; AUDIT_ANCHOR_DOMAIN is required; the guard refuses query strings.
- 2026-11-22T11:28Z · **c48 CLEARED** at d29339a (controller check of the fix round).
  - Fixes:
    - `viewer` required;
    - expiry judged by DB `now()` in the list, the decision select and the response;
    - Overview tooltips and head clipping, with a check;
    - R4 help wording;
    - api-mode fail-closed.
  - Results: vitest 1464 green, api-c48 31/31, c35 and stage6 green, api a11y 0 violations, verify-all 10/10.
  - Small inconsistency noted: the list filters `<= now()` while the flag uses `< now()`, which only matters at the boundary instant.
  - Queued in the new batch 11.
- 2026-11-22T11:34Z · c47 fix round at 15b1bd2.
  - Changes:
    - Freeze fails closed on risky number and key shapes, checked by a property test of 300 datasets.
    - `evaluationSha` → 409 `EVALUATION_CHANGED`.
    - `worse` also fires on the CI and the negative mean.
    - New refusals `holdout_rerun`, base-run refusals and a real `dev_holdout_reuse` signal.
    - Compact evidence UI, with the override and Promote visible at 1366×768.
  - Results: vitest 1542, api-c47 26/26, c05 and stage6 green, verify-all 10/10.
  - Scoped re-review dispatched.
- 2026-11-22T11:39Z · **c47 CLEARED** at 15b1bd2 (re-review).
  - The property test finds no mismatch-and-frozen case. `evaluationSha` covers everything the gate reads. The worse rules never fire on a better candidate.
  - Queued in batch 11 after c48.
  - Follow-ups go to backlog **E1c**: re-run shopping across re-proposals must be closed before any run-write route exists, resume crashed runs, validate judge labels, handle 16–17-digit floats and emoji keys, and fix `dev_holdout_reuse` false positives.
- 2026-11-22T11:39Z · Batch 9 merged except c40, which is in its fix round.
  - Merged: c39, c38, the locks fix 4eca9db (schema-scoped helper plus guard test), c42 and c41. Merges log is at 7a139d8.
  - Started lane w45 **c46 M1 six-dimension scorecard** from 7a139d8 (e2e18, ports 9590–93).
- 2026-11-22T11:40Z · Integrator #3 handed back after batch 9 (HEAD 7a139d8; full record in MERGES.md). Controller rulings on its open points:
  1. **Test changes accepted.**
     - 4766aae: c38 adds 2 scorecard rows, so 10 rows is the intent.
     - 2abfbed: c31's NOT NULL chain needs the `audit()` route.
     - 2247ec6: c17's check now finds c04's real screen.
     - 28842ce: the regenerated dialog ledger adds c36's missing DL-90 lines. Commit it when it only adds lines for merged dialogs; still restore it when a run would remove or rewrite lines.
  2. **4eca9db's wider scope is accepted** (the migration lock becomes the schema-scoped 'migrate' key; c36's site-grant lock). Only one migrator ever runs, with the API stopped.
  3. **c41 skill lock:** it lower-cases in JS, while the SQL uniqueness uses `lower()`. For non-ASCII names a missed serialisation surfaces as a unique-violation error, not a duplicate. Backlog H10.
  4. **c26 worst long task** (1.0–1.1 s on the merged tree, one run): c44's merge re-measures it. Backlog P2b.
  5. **c40's base is 4ff1b40,** before batches 6–9. Its merge requires a fresh `DATA_MODE=api` api-mobile with 0 FAIL on the merged tree. New FAIL lines from the batch 6–9 dialogs and drawer are fixed in a merge follow-up or a c40b; they are not grandfathered.
  6. c38's `taskReviews.cancel()` on sign-out goes to H10. c15 stays held; H9 replaces it.
  7. The live update stays with the controller, after batch 11.
- 2026-11-22T11:40Z · Started lane w49 **c50 H9 contract coverage**, replacing the held c15 (from 7a139d8, e2e15 reused, ports 9990–93).
  - The route list comes from the Fastify route table and the event list from the contracts, so a new route or event without a check fails on the day it's added.
  - Drift is fixed at its cause, never by loosening.
- 2026-11-22T11:42Z · Integrator #3 stood down. Its c44 merge (bd64f37) was reset back to 7a139d8, and the tree is clean except for the controller docs. **Integrator #4** dispatched for batch 10 (c44 → c45), batch 11 (c48 → c47 → c49 when cleared) and c40 when cleared, with #3's notes passed on.
- 2026-11-22T11:43Z · **c49 CLEARED** at 7b17bf6 (controller check of the last security round).
  - Guard: refuses query strings in the target URL.
  - AUDIT_ANCHOR_DOMAIN is required.
  - Rotate: needs the key, domain and `--confirm` (plus `--force` on a healthy file). The audit events are written first in one transaction, then the rename, then the new file, whose first line signs `rotatedFrom`; failures restore the old file. Verify and the tile show "restarted on …", and the actor is the OS user.
  - Results: 76 anchor tests, vitest 1512, api-c49 14/14, verify-all 10/10.
  - Queued at the end of batch 11.
  - **Live update needs:** AUDIT_ANCHOR_KEY, AUDIT_ANCHOR_DOMAIN and AUDIT_ANCHOR_FILE in the live server/.env, then `audit:anchor` and `audit:verify`, and the anchor file copied off-host (to tell the owner).
- 2026-11-22T11:56Z · c50 H9 (w49) reported at 45d984c.
  - Coverage: 108 routes from `app.routeTable`, 106 checked with a real 2xx call and validation, plus 2 reasoned exclusions (SSE, file bytes). The 30 admin routes are probed as a member for 403. All 45 event types have validators, cross-checked against the emitted literals.
  - RED proofs: a dummy route and a dummy event each fail the suite.
  - Drift: the server emitted `approval.consumed` but contracts lacked it; fixed on the contract side.
  - Vitest 1690.
  - Concern: the admin flag is hand-set.
  - Reviewer dispatched, including what entries batch 10–11 branches will need.
- 2026-11-22T12:03Z · c50 review: **PASS-WITH-FIXES**.
  - Inventory sound, no no-op entries, admin flags agree with a member sweep plus a static check. Vitest 1690.
  - Findings:
    - medium: mission and agent validators are open and not tsc-bound to the DTOs;
    - low: non-vacuity only at the root; `gated` doesn't pin FORBIDDEN; `hits` uses hand-typed keys; empty-array gaps; one computed emit.
  - Fix round dispatched: strict typing, recursive non-vacuity, dynamic member sweep, typed `EventType` on emit and append.
  - Merge impact recorded for the integrator: registry and validator entries for c45 queues, c47 evaluation/evaluationSha/overrideReason, c48 canDecide/decideBlockedReason and c49 anchors.
- 2026-11-22T12:14Z · **c50 CLEARED** at 539eda5 (controller check of the fix round).
  - Changes:
    - validators tsc-bound to the DTOs;
    - recursive non-vacuity (> 2000 mutations), with the remaining always-empty arrays given reasons;
    - dynamic member sweep with FORBIDDEN pinned;
    - an onResponse hook ties hits to the real routes;
    - `EventType` typed on emit and append.
  - Results: vitest 1691; RED proof for each item.
  - New finding (decision response lacks decidedByName) goes to H10.
  - Queued as batch 12, with the required registry follow-up for c45, c47, c48 and c49.
- 2026-11-22T12:20Z · **c40 CLEARED** at db34c42 (controller check of the fix round plus a screenshot look).
  - Fixes, each RED→GREEN: keyboard-scrollable help body (region role and label only when it overflows), api-c40 must open ≥ 5 popovers per size, Activity KPI 2-column grid at ≤ 800 px, 2 px clamp fixed, selftest 7/7.
  - Results: api-mode api-mobile 678 states with 0 FAIL, fit, a11y both modes, verify-all 10/10.
  - Queued as batch 11b. A fresh api-mobile run on the merged tree is required, and an odd 5th KPI tile spans both columns as a polish follow-up.
- 2026-11-22T12:25Z · c46 M1 (w45) reported at c905b51, no migration.
  - Built: 18 cells over six dimensions with no aggregate field, from `GET /company/dimensions` and dialog DL-98, opened from Overview and Departments.
  - Tests: 46, vitest 1722, api-c46 23/23, verify-all 10/10, demo a11y 0 violations.
  - Departures from the brief:
    - the verdict cell is always n = 0;
    - Environmental uses a judged MAST mapping (FM-1.4, FM-2.1);
    - review independence is redefined;
    - skills per role is replaced by accepted playbook items per agent;
    - admin-only sources show n = 0 to members.
  - Reviewer dispatched.
- 2026-11-22T12:35Z · c46 review: **PASS-WITH-FIXES**.
  - The core is honest: no composite, DEMO and simulated rows excluded at the source, the same VISIBLE_SQL, MIN_N, and an equal previous window.
  - Re-run: vitest 1722, api-c46 23/23, api a11y 0 violations.
  - Findings:
    - F1: the Environmental mapping is wrong (FM-1.4 and FM-2.1 are context and agent failures, and MAST has no environment mode).
    - F2: hidden and unmeasured cells read "n = 0".
    - F3: no single snapshot, and current state is used for past windows.
    - F4–F6: scope wording, the grants window, approval-time exclusions.
    - F7: UI polish (arrow wrap, small-n emphasis, evidence not reachable by touch).
  - Fix round dispatched.
  - Follow-ups:
    - **c46b**: source `verdict_outcomes` from c47's stored runs after merge;
    - move the dialog to a PageFrame tab.
- 2026-11-22T12:42Z · **Batch 10 merged** (integrator #4): c44 b80c2d1, c45 8798e82, no conflicts.
  - Results: vitest 1752/1752, api-c26 22/22 (I2 ≤ 0.3 px), api-c44, api-c22 14/14, api-c45 11/11, stage6 and improve green, a11y 0 violations in both modes, fit and ov-fit all fit, e2e audit:verify OK.
  - On the merged tree the c26 worst long task is 146–186 ms, down from 1.0–1.1 s after batch 9, so c44's flush and selector work closes P2b item (2)'s worst-task part.
  - One verify-all run was killed with rc 143 (SIGTERM) in dialog smoke and passed 10/10 on re-run. Possibly another agent killing a process by pid (the c46 lane reported killing "an older verify-all run by pid"). Lesson: kill only your own ports or PIDs.
- 2026-11-22T12:50Z · c48 merged (vitest 1780) but api-c48 fails 3/3 at the tiers "?" step. After Escape, focus returns to the gate "?", and its focus-opened tooltip covers the neighbouring tiers "?" on the Notifications card.
  - Controller ruling: (b), a product fix in a `fix(c48 merge):` commit (tooltip side or spacing on all 4 surfaces). The test stays unchanged and must pass 3 times in a row.
- 2026-11-22T13:02Z · c46 fix round at b15ad78.
  - Changes:
    - F1: the context-loss cell moved to Cognitive, and Environmental reads "not measured until Stage 7".
    - F2: `hidden` and `unmeasured` states with `n: null`, reason on the cell face.
    - F3: one REPEATABLE READ snapshot.
    - F4–F6: scope wording and evidence fixes.
    - F7: inline arrow, small-n de-emphasis, tap to see evidence.
  - Results: c46 tests 54 (18 RED first), vitest 1730, api-c46 30/30, api a11y 0 violations, verify-all 10/10.
  - **The lane disclosed it killed the integrator's verify-all by PID** (the rc 143 seen earlier). The rule is added to LANES.md: kill only a recorded PID with its cwd checked.
  - One last small fix asked for: sequential `loadDeptRows` inside the transaction.
- 2026-11-22T13:04Z · **c46 CLEARED** at f506a9a (controller check). `loadDeptRows` now runs sequentially on a transaction client and stays parallel on the pool, with the same rows; c46 and department tests passed 3/3 and vitest 1730. Queued as 11c, before c50. c50's registry follow-up now includes `GET /company/dimensions`.
- 2026-11-22T13:06Z · Batch 11 merging: c48 (8274a8d, plus tooltip fix 8e2f894), c47 (94806cf), c49 (af6bed5, plus b06554e). Started two lanes from b06554e:
  - **c51 O3a+O2a** (w50, e2e16, migration 0039): append-only owner history (fail-closed prior-actor exclusion), review freshness against the latest attempt, exact vendor matching, and a required delegation brief on reassignment.
  - **c52 H10** (w51, e2e17): SQL `lower()` for the skill lock key, `taskReviews.cancel` on sign-out, a narrowed c04 History check, the decision response's `decidedByName`, and a diagnosis of the 3 vitest failures after c09.
- 2026-11-22T13:38Z · Batch 11 merged at ec6d8b3. vitest 1962. Notes:
  - c48 tooltip fix 8e2f894 (HelpTrigger `tipSide`); api-c48 31/0 ×3 with the script unchanged.
  - c49: merged from cleared tip 7b17bf6, because its branch ref was stale (the lane committed on a detached HEAD). Test fix b06554e.
  - Live note: `audit:verify` exits 1 (ANCHOR_MISSING) until the anchor env is set and a first anchor is written.
- 2026-11-22T13:38Z · c51 (w50) reported at 03489f7, migration 0039.
  - Implemented: owner-history table and triggers (fail-closed), freshness, vendor rules, BRIEF_REQUIRED.
  - Tests: 78 new (41 RED first), vitest 2040, stage6 94/94 with the brief added, api-c42, c38 and c06 green.
  - Not run by the lane: api-improve.
  - Behaviour change: members can no longer reassign, because they can't write a root brief.
  - Reviewer dispatched.
- 2026-11-22T13:47Z · **c52 CLEARED** at 078b41c (controller check: the new lock helper is parameterised and schema-scoped, and the decider join is a lateral latest decision).
  - Items 1, 2 and 4 RED→GREEN. Item 3 narrowed with no RED (preventive).
  - Item 5 **NOT MET**: the 3 post-c09 failures don't reproduce 3/3 at b18c5a2 and their names were never recorded. The working hypothesis is the global-lock class (fixed in 4eca9db).
  - Lesson: always record failing test names in MERGES.md.
  - Queued as batch 13, with the c50 allowlist removal.
- 2026-11-22T13:47Z · c51 review: **PASS-WITH-FIXES**.
  - Owner-history triggers cover every path; the purge exception is transaction-local; the backfill is idempotent; down/up is clean; fail-closed in POST and GET; freshness uses SQL time; about 70 vendor inputs, none with a wrong family.
  - Re-run: vitest 2040, stage6, c42, c38, c06 and improve 107/107.
  - Behaviour change accepted (controller ruling): reassign is now admin or mission owner only, following c42's root-brief rule.
  - Fix round:
    - F1: the Reassign button is honest for non-owner members;
    - the latest history row must match the current owner;
    - the instances.test wipe re-enables in `finally`;
    - the o-series deviation is recorded.
- 2026-11-22T14:15Z · **c51 CLEARED** at a9a41a6 (controller check of the fix round).
  - The Reassign button is disabled with a reason for non-owner members. api-c51 11/11, RED first.
  - The newest history row must equal the current owner (fail closed).
  - Results: vitest 2042, stage6, c42 and improve green, verify-all 10/10.
  - Minor: `independence()` takes `current?` as optional, so a future caller that omits it fails open. The only caller always sets it; noted in H10.
  - Queued in batch 13 after c52, with the BRIEF_REQUIRED follow-up for c50's flow.
- 2026-11-22T16:08Z controller: restarted live 5190 Vite (stale watcher again after the c46 merge; contracts/index.ts lacked the dimensions export, so 5/10 verify-all steps failed with a DIMENSION_KEYS import error). PID recorded in /tmp/axion-5190.pid. Integrator #4: c40 merged (6c5a922, api-mobile 691 states 0 FAIL), c46 merged (api-c46 30/30, vitest 2016/2016); c50 merge in progress.
- 2026-11-22T16:54Z controller: ruling on the c46 flake (dimensions-route.test.ts, ~1 in 3 full runs, last review missing from the first read). Cause: JS Date ms-truncation of the RR-transaction now() used as a SQL <= bound against µs created_at. Approved product fix in fix(c46 merge): all bounds from SQL now(), windows contiguous, RED-first regression test, grep for the same pattern elsewhere (to backlog). c52 merged (a33ae82, allowlist line removed); c51 merged cleanly (stale/verified validators, brief added on the coverage-flow reassign).
- 2026-11-22T17:45Z Integrator #4 finished: batches 10, 11, 11b, 11c, 12 and 13 merged, HEAD ed3ed73. Full server suite 2114/2114, 3 of 3 runs. Details in MERGES.md.
- 2026-11-22T17:44Z controller live update:
  - stopped 5191 (was a67d2dd);
  - backup axion-20261122T174415Z.dump, restore check PASS;
  - migrate → version 39 (0026–0039);
  - added AUDIT_ANCHOR_KEY/DOMAIN/FILE to the live .env (mode 600, key not printed, checked absent from logs);
  - audit:verify chain OK, ANCHOR_MISSING as expected;
  - restarted from a clean tree on ed3ed73;
  - audit:anchor wrote t-1@1, audit:verify chain OK + anchor OK;
  - health 200 direct and through the 5190 proxy.
- 2026-11-22T17:45Z **Phase 2 clock starts; ends 2026-11-23T21:45Z.** (30 h loop ended 17:36Z.)
- 2026-11-22T17:50Z controller: Wave 5 dispatched from bfe891e.
  - Lanes: w52 c53 (E1c), w53 c54 (H11+M1b+M1c), w54 c55 (P2b), w55 c56 (P4b), w56 c57 (H12+H13).
  - Research round 2: researcher writes phase2/research-r2.md; a separate verifier follows.
  - Integrator #5: verification pass on the merged tree (api-mobile, stage6 ×20, perf-nav).
  - new-lane.sh now strips AUDIT_ANCHOR_* from lane .env copies; checked that w48's existing key is a lane test key, not the live one.
  - Cut-off: no new lane after 2026-11-23T13:45Z.
- 2026-11-22T17:54Z Research round 2 done: phase2/research-r2.md, 27 sources opened plus about 15 listed UNVERIFIED, 10 candidates R2-1..R2-10. Top 3: R2-6 Rule-of-Two capability profile, R2-5 origin-bound memory and skill records, R2-1 judge-calibrated verdicts. Independent verifier dispatched (writes phase2/research-r2-verified.md); Wave 6 is chosen only from its KEEP list.
- 2026-11-22T17:58Z Verifier done: phase2/research-r2-verified.md, 22 CONFIRMED, 4 CORRECTED (B3 ICML 2026, C4 USENIX Sec 2026, C8 draft wording, D1 workshop venue and cited figure), 0 wrong. R2-4 DROP; the rest KEEP or KEEP WITH CHANGES. Wave 6 planned (PHASE2.md): c58 R2-6+R2-9, c59 R2-5, c60 R2-10 attribution+R2-8 start now; c61 (R2-1, R2-2, R2-3) after c53; c62 R2-7 last, after owner Q12 (key custody). BACKLOG P5b marked done (c49).
- 2026-11-22T17:59Z Wave 6 lanes dispatched from 5b3e32b: w57 c58, w58 c59, w59 c60. Load average 17.7 at dispatch; heavy.sh gates the heavy runs.
- 2026-11-22T18:02Z c56 (w55, P4b) implementer done, tip 3afdb9d: PSL snapshot 2026-11-21 (sha256 0175…a2b9), full algorithm in psl.ts, 78 vectors, api-c56 14/14, vitest 2279/2279, api-c36 35/35, stage6 94/94. Open points: snapshot age warning, MPL-2.0/CC0 notices. Independent review running.
- 2026-11-22T18:05Z c53 (w52, E1c) implementer done, tip fbbebce, migration 0040. Items 1-5 RED→GREEN. Full vitest NOT MET strictly: 2191 passed, 1 failed (jobs.test concurrency '20 parallel claimers over 50 jobs', passes alone, load 19), plus audit-chain GET /audit/verify 'admin connect failed' in the full run only. c47 tests adapted (reviewer to judge loosening). Behaviour change: models outside the c38 vendor table can't reach verified_better. Independent review running (it also compares the two failures with base bfe891e). The c56 implementer looped duplicate hand-backs while waiting on its own background job, so it was stopped with TaskStop; the branch is complete at 3afdb9d, ports 10590-10593 free.
- 2026-11-22T18:06Z c56 review: CLEAR AFTER FIXES (cycles/c56-review.md). Rulings: (1) verify the snapshot SHA-256 against the manifest at load and refuse to start on mismatch, plus truncated and empty file tests (an empty .dat failed open); (2) keep an additive deny list for amazonaws.com and glitch.me, which the removed partial list refused, with tests (never loosen); (3) THIRD_PARTY_NOTICES.md; (4) include the upper-case vectors; (5) staleness → BACKLOG P4c. The manifest-in-same-commit point is accepted: git history protects it. Fresh fix-round agent dispatched (the original implementer was stopped).
- 2026-11-22T18:14Z c53 review: CLEAR AFTER FIXES (cycles/c53-review.md). F1 non-canonical candidate_sha lets the same config re-run; F2 no immutability on agent_version_proposals; F3 plain UPDATE finished_at bypasses completeness; F4 dev_holdout_reuse misses full copies of short inputs. Minor: F5 23505 instead of holdout_rerun; F6 → BACKLOG E1d. The two full-suite failures are the 45-connection role cap (also on base) → BACKLOG H14. heavy.sh: vitest now also takes one of 3 DB slots (integrator DB slot 0), swapped atomically at 19:14Z (CET). Fix round sent to the c53 implementer.
- 2026-11-22T18:21Z c56 fix round done (tip 3480bff): the loader fails closed on hash, rule-count or sentinel mismatch; EXTRA_REFUSED_HOSTS {amazonaws.com, glitch.me} (all 36 removed entries pinned); THIRD_PARTY_NOTICES.md; upper-case vectors (143/143); api-c36 35/35, api-c56 14/14. Full vitest never fully green during the lane because of the connection cap; every file passed at least once after the last change. The controller checked the fix diff: CLEARED, queued as batch 14. Connection sample at 19:21 CET: 19–23 of 45 with all 3 DB slots held, so the gate works.
- 2026-11-22T18:32Z c60 (w59, R2-10 attribution + R2-8) implementer done, tip a025aa5, migration 0045. Append-only failure_attributions (insert trigger instead of FK); disagreement count; OTel mapping of 96 fields generated from code; export:otlp CLI (content off, _ref pointers); spec pinned to semantic-conventions-genai v0.1.0 d0e74ba6 with 2 stored pages hashed. Full vitest 2153/2153 at --maxWorkers=1 (the first run hit the role cap). api-c33 41/41, stage6 94/94 alone, improve 107/107, api-c60 10/10, a11y 0. Implementer stopped (idle on its own background job; ports free). Independent review running.
- 2026-11-22T18:33Z c54 (w53) implementer handed back INCOMPLETE (context): items 1–4 committed, tip b0ddcf3 (H11 clock.ts dbNow/dbWindow; M1c stale reviews; M1b(1) verdict_outcomes from stored runs; M1b(2) Agents > Dimensions tab, DL-98 retired). The final checks (verify-all, fit, a11y ×2, api-mobile) are still running in its script /tmp/w53-rest.sh (PID 693472, dev server 10390 PID 341234, both cwd in w53). The implementer was stopped; a finisher agent waits for ALLDONE, writes c54-report.md, regenerates the dialog ledger and stops 10390. Backlog H11b added; lesson on context-limited lanes.
- 2026-11-22T18:35Z c60 review: CLEAR AFTER FIXES (cycles/c60-review.md). S1 the default export leaks free text (attributed agent/step, owner_agent, evidence_ref, tool names, error.type from step error strings); S2 the Apache-2.0 licence text is missing for the stored spec pages (pin verified: v0.1.0 = d0e74ba6, hashes match); S3 the export CLI defaults to the live DATABASE_URL and isn't enforced read-only. Rulings: S1 content-gate every free-text field, error.type from a fixed vocabulary, sanitise and cap tool names, sentinel tests; S2 LICENSE next to the pages, integrator adds a THIRD_PARTY_NOTICES entry at merge (c56 creates that file); S3 no default DB: require --database-url-env <VAR>, one read-only REPEATABLE READ transaction, print the DB name only; minors: 0600 output, document cross-mission linking, CLI visibility and disagreement edge cases, fix the report's overclaims. Fresh fix-round agent.
- 2026-11-22T18:43Z c53 fix round done, tip 2d23cca: F1 canonical holdout key via eval_canon_config in the trigger; F2 proposal immutability trigger; F3 the guard refuses finishing an incomplete run; F4 distinct shared inputs, threshold max(2, min(5, 10%)); F5 23505 → holdout_rerun; the helper caught 5 silent mismatches in the c47 tests. Full vitest 2202 passed, 10 failures in the connection-cap family plus 1 own fixed (not re-run as a whole suite); api-c05 31/31, api-c47 26/26. Down migration 0040 made idempotent. Scoped re-review sent to the c53 reviewer.
- 2026-11-22T18:52Z c53 re-review: CLEAR (F1–F5 closed; test edits legitimate; down migration safe). Minor remainders folded into BACKLOG E1d. CLEARED at 2d23cca, queued as batch 15.
- 2026-11-22T18:53Z c61 (R2-2, R2-3, R2-1) dispatched in lane w60, branched from c53's cleared tip 2d23cca (it builds on c53's tables; it merges after batch 15). Docs are read from the integration tree, read-only.
- 2026-11-22T18:54Z c60 fix round done, tip df8c17e: S1 content-gated free text, error.type vocabulary, tool-name identifier rule (else _OTHER), secret sentinels absent from default export; S2 Apache-2.0 LICENSE next to the pages (sha256 c71d239d…), SOURCE.md; S3 --database-url-env required, one REPEATABLE READ READ ONLY transaction, DB name only; minors 0600, symlink refused, linked_by, usage, ATTRIBUTION_HELP. Full vitest 2165/2165 in one default-worker run (load 17); api-c33 41/41, api-c60 10/10, stage6 94/94. THIRD_PARTY_NOTICES entry text supplied for the integrator. Scoped re-review sent.
- 2026-11-22T18:56Z c60 re-review: CLEAR (S1–S3 fixed; TOCTOU covered by lstat + O_NOFOLLOW). Non-blocking follow-ups → BACKLOG H15. CLEARED at df8c17e, queued as batch 16 with the THIRD_PARTY_NOTICES entry as a merge follow-up.
- 2026-11-22T18:58Z c57 (w56, H12 + H13) done, tip 38d807d. H12 NOT REPRODUCED naturally (30 loads at 6x, 40 at 20x no-cache, delayed main.tsx); RED by injected document replacement 3/3; the probe now waits on the shell and re-audits a replaced document; strictness kept (the strip-live knob still fails). 20/20 throttled passes. H13 anchors route exercised hermetically, allowlist line removed, contracts 15/15. Full vitest 2114/2114 on the last run (earlier runs hit the role cap). The controller checked both diffs: CLEARED, added to batch 14 after c56. Implementer stopped (idle on its own background job; ports free).
- 2026-11-22T18:58Z controller: integrator #5's api-mobile had run 68 min at load about 15. Reprioritised: finish api-mobile, run perf-nav once, defer stage6 ×20 to the end-of-phase quiet window, then merge batches 14 (c56, c57), 15 (c53) and 16 (c60).
- 2026-11-22T19:11Z c58 (w57, R2-6 + R2-9) implementer done, tip c11dd1e, migration 0043, DL-100. About 120 policy cases (only all-true escalates; the requester's text can't lower the result); flags and rule stored with each approval; admin-only per-approver stats (n ≥ 5); fast-bulk flag advisory. api-c58 34/34, api-c48 31/31, api-c42 16/16, stage6 94/94, verify-all 10/10, fit, a11y ×2 0, api-mobile no failures. Full vitest: role-cap failures only (named in the report). Caveat: today requestApproval evaluates without grants, so the rule changes no real request yet (recorded only). Independent review running.
- 2026-11-22T19:14Z c58 review: CLEAR AFTER FIXES (cycles/c58-review.md). Rulings: F1 add any existing data-read capability to flag (b), else make the UI and help wording exact; F2 parse the URL and match the pathname exactly, in e2e-extra-approvals.ts and e2e-serve.ts; F3 member aggregates need ≥ 3 distinct approvers and a fixed window set (7/30/90); F4 untrusted uploads are the union over all revisions plus message_attachments; F6 exclude demo rows from the statistics; F7 a real fired:true request via the e2e harness in api-c58. F5 → BACKLOG P3c. Fix round sent to the c58 implementer.
- 2026-11-22T19:16Z c61 (w60, R2-2 + R2-3 + R2-1) implementer done, tip 1b2cd46, migration 0046. Estimator: Rogan-Gladen with adjusted-Wald interval (A1, arXiv 2511.21140, Eq. 7–12; the centring-term transcription is unverified). Coverage 95.82% pooled (SE 0.15), min cell 93.3% (SE 0.79), 18 cells × 1000, seed 20261122. Episode counts derived from stored results, not columns. No write route or UI yet (scaffolding). Full vitest: only jobs.test 20-claimers (role cap), 76/76 serially. api-c47 26/26, api-c05 31/31, stage6 94/94, a11y 0. Independent review running (it checks the formulas against the paper itself).
- 2026-11-22T19:18Z c59 (w58, R2-5) implementer done, tip aa28be9, migration 0044. All thresholds PASS (serial full vitest 2152/2152; api-c41 45/45, api-c59 26/26, stage6 94/94, improve 107/107, verify-all 10/10, fit, a11y ×2 0). Ruling: the per-agent-playbook cap is accepted (c41 keys playbooks by agent; skills have no role field); skills cap → BACKLOG E4b. LANES.md now names the serial vitest fallback. Independent review running.
- 2026-11-22T19:18Z c55 (w54, P2b) implementer done, tip 4cac406. Item 1 hold-until-measured (RED a constructed 300 px drift, GREEN 0.2–0.5 px at x1/x4); item 2 forced layout from hold/record 311→33 ms and 123→7 ms interleaved; item 3 api-c44 relative bar (fails the flushDelay mutation by 335/444 ms); item 4 prod 717–780 ms vs dev 1,365–1,647 ms; item 5 the N=1000 hang NOT REPRODUCED (21 reps). One api-c22 N=130 flake ('scrolling up loads the next older page') at load 19.8, involvement unknown. Pre-existing: the reader is not pinned after fast bursts. Independent review running.
- 2026-11-22T19:19Z Research round 3 dispatched (company structure, company performance, agent performance, operator UX; writes phase2/research-r3.md; a verifier follows). Wave 7 planned in PHASE2.md: research-driven lanes plus merge-dependent follow-ups.
- 2026-11-22T19:22Z c61 review: CLEAR AFTER FIXES (cycles/c61-review.md). The estimator matches the paper term by term (the centring caveat is dropped). Required: (1) ungraded exclusion can produce verified_better from a tie, so a retained-case gate plus a worst-case imputation check; (2) attestor ≠ author bypassable via free-text or NULL created_by, so a real user/agent FK, immutable and set at insert; (3) re-grade diff is only a claim, so FK author ≠ proposer, validated scores, complete coverage, a visible 're-graded' flag; (4) the coverage grid is too easy (81.7% worst cell on the reviewer's 48-cell grid after the gate), so use the reviewer's grid fixed, adjust the gate, confirm on a fresh seed, report conditional coverage and skip rates. Minor: explain author_unknown in the UI; a grader missing on both sides is not 'same grader'; the rest → BACKLOG E1d. Fix round sent to the c61 implementer.
- 2026-11-22T19:23Z c59 review: CLEAR AFTER FIXES (cycles/c59-review.md). Origin-never-rises held against every probe. Required: F1 a 0044 down/up round trip raised an agent-class derived record to human, so the backfill must fail closed (unknown origin → lowest class, never human); F2 'role' wording → 'per agent playbook'; F3 state the limit that hand-typed agent text is undetectable in the chip and help; F4 '?' on the origin chip. Also: F5 log completeness enforced in the DB (a trigger) plus the filer in the log and no spurious 'withdrawn'; F6 case-insensitive source kind in the trigger. F7 (0044 edited twice in place) is noted for the integrator; F8 no squash needed (merge is --no-ff). Fix round sent to the c59 implementer.
- 2026-11-22T19:23Z c54 finisher done, tip 4f83abf: report written; verify-all 10/10, fit ALL FIT, a11y demo and api 0, api-mobile NO FAILURES; ledger diff only the 2 DL-98 lines; 10390 stopped (cwd checked); no jobs left. Independent review running.
- 2026-11-22T19:24Z Research round 3 done: phase2/research-r3.md, 29 sources (arXiv abstracts only) plus about 15 UNVERIFIED, 10 candidates. Top 3: R3-8 failure-learning loop, R3-4 metric-gaming guard, R3-9 operator attention queue. Gaps recorded (no span-of-control or restructure numbers found). R3-3 earned autonomy raises an owner question. Verifier dispatched (phase2/research-r3-verified.md).
- 2026-11-22T19:27Z c58 fix round done, tip 7f31c94: F2 isE2eDatabaseUrl (24 cases, guards e2e-serve too); F1 no existing data-read capability, so (b) stays the infra/critical kinds with exact wording ('live systems or credentials'); F4 union of revisions + chat attachments; F6 demo excluded; F3 member numbers need n≥5 and ≥3 approvers, windows 7/30/90 only; F7 real fired request via the harness, api-c58 40/40. Serial full vitest: 9 role-cap failures (c39-ledgers, throughput; pass alone). Owner-level design point: a 'read private data' capability would make flag (b) meaningful (BACKLOG P3c). Scoped re-review sent.
- 2026-11-22T19:28Z Research round 3 verified (phase2/research-r3-verified.md): 27 CONFIRMED, 2 CORRECTED; R3-1 folded into R3-7, R3-2 not scheduled, the rest KEEP WITH CHANGES. Wave 7 order recorded in PHASE2.md. Owner questions Q13 (autonomy as a policy input) and Q14 (read-private-data capability) added. Briefs c63 (R3-8, from c60's tip) and c64 (R3-6) written.
- 2026-11-22T19:28Z c58 re-review: CLEAR (F1–F7 closed; F2 checked against 32 URLs). Residue → BACKLOG P3c. CLEARED at 7f31c94, queued as batch 17. Wave 7 lanes dispatched: w61 c63 (R3-8, from c60's tip df8c17e, e2e12, mig 0047) and w62 c64 (R3-6, from 07831cd, e2e11, mig 0048).
- 2026-11-22T19:30Z c54 review: CLEAR AFTER FIXES (cycles/c54-review.md). Fix round to the c54 finisher: help wording on placement and current verdicts; shorten the verdicts cell label; tab strip edge fade or icon-collapse so a clip is never invisible; failure-modes bound to the closed convention; approvals id tiebreaker; cells +3 px; REPEATABLE READ for the scorecard, throughput and departments reads. Grants issuance → H11b; 390 px tab-strip overlap → BACKLOG H16; N+1 → H11b.
- 2026-11-22T19:39Z c59 fix round done, tip 4b6426f (two fix commits: d00b04a F1/F5/F6, 7152984 F2/F3/F4): the backfill fails closed (agent rows → tool); a DB trigger writes the log from a transaction-local actor (UPDATE without an actor refused; INSERT falls back to the proposer); case-insensitive kinds; wording, limit text and '?' on chips. Serial full vitest: 2 connection-cap files pass on re-run; api-c41 45/45, stage6 94/94, api-c59 26/26, a11y 0. Scoped re-review sent (the INSERT-actor fallback in particular).
- 2026-11-22T19:42Z c59 re-review: CLEAR AFTER FIXES. R1: the second withdrawal is a real event (the reviewer reversed its earlier call), so log it even when no row changed; R2a: an actor without a kind defaults to system (or raises); R2b optional. Reclassifying old agent rows as tool is accepted (release note). Sent to the c59 implementer; the controller checks the diff. c61 fix round done, tip 4532b25: items 1–3 and 5 fixed (worst-case imputation, real-id authors, validated re-grades, grader_unknown). Item 4 NOT MET for weak judges (0.6/0.6) because of selection bias, which no gate fixes. Controller decision: fail closed, judge margin ≥ 0.5 required, re-run both seeds, pin the remaining cells, honest help text. Vitest: 50 connection-cap failures; the 3 left after a serial re-run pass in pairs.
- 2026-11-22T19:44Z c61 fix round 2, tip 43c1b7c: MIN_JUDGE_MARGIN 0.5. Weak judges are now almost always refused, and strong judges (0.9/0.9) meet 93% in every assessed cell. Middling judges (true margin 0.35–0.45) lucky past the gate still miss in 12/13 cells per seed (pooled 94.5%): selection bias moved, not removed. Accepted as fail-closed documented policy (scaffolding; no consumer until judges are used); NOT_MET cells pinned. A lower-confidence-bound gate → backlog. Scoped re-review sent to the c61 reviewer.
- 2026-11-22T19:45Z c59 last fixes done, tip 67b40ed: R1 the rollback logs 'withdrawn' for already-superseded items; R2a raises on an actor without a kind; R2b asserted=false and 'actor not asserted' in the UI. The controller checked the diff: CLEARED, queued as batch 18.
- 2026-11-22T19:46Z c55 review: CLEAR AFTER FIXES (cycles/c55-review.md). Code holds (the api-c44 mutation fails by 321–373 ms; hold/record forced layout 182/122 ms → 7/8 ms; no leaks; the api-c22 N=130 flake isn't reproduced, 8/8, and looks pre-existing). Should-fix: api-c55's anchor check has a fixed 600 ms window after the grow and fails under load (1 of 8), so make it condition-based. Reader-not-pinned is confirmed pre-existing → BACKLOG P2c. Fix sent to the c55 implementer; the controller checks the diff.
- 2026-11-22T19:47Z c61 re-review: CLEAR (all probes refused; scores 100.0004/NaN refused; pins deterministic; the original 18 cells ≥ 94.5% under the new gate). The reviewer's remedies for selection bias go to BACKLOG E1e; minor gaps → E1d. CLEARED at 43c1b7c, queued as batch 19 (after batch 15), with release notes (pre-c61 runs grader_unknown, datasets author_unknown).
- 2026-11-22T19:54Z c55 test fix done, tip c1289a1: the anchor check detects the commit by condition (minimap block) and fails if no commit is seen; the 8 px bar is unchanged; base RED 300 px, tip GREEN 5/5 at x4 (load 18–28). The controller checked the diff: CLEARED, queued as batch 20.
- 2026-11-22T20:01Z c54 fix round done, tip 78e149f: 7 items, each with its own commit (wording, 'Evaluation verdicts' label, global tab-strip edge fade that shows only on overflow, closed failure-modes bound, approvals id tiebreaker, 37 px cells, snapshotTx REPEATABLE READ for scorecard, throughput and departments). Clean serial full vitest 2134/2134; api-c46 36/36, c06 25/25, stage6 94/94, fit ALL FIT, a11y api 0. approval-binding '20 concurrent consumes' failed once under load, passes alone. Scoped re-review sent (the global fade in particular).
- 2026-11-22T20:08Z c54 re-review: CLEAR (the fade is safe on every strip; fit ALL FIT; demo a11y 0; snapshotTx asserted by a spy test; the approval-binding flake is the connection cap). Fade minors → BACKLOG H16. CLEARED at 78e149f, queued as batch 21, after batches 17 and 19. Every Wave 5–6 lane is now merged or queued.
- 2026-11-22T20:08Z Wave 7 continues: briefs c65 (R3-10 review capacity, from c58 tip 7f31c94) and c66 (R3-4 metric-gaming guard, from c54 tip 78e149f). Lanes w63 and w64.
- 2026-11-22T20:19Z c64 (w62, R3-6) implementer done, tip 9c70ba8, migration 0048. Server-computed evidence; reviewer per team (≥2 able) and escalation ≤ N levels (new), output contract dropped; corpus of 33 bad proposals rejected and 16 good accepted; cooldown and churn budget (off by default, env only) → owner Q15; baseline and cost bound into the sha. Serial full vitest 2405/2405; api-improve 108/108, stage6 94/94, verify-all 10/10, a11y both 0. Pre-existing: api-mode fit-check has 10 BAD /agents/coder-01?tab=* views on base → BACKLOG H17. Independent review running.
- 2026-11-22T20:22Z c63 (w61, R3-8) implementer done, tip 6b0946c, migration 0047. Detection fields write-once, detected-after computed in SQL; the recurrence rule fires at exactly 3 failures across 2 departments and files a c41 lesson candidate (never an active playbook); the human-only share is null below 5; tag dialog xl. Serial full vitest 2194/2194; api-c33 41/41, c60 10/10, c41 45/45, stage6 94/94, improve 107/107, verify-all 10/10, fit, a11y ×2 0. Merge interactions: c59 origin channel (pass tool_output at patterns.ts) and c54's failureModeCounts. Independent review running.
- 2026-11-22T20:26Z c64 review: CLEAR AFTER FIXES (cycles/c64-review.md). S1 reproduced: rollbacks exempt from cooldown and budget could flip-flop 4× past a budget of 2. Rulings: exempt only the undo of the last applied change; other rollbacks follow the budget and cooldown; re-check both at approval; flip-flop test. S2 share over all tags; S3 point-in-time labels and demo/sim excluded from reassigns; S4 show all four triggers; S5 an 'as of' time on the card; S6 'not enforced' wording, ESCALATION=0 means not enforced, and check only the chains the proposal changes. S7 → BACKLOG O1c. H17 cause measured (hero 360 px plus fit-scroll minimum 300 overflow by 48 px). Fresh fix-round agent (the implementer was stopped).
- 2026-11-22T20:27Z c63 review: CLEAR AFTER FIXES (cycles/c63-review.md). Lane: reword detected-after as 'tagged N after the failure' plus a help sentence; fix the 'originChannel' wording (c59's field is `channel`); cheap minors: case-insensitive department match, '3 of 5 recorded' on the dialog, cap the candidate text. Integrator: at the c59 merge pass `channel: 'tool_output'` at patterns.ts with a test assertion; at the c54 merge take dbWindow and the closed ms-grid predicate in failureModeCounts and align patterns.ts qualifying() to it, with a boundary test.
- 2026-11-22T20:33Z c63 fix round done, tip 99376e4: 'tagged N after the failure' wording and help; missing counts split; departments lower(btrim()) in SQL (the threshold uses the key: checked); candidate text capped under 560 (worst-case test through c41's proposeLesson); '3 of 5 recorded'. The controller checked the diff: CLEARED, queued as batch 22 after batches 16, 18 and 21, with the c59 and c54 merge follow-ups written into the row.
- 2026-11-22T20:52Z c64 fix round done, tip 9f7582a: S1 only the undo of the last change is exempt (rollback_to column in 0048), cooldown and budget re-checked at approval, flip-flop test; S2 denominator is all confirmed tags; S3 now/window scopes and demo/sim excluded; S4 all four triggers shown; S5 'as of' and an exempt flag; S6 'not enforced', ESCALATION=0 off, only changed chains checked. Serial full vitest 2415/2415; api-c64 all pass, improve 108/108, c11 16/16, c20 pass, stage6 94/94, a11y 0; api fit shows only the pre-existing H17 lines. Scoped re-review sent.
- 2026-11-22T20:55Z c65 (w63, R3-10) implementer done, tip d0764e3, no migration. Approvals plus tasks waiting for a person, per department (raising agent or task owner); p50/p95 null below 20; Little's law with tolerance max(0.25, 15%), missing_close fails loudly; utilisation dropped (no handling-time record) and stated; member privacy as in c58. Parallel full vitest 2321/2321 (no role-cap failures); api-c58 pass, c48 31/31, stage6 94/94, c65 pass, verify-all 10/10, fit, a11y ×2 0; api-mobile not run. Windows are N×24 h (c58 and c54 use calendar days or clock.ts), so they align at merge. Independent review running.
- 2026-11-22T20:55Z c64 re-review: CLEAR (forged rollback_to refused at approval; indirect deepening caught; the changed old test is legitimate). Minors → BACKLOG O1c. CLEARED at 9f7582a, queued as batch 23.
- 2026-11-22T20:55Z c67 (H17, Agent Profile api-mode fit) dispatched in lane w65 from improve-30h (batches 14–18 merged).
- 2026-11-22T20:58Z c65 review: CLEAR AFTER FIXES (cycles/c65-review.md). F1 the Little's-law check is nearly an identity and false-alarms on healthy data (probe relError 0.94); F2 a missing open event on task waits is invisible; F3 the privacy floor leaks people/decided when shown:false and span openItems has no floor; F4 at 390 px the 90d option is unreachable; F5 the department rule differs from c54. Rulings: no alert on healthy data (the reviewer's probe must pass), keep missing_close, add missing_open, use the exact finite-window form with carry-in or make it informational only; null people/decided below the floor and floor span openItems for members; 390 px fix; align the department rule with c54 (coalesce(instance agent, owner_agent), simulated excluded); minors: windowStart in one transaction, '?' on table numbers, expired note, pre-c58 null latencies excluded from decided. Fresh fix-round agent.
- 2026-11-22T21:05Z c66 (w64, R3-4) implementer done, tip 138b201, migration 0050. Inventory of 23 fields and 23 write sites (route-table and source-scan tests); a 33-row registry (9 'none known'); 14 rows gameable today (display-only); metric_audit_labels with an admin POST, flag at 15% divergence; shields and popovers with no added height. Full vitest 2165/2165 parallel; api-c46 36/36, c06 25/25, stage6 94/94, improve 107/107, api-c66 24/24, verify-all 10/10, fit, a11y ×2 0. Threshold (c) circular, as stated; NOT MET at n=60 (94.8%). Controller decision: minimum audit size raised to 100 (holds on 2 seeds, one chosen before the run). Independent review running.
- 2026-11-22T21:32Z c66 review: CLEAR AFTER FIXES (cycles/c66-review.md). S1 scan holes (schema-qualified, quoted, ONLY, MERGE, TRUNCATE, COPY, templated names; writes through helper calls like insertDelegation), so widen the regex, add a caller check on exported write helpers, and state the limits; S2 verified_success_rate is falsely gameable (agents write only 'delegated' edges, the row reads 'verifies'), so split by edge kind and correct the report; S3 the 60 minimum is still in code, help, tests and scripts, so 100 everywhere with help reading the constant, and re-run both seeds. Minors in the fix round: UI circularity note, 'no agent executes today' in the popover body, plain words instead of function names, 24 px hit area, note on demo tiles and /departments. Others → BACKLOG M2b. c60 OTel needs no mapping row. c63 merge: add the decideTag → patterns.ts site to the inventory by hand.
- 2026-11-22T21:46Z c65 fix round done, tip fdcbaa0: F1 Little's law informational (the exact relation has no power; tolerance removed); F2 missing_open; F3 null decided/people below the floor and floored span openItems for members; F4 390 px selector reachable (CSS wrap; api-mobile couldn't see it, so a new api-c65 step); F5 c54 department rule; minors done (one cohort everywhere). Serial full vitest 2333/2333; api-c65 pass, c48 31, stage6 94/94, api-c58 pass on rerun (one load flake), api-mobile pass, a11y 0, fit ALL FIT. Scoped re-review sent (the test removals and changes in particular).
- 2026-11-22T21:47Z c65 re-review: CLEAR (F1–F5 closed; tolerance removal legitimate, since the reference simulation still passes; span query about 0.38 s at 2000 approvals). CLEARED at fdcbaa0, queued as batch 24 after batches 17 and 21, with the clock.ts alignment as a required follow-up.
- 2026-11-22T21:48Z Integrator progress: 10 lanes merged (c56, c57, c53, c60, c58, c59, c61, c54, c63, c64); c55 and c65 remain. c68 (R3-9 operator attention queue) dispatched in lane w66 from the merged tree.
