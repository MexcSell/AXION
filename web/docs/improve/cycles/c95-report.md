# c95 report: run budget and halt checker (R6-5, first slice)

Plain words: this is an engineering control, not evidence. Nothing executes yet: no agent runs, no model is called, no route, no migration, no web change. The research found no source that measures how well a kill switch or budget cap works, and this slice does not measure it either. It tests a pure function against scripted runaways.

## Commit order (the evidence that the bound came first)
1. `70aeb12` contracts: caps schema and the written stop bound (`RUN_STOP_BOUND`, with its comment).
2. `481caa5` fixture design with hand-derived `capSteps` and exact accepted counts, plus the interleaving counts. No checker, executor or run existed.
3. RED commit: fake executor and fixture tests against an always-continue stub: 64 failed, 4 passed (the 4 are tests that a stub can satisfy: the fixture-count check, the stage 0/1 no-caps case, and the negative control).
4. Checker and unit tests, GREEN.
5. This report.

## The bound (committed in step 1)
- A runaway is stopped after at most `capSteps + 1` accepted steps; steps are counted, never seconds. The checker counts the proposed step's own estimate before it runs, so the +1 only comes from an under-estimate or a step that began before the wall deadline.
- Zero accepted steps after a halt, measured when the step takes effect, not when it is admitted.
- Not covered: money or token overshoot inside the one extra step, late billing, real tools. "Zero after halt" relies on the check and the effect being one atomic action. The fake store models this; the slice does not build it (a later lane, with the halt-record table).

## Design choices (mirroring c45, which is unchanged)
- Fencing is equality with the current token, as `lease_token = $3` in the store, so a lower or higher token is stale. Halt is a flag only, like `requestCancel` on a leased job, and never touches the token. The two are tested independently.
- A stop is latched: the rate window empties after 60 s, so a stateless check would turn a stop into a retry. After a stop, `already_stopped`.
- Partial caps count as no caps (refused at stage 2 and 3). Present but NaN, negative or fractional values are `caps_invalid`. Unknown stage, malformed counters or steps are `bad_input`. A non-boolean halt flag is never read as "not halted".
- Time is an input; the module never reads a clock. Real enforcement must supply database `now()`.

## Threshold results
| Item | Result | Evidence |
|---|---|---|
| (a) 25+ runaways stopped at or before cap+1 | PASS | 29 sequential fixtures (8 loop, 6 repeated failure, 7 spend spike, 5 new origin per step, 3 call burst) plus 6 cap-race interleavings. Every fixture stopped at exactly its hand-derived accepted count; none hit the harness ceiling (2000, counted as FAIL). The two hidden-spike fixtures (the +1 case) accept the step that crosses the reserve and stop the next one. Later proposals, even 70 s later, all refused. |
| (b) zero accepted after a halt | PASS | Halt injected after 0, 1 and 2 accepted steps in all 29 sequential fixtures (87 runs): 0 accepted after halt. Interleavings: H3 630, H2 630, reclaim R2 30, cap race C2 6 = 1296, 0 violations. Negative control (a store that skips the re-check at commit) does accept steps after a halt, so the fixtures can fail; it is excluded from all counts. |
| (c) no-caps refusal at stage 2 and 3 | PASS | null, undefined, empty and partial caps refused as `caps_missing`; stage 0 and 1 continue. |
| Items 1-4 | PASS | contracts, checker, fake executor, 24 unit tests. |
| (d) cap change after approval needs a new approval | DEFERRED, not omitted | needs the approval digest version change, which the verifier ruled out of this slice. |
| Halt-record table | DEFERRED | its own lane; here halt is an input. |

No fixture spec needed correcting after the runs (no separate spec-fix commit).

## Tests
- New: `server/test/c95-run-caps.test.ts` (24) and `server/test/c95-run-caps-fixtures.test.ts` (68): 92 tests, all GREEN.
- tsc (server): clean. Web tsc: clean.
- Full serial run (`heavy.sh npx vitest run --maxWorkers=1 --no-file-parallelism`, load average 4.78 after it, 718 s): 176 files passed, 1 failed; 3711 tests passed, 1 failed, 36 skipped.
- The one failure, named: `test/c92-script-base.test.ts > c92 H23: script BASE resolution > no script hard-codes a live port default, and every script that needs a base uses the helper`; first error line `AssertionError: expected [ 'c82-pixel.mjs:7' ] to deeply equal []`. It scans `web/scripts/c82-pixel.mjs`, a file this lane did not touch (diff has no web change), so it comes from the base tree, not from c95. Not fixed here.

## Files changed
- `shared/contracts/src/run-caps.ts` (new), `shared/contracts/src/index.ts` (one export line)
- `server/src/jobs/run-caps.ts` (new)
- `server/test/c95/fixture-specs.ts`, `server/test/c95/fake-executor.ts`, `server/test/c95-run-caps.test.ts`, `server/test/c95-run-caps-fixtures.test.ts` (new)
- `web/docs/improve/cycles/c95-report.md`

## Concerns
- Rate limit stops the run rather than throttling it, as the brief says; a real executor may want a pause instead.
- The latch lives in the counters the caller carries, so a caller that drops counters drops the latch; the later halt-record table is the durable form.
- "Cap + 1" for wall time is by start time: a long step that starts before the deadline runs to its end.
