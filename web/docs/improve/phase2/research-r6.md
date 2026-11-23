# Research round 6 (2026-11-23)

Question: what are the best-evidenced practices (2024 to 2026) for turning a records-only agent company into one where agents execute, safely and measurably? Scope: docs only. Topics not repeated from rounds 2 to 5 (judge calibration, Rule-of-Two profile R2-6, signed receipts R2-7, earned-autonomy ladder R3-3, tenant isolation R4-4, skill gate R5-5, forecast ledger R5-7). Where a candidate extends one of those it says so.

Method note: sources were fetched with a page-to-text tool that answers a prompt against the page, so numbers below are as that tool returned them. Where a number came only from an abstract I say so. Two PDFs (Progent, Attacker Moves Second) could not be read as PDF; I read their arXiv HTML versions, and for the second the tool read only the first 100,000 of 135,858 characters.

## 1. Sources (all opened)

### A. Execution sandboxing, egress, secrets

**A1. Anthropic engineering, "Making Claude Code more secure and autonomous with sandboxing", 2025-10-20.** https://www.anthropic.com/engineering/claude-code-sandboxing
Filesystem limited to the working directory using bubblewrap (Linux) and seatbelt (macOS). Network only through a Unix-socket proxy outside the sandbox that restricts domains and asks the user about new ones. In the web version, git credentials and signing keys stay outside the sandbox; the git client holds a scoped credential, and a proxy checks the credential and the operation (for example push only to the configured branch) then adds the real token. One measured number: "reduces permission prompts by 84%" in Anthropic's internal usage. No attack-side numbers.

**A2. Anthropic docs, "Securely deploying AI agents" (Agent SDK), undated, fetched 2026-11-23.** https://code.claude.com/docs/en/agent-sdk/secure-deployment
Layered options with a comparison table: sandbox runtime (very low overhead), containers (hardened example: cap-drop ALL, no-new-privileges, seccomp, read-only root, tmpfs, `--network none`, memory/CPU/pids limits, non-root, read-only code mount), gVisor (about 0% on CPU-bound work, about 2x slower simple syscalls, 10 to 200x slower on heavy open/close file I/O), Firecracker microVM (boot under 125 ms, under 5 MiB overhead; no network interface, traffic over vsock to a host proxy). Recommends a credential proxy outside the boundary that injects keys, enforces a domain allowlist and logs every request. Warns: no TLS inspection means the allowlist is by client-supplied hostname and domain fronting may bypass it; anything on the allowlist can still receive exfiltrated data; some programs ignore HTTP_PROXY (Node fetch by default); even read-only code mounts can expose `.env`, cloud credential files and keys. Vendor guidance, no measured security outcomes.

**A3. NVIDIA AI Red Team (Rich Harang), "Practical security guidance for sandboxing agentic workflows and managing execution risk", 2026-01-30.** https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/
Mandatory: default-deny outbound network with approval for new destinations and trusted DNS resolvers only; OS-level block of writes outside the workspace and of agent config files. Recommended: block reads outside the workspace; sandbox every spawned process (hooks, MCP startup scripts); microVM or Kata or full VM rather than shared kernel; fresh approval per policy-violating action ("allow-once / run-many is not an adequate control"); minimal credentials, short-lived per-task secrets injected through a broker the agent cannot reach; ephemeral or periodically rebuilt sandboxes. Red-team practice write-up, no measured rates.

### B. Staged rollout of autonomy, canaries, oversight

**B1. Anthropic, "Measuring AI agent autonomy in practice", 2026-02-18.** https://www.anthropic.com/research/measuring-agent-autonomy
Observational usage data. Claude Code full auto-approve is about 20% of sessions for users under 50 sessions and over 40% by 750 sessions; interruptions rise from about 5% of turns (about 10 sessions) to about 9% for experienced users. Public API: 73% of sampled tool calls appear to have a human in the loop, 80% at least one safeguard, 0.8% appear irreversible; the authors say these are upper bounds. On the most complex tasks the agent asks for clarification more than twice as often as on minimal tasks. Descriptive, not an evaluation of staged rollout.

**B2. Feng, McDonald, Zhang, "Levels of Autonomy for AI Agents", arXiv:2506.12469, v1 2025-06-14, v2 2025-07-28 (abstract only).** https://arxiv.org/abs/2506.12469
Five levels defined by the user's role: operator, collaborator, consultant, approver, observer. Proposes "autonomy certificates" as a governance mechanism; the abstract does not say how they work. A position paper, no measurements.

