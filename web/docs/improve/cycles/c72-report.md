# c72 report: difficulty-adjusted skill ratings, no leaderboard (R3-7, with R3-1 folded in)

Lane w70, branch `c72-skill-ratings`, base `c852be8`. Ports 12090-12093, e2e DB `axion_e2e13`. **No migration was needed** (the task class and difficulty live inside the existing `delegation_briefs.brief` jsonb; the read model derives everything), so number 0054 is unused. One commit per item, nothing pushed.

**Read this first (what the numbers do and do not say).**
1. The primary simulation threshold passes **by construction**: A (easy only) and B (hard only) share no difficulty level, so the adjusted comparison refuses to compare in 100% of trials ("indistinguishable: no difficulty level in common"). That is the honest answer for such data, but it is not a demonstration that the method can separate skill from difficulty. The overlap cases below are where the adjustment does real work.
2. **An agent's own adjusted cell is not comparable with another agent's** unless their levels match. For an agent that only ever got easy tasks the adjusted cell is computed over those levels only, so it stays close to its raw rate. In the primary simulation the two own-level cells have non-overlapping intervals in about 97% of trials, i.e. a reader comparing two profiles by eye would still call A better. This is why every cell prints "levels used", the help says so, and the only comparison offered is the shared-levels one.
3. The simulation tests the estimator on a model the simulation defines (skill the same at every difficulty, additive on the logit scale). The estimator itself never uses the simulation's difficulty offsets (shown by the "difficulty effect x2" case), but the assumption that skill is level-independent is not tested by anything here.
4. The task class and the difficulty are set by the delegator, so a rating is gameable by relabelling. It is classified that way in c66's inventory and printed on the screen.
5. Fixture only: agents do not execute, so real cells are null (no data) until tasks run.

## Method (named)
**Direct standardisation to a fixed difficulty mix, with a Wilson interval on the effective sample size** (`shared/contracts/src/skills.ts`).
- Outcome: a finished (passed or failed) task of a visible mission, owned by the agent when it finished, with a brief to that agent that names **both** a task class and a difficulty 1 to 5. The label counted is that of the **first** brief the agent got for the task (a later brief cannot relabel a known outcome; tested). A task with only one of the two fields is "unrated": counted apart, in no cell. Simulated (DEMO) tasks are out unless `includeSimulated`.
- Per agent and class: counts per difficulty level. Raw rate = successes / n. Adjusted rate = the per-level rates re-weighted to the fixed reference mix (levels 1 to 5 equally), over the levels the agent has evidence for (named on every cell).
- Interval: variance of the weighted rate from per-level rates smoothed by half an observation, effective n = p(1-p)/variance (Kish), then the 95% Wilson score interval for (rate, effective n). With one level this is exactly the plain Wilson interval (tested).
- Comparison of two agents (`GET /agents/:id/skills/compare?with=`): only on levels both have evidence for; "distinguishable" when the two 95% intervals do not overlap, otherwise "indistinguishable". No shared level, or fewer than 5 outcomes each on the shared levels, is "indistinguishable" with the reason. No direction, no rank, no score.
- Cells under n = 5 are null ("not enough evidence (n of 5)").
- **Pair ratings (agent with a human) are not built.** Nothing recorded says that a person worked with an agent on a task: a brief names who delegated (not who collaborated) and a review comes after the work. The API says so (`pairRatings.built = false` with the reason) and so does the screen.

## What was built
| Item | What |
|---|---|
| 1 | Optional `taskClass` (8-value enum, plain-words labels) and `difficulty` (1 to 5) on `DelegationBriefIn`; contract types and validators; two new inventory fields `delegation_briefs.task_class` and `delegation_briefs.difficulty` (agent-writable through `createBrief`, derived, not typed); `SKILL_RATING_INPUTS` + `skillRatingDependsText()` in the registry file (the "ratings depend on them" note, with the gameable flag derived from the inventory) |
| 2 | `server/src/agents/skills.ts` (loader + vector), shared pure estimator, `GET /agents/:id/skills` and `GET /agents/:id/skills/compare`, contract entries, validators and coverage calls |
| 3 | `server/test/c72-no-ranking.test.ts` + `server/test/contracts/no-ranking.ts` |
| 4 | `server/test/c72-skill-sim.test.ts` (seeded simulation) |
| 5 | `SkillVector` panel on the Performance tab (fixed class order, n, interval bar, levels used, "not enough evidence", comparison picker, `?` help, DEMO fixture through the same estimator), Task class and Difficulty selects in the Delegate / reassign dialog with a `?`, brief card chip, `api-c72.mjs`, e2e fixture harness `server/src/cli/e2e-skill-fixture.ts` (declared as a write site in the inventory) |

