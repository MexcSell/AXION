# Improvement loop log

One entry per cycle: times (UTC), theme, hypothesis, measure + threshold (fixed before the change), commits, before → after, result, screenshots, lessons. Owner questions are queued at the bottom.

## Owner questions (queued, with the default the loop uses meanwhile)
- Q1 (from Stage 5): may any member who can see a shared mission decide its approvals? Default: yes (unchanged).

- Q5 (from cycle 5): should direct edits of an agent's model, skills or tools (Stage 6 Edit) require a version proposal and a second admin, as promotions do? Default: no; direct edits stay single-admin, audited and versioned.
- Q6 (from cycle 6): when several members of a department report to the GM, which one is the department "head"? The current rule is the one with the most members under it, then the lowest id, and the card shows a "1 of N → GM" chip. Default: keep it.

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
