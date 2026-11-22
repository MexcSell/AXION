# Research round 2 (2026-11-22)

Scope: new work (mostly 2025 to 2026) that round 1 did not cite. Round 1 sources are not repeated (see `research-org-verified.md`, `research-eval-safety-verified.md`). Every source in section 1 was opened in this session through a page fetch; the claims are paraphrased from the abstract page or the page text I received. Where a fetch tool summarised a page for me, I say what it did not show. Section 2 holds the candidate projects, section 3 the ranking.

Reading notes:
- Several 2026 papers are fresh preprints with no peer review (marked "preprint"). Treat their numbers as claims by the authors, not as settled results.
- Dates are the v1 submission date unless stated.
- Nothing here has been run against AXION. Every threshold is a sketch to be fixed in a brief and then measured.

## 1. Sources

### A. Evaluation: judges, benchmarks, instruments

**A1. How to Correctly Report LLM-as-a-Judge Evaluations.** Chungpa Lee, Thomas Zeng, Jongwon Jeong, Jy-yong Sohn, Kangwook Lee. 26 Nov 2025. https://arxiv.org/abs/2511.21140
A judge that misclassifies correct and incorrect answers gives a biased raw score. The paper corrects that bias with a plug-in estimator and builds confidence intervals that include uncertainty from both the test set and a small human-labelled calibration set, and it allocates calibration labels adaptively. The abstract gives no numbers. Round 1's judge sources (Zheng, JudgeBench, Ye) showed that judges are biased; this one gives a way to still report a valid interval.

**A2. Industrializing Prediction-Powered Inference: The GLIDE Library for Reliable GenAI and Agentic Systems Evaluation.** Grégoire Martinon, Ibrahim Merad, Mohammed Raki. 29 May 2026 (preprint). https://arxiv.org/abs/2605.31278
Prediction-powered inference (PPI) combines a few expensive human labels with many cheap judge scores to get debiased estimates with valid intervals. GLIDE is an open-source library bundling several PPI estimators and sampling strategies, with a decision tree for picking one and an agentic case study. The abstract states annotation savings but gives no figure.

**A3. Establishing Best Practices for Building Rigorous Agentic Benchmarks.** Yuxuan Zhu and 24 co-authors (including Percy Liang, Daniel Kang, Matei Zaharia, Ion Stoica). v1 3 Jul 2025, v5 7 Aug 2025; NeurIPS 2025 Datasets and Benchmarks track (per the search result; the abstract page did not show the venue). https://arxiv.org/abs/2507.02825
Introduces the Agentic Benchmark Checklist (ABC), covering task validity, outcome validity and reporting. The authors say flaws in task setup or reward design can misstate agent performance by up to 100% in relative terms, in either direction, and give examples (insufficient test cases in one coding benchmark; one customer-service benchmark counting empty responses as success). Applying ABC to one cybersecurity benchmark cut its performance overestimate by 33%.

**A4. Towards a Science of AI Agent Reliability.** Stephan Rabanser, Sayash Kapoor, Peter Kirgis, Kangheng Liu, Saiteja Utpala, Arvind Narayanan. 18 Feb 2026 (v3 2 Jun 2026; ICML 2026 per the abstract page). https://arxiv.org/abs/2602.16666
Argues that one success number hides run-to-run inconsistency, fragility under perturbation, unpredictable failure and unbounded severity. Proposes twelve metrics under four dimensions: consistency, robustness, predictability, safety. On 15 models and two benchmarks, the authors report that recent capability gains brought only small reliability gains. Extends τ-bench's pass^k from round 1.

**A5. Agent Evaluation Reliability: More Tasks Won't (Always) Fix An Agent Leaderboard.** Michael Hardy, Ruhana Azam, Anka Reuel, Mykel Kochenderfer, Sanmi Koyejo. 30 Sep 2026 (preprint). https://arxiv.org/abs/2610.00651
A Bayesian variance decomposition over 22 benchmarks from two leaderboards. Fixed model-plus-scaffold systems rank reliably (0.935 to 0.994), but the reliability of ranking the underlying model is much lower (0.148 to 0.841), because scaffold choice is a big source of variance that adding tasks cannot remove. Pooling diverse benchmarks raised projected reliability from 0.44 to 0.75 at the same task budget.