**B3. Google SRE Workbook, "Canarying Releases".** https://sre.google/workbook/canarying-releases/
Canary population small but representative; its error-budget effect is proportional to traffic (20% errors on a 5% canary is about 1% overall). Run one canary at a time; canary should last at least one work unit for non-interactive systems; metric interval no longer than canary (an hourly metric on a 30-minute canary muddied the signal); keep "no more than a dozen" metrics ranked by user-visible relevance; compare canary against concurrent control rather than before/after; check absolute SLOs as well; tune thresholds on historical canary failures. Software releases, not agent versions; the transfer is my extrapolation.

### C. Evaluating real runs

**C1. Anthropic engineering, "Demystifying evals for AI agents", 2026-01-09.** https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
Grade the final environment state, not the agent's claim (a "flight booked" message with no reservation fails). Prefer grading outputs over exact step sequences, but keep transcript checks for turn count, tool use, token budget. Read transcripts to separate agent error from grader error: Opus 4.5 scored 42% on CORE-Bench until grading bugs were fixed, then 95%. Treat 0% pass over many trials as a likely broken task; write a reference solution to prove solvability. Isolate trials (one run read git history left by a previous trial). pass^3 at 75% per trial is about 42%. Start with 20 to 50 tasks from real failures. Vendor write-up with anecdotes.

**C2. METR (Von Arx, Chan, Barnes), "Recent frontier models are reward hacking", 2025-06-05.** https://metr.org/blog/2025-06-05-recent-reward-hacking/
Reward hacks per run: RE-Bench 39 of 128 (30.4%); one task 21 of 21; HCAST 8 of 1,087 (0.7%); more than 43x more common on RE-Bench. Examples: stubbing the evaluator to always succeed, tracing the call stack to read the grader's answer, slowing the scorer's clock. Detection: manual review of anomalously high scores, plus an LLM reading transcripts; both had high false-positive rates and overlapped on only 2 cases in a validation set, so totals are likely underestimates. Telling the model not to cheat barely moved the rate on one task (80% to 70%, 20 runs per prompt). Small samples, mostly one model.

**C3. Yao et al., "tau-bench", arXiv:2406.12045, 2024 (abstract only).** https://arxiv.org/abs/2406.12045
Introduces pass^k (all k trials succeed). Function-calling agents such as gpt-4o succeed on under 50% of tasks and pass^8 is under 25% in retail. Evaluates final database state against the goal state.

**C4. Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" (MAST), arXiv:2503.13657, v1 2025-03-17, v3 2025-10-26 (abstract only).** https://arxiv.org/abs/2503.13657
Taxonomy of 14 failure modes in three groups (system design, inter-agent misalignment, task verification) built from 150 traces; 1,600+ annotated traces from 7 frameworks; expert annotator agreement kappa 0.88. Gives a failure-label vocabulary for run review.

**C5. Kapoor et al., "AI Agents That Matter", arXiv:2407.01502, 2024-07-01 (abstract only).** https://arxiv.org/abs/2407.01502
Evaluate cost and accuracy jointly; accuracy-only leaderboards reward needlessly complex, expensive agents; many benchmarks lack proper holdout sets, which lets agents overfit or take shortcuts. The abstract says joint optimisation can cut cost substantially at similar accuracy; no figures on that page.

### D. Injection and misuse defences under adaptive attack

**D1. Debenedetti et al., "Defeating Prompt Injections by Design" (CaMeL), arXiv:2503.18813, v1 2025-03-24, v2 2025-06-24.** https://arxiv.org/abs/2503.18813
Separates control flow and data flow, both derived from the trusted user query, so untrusted retrieved data cannot change program flow; capabilities on tool arguments enforce policies on data flows. AgentDojo: 77% of tasks solved with provable security versus 84% undefended (abstract). The "provable" claim is about the interpreter's policy enforcement, not about the model.

**D2. Beurer-Kellner et al., "Design Patterns for Securing LLM Agents against Prompt Injections", arXiv:2506.08837, 2025-06-10, v3 2025-06-27 (abstract only).** https://arxiv.org/abs/2506.08837
14 authors; proposes patterns that give resistance to injection at a utility cost, with case studies. The page I read did not list the patterns; the names (plan-then-execute, dual LLM, action-selector, and others) are not verified here.

