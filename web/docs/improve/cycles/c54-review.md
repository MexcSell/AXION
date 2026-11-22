# c54 review (lane w53, branch c54-clock-dimensions, bfe891e..4f83abf)

Verdict: CLEAR AFTER FIXES (no blocker; 3 should-fix, 6 minor).

## What I ran (worktree /home/luca/AXION-w53, ports 10390/10392/10393, real DB untouched, worktree left clean)
- server `tsc --noEmit`: exit 0.
- vitest, targeted (clock-bounds, dimensions*, approval*, reviews, failure, departments, scorecard), serial (`--maxWorkers=1 --no-file-parallelism`, via heavy.sh): 16 files, 248/248 pass, no connection errors.
- fit-check at 1366x768 (vite dev on 10390, real fonts, ONLY=operations): ALL FIT, `/operations?tab=agents&sub=dimensions` mainOver 0.
- api-c46 via api-e2e.sh (10392/10393): 33/33 pass, EXIT 0.
- Own Playwright probe (scratchpad measure.mjs, zoom.mjs) for tab overflow, cell clipping, 390 px.
- I did not rerun the full vitest, verify-all, a11y or api-mobile; the report's claims for those are unverified by me.

## 1. H11
Verified OK:
- Scorecard, throughput, departments, failure-modes, dimensions each run in one `tx`; window end is `dbNow` (`now()`), SQL bounds are `<= now()` / `now() - interval` (routes.ts:30-35, 58-76; departments-routes.ts:21-24; failures/service.ts:107; dimensions-routes.ts). No JS Date from the DB is a SQL bound any more. `windowOf(w, now)` requires `now` (scorecard.ts:36).
- Edge convention (clock.ts header): current = closed [to-N, to] in ms, previous ends 1 ms before. Placement is done in JS on the ms-truncated row time (pg Date), SQL only loads a superset. I checked the superset arithmetic: dimensions `sinceMs = 2*len + 2` covers prevFrom = truncNow - 2len - 1 because truncNow > now - 1 ms, so no row at a boundary microsecond is lost, and a row with created_at in (truncNow, now()] places at ms == to (inside). No gap or overlap at microsecond precision for the JS-placed routes.
- `requestApproval` takes `at/created/expires` from one SQL statement (service.ts:50-52). Expiry elsewhere already compares by DB (`db_expired`, `expires_at <= now()` at service.ts:89,96,120,135,155,159; routes.ts:20,23,35,55); `Date.now()` is only the fallback when `db_expired` is absent. Consistent.
- `independence()`: `current: boolean` required (reviews.ts:96); both callers (153, 179) take it from `ownerHistory`, which computes it; empty/false is refused (fail closed). Test covers the missing `current` case (cast to any, so tsc would also catch it).
- Grep of server/src for `new Date()`, `Date.now()`, `toISOString()` near queries: no remaining app-clock SQL bound other than the lane's H11b list.

Findings:
- [should-fix] Mixed convention in failure-modes: `failures/service.ts:107` uses `created_at > now() - len` (open lower bound, microsecond SQL) while the header and every other route say closed [from, to] in ms. A tag at created_at = X.2 ms - len (now = X.7) is in the closed-ms window for dimensions but excluded here. At most a sub-ms boundary difference (probability about 1e-9 per row), but it is the one place that contradicts the stated convention, and failure-modes is placed in SQL (no JS re-placement), so it is the real bound. Fix: `>= now() - (len+1) ms`-style or document the exception in clock.ts.
- [should-fix] H11b misses the write side of grants: `grants/routes.ts:85` stores `issued_at`/`expires_at` from `new Date(now)` (app clock, lines 47, 66), while dimensions (`least(coalesce(revoked_at, expires_at), expires_at) >= now() - ...`) and enforcement compare by DB `now()`. The lane lists only "Date.now() expiry comparison". Same class as the c54 approvals fix; add to H11b explicitly.
- [minor] No test at the microsecond boundary. The clock tests skew only the app clock back 1 h (sound for catching `new Date()` bounds: fake `Date` only, rows use DB `now()`, pg timers not faked), but they never insert a row at sub-ms offset from `now()` or ahead-skew. Detection of a future regression back to JS Date round-trip relies on f5e2d01's 150-iteration test, which still exists for dimensions only. Suggest a looped test for scorecard and failure-modes.
- [minor] `requestApproval` now gives every approval created in one transaction the same `created_at` (now()), so `order by a.created_at desc` (approvals/routes.ts:24) ties for demo seeding (seed/demo.ts uses `createdAgoMin` variants but identical offsets collide). Add `id` as a tiebreaker.
- [minor] Scorecard/throughput/departments run in default READ COMMITTED (dimensions uses REPEATABLE READ). Each statement can see a different snapshot; the clock is shared, the data snapshot is not. Not a bound bug.

