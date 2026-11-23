# Research round 5 (2026-11-23)

Scope: how the owner can (a) know whether a change to the company's structure or process really improved performance, with very few units, and (b) make agents measurably better over time without drift. Plus estimation and forecasting, and two extras on human-agent handoff. New work only. I read the topic headings and candidate lists of research-r2.md, r3.md and r4.md; I do not repeat judge calibration, instrument audits, Rule of Two, receipts, OTel, approval quality, delegation fit, escalation policy, earned autonomy, metric gaming, process metrics, restructure guardrails, skill ratings, failure learning, attention queue, review capacity, retention, redaction, incidents, tenant isolation, SLOs, freezes or the migration guard. Where I build on an earlier candidate (R2-5 origin-bound skills, R2-10 hypotheses by class, R3-6 restructure guardrails, R3-7 skill ratings, R3-8 failure learning, R3-3 earned autonomy) I say so and say what is new.

Reading notes:
- The fetch tool returns a page summary, not the raw page. For every source below I read the arXiv abstract page (or the named page) as summarised. I read no full paper body. Every number is the authors' claim from the abstract, not something I checked.
- Nothing was run against AXION and no AXION code was read. Data claims in section 4 come from the task statement (missions, tasks, reviews, approvals, briefs with class and difficulty, org revisions, audit events). Anything needing agents that run is tagged EXEC.
- Only generic technical terms were used in searches.
- Thresholds are sketches to be fixed in briefs and then measured.

## 1. Sources (all opened)

### A. Causal evaluation of organisation and process changes with few units

**A1. Design and Analysis of Switchback Experiments.** Iavor Bojinov, David Simchi-Levi, Jinglong Zhao. v1 31 Aug 2020, v4 17 Sep 2025. arXiv preprint (stat.ME), CC BY 4.0. https://arxiv.org/abs/2009.00148
One unit is repeatedly assigned random treatments over time. Derives optimal designs under different assumptions on how long effects carry over (minimax), with two inference methods: exact randomization p-values and a finite-population CLT. Covers a wrong carryover length and a data-driven way to estimate it. No numbers in the abstract.

**A2. Sequentially-Rerandomized Switchback Experiments.** Zeng, Adjaho, Bucarey, Qin, Zhang, Hoban, Johari, Wager. 2 Apr 2026. arXiv preprint (stat.ME), arXiv non-exclusive licence. https://arxiv.org/abs/2604.02489
Rerandomises the treatment each period to balance prognostic variables built from past observations (lagged outcomes, covariates). Randomization inference under a sharp null; a blocked variant for first-order carryover. Simulations show gains over standard switchback designs; no figures on the page.

**A3. Robust and efficient multiple-unit switchback experimentation.** Missault, Masoero, Delbe, Richardson, Imbens. 14 Jun 2025. arXiv preprint (stat.ME), CC BY 4.0. https://arxiv.org/abs/2506.12654
Regular Balanced Switchback Designs vary treatment across both time and items, with conditions under which estimators resist carryover. Reports more accurate estimates than item-randomised and non-balanced switchbacks in simulation and e-commerce data; no numbers on the page.

**A4. Synthetic Difference in Differences.** Arkhangelsky, Athey, Hirshberg, Imbens, Wager. Dec 2018, v4 2 Jul 2021. arXiv preprint (stat.ME, econ.EM). https://arxiv.org/abs/1812.09970
Combines difference-in-differences with synthetic control: reweights units and periods to match pre-change trends. Consistency and asymptotic normality conditions given. The page names no journal and no numbers. (The published venue is not on the page I read.)

**A5. Synthetic Controls with Staggered Adoption.** Ben-Michael, Feller, Rothstein. Dec 2019, v2 15 Jan 2021. arXiv preprint (stat.ME). https://arxiv.org/abs/1912.03290
Extends synthetic control to units that adopt at different times; bounds error by per-unit imbalance and imbalance of the average; proposes partially pooled weights. R package augsynth. The teacher-bargaining application finds "minimal impacts".

**A6. Difference-in-Differences with Multiple Time Periods.** Callaway, Sant'Anna. Mar 2018, v4 1 Dec 2020. arXiv preprint (econ.EM). https://arxiv.org/abs/1803.09015
Group-by-time effects with staggered timing, doubly robust estimation, aggregation schemes and a bootstrap for simultaneous inference. Open-source software exists. Needs many units for the asymptotics; used here as the contrast case.

**A7. Placebo inference on treatment effects when the number of clusters is small.** Andreas Hagemann. 7 Mar 2018. arXiv preprint (stat.ME); a related DOI suggests a journal version, journal not named on the page. https://arxiv.org/abs/1803.02764
A randomisation test that assigns placebo treatments to untreated clusters. Reported to work with as few as 3 treated and 3 untreated clusters, including in difference-in-differences. Asymptotic validity under checkable conditions.

**A8. Game-theoretic statistics and safe anytime-valid inference.** Ramdas, Grunwald, Vovk, Shafer. 4 Oct 2022, v2 17 Jun 2023. arXiv preprint (math.ST), "under review" in the comments. https://arxiv.org/abs/2210.01948
E-processes for testing and confidence sequences for estimation that stay valid under continuous monitoring and optional stopping. Not 2024 to 2026 but the base for A9.