**A6. Silent Instrument Errors Reorder Agent Leaderboards.** Yangze Liu. 3 Nov 2026 (preprint, single author). https://arxiv.org/abs/2611.04399
Shows that in one customer-service benchmark a 13-point gap came from the grader: only about half of one agent's episodes were scored, and the rest counted as failures. An audit of published artifacts found more errors: a cost column double-counted nested model calls, grader-written actions were labelled as agent actions, and re-grading with a newer evaluator changed rankings. The author says the leaderboard maintainers confirmed three findings within five weeks. Proposed checks: report the graded fraction, take cost from root spans, tag who wrote each recorded action, pin evaluator versions and publish a re-grade diff.

**A7. Success Is Not Self-Explanatory: Auditing Success Provenance in Agent Evaluation.** Jingkun Luo, Da-Tian Peng. 27 Jul 2026 (preprint). https://arxiv.org/abs/2607.24054
A correct answer does not show whether the agent reasoned to it or obtained it. The authors compare three information conditions (benchmark-authorised, correct answer made available, matching wrong value substituted) and report that the score follows the available value by 19.1 to 25.9 points in one setting. They recommend reporting success together with whether the evaluated information state supported it.

**A8. Holistic Agent Leaderboard: The Missing Infrastructure for AI Agent Evaluation.** Sayash Kapoor and 30 co-authors. 13 Oct 2025 (ICLR 2026 per search result). https://arxiv.org/abs/2510.11977
A standard harness and third-party leaderboard: 21,730 rollouts, 9 models, 9 benchmarks, about 40,000 USD, accuracy reported against cost. One finding is that higher reasoning effort lowered accuracy in most runs. LLM-aided log inspection found behaviour such as an agent looking up the benchmark online instead of solving the task. All logs were released. Follows "AI Agents That Matter" (round 1) with data.

### B. Organisation and coordination

**B1. OrgAgent: Organize Your Multi-Agent System like a Company.** Yiru Wang, Xinyue Shen, Yaohui Han, Michael Backes, Pin-Yu Chen, Tsung-Yi Ho. 1 Apr 2026 (preprint). https://arxiv.org/abs/2604.01020
A three-layer company-style framework (governance, execution, compliance). Across reasoning tasks the authors find hierarchy generally beats other structures and usually uses fewer tokens; one example reports a 102.73% gain over a flat system with 74.52% fewer tokens. They say hierarchy helps most where tasks need stable skill assignment, controlled information flow and layered verification.

**B2. Drop the Hierarchy and Roles: How Self-Organizing LLM Agents Outperform Designed Structures.** Victoria Dochkina. 30 Mar 2026 (preprint, single author). https://arxiv.org/abs/2603.28990
A 25,000-task experiment (8 models, 4 to 256 agents, 8 protocols). A hybrid sequential protocol beat centralised coordination by 14%, quality varied 44% across protocols, and models below a capability threshold did better with rigid structure. This contradicts B1, which is the useful point: the answer depends on task and model capability.

**B3. Multi-Agent Teams Hold Experts Back.** Aneesh Pappu, Batu El, Hancheng Cao, Carmelo di Nolfo, Yanchao Sun, Meng Cao, James Zou. 1 Feb 2026 (preprint). https://arxiv.org/abs/2602.01011
Teams without fixed structure generally do worse than their best member, even when told who the expert is, with losses up to 41.1% on ML benchmarks. The failure is in using expertise (the team averages expert and non-expert views), not in finding it. The same consensus-seeking made teams more robust to adversarial members.

**B4. Which Agent Causes Task Failures and When? On Automated Failure Attribution of LLM Multi-Agent Systems.** Shaokun Zhang and 10 co-authors. 30 Apr 2025. https://arxiv.org/abs/2505.00212
Defines automated failure attribution (which agent, which step) and releases the Who&When dataset from 127 systems. The best method named the responsible agent 53.5% of the time but the failing step only 14.2% of the time.

**B5. Seeing the Whole Elephant: A Benchmark for Failure Attribution in LLM-based Multi-Agent Systems (TraceElephant).** Mengzhuo Chen and 6 co-authors. 24 Apr 2026 (ACL 2026 per the abstract page). https://arxiv.org/abs/2604.22708
Argues earlier benchmarks showed only agent outputs. With full execution traces including inputs, the authors report attribution accuracy up to 76% better than with partial observation. Relevant to what AXION should record per step.

