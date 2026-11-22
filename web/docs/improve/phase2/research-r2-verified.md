# Verified citations: research-r2.md (2026-11-22)

Independent check. Every numbered source (26, not "about 27": A1-A8, B1-B5, C1-C9, D1, E1-E3) was opened in this session by page fetch. arXiv abstract pages give title, authors, v1 date, comments, licence and abstract. A venue is accepted only if it shows on the arXiv page or on the venue's own proceedings page (opened). Only the abstract pages were read, not the papers, so numbers below are abstract claims by the authors. Dates are v1.

Counts: **22 CONFIRMED, 4 CORRECTED (B3, C4, C8, D1), 0 OVERSTATED, 0 WRONG, 0 UNCONFIRMED.** The "Not opened" list in research-r2.md was not checked by me and stays UNVERIFIED.

## 1. Source table

| ID | arXiv / URL | Verdict | Check result |
|---|---|---|---|
| A1 | 2511.21140 | CONFIRMED | Title, 5 authors, v1 26 Nov 2025 match. Abstract has no numbers (as stated). Page also shows **ICML 2026** (v4, 31 May 2026), which the file did not claim. Licence CC BY-SA 4.0 (share-alike if text is copied; implementing the method is not copying). |
| A2 | 2605.31278 | CONFIRMED | Title, 3 authors, v1 29 May 2026 match. Abstract states annotation savings with no figure. Page: accepted to an **ICML 2026 workshop** (Statistical Frameworks for Uncertainty in Agentic Systems), 8 pages, not the main conference. CC BY 4.0. Library licence not checked. |
| A3 | 2507.02825 | CONFIRMED | 25 authors on arXiv (26 on the proceedings page), names match. v1 3 Jul, v5 7 Aug 2025. Numbers match (up to 100% relative misstatement; ABC cut CVE-Bench overestimate by 33%). The file's hedge was right: arXiv page shows no venue. NeurIPS 2025 Datasets and Benchmarks track **confirmed** on proceedings.neurips.cc, where the title reads "in Building" not "for Building". arXiv non-exclusive licence only. |
| A4 | 2602.16666 | CONFIRMED | 6 authors, v1 18 Feb 2026, v3 2 Jun 2026. Twelve metrics, four dimensions, 15 models, two benchmarks all match. Page says accepted at **ICML 2026**. CC BY 4.0. |
| A5 | 2610.00651 | CONFIRMED | 5 authors, 30 Sep 2026. 22 benchmarks (HAL and Harbor Index), 0.935-0.994 vs 0.148-0.841, 0.44 to 0.75 all match. No venue on the page (preprint). Also reports up to 83% projected cost cut. CC BY 4.0. |
| A6 | 2611.04399 | CONFIRMED | Single author (Yangze Liu), 3 Nov 2026, preprint, no venue. 13-point gap, about half of episodes scored, three more errors, maintainers confirmed three errors within five weeks, the four proposed checks: all match. Note the three errors the maintainers confirmed are the ones reported to them. arXiv non-exclusive licence. |
| A7 | 2607.24054 | CONFIRMED | 2 authors, 27 Jul 2026, preprint. 19.1-25.9 points is GOLD vs SHAM in the "D0" setting only. The abstract also says a supported 5.0-point gap shrank to -0.6 and "does not establish a rank inversion", so use it for the reporting recommendation, not as general evidence. arXiv non-exclusive licence. |
| A8 | 2510.11977 | CONFIRMED | 31 authors, 13 Oct 2025. 21,730 rollouts, 9 models, 9 benchmarks, about $40,000, reasoning effort lowering accuracy in most runs, agent searching HuggingFace for the benchmark: match. arXiv page shows no venue; **ICLR 2026 confirmed** on proceedings.iclr.cc. Project site says HAL leaderboard updates are paused. |
| B1 | 2604.01020 | CONFIRMED | 6 authors, 1 Apr 2026, no venue (preprint). 102.73% gain and 74.52% fewer tokens is one example (GPT-OSS-120B, SQuAD 2.0), as the file says. CC BY 4.0. |
| B2 | 2603.28990 | CONFIRMED | Single author, 30 Mar 2026. 25,000 tasks, 8 models, 4-256 agents, 8 protocols, +14% over centralised, 44% spread, weak models do better with rigid structure: match. Comments: "Submitted to IEEE Access" (not peer reviewed). Note that it studies emergent roles vs imposed hierarchy, so "contradicts B1" is a fair reading but the tasks are not company-organisation tasks. CC BY 4.0. |
| B3 | 2602.01011 | **CORRECTED** | Content matches (41.1% loss, expertise use not identification, consensus-seeking more robust to adversaries). Correction: the file calls it a preprint, but the arXiv page says **accepted at ICML 2026**. Licence: arXiv non-exclusive. |
| B4 | 2505.00212 | CONFIRMED | 11 authors, 30 Apr 2025. 127 systems, 53.5% agent, 14.2% step: match. Page only says "camera-ready", no venue; file claims none. CC BY 4.0. Abstract adds that some methods score below random. |
| B5 | 2604.22708 | CONFIRMED | 7 authors, 24 Apr 2026, "Accepted by ACL 2026" on the page. Up to 76% better attribution with full traces: matches. CC BY 4.0. |
| C1 | ai.meta.com blog | CONFIRMED | 31 Oct 2025, no authors listed, vendor blog. Rule of Two (A, B, C), fresh session or supervision, "a supplement and not a substitute" for least privilege, does not cover mistakes/hallucinations/excess privilege, user confirming a warning without reading: all in the text. The post frames it as holding until prompt injection can be reliably detected, so it is a stopgap heuristic. Meta copyright; do not copy text. |
| C2 | 2605.24309 | CONFIRMED | 3 authors, 23 May 2026, no venue. 59 papers, 21 systems, 26 plugins, 14/15/16 of 21, zero production deployment of intent anchoring and trust labelling: match. arXiv non-exclusive licence. |
| C3 | 2601.10338 | CONFIRMED | 8 authors, 15 Jan 2026, no venue. 42,447 collected, 31,132 analysed, 26.1%, 14 patterns, 5.2%, 2.12x: match. Detector reports 86.7% precision and 82.5% recall (its own labels). CC BY 4.0. |
| C4 | 2602.06547 | **CORRECTED** | Numbers match (98,380; 157; 632; over half from one actor). Correction: the file says preprint; the page says **accepted to USENIX Security 2026**. Also 13 attack techniques, and registries removed all 157 after disclosure. CC BY 4.0. |
| C5 | 2606.04329 | CONFIRMED | 5 authors, v1 3 Jun 2026, no venue. 4 write channels, 9 weaknesses, 6 attack classes, MPBench: match. CC BY 4.0. |
| C6 | 2606.24322 | CONFIRMED | Single author, 23 Jun 2026, no venue, not peer reviewed. 8 models, up to 68% laundering success against existing defences, 0% for the proposed design: match, and the abstract says machine-checked TLA+ models and released harness. Own results only, as the file warns. arXiv non-exclusive licence. |
| C7 | 2606.30970 | CONFIRMED | 3 authors, 29 Jun 2026 (v2 1 Jul), no venue. Three authorities, permit/review/deny, receipts, standing delegation: match. No numbers in the abstract. It names an AgentBound-Bench but gives no scores. CC BY 4.0. |
| C8 | IETF draft-sahu-agent-action-receipts-00 | **CORRECTED** | Mostly right: Informational draft, 16 Aug 2026, expires 17 Feb 2027, one signed JSON line per action, SHA-256 of previous line, Ed25519, offline verification. Correction: the draft states that the **timestamp** is host-asserted; I did not see it say that actor fields are self-asserted (actor is an optional object). Also the draft says truncation detection needs state outside the log but "does not require" an anchor. Single individual author at a company (kriya native). Copyright IETF Trust, all rights reserved (code components BSD). Not a standard. |
| C9 | genai.owasp.org page | CONFIRMED | 9 Dec 2025, OWASP GenAI Security Project, "more than 100" experts, "globally peer-reviewed" is the page's own wording. The ten names are not on the page (download only), as the file says. Site content CC BY-SA 4.0. Pointer only. |
| D1 | 2605.19576 | **CORRECTED** | 7 authors, v1 19 May 2026. Correction: venue is the **ICML 2026 Workshop on Failure Modes in Agentic AI**, not the main ICML. The "0.0 vs 16.2" skill gain is a SkillsBench figure the paper cites, not its own result. Own result: pass@1 0.258 to a late-window mean 0.584 on MBPP+ hard-100 over 100 rounds, which is one coding set. Licence **CC BY-NC-SA 4.0** (non-commercial, share-alike: do not copy text). |
| E1 | raw.githubusercontent.com ... gen-ai-agent-spans.md | CONFIRMED | Status "Development". Spans (create agent, invoke agent client and internal, plan, execute tool), attributes, opt-in content and `_ref` variants, sensitivity warning, do not invent conversation ids, do not synthesise output for failed operations: all present. `plan` is reported only when it can be told from reasoning. Licence of the repository not checked. |
| E2 | MCP spec 2026-07-28 | CONFIRMED | Overview: explicit consent before tool invocation, annotations untrusted unless from a trusted server, extensions Tasks and Skills over MCP. Authorization is OPTIONAL; for HTTP it follows an OAuth 2.1 IETF draft, `resource` parameter MUST, audience validation MUST, no accepting other tokens, scope challenge, step-up. File's wording ("for HTTP transports that use it", "OAuth 2.1 style") is right. Licence not checked. |
| E3 | a2a-protocol.org/latest | CONFIRMED | v1.0.0, Agentic AI Foundation banner, Agent Card contents, nine task states (including UNSPECIFIED), signed cards in section 8.4. As the file says, only the first 100,000 of 257,720 characters were read by the tool, and I also did not read the remainder, so "no audit or logging requirements" is unchecked beyond that. Licence not checked. |