## 2. M1c
- `stale` comes from `STALE_BEFORE_SQL('r')`, the same expression the task page uses (reviews.ts:72-74, 180); `!r.stale` added to the `ok` filter (dimensions.ts:129); stale reviews stay in n. Route test (dimensions-freshness) asserts the task page says F2 and R unverified and the cell is 2/3; unit test covers it too. Both pass.
- Fixture/seed binding `attempt_id` to the latest attempt is faithful: the review route does exactly `select id from task_attempts ... order by attempt_no desc limit 1` (reviews.ts:157). It does not hide a real case: an unbound review (attempt_id null) on a task that has attempts is stale under `coalesce(...,0) < la.attempt_no`, so the old unbound fixture was in fact the stale shape; tasks without attempts are never stale. Real unbound rows could only be pre-c51 legacy rows and they are stale on both views, so cell and page still agree.
- [minor] Only `cognitive.first_attempt_verified` consumes `stale`. `collective` cross-family review count does not, which is right (it counts reviews done, not verification), but say so in the help.

## 3. M1b(1) verdict_outcomes
- Read-only: the route is `read only` REPEATABLE READ and a test snapshots eval_runs/results/proposals before and after. Pass.
- n >= 3 via `count(...)` with MIN_N, state `none` with n otherwise; value = number of evaluated proposals, never a score; evidence "X verified better, Y inconclusive, Z worse". Tests pass.
- Placement by `max(finished_at)` of the proposal's runs; outcome is the current verdict, not as of the window end. Help (c46-dimensions.ts:41) says "recomputed from the stored runs every time you look" and "have a finished evaluation run in the window", which is not explicit.
  - [should-fix, wording] Say plainly: "a proposal is placed in the window of its newest finished run; a later run moves it, and an earlier window's count can change afterwards; outcomes are today's verdicts, not those at the window end." Same for the evidence string in dimensions.ts.
- [minor, perf] `loadEvaluations` is N+1 (about 5 queries per proposal incl. case hashing) over every tenant proposal with a finished run, on every dimensions read, inside the one REPEATABLE READ transaction. Fine now; will grow. Cache or cap later.
- Visibility: tenant-wide for any signed-in user (same as proposals; test asserts a member sees it). Acceptable, stated.
- Merge interactions for the integrator (c53 eval-integrity, c61 eval-instruments both touch `loadEvaluations`/verdicts; `EvalOutcome` stays 'verified_better'|'inconclusive'|'worse' in both and in contract agents.ts:104, so the mapping in dimensions-routes.ts still compiles):
  1. `proposal-evidence.ts` will conflict textually only if c54 edits it; c54 does not edit it (it imports `loadEvaluations`). The conflict is c53 vs c61 themselves.
  2. Signature: c61 adds `grader_name/version` columns and a regrade path inside `loadEvaluations`; confirm `props` rows c54 passes (`id, agent_id, created_by, base_version_id, candidate`) still satisfy `EvidenceSubject`. Run tsc after merge.
  3. Counts will shift with no stored-data change: c53 (vendor-label refusals, overlap rule, runCount over same config) and c61 (grader mismatch, insufficient-grading, dataset validity) turn more proposals into `inconclusive`. dimensions-verdicts.test.ts expects "1 better, 1 inconclusive, 1 worse" from specific fixtures (HO1/HO2/DEV, evaluator = 'bea', judge 'gemini-judge', candidate model qwen-72b): re-run it after merging c53 (`candidate_family_unknown`/`judge_label_unknown` may refuse these fixtures) and c61 (addRun fixtures may need grader name/version or attestation, else everything reads inconclusive/refused).
  4. `eval-fixtures.ts` `addRun` is shared by the c54 test; if c53/c61 change it, the c54 test changes with it.
  5. Verdict cell read time grows with c61's extra regrade/validity queries (N+1 above).
  6. c61 adds DTO fields in shared/contracts agents.ts; c54 changes no contract, so no contract conflict, but the contract registry test must be re-run after the merge.
  7. Help/evidence wording on "recomputed every time" becomes more important once c61 can change an outcome through a re-grade.