### C. Security, governance, oversight

**C1. Agents Rule of Two: A Practical Approach to AI Agent Security.** Meta (no named authors). 31 Oct 2025. https://ai.meta.com/blog/practical-ai-agent-security/
A design rule: within one session an agent should have at most two of (A) processes untrusted input, (B) accesses sensitive systems or private data, (C) can change state or communicate externally. If a task needs all three, use a fresh session per step or require supervision such as human approval. The post says it supplements least privilege, does not address hallucination or excess privilege, and can fail if a person approves a warning without reading it. This is a vendor blog, not a paper.

**C2. Reframing LLM Agent Security as an Agent-Human Interaction Problem.** Peiran Wang, Ying Li, Yuan Tian. 23 May 2026 (preprint). https://arxiv.org/abs/2605.24309
A survey of 59 papers, 21 production agent systems and 26 security plugins (state as of April 2026). Policy specification, runtime approval and scope configuration dominate production (14, 15 and 16 of 21 systems); intent anchoring and trust labelling, popular in research, have zero production deployment. The authors say current human-in-the-loop designs trade cognitive burden against security, between approval fatigue and uncontrolled autonomy.

**C3. Agent Skills in the Wild: An Empirical Study of Security Vulnerabilities at Scale.** Yi Liu and 7 co-authors. 15 Jan 2026 (preprint). https://arxiv.org/abs/2601.10338
Of 42,447 skills collected from two marketplaces, 31,132 were analysed: 26.1% had at least one vulnerability across 14 patterns (prompt injection, exfiltration, privilege escalation, supply chain), and 5.2% showed patterns suggesting malicious intent. Skills bundling scripts were 2.12 times as likely to be vulnerable. The authors call for capability-based permissions and vetting.

**C4. "Do Not Mention This to the User": Detecting and Understanding Malicious Agent Skills in the Wild.** Yi Liu, Zhihao Chen, Yanjun Zhang, Gelei Deng, Yuekang Li, Jianting Ning, Leo Yu Zhang. 6 Feb 2026 (preprint). https://arxiv.org/abs/2602.06547
From 98,380 skills in two registries the authors confirmed 157 malicious ones with 632 vulnerabilities. Two strategies: credential theft through code execution, and manipulating the agent through instructions hidden in documentation. Over half the cases came from one actor using templated brand impersonation.

**C5. From Untrusted Input to Trusted Memory: A Systematic Study of Memory Poisoning Attacks in LLM Agents.** Pritam Dash, Tongyu Ge, Aditi Jain, Tanmay Shah, Zhiwei Shang. 3 Jun 2026 (preprint). https://arxiv.org/abs/2606.04329
Identifies 4 memory write channels and 9 structural weaknesses, a taxonomy of 6 attack classes, and a benchmark (MPBench). Agents built to write and retrieve memory more aggressively were more exploitable, and existing prompt-injection defences did not fully cover memory poisoning.

**C6. Securing LLM-Agent Long-Term Memory Against Poisoning: Non-Malleable, Origin-Bound Authority with Machine-Checked Guarantees.** Yedidel Louck. 23 Jun 2026 (preprint, single author, not peer reviewed). https://arxiv.org/abs/2606.24322
Argues that judging a memory item by its content or its derivation history can be fooled by "laundering" (the agent's own summary, a trusted tool's echo, manufactured corroboration), and that binding origin at write time is necessary. The reported benchmark on eight models has existing defences reaching up to 68% laundering success and the proposed design 0%. These are the author's own results; I did not check the proofs or the harness.

**C7. Behavioral Governance for Autonomous AI Agents: The AgentBound Framework.** Anuj Kaul, Qianlong Lan, Pranay Gupta. 29 Jun 2026 (preprint). https://arxiv.org/abs/2606.30970
Each proposed action is checked by three authorities (delegated authorisation, owner-signed behavioural rules, site action contracts) and classed permitted, reviewed or denied. It issues verifiable receipts linking each action to the delegation and policy behind it, and "standing delegation" that is revocable and bounded. The abstract reports no quantitative results.