## 2. Maturity and licence summary

- Peer reviewed at a main venue (confirmed): A1 (ICML 2026), A3 (NeurIPS 2025 D&B), A4 (ICML 2026), A8 (ICLR 2026), B3 (ICML 2026), B5 (ACL 2026), C4 (USENIX Security 2026).
- Workshop only: A2, D1. Submitted, not accepted: B2.
- Preprint with no venue: A5, A6 (single author), A7, B1, C2, C3, C5, C6 (single author, own results), C7. B4 is camera-ready with no venue named.
- Not a paper: C1 (vendor blog, heuristic), C8 (individual Internet-Draft, no standing), C9 (pointer only), E1 (status "Development"), E2, E3.
- Reuse limits: A1 and C9 CC BY-SA; D1 CC BY-NC-SA; C8 IETF Trust all rights reserved; C1 Meta copyright. Cite and re-implement from the idea; do not copy prose.

## 3. Candidate projects

Existing state checked against PHASE2.md (Waves 1-5), BACKLOG.md and the tree: eval_runs already store `k`, `judge_model_family`, `evaluator_id`; verdictV2 already has pass^k, inconclusive, producer-not-judge; datasets are hashed and frozen (E1); audit chain (c31) **and an external HMAC anchor (c49, `server/src/audit-anchor.ts`)** exist; BACKLOG P5b is still listed as open but is built; playbooks and skills (c41) already forbid activation without a human, decider is never the proposer, and items carry sources, a trust field and review_by; failure tags (c33) already record whether a person or an agent tagged; c53 (queued, Wave 5) adds judge-label validation to eval_runs.