## RED / GREEN evidence
| Item | RED (before the code; first error line) | GREEN |
|---|---|---|
| 1 | `c72-brief-fields.test.ts` on the unchanged code: 4 failed, 1 passed. API test: `The brief is not valid: _ Unrecognized keys: "taskClass", "difficulty"` (expected 400 to be 201); the other three failed on the missing exports | 5/5; `delegation-brief`, `c66-*`, `contracts` still pass |
| 2 | `c72-skill-model.test.ts`: `Cannot find module '../src/agents/skills.ts'`; contracts inventory: `GET /agents/:id/skills: registered but has neither a contract entry nor an explicit exclusion` (and `/skills/compare`) | model 9/9 then 11/11, contracts 6/6 |
| 2b (fix) | "a brief that supersedes the first one after the task finished does not change its label": `expected [ 1, 5 ] to deeply equal [ 5 ]` (the newest brief was used) | fixed by taking the first brief; 11/11 |
| 3 | A guard has no product behaviour to fail on, so RED is by proof: the self-tests seed violations (a `rank` key, a sorted list, a sort by a rating) and are reported; and a **mutation of the real code** (`skills.ts` sorting the classes by value and `compareSkills` returning `rank: 1`) made the test fail with `$.compare.rank names a rank, score or direction` and the source scan; reverted | 8/8 |
| 4 | RED proof inside the test: the same threshold fails for a method that does not adjust (raw rule as the adjusted one: distinguishable in about 97% of trials, bar 10%) | 9/9 |
| 5 | `api-c72.mjs` with the panel removed from the Profile (temporary mutation, reverted): `FAIL dark: the skill vector shows 8 rows` then a locator timeout | `api-c72` 100% PASS (see below) |

## Measured simulation rates (item 4)
Fixed before any trial: one class; success probability = inverse-logit(skill - DELTA[level]), DELTA = [-1.5, -0.75, 0, 0.75, 1.5]; equal true skill 0.3; A gets only levels 1 and 2, B only levels 4 and 5, 40 tasks each; 1,000 seeded trials (`mulberry32(seed + trial)`). "Raw calls A better" = the raw 95% Wilson intervals do not overlap and A's rate is higher. "Adjusted calls them distinguishable" = `compareSkill`. Seeds: design **720001**, fresh **9720101** (written into the test file before the first run).

| Case | seed | raw calls A better | adjusted distinguishable | skipped: no shared level / under 5 shared / overlap | own-level cells apart (not a valid comparison) |
|---|---|---|---|---|---|
| **Primary** (disjoint easy vs hard, n 40) | 720001 | **97.2%** (need >= 90) | **0.0%** (need <= 10) | 100.0% / 0.0% / 0.0% | 97.4% |
| **Primary** | 9720101 | **97.1%** | **0.0%** | 100.0% / 0.0% / 0.0% | 97.1% |
| Overlap, equal skill (A mix .4/.3/.2/.1/0, B mix 0/.1/.2/.3/.4, n 60) | 720001 | 79.6% | 0.9% | 0% / 0% / 99.1% | 11.3% |
| Overlap, equal skill | 9720101 | 78.3% | 0.6% | 0% / 0% / 99.4% | 8.8% |
| Overlap, equal skill, difficulty effect doubled | 720001 | 99.6% | 0.4% | 0% / 0% / 99.6% | 37.2% |
| Overlap, equal skill, difficulty effect doubled | 9720101 | 99.6% | 0.6% | 0% / 0% / 99.4% | 33.1% |
| Overlap, true gap 1.0 logit (power) | 720001 / 9720101 | n/a | **14.7% / 16.5%** | | |
| Overlap, true gap 2.0 logit (power) | 720001 / 9720101 | n/a | 52.3% / 58.7% | | |