**C8. Signed, Hash-Chained Action Receipts for AI Agents (draft-sahu-agent-action-receipts-00).** N. Sahu. 16 Aug 2026; Informational Internet-Draft, expires 17 Feb 2027, not a standard. https://www.ietf.org/archive/id/draft-sahu-agent-action-receipts-00.html
One signed JSON receipt per attempted action (step id, action id, params, success flag, host timestamp, Ed25519 key and signature), stored as lines where each stores the SHA-256 of the previous line, verifiable offline against a separately held trust anchor. The draft itself says this is tamper-evidence, not tamper-proofing: truncation of the log end is undetectable without an external anchor, and timestamps and actor fields are self-asserted. It advises keeping sensitive content out of params.

**C9. OWASP Top 10 for Agentic Applications for 2026.** OWASP GenAI Security Project. 9 Dec 2025. https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
A peer-reviewed risk list, said to involve more than 100 experts, with risks labelled ASI01 to ASI10. The page I received did not list the ten names (only a description), so I cannot report them; use it only as a pointer and read the PDF before citing any category.

### D. Memory, skills, self-improvement

**D1. Library Drift: Diagnosing and Fixing a Silent Failure Mode in Self-Evolving LLM Skill Libraries.** Xing Zhang and 6 co-authors. 19 May 2026 (preprint; ICML 2026 per a search result, not confirmed on the abstract page). https://arxiv.org/abs/2605.19576
Unbounded skill accumulation without outcome-driven lifecycle management can pull performance down through diluted retrieval and false skill injections. In one benchmark, LLM-written skills gained 0.0 points while human-curated ones gained 16.2. A recipe of outcome-driven retirement, a cap on active skills and an authoring prior raised held-out pass@1 on one coding set from 0.258 to a late-window mean of 0.584. An append-only evidence log per skill exposed the failure before end-task scores did. Complements ACE, ExpeL and Agent Workflow Memory from round 1.

### E. Observability and protocols

**E1. OpenTelemetry Semantic Conventions for GenAI: agent spans.** OpenTelemetry project (semantic-conventions-genai repository). Page read 2026-11-22; status "Development", so names may change. https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-agent-spans.md
Defines spans for creating an agent, invoking an agent or workflow (client and internal variants), planning, and executing a tool, with attributes such as operation name, agent id/name/version, conversation id, error type, model and token usage. Message content, system instructions and tool definitions are opt-in, with `_ref` variants pointing to external storage, and the page warns they may hold sensitive data. It says not to invent conversation ids and not to fabricate output for failed operations.

**E2. Model Context Protocol specification (version 2026-07-28), overview and authorization.** Model Context Protocol project. https://modelcontextprotocol.io/specification/latest and https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization.md
The overview states consent principles: explicit user consent before tool invocation, and tool descriptions or annotations treated as untrusted unless from a trusted server. Optional extensions include Tasks (long-running operations with durable handles) and Skills over MCP. The authorization page requires, for HTTP transports that use it, OAuth 2.1 style flows, a resource parameter naming the target server, validation that a token was issued for that server, no token passthrough, least-privilege scope challenges and a step-up flow when scope is insufficient. Useful vocabulary for AXION's grants.

**E3. Agent2Agent (A2A) Protocol specification, latest.** A2A project (page shows a banner that it joined the Agentic AI Foundation). https://a2a-protocol.org/latest/specification/
Version 1.0.0 at the time of reading. An Agent Card describes an agent's identity, skills, endpoint and auth needs; tasks move through submitted, working, input-required, auth-required and terminal states (completed, failed, canceled, rejected). The page covers signed agent cards in a section I did not read (the fetch tool read only the first 100,000 of about 257,000 characters), and the part I saw had no audit or logging requirements. Useful as a task-state vocabulary.

## Not opened, only seen in search results: UNVERIFIED