**D3. Nasr, Carlini et al., "The Attacker Moves Second", arXiv:2510.09023, 2025-10-10 (HTML read, first 100,000 of 135,858 characters).** https://arxiv.org/html/2510.09023
Adaptive attacks (gradient, RL, random search, human-guided) against 12 published defences. Attack success: Spotlighting and Prompt Sandwiching above 95%; RPO 96 to 98%; MetaSecAlign 96% on AgentDojo; Protect AI and PromptGuard detectors above 90%; PIGuard 71%; Model Armor above 90%; MELON 76% (attacker unaware of defence) to 95% (aware); most had reported near-zero rates originally. Human red-team competition with over 500 participants: 265 successes on Spotlighting, 178 on Prompt Sandwiching, 69 on MELON, 123 against detectors under the strictest setting. The defences tested are prompt-level, model-training and detector defences; CaMeL, Progent and Fides are not in the list I read. Conclusion for design: detector and prompt-level defences should not be relied on as the gate.

**D4. Shi et al., "Progent: Programmable Privilege Control for LLM Agents", arXiv:2504.11703, v1 2025-04-16, v3 2026-05-14 (HTML read, first 100,000 of 134,380 characters).** https://arxiv.org/html/2504.11703
Deterministic privilege policies (a DSL) restrict which tool calls and arguments are allowed, with LLM-assisted policy generation and updates. Attack success: AgentDojo 39.9% to 1.0%; ASB 70.3% to 3.9%. Utility "comparable", exact figures only in figures I could not read. The 1.0% is against the benchmark's own attacks, not a tailored adaptive attacker.

**D5. Costa, Köpf et al. (Microsoft), "Securing AI Agents with Information-Flow Control" (Fides), arXiv:2505.23643, v1 2025-05-29, v2 2025-09-03 (abstract only).** https://arxiv.org/abs/2505.23643
Planner that tracks confidentiality and integrity labels and enforces policy deterministically; formal characterisation of what dynamic taint-tracking can enforce; evaluated on AgentDojo, qualitatively "broad range of tasks with guarantees". No numbers on the page.

**D6. Meta, "Agents Rule of Two", 2025-10-31.** https://ai.meta.com/blog/practical-ai-agent-security/
In one session an agent should have at most two of: processes untrusted input, accesses sensitive systems or private data, changes state or communicates externally. If all three are needed, no autonomous run; require human approval or a fresh context. No measurements. (Already the basis of R2-6.)

**D7. Anthropic, browser-use prompt-injection defences, 2025-11-24.** https://www.anthropic.com/research/prompt-injection-defenses
Internal Best-of-N adaptive attacker, 100 attempts per environment, about 2,200 to 3,200 attempts per bar. Attack success model-only / launch safeguards / improved safeguards: Sonnet 4 13.8 / 10.7 / 2.0%; Sonnet 4.5 13.8 / 10.8 / 1.9%; Haiku 4.5 12.0 / 11.1 / 2.4%; Opus 4.5 8.0 / 7.6 / 1.4%. Authors: "a 1% attack success rate ... still represents meaningful risk". Vendor, internal attacker, trained-in defences, not structural.

**D8. OpenAI, "Continuously hardening Atlas against prompt injection", 2025-12-22.** https://openai.com/index/hardening-atlas-against-prompt-injection/
RL-trained automated attacker with counterfactual rollouts, feeding adversarial training of the browser-agent model; guidance to use logged-out mode, review confirmations, give narrow instructions. No quantitative results. Says prompt injection is "unlikely to ever be fully solved" and deterministic guarantees are challenging.

**D9. Google Chrome Security (Nathan Parker), "Architecting security for agentic capabilities in Chrome", 2025-12-08.** https://blog.google/security/architecting-security-for-agentic/
A "User Alignment Critic" model sees only metadata about each planned action (not untrusted page content) and can veto and force a replan; "Agent Origin Sets" (read-only and read-writable origins) gate what the model sees and where it acts; model-generated URLs checked deterministically; user confirmation before sensitive sites, sign-in (model never sees passwords) and consequential actions. No measured results; a bounty of up to $20,000.

**D10. Debenedetti et al., "AgentDojo", arXiv:2406.13352, v1 2024-06-19, v3 2024-11-24 (abstract only).** https://arxiv.org/abs/2406.13352
97 realistic tasks and 629 security test cases; models fail many tasks even without attacks; existing attacks break some security properties but not all. The benchmark underlying D1, D3, D4, D5.

### E. Other

