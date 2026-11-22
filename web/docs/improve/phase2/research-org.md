> **Status: written from memory. Sources NOT fetched; citations unverified until research-org-verified.md exists.** Saved 2026-11-22.

# AXION research: multi-agent org design and safe self-improvement (2024-2026)

Caveat: written from memory of the literature, with no live fetch this session. arXiv IDs and dates are what I recall and should be spot-checked before they are cited. Items marked (UNCERTAIN) are the ones I am least sure of. Ranked by value-for-effort, highest first.

## 1. Reliability metrics: pass^k and failure-taxonomy tags
(a) Report reliability as "succeeded on all k repeated trials" (pass^k), not just the average success rate. Tag every failed mission with a failure-mode label from a fixed taxonomy (spec/role violation, inter-agent misalignment, weak verification or early termination).
(b) tau-bench, arXiv 2406.12045 (Jun 2024), Sierra. MAST, "Why Do Multi-Agent LLM Systems Fail?", arXiv 2503.13657 (Mar 2025).
(c) Benchmark results and an annotated trace study (MAST). tau-bench showed pass^8 far below pass@1, and MAST's 14-mode taxonomy was built from annotated traces.
(d) Add a `failure_mode` enum and a `trial_group_id` to missions and reviews. Show "k of n trials passed" next to the existing sample sizes. Test: a fixture mission set with known outcomes must yield the exact pass^k values.
(e) Taxonomy labels are subjective. Keep them human-assigned, with a "needs review" state, until a judge is validated.

## 2. Orchestrator-worker as the default topology, with a delegation brief
(a) A lead agent decomposes work and gives each worker an explicit brief: objective, output format, tools, boundaries, effort budget. Workers return distilled results, not raw transcripts.
(b) Anthropic, "How we built our multi-agent research system" (Jun 2025), anthropic.com/engineering/multi-agent-research-system. Anthropic, "Building effective agents" (Dec 2024). Google/MIT "Towards a science of scaling agent systems" (late 2025, arXiv 2512.08296) (UNCERTAIN on ID and numbers) reports that centralized coordination limits error amplification versus independent agents.
(c) The Anthropic posts are blog claims with an internal eval: multi-agent beat single-agent by about 90% on a research eval, at roughly 15x the tokens. The scaling paper is a preprint.
(d) Make the delegation record a typed "brief" with fields objective, output_schema, allowed_tools, budget (tokens, steps, time) and stop_conditions. Reject a delegation with an empty brief. Test: schema validation, plus a check that a child's report references the brief's id.
(e) The 15x cost means orchestration only pays off on parallelizable, high-value work. Add a "single agent is enough" default and require a reason for fan-out.

## 3. Capability and scope contracts per role (least authority)
(a) Each role declares which tools it may call, which agents it may delegate to, and which data it may read. A delegation that exceeds the delegator's own authority is refused (no privilege escalation downward).
(b) MCP, Anthropic (Nov 2024), modelcontextprotocol.io. A2A, Google (Apr 2025; moved to Linux Foundation Jun 2025), a2a-protocol.org. "Intelligent AI Delegation", DeepMind, arXiv 2602.11865 (Feb 2026) (UNCERTAIN on ID), argues for explicit authority, accountability and verification in delegation chains.
(c) MCP and A2A are protocol specs, i.e. industry standards, not research. The delegation paper is a conceptual proposal without a large benchmark.
(d) Add `role.scopes[]` and a pure function `canDelegate(from, to, brief)`. Map the brief fields onto an A2A-style task object (id, state, artifacts) and an MCP-style tool manifest so a real transport can drop in later. Property test: a child's scopes are always a subset of its parent's.
(e) Over-restrictive scopes stall work. Log every refusal so the owner can see friction.