Do not cite these until opened.
- arXiv 2604.02674 "Do Agent Societies Develop Intellectual Elites?" (heavy-tailed coordination cascades).
- arXiv 2609.11737 "Organizational Principles Enable Collective Intelligence in Embodied AI" (task-allocation failure rates by hierarchy source).
- Zenodo record 18809207 "Organizational Physics of Multi-Agent AI", Feb 2026 (not arXiv).
- arXiv 2605.09315 "Do Self-Evolving Agents Forget?"; arXiv 2605.22148 (Ratchet, skill lifecycle); arXiv 2610.00093 "Safety in Self-Evolving Agents: A Survey"; arXiv 2604.16548 (memory security survey).
- arXiv 2512.17259 "Verifiability-First Agents"; IETF drafts draft-farley-acta-signed-receipts and draft-stone-aivs-00.
- arXiv 2601.05420 and 2601.20913 (judge measurement-error and judge-reliability diagnostics); arXiv 2606.05308 (PPI for rankings).
- arXiv 2603.25001 (MP-Bench), 2610.11600 (EMFA), 2610.18780 (BLADE): failure attribution follow-ups.
- Secondary claims about how often users approve agent permission prompts (blogs gave 93% and 97%, in conflict; no primary source found). Do not use a number.

## 2. Candidate projects

All are records, schemas, validators and pure functions, tested with fixtures and fake data. None calls a model, runs an agent or automates a browser. Thresholds are proposals for a brief, not results.

### R2-1. Judge-calibrated verdicts (calibration set and bias-corrected interval)
- **Idea.** When an evaluation result is labelled "judge-scored" (c53 adds judge labels), the verdict needs a human-labelled calibration sample for that judge and that dataset. A pure function estimates judge sensitivity and specificity from the sample and reports a corrected interval for the pass rate; the verdict is inconclusive when the calibration set is too small or the interval spans the margin.
- **Sources.** A1, A2 (and round 1: Zheng, JudgeBench, Ye, error bars).
- **Why for AXION.** The verdict function from E1 treats a judge's output as truth; round 1 found judges are biased, and AXION already has the "producer is not verifier" rule but no rule on judge accuracy.
- **Boundary.** Fits records-only: it is arithmetic over stored labels. Collecting human labels is a person's work through the existing UI; no model call.
- **Threshold sketch.** Property tests: with simulated judges of known error, the corrected interval covers the true rate in at least 93% of 1,000 simulated datasets at a nominal 95%; a verdict without calibration data is inconclusive in 100% of fixture cases; the raw-versus-corrected difference is always shown.
- **Size.** M.

### R2-2. Evaluation instrument audit record (graded fraction, grader version, action provenance, cost roots)
- **Idea.** Every stored run records: episodes attempted, episodes graded, ungraded episodes with reason; grader name and version; who wrote each recorded action (agent, grader, human, tool); cost taken from root spans only. A verdict refuses to compare two runs whose grader versions differ unless a re-grade diff is attached, and shows the graded fraction beside every pass rate.
- **Sources.** A6 (direct), A3, A8.
- **Why for AXION.** AXION's integrity work (E1c, H11) already found silent clock and re-run problems; an ungraded episode counted as a failure is the same class of silent error and would bias every scorecard cell.
- **Boundary.** Records and validation only; needs no run-write route to specify, but pairs with the E1c one when it exists.
- **Threshold sketch.** Fixture runs with 50% ungraded must not produce a "worse" verdict (it becomes inconclusive); a grader-version mismatch is rejected in 100% of tests; a nested-cost fixture counts each call once.
- **Size.** S to M.

### R2-3. Dataset validity checklist and success provenance field
- **Idea.** Before a dataset can be frozen for a holdout, an owner or admin completes an ABC-style attestation (task validity, outcome validity, reporting items), stored with the content hash. Each case also records the allowed information sources, and each run records whether any disallowed source was reachable. Unattested datasets can still be used but their verdicts carry a visible "unvalidated" flag.
- **Sources.** A3, A7, A8 (the agent that searched for the benchmark online).
- **Why for AXION.** Spec thresholds mean nothing if the test accepts wrong answers or leaks them; the SWE-Bench+ result from round 1 is the same risk.
- **Boundary.** Records only. Human attestation; no execution.
- **Threshold sketch.** A freeze without an attestation is flagged in 100% of tests; every checklist item has a stored answer or an explicit "not applicable" with reason; changing an answer creates a new dataset version hash.
- **Size.** S.

