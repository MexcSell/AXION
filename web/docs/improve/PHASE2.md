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

## Wave 5 (Phase 2 proper; started 2026-11-22T17:45Z)

Waves 1–4 (ungated) are merged and live (ed3ed73). Wave 5 has two tracks that run in parallel:

**Track A, hardening what we built** (the merge and review follow-ups, five lanes, disjoint files):

| Cycle | Lane | Project | Backlog |
|---|---|---|---|
| c53 | w52 | Eval-run integrity: no re-run shopping across proposals, resumable runs, judge labels, exact number rendering, reuse false positives (validation only, no run-write route) | E1c |
| c54 | w53 | Clock bounds from SQL everywhere, plus six dimensions sourced from stored runs, c51 freshness, and a PageFrame tab instead of DL-98 | H11, M1b, M1c |
| c55 | w54 | Thread follow-ups: measured-anchor restore, `ChatView.hold` forced layout, a relative latency bar, production-build number | P2b |
| c56 | w55 | Pinned Public Suffix List snapshot with hash; refuse grants on any public suffix | P4b |
| c57 | w56 | Test hygiene: a11y live-region race, exercise `GET /operations/anchors` hermetically | H12, H13 |

**Track B, learning new things** (the owner's "innovative and new"): research round 2 (`phase2/research-r2.md`), done by
a researcher and checked by a separate verifier (`phase2/research-r2-verified.md`). It looks at what is new since round 1
and fits AXION's records-only boundary. Its verified ideas become Wave 6.

**Wave 6** is chosen from round 2's verified ideas. The gated Wave 4 items (R1, A1, M2, G1) still run last as a droppable
batch.

**Cut-off:** no new lane starts after 2026-11-23T13:45Z. The gated batch runs only if it clears before then. The final
live update and report land before 21:45Z.

### Standing rules for every Wave 5+ brief
- Branch from the commit named in the brief. LANES.md applies in full (heavy.sh, ports, PID-owned kills, never stash).
- c50 contract coverage is in base. A new route or response field needs its registry, DTO and validator entries in the
  same lane. **No new allowlist lines.**
- Any reassign carries a brief (c51). Every advisory lock goes through `server/src/locks.ts`. Every time comparison
  **and bound** uses DB `now()` in SQL (never `new Date()` from a DB clock, and never the app clock as a SQL bound).
- Append-only tables need all four guards plus the `axion.purge_demo` exception.
- Name every failing test, with its first error line, in the report. Print the load average next to every timing.
- Show RED before GREEN for each item, and mark each threshold item PASS, FAIL or NOT MET honestly.

## Wave 6: verified ideas from research round 2 (planned 2026-11-22 ~18:40Z)

Inputs:
- `phase2/research-r2.md` (researcher): 26 sources, 10 candidates.
- `phase2/research-r2-verified.md` (independent verifier): 22 sources CONFIRMED, 4 CORRECTED, none wrong.

Verdicts: R2-4 is DROPPED (it duplicates pass^k and the six-dimension reliability cell). The rest are KEEP or KEEP WITH CHANGES, and every brief includes the verifier's changes.

| Cycle | Lane | Project | Start |
|---|---|---|---|
| c58 | w57 | R2-6 Rule-of-Two configuration profile (flags derived server-side, never self-declared), plus R2-9 approval-quality records and display (admins only, advisory, never changes a decision). One approvals UI change. | now |
| c59 | w58 | R2-5 origin-bound memory and skill records, on c41's `trust` and `sources`: origin class can't rise, contribution log, active cap, retirement proposals (fixture-only). | now |
| c60 | w59 | R2-10 failure attribution fields (agent, step, "full trace available", disagreement count), plus R2-8 OTel GenAI mapping table and local OTLP-JSON export of stored records, against a pinned spec version and hash. | now |
| c61 | — | R2-2 eval instrument audit record, R2-3 dataset validity attestation, R2-1 judge calibration scaffold. | after c53 merges |
| c62 | — | R2-7 signed decision receipts plus an offline verifier, test key only. | last; owner question Q12 first |

**The one safe lesson from R2-10's sources:** the literature disagrees on whether hierarchy helps (results depend on the task and on capability). So AXION records evidence and holds no "hierarchy is better" belief.

**Q12 (new owner question):** R2-7 would sign policy-decision receipts with a key held outside the database. Who holds that key, where does it live, and how is it rotated? This is the same custody question as the c49 anchor key, which today lives only in the live `server/.env`. Until the owner answers, any signing uses test keys only.

## Wave 7 (planned 2026-11-22 ~19:20Z)

**Track B, research round 3**: back to the owner's three themes (company structure, company performance, agent performance), plus operator UX for supervising many agents. A researcher writes `phase2/research-r3.md`, then a separate verifier checks it. Its verified ideas become Wave 7 lanes, branched from the tree after batches 14–16 merge.

**Track A, follow-ups that wait for merges**:
- H11b, the remaining app-clock bounds (after c54 merges);
- E1d, holdout shopping beyond the same config (after c61);
- P4c, PSL snapshot age (after c56);
- H15, OTel follow-ups (after c60);
- P3c, approval evidence in the digest (after c58);
- H14, the jobs test's connection footprint;
- P2c, the reader not pinned after fast bursts, if the c55 review confirms it predates c55.

The cut-off stands: no new lane after 2026-11-23T13:45Z.

### Wave 7 from research round 3 (verified 2026-11-22 ~20:20Z)
The verifier found 27 sources CONFIRMED and 2 CORRECTED (B5 "matched at 11x lower cost" is really about 5% lower; C4 has an empirical claim). A8 is low trust because of its date. R3-1 is folded into R3-7, and R3-2 is not scheduled.

Build order:
1. **c63** R3-8, failure learning. Lane w61, from c60's tip. Running.
2. **c64** R3-6, restructure guardrails. Lane w62, from improve-30h. Running.
3. R3-10, queue and latency metrics, after c58 merges.
4. R3-4, metric-gaming guard, after c54 merges.
5. R3-9, the operator attention queue, after c58 and c63.
6. R3-5, operational metrics, after R3-4.
7. R3-7 with R3-1, difficulty-adjusted ratings: fixture-only, no ranked list, late.
8. R3-3, the earned-autonomy ladder: display-only, last, and only after Q13.

**New owner questions:**
- **Q13:** may an agent's autonomy level (R3-3) ever be an input to the policy service, or is it display-only?
- **Q14:** should AXION define a "read private company data" capability? Without one, the Rule of Two's flag (b) covers only live systems and credentials (c58), so an agent reading untrusted pages, reading company records and sending messages doesn't trigger it.
- **Q15:** c64's restructure guardrails ship switched off (`ORG_COOLDOWN_HOURS`, `ORG_CHURN_BUDGET`, `ORG_CHURN_WINDOW_HOURS`, `ORG_MAX_ESCALATION_LEVELS`; 0 or unset means not enforced). What values should the live company use? A suggested start: a 24 h cooldown, a budget of 6 reporting-line changes per 7 days, and at most 6 escalation levels.
