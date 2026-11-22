# Verified citations: research-r3.md (2026-11-22)

Independent check. All 29 numbered sources (A1-A9, B1-B7, C1-C5, D1-D3, E1-E5) were opened in this session by page fetch of the arXiv abstract page. For A8 and C3 I also read the arXiv API record (published and updated dates) and, for A8, the PDF header and metadata. For B3 I read the API record to get the first authors. arXiv pages give title, authors, v1 date, comments, licence and abstract, so every number below is an abstract claim by the authors, not something I checked in a paper body. A venue is accepted only if it shows on the arXiv page. No venue site was opened for this round. Dates are v1.

Counts: **27 CONFIRMED, 2 CORRECTED (B5, C4), 0 OVERSTATED, 0 WRONG, 0 UNCONFIRMED.** A8 is CONFIRMED on content but carries a date anomaly flag (section 2). The "Not opened" list and the Gaps list in research-r3.md were not checked by me and stay UNVERIFIED.

## 1. Source table

| ID | arXiv | Verdict | Check result |
|---|---|---|---|
| A1 | 2603.11011 | CONFIRMED | Title, sole author Xingrui Gu, v1 11 Mar 2026, CC BY 4.0. Page comment: accepted by a CHI'26 **workshop** (the workshop is on LLM use as simulated research participants, not on delegation; the page's own typo "Accepeted"). Abstract also mentions two predictive probes with 5-fold cross-validation, no numbers (file says no accuracy numbers: right). Single author. |
| A2 | 2604.08588 | CONFIRMED | Title, 2 authors, v1 31 Mar 2026, no venue, CC BY 4.0. Five domains (demand forecasting, content recommendation, moderation, loan approval, driving), thresholds "not predicted by architecture or scale", miscalibration model-specific, SFT on chain-of-thought most robust: match. No numbers. |
| A3 | 2603.07972 | CONFIRMED | Title, 5 authors, v1 9 Mar 2026, no venue, CC BY 4.0. HILA, GRPO inner loop with cost-aware reward, continual-learning outer loop: match. No numbers. |
| A4 | 2506.06576 | CONFIRMED | Title, 7 authors, v1 6 Jun 2025, "Preprint", arXiv non-exclusive licence. 1,500 workers, 844 tasks, 104 occupations, four zones, Human Agency Scale: match. |
| A5 | 2601.13865 | CONFIRMED | Title, 5 authors, v1 20 Jan 2026, no venue (a DOI is listed), CC BY-NC-SA 4.0. 12 practitioners, CrafTeam probe, "directly orchestrated agents": match. |
| A6 | 2605.28433 | CONFIRMED | Title, 2 authors, v1 27 May 2026, no venue (33 pages), arXiv non-exclusive licence. Five contracts (capability, communication, validation, aggregation, output protocol), commit only if contracts preserved and score improves: match. The framework is called SERO and uses a contextual-bandit controller; the file does not mention that. No numbers. |
| A7 | 2601.17152 | CONFIRMED | Title, 5 authors, v1 23 Jan 2026, no venue, arXiv non-exclusive licence. "up to 74.8%" over uniform and "up to 29.7%" over random: match. Meta-Debate selects models per role; benchmarks are problem solving. |
| A8 | 2609.04217 | CONFIRMED (date flag) | Title, six authors (David Dylan, Aoife Brennan, Cian Murphy, Niamh O'Sullivan, Conor Kelly, Saoirse Walsh) match the page, the API and the PDF header. No venue, CC BY 4.0. Numbers match the abstract: 0.769 vs 0.754, p = 0.80, 1.8 times more evaluation calls, gains attributed to the executor, WebShop no effect, 2-3 times more free compute only matched. Also: one frozen **7B** backbone, Planner-Executor-Critic role prompts, ALFWorld and WebShop only. **Date flag:** abstract page and API say v1 published 25 Jun 2026, but the id prefix is 2609 and the PDF's metadata date is 2026-09-07. I could not resolve this. Cite the id and say "v1 date per page: 25 Jun 2026; id and PDF metadata suggest Sep 2026". Provenance is unusual (six authors, no venue, no comment, 7B model), so treat it as low trust and never as the only support for a design rule. |
| A9 | 2503.18238 | CONFIRMED | Title, Harang Ju and Sinan Aral, v1 23 Mar 2025, 76 pages, CC BY 4.0. 2,234 participants, 11,024 ads, 50% more ads per worker, text quality higher for human-AI and image quality higher for human-human, diversity collapse: match. Also a field experiment on X with about 5 million impressions (not mentioned in the file). |
| B1 | 2603.28063 | CONFIRMED | Title, 2 authors, v1 30 Mar 2026, 16 pages, no venue, arXiv non-exclusive licence. Five axioms, distortion index, coverage toward zero as tools grow, Goodhart-to-Campbell transition is a conjecture with partial formal analysis, no empirical numbers: match. It builds on Holmstrom-Milgrom (1991). |
| B2 | 2603.11337 | CONFIRMED | Title, 2 authors, v1 11 Mar 2026, no venue, arXiv non-exclusive licence. Two vectors, scripted attacks succeed in mutable workspaces, "about 50%" of natural-agent episodes with tampering attempts, locking eliminates them, 25-31% median overhead: match. Three tasks, two backbones. |
| B3 | 2601.00481 | CONFIRMED | Title, 11 authors (Tie Ma, Yixi Chen, Vaastav Anand, ...), v1 1 Jan 2026, no venue, CC BY 4.0. 12 MAS, structurally stable but temporally variable, architecture dominant driver: match. |
| B4 | 2605.06557 | CONFIRMED | Title, 3 authors, v1 7 May, v2 16 Oct 2026, "Under review", CC BY 4.0. Four diagnostics, STAT testbed, near-identical return with different coordination, reward-shaping ablation: match. RL, not LLM agents, as the file says. |
| B5 | 2604.01212 | **CORRECTED** | Title, 7 authors, v1 1 Apr 2026, 16 pages, no venue, CC BY 4.0. 12 models x 3 seeds, three models above $200K, scratchpad strongest predictor, 47% of bankruptcies from adversarial-client detection: match. Correction: the file says one model "matched the top results at 11 times lower inference cost". The abstract gives the top at $1.27M (Claude Opus 4.6) and GLM-5 at $1.21M with 11x lower cost, so it came **close** (about 5% lower final funds), not matched. |
| B6 | 2606.18543 | CONFIRMED | Title, 3 authors, v1 16 Jun, v2 22 Jul 2026, no venue, CC BY 4.0. 500 days, three models above the 1M start, "all evaluated models remain below the rule-based baseline": match. |
| B7 | 2603.16054 | CONFIRMED | Title, 6 authors, v1 17 Mar 2026, "Work in progress", CC BY 4.0. M/G/c plus discrete-event simulation, P99 TTFT SLO, seven scenarios: match. GPU inference only. |
| C1 | 2604.00594 | CONFIRMED | Title, 5 authors, v1 1 Apr, v2 20 Jul 2026, no venue, CC BY 4.0. IRT with task features, LLM-versus-scaffold split, prediction on unseen benchmarks: match. No numbers. |
| C2 | 2604.12191 | CONFIRMED | Title, 8 authors, v1 14 Apr 2026, no venue, arXiv non-exclusive licence. 35 maths dimensions, 41 models, AUC 0.80-0.89 within and 0.77-0.86 across benchmarks: match. Extends to physics (27), chemistry (58), computer science (12). |
| C3 | 2606.09833 | CONFIRMED (date flag) | Title, 6 authors, CC BY-NC-SA 4.0. Page and API: v1 20 Apr 2026 (id 2606 does not match that month; the API also lists a v2 on 25 Jul 2026, which may explain it, so the date is real as shown). Comment "10 pages of main paper, COLM 2026" (venue claim rests on the arXiv comment only). 93 workers, over 1,500 prompts, 386 sessions, Bayesian skill rating: match. Abstract also names Codex as leading on autonomous benchmarks and Claude Code first on this one. Do not copy text. |
| C4 | 2606.04321 | **CORRECTED** | Title, 2 authors, v1 3 Jun 2026, "Submitted to ACM AI Leadership Summit 2026, Visionary Papers Track", 5 pages, arXiv non-exclusive licence. Correction 1: the file says the abstract "reports no quantitative results" and calls it only a position paper. The abstract also claims an empirical result on an open professional corpus (detecting drift and switching techniques at runtime recovers degraded quality dimensions) but gives no numbers. So: no numbers, but not purely conceptual. Correction 2: R3-3 credits C4 with a "withdrawal trigger". The abstract mentions runtime drift correction and per-skill tiers gated by human approval; it does not mention demotion or withdrawal. Do not cite C4 for demotion. |
| C5 | 2605.19151 | CONFIRMED | Title, sole author Changkun Ou, v1 18 May 2026, no venue, CC BY-NC-ND 4.0. Gaussian-process posterior over latent risk tolerance, probit likelihood on approve/deny, escalates where outcome is most uncertain, allow/block/ask regions, no numbers: match. Single author, formalisation only. Do not copy text or build derivative text. |
| D1 | 2609.11030 | CONFIRMED | Title, 5 authors, v1 10 Sep 2026, no venue, CC BY-SA 4.0. 487 records, 336 where the agent acted, 81 with realised harm (24%), second reviewer on all records, "not failure-rate or control-efficacy estimation": match. Add what the file omits: the authors say the 24% reflects how the collection was assembled, not deployment risk. So never quote 24% as a rate. Share-alike if text is copied. |
| D2 | 2606.14589 | CONFIRMED | Title, sole author Wei Wu, v1 12 Jun 2026, 18 pages, no venue, CC BY 4.0. 22 incidents over eight weeks, at least 28 occurrences of the meta-pattern, about 70% caught by user-view observation, 15-incident audit with 0% ex-ante prevention and 87% regression blocking: match. One author, one runtime (a personal-assistant runtime with its own governance engine published by the author). Own data. |
| D3 | 2603.06847 | CONFIRMED | Title, 4 authors, v1 6 Mar 2026, no venue, CC BY 4.0. 13,602 issues and pull requests, 40 repositories, 385 faults, 34 fault types, four dimensions, 145 practitioners, Apriori association rules: match. |
| E1 | 2610.27801 | CONFIRMED | Title, 7 authors, v1 20 Oct 2026, no venue, CC BY 4.0. Within-subject N=36 (plus a formative N=12 the file does not mention), correct / silent defect / visible failure, gaze and physiology, "often highly confident while missing silent defects": match. Programming tasks. |
| E2 | 2606.05391 | CONFIRMED | Title, 3 authors, v1 3 Jun 2026, no venue, CC BY 4.0. 17 developers, four forms of oversight work, tests treated as assurance: match. |
| E3 | 2609.24234 | CONFIRMED | Title, 6 authors, v1 21 Sep 2026, "Under Review", CC BY 4.0. 19 developers, Sheridan reworked into seven stages with loops, effort in planning, supervision delegated to other agents, reusable assets: match. Also applied to public Reddit discussions. |
| E4 | 2610.16410 | CONFIRMED | Title, 7 authors, v1 12 Oct 2026, "29 pages, 10 figures, Pre-Print", CC BY 4.0. Eight tutors, three months, three challenges (stimulation, mastery, relatedness), mixed UI results: match. |
| E5 | 2602.05446 | CONFIRMED | Title, 7 authors, v1 5 Feb 2026, no venue (an ACM DOI is listed), arXiv non-exclusive licence. Three layers (activities, actions, operations), natural-language probing, user study "significantly" better, no numbers: match. |

## 2. Maturity and licence notes

- No source is confirmed as peer reviewed at a main venue by its arXiv page. Workshop: A1. "COLM 2026" on the arXiv comment only: C3. "Under review": B4, E3. Submitted or pre-print: C4, E4, A4. Everything else has no venue.
- Date anomalies: A8 (id 2609, page v1 25 Jun 2026, PDF metadata 7 Sep 2026) is unresolved. C3 (id 2606, v1 20 Apr 2026) is explained by a later v2 (25 Jul 2026). The other ids match their months.
- Single author: A1, C5, D2. Two authors: A6, A7, B1, B2, A2, A9. Small samples: A5 (12), E4 (8), E1 (36), E2 (17), E3 (19).
- Do not copy text from: C3 and A5 (CC BY-NC-SA), C5 (CC BY-NC-ND), D1 (CC BY-SA). Re-implementing an idea is not copying.
- Evidence of effect on AXION-like systems is thin everywhere. The usable material is design shape (cost-based escalation, contracts, locked metric inputs, silent-failure detection channel, evidence-first oversight), not numbers.

## 3. Candidate projects

Existing state checked against PHASE2.md (Waves 1-7), BACKLOG.md and the cycle briefs. Findings that change candidates:
- c42's typed delegation brief has goal, inputs, acceptance, capabilities, budget and deadline. It has **no task class and no difficulty field**. R3-1 says "the class comes from the delegation brief"; that is wrong today, it would be a new field.
- c33 `failure_tags` has mode, note, tagged_by, tagged_by_kind, status. No detection channel or detection time. c60 adds agent and step attribution plus "full trace available". R3-8 is a true gap.
- c41 has `lesson_candidates` with sources, a status and a decider-is-not-proposer rule. R3-8's pattern review should create rows there, not a new queue.
- c58 already records decision latency and pending queue size at decision time, and shows per-approver approval rate and median latency to admins (n and window, null below 5). R3-10 overlaps with that and must reuse it.
- Org proposals (A1-A5) already check cycles, one manager per agent, every role covered, orphan agents and managers with no reports. R3-6's "orphan duty" and "manager with no reports" rejections already exist.
- C1 reliability (floor 5), C2/C3/C5/C6 in BACKLOG (version proposals, verdict, post-promotion watch, recommendations as proposals) cover part of R3-1 and R3-3.
- Six dimensions (c46, c54, M1b/M1c) and B1 rows already show n, window, evidence and trend, no composite. c46's Capability cell already uses reliability.
- Pass^k is built (E1). R3-1 to R3-10 do not duplicate it.
- No existing "needs you" queue, review-capacity view, escalation record or autonomy ladder was found in briefs.

| ID | Sources survive? | Boundary | Threshold measurable? | Duplication | Verdict |
|---|---|---|---|---|---|
| R3-1 | A1 yes (workshop, single author, no numbers), A4 yes, A9 yes (ad creation), C1 yes, C3 yes. Thin. | Fits (records, read-only). Task class is a new field on the brief, not existing. Real cells need outcomes (EXEC); fixture only. | Yes (coverage over seeded trials, null under 5). The coverage test checks the estimator on its own model. | Overlaps C1 and R3-7 | DROP as a stand-alone item; fold the task-class field and per-class cells into R3-7 |
| R3-2 | A2 yes, A3 yes (needs training), C5 design only. | Fits as arithmetic. Stated confidence is not recorded, so every useful cell is fixture-only. | Yes but trivial (formula equals closed form). | None found (c58 is human decisions, not agent-initiated escalation) | DROP for now; revisit when agents execute and stated confidence exists |
| R3-3 | C4 survives with correction (no demotion claim, not purely conceptual), C5 yes (ND licence, formalisation only), A6 yes, D2 yes. No results anywhere. | Records and proposals only. Fixture-only. **Must be display-only until the owner answers the policy-input question.** | Yes (cooldown, two distinct reviewers, decay fixtures). | Overlaps C2 promotion, C5 watch, C6 recommendations | KEEP WITH CHANGES, last, display-only, owner question first |
| R3-4 | B1 yes (theory only), B2 yes (ML setting, not transferable), B4 yes (MARL). | Fits (metadata and flags). | Rows with a declared field: yes. The 20% gamed fixture is circular (it tests the flag on a model the fixture itself defines); say so. | Extends O3 and B1/c46 rows; no duplicate | KEEP WITH CHANGES |
| R3-5 | B3 yes, B4 yes, A8 (date flag, low trust), B5 corrected. Rework and first-pass definitions unverified by the file's own admission. | Fits as derived read models. Cost cells null. | Hand-computed fixtures: yes. 8-week lag check cannot fire for months. | Overlaps B1 (median cycle time, failure and recovery) and c46 | KEEP WITH CHANGES |
| R3-6 | A6 yes, A7 yes (narrow), A5 yes (N=12), A8 flagged, B6 yes. Literature gives no rule, as the file says. | Fits (records and dry run). | Yes (bad-proposal corpus, cooldown). | Orphan duty and manager-without-reports already rejected by A1/A5 | KEEP WITH CHANGES |
| R3-7 | C1, C2 (exams, not agents), C3 (CC BY-NC-SA). Shape only. | Fits as read model; difficulty field is new and gameable. EXEC, fixture only. | Simulation yes, but it tests a model the simulation defines. | Overlaps C1, R3-1 | KEEP WITH CHANGES, absorbs R3-1, build late |
| R3-8 | D1 yes (retrieval only, 24% not a rate), D2 yes (single author), D3 yes. | Fits. Works on REC data. | Yes (boundary tests, null below 5). | Extends c33 and c60; uses c41 candidates; no duplicate | KEEP WITH CHANGES |
| R3-9 | E1-E5 yes (qualitative, small, programming or tutoring settings). None supports ranking by age or tier or an alert budget. | Fits (read model, templated reasons, no model calls). | Fit, contract tests, 3-click depth: yes. | Overlaps c58 (approvals view, bulk flag) and notifications | KEEP WITH CHANGES |
| R3-10 | B7 survives but is irrelevant (GPU), E1-E3 qualitative. Queueing math is standard, as the file says. | Fits (read model over existing rows). | Yes (reference calculation, Little's law with a stated tolerance). | Partly c58 (per-approver latency and queue size) | KEEP WITH CHANGES |

### Reasons and required changes

**R3-8 KEEP WITH CHANGES.**
- State in the brief that D2 is one author and one runtime: it motivates the detection-channel field and gives no rate. D1's 24% is not used.
- Fix an enum for detection channel (test, audit, human looking at result, another agent, reported later) and make the three new fields optional on `failure_tags`, with the missing share shown.
- The recurrence rule opens a row in c41's `lesson_candidates` (with sources), not a new queue. Test that no path creates an active playbook.
- Sequence after c60 merges (same failure files). REC data, so this works now.

**R3-4 KEEP WITH CHANGES.**
- Allow "no known counter-metric" as an explicit value with a reason. Forcing a counter-metric on every row invites filler text.
- The writability flag needs an inventory of which stored fields an agent can write. Build that inventory first and test it against the route table.
- State that threshold (c) is a fixture test of the flag and not evidence the flag catches real gaming.
- It touches `company/scorecard.ts` and `company/dimensions.ts`: sequence after c54 merges and do not run in parallel with R3-5.
- Display-only "gameable" flag now. The promotion-input rule only matters once R3-3 exists.

**R3-9 KEEP WITH CHANGES.**
- Drop the per-operator alert budget and suppression from the first version. No verified source supports it (the vendor alert-fatigue figures are UNVERIFIED), and suppressing a pending R3/R4 approval would conflict with the approvals design. If kept later, R3/R4 approvals are never suppressible and the suppressed count is always shown.
- Rank by a documented, fixed order (tier, age, expiry), say it is a design choice and not supported by a source.
- Reuse c58's latency data and the c33 tags. The "failures with no detection channel" row depends on R3-8.
- Sequence after c58 merges (approvals UI). Fit check at 1366x768 stays a hard threshold.

**R3-6 KEEP WITH CHANGES.**
- Do not cite A8 as evidence (date flag, low trust). A7 is narrow. Cite A6 as the only support for "gate a restructure on contracts" and say it has no numbers.
- In the bad-proposal corpus, count only rules that are new. Orphan duty and manager-without-reports are already checked by A1/A5.
- "Escalation path exists" and "role output contract unchanged" need fields the org model does not have. Define them in the brief or drop those two checks.
- Cooldown and churn budget: the clock rule (DB `now()` in SQL) applies.

**R3-10 KEEP WITH CHANGES.**
- Build on c58's stored latency and queue size instead of recomputing. Add arrival rate, p95, backlog, utilisation and the Little's-law check.
- Utilisation needs an operator-set hours value, which is a new setting. Define it or drop the utilisation line from v1.
- Little's law on a finite window has boundary effects; set the tolerance in the brief and say so.
- Mapping an approval to a department needs a defined rule. Admin-only per-person rows, as c58.
- Sequence after c58 merges. Cite B7 only as a precedent for tail-based sizing, or not at all.

**R3-5 KEEP WITH CHANGES.**
- Build only the metrics that can be derived today (return-for-rework from reviews, duplicate delegation, reassign churn, wait times). Cost stays null.
- Define rework and first-pass acceptance in the brief itself, since the file's definitions came from unverified pages.
- Drop the leading/lagging lag check for this wave: it needs 8 weekly points and will not fire for months. Keep the leading/lagging tag only if a use is stated.
- Do not cite A8 or the 11x claim in B5. Sequence after R3-4 (same scorecard files).

**R3-7 KEEP WITH CHANGES, absorbs R3-1.**
- Fixture-only. Is it worth building now? Only as a small read model with null cells; the value comes when agents execute. Build it last of the kept items.
- Add the task-class and difficulty fields to the delegation brief explicitly (c42 does not have them) and treat difficulty as gameable (R3-4).
- No ordered list of agents anywhere (contract test stays).
- Cite C1 and C2 for shape only, C3 for pair ratings; do not copy C3 text.

**R3-3 KEEP WITH CHANGES.**
- **Display-only until the owner answers.** New owner question (Q13): may an autonomy level ever be an input to the policy service, or is it display only? Until answered, the ladder is advisory metadata plus human-approved proposals, never a policy input, and it cannot lower any R-tier. Decider is not the proposer.
- Do not cite C4 for demotion or withdrawal. Demotion rules are the author's own design, not sourced.
- Fixture-only, so it is worth building only after R3-4 and R3-7 and only if the owner wants the machinery now. Otherwise leave it in the backlog next to C5/C6.

**R3-1 DROP (folded into R3-7).** Thin evidence, EXEC, the claimed brief field does not exist, and C1 already gives the reliability floor. The one reusable part (a task class field and per-class cells with intervals) belongs in R3-7.

**R3-2 DROP for now.** The arithmetic is a formula test, the rate cells need stated confidence AXION does not record, and A2/A3 are about model self-estimates and training. Revisit once agents execute.

## 4. Verdict list

- R3-1 DROP: fold into R3-7; the brief has no task class field and the evidence is thin.
- R3-2 DROP: scaffolding only; no stated confidence recorded; revisit after execution.
- R3-3 KEEP WITH CHANGES: display-only until the owner answers Q13; do not cite C4 for demotion; last.
- R3-4 KEEP WITH CHANGES: explicit "no counter-metric" value, writability inventory, after c54, circular fixture stated.
- R3-5 KEEP WITH CHANGES: REC metrics only, own definitions, drop the lag check, after R3-4.
- R3-6 KEEP WITH CHANGES: do not cite A8, count only new rules, define or drop escalation-path and output-contract checks.
- R3-7 KEEP WITH CHANGES: absorbs R3-1, add task class and difficulty fields, build late, no ranking.
- R3-8 KEEP WITH CHANGES: optional fields, enum for channel, review items go through c41 candidates, after c60.
- R3-9 KEEP WITH CHANGES: drop the alert budget in v1, fixed documented ranking, after c58 and R3-8.
- R3-10 KEEP WITH CHANGES: reuse c58 records, define hours and department mapping, after c58.

## 5. Suggested build order

1. R3-8 (REC data, extends c33, after c60) and R3-6 (org proposals, different tables) in parallel.
2. R3-10 (after c58 merges; disjoint from R3-8 and R3-6).
3. R3-4 (after c54 merges; scorecard files).
4. R3-9 (UI lane, after c58 and R3-8).
5. R3-5 (REC subset, after R3-4).
6. R3-7 with R3-1 folded in (fixture-only, late).
7. R3-3 last, only after the owner answers Q13.
8. R3-2: not scheduled.