### R2-4. Reliability profile beyond pass^k
- **Idea.** A reliability record per agent version and dataset with four columns following A4: consistency (agreement across repeats), robustness (results on perturbed variants of the same case), predictability (does stated confidence track outcome), safety (failures weighted by severity class). Shown in the scorecard with n and "not enough evidence" until repeats exist. Report model-versus-scaffold uncertainty separately when more than one scaffold is recorded (A5).
- **Sources.** A4, A5.
- **Why for AXION.** The six-dimension scorecard has a reliability cell, but today that is one number. A single success rate would hide what A4 says matters for promotion decisions.
- **Boundary.** Pure functions over stored runs; EXEC-tagged, so cells are mostly empty until execution exists.
- **Threshold sketch.** Each metric computed on fixtures with a known answer (for example all-equal repeats give consistency 1.0, fully random give a stated lower value); fewer than k repeats yields null, never zero.
- **Size.** M.

### R2-5. Origin-bound memory and skill records with lifecycle governance
- **Idea.** Extend E4 (experience candidates, playbooks, skills): each memory, lesson or skill record stores its write channel (human entry, agent output, tool output, summary of another record), an origin class that cannot be raised by summarising or by agreeing with another agent-written item, and who elevated it. Only a person can elevate an item to "active". Add a per-record append-only contribution log, an active-item cap per role, and outcome-driven retirement proposals (a person decides).
- **Sources.** C6 (preprint, own results), C5, D1, C3, C4.
- **Why for AXION.** E4 already forbids activation without review; this closes laundering (a reviewed summary of tainted content) and the "library drift" decay that D1 reports. Skill marketplaces in C3 and C4 show third-party skill text is an attack surface.
- **Boundary.** Records and validators only. No retrieval into a model, no execution of skill code; importing external skills stays out of scope.
- **Threshold sketch.** 100% of attempts to set origin "human" via agent-side routes are rejected; a derived item never has a higher origin class than its weakest source (tests); cap enforced; retirement proposals appear when a fixture's contribution score drops under a stated floor.
- **Size.** M.

### R2-6. Rule-of-Two capability profile in the policy service
- **Idea.** Every delegation brief and agent configuration declares three flags: reads untrusted input, reaches sensitive data or systems, can change state or communicate externally. The deterministic policy service (P1) returns "needs approval, tier at least R2" or "deny" when all three hold in one configuration, and cannot be lowered by the requester. Record the flags with each approval so a review can see why it was asked.
- **Sources.** C1, C9 (pointer only), C2; round 1 CaMeL, attacker-moves-second.
- **Why for AXION.** The policy service and the browser contract already classify tiers per action; this classifies the configuration, which is where untrusted page text, grants and external writes meet. It is cheap and does not rely on any filter.
- **Boundary.** Pure policy logic and brief schema; fits Wave 2 style records. A UI note explaining "why" fits the existing `?` convention.
- **Threshold sketch.** Table-driven tests over all 8 flag combinations (only the all-true case escalates); the flags cannot come from the requester's text (tests); at least 30 unit cases.
- **Size.** S to M.

### R2-7. Signed policy-decision receipts and an offline verifier
- **Idea.** For each policy decision and approval, emit a canonical receipt (action digest, policy version, decision, approver, outcome, no raw content) signed with a key held outside the database, chained to the previous receipt, with an exportable file and a small offline verifier. Reuse the external anchor idea from the open P5b item so truncation is caught.
- **Sources.** C8 (draft, not a standard), C7 (preprint), E2.
- **Why for AXION.** The audit chain already catches edits; a receipt that binds decision, policy version and action digest lets an outsider check an approval without database access.
- **Boundary.** Records and a verifier; key handling and any anchor service outside the app need owner approval. No agent execution involved.
- **Threshold sketch.** Editing, removing, inserting or reordering any line is detected in 100% of mutation tests; truncation is detected only with an anchor (tested both ways and documented); no receipt contains params from an untrusted-text field.
- **Size.** M.