Findings in plain words: the threshold is met on both seeds. The adjusted comparison does not mistake difficulty for skill (false-positive 0.4% to 0.9% where the raw rule is wrong 78% to 99.6% of the time). But **power is low**: interval overlap on shared levels finds a real gap of 1.0 logit (about 0.2 in pass probability) in only 15% to 17% of trials at 60 tasks each. I first wrote the power case as "asserted above 50%", it measured 14.7% and 16.5%, so that claim was dropped and the number is reported. Interval coverage of the adjusted rate was **not** measured and is not claimed.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| 1. Brief fields, test-first, own commit; both classified in the writability inventory; registry note; contract entries | PASS | `c72-brief-fields` 5/5; `INPUT_FIELDS` has both, `createBrief` and the e2e harnesses declare them, `writabilityOf` says agent-writable; `SKILL_RATING_INPUTS` and `skillRatingDependsText()`; validator `taskClass`/`difficulty`, coverage call posts both; c66 scan unchanged and green |
| 2. Read model: vector over classes, adjusted + interval, named method, null under 5, pair ratings | PASS (pair ratings: not built, stated) | `c72-skill-model` 11/11; cells null at n 4 and filled at n 5; reassign-with-brief stores class and difficulty; pair ratings not buildable from the data, said in the API and on screen |
| 3. No leaderboard: only "distinguishable"/"indistinguishable"; a contract test that fails if any response sorts agents by the rating | PASS | `c72-no-ranking` 8/8: key scan, order scan over 10 sweep routes plus per-agent routes (exact route set asserted), source scan of all skill files (exact file list asserted), RED proofs and a mutation run. Limit: the order scan covers the routes listed in the test and any array of agent ids in them, not every route |
| 4. Simulation: raw >= 90% and adjusted <= 10% of 1,000 trials; second seed fixed before running | PASS on the wording; holds by construction | 97.2% / 0.0% (seed 720001), 97.1% / 0.0% (seed 9720101); every primary trial is a "no shared level" refusal (see "Read this first" 1 and 2) |
| 5. UI: Performance tab shows n, interval, "not enough evidence" below 5; no rank or position; fits 1366x768 demo and api; `?`; icons | PASS | `api-c72` 44 PASS, 0 FAIL (final re-run after a CSS column-width tweak) in dark and light (fit, `?`, fixed order, ban-word scan of the panel text, comparison chips); fit-check demo and api below |
| Full vitest and tsc | PASS | server tsc clean; web tsc clean; full vitest in parallel (no serial fallback needed): 132 files, 3159 tests passed. (One earlier full run had 1 failure, `c66-writability > every insert/update/delete on an input table ... is a declared site`, because I added the e2e fixture CLI while that run was in progress, before declaring it; re-run clean) |
| api-c72 (incl. the no-ordering check), api-c42, api-c66, api-stage6 | PASS | api-c72 ok (44 PASS, 0 FAIL), api-c42 16/16, api-c66 26/26, api-stage6 94/94, no page errors in each |
| verify-all 10/10 | PASS | `ALL 10 STEPS PASSED` (own OUT `/tmp/axion-verify-w70`, dev server 12090); dialog smoke 130 checks 0 failures |
| fit-check demo and api | PASS | demo 1366x768 `ALL FIT`; api `DATA_MODE=api node scripts/fit-check.mjs 1366 768` through api-e2e.sh on 12092/12093 `ALL FIT` (the Profile's Performance tab included) |
| a11y both modes | PASS | demo 52 views, 65 dialogs, 0 violations; api 42 views, 65 dialogs, 0 violations |
| api-mobile | PASS | 343 states, 222 dialogs measured, `NO FAILURES` (small-tap notes only, none new in c72 files) |
| Migrate down/up 0054 once | NOT APPLICABLE | no migration was added. The e2e harness does `migrate down 0` then `up` of every migration on each start (each api run above), and passed |

## Files changed
Server: `src/agents/skills.ts`, `src/agents/routes.ts`, `src/delegation/brief.ts`, `src/cli/e2e-skill-fixture.ts` (new harness). Shared: `contracts/src/skills.ts` (new), `delegation.ts`, `index.ts`, `metric-guard.ts`, `metric-registry.ts`. Tests: `c72-brief-fields`, `c72-skill-model`, `c72-no-ranking`, `c72-skill-sim` (new), `contracts/no-ranking.ts` (new), `contracts/coverage.test.ts`, `registry.ts`, `validators.ts`. Web: `src/features/agents/SkillVector.tsx`, `src/api/agentSkills.ts`, `src/data/skillDemo.ts`, `src/help/pages/c72-skills.ts`, `src/theme/pages/c72-skills.css` (new); `src/pages/AgentProfile.tsx`, `src/dialogs/defs/missions.tsx`, `src/features/mission/DelegationBriefCard.tsx`; `scripts/api-c72.mjs` (new). Screenshots: `web/docs/screenshots/improve-c72-performance-dark.png`, `-light.png` (comparison open, 1366x768) and `improve-c72-handoff-dialog-dark.png`.

## Concerns
1. **The primary threshold is met by a refusal, not by adjustment** (see "Read this first"). The overlapping cases show the method does remove the difficulty confound there (0.4% to 0.9% false positives against 78% to 99.6% for the raw rule), but the data that would make the adjustment matter most (agents with disjoint difficulty bands) is exactly where nothing can be said.
2. **Low power.** Interval overlap finds a gap of 1.0 logit in 15% to 17% of trials at n = 60 per agent. A difference test would be stronger; the brief asked for overlap, so it was kept and the number reported.
3. **Own-level adjusted cells mislead if compared by eye** (97% apart in the primary case). Mitigated by the "levels used" chip, the footer and the help, not removed.
4. **Gameable inputs.** Class and difficulty are set by the delegator (a person or an agent through `createBrief`). A rating moves if tasks are relabelled. Shown on screen and derived in the inventory; no defence beyond "first brief counts".
5. **First brief counts.** A task whose first brief to the owner has no class or difficulty stays unrated even if a later brief adds them (conservative, tested one way). Tasks handed to a new owner without a new brief are not counted for that owner.
6. **Reassign brief dialog** only offers the two fields in api mode; briefs created by the staffing simulator carry neither, so DEMO staffing produces no rated outcomes. Real cells stay null until agents execute, as the brief expects.
7. The order scan in `c72-no-ranking` only checks the routes it lists. A new route that carried ratings would be caught by the "only the skill routes carry a rating" check only if it is added to that sweep; the contract coverage test makes sure a new route has an entry but not that it is swept here.
8. The demo fixture (`skillDemo.ts`) is made-up data through the real estimator and is tagged DEMO; the Profile's other Performance panels are older demo fixtures.
9. Window: the vector covers all recorded time (the evidence line says so); the reliability uses 90 days. A window can be added when there is data worth windowing.