| ID | Sources survive? | Boundary | Threshold measurable? | Verdict |
|---|---|---|---|---|
| R2-1 | A1 yes (ICML 2026), A2 yes (workshop). Only abstracts read. | Fits: arithmetic on stored labels. But it needs a place to store human calibration labels, which means a new records table and write route (no UI for it exists, contrary to "existing UI"). | Yes: seeded Monte Carlo coverage; the standard error of a 1,000-trial coverage estimate is about 0.7 points, so a 93% floor is testable. | KEEP WITH CHANGES |
| R2-2 | A6 yes but single-author preprint; A3, A8 yes. | Fits. | Yes: fixture tests. | KEEP |
| R2-3 | A3 yes; A7 narrow (one benchmark family); A8 yes. | Attestation fits. The per-run "disallowed source reachable" field is only knowable once agents run. | Attestation part yes. | KEEP WITH CHANGES |
| R2-4 | A4 yes (ICML), A5 yes (preprint). | Fits, but pass^k is built. Robustness and predictability need perturbed variants and stated confidences that AXION does not record. | Only on fixtures; real cells stay null. | DROP |
| R2-5 | C5, C3, C4 yes; C6 single-author own results; D1 workshop. | Fits records-only. | Yes. | KEEP WITH CHANGES |
| R2-6 | C1 yes but vendor heuristic; C2 yes; C9 pointer only. | Fits (pure policy). | Yes. | KEEP WITH CHANGES |
| R2-7 | C8 draft (corrected), C7 preprint with no results, E2 yes. | Records and verifier fit. Key custody and any off-host anchor need owner approval. | Mutation tests yes. | KEEP WITH CHANGES |
| R2-8 | E1 yes but "Development"; E3 yes; B5 yes but it is about attribution, not export. | Fits as export only. | Yes against a pinned list. | KEEP WITH CHANGES |
| R2-9 | C2 yes; C1 yes. Evidence is a survey and a blog caveat. | Fits (records and display). | Yes. | KEEP WITH CHANGES |
| R2-10 | B1, B2, B3 yes but preprint or mixed, about reasoning tasks; B4 and B5 yes. | Fits. | Attribution yes; "pooled win refused" needs org-change outcome data that will not exist. | KEEP WITH CHANGES (attribution only) |

### Reasons and required changes

**R2-1 KEEP WITH CHANGES.**
- A1's estimator is for binary judge verdicts. State that scope and map it to AXION's paired pass/fail cases. Read the paper's formulas (I read only the abstract) before writing the brief, and name the estimator in the brief.
- The calibration set must be disjoint from the test set. The sketch must say so.
- Today the only judge fields are family labels (c53 validates those), not judge scores. Say it is scaffolding until judges are used.
- Add a store for human labels as an explicit item. Sequence after c53 lands (same `evolution/` files).
- Threshold fix: seeded RNG, report the measured coverage and its standard error.

