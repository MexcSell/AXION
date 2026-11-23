# AXION improvement programme: final report (DRAFT)

Status: **DRAFT**, written 2026-11-23 about 02:25Z while Phase 2 is still running. Anything not final is marked **[pending]**.

Periods covered:
- 30-hour loop: 2026-11-21 11:36Z to 2026-11-22 17:36Z, cycles c01 to c52. Done.
- Phase 2, "evolve for 28 hours": 2026-11-22 17:45Z to 2026-11-23 21:45Z, cycles c53 to c77 plus three research rounds. Running.

Sources: STATE.md, PHASE2.md, LOG.md, QUEUE.md, MERGES.md, BACKLOG.md, LESSONS.md, SCORECARD.md, PROCESS.md, phase2/*.md and the cycle reports and reviews, all in `web/docs/improve/`.

## 1. Summary

- **Built:** cycles c01 to c75, plus two parked branches (c76, c77). c62 was not built. Every cycle ran brief, build, independent review, fix round, merge. The branch is `improve-30h`. It is local only and nothing has been pushed.
- **Live:** cycles c01 to c71 are merged and running on the real `axion` database (schema version 53). The last live update was 2026-11-23 02:22Z, after a backup and a restore check. c72 is cleared and queued **[pending merge]**. c73, c74 and c75 are in progress **[pending]**.
- **Quality gates:** server tests went from 219 to 3178 passed. The browser suites (sign-in 15/15, flows 23/23, Agent Profile and edit suite 94/94) were green on the last merged tree. The accessibility check found 0 violations. Both fit checks (demo and api mode) were ALL FIT.
- **Direction:** agents do not execute yet. So the programme built the measuring, safety and governance layers, not performance gains. No agent or company performance number exists to compare.
- **Research:** three rounds read 31 + 26 + 29 sources, each checked by a separate verifier. Of the 20 candidate ideas from rounds 2 and 3, 15 were built (one, R3-7, awaits merge), 2 are parked (R2-7, R3-3), 2 were dropped (R2-4, R3-2) and R3-1 was folded into R3-7 (see section 4).
- **Parked for you:** Stage 8 and Stage 9 record branches (c76, c77; Q11), signed receipts (c62; Q12), earned autonomy (R3-3; Q13).
- **Honest limits:** several statistical claims are NOT MET or nominal (section 6). The scale limit is real: the slowest company route is about 0.95 s p95 at 25,000 tasks.
- **Your actions:** copy the audit anchor file off the machine, answer Q1 to Q16, set the Q15 values, and decide what to do with the local branch (section 8).

## 2. What is live now

All rows are merged and live unless marked. Cycle ids are in brackets.

### Company structure
- Organisation change proposals with a dry run, approval and a base-revision check (c01). Org history, before/after diff and rollback through approval (c04). New missions are staffed from the active organisation (c11, c34). Capability coverage check (c20).
- Restructure guardrails: evidence shown on each proposal, at least 2 able reviewers per changed team, a limit on escalation levels (default 6). Cooldown and churn budget exist but are **off by default** (c64).
- Failure learning across the company: a repeated failure (3 or more, in 2 or more departments, in 30 days) opens a candidate lesson for review, never an active playbook (c63).
- Department facts from recorded data (c06). Typed delegation briefs, required on every reassignment (c42, c51).
- Mission ledgers: plan and progress records per mission (c39).
- Demo department heads chosen from structure **[pending merge, c72]**.

### Company performance
- Company scorecard from recorded events, with n and evidence on every row (c02). Throughput trend (c12). Six-dimension scorecard with a trend and no composite number (c46, c54).
- Process metrics next to outcomes: rework, first-pass, duplicate delegations, reassign churn, hand-off wait, approval time (c69).
- Review capacity: approvals and tasks waiting for a person, per department, with the arrival rate and the 50th and 95th percentile wait (c65).
- Scorecard at scale: indexes and one freshness rule (c71, c10).
- Metric-gaming guard: a registry of 33 metrics, 11 flagged "gameable", a write-site scan and an audit-label route (c66).

### Agent performance
- Agent reliability from recorded task history (c03). Version proposals with promote and rollback; the author cannot promote their own (c05). Evaluation evidence on proposals (c47).
- Honest experiment verdicts: paired sign test, confidence interval, an explicit "inconclusive", pass^k reliability, cost next to accuracy, holdout split (c13, c32).
- Eval-run integrity: no re-run shopping, resumable runs, judge labels (c53). Instrument audit, dataset attestation and a judge-calibration scaffold (c61).
- Mentoring plans (c19). Reviewed playbooks and a skill library (c41). Origin-bound memory and skill records (c59).
- Independent task review: the producer cannot verify its own task (c38, c51).
- Failure-mode tagging (14 modes) with agent, step and attribution fields (c33, c60).
- Skill ratings adjusted for task difficulty, with no leaderboard **[pending merge, c72]**.

### Safety and governance
- Deterministic policy service. Approval tier derived on the server; R3 and R4 need an admin (c30). Approvals UI follows the tiers (c48).
- Approval binding v2: exact action digest, single use (c35). Approval evidence made tamper-evident **[pending, c75]**.
- Tamper-evident audit chain with a verify route (c31). Anchor outside the database (c49). Live anchor file has 2 lines.
- Site grants with an exact-origin normaliser (c36) and a pinned Public Suffix List, which refuses to start on a hash mismatch (c56). PSL age warning **[pending, c73]**.
- Browser action contract with an injection test corpus, no execution (c37).
- Rule-of-Two flags derived by the server, and approval-quality records (c58). HTTP hardening and rate limits (c14). Durable job records with lease states, records only (c45).

### Evaluation integrity
- Holdout content key (renamed case ids no longer bypass it), regrader-is-author check in the database, SQL clock bounds everywhere (c70, c54).
- OpenTelemetry mapping and a local OTLP-JSON export, against a pinned spec (c60). **Never run it on the live DB.**

### Operator UX
- "Needs you" attention queue on Overview: 6 row kinds, ranked, with evidence in 2 clicks (c68).
- Long threads load fast and are virtualised (c22, c26, c44, c55). Loading states are announced (c23). Phone-width fit (c24, c40). Agent Profile fits one screen in api mode (c18, c67). Owner guide in the app (c17). Command palette fixes (c28).

### Engineering health
- Smaller first load: 307,502 to 243,127 B gzip for /missions (c07). Honest exit codes in verify-all (c21). Flaky checks fixed (c08, c25, c29, c43, c57).
- Contract tests generated from the route table (c50). Merge minors swept (c09, c27, c52). Scale benchmark (c10, c71).
- Dev server watches shared contracts **[pending, c74]**.

## 3. Built but parked for your decision

| Item | What it is | Status | Waits for |
|---|---|---|---|
| c76 | Stage 8 records: release and last-good records, artifact metadata and hashes (R1, A1). Migration 0056. No route performs a release. | **[pending]** implementing; branch `c76-stage8-records`; never queued, no live migration | Q11 |
| c77 | Stage 9 records: usage ledger with budget caps, model registry and routing policy (M2, G1). Migration 0057. Fake adapter only. | **[pending]** implementing; never queued, no live migration | Q11 |
| c62 | Signed decision receipts with an offline verifier (R2-7) | Not built. Test key only until you answer. | Q12 |
| R3-3 | Earned-autonomy ladder, display-only | Not built. Scheduled last. | Q13 |
| c64 settings | Cooldown and churn budget are built and switched off | Live, but unenforced | Q15 |

## 4. Research

| Round | Sources | Verification | Ideas | Built from it |
|---|---|---|---|---|
| 1 (org design, self-improvement; evaluation and safety) | 17 + 14 = 31 | All abstract pages fetched (HTTP 200). Claims paraphrased. | Waves 1 to 3 (P1, P5, E1, P2 to P4, E3, O1 to O3, E4, M1) | c30 to c42, c46 and later |
| 2 (what is new, fits records-only) | 26 numbered (27 opened plus about 15 listed UNVERIFIED in the file) | 22 confirmed, 4 corrected (venue and wording fixes), 0 wrong | 10 candidates: 8 kept with changes or kept, 1 dropped (R2-4, duplicates pass^k), R2-7 kept but parked | c58 (R2-6, R2-9), c59 (R2-5), c60 (R2-10 attribution, R2-8), c61 (R2-1, R2-2, R2-3) |
| 3 (structure, performance, agent performance, operator UX) | 29 | 27 confirmed, 2 corrected (B5 "11x lower cost" is really about 5%; C4 has an empirical claim). A8 low trust (date). | 10 candidates: R3-1 folded into R3-7, R3-2 dropped for now, R3-3 kept but parked, 7 kept with changes | c63 (R3-8), c64 (R3-6), c65 (R3-10), c66 (R3-4), c68 (R3-9), c69 (R3-5), c72 (R3-7 + R3-1) **[pending merge]** |

Rule used: only citations in `phase2/*-verified.md` are cited. Round 1 showed that filters alone fail (adaptive attacks beat 12 defences), so the structural controls (policy outside the model, exact approval binding) came first. Licence note: the failure taxonomy paper is CC BY-NC-ND, so AXION keeps mode ids and short names with attribution and writes its own descriptions (Q10).

## 5. Measured results

All numbers are code-level. Load average is stated where the log gives it.

| Measure | Baseline (c00, b621fbb) | Now | Source |
|---|---|---|---|
| Server tests | 219 in 17 files | 3178 passed, 36 skipped (135 files, 1 skipped; serial) | MERGES.md batch 30 |
| Browser checks, api mode | auth 15/15, missions 23/23, stage 6 94/94 | auth 15/15, flows 23/23, stage 6 94/94, improve 108/108 (batch 27) | MERGES.md batches 12, 27, 29, 30 |
| Page switch (c07 threshold 179 ms) | median 163 ms, 60 fps idle | 168, 161, 174 ms at load 5.3 to 6.8; 60 fps idle. At load 17 to 20 the same script gave 316 and 284 ms, so a high load run is not a valid reading. | MERGES.md |
| c71 scale, 25k tasks, 3 per mission, load about 9 | scorecard 830/1027 ms (p50/p95), throughput 1090/1214, dimensions 2879/3000 | scorecard 440/519, throughput 139/164, dimensions 746/826 | cycles/c71-report.md |
| c71 budget test (every p95 under 1 s) | not applicable | 36/36 at load 7.7 to 8.5. Slowest p95 952 ms. Under 5% headroom on dimensions. | MERGES.md batch 30, c71 review |
| Api-mode fit at 1366x768 and 1280x760 | 10 BAD views (found in c64 lane) | ALL FIT, 79/79 (c67); ALL FIT four times after c69 | MERGES.md |
| Accessibility check | 0 violations | 0 violations: api 44 views, demo 54 views, 65 dialogs (batch 29). Screen reader check never done (Q8). | MERGES.md |
| Phone-width run (api-mobile) | not recorded | 651 states, 360 dialogs, 0 FAIL on the tree at ed3ed73. **Full run on the final tree [pending].** | MERGES.md |
| First-load JS, /missions | 307,502 B gzip | 243,127 B (c07). Not re-measured since. **[pending]** | LOG.md c07 |

### Proposed "Final" column for SCORECARD.md (not edited)

| Measure | Proposed Final value | Source | Caveat |
|---|---|---|---|
| Server tests | 3178 passed, 36 skipped, 135 files **[update after the final run]** | MERGES.md batch 30 | c72 to c75 will add more |
| Browser checks (api mode) | auth 15/15, flows 23/23, stage 6 94/94, improve 108/108 | MERGES.md batches 27 to 30 | The baseline row says "missions 23/23". The log names this suite "flows 23/23". I could not confirm they are the same suite. |
| Demo-mode suite (verify-all) | ALL 10 STEPS PASSED at batch 12; 10/10 in lanes through c73 | MERGES.md batch 12, LOG.md | Dialog smoke now 65 dialogs, the baseline said 104/0. Cause not confirmed. **Final run on the frozen tree [pending].** |
| Production build | **[pending]** final build | not in the files | Last known: first load 243,127 B gzip (c07) |
| Page switch, dev | median 168, 161, 174 ms at load 5 to 7, idle 60 fps | MERGES.md | Passes the 179 ms threshold |
| Agents > Proposals in api mode | Recorded server data, not DEMO | c05, c47, LOG.md | Count of rows is not a measurement |
| Company scorecard rows backed by recorded data | **[pending]** count from the final api run | LOG.md c02, c46 | Rows show a value with n, or "not enough evidence" |
| Agent metrics backed by recorded data | **[pending]** | LOG.md c03, c46, c72 | Reliability and dimension cells are recorded. Cells that need execution stay empty. |

## 6. Honestly NOT MET or limited

- **c61 judge calibration.** Coverage is 95.82% pooled, min cell 93.3%, on the lane's own 18 easy cells. The reviewer's fixed 48-cell grid with weak judges and unequal classes found 81.7% after the gate. The fix is fail-closed: judges need a margin of at least 0.5. Middling judges (true margin 0.35 and 0.45) still miss; some pinned cells sit at 66 to 93%. This is a scaffold. Nothing in the verdict path uses it. Open item E1e.
- **c72 "95%" is nominal.** Measured coverage on the reviewer's grid is below 95% in 11 of 36 cells (seed 4242, min 86.1%) and 9 of 36 (seed 9100001, min 86.7%). Power at a 1-logit difference is 15 to 17%. So it mostly refuses to compare. The simulation tests a model it defines itself. **[pending merge]**
- **c66 fixture is circular.** The 20% gamed fixture tests the flag on a model the fixture defines. 11 of 33 metric rows are flagged gameable. The write-site scan has stated limits (SQL comments, string concatenation, dynamic imports). Open items M2b and H20.
- **H14 mitigated, not solved.** The jobs test pool is cut to 8, and a mutation still catches the races. 1 run of 6 still hit the connection cap.
- **Fixture-only until agents execute.** Skill ratings (c72), failure patterns, review capacity, process metrics, retirement proposals (c59) and most dimension cells need execution data. The controls are tested. Real cells stay empty.
- **c44 page performance** was cleared as partial. c10 indexes were rated PARTIAL (gain small, noisy).
- **c52 item 5 NOT MET.** The 3 old test failures never reproduced and their names were never recorded.
- **Scale margin is thin.** Dimensions at 25,000 tasks had 916 to 977 ms against a 1000 ms limit. It would not survive a load of 15 or more.
- **Not verified by a person:** the long-thread behaviour with a real screen reader (Q8).
- **Final checks pending:** full api-mobile on the final tree, stage 6 run 20 times, final verify-all and fit on the frozen tree.

## 7. Release notes: behaviour changes already live

| Cycle | What changed for you |
|---|---|
| c30 | Demo `release` approvals moved from R2 to R3. R3 and R4 decisions need an admin (a member gets 403). |
| c51 | Reassigning a task needs a brief, and only an admin or the mission owner may reassign. |
| c53 | Models outside the vendor table cannot reach "verified better". Only the override path remains. |
| c56 | The server refuses to start if the public-suffix list hash, rule count or sentinels are wrong. |
| c58 | Approvals carry derived Rule-of-Two flags. A new approval-quality view shows admin-only per-approver figures. It never changes a decision. |
| c59 | Old agent-proposed playbook rows now show as origin class "tool" (fail closed). A per-playbook active cap of 25 applies (`PLAYBOOK_ACTIVE_CAP`). |
| c61 | Every pre-c61 eval run is now "inconclusive" (grader unknown). Pre-c61 datasets are "author unknown" and cannot be attested. Open proposal cards can go stale when grading changes. |
| c63 | Failure tags gain optional write-once detection fields. |
| c64 | Restructure proposals need 2 or more able reviewers per changed team and at most 6 escalation levels. Cooldown and churn budget are off by default. Two new required fields on the proposal POST. |
| c68 | The "Needs you" tab hides the Company Health / Scorecard header aside on that tab only (Q16). |
| c69 | The Process view sits next to Outcomes, with six cards. Approval time is measured only from 20 or more decisions. |
| c72 **[pending merge]** | Demo department heads are chosen from structure (same result as before). Agents "Top 5" and the hierarchy order by name, not by success rate. Ratings are labelled "nominal 95%". |
| c49 | The live server now needs `AUDIT_ANCHOR_KEY`, a domain and a file in `server/.env`. |

## 8. Your actions

1. **Copy `server/data/audit-anchors.jsonl` (2 lines now) off the machine.** Also store a copy of `AUDIT_ANCHOR_KEY` (in `server/.env`) somewhere safe off-host. Do not paste it in chat or commit it.
2. Answer Q1 to Q16 (section 9). The loop used the listed defaults meanwhile.
3. Set the Q15 values, or tell me to keep guardrails off. Suggested start: 24 h cooldown, 6 reporting-line changes per 7 days, 6 escalation levels.
4. Decide on the parked branches: take or drop c76 and c77 (Q11). Decide on c62 (Q12) and R3-3 (Q13). **[pending: c76 and c77 are not finished]**
5. Decide what to do with `improve-30h`. It is local only. Nothing was pushed, and the `release_1.0.0` tag was not moved. Options: push it, merge to `main`, tag it, or leave it. I will not do any of these without you.
6. Verify the long-thread screen-reader behaviour with NVDA or VoiceOver (Q8).

## 9. Owner questions Q1 to Q16

Default = what the loop used meanwhile.

| Q | Question | Context | Options and default |
|---|---|---|---|
| 1 | May any member who can see a shared mission decide its approvals? | Stage 5. | Yes (default, unchanged) or restrict. |
| 2 | Should the Active Missions and Pending Approvals tiles exclude DEMO missions in api mode? | They count DEMO now. | Include (default, a later cycle adds an "includes DEMO" hint) or exclude. |
| 3 | The Agent Profile shows a DEMO "Reliability" tile beside the measured one. Rename the tile? | Two similar names, each with its own chip. | Keep both (default) or rename. |
| 4 | DEMO tasks have no recorded attempts, so they never count. Fine? | Attempt-less failures count and attempt-less passes do not, which biases DEMO values down. | Leave it until execution records attempts (default). |
| 5 | Should direct edits of an agent's model, skills or tools need a version proposal and a second admin, as promotions do? | Stage 6 Edit. | No: single-admin, audited, versioned (default) or require it. |
| 6 | When several members of a department report to the GM, which one is the "head"? | Rule: most members under it, then lowest id. Card shows "1 of N to GM". | Keep (default) or choose another rule. |
| 7 | When a mission is staffed from the org chart, should recruits who report to the GM sit under the GM or under the mission's executor? | The GM is not counted as an in-mission supervisor. | Under the executor (default D1) or under the GM. |
| 8 | Please verify long-thread keyboard and screen-reader behaviour with NVDA or VoiceOver. | The message log no longer announces rows as they scroll. A status line announces others' messages. Arrow, PgUp, PgDn, Home and End move between messages. | Merged after fixes (default). You verify by hand. |
| 9 | Should a distinct owner role exist for R4 approvals? | Today an admin holds R4. With one admin, "decider is not requester" never bites (P3b). | Keep admin (default) or add an owner role. |
| 10 | Confirm the licence approach for the failure taxonomy. | The paper is CC BY-NC-ND. AXION keeps ids and short names with attribution and writes its own one-sentence descriptions. | Confirm (default) or change. |
| 11 | May Stage 8 and 9 records-only foundations (R1, A1, M2, G1) be built ahead of those stages' approval, or wait? | The spec ends each stage with "ask owner approval". | Built as parked, unmerged branches (default). Take or drop them. |
| 12 | Who holds the key for signed decision receipts (R2-7), where does it live, and how is it rotated? | Same custody question as the audit anchor key, which lives only in the live `server/.env`. | Until answered, test keys only. c62 not built. |
| 13 | May an agent's autonomy level (R3-3) ever be an input to the policy service, or is it display-only? | Research found no result supporting autonomy as a policy input. | Display-only (default). |
| 14 | Should AXION define a "read private company data" capability? | Without it, the Rule of Two flag (b) covers only live systems and credentials. An agent reading untrusted pages, company records and sending messages does not trigger it. | Not defined (default) or define it. |
| 15 | What values should c64's guardrails use? | Built, off by default (`ORG_COOLDOWN_HOURS`, `ORG_CHURN_BUDGET`, `ORG_CHURN_WINDOW_HOURS`, `ORG_MAX_ESCALATION_LEVELS`; 0 or unset means not enforced). | Suggested: 24 h, 6 changes per 7 days, 6 levels. Default: off. |
| 16 | Keep the hidden header aside on the "Needs you" tab, or fold the header on every Overview tab? | Hiding it fits 13 rows at 1366x768 instead of 9, because the header height changes between tabs. | Keep (default) or fold the header. |

## 10. Incidents and process lessons

- **Stale dev server, 3 times** (about 09:16Z and 16:08Z on 11-22, 02:22Z on 11-23). The 5190 watcher missed changes to `shared/contracts`. Builds were green while the dev server and 6 of 10 verify-all steps failed. Lesson: restart the dev server before blaming code. Integrators now curl a served contracts file. Fix is c74 **[pending]** (H19).
- **Role connection cap.** With 9 lanes the 45-connection database role limit made tests fail as "too many connections". The fix was in the gate: heavy.sh gives vitest 3 DB slots. Lesson: size gates by the scarcest resource.
- **Lock keys shared across test schemas** caused random 500s. Every lock key is now schema-scoped by one helper, with a guard test.
- **verify-all hid failures** for the first part of the loop (its exit code ignored sub-script FAILs). c21 fixed it. Lesson: test the gate by forcing a failure.
- **Wrong-process kill.** An agent killed the integrator's verify-all by PID. Rule: kill only processes you started.
- **c73 report described uncommitted code.** The report and a commit message named a fix that was not in the branch. The independent reviewer ran the lane's own check on the committed tip and it failed 2 of 3. A new rule in LANES.md: confirm `git status` is clean and the diff names every claimed file before reporting.
- **c71 reviewer tried a live-database read.** One read-only count on the real `axion` DB. The harness denied it, nothing ran, and the reviewer disclosed it. Every reviewer brief now states the live-DB ban directly.
- **Clock round trip.** Reading a DB time into JavaScript and using it as a SQL bound dropped rows about 1 run in 3. Every bound is now computed in SQL.
- **Coverage claims need a grid someone else fixes** (c61, c72), and an exclusion is not neutral (a tie became "verified better" 16 to 0).
- **Long lanes run out of context** (c54, c56, c60). Rule: start the final checks early, record background PIDs, hand back once.
- **All workers stopped once** (sign-in error, 11-21 ~19:20Z). Everything that matters now lives in git and the loop files.

## 11. Backlog: what's next

| Id | Item | Why |
|---|---|---|
| E1e | Judge-calibration gate without selection bias (c61) | The main open statistical gap. Coverage 66 to 93% in some cells. |
| H19 | Dev server watches `shared` | Third stale-server incident. c74 is in progress **[pending]**. |
| P3b | Second-approver rule and an owner role | "Decider is not requester" does not bite with one admin (Q9). |
| P3c | Approval evidence in the digest or chain | c75 in progress **[pending]**. |
| H20 | No-leaderboard guard gaps (renamed field, unrelated comparator) | A renamed rating field would pass the scan. |
| H14 | Jobs test connection footprint | Mitigated, not solved. |
| E1d | Holdout shopping remainders (soft hyphen and ZWJ folding) | Small gaps in the content key. |
| M2b | Metric guard follow-ups: typed `sample_ref`, wider loader tests | `sample_ref` is free text that can name demo data. |
| E4b | Role field on skills, so skills can be capped | The c59 cap covers playbooks only. |
| P4a | IDN site grants with a visible punycode check | All IDN hostnames are refused today. |
| H16, H17 leftover | 390 px tab-strip label overlap; dark-mode "Reports to" contrast | Phone and dark-mode polish. |

After agents execute: R3-2 (confidence-based escalation), R3-3 (Q13), and the signed receipts (c62, Q12).
