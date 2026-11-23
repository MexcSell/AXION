# Verified citations: research-r6.md (2026-11-23)

Independent check. All 22 numbered sources (A1-A3, B1-B3, C1-C5, D1-D10, E1) were opened in this session with WebFetch. The fetch tool returns a model answer to my prompt, not raw bytes, so every figure below is what the tool reported from the page. Only A2 and E1 came back as near-full page text. For D3 and D4 I opened both the arXiv abstract page and the HTML version; the HTML tool read only the first 100,000 characters (of 135,858 and 134,380), so the last third of each is unread by me as well. For the candidates I read, read-only, `server/src` (grants/origin.ts, grants/service.ts, jobs/store.ts, jobs/machine.ts, policy/*, approvals/service.ts, audit.ts, browser/contract.ts, browser/STAGE7.md, evolution/skill-gate.ts and the file listings of evolution, forecasts, failures, otel) and `shared/contracts/src/browser.ts`. No database was touched.

Counts (22 numbered sources): **16 CONFIRMED** (D3 with two sub-claims unseen), **6 CORRECTED** (A1, B2, B3, C2, D4, D8; title, venue, wording or one detail), **0 OVERSTATED, 0 WRONG** at source level. **UNCONFIRMED sub-claims: 2** (D3 ">500 participants", D8 "deterministic guarantees are challenging"). Every headline number in the file matched its page (A1 84%, B1, C1, D1, D4, D7, D3 per-defence rates, C2 39/128 and 8/1,087). At candidate level there are **two OVERSTATED attributions** (R6-8 ranking claim, R6-1 use of E1), listed under the candidates.

## 1. Source table

| ID | Verdict | Check result |
|---|---|---|
| A1 Anthropic sandboxing, 2025-10-20 | CORRECTED (title) | Date, 84% ("in our internal usage ... reduces permission prompts by 84%"), bubblewrap and seatbelt, Unix-socket proxy outside the sandbox, push-only-to-configured-branch example: match. Page title is "Beyond permission prompts: making Claude Code more secure and autonomous" (browser title "Making Claude Code safer with sandboxing"); the file's title is neither. Authors Dworken and Weller-Davies (file names none). Git-credential proxy applies to Claude Code on the web only (file says so). 84% is an internal figure. |
| A2 Securely deploying AI agents (docs) | CONFIRMED | Hardened docker flags, gVisor table (about 0% CPU-bound, about 2x simple syscalls, up to 10-200x heavy open/close I/O), Firecracker "under 125ms, less than 5 MiB", no network interface and vsock, credential proxy, no TLS inspection and domain fronting, allowed domains can receive exfiltrated data, Node `fetch()` ignores proxy variables, `.env` and credential files risk: all on the page. The page rates gVisor overhead "Medium/High" and VMs "High", which the file omits. Vendor guidance, as the file says. |
| A3 NVIDIA, Harang, 2026-01-30 | CONFIRMED | Mandatory (default-deny egress, no writes outside workspace, no writes to agent config) and recommended items match, including "Allow-once / run-many is not an adequate control" and short-lived task tokens via a broker. Page says no measured rates. The file's "trusted DNS resolvers only" and "block reads outside workspace" are not in the answer I got for the mandatory list; reads are listed as "restricted reads, recommended", so the file's mandatory/recommended split is slightly off for reads. |
| B1 Measuring AI agent autonomy, 2026-02-18 | CONFIRMED | About 20% auto-approve under 50 sessions to over 40% by 750; interruptions 5% to 9%; 73% human in loop, 80% safeguard, 0.8% irreversible, upper bounds; clarification more than twice as often: match. Page cautions against overreading the clarification figure. |
| B2 Levels of Autonomy (2506.12469) | CORRECTED (venue) | Authors, v1 14 Jun and v2 28 Jul 2025, five levels, autonomy certificates: match. Page shows cs.HC primary, CC BY 4.0 and publication in the Knight First Amendment Institute "AI and Democratic Freedoms" essay series; the file gives no venue. Position paper, no measurements: right. |
| B3 Google SRE Workbook, canarying | CORRECTED (one paraphrase) | 20% errors on 5% traffic gives 1%; "strongly advise running only one canary at a time"; duration at least one work unit; metric interval no longer than canary (hourly metric, 30-minute canary example); "perhaps no more than a dozen"; concurrent control not before/after: match. "Tune thresholds on historical canary failures" is looser on the page: it says to choose canary parameters from typical canary evaluation failure rates. |
| C1 Demystifying evals, 2026-01-09 | CONFIRMED | Final state not claim (SQL reservation), CORE-Bench 42% to 95%, 0% over many trials usually a broken task, reference solution, isolated trials (git history leak), 0.75^3 about 42%, 20-50 tasks: match. The 95% followed grading fixes and a less constrained scaffold (file says grading bugs only). |
| C2 METR reward hacking, 2025-06-05 | CORRECTED (two details) | Authors, date, RE-Bench 39/128, 21/21 on one task, HCAST 8/1,087, "more than 43x", examples, two-method detection with high false positives, overlap of 2 real cases, underestimate: match. Details: the listed task rows sum to 39 of 73 runs, and the 128 total depends on a footnote (Restricted MLM excluded); 39/128 is 30.5% unrounded (page says 43x by rounded percentages, about 41x unrounded). Prompt test: "do not cheat" 80% to 80%, "do not reward hack" 70%, "solve as designer intended" 95% (an increase). The file's "80% to 70%" picks one arm; the page's conclusion is "nearly negligible effect". The file's verifier note lists all four numbers, so the error is limited to the section 1 sentence. |
| C3 tau-bench (2406.12045) | CONFIRMED | Authors, 17 Jun 2024, cs.AI, CC BY 4.0, pass^k, gpt-4o under 50%, pass^8 under 25% retail, database state versus goal state: match. |
| C4 MAST (2503.13657) | CONFIRMED | 14 failure modes, three groups, 150 traces, 1,600+ traces, 7 frameworks, kappa 0.88, v1 17 Mar, v3 26 Oct 2025: match. 13 authors, no venue on the page. **Licence CC BY-NC-ND 4.0**: do not reproduce the taxonomy text. |
| C5 AI Agents That Matter (2407.01502) | CONFIRMED | Five authors, 1 Jul 2024, v1, cs.LG, arXiv non-exclusive licence; cost and accuracy jointly, "inadequate holdout sets, and sometimes none at all", no figures on the page: match. |
| D1 CaMeL (2503.18813) | CONFIRMED | 24 Mar and 24 Jun 2025, CC BY 4.0, control and data flow from the trusted query, capabilities, AgentDojo 77% with provable security versus 84% undefended: match. Authors' own result. |
| D2 Design Patterns (2506.08837) | CONFIRMED | 14 authors, v1 10 Jun, v3 27 Jun 2025, CC BY 4.0, "principled design patterns", abstract does not name them: match. File's pattern names stay unverified (file says so). |
| D3 Attacker Moves Second (2510.09023) | CONFIRMED (sub-claims unseen) | 14 authors, v1 only, 10 Oct 2025, cs.LG and cs.CR, CC BY 4.0, 12 defences, gradient, RL, search, human-guided; "above 90% for most". Per-defence figures match: Spotlighting and Prompt Sandwiching above 95%, RPO 96% gradient and 98% RL, MetaSecAlign 96%, Protect AI and PromptGuard above 90%, PIGuard 71%, Model Armor above 90%, MELON 76% to 95%. Human counts match (265, 178, 69, 123), but the paper does not say which detector the 123 refers to. Not seen: ">500 participants" (UNCONFIRMED), and "MetaSecAlign 96% on AgentDojo" (page says search attack, benchmark not named). The file lists 9 of the 12 defences; the other three are Circuit Breakers, StruQ and Data Sentinel. CaMeL, Progent and Fides are not among them in the part read (last 35,858 characters unread). |
| D4 Progent (2504.11703) | CORRECTED (policy language, title) | Authors, v1 16 Apr 2025, v3 14 May 2026 (v2 30 Aug 2025 omitted), arXiv non-exclusive licence. HTML text: "reduces ASR from 39.9% ... to 1.0%" on AgentDojo and 70.3% to 3.9% on ASB: match. Utility only in figures (file says so). The page does not call the policy language a DSL: "We implement Progent's policy using JSON Schema", symbolic rules over tool names and arguments. An SMT solver classes policy updates as narrowing (automatic) or expansion (needs approval); this is closer to AXION's approval model than the file notes. The abs page's current title is "Securing AI Agents with Privilege Control"; the file's "Programmable Privilege Control" title is not shown there (may be v1). |
| D5 Fides (2505.23643) | CONFIRMED | Nine authors (Microsoft), v1 29 May, v2 3 Sep 2025, CC BY 4.0, confidentiality and integrity labels, deterministic enforcement, formal result on taint tracking, AgentDojo "broad range of tasks with guarantees", no numbers: match. |
| D6 Agents Rule of Two, 2025-10-31 | CONFIRMED | Three properties, at most two, else supervised, human approval or fresh context: match. Page frames it as holding "until prompt injection can be reliably detected". No measurements. |
| D7 Anthropic prompt-injection defences, 2025-11-24 | CONFIRMED | 100 attempts per environment, 2,200 to 3,200 attempts per bar; Sonnet 4 13.8/10.7/2.0, Sonnet 4.5 13.8/10.8/1.9, Haiku 4.5 12.0/11.1/2.4, Opus 4.5 8.0/7.6/1.4; the "1% ... meaningful risk" sentence: all match. |
| D8 OpenAI Atlas hardening, 2025-12-22 | CORRECTED (title; one claim unseen) | Date, RL-trained attacker, counterfactual rollouts via a simulator, adversarial training, logged-out mode advice, "unlikely to ever be fully solved", no quantitative results: match. Title is "Continuously hardening ChatGPT Atlas against prompt injection attacks". "Deterministic guarantees are challenging" is not in what I got (UNCONFIRMED). |
| D9 Chrome agentic security, 2025-12-08 | CONFIRMED | Nathan Parker; User Alignment Critic sees metadata only and can veto; Agent Origin Sets (read-only and read-writable); deterministic URL check; confirmations (sensitive sites, sign-in, purchases); model never sees passwords; up to $20,000 rewards: match. The page also lists a prompt-injection classifier and says internal attack-rate tracking exists without figures. |
| D10 AgentDojo (2406.13352) | CONFIRMED | Six authors, v1 19 Jun, v3 24 Nov 2024, cs.CR, arXiv non-exclusive licence, no venue on the page, 97 tasks, 629 security cases, models fail tasks without attack, attacks break some properties not all: match. |
| E1 MCP security best practices | CONFIRMED (context limit) | Token passthrough forbidden ("MUST NOT accept any tokens not explicitly issued for the MCP server"), with audit-trail and control-bypass reasons; per-client consent; SSRF list (private ranges, 169.254.0.0/16 and 169.254.169.254, redirect validation, DNS pinning "consider", "avoid implementing IP validation manually" with octal, hex, IPv4-mapped IPv6, Smokescreen); scope minimisation and elevation logging: all match. The page cites the 2025-11-25 authorization spec. The SSRF section is about MCP clients fetching OAuth discovery URLs, not agent web egress (see R6-1). |

## 2. Maturity and licence notes

- Peer review: nothing in R6 shows a venue on its page except B2 (essay series). All arXiv items (B2, C3, C4, C5, D1-D5, D10) are preprints as seen. D3 is a single-version preprint.
- Vendor or practice sources: A1, A2, A3, B1, C1, D6, D7, D8, D9 (vendor), B3, E1 (standards or practice). None publishes an escape rate, kill-switch latency or staged-rollout result; the file's gaps section says so and I found nothing to contradict it.
- Measured attack results come from three kinds of source: authors' own benchmark numbers (D1, D4), vendor internal attackers (D7), and one independent adaptive study (D3) that tested prompt-level, training-level and detector defences, not structural ones. Nothing independently attacks CaMeL, Progent or Fides in what was read.
- Licences: CC BY 4.0: B2, C3, D1, D2, D3, D5. CC BY-NC-ND 4.0: C4 (do not copy taxonomy text; a failure vocabulary of AXION's own is fine). arXiv non-exclusive: C5, D4, D10. Vendor blog and doc pages: no licence stated; read for ideas only, copy no text.
- Dated: D4 v3 is May 2026; D7, D8, D9 are Nov-Dec 2025 and may be stale against 2026 model and product changes.
- Transfer: B3 (software releases) and E1 (OAuth discovery SSRF) are applied to agents by the researcher; both flagged below.

## 3. Candidates

Code facts that matter (read-only):
- `normaliseOrigin` (grants/origin.ts, c36/c56) is a pure fail-closed normaliser for an https origin: it refuses IP literals in any spelling, metadata names, reserved TLDs, percent-encoding, userinfo, wildcards, trailing dots, IDNs, public suffixes. It does not take paths, filesystem paths or redirect chains, and refuses private IPs by refusing all IP literals. So R6-1's "encoded private address" fixtures are mostly already a grant-time property; what is new is checking a requested URL against a granted origin at run time.
- `browser/contract.ts` (c37) already has `parseAction`, `canonicalActionDigest` binding tenant, mission, task, origin, requester and a hashed element, `classifyAction` with `redirects` and `actualUrl` revalidation, obligations (`quarantine`), and `valueRef` with `sec_` and `val_` prefixes. STAGE7.md states the executor trust boundary.
- `approvals/service.ts` has `digestV2` with a fixed field set and a `digest_version` column; an evidence digest also goes into the audit chain (c75). Adding a profile hash or caps to an approved digest means a new digest version, which touches the security core.
- `jobs/store.ts` (c45) is records only: `JOB_KINDS = ['noop.test']`, `payloadRef`, lease token fencing, SQL-clock leases (0.05 to 3600 s), `requestCancel`. No caps, credential, run or step fields exist.
- `audit.ts` is a hash chain; its `redact` drops keys that match `pass|password|token|secret|csrf|hash|cookie` by key name only (it does not scan values, and `hash` keys are dropped, which matters for storing run hashes under those names).
- `policy/` has tiers R0-R4, baseline kinds, `evaluate`, and `rule-of-two.ts` with three coarse flags derived from configuration (not from data labels). `evolution/` has `skill-gate.ts`, `judge-calibration.ts`, `eval-runs.ts`; `failures/taxonomy.ts` already exists; `forecasts/ledger.ts` and `otel/mapping.ts` exist.
- No code or contract defines execution profiles, brokers, trajectories, stage ledgers, budgets or halt records. The file's "assumed from the task statement, not code" caveat is accurate; I did not confirm incident records (R4-3), change-freeze records (R4-5) or change plans beyond `org-plan.ts` existing.

### R6-1 Execution profile and egress policy
- Sources: A2, A3, E1 confirmed and agree on default-deny, allowlist by origin, credential-file exposure. **E1 is OVERSTATED as support for agent egress**: its SSRF section addresses MCP clients fetching OAuth metadata URLs; the transfer to agent browsing is the researcher's. "DNS resolver pin" mixes A3 (trusted resolvers) with E1 (pin resolved addresses between check and use); a file cannot do either, only the future proxy can. Isolation tiers (process, container, microVM) are A2's options; the "class marked untrusted cannot select the weakest tier" rule is the researcher's.
- Extrapolation: the 100% thresholds and the 60 fixture cases; the tier requirement per class.
- Builds on existing pieces: plausible and strong for the allowlist (reuse `normaliseOrigin`, site grants, `originOfUrl`). The path, credential-file and resource-limit parts are new pure code. Approved-digest binding of the profile hash needs a digest version change (see above): treat threshold (c) as a separate, later change, not part of the first slice.
- Required before a brief: state that the validator decides requests against a profile but enforces nothing; use `normaliseOrigin` and add a function for a full URL against a granted origin (scheme, host, port, redirect hop), not a second parser; split the digest binding out; cite E1 only for IP-encoding and redirect checks "by analogy"; keep the 60-case suite but note ~25 are already covered by `hostile-origins.json`.

### R6-2 Credential broker contract
- Sources: A1, A2, A3, E1 confirmed as design guidance; no leak rates exist. The audience and passthrough rule from E1 is correctly scoped (token audience) but E1 is about MCP servers and OAuth.
- Extrapolation: handles, scanner patterns, revocation bounds, all thresholds.
- Builds on: partly. `valueRef` with `sec_`/`val_` already keeps secret values out of actions (STAGE7.md item 5); lease expiry and fencing exist; audit `redact` is key-name only, so a value scanner would be new. A fake broker with in-memory handles is isolated new code.
- Required: scanner claim must read "finds seeded patterns", never "proves absence" (the file already says this); decide whether it merges with the existing secret store and `sec_` resolver before inventing handles; defer until a tool needs a secret.

### R6-3 Trajectory schema, replay, per-run cost
- Sources: C1 (final state over claim), C3 (pass^k, database state), C4 (labels), C5 (cost as metric) confirmed; A2 supports logging at the proxy. All practice-based; no source tests replay.
- Extrapolation: the schema, the "claimed, not verified" flag, hash-chain anchoring.
- Builds on: audit chain, otel mapping and job records are real; `failures/taxonomy.ts` already holds a failure vocabulary, so the MAST labels (C4, NC-ND) should map onto it, not be copied. Anchoring a run hash into the chain is plausible. No run or step table exists.
- Required: store hashes and ids, not tool results, in the first slice (the file's own retention risk); reuse the existing failure taxonomy; say replay checks policy decisions are deterministic only; cost "unknown" never zero (good).

### R6-4 Stage ledger and readiness gate
- Sources: B1 correct but cross-user observational; B2 conceptual; B3 about software releases; D6 supports the Rule of Two only. No source supports a promotion rule or a shadow-agreement metric. The file says so.
- Extrapolation: nearly everything (stages 0-3, evidence list, thresholds, demotion triggers). The anchoring warning for shadow is the researcher's good addition, unsupported by a source.
- Builds on: policy tiers, approvals, `skill-gate.ts` and `stats.ts` (Wilson intervals, floors) are real; R3-3 ladder per skill I could not verify in code.
- Required: rename stages: the roadmap uses "Stage 0-4" for phases and R6-4 uses "stage 0-3" for the ledger, and the roadmap says "promote the class to stage 2" inside "Stage 3"; thresholds and floors are owner decisions, stated as such; evidence calculator only, no promotion proposals until runs exist; log whether the human saw the proposal.

### R6-5 Kill switch, budget and rate caps
- Sources: B3, A2, C5 only loosely; the file correctly calls it the weakest evidenced. Nothing measures kill-switch effectiveness.
- Extrapolation: all of it.
- Builds on: lease fencing, `requestCancel` and SQL-clock leases are a real base for "no step after halt" (a fencing token check is the right primitive). Caps in the approved digest again need a digest version change.
- Required: no evidence claim, present as an engineering control; first slice is a pure checker over a fake executor counting steps, as proposed; "within the stated bound" must be written down before the test; add a halt-record table in its own lane.

### R6-6 Agent-version canary
- Sources: B3 only (software releases); C1 and C3 for metrics. Extrapolation throughout; the file says so and says volume may be too low.
- Builds on: change plans and R5-4 readouts not verified in code; skill gate exists offline.
- Required: not before stage 4; first work is only a power calculation saying whether a canary is feasible; do not brief now.

### R6-7 Outcome graders and reward-hack checks
- Sources: C1, C2, C3, C5, C4 confirmed. C2's rates are on research benchmarks with reachable scoring code (the file says so); the telling-not-to-cheat sentence needs the correction above. Detector rates (90% at 10% false flags) are the researcher's targets; C2's own detectors had high false-positive rates.
- Builds on: eval lab (`eval-runs.ts`, `judge-calibration.ts`) exists; graders with reference and null solutions are new, isolated pure code.
- Required: state that toy tasks test the harness, not any agent; report detector rates with n and as fixture-only; keep C2 numbers out of any claim about AXION tasks.

### R6-8 Plan conformance and data-flow labels
- Sources: D1, D4, D5, D6, D9 confirmed. **OVERSTATED attribution in section 6**: "the only candidate with measured results against attacks (D1, D4)" ignores D7, and those numbers are the authors' own on AgentDojo and ASB, not an independent adaptive test (the file's notes say so, the ranking does not). D3 shows prompt-level and detector defences fail; it does not show structural defences hold. D4's own policy language is JSON Schema, not a DSL.
- Extrapolation: the plan hash over ordered calls, label propagation applied as checks, the mutation-search harness, all thresholds. D4's narrowing-versus-expansion split (auto-narrow, approve-expand) is a closer fit to AXION than the file's plan-hash idea and is worth noting.
- Builds on: the browser contract, `classifyAction`, per-action digests, Rule-of-Two flags and the corpus in `browser-contract.test.ts` are real. But approvals bind one action, not a plan; a plan-level digest is new and again touches the digest. The existing corpus is small and fixture-style; "1,000 mutated variants" would be a new generator.
- Required: split: (1) plan-conformance and privilege check over scripted trajectories (Size M); (2) label propagation later, after real tools exist, since the file admits the model-mediated case cannot be tested; the mutation loop is a regression test of the checker, not evidence of resistance to adaptive attackers; cut the ranking sentence; owner sets the extra-approval bound.

## 4. The staged roadmap (O1-O5)

Consistent with the candidates in most places. Findings:
- Each stage ends in an owner decision and no model call occurs before O3: consistent with the file and with D6 and A3. This is a design choice, not something a source tests.
- Stage 3 promises "broker credentials scoped per task" but only a fake broker is built (Stage 1). A real broker is not planned or approved at any O point; add one before O4.
- The R6-4 stage numbers collide with the roadmap's Stage numbers (see R6-4). Rename one set.
- Stage 1 contains R6-8 at Size L before any shadow run exists; with the split above, only part (1) belongs there.
- O2 asks the owner to approve "the number of extra approvals" on benign fixtures: a good measure, but with fixture workflows it is a number about fixtures.
- O3 (first model call, provider, budget, run floor) has no evidence base; thresholds are the owner's risk call, as the file says. The ranking section's "if only three" lists four items (R6-1, R6-8, R6-4, plus R6-3).
- Demotion automatic and promotion human is consistent with R6-4 and R6-5; no source tests it.
- No O point covers the digest-version change that R6-1, R6-5 and R6-8 each assume; it should be an explicit decision.

## 5. Closing recommendation

Safe, no-model first slices for the next phase, in this order:
1. **R6-1 (S).** Profile schema plus validator for a URL, path and limits against a profile, reusing `normaliseOrigin`. Wording: "decides allow or deny on a request; enforces nothing"; no digest binding yet; do not claim SSRF coverage from E1.
2. **R6-3 (M, own lane, own tables).** Step and run record, replay verifier over scripted fixtures, "unknown" cost. Store hashes, reuse `failures/taxonomy.ts`. Wording: "shows decisions are deterministic, not that a model would act the same".
3. **R6-5 first slice (S-M, pure checker).** Caps and halt over a fake executor, with fencing. Wording: "an engineering control with no measured evidence base". Digest binding deferred.
4. **R6-7 (M).** Graders with reference and null solutions on toy tasks, tamper detector on seeded fixtures. Wording: "tests the harness, not any agent"; no C2 rate quoted as AXION's.
5. **R6-4 evidence calculator only (M, after R6-3).** "Not enough evidence" until the owner's floor; no promotion proposals.
6. **R6-8 part (1) only (M)**, after 1 and 2; do not brief labels.

Hold: **R6-2** until a real tool needs a secret (then, scanner wording "finds seeded patterns"); **R6-6** until stage 4 and a power estimate says it is feasible. Before any brief: fix the C2 prompt-test sentence, the D4 "DSL" wording, the ranking claim on R6-8, the E1 SSRF scope, the "only three" count, the licence note on C4, and decide the digest-version question with the owner.
