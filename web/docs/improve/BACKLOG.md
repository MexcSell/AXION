# Improvement backlog

Scores are 1–5: V = value to the owner, E = effort (5 = small), R = safety (5 = low risk). Sum = priority.
Sources:
- the spec: §4.11 Evolution Lab, §10.9 self-evolution, §16.1 six dimensions, Stages 9–11;
- subnet-scout (read only): `organization.py`, `evolution.py`, `analytics.py`, `experience.py`, `company_decisions.py`, `team_eval.py`.

Tags:
- **REC**: works on data the app really records today.
- **EXEC**: only meaningful once agents execute; build the scaffold with "not enough evidence".

Placement: Evolution Lab and Governance pages were removed in u1, so features live in the existing tabs:
- Agents › Proposals, Development, Lineage and Departments;
- Missions KPI tiles;
- Overview, which is hidden but reachable;
- System Operations.

## A. Company structure

| # | Idea | Tag | V | E | R | Σ | Status |
|---|---|---|---|---|---|---|---|
| A1 | Org change proposals: each proposal holds a full proposed set of reporting lines. Checks: a dry run (no cycles, one manager per agent, every role covered); a SHA of the payload; pinned to the base org revision, so approval fails with 409 if the org changed; expires after 7 days; an admin approves and the proposal is applied once into a new org revision, or rejected; everything is audited. Agents › Proposals becomes real in api mode. | REC | 5 | 3 | 4 | 12 | cycle 1 |
| A2 | Before/after org diff and impact: changed lines, plus missions whose staffing would differ. Running instances keep their pinned state. | REC | 4 | 3 | 5 | 12 | |
| A3 | Org history and rollback: a revision timeline. Rollback means proposing the previous revision as a new proposal, which goes through approval again. | REC | 4 | 4 | 5 | 13 | |
| A4 | New missions are staffed from the active org revision, so the executor chain follows the reporting lines. Running missions are unaffected. | REC | 3 | 3 | 3 | 9 | |
| A5 | Capability coverage check: every role and duty is covered, with no orphan agents and no manager without reports. Shown on Departments and used by A1's dry run. | REC | 3 | 4 | 5 | 12 | |

## B. Company performance

| # | Idea | Tag | V | E | R | Σ | Status |
|---|---|---|---|---|---|---|---|
| B1 | Company scorecard from recorded events. Rows: missions finished, verified versus "finished, unverified", median cycle time, failure and recovery rate. Each row has n, a window and an evidence sentence, and is null when n=0. Served by `GET /company/scorecard` and shown in the Missions KPI tiles and on Overview. | REC | 5 | 3 | 5 | 13 | |
| B2 | Throughput trend against the previous equal-length period. The trend is null when either period is empty. | REC | 3 | 4 | 5 | 12 | |
| B3 | Department KPIs from recorded data (instances, tasks, delegations per department), replacing the DEMO capacity and coverage numbers. | REC | 4 | 3 | 5 | 12 | |
| B4 | The six dimensions of §16.1 at company and department level, with sample sizes. Most cells read "not enough evidence" until execution exists. | EXEC | 3 | 3 | 5 | 11 | |
| B5 | Cost per verified outcome. A null scaffold until usage is recorded (Stage 9). | EXEC | 2 | 4 | 5 | 11 | |

## C. Agent performance

| # | Idea | Tag | V | E | R | Σ | Status |
|---|---|---|---|---|---|---|---|
| C1 | Agent reliability from delegations and task attempts. Delegated tasks done without failure or retry count as reliable. Below 5 pieces of evidence the score is null, with the count always shown. Uses provenance `measured`, on the Agent Profile and Directory. | REC | 4 | 3 | 5 | 12 | |
| C2 | Agent version proposals: candidate config with its SHA and `base_sha`, a status, a manual promote that checks the SHA (409 when stale), and one-click rollback creating a new version. Running instances stay pinned, and the author can't promote their own proposal. Agents › Development becomes real. | REC | 5 | 2 | 4 | 11 | |
| C3 | Experiment verdict as a pure function: paired cases, `min_cases`, margin, losses ≤ wins, zero failures, with the "why not verified" reasons. The evaluator must not be the author and the dataset SHA must match. Built as a scaffold and tested on fixtures. | EXEC | 3 | 4 | 5 | 12 | |
| C4 | Mentoring plans: mentor, target skill, milestones and a re-evaluation date. Recorded, and shown in Development. | REC | 3 | 3 | 5 | 11 | |
| C5 | Post-promotion watch: an opened, baseline, expires row showing "waiting for N measured runs". Records only and never rolls back automatically. | EXEC | 2 | 4 | 5 | 11 | |
| C6 | Recommendations as proposals only: promote or review-role, only above the evidence threshold, and never applied automatically. | EXEC | 2 | 4 | 5 | 11 | |