## 4. Independent verifier with a rubric, separate from the producer
(a) A verifier agent grades output against a pre-agreed rubric. It never sees the producer's chain of thought and must not share the producer's version or role.
(b) MAST (above) names weak verification as a leading failure cause. Anthropic research-system post (above) uses a separate citation-checking agent. "Self-Taught Evaluators", Meta, arXiv 2408.02666 (Aug 2024) (UNCERTAIN on ID).
(c) Mixed: empirical failure analysis plus blog claims. LLM judges are known to have position and self-preference bias.
(d) Add a `review` record (rubric_id, verdict, evidence, reviewer_agent_id) and forbid reviewer_id == producer_id. Evaluate the verifier itself on a small human-labelled gold set and publish its agreement rate with n.
(e) Judge bias and correlated errors between same-model agents. Show the verifier's measured agreement, not a bare "verified" badge.

## 5. Evolving playbook (delta updates) instead of rewriting prompts
(a) Keep each agent's strategies as a list of small, individually scored items (helpful/harmful counters) that are added or edited as deltas. This avoids the context collapse that comes from repeatedly rewriting a whole prompt.
(b) ACE, Agentic Context Engineering, arXiv 2510.04618 (Oct 2025). Reflexion, arXiv 2303.11366 (2023, NeurIPS). ExpeL, arXiv 2308.10144 (AAAI 2024).
(c) Peer-reviewed for Reflexion and ExpeL. ACE is a preprint (reported gains on AppWorld and finance tasks).
(d) A `playbook_item` table (agent_id, text, source_mission_ids, helpful, harmful, status). Items are proposed from mission reviews, and become active only after owner approval, like the existing version proposals. Test: applying a delta twice is idempotent, and every item links to evidence.
(e) Memory poisoning: one bad mission can write a bad lesson. Require at least 2 independent supporting missions and an owner approval before activation.

## 6. Skill library with verification before admission
(a) Successful procedures are stored as reusable, named skills, and a skill is added only after it passes a check. Retrieval uses the skill's description.
(b) Voyager, arXiv 2305.16291 (2023). Agent Workflow Memory, arXiv 2409.07429 (Sep 2024), which reports relative gains on web-navigation benchmarks. Anthropic "Agent Skills" (Oct 2025) (UNCERTAIN on date) is an industry version.
(c) Benchmark results in simulated or web environments. The transfer to a business setting is unproven.
(d) A `skill` entity (name, description, steps as data, preconditions, tests, version, status draft/approved/retired) with an owner-approval gate. Skills are inert data now, with no execution. Test: a skill is not "approved" without at least one recorded dry-run or review.
(e) Skill bloat and stale skills. Track last-used and success rate with sample size, and auto-propose retirement.

## 7. Agent-design search as offline evaluation, with human gate
(a) Treat an agent's configuration (prompt, tools, workflow graph) as a search space. A meta-agent proposes variants, which are scored on a fixed benchmark and kept in an archive.
(b) ADAS, arXiv 2408.08435 (Aug 2024, ICLR 2025). AFlow, arXiv 2410.10762 (Oct 2024, ICLR 2025). GPTSwarm, arXiv 2402.16823 (ICML 2024), optimizable agent graphs.
(c) Peer-reviewed, with benchmark gains over hand-designed baselines (math, QA, code). Gains on open-ended business work are not shown.
(d) Extend version proposals with `eval_suite_id`, `baseline_version`, `candidate_version` and a results table (n, score, confidence interval). Candidates are generated by hand or by a stub for now. The system only compares recorded scores and blocks promotion if n is below a threshold or the interval overlaps the baseline.
(e) Overfitting to the eval set and metric gaming. Keep a held-out set that the proposer never sees.

## 8. Safe self-modification: archive plus sandbox plus human approval
(a) Self-improvement keeps an archive of all prior versions (open-ended, with rollback) and evaluates each change empirically before adopting it.
(b) Darwin Godel Machine, arXiv 2505.22954 (May 2025), Sakana/UBC. Sakana "AI Scientist" blog (Aug 2024) reported a run that edited its own timeout, a concrete example of why oversight is needed.
(c) Benchmark result on SWE-bench and Polyglot, plus the authors' own safety notes. The timeout incident is a blog claim.
(d) Make agent versions immutable and linked in a parent-child lineage graph, with one-click rollback. Governance rule: no change to an agent's own evaluator, rubric or scopes may be approved in the same proposal as a change to its behaviour. Test: a proposal touching both is rejected.
(e) Reward hacking of the evaluator. The separation rule above and held-out evals are the mitigation.