**A9. Anytime-Valid Confidence Sequences in an Enterprise A/B Testing Platform.** Maharaj and 9 co-authors (incl. Ramdas). 20 Feb 2023. WWW '23 Companion. https://arxiv.org/abs/2302.10108
Production service built on confidence sequences so that peeking does not inflate type-I error; covers sample size and lift. Reports better behaviour than fixed-horizon tests on simulated data and thousands of real experiments (no figures on the page). Also not 2024 to 2026.

**A10. Variance reduction combining pre-experiment and in-experiment data.** Zhexiao Lin, Pablo Crespo. 11 Oct 2024, v2 21 Mar 2026. Accepted to CLeaR 2026. https://arxiv.org/abs/2410.09027
Extends CUPED and CUPAC (which depend on how predictive pre-experiment data are) with a few post-treatment covariates, with consistent variance estimators; Etsy results. States "substantial additional variance reduction" but no percentages on the page. It also warns that arbitrary post-treatment variables bias the estimate.

**A11. Risk-aware product decisions in A/B tests with multiple metrics.** Schultzberg, Ankargren, Frånberg (Spotify). 18 Feb 2024. arXiv preprint (stat.ME), CC BY 4.0. https://arxiv.org/abs/2402.11609
A decision rule with success, guardrail, deterioration and quality metrics and a design and analysis plan. Guardrails tested by non-inferiority need no multiplicity correction; when non-inferiority or deterioration tests are in the rule, the type II error must be corrected to keep power. Monte Carlo only. This is the closest thing found to a published "decide before you look" rule; it does not itself discuss pre-registration.

### B. Agent learning loops with regression safety

**B1. GRASP: Gated Regression-Aware Skill Proposer for Self-Improving LLM Agents.** Moll, Corbeil, Pan, Hadamitzky, Rueckert, Adams, Bressem. v1 28 May 2026, v3 21 Aug 2026. EMNLP 2026 Main. CC BY 4.0. https://arxiv.org/abs/2605.29668
Improvement as edits to a bounded skill library; a candidate is kept only if it gives a net gain on a balanced held-out probe within a hard regression budget. Five base models, two FHIR clinical benchmarks that score procedural reliability against FHIR state. gpt-oss-120b on MedAgentBench goes from 40.6% to 88.8%, 21.0 points above the strongest of five self-improvement baselines; other models gain 17.2 to 40.3 points. The authors say the gain comes from the gate, the regression budget and comparative proposals, not from skill writing, and that it shows no gain where the action space is open-ended.

**B2. Skill-V: Verifiable Self-Evolving Skill Library for Interactive Agents.** Jie Ma and 8 co-authors. 8 Oct 2026. arXiv preprint (listed under cs.CV), CC BY 4.0. https://arxiv.org/abs/2610.11781
Skills as versioned, falsifiable contracts linking intent to observable criteria. Failures trigger new skills; mismatches between contract checks and outcomes trigger boundary revisions; revisions must preserve protected constraints and pass non-regression checks on historical replay evidence. Reports 95.3% on ALFWorld and 85.9% on WebShop and fewer wrong invocations; no comparison numbers on the page.

**B3. SkillEvolBench: Benchmarking the Evolution from Episodic Experience to Procedural Skills.** Lei and 15 co-authors. 22 May 2026. arXiv preprint (cs.AI), CC BY 4.0. https://arxiv.org/abs/2605.24117
180 tasks, 6 environments, 10 model configurations, 3 harnesses. Agents adapt locally but rarely form robust reusable skills. Gains are unstable under deployment; reusing raw trajectories often beats distilled skills; writing more skills does not reliably help and adds episode-specific drift and clutter. This is the main counter-evidence to "distil experience into skills".

**B4. SoK: Agentic Skills: Beyond Tool Use in LLM Agents.** Jiang, Li, Deng, Ma, Wang, Wang, Yu. 24 Feb 2026. arXiv preprint (cs.CR), CC BY 4.0. https://arxiv.org/abs/2602.20867
Seven-stage skill lifecycle (discovery, practice, distillation, storage, composition, evaluation, update) and two taxonomies; covers a marketplace campaign with nearly 1,200 malicious skills. Notes that curated skills can raise success while self-generated skills may degrade it. A survey, not a result.

**B5. Your Agent May Misevolve: Emergent Risks in Self-evolving LLM Agents.** Shao and 10 co-authors. 30 Sep 2025, v2 8 Mar 2026. ICLR 2026. https://arxiv.org/abs/2509.26354
Defines misevolution along four pathways (model, memory, tool, workflow) and shows it appears even with top models (Gemini-2.5-Pro named): degraded safety alignment after memory accumulation, unintended vulnerabilities from tool creation and reuse. Mitigations discussed; no numbers on the page.