**R2-2 KEEP.**
- A6 is a single-author preprint. The checks are cheap and the evidence is only the motive, so state that.
- Extend the existing `eval_runs` columns (`evaluator_id`, `k`) with graded count, ungraded reasons and grader version. Define what a "re-grade diff" record is before the rule that refuses cross-version comparisons.
- Sequence after c53 (same tables). The "cost from root spans" check is meaningful only once usage is recorded (Stage 9), so keep it a fixture test.

**R2-3 KEEP WITH CHANGES.**
- Keep the ABC-style attestation (A3 is peer reviewed).
- Add: the attestor must not be the dataset's author (same producer-is-not-verifier idea as O3).
- Defer the per-run "disallowed source reachable" flag. It cannot be measured without execution, and A7 is a narrow preprint.
- Leakage as a motive is already covered by the verified SWE-Bench+ result.

**R2-4 DROP.**
- Consistency duplicates pass^k (built) and the reliability cell in the six dimensions (c46, c54).
- Robustness and predictability need data AXION has no way to record. Cells would be null in all real use, and the threshold only proves fixtures.
- The model-versus-scaffold split needs a scaffold concept AXION does not have.
- Keep the one useful rule ("fewer than k repeats gives null, never zero") as a note for M1b. Reconsider when repeated runs exist.

**R2-5 KEEP WITH CHANGES.**
- Drop "only a person can activate": c41 already enforces human activation and decider is not proposer.
- The new parts are the origin class that cannot be raised by summarising or by agreement between agent-written items, a per-record append-only contribution log, an active-item cap per role, and retirement proposals. Build those on c41's `trust` and `sources` fields, not a parallel structure.
- Evidence honesty: the "origin never rises" rule rests on C6, a single-author preprint. Test our own rule; do not quote 0%.
- C3 and C4 support "third-party skill text is an attack surface". AXION skills are internal quoted data, so say that importing external skills stays out of scope.
- D1's 0.258 to 0.584 is one coding set at workshop level, so use it for the lifecycle idea only.
- Contribution scores and retirement need agents to use skills, so make those fixture-only for now.

**R2-6 KEEP WITH CHANGES.**
- The flags must be derived server-side from capabilities, grants and origins in the c42 brief schema and the P1 policy kinds. They must not be declared in the brief, because a self-declared flag defeats the control.
- Label the rule a heuristic from a vendor blog written as a stopgap until injection can be detected.
- Confirm "tier at least R2" against the existing tier table (c30) so it is not a second tier source.
- Do not cite C9 for any category.
- Threshold fix: the 8-combination table is good; add a test that a requester cannot lower the result.

**R2-7 KEEP WITH CHANGES.**
- Fix the premise: the external anchor is built (c49 HMAC, key in the server environment). The remaining novelty is an asymmetric (Ed25519) signature so an outsider can verify without a secret, plus a receipt binding action digest, policy version and decision (P3 digest).
- That requires key generation and custody, which is an owner decision. Build the format and verifier with a test key only, and queue an owner question.
- C8 is an individual draft and C7 reports no results, so cite them as designs. Do not call receipts a standard.
- Priority last. Park the project if the owner question is unanswered.

**R2-8 KEEP WITH CHANGES.**
- Pin the spec commit and the page hash. The status is "Development".
- Mapping table first; the export only after traces exist in volume.
- B5 supports "record full traces", not "use OTel". Drop B5 as support for this project.
- A2A task states (E3) are vocabulary only.

**R2-9 KEEP WITH CHANGES.**
- The evidence is a survey of systems and a blog caveat. The 93%/97% approval rates remain excluded.
- Per-approver rankings monitor individuals, so show them only to admins and show aggregates elsewhere.
- Depends on R2-6's flags and on P3b (second-approver) so there is one approvals UI change, not two. Compute latency from the audit and decision rows; do not add a new clock source (DB `now()` rule).
- Hard rule stays: no flag changes a decision.

**R2-10 KEEP WITH CHANGES (attribution fields only).**
- Keep the optional agent/step attribution plus a "full trace available" flag on failure tags (B4 and B5 confirmed; the tag table already has a tagged-by kind). Disagreement counting is cheap.
- Drop the stratified org-change comparison for now. A1 org proposals have no outcome data, B1 to B3 are preprint or mixed evidence about reasoning benchmarks, and per-class counts will be tiny. The "mixed not win" arithmetic is testable only on fixtures.
- State the one safe lesson (the literature disagrees, so no hierarchy belief) in the brief and take no other action.

## 4. Suggested use for Wave 6

Ranked by evidence times fit: R2-6 (with R2-9), R2-5, R2-2, R2-1 and R2-3 (after c53 merges), R2-10 attribution, R2-8, R2-7 (owner question first). R2-4 dropped.
