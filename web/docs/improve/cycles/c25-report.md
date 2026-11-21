# Cycle 25 report (lane w23): test hygiene and small web fixes

Branch `c25-test-hygiene` (base f169636). Worker note: the first worker stopped on a sign-in error; this run reviewed its
uncommitted diff, kept all of it, and finished verification.

## Before -> after
| Item | Before | After |
|---|---|---|
| Fixed sleeps in api scripts (`api-*.mjs`, `_session.mjs`) | 28 | 4, all ABSENCE waits (asserting something never happens), each commented |
| Fixed sleeps in all other `scripts/*.mjs` (demo-mode, gallery, perf, crawl) | 53 | 52, LISTED, not converted (see below) |
| Over-broad assertions (api-improve.mjs `locator('button')` count, `/coverage\|latency\|tokens/i` ban) | 2 | 0: narrowed to `DECISION_BUTTON` + no "Decision note" field, and `inventedNumbers()` (percentages, or a number beside coverage/latency/tokens) |
| Lane-database guards | 1 inline regex copy in api-improve.mjs (the only one found), others unguarded | 1 shared `requireE2eDatabase()` / `isE2eDatabaseUrl()` in `_session.mjs` (accepts `axion_e2e`, `axion_e2e<N>`) |
| "Help: Help" `?` label before registry loads | shown | "Help: this topic" |

`settle()` no longer sleeps: it waits for the nav and live badge, then `calm()` (all finite animations finished + 2 painted frames, capped 3 s).

## Narrowed assertions: forced-failure proof (PROCESS.md)
`web/scripts/selftest-guards.mjs` (no browser/server/DB): 27 PASS, 0 FAIL. It proves each guard still fails on its defect:
- database guard refuses `axion`, `axion_lane_disabled`, `axion_e2e_x`, `.../axion_e2e23/other`, empty, undefined; accepts the three e2e forms;
- `inventedNumbers` flags `coverage +3%`, `12 %`, `latency -12`, `tokens: 4000`, `coverage 3`, `0.5%`; allows "Skill coverage is checked in the dry run", "No tokens were used";
- `DECISION_BUTTON` matches Approve/Reject/Withdraw, not "Show details", "Approved", "Copy id".
Narrowing is bounded: members still see zero decision buttons and no note field; any percentage still fails.

## Web minors (stage6-ledger / cycle 4 review)
- Fixed: `?` label; stale scroll anchor during slow older-page load (anchor re-captured while `loadingOlder` and the person keeps scrolling); dead code `featuredAgents` and `threadMessages` removed (tsc clean).
- Already handled in code, no change: `fetchPart` and `loadOlder` 404 call `confirmMissionGone`.
- Not duplicated in src (single definition `HUMAN` in missionControl.ts; remaining `'human:owner'` literals are in demo fixtures and one dialog): left.
- LISTED, not fixed: thread count drift on replays (corrected on reconnect; needs a server-side count or replay dedupe, not safe as a small change); no unit tests for upsert/laterStatus/onMissionControlEvent.

## Fixed sleeps left (listed)
Api scripts, justified absence waits: api-flows.mjs:67 (800 ms, B must not see A's private mission), api-stage6.mjs (3500 ms no agent reply, 2500 ms nothing ticks, 4500 ms no simulated GM reply).
Demo-mode / tooling scripts (52, not converted, demo-mode suite only, no flake observed, converting them blind risks the green demo suite): flows.mjs 25, gallery 4, u1-shots 4, u1-flows 3, shot-c07 3, perf-nav 2, first-load 2, dialog-smoke 2, auth-flow 2, crawl, crawl-deep, fit-check, ov-fit, shot 1 each. Several are timed measurements (first-load, perf-nav, gallery 7500 ms for a staged run), which must stay.

## Verification (lane w23, ports 7392/7393/7390, db axion_e2e23)
- `tsc --noEmit` web: clean.
- api-improve 83/83, api-flows 23/23, api-narrow pass (no overflow), api-auth-flow 15/15, api-c05 31/31, api-shots ran; api-stage6 34/35, the one FAIL being the known `page.reload` 30 s stall ("script ran to the end — TimeoutError: page.reload").
- api-offline.mjs belongs to `api-offline.sh` (needs no API running); it was invoked through api-e2e.sh by mistake and timed out on the missing "offline demo" button: harness misuse, not a regression. See below for its proper run.
- verify-all (full run, exit 0): build OK; route x tab crawl 77 views NO PROBLEMS; deep crawl no problems; auth flow, u1 flows pass; dialog smoke 110 checks 0 failures; dialog ids, help keys, fs guard OK. Grepped FAIL lines: exactly one, in flows.mjs, "Hierarchy: click agent -> conversation pane did not switch" (the exit code was 0 despite it, as w19 found).
- That FAIL is a pre-existing timing flake, not caused by this cycle: the step clicked a node, slept a fixed 500 ms, then checked the pane (it failed 2 of 3 runs on a machine running ~100 browsers). Fixed by replacing the sleep with a condition wait (the check itself is unchanged: pane must show Tester-01 and a Superior counterpart, within 8 s). After the fix flows.mjs passed 2 of 2 runs (21 PASS, no FAIL). Forced-failure proof of the narrowing: the wait still returns false (and the step fails) when the element never appears, since `waitFor` times out into `false`.
- The `waitForTimeout` count in flows.mjs is therefore 25, not 26 (total listed 52).

## Files
web/scripts/_session.mjs, api-flows, api-improve, api-narrow, api-offline, api-shots, api-stage6, selftest-guards (new); web/src/components/ui/HelpTrigger.tsx, features/chat/ChatView.tsx, data/agents.ts, store/data.ts.

## Concerns
- verify-all exit code untrusted (w19); result below is from grepping FAIL lines.
- No UI screenshots: the only visible change is a tooltip/aria label before help loads.