### R2-8. OpenTelemetry GenAI trace mapping (export only)
- **Idea.** Define a mapping from AXION's trace and task records to the OTel agent span names and attributes (invoke agent, execute tool, plan, error type, agent id and version), with content off by default and `_ref` pointers instead of inline text. Provide an export to a local file in OTLP JSON for an outside viewer. No collector, no network.
- **Sources.** E1 (status Development), E3 (task-state vocabulary), B5 (full traces matter).
- **Why for AXION.** Ties the trace schema from E1 to a convention other tools already read, and fixes the privacy default before traces exist.
- **Boundary.** Export of stored records; fits. Any live telemetry needs approval. Because the spec is still in development, pin the version and hash of the page used.
- **Threshold sketch.** A mapping table with every AXION field either mapped or listed as "no equivalent"; exported fixtures validate against the pinned attribute list; zero content attributes in default export.
- **Size.** S to M.

### R2-9. Approval-quality metrics (anti rubber-stamping)
- **Idea.** Record decision latency and queue size at the time of each approval, and show per approver the approval rate and median time with n. Flag, not block, "fast bulk approvals" at R2 and above, and show the Rule-of-Two flags (R2-6) and a plain-words action summary in the approval dialog. A person reviews the flags.
- **Sources.** C2 (survey), C1 (the post notes a user approving without reading); the widely quoted approval rates are UNVERIFIED and excluded.
- **Why for AXION.** Approval binding is exact, but an approval is only worth something if read. This measures that without adding a gate.
- **Boundary.** Records and display only. Thresholds are advisory, never an automatic grant or deny.
- **Threshold sketch.** Metrics computed from audit rows with n and window; below 5 approvals the cell reads "not enough evidence"; no flag changes any decision (tests).
- **Size.** S.

### R2-10. Organisation change hypotheses stratified by task class, plus failure attribution fields
- **Idea.** An org change proposal (A1) must name a hypothesis and the task classes it concerns (for example decomposable work versus work that needs one expert's judgement). Outcome comparisons are reported per class, not pooled; a pooled "win" is refused when classes disagree. Add to failure tags (E3) an optional attribution (agent, step) and a flag "full trace available", with agreement counted when two people attribute differently.
- **Sources.** B1, B2, B3 (opposing results; task and capability decide), B4, B5; round 1 scaling result.
- **Why for AXION.** The new papers contradict each other on hierarchy, so a single "hierarchy is better" belief is unsafe; AXION can record evidence by class instead. Attribution notes help a person debug a failed task.
- **Boundary.** Records and stratified arithmetic over human-entered or later agent-produced data; no execution.
- **Threshold sketch.** A proposal with no declared classes is refused; a fixture with opposite effects in two classes produces "mixed", not "win"; attribution is stored only for tasks with a recorded failure.
- **Size.** M.

## 3. Ranking

1. **R2-6 Rule-of-Two profile (S to M).** Cheapest strong control, no new infrastructure, matches the "structure beats filters" lesson in the phase plan. Caveat: the source is a vendor blog; the rule is a heuristic, so label it as such.
2. **R2-5 Origin-bound memory and skills (M).** Closes the main weakness of E4 before any agent writes memory, and is supported by several independent lines (poisoning studies, skill-marketplace studies, drift). Caveat: the strongest design claim (C6) is a single-author preprint, so build the rule (origin never rises by summarising) and test it ourselves rather than trust the reported 0%.
3. **R2-1 Judge-calibrated verdicts (M).** Directly improves the verdict function and the c53 judge labels, with a measurable coverage test. Caveat: A1 abstract gives no numbers; our own simulation is the evidence.
4. **R2-2 Evaluation instrument audit (S to M).** Cheap, prevents a silent bias class AXION is already prone to. Caveat: A6 is a single-author preprint.
5. **R2-3 Dataset validity checklist (S).** Small and independent of the others.
6. **R2-7 Signed decision receipts (M).** Strong for outside auditability; depends on the anchor and key decisions, so likely needs an owner question.
7. **R2-8 OTel mapping (S to M).** Useful, but the convention is still in development; wait until traces exist in volume.
8. **R2-4 Reliability profile (M).** Valuable once repeated runs exist; until then mostly "not enough evidence".
9. **R2-9 Approval-quality metrics (S).** Good for UX, low priority, and its main evidence is a survey.
10. **R2-10 Org hypotheses by task class (M).** Right idea given the contradictory literature, but it needs real org-change data to matter.

Suggested pairing for lane disjointness: R2-6 with R2-9 (policy and approvals), R2-1 with R2-2 and R2-3 (evaluation code), R2-5 alone (knowledge records).