**B6. ANCHOR: An External LLM-Driven Supervisory Module Facilitating Healthy Evolution in Self-Evolving Systems.** Shi, Wang, He, Chen, Nakashima. 4 Jun 2026, v3 15 Sep 2026. arXiv preprint (cs.AI), CC BY 4.0. https://arxiv.org/abs/2606.06114
A supervisor that reviews several phases of the evolution loop; retrofitted to two frameworks on coding, math and safety. Reports better safety with stable core capability, that execution-result-based supervision works best, and that more frequent supervision has diminishing returns. No numbers on the page.

### C. Estimation and forecasting

**C1. Can LLMs Perceive Time? An Empirical Investigation.** Aniketh Garikaparthi (single author). 9 Mar 2026. ICLR 2026 "I Can't Believe It's Not Better" workshop. https://arxiv.org/abs/2604.00010
68 tasks, four model families. Pre-task duration estimates overshoot actual by 4 to 7x (p < 0.001); in multi-step agent settings errors are 5 to 10x; post-hoc recall differs by an order of magnitude either way. Small and workshop level.

**C2. How Do AI Agents Spend Your Money? Analyzing and Predicting Token Consumption in Agentic Coding Tasks.** Bai, Huang, Wang, Sun, Mihalcea, Brynjolfsson, Pentland, Pei. 24 Apr 2026, v3 2 Oct 2026. arXiv preprint (cs.CL). https://arxiv.org/abs/2604.22750
Eight frontier models on SWE-bench Verified. Agentic tasks use about 1000x the tokens of chat; the same task can differ by up to 30x across runs; accuracy often peaks at intermediate cost; human difficulty ratings correlate only weakly with actual token cost; models predict their own usage poorly (correlation up to 0.39) and underestimate.

**C3. Budget Guard: Calibrated Resource Control for Long-Horizon LLM Agents.** Somerset, He, Phyo, Le, Qi, Li. NeurIPS 2026 workshop poster (Interpreting Agent Behavior, 12 Dec 2026). https://neurips.cc/virtual/2026/168981
A CPU-only wrapper: a conformal resource-need interval and a feasibility gate. Over 19 agent-task combinations, the agents' own estimates covered the truth 2% to 52% of the time; the calibrated interval was above 85% coverage on 18 of 19. Counterfactual replay on a Warehouse task halves cost per successful run ($1.61M to $0.87M); single-resource token tasks save 3 to 7%. The page gives no conformal details. Workshop poster, one split per combination.

**C4. Do AI Agents Know When a Task Is Simple? Toward Complexity-Aware Reasoning and Execution.** Yin, Feng. 14 Jul 2026. arXiv preprint (cs.AI), CC BY 4.0. https://arxiv.org/abs/2607.13034
Estimate, Execute, Expand: start with a minimal scope and expand when verification fails. On MSE-Bench (121 simulated edits) it matches the best baseline's success with 85% lower cost and 91% fewer tokens; the live gpt-4o test shows a milder effect. The authors call it a controlled probe, not a measurement of deployed agents.

**C5. ForecastBench: A Dynamic Benchmark of AI Forecasting Capabilities.** Karger, Bastani, Yueh-Han, Jacobs, Halawi, Zhang, Tetlock. 30 Sep 2024, v5 28 Feb 2025 (ICLR 2025 proceedings per a search result, not on the page). https://arxiv.org/abs/2409.19839
1,000 auto-generated questions about unresolved future events; forecasts collected on a random 200 from experts, the public and LLMs. Expert forecasters beat the top LLM, p < 0.001. The page reports no Brier scores.

**C6. AIA Forecaster: Technical Report.** Alur and 13 co-authors. 10 Nov 2025. arXiv preprint (cs.AI). https://arxiv.org/abs/2511.07678
Agentic search, a supervisor that reconciles forecasts, and statistical calibration. Claims parity with superforecasters on ForecastBench; trails market consensus on a liquid-markets benchmark, though an ensemble with the market beats the market. Vendor technical report; the page shows no scores. I did not open the body, so a claimed Platt-scaling and extremizing link seen in a snippet is UNVERIFIED (section 2).

**C7. How Proper Scoring Rules Shape LLM Forecasting.** Turtel, Wilczewski, Skotheim, Satopaa, Tetlock. 28 Aug 2026, v2 9 Sep 2026. arXiv preprint (cs.LG). https://arxiv.org/abs/2608.28482
Five proper scoring rules as training objectives for LLM forecasters. Same truthful-reporting incentive in theory, different trained models: the Brier-trained model has the best Brier score and AUC, the log-trained one the best log score and lowest calibration error. Conclusion: proper rules are not interchangeable. Training objective, not an evaluation of agents at work.

### D. Extras (at most two items): human-agent handoff

**D1. Knowing When to Stop: The Evidence-Action Gap in Coding Agents.** Chen, Zhao, Viswanathan, Yu, Zhou, Wu. 22 Oct 2026 (v2 27 Oct). arXiv preprint (cs.SE), CC BY 4.0. https://arxiv.org/abs/2610.31895
ImpasseBench: 12 blockers added to solvable repair tasks; the step where evidence justifies asking for help is marked. 8 models, 19,371 trajectories. Almost every run that needed help had enough evidence, yet about a third exhausted their budget; an escalation tool cut budget exhaustion from 34.0% to 6.7%. Tickets name the blocker but often omit the agent's progress and verification status.

