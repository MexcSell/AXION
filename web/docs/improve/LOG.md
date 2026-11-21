# Improvement loop log

One entry per cycle: times (UTC), theme, hypothesis, measure + threshold (fixed before the change), commits, before → after, result, screenshots, lessons. Owner questions are queued at the bottom.

## Owner questions (queued, with the default the loop uses meanwhile)
- Q1 (from Stage 5): may any member who can see a shared mission decide its approvals? Default: yes (unchanged).

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
