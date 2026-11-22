> **Status: written from memory. Sources NOT fetched; see research-eval-safety-verified.md for the checked citations.** Saved 2026-11-22.

# Agent eval and safety: 10 ideas for AXION (ranked by value per effort)

Method note: written from recalled knowledge, with no live web fetch this session. URLs and dates are from memory, so re-check them before citing. Items marked (UNCERTAIN) are the ones I am least sure of. arXiv IDs should resolve.

## 1. Policy decision point outside the model (deterministic, deny-by-default, deny-overrides)
(a) Every tool or browser action becomes a structured request (principal, action, resource, risk tier, context). A pure function returns allow, deny, or needs_approval. Any matching forbid beats any permit. The model never sees or edits the policy.
(b) Cedar (AWS): arXiv 2403.04651 (OOPSLA 2024), cedarpolicy.com. OPA/Rego is the alternative. Meta "Agents Rule of Two", 31 Oct 2025, ai.meta.com/blog/practical-ai-agent-security (UNCERTAIN on exact URL).
(c) Evidence: strong (production use; formal analysis for Cedar).
(d) Add `decide(policyVersion, request)` as a pure TS function. Map R0..R4 to allow / allow+log / approve / approve+second-person / forbid. Write table-driven tests (property: adding a forbid never turns a deny into an allow). Store the policy in the existing versioned registry. Log the decision with the policy hash in the audit log.
(e) Risk: low. The danger is policy sprawl and mis-classified risk tiers, so classify the tier from the action type, not from model text.

## 2. Rule of Two plus lethal trifecta as a static check
(a) An agent run may hold at most two of: (A) untrusted input, (B) sensitive data or private systems, (C) the ability to change state or communicate externally. If it needs all three, approval is forced.
(b) Simon Willison, "The lethal trifecta", 16 Jun 2025, simonwillison.net/2025/Jun/16/the-lethal-trifecta/. Meta Rule of Two, Oct 2025.
(c) Evidence: practitioner consensus and sound reasoning, with no formal proof. It is a heuristic.
(d) Tag each agent role/tool manifest with A/B/C flags. Add a lint test that fails if a role is configured with all three without an approval rule. It is a pure function over config, so no execution is needed.
(e) Risk: low. It is coarse and can over-block, so allow explicit documented waivers.

## 3. Eval dataset and trace schema (replayable, hashable), built on OpenTelemetry GenAI conventions
(a) Define one JSONL case format (id, input, fixture/env snapshot, expected checks, tags, dataset hash) and one trace format (spans for model call, tool call, policy decision, with tokens, cost, latency, outcome). Grade the end state and the policy decisions, not just the final text.
(b) OpenTelemetry GenAI semantic conventions, opentelemetry.io/docs/specs/semconv/gen-ai/ (2024-2025, still experimental). UK AISI Inspect, inspect.aisi.org.uk (2024-25): its log schema, scorers and sandbox abstraction are a good template. tau-bench, arXiv 2406.12045 (Jun 2024): grade by final database state.
(c) Evidence: strong for state-based grading (tau-bench), good for OTel (de facto standard, but it is changing).
(d) Write the JSON Schemas plus a validator and 10 hand-made fixture cases with recorded (mock) traces. Extend the dataset hash so it covers case content. Unit-test that the verdict function can consume the trace's cost and latency fields.
(e) Risk: low. Schema churn, so version the schema.

## 4. Statistical rigour on the verdict: paired tests, intervals, pass^k
(a) Report a paired-difference confidence interval (paired bootstrap, or an exact sign/McNemar test for binary outcomes) rather than only margin and wins/losses. Use clustered standard errors when cases share a source. For flaky agents, report pass^k (all k trials succeed) alongside pass@k, because pass@k hides unreliability.
(b) Miller, "Adding Error Bars to Evals", arXiv 2411.00640 (Nov 2024). tau-bench pass^k, arXiv 2406.12045.
(c) Evidence: strong (standard statistics; tau-bench shows large pass^k drops).
(d) Add to the deterministic verdict function: `ci_low > margin_floor`, an exact sign test p-value, and optional k repeats with pass^k. Test with synthetic score arrays (known power; verdict stable under permutation of cases). Bump the policy registry version when the rule changes.
(e) Risk: low-medium. With few cases (e.g. under 20) intervals are wide and the verdict becomes "inconclusive". That is correct, but add that as an explicit third verdict.

