# Phase 2: evolve for 28 hours (roadmap)

**Owner instruction (2026-11-22 ~00:50Z):** "After all current missions are completed: from now on, evolve by learning more
innovative and new things for 28 hours. Plan and execute all projects step by step. The important thing is to develop
further and always improve."

**Clock:** Phase 2 starts when the current integration queue and lanes finish. That moment and its end time (+28 h) are
written into STATE.md.

**Process:** unchanged (PROCESS.md, LANES.md, QUEUE.md). Every project goes through these steps:
1. A brief with a hypothesis and a fixed threshold.
2. A lane, built test-first.
3. An independent review, plus a fix round.
4. Integration by the integrator.
5. A live update, after a backup.

**Safety boundary:** unchanged. No real browser automation (Stage 7), no model or provider calls, no experiment
execution, deploys or restarts of release gates without the owner's explicit approval. Phase 2 builds the **structural**
foundations those later stages need, and research says that matters most. "The Attacker Moves Second" (2510.09023)
bypassed 12 recent prompt-injection defences with adaptive attacks, mostly at over 90% success, so filters alone are not
enough. Policy outside the model, capabilities and exact approval binding (CaMeL 2503.18813, design patterns 2506.08837)
are the durable controls.

## What we learned (inputs)

- `phase2/gap-analysis.md`: what the master spec still lacks.
- `phase2/research-org.md` with `phase2/research-org-verified.md`: 17 sources checked. Organisation design and
  self-improvement: Magentic-One ledgers, MAST failure taxonomy, τ-bench pass^k, Reflexion, ExpeL, ACE playbooks,
  Voyager, Agent Workflow Memory skill libraries, ADAS, AFlow, GPTSwarm design search, Darwin Gödel Machine lineage,
  and the scaling result that architecture–task fit decides gains or losses.
- `phase2/research-eval-safety.md` with `phase2/research-eval-safety-verified.md`: 14 sources checked. Judge biases
  (models favour their own output, JudgeBench near random on hard pairs), error bars for evals, cost-plus-accuracy
  evaluation, benchmark leakage (SWE-Bench+), prompt injection (AgentDojo, WASP, Spotlighting, CaMeL, adaptive attacks),
  and Cedar-style analysable policy.

## Projects, in waves

Each wave's projects are chosen to touch different files, so they can run in parallel lanes.

### Wave 1: safety and evaluation foundations

| # | Project | Why (source) | Threshold sketch |
|---|---|---|---|
| P1 | **Deterministic policy service**: a pure `evaluate(action, grants, policy)` → allow / needs-approval(tier R0–R4) / deny with reason codes, deny-overrides, "owner may only tighten", policy in code | spec §10.1, §13.2, inv. 10; Cedar; CaMeL | ≥40 unit tests covering every tier and prohibited R4; no caller-supplied tier anywhere (approvals derive the tier from the policy) |
| P5 | **Tamper-evident audit**: per-tenant hash chain, a verify route, append-only triggers on audit and decision tables | spec §11 chain_ref, §13 | tampering with any row is detected by verify; UPDATE/DELETE refused |
| E1 | **Evaluation data model**: datasets (content hash, frozen), cases, traces (schema), evaluation_results; `verdict()` upgrades: paired sign test / confidence interval, an explicit **inconclusive** state, **pass^k** reliability, cost alongside accuracy, holdout split | τ-bench, error bars, AI Agents That Matter, SWE-Bench+ | the verdict refuses to call a win without significance; pass^k computed; dataset hash mismatch rejected |

### Wave 2: Stage 7 readiness (records and validation only, no execution)

| # | Project | Why | Threshold sketch |
|---|---|---|---|
| P2 | **Browser action contract**: strict schemas, bounds, canonical digest, action → tier via P1, plus an **injection test corpus** of untrusted page text that must never change a tier or a grant | spec §10.7; AgentDojo, WASP, Spotlighting | 100% of the corpus is classified safely; unknown keys and raw JS/CDP rejected |
| P3 | **Approval binding v2**: the digest covers the full action plus origin, task, tier and requester; recomputed on the server; **single-use consume**; decider ≠ requester at R2+ (the mission-creator / second-approver rule needs an owner role: backlog P3b) | inv. 7; CaMeL | a replayed or altered action can't reuse an approval (tests) |
| P4 | **Site grants**: exact-origin normaliser (rejects wildcards, userinfo, confusables, private/loopback/metadata addresses), expiry, revoke, admin UI | spec §11, §10.7 | a hostile origin corpus is 100% rejected; an expired grant denies |
| E3 | **Failure-mode tagging** (MAST taxonomy) on tasks and messages, recorded by people now and by agents later, feeding the scorecard | MAST 2503.13657 | every failed or retried task can carry a tag; counts appear with n |

### Wave 3: learning organisation

| # | Project | Why | Threshold sketch |
|---|---|---|---|
| O1 | **Mission ledgers** (task ledger plus progress ledger, as in Magentic-One): structured plan, facts and guesses, and a progress record per mission, shown in Mission Overview | Magentic-One | ledgers are versioned and append-only; DEMO missions show labelled samples |
| O2 | **Typed delegation brief and scope contract** for every delegation (goal, inputs, acceptance, allowed capabilities), checked by P1 | MCP/A2A ideas, Intelligent AI Delegation (conceptual) | a delegation without a valid brief is refused; scope is a subset of the delegator's |
| O3 | **Producer ≠ verifier rule**: a task can't be marked verified by its producer, and a version can't be judged by its own model family (self-preference bias) | 2404.13076, Zheng et al. | enforced on the server with tests |
| E4 | **Experience → playbook with review** (candidate lessons, curated by a person, versioned playbook per role; ACE / ExpeL) and a **skill library record** (Voyager / AWM) | ACE, ExpeL, Voyager, AWM | candidates never become active without review; playbooks are versioned and can be rolled back |
| M1 | **Six-dimension scorecard** (company and department) with n, window, evidence and **trend**; no composite number (brief c46, lane after batch 9) | spec §16.1 | every cell shows a value with n, or "not enough evidence" |

### Wave 4: if time remains

Ungated, running now:
- J1 job lease state machine (c45; records only, Stage 5 scope, no worker runs).
- A page-level performance pass on the cost cycle 26 left (c44).

**Gated by stage (controller ruling, 2026-11-22):** the spec puts the release model and artifacts in Stage 8, and the model
registry and usage/cost ledger in Stage 9. Each stage ends "STOP. Ask Owner approval", and the Wave 2 "records only" ruling
was the controller's, not the owner's. So these four run **last**, records only with fake adapters, with no wiring of the
Results or Models tabs, in their own final batch the owner can drop whole (owner question Q11):
- R1 release and last-good records, with the guardrail-path denial (Stage 8).
- A1 artifact metadata and hashes (Stage 8).
- M2 usage ledger and budget caps, fake meter in tests only (Stage 9).
- G1 model registry and routing policy, fake adapter (Stage 9).

## Rules for this phase

- **No invented results.** Every threshold is measured. NOT MET is reported as NOT MET.
- **Citations:** only the ones verified in `phase2/*-verified.md`. A new source is verified before it is cited.
- **Logging:** each wave ends with a LOG entry, a LESSONS entry, and a SCORECARD update.
- **Queued owner questions** are listed at the end of the phase: Q1–Q11 so far, plus any new ones. Q11: may Stage 8/9 records-only foundations (R1, A1, M2, G1) be built ahead of those stages' approval, or should they wait?