## 4. UI (M1b(2))
- Tab: Agents > Dimensions in System Operations, `?tab=agents&sub=dimensions`, Layers icon, TAB_NOTE, shared Panel with `?` on the panel, department, window, cell, and each of the six rows (api-c46: "9/9" popovers). Registered in `nav.ts` ROUTE_TABS and `TAB_ICONS` in matching order (9 each).
- Overview scorecard button (CommandCenter.tsx:95), Overview Company Health sample button (:147) and Agents > Departments button (ServerDepartments.tsx:47) all `nav('/operations?tab=agents&sub=dimensions')`; api-c46 clicks Overview and Departments and checks the URL and no `[aria-modal]`: pass. Demo mode renders the tab with sample cells and a DEMO tag (my screenshot).
- Fit 1366x768 with real fonts: fits, tab row 1296 right edge vs 1337 clip (about 39 px spare in demo with "Development (13)"; the report says about 30). api-c46 also records noteBottom 687 < 768.
- 9th tab clipped with fallback fonts: reproduced (fonts blocked: last tab right 1397 vs strip 1337, 60 px). `.tabs` is `overflow-x:auto` with hidden scrollbar (base.css:287), so the tab stays reachable by scroll and by arrow/End keys (roving focus), nothing is cut off functionally. Fonts are bundled via @fontsource (main.tsx), so real users get Inter; the clip is an e2e-server artifact.
  - [should-fix, cheap] The margin is thin and invisible when it fails (hidden scrollbar, no fade edge), and api mode will show larger counts in "Development (n)". Give the strip a right fade or let the strip collapse unselected tabs to icons (the existing `collapse` prop, already used elsewhere), or shorten "Live Instances". Not a blocker.
- Cells: 34 px with 2-line content. Measured `scrollHeight` 36-37 vs 34 in 10 of 18 demo cells, `overflow:hidden`, `justify-content:center`: about 1.5 px top/bottom is clipped but in the 2.5x zoom crop no glyph or descender is cut; label and value sit tight to the top edge in rows with a large value. Adjacent cells in one row sit at visibly different baselines (e.g. Cognitive row: first cell label higher than neighbors). [minor] Add 3 px height (37) or reduce line-height; this is the cosmetic thing the owner will notice.
- [should-fix] A cell label is cut on screen: "Evaluation verdicts (win / inconcl..." (dim-cl ellipsis, 1366 real fonts, also in the report screenshot). It is the one new measured cell of this cycle. Shorten the label ("Evaluation verdicts") or give that row's label more room; the full text is only in the tooltip.
- Evidence note: 28 px, two lines, `overflow:hidden`. The default hint fits; for long evidence sentences (e.g. verdict outcomes at 7 d with long scope text) a third line is cut. Measured only the default state and the first-attempt cell (fit). The committed screenshot shows a 2-line note fitting. [minor] Add `title` or let it scroll; I did not find a cut case on the shipped cells.
- 390 px: committed screenshot and api-c46 ("no sideways overflow, cells 18, barRight 354") pass; panel head wraps, rows stack. My own demo capture at 390 shows overlapping tab labels in the two tab strips (Services..., Directory...), which appear on the pre-existing tabs and are not new in this cycle (not verified against base; flag to controller).
- 1280x720 (not the owner size): main scroll of 23 px in my probe; pre-existing viewport rule, informational only.
- DL-98 retirement: no `six-dimensions`/`DL-98` in web/src, scripts, server, shared; only api-c46 comments and improve docs (history). Ledger removed exactly the two six-dimensions DL-98 lines; DL-98 is not reused. `dlg` helper in api-c46 now returns `body` under the old name (misleading but harmless).
- ServerDepartments still imports `openDialog` for department-create (still used), tsc not rerun for web by me; the report says clean and the app built under vite in my run.

## 5. Tests
- api-c46 updated, not loosened: assertions moved from dialog to tab and gained checks (selected tab with icon, no `[aria-modal]`, no scroll, noteBottom); the only seed change is `attempt_id` binding (faithful, see 2). 33/33.
- RED evidence is credible and specific: 6/7 clock tests fail on old code with stated expected/got values; 'dimensions route already used DB clock, kept as lock' is honest. The api-c46 RED (23/26, three named failures) matches what would fail on the old dialog.
- The fake-Date skew method is sound for app-clock bounds (see 1) but does not exercise the sub-ms case.
- Full vitest: the report admits no single clean run; I ran only the relevant 16 files (248/248 serial). Integrator should run the full suite serially.

## 6. Contracts
Confirmed: `git diff bfe891e..4f83abf --stat` shows no change under shared/contracts. The `verdict_outcomes` cell keeps its existing key/label/unit/scope; only state and value change (unmeasured -> ok/none). `DimInput` (server-internal) gained `verdicts`, `reviews[].stale`; not DTO. The demo/sample cell for it changed in web/src/data/dimensionsDemo.ts (sample data).

## Fix list (for CLEAR)
1. Help text and evidence string: say placement by newest run and verdicts are current, not as of window end.
2. Shorten or give room to the "Evaluation verdicts (win / inconclusive / loss)" label (cut at 1366).
3. Tab strip: keep the 9th tab visible when fonts are wider (collapse unselected to icons or an edge fade), or state the accepted limit; and either align failure-modes' lower bound to the closed convention or document the exception in clock.ts; add grants issuance (grants/routes.ts:85) to H11b.
Minor items above may go to the backlog.