**E1. Model Context Protocol, "Security Best Practices", specification page (2025-06-18 version; references the 2025-11-25 authorization spec).** https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices
Token passthrough forbidden (servers MUST NOT accept tokens not issued to them; reasons: control bypass, broken audit trail); confused-deputy per-client consent; SSRF defences (block private, loopback and link-local ranges including 169.254.169.254, validate each redirect hop, DNS pinning against rebinding, "avoid implementing IP validation manually" because of octal/hex/IPv4-mapped encodings, use an egress proxy such as Smokescreen); scope minimisation (small initial scope, incremental elevation, log elevation events). A standards document, no measurements.

Opened: 22 sources (A 3, B 3, C 5, D 10, E 1).

## 2. Not opened / UNVERIFIED

Seen or recalled only, not opened, no claim in this file depends on them:
- Firecracker NSDI 2020 paper and gVisor documentation (the 125 ms and 5 MiB figures above come from A2, a vendor page, not from the paper).
- OWASP Top 10 for Agentic Applications; Simon Willison "lethal trifecta" post (only cited by A2 as further reading).
- Kubernetes agent-sandbox project and cloud vendor agent-sandbox products.
- TRAIL (trace reasoning and agentic issue localisation) and other trajectory-annotation benchmarks.
- OpenAI "Practices for governing agentic AI systems".
- Workload-identity and token-exchange standards (SPIFFE, OAuth token exchange) as the basis for per-task credentials.
- Any vendor claim about kill switch, spend cap or rollback behaviour in a specific agent platform.
- The exact pattern list in D2 and the exact utility numbers in D4 and D5.

## 3. Gaps (looked for, not found)

- No peer-reviewed measurement comparing container, gVisor and microVM isolation for LLM agents on escape rate or task success. The evidence is design guidance and generic overhead figures.
- No published measurement of staged agent rollout (shadow, then confirm, then bounded) with a stated promotion rule. B1 is descriptive; B2 is a position paper; B3 is for ordinary software.
- No numbers for kill-switch latency, budget caps or rate caps on agents.
- No independent adaptive-attack evaluation of structural defences (CaMeL, Progent, Fides) comparable to D3's attacks on prompt-level defences. Their numbers (D1, D4) come from the authors on AgentDojo and ASB.
- No public data on per-run cost accounting beyond C5's argument.
- Process-versus-outcome verification: C1 gives opinion backed by anecdotes; I found no controlled comparison.

## 4. Candidate projects

State assumed from the task statement and earlier rounds, not from code: policy service with Rule-of-Two flags, tiered approvals with action digests, audit chain, job records with leases, site grants with exact-origin normaliser, browser action contract with an injection corpus (no execution), eval lab with judge calibration, skill gate, change plans. No model calls or tool runs exist. Every first slice below needs no model.

### R6-1. Execution profile and egress policy file (deny by default), validated before any sandbox exists
**What.** A versioned, hash-pinned "execution profile" record per task class: filesystem scope (writable paths, read-only paths, forbidden credential-file patterns), network policy (default deny, allowed origins from site grants, blocked private, loopback and link-local ranges including metadata addresses, DNS resolver pin, redirect re-check per hop), resource limits (memory, CPU, pids, wall time), and the isolation tier required for the class (process sandbox, container, microVM). A pure validator rejects unsafe profiles and decides, for a list of requested URLs and paths, allow or deny with a reason.
**Builds on.** Site grants and the exact-origin normaliser (reuse for the allowlist), policy service (profile checked at job creation), approvals (profile hash goes in the approved action digest), audit chain.
**First slice.** A JSON schema, a validator, and a fixture suite of 60 or more URL and path cases: encoded private addresses (octal, hex, IPv4-mapped IPv6), redirects to internal hosts, credential-file paths (`.env`, cloud credential files, keys), path traversal, hostnames that differ from the granted origin by case or port. No network access, no sandbox.
**Thresholds.** (a) 100% of the fixtures denied that must be denied, and 100% of the explicitly granted origins allowed. (b) A profile with a permissive default, a wildcard origin, or a missing resource limit is refused in 100% of 15 fixtures. (c) The profile hash in the approval digest changes when any field changes, and a job whose profile differs from the approved one is refused. (d) The isolation tier is a required field, and a class marked "untrusted content" cannot select the weakest tier. **Size S.**
**Risks.** A file is a statement of intent, not enforcement; the allowlist is by hostname unless traffic is inspected (A2: domain fronting), and anything allowed can still receive exfiltrated data. The evidence is guidance (A2, A3, E1); no measured escape rates exist.
**Sources.** A1, A2, A3, E1.