## 9. Org restructuring as a scored, reversible experiment
(a) Evaluate org-structure changes (merge roles, add a layer, split a team) with cost and quality measured per structure, and compare against the previous structure. A dynamic-selection view: drop or add agents by measured contribution.
(b) DyLAN, arXiv 2310.02170 (COLM 2024), selects agents by importance scores. "Multi-Agent Collaboration via Evolving Orchestration" (puppeteer), arXiv 2505.19591 (May 2025) (UNCERTAIN on details), shows learned orchestration that produces more compact structures.
(c) Preprint and conference results on reasoning and coding benchmarks, not on org charts of the kind AXION has.
(d) Add per-revision stats to org revisions: missions handled, pass rate with n, mean cost, escalation rate, before versus after. The owner approves a revision, and the UI shows a "compare to previous revision" card. Do not auto-propose until at least a minimum n exists.
(e) Confounding (mission mix changes between periods). Match missions by type before comparing, and say "insufficient data" otherwise.

## 10. Mentoring as structured critique with a measurable learning goal
(a) A senior agent or the owner writes feedback against a rubric, which is converted into a playbook delta (idea 5) with a stated target metric. The mentee is re-evaluated on a similar task set afterwards.
(b) Reflexion (2023) and ExpeL (2024) for verbal feedback as learning. Constitutional-AI-style critique-and-revise, Anthropic (2022, older).
(c) Peer-reviewed for verbal reflection. The mentoring framing is my extension, not a published result.
(d) A mentoring plan gets `target_metric`, `eval_tasks[]` and a `result` (before, after, n). Plans close as "improved", "no evidence" or "worse". Test: closing a plan requires the after-measurement.
(e) Regression on other skills (the "catastrophic forgetting" analogue in prompts). Re-run a small general suite on every approved change.

## 11. Dynamic teams on top of a stable hierarchy
(a) Keep the org chart for accountability, but form ad hoc task teams per mission. A coordinator picks members by declared capabilities, and the team dissolves afterwards.
(b) DyLAN (above). Anthropic orchestrator-worker post (above). AutoGen/Microsoft (2023-2024) and the "Magentic-One" generalist team, arXiv 2411.04468 (Nov 2024), orchestrator with a task ledger and progress ledger.
(c) Benchmark results for Magentic-One (GAIA, AssistantBench). The hierarchy-versus-dynamic comparison is not settled in the literature.
(d) Model a `task_ledger` (facts, plan) and `progress_ledger` (step status) on each mission, written by the lead. Team membership is a mission-level join record, not an org change. Test: replaying the ledger reconstructs the mission state.
(e) Diffuse accountability. The mission always keeps a single named lead, and the lead's manager is the escalation path.

## 12. Escalation and uncertainty protocol
(a) Agents must emit a structured "blocked / needs decision / low confidence" signal, and the manager or owner sees these as an inbox. Stopping early and asking is rewarded, not penalised.
(b) MAST (premature termination and failing to ask for clarification are listed failure modes). Anthropic "Building effective agents" (human checkpoints). Calibration of verbalized confidence is mixed (UNCERTAIN: no single source).
(c) Blog guidance plus failure analysis. Verbalized confidence is known to be poorly calibrated, so treat it as a weak signal.
(d) Add an `escalation` record (mission, from, reason enum, resolution) and show an escalation rate per agent. Test: every mission that ends "blocked" has a matching escalation.
(e) Over-escalation floods the owner. Track the rate and let the owner tune thresholds.

## Suggested first sprint (best value-for-effort)
Ideas 1, 2 and 3 are schema and validation work with deterministic tests. Idea 4 (distinct reviewer) and idea 8's governance rule (evaluator changes separate from behaviour changes) are cheap rules that prevent the worst self-improvement failures. Ideas 5 to 7 need an eval scaffold first, so build the results table and the minimum-n gate (idea 7) before anything that can claim improvement.
