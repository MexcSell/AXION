# AXION improvement programme: final report

Status: **DRAFT 2**, rewritten 2026-11-23 about 09:55Z. The work after that time is marked **[pending]**: the last web lanes, the final checks on the frozen tree, and the final live update.

Periods covered:
- **30-hour loop:** 2026-11-21 11:36Z to 2026-11-22 17:36Z, cycles c01 to c52. Done.
- **Phase 2, "evolve for 28 hours":** 2026-11-22 17:45Z to 2026-11-23 21:45Z. Cycles c53 to c93, plus four research rounds (2 to 5).

Sources: everything is in `web/docs/improve/`.
- Process and planning: STATE.md, PHASE2.md, LOG.md, QUEUE.md, MERGES.md.
- Findings: BACKLOG.md, LESSONS.md, SCORECARD.md.
- Research: phase2/*.md.
- Each cycle's brief, report and review: cycles/.

## 1. Summary

- **Built:** cycles c01 to c93. c62 was not built. Two branches are parked for you: c76 and c77.
  - Every cycle went through the same steps: a brief, an implementer, an independent reviewer, a fix round, then a merge.
  - Everything is on the branch `improve-30h`. It is local only; nothing has been pushed and no tag was moved.
- **Live:** everything merged through batch 47 runs on the real `axion` database. The last live update was at 07:34Z, at schema version 59, after a backup and a restore check.
  - It covers batches through 42. The server parts of batches 43 to 47 go live at the final update **[pending, about 19:30Z]**.
- **Quality gates:**
  - **Server tests:** from 219 at the start to **3620 passed**, 0 failed, on the tree at 060f9ab.
  - **Demo suite:** verify-all passed all 10 steps.
  - **Phone-width run, api mode:** 877 states and 500 dialogs, no failures (tree ebea695).
  - **Fit and accessibility:** both fit checks are ALL FIT, and accessibility shows 0 violations.
- **Direction:** agents do not execute yet. So the programme built the measuring, safety and governance layers, not performance gains, and there is no agent or company performance number to compare. Phase 2's last day added three things:
  - **(a)** honest tools for "did a change help": change plans, a forecast ledger, a peek-safe sequential readout and a skill promotion gate;
  - **(b)** privacy sweeps that check every route automatically, between tenants and between members of one tenant;
  - **(c)** fixes for what those sweeps found.
- **Privacy findings fixed today:**
  - **Before merge:** reviews caught two aggregate leaks (c85, c86).
  - **From c87's generated sweep:** two more (review capacity counts, org proposal evidence).
  - **From c79's cross-tenant sweep:** one cross-tenant total (database size) and orphan acknowledgements (c81).
  - None of these reached a real second user; the live system has one tenant and no members.
- **Research:** five rounds, each checked by a separate verifier. Of the 34 candidate ideas from rounds 2 to 5:
  - 23 were built;
  - 4 are parked or wait for you;
  - 7 were dropped or deferred, with reasons (section 4).
- **Honest limits:** several statistical results are NOT MET or nominal, and the new statistics tools have low power at AXION's volumes (section 6).
- **Your actions:**
  - copy the audit anchor file and key off the machine;
  - answer Q1 to Q17;
  - decide on the parked branches and on the local branch (section 8).

## 2. What is live now

All rows are merged and live unless marked. Cycle ids are in brackets.

### Company structure
- **Org change:** organisation change proposals with a dry run, approval and a base-revision check (c01). Org history, before/after diff and rollback through approval (c04).
- **Staffing and coverage:** new missions are staffed from the active organisation (c11, c34). Capability coverage check (c20).
- **Restructure guardrails (c64):**
  - evidence is shown on each proposal;
  - at least 2 able reviewers per changed team;
  - at most 6 escalation levels;
  - cooldown and churn budget exist but are **off by default**.
- **Member view of evidence:** members now see "Counts visible to administrators" instead of the evidence counts, because those counts covered private missions (c88).
- **Change plans (c85, new):** an admin can attach a plan to an org proposal: one registry metric, a direction, a margin, a minimum n, a window and up to 3 guardrails.
  - The plan's sha is locked at approval, and later changes are append-only amendments.
  - An admin-only readout gives **counts per window only**: "not enough evidence yet" or "ready for analysis (not computed in this version)".
  - It records what was planned before the change; it gives no verdict. The plan view in the app is **[pending, c89]**.
- **Failure learning:** a repeated failure (3 or more, in 2 or more departments, in 30 days) opens a candidate lesson for review (c63).
- **Records and briefs:** department facts from recorded data (c06). Typed delegation briefs, required on every reassignment (c42, c51). Mission ledgers (c39).
- **Demo department heads** are chosen from the structure (c72).

### Company performance
- **Scorecards:**
  - the company scorecard comes from recorded events, with n and evidence on every row (c02);
  - throughput trend (c12);
  - six-dimension scorecard with no composite number (c46, c54).
- **Process metrics** sit next to outcomes: rework, first pass, duplicate delegations, reassign churn, hand-off wait and approval time (c69).
- **Review capacity:** the queue waiting for a person, per department, with the arrival rate and waits (c65). Below the privacy floor, members now see the open counts as hidden (c87).
- **Scorecard at scale:** indexes and one freshness rule (c71, c10).
- **Metric-gaming guard:** a registry of 33 metrics, an audit-label route and a write-site scan (c66).
  - Audit labels now name a typed record, and free text is refused (c83).
  - A column-level scan checks every loader against the registry (c83, c88).
  - 10 counter-metrics were re-pointed to independent inputs, and 6 are honestly marked "weak" (c83).

### Agent performance
- **Reliability and versions:** agent reliability from recorded task history (c03). Version proposals with promote and rollback; the author cannot promote their own (c05, c47).
- **Experiment verdicts:** paired sign test, confidence interval, an explicit "inconclusive", pass^k, cost next to accuracy, and a holdout split (c13, c32).
- **Eval-run integrity:** no re-run shopping, resumable runs, judge labels (c53). Instrument audit, dataset attestation and judge calibration (c61).
  - The judge gate now uses sample splitting (c84). It cuts the cells below 93% coverage from 12–13 to 1 on the fixed grid.
- **Skills and memory:** mentoring plans (c19), reviewed playbooks and a skill library (c41), origin-bound memory and skill records (c59).
- **Independent task review:** the producer cannot verify its own task (c38, c51).
- **Failure modes:** 14 modes, tagged with agent, step and attribution (c33, c60).
- **Skill ratings (c72):** adjusted for task difficulty, with no leaderboard. Scans guard any rating field against being sorted into a ranking (c72, c78).
- **Forecast ledger (c86, new):** a person can record the chance that a task is accepted at its first review, before that review exists.
  - Each forecast gets Brier and log scores, calibration bins and a reference-class baseline. The baseline counts only missions the viewer can see.
  - There is no leaderboard: you see only your own scores, and an admin sees one person at a time.
  - The screens are **[pending, c89]**.
- **Not wired to any page yet:**
  - a peek-safe sequential readout library (c90);
  - a skill promotion gate with two probes, a regression budget and a leakage check (c91).
  Both are tested by simulation only.

### Safety, privacy and governance
- **Policy:** a deterministic policy service. The approval tier is derived on the server; R3 and R4 need an admin (c30, c48).
- **Approvals:** approval binding v2 with an exact action digest, single use (c35). Approval evidence is now tamper-evident: every approval request adds an audit-chain row (c75).
- **Audit chain:** tamper-evident, with a verify route (c31). It has an anchor outside the database, now 4 lines (c49).
- **Migration guard (c80):** append-only tables are found from the catalog and must carry all four guards. Every new migration is linted against a frozen baseline.
- **Tenant isolation (c79, c81):** a test suite generated from the route table. It includes:
  - a metamorphic sweep;
  - a tenant-id swap;
  - 75 forged ids;
  - storage checked on every table through foreign keys;
  - 23 seeded leaks, all caught.
  It found no leak of data; c81 fixed the findings.
- **Visibility inside one tenant (c87, new):** a generated sweep checks that a member learns nothing about another member's private mission. It covers responses, markers, ids and the live event stream.
  - 11 seeded leaks are all caught.
  - It provably catches the c86 baseline bug: re-introducing that bug fails the sweep.
- **Site grants and browser actions:** an exact-origin normaliser (c36), a pinned Public Suffix List with an age warning (c56, c73), and a browser action contract with no execution (c37).
- **Other controls:** Rule-of-Two flags and approval-quality records (c58). HTTP hardening and rate limits (c14). Durable job records (c45).

### Evaluation integrity
- **Holdouts and clocks:** a holdout content key, a regrader-is-author check, and SQL clock bounds (c70, c54).
- **OpenTelemetry:** a mapping and a local OTLP-JSON export (c60, c73). **Never run it on the live DB.**

### Operator UX
- **"Needs you" queue:** an attention queue on Overview (c68).
- **Threads:** long threads load fast and are virtualised (c22, c26, c44, c55). Following a fast burst now stays pinned (c73).
- **Loading and fit:** loading states are announced (c23). Phone-width fit (c24, c40). Agent Profile fits one screen (c18, c67).
- **Help:** an owner guide in the app (c17). Command palette fixes (c28).
- **Phone tab strips (c82):** at 390 px the tab strips scroll instead of overlapping **[pending merge]**.

### Engineering health
- **Speed and gates:** a smaller first load (c07). Honest exit codes in verify-all (c21).
- **Flaky checks fixed:** c08, c25, c29, c43, c57, c78, and c82 [pending].
- **Contract tests** are generated from the route table (c50).
- **Dev server:** it now watches the shared contracts by polling, which ended the stale-server incidents (c74).
- **Live ports:** web scripts refuse to fall back to the live ports when run from a lane (c92).
- **Connection cap:** test-suite resilience to the shared database connection cap **[pending, c93]**.

## 3. Built but parked for your decision

| Item | What it is | Status | Waits for |
|---|---|---|---|
| c76 | Stage 8 records: release, last-good and rollback-target records, artifact metadata and hashes (R1, A1). Migration 0056. No route performs a release. | CLEARED at dfd1bff on branch `c76-stage8-records`; never queued; no live migration | Q11 |
| c77 | Stage 9 records: usage ledger with budget caps, model registry, routing policy (M2, G1). Migration 0057. Fake adapter only. | CLEARED at da75e62 on branch `c77-stage9-records`; never queued; no live migration | Q11 |
| c62 | Signed decision receipts with an offline verifier (R2-7) | Not built. Test key only until you answer. | Q12 |
| R3-3 | Earned-autonomy ladder, display-only | Not built | Q13 |
| c64 settings | Cooldown and churn budget | Live, but switched off | Q15 |
| c85 scope | Which kinds of change carry a plan | Org proposals only | Q17 |

## 4. Research

| Round | Sources | Verification | Ideas | Built from it |
|---|---|---|---|---|
| 1 (org design, self-improvement; evaluation and safety) | 31 | Abstract pages fetched; claims paraphrased | Waves 1 to 3 | c30 to c42, c46 and later |
| 2 (what is new, fits records-only) | 26 numbered | 22 confirmed, 4 corrected, 0 wrong | 10: 8 kept, R2-4 dropped, R2-7 parked | c58, c59, c60, c61 |
| 3 (structure, performance, agent performance, operator UX) | 29 | 27 confirmed, 2 corrected | 10: R3-1 folded into R3-7, R3-2 dropped, R3-3 parked, 7 kept | c63, c64, c65, c66, c68, c69, c72 |
| 4 (retention, tenant isolation, incidents, freezes, migrations) | 16 | 14 confirmed, 1 corrected, 1 overstated | 6: R4-4 and R4-6 built, R4-2 needs a v2 chain, R4-1/3/5 need your targets | c79, c80 (and c81, c87 from what they found) |
| 5 (did a change help; making agents better) | 26 numbered | 23 confirmed, 3 corrected (licences, venue); one attribution overstated | 8: R5-1, R5-7, R5-4 and R5-5 built as first slices; R5-8 not started (needs a table); R5-2, R5-3 and R5-6 not today (no power at our volumes, or needs execution) | c85, c86, c90, c91 |

Two rules held throughout:
- Only citations in `phase2/*-verified.md` are used.
- The fetch tool gave page summaries, so no paper body was read. Round 5's evidence for few-unit causal methods comes from marketplaces and economics panels, so applying it to AXION is the researcher's own extrapolation, and the report labels it that way.

## 5. Measured results

All numbers are code-level. The load average is stated where the log gives it.

| Measure | Baseline (c00, b621fbb) | Now | Source |
|---|---|---|---|
| Server tests | 219 in 17 files | **3620 passed**, 36 skipped, 0 failed (175 files, serial), tree 060f9ab **[final run pending]** | MERGES.md batches 45–47 |
| Demo suite (verify-all) | 10 steps | ALL 10 STEPS PASSED (integration tree, 2026-11-23 ~06:07Z and after batch 47) | LOG.md |
| Phone-width run (api-mobile, api mode) | not recorded | 877 states, 500 dialogs, NO FAILURES on ebea695 (07:30Z). **Final run on the frozen web tree [pending].** | LOG.md |
| Stage 6 suite, api mode | 94/94 | 20 of 20 runs at 94/94 (load 5 to 8) | MERGES.md |
| Api-mode fit at 1366×768 and 1280×760 | 10 BAD views | ALL FIT (every batch); **final [pending]** | MERGES.md |
| Accessibility | 0 violations | 0 violations in both modes on every web batch; **final [pending]** | MERGES.md |
| Page switch (threshold 179 ms) | median 163 ms | 168, 161, 174 ms at load 5 to 7 | MERGES.md |
| c71 scale, 25k tasks | scorecard 830/1027 ms (p50/p95) | 440/519; slowest p95 952 ms | cycles/c71-report.md |
| c84 judge gate, 72-cell grid, 2 seeds | 12 and 13 cells under 93% coverage | 1 cell under 93% (88.1%, pinned) | cycles/c84-report.md |
| c79/c81/c87 seeded leaks | none | 23 cross-tenant and 11 in-tenant seeded leaks, all caught | cycles/c81, c87 reports |
| First-load JS, /missions | 307,502 B gzip | 243,127 B (c07). **Re-measure [pending].** | LOG.md c07 |

SCORECARD.md "Final" column: **[pending]**, filled from the final runs.

## 6. Honestly NOT MET or limited

- **c84 judge gate.**
  - One grid cell stays at 88.1% coverage on both seeds and is pinned.
  - The pilot/holdout split is seeded by a hash of the calibration counts, so its independence is heuristic. A seed from item ids or a salt is backlog E1f.
  - At 20 labels per class some intervals span 0 to 1. Such an interval is honest but says nothing.
- **c72 "95%" is nominal.** Coverage on the reviewer's grid is below 95% in about a third of cells (min about 86%). Power at a 1-logit difference is 15 to 17%, so it mostly declines to compare.
- **c90 sequential readout: valid, but very conservative.**
  - On no-effect streams it never wrongly excluded zero, while naive re-checking did so 32 to 40% of the time.
  - It detects a 0.3 vs 0.5 difference only about 4% of the time at 100 per arm, and about 25% at 200 per arm.
  - At AXION's volumes it will usually say "not enough evidence". Nothing uses it yet.
- **c91 skill gate: tests the gate, not any skill.**
  - With noisy synthetic candidates the false admit rate was 0.4 to 0.9% (bound 2%).
  - The 0.02 replay budget is smaller than the replay noise at n ≤ 40, so a harmless candidate is refused 56 to 74% of the time.
  - Real scores need agents to execute.
- **c85 and c86 are first slices.** c85 gives counts only and computes no effect. c86 covers human forecasts of one question only. Their screens are **[pending, c89]**.
- **The c66 fixture is circular**, and 6 counter-metrics stay "weak" (c83).
- **Connection-cap flakes:**
  - The 45-connection role cap caused about 6 unrelated test failures today, each passing alone. c93 is meant to fix this **[pending]**.
  - The c82 api a11y run also printed "Request failed (500)" on two views, probably the same cause. To be checked in the final run **[pending]**.
- **Fixture-only until agents execute:** skill ratings, failure patterns, review capacity, process metrics, the skill gate and most dimension cells.
- **Scale margin is thin:** dimensions at 25,000 tasks ran 916 to 977 ms against a 1000 ms limit.
- **Not verified by a person:** long-thread behaviour with a real screen reader (Q8).
- **One residual, accepted:** with more than one tenant, the health page omits the database size. That omission reveals that a second tenant exists, a single bit.

## 7. Release notes: behaviour changes now live (or live at the final update)

| Cycle | What changed for you |
|---|---|
| c30 | Demo `release` approvals moved from R2 to R3. R3 and R4 decisions need an admin. |
| c51 | Reassigning a task needs a brief, and only an admin or the mission owner may reassign. |
| c53 | Models outside the vendor table cannot reach "verified better". |
| c56 | The server refuses to start if the public-suffix list does not match its pinned hash. |
| c58 | Approvals carry derived Rule-of-Two flags, and an admin-only approval-quality view. |
| c59 | Old agent-proposed playbook rows show as origin class "tool". There is a per-playbook active cap of 25. |
| c61 | Pre-c61 eval runs are "inconclusive"; pre-c61 datasets are "author unknown". |
| c64 | Restructure proposals need 2 or more able reviewers per changed team, and at most 6 escalation levels. |
| c68, c69 | "Needs you" tab; a Process view next to Outcomes. |
| c72 | Agents "Top 5" and the hierarchy order by name, not by success rate. Ratings are labelled "nominal 95%". |
| c73 | Tool names may contain hyphens; more secret shapes are refused in exports; the PSL age shows on System Operations. |
| c75 | **Every approval request now adds an audit-chain row.** |
| c81 | With more than one tenant, the health page omits the database size. Acknowledging a notification you can't see returns 404. Department member order is fixed. A NUL byte in a request gives 400, not 500. |
| c83 | Metric audit labels must name a typed record (`mission:<id>` …); free text is refused. 6 counter-metrics show "weak counter-metric". |
| c84 | The judge gate uses sample splitting. Some judges admitted before are now "judge too weak", and intervals are wider. |
| c85 | Approving an org proposal that has a plan needs its plan sha (`PLAN_SHA_REQUIRED` otherwise). Proposals without a plan are unchanged. |
| c86 | A new forecast route; reviews now take a per-task lock. |
| c87 | Members below the privacy floor see the review-capacity open counts as hidden. |
| c88 | Members see org proposal evidence as "Counts visible to administrators". |
| c82, c89, c93 | **[pending]**: phone tab strips scroll; plan and forecast screens; connection retry on "too many connections". |
| c49 | The live server needs `AUDIT_ANCHOR_KEY`, a domain and a file in `server/.env`. |

## 8. Your actions

1. **Copy `server/data/audit-anchors.jsonl` off the machine.** It has 4 lines now, and gets one more at the final update. Also store a copy of `AUDIT_ANCHOR_KEY` (in `server/.env`) safely off-host. Never paste the key in chat or commit it.
2. Answer Q1 to Q17 (section 9). The loop used the listed defaults meanwhile.
3. Set the Q15 values, or tell me to keep the guardrails off.
4. Take or drop the parked branches c76 and c77 (Q11). Decide on c62 (Q12) and R3-3 (Q13).
5. Decide what to do with `improve-30h`: push it, merge it to `main`, tag it, or leave it. It is local only, and I will do none of these without you.
6. Verify long-thread screen-reader behaviour by hand (Q8).

## 9. Owner questions Q1 to Q17

"Default" means what the loop used meanwhile.

| Q | Question | Context | Options and default |
|---|---|---|---|
| 1 | May any member who can see a shared mission decide its approvals? | Stage 5. | Yes (default) or restrict. |
| 2 | Should the Active Missions and Pending Approvals tiles exclude DEMO missions in api mode? | They count DEMO now. | Include (default) or exclude. |
| 3 | Rename the DEMO "Reliability" tile on the Agent Profile? | Two similar names, each with its own chip. | Keep both (default) or rename. |
| 4 | DEMO tasks have no recorded attempts, so they never count. Fine? | This biases DEMO values down. | Leave it until execution (default). |
| 5 | Should direct edits of an agent's model, skills or tools need a version proposal and a second admin? | Stage 6 Edit. | No: single admin, audited, versioned (default). |
| 6 | When several department members report to the GM, which one is the "head"? | The rule: most members under it, then the lowest id. | Keep (default) or choose another rule. |
| 7 | Should GM-reporting recruits sit under the GM or under the mission's executor? | The GM is not an in-mission supervisor. | Under the executor (default). |
| 8 | Please verify long-thread keyboard and screen-reader behaviour with NVDA or VoiceOver. | Arrow, PgUp, PgDn, Home and End move between messages. | You verify by hand. |
| 9 | Should a distinct owner role exist for R4 approvals? | With one admin, "decider is not requester" never bites. | Keep admin (default) or add the role. |
| 10 | Confirm the licence approach for the failure taxonomy (CC BY-NC-ND). | AXION keeps ids and short names, with attribution, and writes its own descriptions. | Confirm (default). |
| 11 | Take or drop the Stage 8 and 9 records branches (c76, c77)? | Built as parked, unmerged branches. | Parked (default). |
| 12 | Who holds the key for signed decision receipts, and how is it rotated? | Same custody question as the audit anchor key. | Test keys only; c62 not built. |
| 13 | May an agent's autonomy level ever be an input to the policy service? | No research result supports it. | Display only (default). |
| 14 | Should AXION define a "read private company data" capability? | Without it, Rule-of-Two flag (b) covers only live systems and credentials. | Not defined (default). |
| 15 | What values should c64's guardrails use? | Built, off by default. | Suggested: 24 h cooldown, 6 changes per 7 days, 6 escalation levels. Default: off. |
| 16 | Keep the hidden header aside on the "Needs you" tab? | Hiding it fits 13 rows instead of 9. | Keep (default). |
| 17 | Which kinds of change should be allowed or required to carry a change plan? | c85 covers org proposals only. | Org proposals only, optional (default); or also process toggles and version promotions; or required. |

## 10. Incidents and process lessons

- **Stale dev server, 3 times.** The watcher missed changes to shared contracts. c74 switched the dev server to polling, and it has not recurred since.
- **Role connection cap.** The 45-connection limit, shared by every lane, is the main source of flaky tests. heavy.sh gates the DB slots, and c93 adds bounded pools and a retry when connecting **[pending]**.
- **Aggregates leak too.** Three of today's privacy findings were counts or rates computed over private missions, not raw data.
  - A cross-tenant suite cannot see this. So c87 added an in-tenant sweep, and it immediately found two more such counts.
  - Lesson: every new aggregate is computed over what the viewer can see, or carries a cited privacy ruling.
- **Reports can describe uncommitted code** (c73). The rule now: `git status` must be clean and the diff must name every claimed file before reporting.
- **Live-port and live-DB slips:**
  - one reviewer tried a read-only count on the live DB (denied);
  - one loaded a page on the live web port, because a script defaulted to it.
  Both were disclosed. Briefs now state the rules, and c92 makes scripts refuse that default.
- **Statistics need an outside check:**
  - c90's 5% claim was really 10%, because a one-sided bound was used two-sided;
  - c84's split was only heuristically independent;
  - c91's fixtures were too easy.
  Independent reviewers caught all three before merge.
- **Clock round trip.** Every time bound is now computed in SQL.
- **API overload, about 09:40Z.** Three agents stopped mid-task on server errors. Their work was in git and was resumed.
- **Long lanes run out of context.** The rule: start the final checks early, record background PIDs, hand back once.

## 11. Backlog: what's next

| Id | Item | Why |
|---|---|---|
| U8 rest | Plan editing in the app, and an admin per-person forecast view if c89 didn't build it | c85 and c86 screens are first slices |
| E1f | Seed the judge split by item ids or a salt; consistent displayed sensitivity and specificity | c84 review |
| T1(1) | Tenant-scoped agent ids (composite key) | A second tenant can't get the standard company seed. Large migration. |
| R4-2 | Audit chain v2 for redaction | Redacting today breaks verification |
| M2c, M2d rest | Scanner edge cases, counters that only "stay flat" | c83 review |
| R5-8 | Handoff completeness record | Needs a small table |
| R5-3, R5-2 | Few-unit causal readouts, randomised schedules | Only once there are enough units |
| P3b, E4b, P4a, H22 rest | Owner role, skill role cap, IDN grants, residual harness races | See BACKLOG.md |

After agents execute: R3-2, R3-3 (Q13), R5-5 with real scores, R5-6, and signed receipts (c62, Q12).

## 12. Next phase: letting agents execute, step by step (research round 6, verified)

Round 6 asked what it takes to let agents actually run tools, safely and measurably. It used 22 sources; 16 were confirmed and 6 corrected, none wrong.
- **What the evidence says:** filters and prompt-level defences fail against adaptive attackers. Structural controls help: a policy outside the model, plan conformance, and least-privilege tool policies. The best-known results are the authors' own benchmark numbers, not independent tests.
- **What it leaves open:** nothing measures staged rollout, kill switches or caps. Those are engineering controls.

**Already built today (pure modules, nothing executes):**
- **c94:** an execution-profile validator and request decider, deny by default.
- **c95:** a run-budget and halt checker.
- **c96:** a plan-conformance checker.
- **c97:** outcome graders and a tamper tripwire on toy tasks.

The roadmap uses phases A to E, so the numbers don't collide with the stage ledger's own stages. Every phase ends in your decision; demotion is automatic and promotion is human. No model call happens before your approval O3.

| Phase | What gets built | Exit check | Your decision |
|---|---|---|---|
| A. No execution, no model | Trajectory record schema, hash-chained into the audit log (R6-3, needs one migration). The halt-record table for c95. Binding the profile hash and caps into the approval digest (a digest version change). | Fixtures pass; you read the profile for one task class. | **O1:** approve one execution profile and egress allowlist, for one read-only browsing class over origins you have already granted. **O1b:** approve the approval-digest version change. |
| B. Still no model | A real sandbox and egress proxy that enforce c94's decisions. A credential broker contract with a fake broker (R6-2). Label propagation for plan conformance (R6-8 part 2). The stage-ledger evidence calculator (R6-4). | The c94–c97 thresholds hold in the real sandbox. The extra-approval share on benign fixtures is measured. | **O2:** approve the plan-conformance policy and the extra-approval share you accept. |
| C. Shadow | The first real model call, in an isolation tier, with no credentials and stubbed or read-only tools. Runs are recorded and graded. Agents propose; nothing runs. | A readiness report with your run floor, no severe incident, and agreement above your bound. | **O3:** approve the first model call, the provider, the per-lease budget and the run floor. |
| D. Confirmed execution | Tools run, with each consequential step approved through an exact digest, plus a **real** credential broker scoped per task. | The readiness gate holds per class, and the broker is reviewed. | **O4:** approve the real broker, then promotion per class, with the evidence page open. |
| E. Bounded autonomy | Only for reversible, low-tier actions under caps. A canary with a concurrent control for every agent-version change (R6-6). | The canary abort rule is tested. | **O5:** approve each class and each canary plan. A severe incident drops the class back to D automatically. |

Throughout:
- the Rule of Two stays on;
- no phase is skipped;
- the thresholds and floors are your risk decisions, not results from research.