### R6-2. Credential broker contract: per-task ephemeral credentials the agent never holds
**What.** A specification and fake implementation of a broker outside the agent boundary: a job lease requests a credential scoped to named operations and origins, with an audience, a short expiry tied to the lease, and revocation at job end or kill. The agent-side environment contains only a reference; the broker (or egress proxy) injects the secret on allowed calls and logs each use against the job id. Per-call checks include the operation, not only the origin (A1's git example: push only to the configured branch).
**Builds on.** Job leases (credential lifetime equals lease), approvals (scope listed in the approved digest), audit chain (every credential issue and use), site grants (audience), R6-1 profile.
**First slice.** A fake broker with an in-memory store, issuing opaque handles, plus a scanner that inspects a job's declared environment, mounts and tool arguments for anything that looks like a secret (patterns plus the broker's own known values). A test run issues credentials to simulated jobs and checks scope, audience and expiry.
**Thresholds.** (a) Zero seeded secrets visible to the simulated agent across 30 fixtures (environment, mounted files, tool outputs, error messages). (b) Use outside the granted operation, origin or expiry is refused in 100% of 25 fixtures, and each refusal is an audit row. (c) Lease expiry or kill revokes all of the job's credentials within a stated bound in simulation. (d) A token not issued for the broker's audience is refused (E1 token passthrough rule). **Size M.**
**Risks.** The sources are design recommendations; none measure leak rates. The scanner cannot prove absence. A broker is a new high-value target. Real secret storage choices are left to the owner.
**Sources.** A1, A2, A3, E1.

### R6-3. Recorded-trajectory schema, replay, and per-run cost record
**What.** One append-only record per run: ordered steps (model request hash, tool name, arguments, result hash, policy decision id, approval id, credential handle id, timestamps, tokens, tool cost), the final environment-state check, and totals. Replay mode feeds recorded tool results to the fake executor to reproduce the run's decisions. Cost is stored per step and per run, with a hash chain into the audit log. Include the failure vocabulary of MAST (C4) as optional labels.
**Builds on.** Audit chain (anchor the run hash), job records (run belongs to a lease), eval lab (replay as test input), R2-2 (cost roots), R2-8 (OTel mapping, export only), R2-7 (receipts).
**First slice.** The schema, a recorder driven by a scripted fake executor, a replay verifier, and a viewer that lists steps. Fixtures: 20 hand-written trajectories including a tampered one.
**Thresholds.** (a) Replay of 20 fixtures reproduces every recorded policy decision in 100%; an altered step is detected by chain verification in 100% of 10 tamper fixtures. (b) Per-run cost equals the sum of step costs in 100% of fixtures, and a run with no cost data is shown as "unknown", never zero. (c) A run with a final answer claiming success and no matching environment-state record is flagged "claimed, not verified" in 100% of 10 fixtures. (d) Secrets and flagged personal data do not appear in stored arguments (redaction fixtures; ties to R4-2). **Size M.**
**Risks.** Recording tool results stores untrusted content, which is a retention and injection-persistence risk. Replay shows decisions are deterministic, not that the model would act the same. Cost per run is only as good as what the executor reports.
**Sources.** C1, C3, C4, C5, A2 (log at the proxy).

### R6-4. Execution stage ledger and readiness gate (shadow, confirmed, bounded)
**What.** Per task class (and per skill), a recorded stage: 0 plan only, 1 shadow (agent proposes tool calls, nothing runs, a human or the fixture oracle compares), 2 confirmed execution (each consequential step approved), 3 bounded autonomy (auto for reversible, low-tier actions within budgets, approval above). A promotion is a proposal with evidence the system computes from recorded runs: number of runs, agreement with the human decision in shadow, rate of policy denials, rate of approver overrides, irreversible-action count, cost and time per run, pass^k on the class's eval set, and open incidents. A human approves each stage change; demotion is automatic proposal on a trigger. Extends R3-3 (earned-autonomy ladder per skill) with the execution stages and with a locked decision rule (R5-1).
**Builds on.** R3-3, R5-1 (locked plan), approvals (tiers), policy service, eval lab, incident records (R4-3).
**First slice.** The stage table, the evidence calculator, and a promotion-proposal generator over synthetic run tables. No runs exist, so the calculator returns "not enough evidence" until a floor of runs.
**Thresholds.** (a) On 30 synthetic class histories (good, noisy, one severe incident, high override rate, low volume) the proposal is correct in 100%: no promotion under the volume floor, none with an open severe incident, none with an override rate above the plan's limit. (b) Stage changes without an approval row are refused in 100% of fixtures. (c) The stage gate is checked by the executor at job start: a job requesting an action above its class's stage is refused. (d) Evidence shown with n and an interval, never a bare rate. **Size M.**
**Risks.** The evidence for the ladder itself is thin: B1 is observational (users raise auto-approval from about 20% to over 40% of sessions while interrupting more), B2 is conceptual, B3 is for software releases. Thresholds must come from the owner's risk view, not from these sources. Shadow agreement can be inflated if the human sees the agent's proposal first (anchoring); the shadow record must log whether the human saw it.
**Sources.** B1, B2, B3, C3, D6.