## 5. Cost-controlled comparison (Pareto, not accuracy alone)
(a) Compare versions on a cost/latency/accuracy frontier. A "winner" that costs 5x more or has worse tail latency is not promoted without a stated budget. Include retries and judge cost.
(b) Kapoor et al., "AI Agents That Matter", arXiv 2407.01502 (Jul 2024).
(c) Evidence: good (a well-cited critique with empirical examples).
(d) Add `costBudgetRatio` and `p95LatencyRatio` guards to the policy registry and the verdict, using token/cost fields from the trace schema. Test with fixtures.
(e) Risk: low. Prices and latency are noisy, so use ratios and compare only on the same hardware or mock.

## 6. LLM-as-judge hygiene (evaluator not author is necessary but not sufficient)
(a) Known biases: position, verbosity, self-preference (a judge prefers its own family's output), and weak performance on hard items. Mitigations: swap order and require agreement, use programmatic checks wherever possible, keep a human-labelled calibration set, and report judge-human agreement (Cohen's kappa) with an interval. Reject a judge below a kappa threshold.
(b) Zheng et al., MT-Bench, arXiv 2306.05685 (2023). Ye et al., "Justice or Prejudice" (CALM), arXiv 2410.02736 (Oct 2024). Tan et al., JudgeBench, arXiv 2410.12784 (ICLR 2025). Self-preference: Panickssery et al., arXiv 2404.13076 (2024).
(c) Evidence: strong on the biases, moderate on the fixes.
(d) Add a judge-registry entry type (model family, prompt hash, calibration set hash, kappa). Extend "evaluator != author" to "evaluator family != author family". Build a 30-item human-labelled calibration JSONL with a deterministic stub judge in tests. The verdict refuses a judge whose calibration record is missing or stale.
(e) Risk: low. A calibration set is labour to build. Start with programmatic graders.

## 7. Prompt-injection test corpus plus an attack-success-rate gate (AgentDojo style)
(a) Keep a versioned corpus of injection payloads embedded in realistic web, email and document fixtures. Each is paired with a benign utility task. Measure utility and attack success rate together, since a defence that blocks everything is useless. Treat a defence as passing only against adaptive attacks, not only static strings.
(b) AgentDojo, arXiv 2406.13352 (NeurIPS 2024). WASP (web agents), arXiv 2504.18575 (2025). Nasr et al., "The Attacker Moves Second", arXiv 2510.09023 (Oct 2025): adaptive attacks bypassed most published detection and prompting defences.
(c) Evidence: strong for the benchmarks. The "adaptive attacks break filters" finding is recent, so treat it as moderately strong.
(d) Create `corpus/injection/*.json` (fixture page text, hidden-text and Unicode variants, tool-output injections, expected: policy must deny or require approval for the induced action). Test the policy service (idea 1) and sanitiser, not a model: given an action request tagged "derived from untrusted content", decide() must not allow R2+ actions. No execution is needed.
(e) Risk: low. Over-trusting string filters. Treat the corpus as a regression suite, not proof of safety.

## 8. Provenance/taint tracking: structural defences over "detect the injection"
(a) Label every value with its origin (trusted user, tool output, web). Policy blocks sensitive tool calls whose arguments derive from untrusted data, or routes them through a quarantined model that can only output typed data. CaMeL does this with a capability-aware interpreter and solved 67% of AgentDojo tasks with provable security (their figure).
(b) Debenedetti et al., CaMeL, arXiv 2503.18813 (Mar 2025). Beurer-Kellner et al., "Design Patterns for Securing LLM Agents against Prompt Injections", arXiv 2506.08837 (Jun 2025). Willison's Dual LLM pattern (2023). Spotlighting, arXiv 2403.14720 (Mar 2024), is the weaker, probabilistic cousin.
(c) Evidence: good for design patterns, moderate in practice (utility cost, early research).
(d) Add `provenance: 'user'|'agent'|'untrusted'` to the action-request schema and to the trace schema. Policy rule: untrusted provenance plus R2+ gives needs_approval, and untrusted provenance plus external-send gives deny. Test with the corpus from idea 7.
(e) Risk: medium. Tracking is hard once text passes through a model. Treat all model-generated text after any untrusted read as untrusted (conservative taint).

## 9. Capability tokens (attenuable, short-lived, per-task) instead of ambient credentials
(a) Issue each run a signed token scoped to specific origins, actions, a spend cap and an expiry. A sub-agent can only narrow it (attenuation), never widen. The executor checks the token, not the model.
(b) Macaroons (Birgisson et al., NDSS 2014); Biscuit, biscuitsec.org (Datalog-based, offline attenuation). Applied to agents in recent vendor writing (UNCERTAIN on a single canonical source).
(c) Evidence: strong for the primitive, low for agent-specific field data.
(d) Implement a minimal HMAC-signed JSON token (run id, allowed actions, origins, max risk tier, exp, caveats list) with `attenuate()` and `verify()`. Tests: expiry, tamper, widening rejected, replay across run id rejected. Use the existing audit log to record token issue and use.
(e) Risk: medium. Hand-rolled crypto. Use node:crypto HMAC-SHA256 and constant-time compare, or adopt Biscuit rather than inventing a format.