## Code health (between themes when a cycle finds a need)

| # | Idea | V | E | R | Σ |
|---|---|---|---|---|---|
| H1 | Fix the deferred minors from the Stage 6 ledger, in batches. | 3 | 4 | 5 | 12 |
| H2 | Split the main bundle (motion, radix, help registry) to cut initial load. | 2 | 3 | 4 | 9 |

## Planned order

A1 → B1 → C1 → A3 → B3 → C2 → A2 → B2 → C3 → A5 → B4 → C4 → A4 → C5 → H1. The order is adjusted by lessons.

**Revised after cycle 3** (see LESSONS: measurement can't be exercised before execution): A1 ✔, B1 ✔, C1 ✔ → A2+A3 (c04: history, diff, rollback) → C2 (c05: agent version proposals, promote and rollback) → H4 (c06: flaky browser checks) → A5 (c07: coverage check) → B3 (c08: department staffing facts) → C4 (c09: mentoring plans) → A4 (c10: staffing follows the org) → H1/H2 (code health) → C3/C5 scaffolds last.

| H3 | Race: POST /agents reads the org edges before taking the org-revision lock, so an agent created while a proposal is approved can silently revert it (found in cycle 1). One-line fix in agents/routes.ts. | 5 | 5 | 4 | 14 |

| H4 | Flaky browser checks: api-stage6 Edit-dialog save (I2) failed once in c01 and c02 combined runs; c01 proposal-expiry step races with another browser re-read (c02 papered over it with a 1.5 s wait). Replace fixed waits with condition waits and remove the races. | 4 | 4 | 5 | 13 |

| H5 | Agent Profile tabs overflow by 13 px at 1366×768 (the fit-check fails; pre-existing, found in c05 and c06). Make the tab bar fit (icon-first when narrow), per the owner's one-screen rule. | 4 | 4 | 5 | 13 |

| H6 | Loading and busy texts in api mode ("Loading instances…" and similar in Agents, AgentProfile, ServerProposals, JobSearch) sit in plain divs with no role=status/aria-live; also check Tab wrap-around in the a11y script (from the c16 review). | 3 | 4 | 5 | 12 |

| P2 | Virtualise long conversation threads (c22: a live 1,000-message burst still keeps the page busy; api-stage6 counts one DOM row per message, so coordinate the check). | 3 | 2 | 4 | 9 |

| H7 | flows.mjs steps flake under load (Hierarchy even at 1x; Conversations, palette, theme, help popover, u1 News / Chat dock under load), found in c29. Make every step condition-based and check it under FLOWS_CPU_THROTTLE=4. After c28 and c29 merge. **Measured on the merged tree (batch 5f, f85f310, 4× throttle): 19/21, the archive step PASS, `Command palette navigates (Ctrl+K)` and `Theme toggle` FAIL (waitForURL / click timeouts), so the palette still fails under throttle after c28.** | 4 | 3 | 5 | 12 |

| H8 | useStaffingDriver (web/src/features/mission/staffing.ts:12-21) ticks over a `missions` array captured at render time, so between a store update and the React commit a tick can advance a just-archived mission (staffing-plan.ts:97 checks the stale copy). Read fresh state from the store inside the tick, and prove c29-archive-race.mjs fails on a known-bad mutation. From the c29 review. | 3 | 5 | 5 | 13 |

| E1b | Wire verdictV2 into version proposals: bind runs to the holdout dataset id, compute the observed hash from the stored cases (not from the caller), check content_sha256 against the cases, and refuse an INSERT of an already-frozen dataset with no cases (the c32 guard covers only UPDATE). From the c32 review and fix round. | 4 | 3 | 5 | 12 |

| P5b | **DONE in c49 (HMAC anchor file, live since 2026-11-22T17:44Z).** Audit chain anchor: keep the latest hash outside the DB, or use an HMAC key held outside agent-editable storage, so truncation of the newest rows or a full rehash is detected (c31 limit). | 4 | 3 | 4 | 11 |

| P3a | Approvals UI: hide or disable Approve/Deny for members on R3/R4 requests, with a `?` explaining "needs an administrator" (the server now refuses with 403 POLICY_DENIED, c30). Fold into P3. | 3 | 4 | 5 | 12 |

| P3b | Second-approver rule. Agent requests carry agent ids in requested_by, so "decider ≠ requester" never fires for them: a human who created a mission can approve their own agent's R3/R4 request alone. Needs either a distinct owner role (Q9) or a two-person rule for R3/R4, with a fallback for single-admin tenants (for example a time delay plus a notification). Found in the c35 review. | 4 | 3 | 4 | 11 |

| P4a | IDN site grants. c36 refuses every internationalised hostname (fail closed after the review found Armenian, Hebrew, Han/Kana and combining-mark look-alikes). Add an explicit path: the admin types the Unicode name, the UI shows the punycode plus a script-mixing / confusable report (UTS #39 skeletons), and a second confirmation is required. | 2 | 2 | 4 | 8 |

| P4b | Full public-suffix check: c36 embeds a partial list of multi-tenant suffixes. Vendor a pinned Public Suffix List snapshot (with a hash) and refuse grants on any public suffix. | 3 | 3 | 5 | 11 |

| H9 | Refresh c15 contract tests against the full API after batch 8 (held at batch 5: written before cycles 4–20, with 53 drift fields, 19 uncovered routes and 7 events). Generate the coverage list from the route table so new routes can't go uncovered. | 4 | 3 | 5 | 12 |

| O3a | Task-review hardening (from the c38 re-review). (1) An append-only owner-history table written by a trigger on `tasks`, so prior-actor exclusion is fail-closed and doesn't depend on audit rows. (2) A review only verifies if it is newer than the task's latest attempt (today an old accepted review re-verifies a fail → retry → pass). (3) The o-series match is `o[1-9]` exact plus a separator, and router prefixes that name a different vendor (`anthropic/gpt-4`) → null. | 3 | 4 | 5 | 12 |

| O2a | Require a delegation brief on every human reassignment (c42 leaves it optional because the frozen api-stage6 reassign step sends none). Update that script step first, then make the brief required server-side. | 3 | 4 | 5 | 12 |

| P5c | Events-lock exposure after c31. `audit()` now takes the database-wide events advisory lock (schema-scoped since 9e958f3) before the tenant chain lock, and pool audits such as sign-in run with `lock_timeout = 5s`. So any transaction that appends an event early and then waits (row lock, slow query) can turn unrelated sign-ins into 500s. Measure the longest events-lock hold in the scale bench. Then either order event and audit writes last in every transaction, move to a per-tenant events lock (if SSE ordering allows: streams are tenant-scoped), or let the sign-in audit retry once. From the batch 7 integration. **Measured (c49, small DB, busy machine):** hold p50 2.1 ms / p99 4.7 ms / max 14.8 ms over 4,658 transactions at concurrency 12, so the risk is pathological transactions only; priority lowered. | 4 | 3 | 4 | 11 |

| P2b | Thread follow-ups from c44. (1) The older-page restore anchor holds for 1 s; a row measured later than that (heavy load) falls back to the c26 race. Replace the timer with "until every row above the anchor is measured". (2) The rest of the full-burst cost is thread-level: a forced layout from `ChatView.hold`'s `scrollTop` read (about 150–175 ms), plus React dev-mode cost. Measure a production build too, as a secondary number. (3) api-c44's latency bar (200 ms absolute) discriminates thinly; make it relative to the quiet control. (4) One unexplained api-c22 N=1000 reload that was not interactive within 180 s at load 9–15, not reproduced in 3 later runs. | 3 | 3 | 5 | 11 |

| E1c | Before any eval-run write route exists: (1) count candidate runs per (tenant, agent, candidate config sha, holdout dataset) **across proposals**, so withdrawing and re-proposing can't shop for a better re-run on the same holdout; apply the same count to base runs; (2) let a crashed or unfinished run be resumed or finished instead of failing with `holdout_rerun`; (3) validate judge model-family labels against the c38 vendor alias table on write; (4) accept 16–17-digit floats by proving JS and SQL number rendering agree, or by storing scores as fixed-point; (5) `dev_holdout_reuse` false positives on generic shared inputs (match on case id plus input, or a minimum overlap). From the c47 re-review. | 4 | 3 | 5 | 12 |

| H10 | Merge minors from integrator #3: (1) c41's skill lock lower-cases the name in JS but the uniqueness uses SQL `lower()`, so they differ for non-ASCII names; compute the lock key from SQL `lower()`. (2) c38: `taskReviews.cancel()` on sign-out (like the other refreshers). (3) The c04 History check bans the word "coverage" (over-broad). (4) Name the 3 vitest failures seen after c09 (probably the lock class fixed in 4eca9db) by re-running that merge commit. (5) `POST /approvals/:id/decision` returns `decidedByName: null` for a decided request while `GET /approvals` returns the name (the handler re-reads the bare row without the decider join); found by c50, on its exercised.ts allowlist as FINDING. | 3 | 4 | 5 | 12 |

| M1b | Six dimensions follow-ups (c46 review): (1) c46b: source `verdict_outcomes` by recomputing verdictV2 over c47's stored proposal runs; (2) move the Six dimensions dialog (DL-98) to a tab inside the shared PageFrame (owner rule: shared PageFrame on every page). | 3 | 4 | 5 | 12 |

| H11 | Clock bounds from SQL everywhere (c46 lesson). `windowOf()` in `company/scorecard.ts` builds SQL bounds from the app clock; callers `company/routes.ts:56`, `company/departments-routes.ts:21`, `failures/routes.ts:52`. `approvals/service.ts:59-60` builds demo `createdAt`/`expiresAt` from `Date.now()`. Also make `current` required (not optional) in `independence()`'s owner-history input (c51 re-review). From integrator #4's grep. | 3 | 4 | 5 | 12 |

| M1c | c46's dimension cells count review verification without c51's freshness rule (a review counts only if newer than the task's latest attempt). Use c51's `stale`/`verified` logic so the scorecard and the task page agree. Fold into M1b. | 3 | 4 | 5 | 12 |

| H12 | a11y api run on the final batch-13 tree: one `LIVE: page has no live region` on `/operations?tab=agents&sub=directory&view=cards`, passed on re-run alone. By the lessons, a pass on re-run is a race, not noise: find when the live region mounts relative to the probe (or a render path where it doesn't), and make the probe condition-based without loosening it. | 3 | 4 | 5 | 12 |

| H13 | c50 allowlist entry for `GET /operations/anchors` (needs a configured key and file). Configure a hermetic key, domain and temp anchor file in the contract harness so the route is exercised, and delete the allowlist line. | 3 | 5 | 5 | 13 |

| P4c | PSL snapshot ageing (c56). The pinned list (2026-11-21) will age with no warning. Show the snapshot date and age in System Operations health, and warn past a stated age (e.g. 90 days); refreshing stays a reviewed commit with a new manifest. | 2 | 5 | 5 | 12 |

| E1d | **Partly done in c70** (content-hash key, base-run regrader_is_author, canon whitespace/NFC/empty, short-only repeat exemption). Still open: variant-B shopping, a re-created identical base version, dev runs by a withdrawn sibling, a lightly edited holdout copy, ZWJ/ZWNJ/word-joiner/soft-hyphen and skill-case folding in the canon, and `decideOnOrigin`/`loadGrants` taking a caller-supplied `now` (no production caller). Original: Holdout shopping beyond the same config (c53 review F6). c61 re-review minor: a re-grade diff by the proposer on the *base* run is accepted by the DB (the loader won't link it, so the outcome stays inconclusive); refuse it in the DB too, and keep a test with an explicit `grader: null` legacy run. Not caught today: the same dataset content under a different dataset id; a variant B evaluated on a holdout after A's result was seen; a re-created identical base version; dev runs by a withdrawn sibling proposal. Key the holdout limit on dataset content hash and on (agent, holdout) across variants, with an explicit, audited "new holdout required" path. Also from the c53 re-review: SQL `btrim` in `eval_canon_config` trims spaces only (a tab, NBSP, empty-string skill or NFC/NFD spelling isn't collapsed for raw writers; the API normalises first); the `dev_holdout_reuse` repeat exemption can hide a leak when long inputs are duplicated on both sides (exempt repeats only when short); a raw INSERT race still raises 23505, so future writers must use `mapRunInsertError`. | 4 | 3 | 5 | 12 |

| H14 | `test/jobs.test.ts > concurrency > 20 parallel claimers over 50 jobs: each job is claimed exactly once, and the table agrees` (c45) fails under load with `too many connections for role "axion"` (also on base bfe891e, 4 of 5 paired rounds at load 14–22), and `test/audit-chain.test.ts > GET /audit/verify` fails with `admin connect failed` for the same reason. heavy.sh now gates vitest to 3 concurrent DB slots (19:14Z). Check whether the test should bound its own connections (20 claimers each opening a client) rather than rely on the gate. | 3 | 4 | 5 | 12 |

| H11b | Remaining app-clock sites after c54. `agents/reliability.ts` `reliabilityWindow(new Date())` is a real window bound (applied as a JS filter over loaded rows); also `grants/routes.ts` `Date.now()` expiry comparison and DTO, `approvals/routes.ts` approvalDto expiry state, notifications `agoMin`, missions presentation timestamps. Move the reliability window and the expiry comparisons to DB `now()`; presentation-only uses can stay. Also (c54 review) `grants/routes.ts:85` writes `issued_at`/`expires_at` from the app clock while the DB clock compares them; and `loadEvaluations` is N+1 on every dimensions read. | 3 | 4 | 5 | 12 |

| H15 | OTel export follow-ups (c60 re-review). Allow hyphens in tool names (`web-search` exports as `_OTHER` today; `SECRET_SHAPE` still rejects `sk-`/`pk-`/`rk-`). Document that identifier-shaped ids and names (case id, dataset id, judge family, agent name) leave in default mode, and reject all-digit strings of 13+ characters. Only the final `--out` path component is symlink-protected, which is acceptable for a local operator CLI. | 2 | 5 | 5 | 12 |

| P3c | Approval decision records (c58 review F5). Flags, fired rule, latency, queue size and the fast-bulk flag are guarded by triggers only. Bind the fired rule and flags into `digestV2` or the audit chain, and add latency and queue size to the `approval.decide` audit row, so the evidence is tamper-evident like the decision. Also widen the Rule-of-Two flag (b) "reaches sensitive data" once data-access capabilities exist (c58 F1, owner Q14). c58 re-review residue: the 7/30/90 windows are nested, so subtracting them can isolate a few decisions, and below the floor a member still sees `n` and `approverCount` (with one approver, n is that person's count). Neither exposes latency or rate; hide `n` below the floor and consider non-nested windows. | 3 | 4 | 5 | 12 |

| E4b | Skill and role caps (c59). The c59 active cap is per agent playbook (default 25, operator setting `PLAYBOOK_ACTIVE_CAP`), because c41 keys playbooks by agent and skills have no role field. Add a role field to skills (or a role link) and cap approved skills per role, if the owner wants a role-wide limit. | 2 | 3 | 5 | 10 |

| H16 | 390 px tab strips (c54 review): a 390 px demo capture shows overlapping labels in both tab strips on pre-existing System Operations tabs. api-mobile and api-c46 pass, so the harness may not look at label overlap. Check against base, add a label-overlap probe to api-mobile, then fix (icon-collapse at narrow widths). Also from the c54 re-review: the tab-strip selected-tab effect depends on `[value, tabs]` and `tabs` is usually a new array each render, so a parent re-render while the strip is scrolled away could snap it back (key on the tab ids); and a non-selected tab focused at the edge sits inside the 28 px fade, so scroll a focused tab fully into view. | 3 | 4 | 5 | 12 |

| E1e | Judge-calibration gate without selection bias (c61). Gating on the *estimated* judge margin (Youden J) admits middling judges whose calibration sample was lucky, so conditional coverage falls to 66–93% in pinned cells even at a 0.5 floor. The c61 re-reviewer advises that a lower confidence bound of J does **not** remove the bias (it still conditions on the same labels). Better, in order: (1) sample splitting: decide eligibility on a pilot subset of the calibration labels and compute the interval from the rest; (2) qualify the judge once, outside the evaluation, on labels never reused; (3) drop the gate and use a Fieller-type interval that goes unbounded when the margin's confidence set includes 0. Simulate the chosen remedy, re-run the fixed 72-cell grid on two seeds, and remove the NOT_MET pins only if every assessed cell reaches 93%. Scaffolding until judges are used. | 3 | 3 | 5 | 11 |

| P2c | Reader not pinned after a fast live burst (found by c55, confirmed on base bfe891e by the c55 review). After 100–200 live messages, the reader sits 15–17k px above the bottom and `pinned` is false, in dev and prod builds, so follow-the-thread breaks during bursts. Find where the pin is lost (scroll handler vs commit order), fix it, and add an api check that the reader stays pinned through a burst. Also: after release, a late growth of the sliver row above the restore anchor can still shift it. | 3 | 3 | 5 | 11 |

| H17 | **Done in c67** (api fit ALL FIT 79/79). Leftover polish: the 'Reports to GM · created N d ago' line over the hero art is low-contrast in dark mode, so strengthen the pill. The hero description is still hidden at ≤ 860 px height (c18's rule), so decide whether to surface it in a `?`. Original: api-mode fit-check: 10 BAD views at 1366×768, all `/agents/coder-01?tab=*`, already present on base 07831cd (found by c64). Demo-mode fit-check is clean, so api-mode data overflows the Agent Profile tabs. Owner rule: fit one screen. Measured by the c64 reviewer on base: each view has `mainOver 48`. `main` is 688 px tall against 736 px of content: `.oa-hero` is 360 px, the tabbar 54 px, and `.fit-scroll` starts at 516 with a 300 px minimum, ending at 816 against a page bottom of 750. Fix: shorten the hero by about 50 px below 800 px height, or lower the agent profile's fit-scroll minimum to about 250. Then and add api-mode fit-check to the integrator's standard checks. | 4 | 4 | 5 | 13 |

| O1c | Org guardrail follow-ups (c64 review S7): the bad-proposal corpus has about 12 distinct shapes among 33 cases and mostly tests the pure function; add route-level corpus tests and more shapes. c64 re-review minors: say in the cooldown help that an exempt undo restarts the cooldown; add a test for the exemption when the current revision came from a hire; api-improve's 'nothing invented' regex could use `[ \t]*` instead of `\s*`. |  2 | 4 | 5 | 11 |

| M2b | Metric guard follow-ups (c66 review minors). `metric_audit_labels.sample_ref` is free text that can name demo data and outlive the purge, so make it a typed reference or purge with demo. The registry loader test is table-level and covers 3 loader files; extend it to columns and every company loader. Strengthen weak counter-metrics (`context_loss`; rows whose counter-metric shares inputs with the primary). | 2 | 4 | 5 | 11 |

| P6 | Scorecard at scale (found by the c69 review): `GET /company/scorecard` takes about 4 s at 25,000 tasks, against 0.5–0.9 s for c69's `/company/process` and about 125 ms at 5,000 tasks. Profile the scorecard loaders (probably per-mission or N+1 reads, and unbounded windows), add the missing indexes or batch them, and set a budget (for example p95 under 1 s at 25k tasks) checked by a seeded scale test. | 4 | 3 | 5 | 12 |

| H18 | a11y api LIVEPROBE race: one run showed `LIVEPROBE no loading text matching /loading proposals/i`, which passed on rerun alone (seen in the c69 fix round). The same class as H12: the probe looks for transient loading text that can finish before it samples. Make the probe hold the request open (route interception) until it has checked the live region, as for the other probes. Never loosen it. | 3 | 4 | 5 | 12 |

| H19 | The 5190 Vite watcher misses changes to `shared/contracts` after merges (3 times now: ~09:16Z 11-22, ~16:08Z 11-22, 02:22Z 11-23). Configure the dev server to watch `../shared` explicitly (`server.watch` / `fs.allow` plus a resolve alias), or add an integrator step that curls a served contracts file after any merge touching `shared/` and asks the controller to restart. | 3 | 4 | 5 | 12 |

| H20 | No-leaderboard guard gaps (c72 re-review): a renamed value field (`pct`) holding the rating, and a comparator calling an unrelated function in a file that doesn't import a skill module, are not caught by the source scan; the metamorphic reversal check covers only the 10 sweep routes. Add a value-based check in the coverage run (any response array whose order correlates with the rating values is flagged) to close both. | 2 | 3 | 5 | 10 |

| H21 | `test/c71-equivalence.test.ts` intermittently fails in `beforeAll` at `seedScale` (`c71-scale-fixtures.ts:101`) with `relation with OID … does not exist` (seen in the c75 and c77 serial full runs; passes alone 8/8). Probably a catalog race with another file's schema drop in the shared `axion_test` DB while the large seed runs. Make the seed run inside its own schema's transaction with stable OIDs (no reliance on catalog lookups across a concurrent DROP), or retry the seed once on that SQLSTATE; never loosen the equivalence. | 3 | 4 | 5 | 12 |

| R4-2 | Audit chain v2 for redaction (research round 4, verified). The current `chainHash` covers the full `detail` JSON plus actor, subject, action, result and correlation id in plaintext, so redacting breaks `/audit/verify`. Design a v2 chain for **new rows only** (hash a commitment such as a salted digest of `detail`, keep the plaintext separately redactable via tombstones), with a v1/v2 verifier, an update to the 0026 SQL twin, a tombstone table with all four guards, and the c49 anchor unchanged. Size L; design brief first. | 4 | 2 | 4 | 10 |
| R4-1/3/5 | Retention classes and two-person legal hold (R4-1), an AI incident record with evidence freeze and deadline clock (R4-3; deadlines from a law-firm summary of a draft), queue SLOs with error budget and freeze (R4-5; needs owner targets). See phase2/research-r4-verified.md. | 3 | 3 | 5 | 11 |

| T1 | Multi-tenancy below the columns (c79 findings). (1) `agent_definitions.id` is a global primary key and the org chart needs the literal root id `gm`, so a second tenant cannot get the standard company seed (duplicate key); make agent ids tenant-scoped (composite key or namespaced ids) before a second real tenant. (2) `GET /operations/health` `sizeBytes` reports the whole database size to any tenant's admin, a cross-tenant aggregate: report the tenant's own footprint or restrict it to a platform operator. (3) `POST /notifications/:id/ack` and `ack-all` accept any well-formed id (foreign or nonexistent) and store an orphan read marker under the caller's tenant: return 404 for ids not visible to the caller. (4) `GET /departments` `memberIds` has no ORDER BY (nondeterministic order). Also open: MR2 (tenant-id swap) and MR4 (forged-scope corpus ≥40), a third tenant, eval datasets and runs in the sweep, backups and the anchor file. | 4 | 3 | 5 | 12 |

| H22 | Two one-off browser-check transients on the batch 31–37 tree (integrator #5). (1) verify-all deep crawl: `/missions/M-126?tab=overview ERROR Failed to load resource: net::ERR_NETWORK_CHANGED` once; the deep crawl alone and a second full run passed. (2) demo fit-check 1366×768: `BAD /agents/coder-01?tab=performance mainOver 0 regions []` once (main not rendered after the fixed 600 ms wait); 3 re-runs of that route and 1280×760 ALL FIT. By the lessons a pass on re-run is a race: make the fit-check wait on a rendered-main condition instead of 600 ms, and have the deep crawl treat a browser network-change event as a retryable harness error (counted and reported, never silently dropped). | 3 | 5 | 5 | 13 |

| E1f | c84 follow-ups (review). (1) The pilot/holdout split is seeded by a hash of the four calibration counts, so independence is heuristic and a caller choosing counts could re-roll it: seed it by item ids or a stored per-dataset salt. (2) The point estimate uses the holdout half while the displayed sensitivity and specificity use all labels: make the display consistent. (3) One grid cell (θ 0.05, judge .7/.65, 100 items, 20+60 labels) stays at 88.1% on both seeds and is pinned. | 3 | 4 | 5 | 12 |

| M2c | c83 follow-ups. (1) The column scanner stops a FROM list at a sub-select, so a comma join after it (`from (select …) x, tasks t`) is not read; `extract(epoch from t.col)` will be flagged unresolved (fail-closed false positive). (2) The sample_ref existence check is unlocked (can race clearDemo) and ignores `missions.deleted_at`; `DELETE /missions/:id` by a person leaves labels. (3) Four re-pointed counters only "stay flat" when the primary is gamed; find counters that move opposite. (4) The UI's metric popover does not explain "weak counter-metric". | 2 | 4 | 5 | 11 |