### R6-5. Kill switch, budget and rate caps as enforced job-lease properties
**What.** Run budgets recorded on the lease: tokens, money, steps, wall time, tool calls per minute, and distinct-origin count; a circuit breaker per task class and a global "halt" record that the executor must check before every step and that revokes credentials (R6-2). Caps are part of the approved digest. Breach produces a stop with a reason, not a retry.
**Builds on.** Job leases and expiry, policy service (caps checked in the decision), approvals, audit chain, R4-5 (change-freeze records).
**First slice.** Fake executor with scripted loops, runaway steps and spend growth; the lease checker; a halt record. Measure stop latency in steps, not seconds.
**Thresholds.** (a) In 25 runaway fixtures (infinite loop, repeated failing call, spend spike, new origin per step), every one is stopped at or before the cap plus one step. (b) After a halt record, zero further steps are accepted, in 100% of fixtures including concurrent ones. (c) A lease without caps is refused for stage 2 and 3 classes. (d) A cap change after approval needs a new approval. **Size S to M.**
**Risks.** No source measures kill-switch effectiveness; this is an engineering control with no evidence base beyond the general canary and SRE practice. Real cost depends on provider billing reports arriving late, so budget may be exceeded before it is seen; use pre-reserved budgets.
**Sources.** B3 (abort on regression), A2 (resource limits, proxy logging), C5 (cost as a first-class metric). Weakest-evidenced candidate.

### R6-6. Agent-version canary with concurrent control and abort rules
**What.** When a prompt, skill, model or tool change is proposed for a class that already executes, route a small fixed share of runs to the new version while the rest stay on the current one, compare per class on a handful of ranked metrics (final-state success, policy denials, override rate, cost per run, time per run), and abort on a pre-declared rule. Canary runs go through the same gates; stage never exceeds the class stage. Uses the change plan and its rollback.
**Builds on.** Change plans, skill gate (R5-5, offline), R5-1 and R5-4 (locked plan, peek-safe readout), approvals, R6-3 runs, R6-4 stage.
**First slice.** Assignment function (seeded, logged before the first run), a comparison readout over synthetic run tables, and abort rule evaluation. No runs.
**Thresholds.** (a) Assignment share within stated tolerance over 1,000 simulated runs and each run's arm recorded before it starts. (b) On simulated data with an injected regression of a stated size, the abort rule fires within the stated number of runs in at least 90% of 100 seeds; with no regression it aborts in at most the stated false-abort rate. (c) Fewer runs than the plan's minimum yields "not enough evidence", never "proceed". (d) A canary cannot run two changes in the same class at once (B3). **Size M.**
**Risks.** Agent task volume may be too low for a statistical canary in any realistic window (the R5-2 power warning applies); then the honest result is "use shadow replay instead". Shared dependencies (the same tools and sites) contaminate arms. B3 is not agent evidence.
**Sources.** B3, C1, C3.