## 10. Irreversible-action guardrails: plan/commit split, step-up approval, and approval-UX that resists fatigue
(a) Split every state change into propose (dry-run diff or described effect) and commit (executed only with a bound approval hash of the exact action). Irreversible or R3+ actions need re-approval after any change, a cooling window, and a second approver. Show diffs and consequences rather than prompts for everything, because users rubber-stamp frequent prompts.
(b) Anthropic Claude Code sandboxing post, Oct 2025, anthropic.com/engineering/claude-code-sandboxing (permission prompts reduced by OS-level sandbox boundaries; I recall a figure of about 84% fewer prompts, UNCERTAIN). Approval-fatigue evidence: Anthropic's later "auto mode" write-up (UNCERTAIN on date and URL). NIST AI RMF human-oversight guidance is general only.
(c) Evidence: moderate (vendor-reported, no independent study I can cite).
(d) Add an `approvalBinding = sha256(canonical(action) + policyVersion + runId)` to the approval record. Test: approval for action X cannot authorise X' (changed argument), expired approval is rejected, R4 needs two distinct approvers, and approver != requester. Tier thresholds go through the version-proposal flow (promotion and rollback) like other policy.
(e) Risk: low. Friction. Measure approval rate and time-to-approve as a trace metric so you can see rubber-stamping.

## 11. Sandboxing without containers: OS-level least privilege plus a browser-context allowlist
(a) Run the browser worker as an unprivileged process with kernel isolation (Landlock/seccomp/bubblewrap on Linux), a per-run throwaway browser context (fresh profile, no persisted cookies), a deny-by-default network egress allowlist, and no host filesystem except a scratch dir. Playwright's context isolation, permission denial and route interception can enforce origin allowlists in-process.
(b) Anthropic Claude Code sandboxing (Oct 2025, above), which uses bubblewrap and Seatbelt. Playwright docs (playwright.dev/docs/browser-contexts, /network). WebAssembly/WASI is an alternative for tool code.
(c) Evidence: moderate (sound security engineering, little published measurement). A kernel boundary does not stop in-browser exfiltration to an allowed origin.
(d) Now, with no execution: write the sandbox profile as data (allowed origins, paths, env) plus a validator test that rejects broad wildcards, `file://`, localhost and metadata-IP targets (SSRF list), and a URL normaliser test (userinfo tricks, punycode, redirects). Wire it into the policy service only.
(e) Risk: medium. Misconfiguration. Egress allowlists also break legitimate redirects and CDNs.

## 12. Regression suites from production traces plus failure-driven cases
(a) Every incident, rejected approval, or policy denial becomes a case in a frozen regression set with its trace, replayable against a mock executor. Freeze and hash the set. Never tune on the promotion set (hold-out split) to limit overfitting and benchmark contamination.
(b) Inspect AI log-driven workflow (UK AISI, 2024-25). Contamination and benchmark-reliability critiques of SWE-bench-style sets: arXiv 2410.06992 (SWE-Bench+, 2024), WebArena-Verified (2025, UNCERTAIN on ID). Anthropic's evals guidance (late 2025/early 2026, UNCERTAIN).
(c) Evidence: moderate-strong (widely repeated practice, fewer controlled studies).
(d) Add a `regression` tag and `split: dev|holdout` field to the case format. The verdict function requires: no regression-tagged case may flip from pass to fail, and promotion is judged on holdout only. Test with fixtures.
(e) Risk: low. Set drift and size; keep dev and holdout stratified.

## Suggested build order (the first three would be a week or less)
1. Policy decision function with R0..R4 and deny-overrides (idea 1), plus the Rule of Two lint (idea 2).
2. Case and trace schemas with cost/latency fields (3), and the injection corpus run against the policy function (7).
3. Verdict upgrades: interval, sign test, inconclusive state, pass^k, cost guards, holdout and regression gate (4, 5, 12).
4. Approval binding (10), then provenance tags (8), then capability tokens (9), then the sandbox profile validator (11), then judge calibration (6).

## Caveats
- No defence in this list is proven against adaptive prompt injection. Structural controls (1, 2, 8, 9, 10) hold up better than classifiers or "ignore instructions" prompting (2025 adaptive-attack results).
- Several sources are vendor blog posts, so their figures are self-reported.
