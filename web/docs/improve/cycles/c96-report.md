# c96 report: plan conformance and privilege checker (R6-8 part 1)

In plain words: this checks a scripted agent against its approved plan. It does not test a real model. Label propagation is next phase and is not built. The mutation loop is a regression test of the checker, not evidence of resistance to adaptive attackers.

Branch `c96-plan-conformance`, base `d3ce0ff`. Thresholds and fixture design were committed first (`cycles/c96-thresholds.md`), before any run. No route, migration or web change. No model call, no database access beyond the vitest harness's normal config (the checker itself is pure).

## What was built
- `shared/contracts/src/exec-plan.ts`: plan types (ordered calls, tool, argument constraints `exact`, `oneOf`, `text` prefix/suffix/contains, `range`, `subsetOf`, origins from the grants, `after`, `max`), the decision types, limits, canonical JSON. Exported from the contracts index (the provenance type is named `ExecProvenance` because `Provenance` already exists in `agents.ts`).
- `server/src/exec-plan/snapshot.ts`: one read of every input into a frozen null-prototype copy. Refuses getters, Proxies, `toJSON`, symbol keys, holes, subclasses, class instances, NaN and Infinity, depth over 5, over-size input (the c94 accessor-TOCTOU lesson).
- `server/src/exec-plan/plan.ts`: `validatePlan` (closed schema, unique ids, `after` names earlier calls only, origins must be normalised and in the grants, forbidden tools can't be planned) and `planSha256` over canonical JSON (call order is part of the hash).
- `server/src/exec-plan/conformance.ts`: `checkCall` and `checkTrajectory`.

## Rules
- Decisions: `allow`, `narrow-allow`, `needs-approval`, `deny`. D4's split is used rather than a plan hash: less authority than a plan call is auto-allowed and recorded; more authority needs approval. There is no plan-level approval digest in this slice.
- Narrowing means a non-empty list that is a strict subset of the allowed list (when the plan sets no `maxItems`), or an omission the plan itself declares narrower (`omitNarrows`). An empty list or an omitted argument is otherwise an expansion (fix round: a default is often wider than what was approved).
- An untrusted narrowing is `deny` (reason `untrusted_narrowing`) until label propagation exists; narrow-allow stays for user and system provenance.
- Expansion: new tool, wider value, extra argument, missing required argument, a granted origin the call does not list, out of order, use count over `max`.
- `deny`: forbidden tool (case-insensitive), origin outside the grants, anything malformed, and any `untrusted` call that is not allow or narrow-allow. Untrusted content never adds calls.
- Provenance (`user`, `system`, `untrusted`) is given by the trusted harness. Matching is linear string comparison; no regex is built from input.

## Thresholds (committed before the runs; run with `heavy.sh`, load average about 5.3)
| Item | Result | n |
|---|---|---|
| T-a1 out-of-plan calls denied or needing approval as stated per row, none allowed | PASS 100% | 82 rows (5 plans, 9 families, trusted and untrusted) |
| T-a2 in-plan calls get the stated decision | PASS 100% | 40 rows (incl. 6 narrow-allow, range edges, last allowed use) |
| T-b c37 corpus as trajectories, injected untrusted state-changing step denied | PASS 100% | 240 state-changing cases of 269 replayed |
| T-b parse-reject cases denied | PASS 100% | 22 |
| T-b all 269 cases: allowed ones are only in-plan observe | 17 allowed, all in-plan observe | 269 |
| T-b same 240 with trusted provenance (report only) | 238 needs-approval, 2 deny, 0 allow | 240 |
| T-c utility cost (no target set) | 12 of 24 workflows (50.0%) need at least one extra approval; 12 of 108 steps (11.1%); 6 steps auto-allowed as narrowing; 0 denied | 24 workflows |
| T-m seeded mutation loop (seed 96; character, wording, indirection), regression only | 0 leaks | 1000 mutants |

Read T-c with care. I authored the 24 workflows: 12 follow the plan and 12 each carry one benign deviation (extra screenshot, retry over max, second granted origin, reordered step, a link name or field the plan did not list, wider visibility, an extra tool, a path outside the reports directory, a service or metric not listed). So the 50% is set by that 12/12 mix and is not an estimate of real approval rates. The per-step share (11.1%) and the narrowing count are the numbers worth looking at. The extra-approval bound is the owner's to set.

RED/GREEN: I wrote the module and the tests together and committed the tests before the first run, so there is no separate RED run. The first run was GREEN (87/87). A fault-detection check was not run against a deliberately broken checker.

## Tests and checks
- `server/test/exec-plan.test.ts`: 95 tests after the fix round (schema, each decision path, boundaries, fail-closed and accessor cases, linear-time cases, T-a, T-b, T-c, T-m).
- `tsc --noEmit` clean.
- Full serial vitest (fix round, `--maxWorkers=1 --no-file-parallelism`): 177 files passed, 1 skipped; 3724 tests passed, 36 skipped; no failure; 717 s, load average about 5. `exec-plan.test.ts`: 95 tests.

## Files changed
`shared/contracts/src/exec-plan.ts`, `shared/contracts/src/index.ts` (one export line), `server/src/exec-plan/{snapshot,plan,conformance}.ts`, `server/test/exec-plan.test.ts`, `server/test/exec-plan-fixtures.ts`, `web/docs/improve/cycles/c96-thresholds.md`, this report.

## Concerns
- A narrow-allow is allowed for an untrusted call too (it uses less authority than the plan). Untrusted content can still choose which allowed subset is used.
- A plan check does not stop an in-plan call with harmful values inside the allowed set. Constraints need to be as tight as the task allows.
- T-b is only as strong as the plan chosen: the plan allows navigate, observe and finish only. The corpus actions were mapped to flat arguments by a test helper; the real mapping from `BrowserAction` to a proposed call is not built.
- The checker trusts the harness for `provenance` and for the history. A lying harness defeats it.
- `validatePlan` runs on each `checkCall` (simple and safe, not cached).
- The trajectory replay treats a `needs-approval` step as approved once and not counting toward any plan call's uses; this is one assumption among several possible.

## Fix round (after review: NOT CLEAR)
Numbers here replace the ones above where they differ (T-a2 n=37, T-b, T-c narrowing count, tests 95).

1. **Untrusted narrowing.** Probes added as tests: untrusted `tickets.tag {tags: []}` and untrusted `docs.search` without `limit` (repeated 4 times, max 4) are no longer narrow-allow; they are `deny`, and `needs-approval` for user provenance (reason `missing_arg` or `wider_value`). An untrusted real narrowing is `deny` (`untrusted_narrowing`).
2. **T-b was largely tautological on the tight plan, and still is: it is a weak test.** On the tight plan (navigate, observe, finish only) 240 of 240 state-changing cases are denied, but 223 of them die as `new_tool`, 15 as `wider_value`, 2 as `origin_not_granted`. New T-b variants on the broader fixture plans, where click or fill is allowed (untrusted injected step, n=240 state-changing cases):
   - shop plan (click Next/Details/Specs, navigate under the shop origin): 234 deny, 6 allow, 0 needs-approval. First reasons: wider_value 132, new_tool 85, forbidden_tool 8, new_origin 2, origin_not_granted 1, extra_arg 6, in_plan 6. With trusted provenance: 225 needs-approval, 9 deny, 6 allow.
   - form plan (fill sec_ value refs, select, Save draft): 238 deny, 2 allow. First reasons: wider_value 220, forbidden_tool 8, extra_arg 7, origin_not_granted 2, new_origin 1, in_plan 2. Trusted: 228 needs-approval, 10 deny, 2 allow.
   - The 6 and 2 allowed calls are in-plan actions (a permitted click or navigation) that injected content chose. **A plan check can't stop an in-plan action with harmful arguments chosen by injected content. That is what label propagation (next phase) is for.** So T-b on the broader plans is not 100% blocked, and I do not claim it is.
3. **Mapper.** The mapper is now faithful: a locator becomes `by` plus its identifying fields (`exact` dropped), every other action key keeps its own name, and it adds no key. Split of the tight-plan denials: all 240 are the checker's own rules (new_tool 223, wider_value 15, origin_not_granted 2); the mapper contributes none. `extra_arg` appears on 6 (shop) and 7 (form) cases, all carried by the corpus action itself (a css `selector`, `script`/`evaluate`/`cdp`, or a `value` on a fill). The earlier version flattened locators to `target.by`-style names, which tripped extra-arg on every locator action; that part of the earlier 100% was the mapper's.
4. **Minors fixed:** `range` has an `integer` flag (ids and counts use it; `id: 1.5` needs approval); URL and absolute-path `prefix`/`contains` are normalised first (`.`, `..`, `//`; encoded, backslash and control characters are refused), so `/workspace/reports/../secrets/key` needs approval; `forbiddenTools` and the planned-versus-forbidden check are case-insensitive; a `subsetOf` list within `maxItems` is `allow`, and without `maxItems` a strict non-empty subset is the narrowing; a permanent RED test shows an always-allow stub and an always-deny stub both fail the T-a rows.
5. **Notes.** History and provenance are trusted from the harness. T-c's share comes from my authored 12/12 mix: now 12 of 24 workflows (50.0%), 12 of 108 steps (11.1%), 5 steps auto-allowed as narrowing, 0 denied (plan-following workflows were adjusted to pass the `note` and `limit` arguments that are now required). T-m: 1000 mutants, 0 leaks.