**D2. Collaborative Human-Agent Protocol (CHAP).** Shahid, Suttie, Black. 8 Jun 2026, v2 20 Jun 2026. arXiv preprint (cs.AI), CC BY 4.0. https://arxiv.org/abs/2606.09751
A protocol where human overrides are structured events (diff, rationale, content hash), shift handoffs are portable envelopes, approvals are signed decisions, over an append-only evidence log. Reference implementation and conformance suite are linked. No results or metrics; a specification, not evidence that it works. I did not open the repository.

### Opened, background only (not used for a candidate)

- **Field experiment, human oversight of an agentic system.** Wang, Zhu, Feng, Lu, Jia. 14 May 2026. arXiv preprint (cs.HC). https://arxiv.org/abs/2605.14830. Randomised field experiment on a large e-commerce customer service platform; the AI shortened chats but lowered ratings on AI-eligible chats; human intervention held quality for technical escalations but was less effective for emotional ones. No numbers and no randomisation unit stated on the page. Useful as an existence proof that randomised designs on human-agent work are published.
- **From Monolithic Blending to Agentic Orchestration.** Zhao and 8 co-authors. 4 Sep 2026, EMNLP 2026 Industry. https://arxiv.org/abs/2609.05758. Separates escalation wording from real handoffs: soft escalation fell from 9.56% to 2.49%, hard from 5.60% to 3.08%, while production handoff volume stayed roughly steady. The page does not define the metric. Used only for the design lesson in R5-8 (a metric that moves while the real outcome does not).

## 2. Not opened / UNVERIFIED

Seen only in search snippets; nothing below is relied on for a threshold.
- Taylor, "switchbacks on a single aggregate unit", arXiv 2406.06768 (snippet: empirical Bayes design, 33% MSE reduction on ride-sharing data).
- CUPED robust variance, arXiv 2606.18750; "From Augmentation to Decomposition: a New Look at CUPED", arXiv 2312.02935; Datadog and LaunchDarkly CUPED docs.
- Booking.com, arXiv 1710.08217 (snippet: pre-registration as a practice); Eppo "Make Decisions Before Experimenting" blog; GitLab experimentation handbook; Microsoft ExP pages.
- Cluster-robust guide, arXiv 2205.03285; permutation inference with heterogeneous clusters, arXiv 1907.01049; Gardner two-stage DiD, arXiv 2207.05943; "What's Trending in DiD", arXiv 2201.01194; Goodman-Bacon (no primary page found).
- Skill libraries: SkillPivot, arXiv 2609.29154 (I did open its page: it reports a regression-gated verifier only in the search snippet; the abstract page I read did not mention a regression gate, so treat that claim as UNVERIFIED and do not use it); EvoSkills, arXiv 2604.01687; Dynamic Agent Skills survey, arXiv 2607.10113 (snippet: 124 papers audited).
- AIA Forecaster body: the Platt scaling coefficient of about 1.73 and "learned 2.27" figures; "Two Heads Are Better Than One", arXiv 2609.33257; "Agentic Forecasting with Structured Linguistic Beliefs", arXiv 2604.18576; "When Do Language Models Add Value?", arXiv 2609.12101; a snippet that per-model Platt scaling matched a group benchmark in 7 of 16 groups.
- Scoring rule theory: Brocker, arXiv 0806.0813; arXiv 2603.15232 (recalibration as projection); CORP reliability diagrams, arXiv 2008.03033 and PMC7923594 (the PMC fetch returned only a browser check page); LSE record 39006.
- METR time horizons, arXiv 2503.14499 and metr.org (snippets: 50% horizon about 50 minutes for one model, doubling about every seven months). Not needed.
- Reference class forecasting: Batselier and Vanhoucke 2016 and the PMI pages; a TechCrunch piece citing 37% schedule and 107% cost overruns on more than 4,000 IT projects (source unnamed, treat as unreliable); UK optimism-bias guidance.
- Coordination: AgentCollabBench (ICML 2026 listing), SILO-BENCH (ACL 2026), a Nature Machine Intelligence threshold paper (snippet: predicts the multi-agent effect in 94% of validation configurations), Stanford HAI news piece, arXiv 2505.11556 and 2511.02687. Not opened; not used.
- Handoff: arXiv 2506.12482 (tiered oversight), the AWS Well-Architected agentic lens page, an Augment guide. Not opened.
- Budget Guard conformal details; the CHAP repository.

## 3. Gaps (looked for, not found)

- No source tests switchback, synthetic control or sequential methods on a company of AI agents, or on any organisation with tens of tasks per week. All switchback and sequential papers come from marketplaces and experimentation platforms with many users or many periods. Applying them to one company is my extrapolation.
- No primary source on pre-registration for internal process changes. Found only practice posts and the Spotify decision-rule paper.
- No source on effort or duration forecasting for AI-agent tasks that uses a reference class built from the company's own history. Reference class forecasting evidence is from infrastructure and PM, with a thin software base; the agent-estimate studies (C1 to C3) are small or workshop level.
- No source that measures calibration of agent-versus-human forecasts on work tasks inside an organisation; ForecastBench is about world events.
- No source with a skill-promotion gate in a non-clinical, open-ended domain showing a gain; GRASP says it shows none where the action space is open-ended.
- No 2025 to 2026 primary source on agent-team coordination protocols with measured outcomes; CHAP is a specification only.
- No source on how many tasks per period are enough to detect a given effect when outcomes are review verdicts; that must be computed by AXION's own simulation.