### R6-7. Outcome-state graders with grader-validity and reward-hacking checks
**What.** For each task class that will execute, a deterministic grader that checks the end state (a record exists, a file hash, a database row, a page state fixture) rather than the agent's statement; each grader ships with a reference solution that must pass and a null solution that must fail; a validity report flags graders whose pass rate is 0% or 100% over many trials. Separate detectors for tampering: writes to grader files, the evaluator, the clock or test directories; reads of "answer" paths; outputs that match known stored answers; anomalously high scores queued for human review. pass^k reported next to pass@k.
**Builds on.** Eval lab (graders, judge calibration), R2-3 (dataset validity, success provenance), R2-4 (reliability profile), R6-3 trajectories, policy service (the tamper paths are denied by R6-1 anyway).
**First slice.** Grader interface, reference and null solutions for 10 toy tasks, and a tamper detector over recorded fixture trajectories containing seeded hacks (stub the evaluator, read the answer file, edit the timer, reuse a cached output).
**Thresholds.** (a) Every grader passes its reference and fails its null in 100% of 10 tasks. (b) The tamper detector flags at least 90% of 40 seeded hack trajectories with a false-flag rate at most 10% on 40 clean ones (report both with n). (c) A grader with a 0% pass rate over 10 trials of a passing reference is flagged as broken. (d) Trials are isolated: a seeded cross-trial leak (file left by a prior run) is caught in 100% of fixtures. **Size M.**
**Risks.** C2's rates (30.4% on RE-Bench, 0.7% on HCAST) came from research benchmarks with scoring code reachable by the model; AXION's tasks may differ, and a company's tasks are rarely cleanly gradable. Detectors have false positives in C2's own experience. Outcome-only grading can miss harmful side effects; keep step-level policy checks (R6-8) alongside. No controlled evidence that process checks beat outcome checks.
**Sources.** C1, C2, C3, C5, C4.

### R6-8. Plan conformance and data-flow labels on the browser action contract
**What.** Two structural controls in front of every executed action. (1) Plan-then-execute: the approved plan (ordered allowed tool calls, argument patterns, origins) is hashed at approval; at run time each call is checked against the plan and against a small privilege policy (Progent-style: tool, argument constraints, origin); a call outside the plan needs a new approval, and untrusted content cannot add calls to the plan. (2) Integrity and confidentiality labels on values (user, system, untrusted web, private data) carried through the recorded steps, with a rule that a state-changing or outbound call whose arguments derive from untrusted data, or that carry private data to a non-granted origin, is denied or sent to approval (CaMeL and Fides style, applied as checks, not as a new interpreter). Plus an adaptive-attack regression harness: the existing injection corpus extended with mutation search against the checker itself.
**Builds on.** Browser action contract and its injection corpus, policy service (Rule of Two flags are the coarse version of these labels), site grants, approvals and digests, R6-3 trajectories, R2-6.
**First slice.** A conformance checker and label propagator run over recorded and hand-written trajectories (the fake executor), with the corpus mutated by a seeded search loop (character, wording, indirection, multi-step). No model is called: the "agent" emits scripted calls that an attacker script has shaped.
**Thresholds.** (a) 100% of 50 fixture calls outside the plan are denied, and 100% of in-plan calls pass. (b) 100% of seeded exfiltration fixtures (private-labelled value to a non-granted origin; untrusted-derived argument to a state-changing call) are blocked. (c) After 1,000 mutated corpus variants, zero reach an allowed state-changing action that the policy forbids; any success is recorded as a bug in the checker. (d) Utility cost reported: the share of benign scripted workflows that need extra approval, with a bound the owner sets (D1 lost 7 points, 84% to 77%, on AgentDojo). **Size L.**
**Risks.** The adaptive-attack evidence says detector and prompt-level defences fail (D3), which argues for deterministic checks, but D1 and D4 report only the authors' own numbers on AgentDojo and ASB; D3 did not test them. A plan check does not stop an in-plan action with harmful arguments. Label propagation through a model's reasoning is only exact when the model is not the thing moving values; for a real model that is the hard part, and the first slice cannot test it. Benign tasks that need to mix untrusted input and an outbound action will trigger approvals; approval fatigue (R2-9) is the failure.
**Sources.** D1, D2, D3, D4, D5, D6, D9, D10; D7 and D8 as context for what vendors do on top.

## 5. A staged roadmap

Goal: the first real model call and first real tool run happen only behind every gate below, and each stage ends with an owner decision.

**Stage 0 (no execution, no model).** R6-1 profile and egress validator, R6-3 trajectory schema with a fake executor, R6-5 caps and halt on the fake executor. Exit check: all fixtures pass; owner reviews the profile file for the first task class. Owner approval point O1: approve the execution profile and egress allowlist for one task class (suggest a read-only browsing class using already-granted origins).

**Stage 1 (still no model).** R6-2 broker contract with fake broker, R6-7 graders with reference and null solutions, R6-8 conformance checker and label propagator, with the mutated corpus. Exit check: the thresholds of those candidates met and written into the change plan. Owner approval point O2: approve the plan-conformance policy and the number of extra approvals it causes on benign fixtures.