## 4. Candidate projects

Existing state, from the task statement and earlier rounds, not from code: missions, tasks, reviews, approvals, delegation briefs with task class and difficulty, org revisions, an audit chain, org change proposals with approval and rollback, skills and playbooks with caps. No agents execute. Time comparisons use DB `now()`.

### R5-1. Change hypothesis registry with a locked analysis plan and decision rule
**What.** Extend the org change proposal and any process change (review policy, escalation threshold, brief template) with a pre-registered evaluation plan stored before approval and hash-locked at approval: primary metric (one), success direction, guardrail metrics with non-inferiority margins, task classes in scope, minimum number of units, evaluation window, stop rule, covariates allowed, and the decision for each outcome ("adopt", "revert", "extend"). After the window, the readout page shows plan versus actual, and flags any metric or window changed after the lock. Builds on R2-10 (hypothesis and task classes) and R3-6 (evidence block, baseline); new is the locked plan, guardrail margins and the plan-versus-actual diff.
**AXION data.** Org revisions (timestamps), proposals, tasks, reviews, approvals, brief class and difficulty. Records only; no EXEC dependency.
**First slice.** A plan record with fields above, a content hash at approval, an append-only "plan amendment" record, and a readout that lists any amendment made after data arrived. No statistics yet beyond counts and an explicit "not enough evidence" under the minimum n.
**Thresholds.** (a) Approval without a plan is refused for the change classes the owner lists: 100% over a fixture matrix of at least 15 cases. (b) Editing a locked plan field other than through an amendment is refused; amendments dated after the first outcome row are flagged in 100% of 10 fixtures. (c) A readout with fewer units than the plan's minimum shows "not enough evidence", never a verdict. (d) The plan hash verifies from the audit row. **Size S.**
**Risks.** Becomes paperwork if every small change needs a plan; limit by class. A plan locks the metric but cannot stop a bad metric (R3-4 still applies).
**Sources.** A11 (success, guardrail, deterioration and quality roles; the rule that a deterioration test changes the power need), A1 (design and analysis fixed in advance), practice posts in section 2 (UNVERIFIED). The lock-by-hash mechanism is my construction.

### R5-2. Randomised period schedule for process toggles, with exact-test readout (switchback)
**What.** For process changes that can be turned on and off per time block (review depth, a brief template, a second-reviewer rule), let the owner schedule alternating blocks by a recorded random draw, with a washout gap, and compute the readout by randomisation inference (permute the block labels) rather than a normal approximation. Optionally rerandomise each block to balance recent load or difficulty, as in A2.
**AXION data.** Tasks and reviews with brief class and difficulty, timestamps, a new block-schedule record. Human-entered missions can follow a schedule now; meaningful effects on agent work are EXEC.
**First slice.** A schedule generator (seeded, logged in the audit chain before the first block), a washout rule, and a permutation test over block means on one pre-declared metric (for example first-pass review acceptance). No rerandomisation, no carryover estimation.
**Thresholds.** (a) On 200 simulated schedules with no true effect, the exact test rejects at 0.05 in 3.5 to 6.5% of runs. (b) On simulated effects of a stated size with n blocks stated in the brief, power is reported, and the readout says "not enough blocks" below an n the simulation sets. (c) A task created in a washout block is excluded from both arms in 100% of fixtures. (d) A schedule changed after the first block is flagged. **Size M.**
**Risks.** Weakest evidence fit here: the sources are marketplace papers with many periods. A company with a few dozen tasks a week may never reach adequate power in a month, and carryover (people learn the new template) is real for human-in-the-loop work. The owner may also object to alternating a policy. If the simulation shows no useful power at AXION volumes, the project must report NOT MET and stop.
**Sources.** A1, A2, A3 (design and carryover), A7 (small-n randomisation logic). Applicability to AXION is an extrapolation.

### R5-3. Few-unit readout for structure changes: placebo test and synthetic-control comparison
**What.** For a restructure that touches one team or role (a "treated" unit), compare its metric path with a synthetic control built from untouched teams or task classes, report pre-change fit, and test by placebo: assign the change to each untouched unit, compute the same gap, and report where the real gap ranks. If pre-change fit is poor, or there are fewer than 3 untreated units, show "not enough evidence". For staggered adoption (several teams changed at different dates), report per-unit gaps and a partially pooled gap instead of a regression coefficient.
**AXION data.** Org revisions give the change date per team or role; tasks, reviews and approvals give weekly per-unit metrics, adjusted for brief difficulty. Records only for human-entered work; EXEC for performance claims about agents.
**First slice.** One read-only report for one metric: pre-change fit error, post-change gap, placebo rank among at least 3 donors, and a plot of both series. No automatic decisions.
**Thresholds.** (a) On a simulated panel with a known effect of a stated size, recovered within a tolerance the brief sets in at least 90% of 100 seeds. (b) On simulated panels with no effect, the placebo rank is at or above the 5th percentile in at most 10% of runs. (c) Fewer than 3 donors or a pre-change fit worse than a stated bound yields "not enough evidence" in 100% of fixtures. (d) Donors that were themselves touched in the window are excluded. **Size M.**
**Risks.** Spillovers: in a company, a reorg of one team changes work routing to others, which breaks the donor assumption. The sources give guarantees for econometric panels with many periods, not for a handful of teams. Placebo p-values have a floor of 1 over donors plus one (with 3 donors the best possible p is 0.25), which must be shown to the owner.
**Sources.** A4, A5, A7 (3 treated and 3 untreated clusters minimum, a claim in the abstract), A6 (as the contrast: asymptotics need many units).