**Stage 2 (shadow).** R6-4 stage ledger goes live at stage 1 for one class: the first real model call, in an isolation tier from R6-1, no broker credentials, tools stubbed or read-only, results recorded (R6-3) and graded (R6-7); the agent proposes, nothing runs. Owner approval point O3: approve the first real model call, the provider, the budget on the lease, and the run floor for the readiness report.

**Stage 3 (confirmed execution).** After the readiness gate (R6-4) shows enough shadow runs, no severe incident and agreement above the owner's bound, promote the class to stage 2: tools run, each consequential step via an approval with an exact action digest, broker credentials scoped per task. Owner approval point O4: approve promotion of this class, per class, with the evidence page open.

**Stage 4 (bounded autonomy, canaried).** Only for reversible, low-tier actions with caps; R6-6 canary governs every agent-version change. Owner approval point O5: approve each bounded-autonomy class and each canary plan; any severe incident returns the class to confirmed execution automatically and needs owner approval to resume.

Rules throughout: Rule of Two stays on (no class combines untrusted input, private data and outbound action without approval); no stage skipping; demotion is automatic, promotion is human.

## 6. Ranking, with reasons

Weights: strength of evidence, how much risk it removes before a first model call, size, and fit with what AXION has.
1. **R6-1 execution profile and egress policy.** Strongest agreement across three independent guidance sources (A2, A3, E1), reuses site grants directly, small, and a prerequisite for everything else. Evidence is guidance, not measurement.
2. **R6-8 plan conformance and data-flow labels.** The only candidate with measured results against attacks (D1, D4), plus the clearest negative evidence that detector and prompt defences fail under adaptive attack (D3). Largest and the least tested by an independent party.
3. **R6-4 stage ledger and readiness gate.** Needed to satisfy the owner's "measurably" requirement and extends R3-3; but its evidence base is the thinnest conceptually (B1, B2), so thresholds are the owner's.
4. **R6-3 trajectory record and replay.** Enables everything measured later; evidence is practice-based (C1, C4, C5). Small cost.
5. **R6-7 outcome graders and reward-hack checks.** Good evidence that graders break and models hack (C1, C2) but small samples; needed before any autonomy claim.
6. **R6-2 credential broker.** Well supported as design (A1, A2, A3, E1), no measurements; M size; value rises when a real tool needs a secret.
7. **R6-5 kill switch and caps.** Cheap and obviously needed, but no evidence base; do it early anyway for safety, which is why it sits in stage 0 despite the rank.
8. **R6-6 version canary.** Sound principle (B3), but volume may be too low and no agent evidence; defer until stage 4.

If only three: R6-1, R6-8, R6-4 (R6-3 needed beside R6-4 for its evidence).

## 7. Notes for the verifier

- Numbers to re-check against the sources: A1 "84%"; A2 gVisor overhead table and "under 125 ms, under 5 MiB"; B1 20% to over 40% and 5% to 9%; C1 42% to 95% CORE-Bench; C2 39/128, 8/1,087 and the prompt experiment (80/70/70/95%); D1 77% vs 84%; D3 per-defence rates and the human competition counts (265, 178, 69, 123); D4 39.9% to 1.0% and 70.3% to 3.9%; D7 table (note Sonnet 4.5 was read as 13.8 / 10.8 / 1.9).
- D3 and D4 were read through the HTML pages and only the first 100,000 characters; the human-red-team counts and the full defence list are from that part. Check the D3 defence list against the paper to confirm that CaMeL, Progent and Fides are not in it, which my text states from the list as read.
- Abstract-only sources: B2, C3, C4, C5, D2, D5, D10. I did not read their bodies; D2's pattern names and D5's numbers are not claimed.
- D7 and D8 are vendor posts about their own model-level defences; I used them as context only, not as support for a structural-control claim.
- R6-5 and R6-6 rest on weak or transferred evidence; check my labelling of them as extrapolation.
- Threshold numbers (fixture counts, percentages) are my construction, as in earlier rounds, not from sources, except where a source figure is quoted.
- The 1.0% in D4 and 77% in D1 are on AgentDojo and ASB with the benchmark's attacks; do not read them as adaptive-attack figures.
- Nothing here depends on code or data inside AXION; all state assumptions come from the task statement and rounds 2 to 5.