### R5-4. Peek-safe sequential readout with covariate adjustment
**What.** A readout for a before-versus-after or arm-versus-arm comparison that stays valid however often the owner looks: an anytime-valid confidence sequence (or e-value) on the difference in a binary or bounded metric, adjusted for pre-period outcome and brief difficulty. The page shows the sequence, the current bound and the plan's stop rule from R5-1. The adjustment uses only variables fixed before the change, as A10 warns.
**AXION data.** Tasks, reviews and approvals with brief class and difficulty; the pre-period values per task class. Records only.
**First slice.** One function and a fixture suite: a confidence sequence for a difference of two proportions with a stated alpha, plus a pre-period regression adjustment; one chart. No automatic stopping.
**Thresholds.** (a) On 1,000 simulated no-effect streams checked after every observation, the share of streams that ever exclude zero is at most the stated alpha (5%) plus simulation error. (b) Adjusted intervals on simulated data with a pre-period correlation of at least 0.5 are narrower than unadjusted ones, with no loss of coverage, in at least 90% of seeds. (c) Using a post-change variable as a covariate is refused by the plan lock (R5-1). **Size S to M.**
**Risks.** Confidence sequences are wider than fixed-horizon intervals, so decisions arrive later at small n; the owner may find it slow. The enterprise evidence (A9) reports no figures on its page. The statistics are not hard to get wrong, so the simulation is the acceptance test, not the paper.
**Sources.** A8, A9, A10; A11 for the decision rule. A10's gains are reported without numbers on the page.

### R5-5. Skill promotion gate: held-out probe, regression budget, historical replay
**What.** A learned skill, playbook or memory (from R2-5's origin-bound records) cannot become active until a gate passes: (i) a frozen probe set of recorded task shapes, balanced across task classes, never used to write the skill; (ii) net gain on the probe above a stated margin; (iii) a hard regression budget on a separate replay set of historical tasks (no class may lose more than a stated number of points); (iv) a recorded contract per skill: intended behaviour and observable criteria. Each gate run is an append-only record with probe version, scores, margins and a verdict; a human still activates. Probe items are rotated and retired to limit overfitting to the gate itself.
**AXION data.** Today: briefs with class and difficulty, task outcomes and review verdicts as the probe and replay corpus (human-entered or fixtures). Scores from a skill actually changing agent behaviour are EXEC. Before that the first slice tests the gate on fixtures.
**First slice.** The gate function as a pure, tested module plus the gate-run table, exercised on synthetic skill candidates and synthetic score tables. No model calls.
**Thresholds.** (a) On a fixture set of at least 30 candidates (true gain, no gain, harmful on one class, gain only on the probe) the gate admits 100% of true-gain and rejects 100% of the harmful-on-one-class ones; the false admit rate for no-gain candidates with noise is reported against a stated bound. (b) A candidate whose evidence overlaps the probe is refused (leakage check). (c) The gate refuses with "not enough evidence" under a stated probe size. (d) Gate-run records cannot be edited. **Size M.**
**Risks.** Strongest evidence is one paper on a narrow, verifiable domain (B1: clinical procedures scored against state); the authors state it does not help in open-ended action spaces, which describes much of what AXION agents will do. Skill-V (B2) gives no baseline numbers on its page. A gate trained on one probe can be overfit by repeated candidate generation (the multiple-comparisons problem on the gate itself); a held-out second probe or sequential correction is needed and is not in these sources. A human reviewer approves each activation, so false admits cost reviewer time, not silent harm.
**Sources.** B1, B2, B4 (admission-time verification as the obstacle), B3 (gains unstable under deployment), B5 (memory and tool pathways drift).

### R5-6. Raw-episode baseline and drift watch for learned skills
**What.** Every learned skill has to beat a stated simpler alternative on its own probe: retrieving raw recorded episodes (the briefs, outputs and review verdicts of similar past tasks) with no distillation. After promotion, a drift watch tracks per skill: invocation count, outcome by task class versus the baseline arm, share of invocations outside the contract's stated applicability, and drift in review outcomes. Triggers propose demotion (a human decides). Adds to R2-5 (cap, outcome-driven retirement) a comparison arm and applicability tracking.
**AXION data.** Skill records and their use in briefs and tasks, review verdicts. Almost all of it is EXEC; today only the design, the baseline-arm rule and fixtures can be built.
**First slice.** A comparison record type ("skill arm" versus "raw-episode arm" with the same probe) and a demotion-proposal rule on fixtures. Nothing runs against a model.
**Thresholds.** (a) On fixtures where the raw arm wins or ties, promotion is refused in 100% of cases; where the skill beats the raw arm by the stated margin on all classes, it passes. (b) A skill used outside its applicability on more than a stated share of invocations produces a demotion proposal in 100% of fixtures. (c) The watch shows "not enough evidence" under a floor of invocations. **Size S to M.**
**Risks.** The motivating result (B3: raw trajectories often beat distilled skills) is one benchmark of 180 tasks, with no numbers on the abstract page; it may not hold for AXION's work. ANCHOR (B6) reports gains without numbers on its page, so the supervision idea has no quantified support here. Raw-episode retrieval has its own poisoning risk (R2-5 origin rules apply).
**Sources.** B3, B5, B6, B2 (applicability filter).

### R5-7. Forecast ledger: proper scores, reference-class baseline, calibrated intervals for effort and duration
**What.** Anyone who delegates or approves (owner, admin, later an agent) can attach a probability or interval to a brief before work starts: "P(first review accepts)", "P(done by date)", "effort within the p80 interval". The system resolves each from recorded outcomes (review verdict, task completion time, mission state) and scores it with the Brier score (and log score, reported side by side, since the two rules train different behaviour), with the reliability, resolution and uncertainty split, a calibration table with n per bin, and a per-forecaster "not enough evidence" floor. A baseline forecaster that uses only the reference class (same task class and difficulty, historical rate or empirical quantile) is scored alongside, and a forecaster counts as skilled only if it beats the baseline on a stated number of resolved items. A second slice adds distribution-free (conformal) intervals for duration and effort over the reference class, tracking coverage over time. Agents' self-estimates are recorded but never used to set a deadline or budget.
**AXION data.** Delegation briefs with class and difficulty, task timestamps (created, done), review verdicts, mission status. Human forecasts and the reference-class baseline are meaningful now; agent forecasts are EXEC.
**First slice.** A forecast table (forecaster, subject, probability or interval, made_at from DB `now()`, resolved_at), automatic resolution for one question type ("accepted at first review"), and a score page with Brier and calibration bins for the owner's own forecasts versus the reference-class baseline. No agent forecasts.
**Thresholds.** (a) Brier and log scores match hand-computed values on at least 10 fixtures including boundary probabilities of 0 and 1 (log score with a clamp that is stated). (b) A forecast made or edited after the outcome is refused in 100% of fixtures (DB clock). (c) The empirical coverage of a 80% conformal interval on a synthetic stream of at least 500 tasks is between 77 and 83%; below a stated calibration set size it shows nothing. (d) A forecaster with fewer than a stated number of resolved items is labelled "not enough evidence" and is not ranked. (e) Scores are shown per forecaster and per class, never as one leaderboard (see R3-7). **Size M.**
**Risks.** Few resolved items per forecaster make calibration bins noisy. Optimising a score can distort behaviour (forecasting only easy tasks); scores must be per class with coverage of what was forecast. If the data show that human forecasts do not beat the baseline, the feature reports that, which is the useful result. C7's finding is about training objectives, not about evaluating work forecasts. Conformal intervals assume exchangeability, which a changing org breaks, so reference classes must be reset on a restructure and coverage must be watched.
**Sources.** C1, C2 and C3 (agent self-estimates are poor: 4 to 7x overshoot, correlation up to 0.39, coverage 2 to 52%, against a calibrated interval above 85% on 18 of 19), C5 (human forecasters beat LLMs; uses the Brier score), C7 (rules not interchangeable), C4 (estimate scope, expand on verification failure). C6 is used only for the idea of calibrating after the fact, and its body was not read. Reference-class forecasting itself has only secondary sources (section 2).

### R5-8. Handoff packet completeness and structured human overrides
**What.** When an agent or a person hands work to a person (an escalation, a review request, a shift handoff), the handoff record has required fields: the blocker, work done so far, verification status (what was checked, what was not), the options, and the decision asked for. A completeness score per handoff and a per-class trend appear in the operator view. When a person edits an agent's draft or overrides its verdict, the override is stored as a structured event (what changed, a short rationale, the content hash). Distinct from R3-2 (escalation thresholds and outcomes) and R2-9 (approval quality): this measures the quality of what is handed over, not whether or how often it was escalated.
**AXION data.** Delegation briefs, reviews, approvals and audit events already carry much of this; the new fields are small additions. Agent-produced handoffs are EXEC; human-to-human and fixture handoffs work now.
**First slice.** A handoff record with the five fields, a completeness check (all present and non-trivial), and a read-only list of incomplete handoffs. No scoring of content quality.
**Thresholds.** (a) A handoff missing any required field is flagged in 100% of 20 fixtures. (b) Override events cannot be edited (append-only guards). (c) The completeness rate is reported with n and never shown as a target for an agent's score without the metric-gaming guard of R3-4 (an agent can fill fields with filler). (d) A rationale shorter than a stated length is flagged. **Size S.**
**Risks.** Completeness is checkable, quality is not; agents will learn to fill the fields. Evidence is one benchmark (D1: tickets name the blocker but omit progress and verification) and a specification with no results (D2). A metric that moves without the real outcome moving is a documented hazard (the escalation-wording result in background source 2609.05758).
**Sources.** D1, D2; background 2609.05758.

## 5. Ranking, with reasons

Weights: fit to data AXION records now, strength of evidence, effort, risk to the records-only boundary. Evidence in this round is weaker than the topic list suggests: almost all causal methods are from marketplace or economics settings with many units; the skill-learning results are single-benchmark preprints; the forecasting results are small. I give no effect sizes for AXION.

1. **R5-1 Change hypothesis registry (S).** Smallest, records only, and it is the precondition for any honest answer to (a): it stops the owner (and later agents) from choosing the metric after seeing the data. Weak point is that it is process, not statistics, and its sources are a decision-rule paper and practice posts. Low risk.
2. **R5-7 Forecast ledger (M).** Uses data AXION has today (briefs, reviews, timestamps), gives the owner a measurable calibration number for themselves and a reference-class baseline, and prepares a fair test for agent estimates later. Evidence that agent self-estimates are unreliable is consistent across three sources (all small). Risk is noisy calibration at low n, handled by floors.
3. **R5-5 Skill promotion gate (M).** The strongest answer to (b): the one source with big reported gains attributes them to the gate. But its domain is narrow and the real test is EXEC. Build the gate and its records now so that nothing learned can be activated without it. Risk: gate overfitting, and no source covers it.
4. **R5-3 Few-unit placebo and synthetic-control readout (M).** The best match for "very few units", fully computable from org revisions and per-team metrics. The guarantees are asymptotic and spillovers are likely, so it must say "not enough evidence" often. Moderate value, moderate risk of false comfort.
5. **R5-4 Peek-safe sequential readout (S to M).** Removes the common error of watching a result until it looks good; cheap, and testable by simulation. Gains at small n are modest and intervals are wide.
6. **R5-8 Handoff completeness and structured overrides (S).** Cheap and clear, but weak evidence and an obvious gaming path; value rises once agents hand work over.
7. **R5-6 Raw-episode baseline and drift watch (S to M).** Good idea from one counter-intuitive benchmark; almost entirely EXEC, so it waits for R5-5 and real skill use.
8. **R5-2 Randomised period schedule (M).** The most innovative and the least likely to have power at AXION volumes; do the simulation first and stop if it shows nothing.

Suggested order: R5-1 with R5-7 (disjoint tables), then R5-5, then R5-4 on top of R5-1's plan lock, then R5-3. R5-6 after R5-5; R5-8 whenever a lane is free; R5-2 only after a simulation brief. New owner questions: which process changes the owner is willing to alternate in blocks (R5-2); whether the owner will record forecasts before delegating (R5-7); what regression budget per task class the owner accepts for a skill (R5-5).

## 6. Notes for the verifier

- All sources were read as page summaries; no body was read. Nothing here is peer-reviewed at a main venue except B1 (EMNLP 2026 per the page), B5 (ICLR 2026), A10 (CLeaR 2026) and A9 (WWW Companion 2023). Workshop level: C1, C3. Single author: C1. Vendor or company: A9, A11, C6.
- Dates and venues to check: B1 v3 date and venue; C5's ICLR 2025 venue (a search result said so, not the page); C7 and D1 and B2 are dated Aug to Oct 2026 and have one or two versions only; A4's journal status.
- Claims most likely to be wrong: the B1 figures (40.6% to 88.8%, 21.0, 17.2 to 40.3) and the "gate not skill writing" attribution; C3's 2 to 52% and "18 of 19", whose conformal method is not on the page; C1's 4 to 7x and 5 to 10x; D1's 34.0% to 6.7% and 19,371; B3's "raw trajectories often beat distilled skills" (no numbers on the page); A7's "as few as 3 and 3" (abstract claim).
- A2, A3 and A10 do not state numbers on their abstract pages; the statements of improvement are the authors' wording only.
- The Skill-V (B2) numbers have no comparison on the page, so 95.3% and 85.9% say nothing about improvement.
- SkillPivot: its search snippet said "regression-gated verifier" but the abstract page I opened did not. I excluded it for that reason; the verifier should not cite it for a regression gate unless the body says so.
- Licences: A1, A3, B1 to B4, B6, C4, D1, D2 show CC BY 4.0; A2, A4, A5, A6, A7, C1 to C3, C5, C6, C7 use the arXiv non-exclusive licence or no licence on the page I read. Re-implementing an idea is not copying. Copy no text. Software named (augsynth, did, CHAP reference implementation) was not inspected, so its licence and maturity are unknown.
- Constructions that are mine, not sourced: the hash-locked plan with amendment flags (R5-1); the permute-block-labels schedule and washout rule on AXION data (R5-2); the donor rules for restructures (R5-3); the raw-episode baseline as a promotion test (R5-6, motivated by B3); the forecast-skill-versus-reference-class rule (R5-7); the five handoff fields (R5-8, motivated by D1).
- Threshold numbers (3.5 to 6.5%, 77 to 83%, 90% of seeds, 30 candidates) are sketches chosen for testability, not taken from any source.
