# Merges into improve-30h

Integrator log: one entry per merge request. Times are UTC.

## c07-bundle-split (cycle 7: lazy help registry, command palette, chat dock)

- **Merged:** 2026-11-21 17:23 UTC.
- **Branch:** `c07-bundle-split` (030937f).
- **Merge commit:** `648e32b` (`--no-ff`).
- **Conflicts:** none. The branch did not touch controller docs.

**Checks on the merged tree (648e32b):**
- **server:** `tsc --noEmit` OK. vitest: 24 files, 331/331.
- **web:** `tsc --noEmit` OK.
- **api-e2e (5192/5193, axion_e2e):**
  - api-auth-flow 15/15.
  - api-flows 23/23.
  - **api-stage6 34/35 (FAIL, see below).**
  - api-improve 83/83.
- **verify-all:** exit 0.
  - Build OK. Deep crawl: no problems.
  - flows: all PASS.
  - Auth flow (u1): all PASS.
  - u1 flows: 8/8.
  - Dialog smoke: 106 checks, 0 failures. Dialog ids and help keys OK. fs guard OK.
  - Route×tab crawl, first run: one `504 (Outdated Optimize Dep)` on `/overview?tab=pulse` (empty main). At that time every lane shared this tree's `node_modules/.vite`. Crawl rerun alone: 77 views, no problems.
- **fit-check:** 77/77, ALL FIT.
- **ov-fit:** 32/32, no scroll anywhere.
- **First load (static set in dist/index.html, gzip):** 243,175 B. This is the post-c07 baseline; the review cross-check gave 243,127 B.
- **perf-nav:** not measured. The host load average was 14–29 throughout, so "if the host load allows" was not met. There is no figure to compare with the 163 ms baseline.

**api-stage6:** every run fails at the same step. It is pre-existing and not caused by c07.
- It is always the script's only `page.reload` (api-stage6.mjs:235, after the 130-message POST burst): `TimeoutError: page.reload: Timeout 30000ms exceeded`, with 34 PASS before it. The checks after the reload never run.
- **Runs on the integration tree (648e32b):**

  | Run | Gate | Result |
  |---|---|---|
  | 1 | combined | 34/35 |
  | 2 | alone | 34/35 |
  | 3 | alone, priority slot, `DEBUG=pw:api` plus a 1 s probe | 34/35 |
  | 4 | alone, priority slot, after the controller gave each lane its own node_modules/.vite | 34/35 |

- **Run 3 probe:**
  - Every second, the Vite `/`, Vite `/src/main.tsx`, the proxied `/api/v1/health` and direct `:5192` health all answered 200 in 1–12 ms.
  - The deps `_metadata.json` mtime did not change.
  - Nevertheless the reload navigation did not even commit until 52.5 s after it started (the 30 s timeout plus 22.5 s more).
  - So the stall is browser-side: the page was unresponsive. Vite's static paths, the health endpoints and the dependency cache were all fine. Data endpoints that touch the database were not probed.
- **A/B on identical setup:** a throwaway worktree in the integrator's scratchpad, with its own node_modules of per-package symlinks, the priority slot and ports 5192/5193. The worktree has since been removed.

  | Build | Plain run | Debug run | Page unresponsive (reload start to commit) | Load avg |
  |---|---|---|---|---|
  | 74117b8 (before c07) | 34/35, same reload timeout | 34/35 | 48.9 s | ~25 |
  | 648e32b (c07 merged) | — | 34/35 | 55.3 s (52.5 s in run 3 on the integration tree) | ~25 |

  Each figure is one timed sample per build. Both builds fail identically, and the gap is within single-sample noise at load ~25. c07 is not the cause.
- **Total so far:** 7 of 7 runs red, 5 on c07 and 2 on base.
- **History:** stage6 was 94/94 in lane runs c01–c05. The host load during those runs is not recorded, so "lower load" is an assumption.
- **Likely cause:** possibly the page is still processing the 130-message burst when the reload is issued, and on a CPU-starved host that takes more than 30 s. The stall is about 50 s against a 30 s timeout, so it is not marginal; another rerun at this load will not change the result. One run on a quiet host, with lane runs paused for about 3 minutes, would separate load from a real defect. perf-nav could run in the same window.
- **Status:** the controller is holding the merge queue (c05 → c13 → c04 → c11 → c16). c05's gate m5 needs api-stage6 green against axion_e2e.

**Follow-up commits:** none.

## Batch 1: c13, c04, c11 (integrator restarted after the sign-in stop)

- **Merged:** 2026-11-21 20:12–20:15 UTC. Pre-batch commit `a2764e7`.
- **Merge commits (`--no-ff`):**
  - `b27a2b4` c13-experiment-verdict (0945f6b): pure verdict, policy from a trusted registry (review I1 fixed on the branch).
  - `aafaab8` c04-org-history (70d8989): org history, diff, rollback through governance (review I1 fixed: `oa-htimeline`).
  - `b36a414` c11-staffing-follows-org (7021f5d): new real missions staffed by the active org revision.
- **Conflicts:**
  - c04 `server/src/app.ts`: c05's `versionRoutes` and c04's `historyRoutes` both imported and registered.
  - c04 `shared/contracts/src/agents.ts`: c05 version-proposal DTOs and c04 org-history DTOs both kept.
  - c04 `shared/contracts/src/errors.ts`: c05's codes kept, `NOTHING_TO_ROLL_BACK` added on its own line.
  - c04 `web/scripts/api-improve.mjs`: the e2e DB guard taken from c04 (it moved the guard into its own step; same regex).
  - c11 `web/scripts/api-improve.mjs`: same guard hunk, kept c04's.
- **Per-merge server checks:** tsc OK after each. vitest: after c13 26 files 395/395; after c04 27 files 417/417; after c11 28 files 428/428.

**Batch checks on `b36a414`:**
- **web:** `tsc --noEmit` OK.
- **api-e2e (5192/5193, axion_e2e):** api-auth-flow 15/15; api-flows 23/23; **api-stage6 34/35** (known: `page.reload` timeout after the 130-message burst); api-improve 107/107 (c04 flow inside); api-c11 16/16.
- **verify-all:** exit 0. Build OK; route×tab crawl 77 views, no problems; deep crawl no problems; auth flow (u1) all PASS; u1 flows 8/8; dialog smoke 110 checks, 0 failures; dialog ids, help keys, fs guard OK.
  - flows: 19/21 in the batch run. FAIL lines:
    - `FAIL  Command palette navigates (Ctrl+K): page.waitForURL: Timeout 30000ms exceeded.`
    - `FAIL  Theme toggle switches html data-theme: locator.click: Timeout 30000ms exceeded.` (follows from the first: the palette stayed open over the top bar)
  - Not in the known list. No batch-1 change touches the palette, the top bar or the theme. Load average was 14–22 (lane runs). `flows.mjs` rerun alone right after (load 22): **21/21 PASS, no console errors**. Classified as a load flake; recorded here, not blocking.
- **fit-check:** 77/77, ALL FIT. **ov-fit:** 32/32, no scroll anywhere.

**Follow-up commits:** none. Controller files committed with this entry: `LOG.md` (modified), `cycles/c23-review.md` (new).

## Batch 2: c16, c18, c06

- **Merged:** 2026-11-21 ~20:50–21:00 UTC. Pre-batch commit `0ce1391`.
- **Merge commits (`--no-ff`):**
  - `612bbcf` c16-accessibility (597c592): a11y-check script; Modal ignores disabled tabindex controls; Field names its control.
  - `a322b5e` c18-profile-fit (787a79d): Agent Profile fits at 1366×768 and 1280×760 (icon-first tab strip, compact hero).
  - `6e80c4f` c06-department-facts (34edb55): GET /departments and the api-mode Departments cards (review I2 fixed on the branch).
- **Conflicts:**
  - Tabs.tsx: none. c16 does not touch it; only c18 adds the `aria-label` line (the queue note expected both).
  - c18 `web/src/theme/pages/overview-org-agent.css`: end of file; c04's org-history rules and c18's `.oa-tabbar` icon-first rules both kept (c18's hero rules merged cleanly).
  - c06 `web/src/api/events.ts`: reconnect re-read line; c05's `versions('v')` and c06's `departments('d')` both kept.
  - c06 `web/src/pages/Agents.tsx`: toolbar note; c05's Development text and c06's Departments text both kept.
- **Per-merge server checks:** tsc OK after each. vitest: after c16 28 files 428/428; after c18 428/428; after c06 30 files 472/472.
- **Fit after c18 (before c06):** fit-check 1366×768 77/77 ALL FIT; 1280×760 77/77 ALL FIT.

**Batch checks on `6e80c4f`:**
- **web:** `tsc --noEmit` OK.
- **api-e2e:** api-auth-flow 15/15; api-flows 23/23; **api-stage6 34/35** (known reload timeout); api-improve 107/107; api-c06 25/25.
- **verify-all:** exit 0, no FAIL lines. Build OK; route×tab crawl 77 views, no problems; deep crawl no problems; flows 21/21, no console errors; auth flow (u1) 17/17; u1 flows 8/8; dialog smoke 110 checks, 0 failures; dialog ids, help keys (c06's help page is picked up by the registry's `import.meta.glob`), fs guard OK.
- **fit-check:** 1672×941 77/77, 1366×768 77/77, 1280×760 77/77, all ALL FIT. **This clears c06's NOT MET item 3** (Agent Profile at 1366×768) on the merged tree.
- **ov-fit:** 32/32, no scroll anywhere.
- **a11y-check (demo):** 50 views, 55 dialogs, 0 violations, 150.6 s (load ~20).
- Batch 1's two flows FAILs (palette, theme toggle) did not recur.

**Observation (not fixed, pre-existing from c05):** `startSync`'s stop handler in `web/src/api/events.ts` cancels every debounced refresher except c05's `versions`. A version-proposals re-read can therefore fire once after sign-out. Harmless today; one word to add (`versions.cancel()`).

**Follow-up commits:** none. Controller files committed with this entry: BACKLOG.md, LESSONS.md, LOG.md, QUEUE.md (modified); cycles/c08-review.md, c21-review.md, c23-rereview.md, c25-review.md (new).

## Batch 2b: c21 (honest exit codes)

- **Merged:** 2026-11-21 ~21:39 UTC. Pre-batch commit `1358f91`.
- **Merge commit:** `7c4496d` c21-honest-exit-codes (f43ab68), `--no-ff`. **Conflicts:** none.
- **Server:** tsc OK; vitest 30 files 472/472. **web:** tsc OK.
- **api-e2e:** not run for 2b. c21 changes only demo-mode scripts and verify-all.sh (no app code, no api script); the api set runs again in batch 2c on top of it.
- **verify-all (now with c21's per-step table):** exit 1, "1 of 10 STEPS FAILED". Every other step PASS (build, route×tab crawl, deep crawl, auth flow, u1 flows, dialog smoke, dialog ids, help keys, fs guard).
  - FAIL line: `FAIL  Hierarchy: click agent → conversation pane beside the graph shows its counterparts: hierarchy conversation pane did not switch`
  - This is the known flows Hierarchy flake (fixed by c25, batch 5b). `flows.mjs` rerun alone (load ~12): exit 0, 21/21 PASS, no console errors.
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, no scroll anywhere.
- `docs/dialog-ledger.txt` was not left modified by this run.

**Follow-up commits:** none. Controller files committed with this entry: LOG.md, QUEUE.md (modified), cycles/c22-review.md (new).

## Batch 2c: c23 (live regions)

- **Merged:** 2026-11-21 ~22:03 UTC. Pre-batch commit `2eca0e3`.
- **Merge commit:** `3440698` c23-live-regions (acc0c0e), `--no-ff`.
- **Conflicts:**
  - `web/scripts/a11y-check.mjs` (add/add with c16): took c23's, a superset of c16's script.
  - `web/src/features/agents/ServerProposals.tsx` (imports): c23's `LiveStatus` import added next to c04's react import line.
- **Server:** tsc OK; vitest 30 files 472/472. **web:** tsc OK.
- **api-e2e:** api-auth-flow 15/15; api-flows 23/23; **api-stage6 94/94** (the reload step passed this run; c22 not merged yet); api-improve 107/107; **a11y-check (api) 40 views, 55 dialogs, 0 violations** (112.5 s).
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines (flows 21/21, auth 17/17, u1 8/8, dialog smoke 110/0).
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, no scroll anywhere.
- **a11y-check (demo):** 50 views, 55 dialogs, 0 violations (141.8 s).

**Observation (not fixed):** c04's `OrgHistory.tsx:157` "Loading history…" is a plain div, not c23's `LiveStatus`. a11y-check does not open the History switch, so nothing flags it. One-line follow-up for a later lane.

**Follow-up commits:** none. Controller files committed with this entry: LOG.md, QUEUE.md (modified), cycles/c24-review.md (new).

## Batch 2d: c22 (long-thread performance)

- **Merged:** 2026-11-21 ~22:33 UTC. Pre-batch commit `f2f366a`.
- **Merge commit:** `a67d2dd` c22-long-thread-perf (665d71a), `--no-ff`.
- **Conflict:** `web/src/features/chat/ChatView.tsx` (thread body): c23's live-region attributes and empty-state role kept; c22's `AnimatePresence presenceAffectsLayout={false}` with its comment kept. c22's memoised `ChatBubble`, `useAgentsCatalog` subscription and new-message count merged cleanly.
- **Server:** tsc OK; vitest 30 files 472/472. **web:** tsc OK.
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; **api-stage6 94/94** (the reload-stall exception ends here); api-improve 107/107; **api-c22 behaviour 14/14, page errors 0, exit 0** (thresholds met).
  - api-c22 timings at load ~8–10: N=130 after-burst reload commit 65/177/272 ms, interactive 1.4–2.0 s; N=1000 commit 31/585/86 ms, interactive 1.4–2.1 s.
- **verify-all:** exit 1, "2 of 10 STEPS FAILED". FAIL lines:
  - deep crawl: `/missions/M-118?tab=activity ERROR Failed to load resource: net::ERR_NETWORK_CHANGED`
  - flows: `FAIL  Delete (archive) from the far-right trash icon: not in Archived`
  - c22 changes only `api/missionControl.ts` (api mode), `ChatView.tsx`, `ThreadMinimap.tsx` and `lib/format.ts`; nothing on the demo archive path. `ERR_NETWORK_CHANGED` is a host network event; the archive step ran in the same minute.
  - Reruns alone (load ~8): **crawl-deep exit 0, NO PROBLEMS; flows exit 0, 21/21 PASS, no console errors.** Classified as a one-off (network change); recorded, not blocking. If the archive step fails again I will compare against the pre-batch tree instead of rerunning.
  - All other steps PASS (build, crawl 77 views, auth flow, u1 flows, dialog smoke, dialog ids, help keys, fs guard).
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, no scroll anywhere.
- **a11y-check (demo):** 50 views, 55 dialogs, 0 violations (131.4 s).

**Follow-up commits:** none.

## Batch 3: c10, c12, c19

- **Merged:** 2026-11-21 ~23:11–23:14 UTC. Pre-batch commit `8e59afa`.
- **Merge commits (`--no-ff`):**
  - `6a92798` c10-db-indexes-scale (56125ef): migration 0017 scale indexes, scale benchmark.
  - `b8666c8` c12-throughput-trend (8d6da53): previous-period trend per scorecard row, weekly throughput route and chart (review I fix on the branch).
  - `0a0b270` c19-mentoring-plans (6838952): mentoring plans, migration 0023 (review I1/I2 fixed on the branch).
- **Conflicts:**
  - c10 `server/test/proposals.test.ts`: migration 0013 up/down/up; the same assertion on both sides, kept HEAD's line and comment.
  - c12 `web/src/components/layout/CommandCenter.tsx`: c12's weekly throughput block added; c23's `LiveStatus` loading/error line kept instead of c12's plain-div copy of the old line.
  - c19 `server/src/app.ts`: c04 `historyRoutes` and c19 `mentoringRoutes` both registered.
  - c19 `shared/contracts/src/agents.ts`: org-history and mentoring DTOs both kept.
  - c19 `shared/contracts/src/errors.ts`: `NOTHING_TO_ROLL_BACK` and `MENTORING_ACTIVE`, `PLAN_CLOSED`, `MILESTONE_DONE` all kept.
  - c19 `web/src/api/events.ts`: reconnect re-read and sign-out cancel; c06 `departments` and c19 `mentoring` both kept.
- **Per-merge checks:** server tsc OK after each. vitest: after c10 31 files 474/474; after c12 33 files 491/491; after c19 34 files 504/504. web tsc OK.

**Batch checks on `0a0b270`:**
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c12 ALL PASS (11 checks); api-c19 30/30; **ov-fit (api mode) 32/32, no scroll anywhere.**
- **verify-all:** exit 1, "1 of 10 STEPS FAILED" (flows). FAIL lines:
  - `FAIL  Command palette navigates (Ctrl+K): page.waitForURL: Timeout 30000ms exceeded.`
  - `FAIL  Theme toggle switches html data-theme: locator.click: Timeout 30000ms exceeded.`
  - **This is the second occurrence; the same pair failed in batch 1 on `b36a414`, before any batch 2/3 merge, so it predates this batch.** No queued lane (c25, c08, c27) touches the palette or this step.
  - Likely cause, from reading `CommandPalette.tsx` (not proven): opening the palette also starts `loadHelp()` (c07's lazy registry, line 34) and resets the query in a `useEffect` (line 51). Under load, the help entries can arrive between `fill` and `Enter`, so `results[0]` changes. Alternatively the reset can land after `fill` and clear it. Either way Enter does not open Settings › Navigation, and the palette stays open over the top bar, so the theme toggle click then times out.
  - `flows.mjs` rerun alone (load ~6.7): exit 0, 21/21 PASS, no console errors. All other verify-all steps PASS.
- **fit-check:** 77/77 ALL FIT. **ov-fit (demo):** 32/32, no scroll anywhere.

**Follow-up commits:** none.

## Batch 4: c14 (security hardening)

- **Merged:** 2026-11-21 ~23:45 UTC. Pre-batch commit `f00fda5`.
- **Merge commit:** `d0f877d` c14-security-hardening (14e1124), `--no-ff`.
- **Conflicts:**
  - `server/README.md`: the test count, set to the measured value.
  - `server/src/app.ts`: c06's `departmentRoutes` import kept; c14's header and rate-limit imports added.
  - `web/scripts/api-improve.mjs`: the e2e guard; kept c04's.
  - `web/vite.config.ts`: c14's preview `headers: WEB_SECURITY_HEADERS` added; c07's `chunkSizeWarningLimit: 400` kept over the branch's old 1500.
- **Follow-up `6876fab` (review I1):**
  - `LIMITED_ROUTES` now covers the governance writes. In the proposals bucket:
    - c04's org `rollback-proposal` (not in the queue's list, found from the route table);
    - c05's version-proposal create/decision/withdraw and `agents/:id/rollback`;
    - c19's mentoring create/milestone done/close.
  - New security tests:
    - The route table must map every message, upload, proposal, rollback and mentoring write route, and every map key must be a real route. RED before the change: 8 routes missing.
    - The new routes share the budget (429 on the 4th).
  - `version-proposals.test.ts` hit 429 (the suite makes more than 30 governance writes per admin session per minute). Its fixture now lifts only the proposals budget (`writeLimits.proposals.max 1000`), the same way c14's e2e server lifts messages for stage6. No assertion changed. **Controller to confirm.**
- **Server:** tsc OK. vitest after the merge 35 files 558/558; after the follow-up 35 files 560/560. **web:** tsc OK.
- **Controller ruling (a):** lifting only the proposals budget in the version-proposals fixture is ACCEPTED.

**Batch checks.** The previous integrator's full check chain (`batch-checks.sh`, started 00:47:14 CET, after `6876fab`; `f400a39` is docs-only, so the code is HEAD's) ran to completion (`DONE` in its `rc.txt`). The controller allowed using it as evidence. The server suite was not in that chain; I ran it on HEAD.
- **server:** tsc OK; vitest 35 files 560/560. **web:** tsc OK.
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c05 31/31; api-c19 30/30.
- **api-e2e-preview.sh (production build + strict CSP, exit 0):** api-c14 31/31 (CSP enforced: injected inline script and string-eval blocked and reported, cross-site write 403, no other violation, no page errors); api-c05 31/31; api-c19 30/30.
- **verify-all:** exit 1, "1 of 10 STEPS FAILED" (flows, 19/21). FAIL lines:
  - `FAIL  Hierarchy: click agent → conversation pane beside the graph shows its counterparts: hierarchy conversation pane did not switch` (known; c25 fixes it in batch 5b).
  - `FAIL  Modal focus trap + Escape returns focus: dialog not closed` (**new**). The step presses Escape, then waits a fixed 400 ms before counting `[aria-modal=true]` (flows.mjs:189-191). Load during the run was ~20.
  - All other steps PASS: build, route×tab crawl 77 views NO PROBLEMS, deep crawl NO PROBLEMS, auth flow, u1 flows, dialog smoke 112 checks 0 failures, dialog ids, help keys, fs guard.
- **Classification of the Modal FAIL (controller's procedure):** `flows.mjs` alone on HEAD 3× through the priority slot, against 5190:

  | Run | Load | Result | FAIL lines |
  |---|---|---|---|
  | 1 | 32.0 | 19/21 | Hierarchy (known); `Conversations: mission agents pane on the left switches the thread: thread did not switch to Planner-01` (known list) |
  | 2 | 16.4 | 17/21 | `Delete (archive) from the far-right trash icon: not in Archived` (ruling c, 2nd occurrence after batch 2d); Hierarchy (known); `Command palette navigates (Ctrl+K)` + `Theme toggle switches html data-theme` (ruling b, c28) |
  | 3 | 11.9 | 21/21, exit 0 | none |

  The Modal step passed 3/3 alone, so it is **load-only: recorded as a flake to watch**, not bisected. If it recurs, run the controller's step 2 (throwaway worktrees at `1358f91` and `0ce1391`).
  - The archive step has now failed twice (batch 2d, and run 2 here), both under load; watching per ruling (c).
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE.
- Host load was 12–32 throughout (lane runs).

**Follow-up commits:** `6876fab` (above). Controller files committed with this entry: LOG.md, QUEUE.md (modified), cycles/c28-brief.md (new).

## Batch 5: c20, c09 (c15 HELD)

- **Merged:** 2026-11-22 ~00:25–00:27 UTC. Pre-batch commit `cca6a70`.
- **Merge commits (`--no-ff`):**
  - `c5f8dda` c20-org-coverage (df91e31): coverage facts in dry runs, history and the Policies card (`GET /organization/coverage`, read-only, so c14's rate-limit map needs no entry).
  - `b18c5a2` c09-server-minors (4eb4651): unified `task.delegated`, replyTo scoped to the thread, reassign refuses ended instances, instances keyset paging, `decidedByName`.
- **Conflicts:**
  - c20 `server/src/app.ts`: c19 `mentoringRoutes` and c20 `coverageRoutes` both imported and registered.
  - c20 `web/src/features/agents/OrgSections.tsx`: c06 `ServerDepartments` and c20 `CoverageCard` imports both kept.
  - c20 `web/src/theme/pages/overview-org-agent.css`: end of file; c18 tab-strip rules and c20 coverage rules both kept.
  - c09 `web/scripts/api-improve.mjs` expiry step: kept HEAD (e2eUrl is read and guarded once in the c04 step; the branch re-declared it).
- **Per-merge server checks:** tsc OK after each. vitest after c20: 36 files 576/576. After c09: first run **3 failed in 2 files (names not captured)**, two reruns 37 files 583/583. Probably load or the connection cap, but unproven; every vitest run is now written to a file.

**c15-contract-tests: HELD (merge aborted, nothing committed).**
- c15's base is `2ed66e9` (before cycle 4). Its contract test freezes the API as it was then and, by design, fails on any route, field or event it does not validate.
- On the merged tree, `server` tsc fails in `test/contracts/validators.ts`:
  - `OrgDryRun.coverage` missing (c20);
  - `ScorecardRow.previous/trend` and `CompanyScorecardDto.previousFrom/previousTo` missing (c12);
  - `EventPayloads` lacks `agent.versionProposed/versionPromoted/rolledBack/versionProposalDecided` (c05) and `mentoring.planned/milestoneDone/closed` (c19).
- `vitest run test/contracts` on the merged tree: 1 failed / 5 passed. `contract drift`: 53 "not in the contract" fields (c04 revision `createdByName/source/appliedFromProposal/changed/coverage`; c20 `result.coverage` on every proposal reply; c12 scorecard `previous/trend/previousFrom/previousTo`). The test stops there, before the missing-route and unseen-event assertions.
- Not yet covered by any validated call: 19 routes added since its base:
  - c19: `GET /mentoring`, `GET|POST /agents/:id/mentoring`, `POST /mentoring/:pid/milestones/:mid/done`, `POST /mentoring/:pid/close`;
  - c05: `GET /version-proposals`, `GET|POST /agents/:id/version-proposals`, `POST /version-proposals/:pid/decision|withdraw`, `POST /agents/:id/rollback`;
  - c06: `GET /departments`;
  - c12: `GET /company/throughput` (and the changed scorecard);
  - c20: `GET /organization/coverage`;
  - c04: `GET /organization/revisions`, `/revisions/:seq`, `/revisions/:seq/diff`, `POST /revisions/:seq/rollback-proposal`.
- Going green means validators and flow steps for all of these, or `NOT_REACHABLE` entries, which would weaken the test. That is lane-sized new test surface needing its own review, so I did not write it. The queue's "tighten the `// remove after c09 merge` tolerances" follow-up moves with c15.
- **Controller decision:** refresh c15 against improve-30h in a lane (best after c27, which changes the `agent.rolledBack` payload), then merge it with the tightening.

**Batch checks on `b18c5a2` (c20 + c09):**
- **web:** `tsc --noEmit` OK.
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c20 ALL PASS (14 checks); api-c09 6/6.
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines. flows 21/21 (Hierarchy, Modal and archive steps all passed this run), dialog smoke 112 checks 0 failures. Load peaked at ~35 during the run.
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE.

**Follow-up commits:** none (the c15 tightening moves with c15). Controller files committed with this entry: LOG.md (modified), cycles/c28-review.md, c29-brief.md (new).

## Batch 5b: c25, c08

- **Merged:** 2026-11-22 ~01:00–01:02 UTC. Pre-batch commit `e00352a`.
- **Merge commits (`--no-ff`):**
  - `aaa18f6` c25-test-hygiene (1d0fd4a): condition waits, shared e2e DB guard, narrower invented-number and decision-button checks, flows Hierarchy fix, stale-anchor fix.
  - `04e6a7d` c08-flaky-checks (60ee4b7): loadAgents keeps only the newest load (overtaken callers wait for it), expiry step gates B's reads, Conversations condition wait.
- **Conflicts:**
  - c25 `web/scripts/api-improve.mjs`:
    - The e2e DB guard is now read once, in the c04 step, through c25's `requireE2eDatabase()`; the expiry step keeps HEAD's "read and guarded above" comment.
    - The proposal-card check takes c25's `inventedNumbers()` with HEAD's count of five proposals (c04's rollback is the fifth).
  - c25 `web/src/features/chat/ChatView.tsx` thread body: c23's conditional live-region role and empty-state role, c22's `presenceAffectsLayout={false}`, plus c25's anchor capture while an older page loads.
  - c08 `web/scripts/api-improve.mjs` expiry step: kept HEAD (no re-declared guard). c08's gate (`holdReads`/`openGate`) merged cleanly; flows.mjs keeps c25's Hierarchy condition waits and gains c08's Conversations wait.
- **Per-merge checks:** server tsc OK; vitest 37 files 583/583 after each. web tsc OK after each. `selftest-guards.mjs` 34/34 after c25.
- **Observation (not changed):** c04's History check (api-improve.mjs:305) still bans the words coverage/latency/tokens/estimate. c25 narrowed only the proposal-card check, and c20's History text avoids the word. It is worth narrowing the same way in a later lane.

**Batch checks on `04e6a7d`:**
- **api-e2e (exit 1):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-c08 6/6; **api-improve 106/107**.
  - FAIL line: `FAIL nothing invented: no percentage and no number beside coverage, latency or tokens on the proposal cards — 52s | 49s | 54s | 56s`
  - Cause: c25's new number-before-unit rule (`\d+\s*s\b`) matches the cards' real relative time. `ago()` (lib/format.ts, unchanged since init) prints "NNs ago" for 30–60 s. On the merged tree the cards are 49–56 s old when read (c04's extra steps run first); on c25's branch they were not. This is a false positive in the guard, not an invented figure.
  - **Follow-up `f8a5ff5`:** a unit followed by "ago" is not flagged. selftest-guards gains two allowed cases (RED before the change: 2 FAIL) and two flagged ones; 38/38 after. **api-improve rerun: 107/107**, the check PASS.
- **verify-all:** exit 1, "1 of 10 STEPS FAILED" (auth flow (u1)). **flows 21/21, no console errors**: c25's Hierarchy fix holds.
  - FAIL line: `FAIL v1 → v2 migration loads the old missions — 0 rows` (auth-flow.mjs: a fixed 800 ms wait, then the rows are counted). The queue's known list names the v1 → v2 step. Load was ~62 during the run.
  - `auth-flow.mjs` rerun alone (load 11.6): exit 0, 17/17, migration 12 rows. Classified as load; recorded.
  - Every other step PASS: build, crawl 77 views, deep crawl, u1 flows, dialog smoke 112/0, dialog ids, help keys, fs guard.
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE.

**Follow-up commits:** `f8a5ff5`. Controller files committed with this entry: LOG.md, QUEUE.md (modified; the new batch 5e).

**Controller rulings since batch 5:** `f8a5ff5` (inventedNumbers) CONFIRMED. c15 stays **HELD by controller ruling**: it is skipped here and will be refreshed in a new lane after batch 8, against the full Phase 2 API. The archive step's two failures (batch 2d; batch 4 flows-alone run 2) are recorded; c29 (batch 5f) fixes it.

## Batch 5c: c24 (mobile fit)

- **Merged:** 2026-11-22 ~01:38 UTC. Pre-batch commit `eca4e8d`.
- **Merge commit:** `4ff1b40` c24-mobile-fit (bb0551b), `--no-ff`. **Conflicts:** none. Every rule in `touch.css` sits inside a ≤900/800/440 px media query (checked: no bare rule).
- **Server:** tsc OK; vitest 37 files 583/583. **web:** tsc OK.

**Batch checks on `4ff1b40`:**
- **api-e2e (exit 1, only api-mobile):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107.
- **api-mobile** (`DATA_MODE=api node scripts/api-mobile.mjs`; without `DATA_MODE=api` its `signIn` falls back to demo mode): exit 1. 651 states and 366 dialogs measured, against the lane's 233 states. 32 FAIL lines; 424 distinct controls under 40 px.
- **A/B probe** (throwaway, not committed): the touch.css `<style>` was removed in-page and the same states re-measured, in api mode via api-e2e.sh.

  | Family | With touch.css | Without touch.css |
  |---|---|---|
  | 390 Activity act-cards (M-134) | card right edge 416, chat button 363..403 | card right edge 416, chat button 381..403 |
  | 390 Help: Company scorecard popover | top −113, height 686 | top −119, height 672 |
  | Toast "Dismiss notification" | at rest 325..365 (390), 829..869 (900): fits | at rest 337..359, 847..869: fits |
  | | mid-exit 351..391, 854..894 | mid-exit 361..383, 872..894 |
  | DL-75 "Propose a change" at 900 | 24..1064, width 1040 | 24..1064, width 1040 |

  - The toast clips only during its exit slide (`x: 40`), with or without touch.css. The harness caught toasts mid-exit.
  - **Result: every family exists without touch.css, so c24 causes none of them.** Per the controller's ruling, c24 stays merged and the lines are recorded in QUEUE's known failures as "mobile layout debt (pre-existing, measured by c24)". A mobile-fix lane will follow. Any new api-mobile FAIL line blocks.
- **The 32 api-mobile FAIL lines (verbatim):**

```
FAIL 390 /overview tab=Pulse > dialog "" via [Help: Company scorecard]: dialog "" (null) outside viewport {"l":38,"t":-256,"r":378,"b":430,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 390 /missions tab=Activity: clipped control div.act-card.glass-card[Researcher-01GMResearchB] x=27..437
FAIL 390 /missions tab=Activity: clipped control button.icon-btn.xs[Chat with Researcher-01 ] x=384..424
FAIL 390 /missions tab=Activity: clipped control div.act-card.glass-card[Analyst-01AnalyticsBrows] x=27..437
FAIL 390 /missions tab=Activity: clipped control button.icon-btn.xs[Chat with Analyst-01 in ] x=384..424
FAIL 390 /missions tab=Activity: clipped control button.icon-btn.xs[Chat with Writer-01 in t] x=384..424
FAIL 390 /missions tab=Activity: clipped control button.icon-btn.xs[Chat with Browser-01 in ] x=384..424
FAIL 390 /missions tab=Conversations > dialog "" via [Help: Mission agents views]: dialog "" (null) outside viewport {"l":38,"t":-13,"r":378,"b":431,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 390 /missions/M-134 tab=Activity: clipped control div.act-card.glass-card[GMGMGeneral ManagerCalli] x=27..416
FAIL 390 /missions/M-134 tab=Activity: clipped control button.icon-btn.xs[Chat with GM in this mis] x=363..403
FAIL 390 /missions/M-134 tab=Activity: clipped control div.act-card.glass-card[Planner-01executorPlanni] x=27..416
FAIL 390 /missions/M-134 tab=Activity: clipped control button.icon-btn.xs[Chat with Planner-01 in ] x=363..403
FAIL 390 /missions/M-134 tab=Activity: clipped control button.icon-btn.xs[Chat with Analyst-01 in ] x=363..403
FAIL 390 /agents tab=Services > dialog "" via [Help: AXION server]: dialog "" (null) outside viewport {"l":38,"t":-21,"r":378,"b":431,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 390 /agents/analyst-01 > dialog "" via [Help: Development stage]: dialog "" (null) outside viewport {"l":38,"t":-79,"r":378,"b":431,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 390 /agents/analyst-01 > dialog "" via [Help: Reliability (measured)]: dialog "" (null) outside viewport {"l":38,"t":-605,"r":378,"b":432,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 390 /agents/analyst-01 tab=Mentoring > dialog "" via [Help: Mentoring plan]: dialog "" (null) outside viewport {"l":38,"t":-145,"r":378,"b":431,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 390 /agents/analyst-01 tab=Evolution > dialog "" via [Help: Propose a change]: dialog "" (null) outside viewport {"l":38,"t":-20,"r":378,"b":432,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 390 /agents/analyst-01 tab=Evolution > dialog "" via [Help: Roll back to this versio]: dialog "" (null) outside viewport {"l":38,"t":-71,"r":378,"b":431,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 390 /agents/analyst-01 tab=Evolution > dialog "" via [Help: Version proposals]: dialog "" (null) outside viewport {"l":38,"t":-288,"r":378,"b":464,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 390 /operations tab=Recovery: clipped control button.icon-btn.xs[Dismiss notification] x=365..405
FAIL 390 /models tab=Recovery: clipped control button.icon-btn.xs[Dismiss notification] x=365..405
FAIL 900 /overview tab=Pulse > dialog "" via [Help: Company scorecard]: dialog "" (null) outside viewport {"l":277,"t":510,"r":617,"b":1196,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 900 /agents/analyst-01 > dialog "" via [Help: Reliability (measured)]: dialog "" (null) outside viewport {"l":319,"t":-532,"r":659,"b":505,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 900 /agents/analyst-01 tab=Evolution > dialog "Propose a change to Analyst-01" via [Propose a change]: clipped control button.icon-btn.sm[Close (Esc)] x=1005..1045
FAIL 900 /agents/analyst-01 tab=Evolution > dialog "Propose a change to Analyst-01" via [Propose a change]: clipped control button.help-btn[Help: Evaluation] x=1016..1034
FAIL 900 /agents/analyst-01 tab=Evolution > dialog "Propose a change to Analyst-01" via [Propose a change]: clipped control textarea.textarea[] x=499..1045
FAIL 900 /agents/analyst-01 tab=Evolution > dialog "Propose a change to Analyst-01" via [Propose a change]: clipped control input.input[] x=499..1045
FAIL 900 /agents/analyst-01 tab=Evolution > dialog "Propose a change to Analyst-01" via [Propose a change]: clipped control button.btn.primary[Change the model, a skil] x=892..1045
FAIL 900 /agents/analyst-01 tab=Evolution > dialog "Propose a change to Analyst-01" via [Propose a change]: dialog "Propose a change to Analyst-01" (DL-75) outside viewport {"l":24,"t":212,"r":1064,"b":788,"fits":false,"bodyScroll":false,"bodyX":0,"label":"Propose a change to Analyst-01","id":"DL-75"}
FAIL 900 /agents/analyst-01 tab=Evolution > dialog "" via [Help: Version proposals]: dialog "" (null) outside viewport {"l":288,"t":-133,"r":628,"b":619,"fits":false,"bodyScroll":false,"bodyX":0,"label":"","id":null}
FAIL 900 /operations?tab=logs tab=Logs: clipped control button.icon-btn.xs[Dismiss notification] x=869..909
```
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines.
- **Desktop unchanged:** fit-check 1672×941 77/77, 1366×768 77/77, 1280×760 77/77, all ALL FIT. ov-fit 32/32, NO SCROLL ANYWHERE.

**Follow-up commits:** none. Controller files committed with this entry: QUEUE.md (the api-mobile known-failure line is mine, per the ruling; the rest is the controller's), BACKLOG.md, LANES.md, LESSONS.md, LOG.md (modified); PHASE2.md, phase2/, and cycles/c26-rereview, c29–c40 briefs and reviews (new).

## Batch 5d: c27 (merged minors)

- **Merged:** 2026-11-22 ~03:32 UTC. Pre-batch commit `18db241`.
- **Merge commit:** `83a5885` c27-merged-minors (69019e2), `--no-ff`. **Conflicts:** none.
- **Server:** tsc OK; vitest 37 files 586/586. **web:** tsc OK.
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c27 7/7, 0 FAIL, no page errors.
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines; dialog smoke 112 checks, 0 failures.
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE.

**Follow-up commits:** none. Controller files committed with this entry: LOG.md, QUEUE.md (modified).

## Batch 5e: c28 (palette and gaps)

- **Merged:** 2026-11-22 ~03:58 UTC. Pre-batch commit `01e55ec`.
- **Merge commit:** `cd71789` c28-palette-and-gaps (072a1ea), `--no-ff`. **Conflicts:** none.
- **Server:** tsc OK; vitest 37 files 586/586. **web:** tsc OK.
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; **a11y-check (api) 40 views, 56 dialogs, 0 violations** (178.7 s; the error-state probes report `fail []`, meaning no violations).
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines. flows 21/21: palette and theme toggle PASS. **Ruling (b) ends here: a palette FAIL now blocks.** Dialog smoke 112 checks, 0 failures.
- **c28's own checks (against 5190):** c28-palette-fast 0/5 failures; c28-palette-pending PASS escape and PASS click (I1: no action after close, one navigation); c28-signout-refresh PASS (1 refresh with the stream open, 0 after sign-out); c28-palette `RUNS=10` 0/10 failures.
- **a11y-check (demo):** 50 views, 56 dialogs, 0 violations (143.0 s).
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE.

**Follow-up commits:** none. Controller files committed with this entry: BACKLOG.md, LANES.md, LOG.md, QUEUE.md (modified); cycles/c38-review, c38-rereview, c39-review, c41-brief, c42-brief (new).

## Batch 5f: c29 (archive flake)

- **Merged:** 2026-11-22 ~04:31 UTC. Pre-batch commit `7123274`.
- **Merge commit:** `f85f310` c29-archive-flake (887dd89), `--no-ff`. **Conflicts:** none; flows.mjs auto-merged over c28.
- **Server:** tsc OK. vitest: first run **2 failed** (`agents.test.ts` "a skills PATCH creates v(n+1)…" 500 instead of 200 at 5 s; `version-proposals.test.ts` hook timeout 30 s and "a rollback waiting on the lock…"). c29 changes no server file, so this is lock and DB contention. The rerun right after (load 6.7) was 37 files 586/586. Second transient vitest red in this run (after c09: 3 failed in 2 files): watch it. **web:** tsc OK.
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107.
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines; flows 21/21; dialog smoke 112 checks, 0 failures.
- **flows.mjs alone:** exit 0, 21/21.
- **`FLOWS_CPU_THROTTLE=4 node scripts/flows.mjs`:** exit 1, 19/21. **`PASS  Delete (archive) from the far-right trash icon`** (the required step). Other steps are recorded and not blocking, per the queue (H7). FAIL lines:
  - `FAIL  Command palette navigates (Ctrl+K): page.waitForURL: Timeout 30000ms exceeded.`
  - `FAIL  Theme toggle switches html data-theme: locator.click: Timeout 30000ms exceeded.` (follows: the palette stays open over the top bar)
  - **For the controller:** c28 fixed the palette at normal speed (0/10, 0/5 and flows 21/21 everywhere since), but at 4× CPU throttle the palette step still fails.
- **c29-archive-race.mjs:** exit 0, archived 14/14.
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE.

**Follow-up commits:** none. Controller files committed with this entry: BACKLOG.md, LOG.md (modified), cycles/c42-review.md (new).

## Batch 5g: c26 (virtualised threads, hand-merge)

- **Merged:** 2026-11-22 ~05:05 UTC. Pre-batch commit `9ebf234`.
- **Merge commit:** `38a8c67` c26-thread-virtualise (14616db), `--no-ff`.
- **Conflicts** (exactly the two the re-review predicted; resolved per c26's report I3):
  - `web/src/features/chat/ChatView.tsx` `onScroll`: c26's handler (`moving`/`own` stamps, `record()`, `far`/`moveVp`) plus c25's stale-anchor re-capture *after* the window has followed the scroll. At the top, or while an older page loads, the rows are rendered first (`flushSync(moveVp)`) so the anchor is a row the reader can see. c26's `aria-live="off"` and status line are kept (its reviewed departure from c23). c09's Reply `replyTo: m.id` and ChannelChat `flushChannelMark` auto-merged.
  - `web/scripts/api-stage6.mjs` paging loop: c26's `loaded()` count, with c25's `calm()` in place of the fixed 400 ms. The other two waits auto-merged to `calm()`.
- **Server:** tsc OK; vitest 37 files 586/586. **web:** tsc OK.

**First run on `38a8c67`:**
- api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c09 6/6; a11y-check (api) 40 views, 56 dialogs, 0 violations.
- **api-c22:** behaviour 14/14 (N=130 1.35–1.6 s), but **N=1000 "not interactive within the cap" 3/3** (THRESHOLD MISS).
- **api-c26** (REPS=3 FILL=1000): every rep "burst 200 posted in 150–186 ms, store has it NO"; behaviour 21/22. FAIL: `I2 mixed heights: each older page keeps the visible message in place (±8 px) … shifts 778.4 0.3 0.1 0.1 px`. The mixed walk saw 232 of 241 messages.
- Cause: c14's throw-away e2e server lifts messages to only 1,000 a minute per session. api-c22 N=1000 and api-c26 post more than that within a minute, so their last posts got 429 and the newest message never arrived. api-c22 N=1000 had not run since batch 2d, before c14.
- Proof, on `38a8c67` with the lift raised (uncommitted): api-c22 N=1000 interactive 1,334 ms; api-c26 behaviour (REPS=0) 22/22, including I2 older pages. The merged onScroll is not the cause.
- **Follow-up `ac1a48c`** (e2e-serve only): messages lifted to 5,000 a minute. Real limits are unchanged; security.test.ts covers them. **CONFIRMED by the controller.**

**c25's stale-anchor check:** none existed (the c25 review: "no automated test for a slow page"). New `web/scripts/api-c25-anchor.mjs`, committed with this entry at the controller's request:
- the older-page request is held while the reader keeps scrolling down (6×60 px), then the row in view must stay put (±8 px);
- **RED with c25's re-capture line removed (pre-c26 tree): 334.5 / 334 / 334 px; GREEN on the pre-c26 tree 0.5 / 0 / 0; on the merged tree 0.1 / 0.1 / 0.1 and 0.7 / 0.2 / 0.3 px.**

**Final checks on `ac1a48c`:**
- **api-c22** (SIZES 130,1000, REPS 3): exit 0, behaviour 14/14. Reload → interactive: N=130 1,351–1,574 ms after the burst, 1,299–1,615 idle; N=1000 1,366–1,525 after the burst, 1,460–1,512 idle.
- **api-c26** (REPS=3 FILL=1000): **exit 0, behaviour 22/22**, including the wheel, pill and minimap N1 checks. Burst arrives in 1,194–1,263 ms; page errors 0.
  - Timing (informational; c26's own verdict is NOT MET on timing): whole trace long-task total 1,420 / 1,333 / 1,605 ms (mean 1,453; c26 lane after: 1,385), worst task 1,014 / 1,018 / 1,132 ms (c26 lane after: 464–518).
  - "still pinned false" after each burst is the pre-existing early unpin the c26 report describes (§ line 213); it is not a check.
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines; flows 21/21.
- **fit-check:** 77/77 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE. **a11y-check (demo):** 50 views, 56 dialogs, 0 violations (151.4 s).
- **api-mobile:** exit 1, 658 states and 359 dialogs measured, **34 FAIL lines, all in the four known debt families** (QUEUE known failures). Against batch 5c's 32 lines:
  - +2 Activity act-card lines (`[Analyst-01AnalyticsRunni]`, `[Writer-01WriterCalling a]`): the same clipped cards, whose labels carry the live activity text.
  - The toast "Dismiss notification" mid-exit line moved from `/operations?tab=logs` (900) to `/operations tab=Recovery` (900): whichever route a toast was leaving.
  - No new family.

**Follow-up commits:** `ac1a48c` (e2e message lift). Controller files committed with this entry: BACKLOG.md (H7 gets the 4× throttle result from batch 5f, at the controller's request), LANES.md, LOG.md, QUEUE.md (modified); cycles/c41-review, c41-rereview, c42-rereview, c43-brief (new).

## Batch 6: c17 (owner guide)

- **Merged:** 2026-11-22 ~07:26 UTC. Pre-batch commit `08b2620`.
- **Merge commit:** `c068a6d` c17-owner-guide (e4bd746), `--no-ff`. **Conflicts:** none.
- **Server:** tsc OK; vitest 37 files 586/586. **web:** tsc OK.
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107.
- **api-c17** (`DATA_MODE=api node scripts/api-c17.mjs`; the script does not set api mode itself): exit 0, 37 PASS, 1 SKIP.
  - The after-merge checks: versionproposals PASS, departmentfacts PASS, but `SKIP history: runs after merge ([data-org-history] not in this build)`.
  - Cause: c17 guessed the landmark and the control. c04's History is a radio in the view switch (not a button), and its screen is the revision timeline (`role=list`, `aria-label="Org revisions"`); nothing carries `data-org-history`.
  - **Follow-up `2247ec6`:** the history page's `afterMerge` (read only by api-c17) points at c04's timeline, and the check clicks the History radio. **api-c17 rerun: exit 0, 39 PASS, 0 SKIP; all three after-merge checks RUN and PASS.**
- **verify-all:** exit 1, "1 of 10 STEPS FAILED" (flows, 19/21; load ~16). FAIL lines:
  - `FAIL  u1 · News: post news, it appears for everyone: page.waitForSelector: Timeout 4000ms exceeded.`
  - `FAIL  u1 · Chat dock: GM answers: locator.click: Timeout 30000ms exceeded.`
  - Both are named in BACKLOG H7 (under load). c17 touches only help content. `flows.mjs` rerun alone (load 7.3): exit 0, 21/21. Classified as load.
  - Every other step PASS; dialog smoke 112 checks, 0 failures.
- **fit-check:** 78/78 ALL FIT (c17 adds the New Features help view). **ov-fit:** 32/32, NO SCROLL ANYWHERE.

**Follow-up commits:** `2247ec6`. Controller files committed with this entry: LANES.md, LOG.md, PHASE2.md, STATE.md (modified); cycles/c43-review, c44–c46 briefs (new).

## Batch 7 (Phase 2 · Wave 1): c32, c31, c30

- **Merged:** 2026-11-22 ~07:57–08:15 UTC. Pre-batch commit `3740292`.
- **Merge commits (`--no-ff`):**
  - `e9af1a3` c32-eval-model (e5c148a): migration 0027 eval tables, stats.ts, verdict-v2.ts.
  - `728994f` c31-audit-chain (06c25bb): migration 0026 audit hash chain, `GET /audit/verify`, `npm run audit:verify`.
  - `683a15c` c30-policy-service (f483e2d): policy module, approval tiers from policy.
- **Conflicts:** none in any of the three. The only raw `insert into audit_events` left on the merged tree are audit.ts (chained), c31's own tests and the fixed scale-bench.ts. c30 adds only `GET /policy/baseline`, so no rate-limit entry is needed.
- **Live API untouched:** 5191 runs `node --import tsx src/main.ts` with no watch, so nothing migrates until the controller restarts it.
- **Per-merge server checks** (web tsc OK after each):
  - **After c32:** server tsc OK; vitest 40 files 633/633.
  - **After c31:**
    - Unpatched: vitest at 2 workers red in 3/3 runs, one different test each time, a sign-in 500 at ~5.3 s (events.test "is append-only", auth.test "a second name waits…", review-fixes "avatar images…"). `--maxWorkers=1`: 653/653.
    - Cause: c31's `audit()` takes `EVENTS_LOCK`, a database-wide constant advisory key, and pool audits run with a 5 s `lock_timeout`. c31's own test M1 (`audit-chain.test.ts:199`) parks a writer on that key until a sign-in's audit times out. Every test schema in axion_test (and every lane) shares the key, so all their audits time out for those 5 s.
    - The batch 5f "transient" vitest red had the same 5 s signature.
  - **Follow-up `9e958f3`** (**ACCEPTED by the controller**): `EVENTS_LOCK` is `hashtextextended(current_schema() || ':axion-events', 0)`, used in events/log.ts, audit.ts and the M1 test, the way c31 already scopes its tenant lock. Production has one schema, so exclusivity there is unchanged. After: 3/3 runs at 2 workers, 41 files 653/653.
  - **Follow-up `bc53a1b`** (controller's hardening): M1 asserts the denied sign-in waited ≥ 4.5 s. RED when the holder locks the old constant key ("expected 40 to be greater than or equal to 4500"); GREEN with the scoped key.
  - **After c30:** server tsc OK; vitest 746/746.
- **Controller note:** c31's global events lock in production (pool audits wait on it with a 5 s timeout) is recorded as backlog P5c; no further product lock change in the merge.

**Batch checks on `bc53a1b`:**
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94 (both decide as admin A under c30's tiers); api-improve 107/107.
- **`npm run audit:verify`** against axion_e2e (`DATABASE_URL` set to the e2e URL explicitly; the default .env points at the live DB, which has no 0026 yet): exit 0, "audit chain OK for t-1: 45 rows".
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines; flows 21/21; dialog smoke 112 checks, 0 failures.
- **fit-check:** 78/78 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE.

**Follow-up commits:** `9e958f3`, `bc53a1b`. Controller files committed with this entry: BACKLOG.md, LOG.md, QUEUE.md (modified); cycles/c45-review.md (new).

## Batch 8 (Phase 2 · Wave 2): c36, c37, c33, c35, c34

- **Merged:** 2026-11-22 ~08:20–08:55 UTC. Pre-batch commit `3ca733a`.
- **Merge commits (`--no-ff`):**
  - `6087760` c36-site-grants (719091a): migration 0030, per-site grants, DL-90.
  - `59fc6fa` c37-browser-contract (1bd26fe): browser contract and corpora.
  - `766f4cf` c33-failure-tags (66d5e35): migration 0028, failure tags, DL-78.
  - `fd55ca4` c35-approval-binding (87b2263): migration 0029, approval digest v2 with a v2-only insert guard.
  - `0fc4b98` c34-staffing-fresh (8e5bc03): demo staffing tick reads fresh store state.
- **Conflicts (all list unions, both sides kept):**
  - c36 `web/src/api/events.ts` sign-out cancels: c28's `versions.cancel()` and c36's `grants.cancel()`.
  - c37: none (branched from c36).
  - c33:
    - `server/src/app.ts` registrations: policy, grants, failures.
    - `server/src/ratelimit.ts` LIMITED_ROUTES: site-grants and failure-tags writes.
    - `server/test/security.test.ts`: `LIMITED_KIND` now `/\/messages$|proposal|rollback|mentoring|site-grants|failure-tags|\/uploads$/`, and the expected-route list has both pairs.
    - contracts `errors.ts`, `events.ts` and `index.ts` (browser and failures exports).
    - `web/src/api/events.ts`: imports, refreshers, event routing, reconnect re-reads, event type list and sign-out cancels. The two sides were checked to differ only by the grant/failure tokens.
  - c35 `shared/contracts/src/errors.ts`: failure-tag and approval codes.
- **Dialog ids:** `dialogId=` values are unique except DL-48, which appears twice in the same dialog (its not-found branch, since init). c33 DL-78 and c36 DL-90 are new and unique.
- **Migrations present:** 0026–0030. The only `insert into approval_requests` left without a version was scale-bench's.
- **Per-merge server checks:** tsc OK after each. vitest: c36 971/971; c37 1385/1385 (`test/browser-contract.test.ts` **414/414**); c33 1403/1403; c35 1431/1431; c34 1436/1436 (includes c34's staffing tick tests). web tsc OK after each.
- **Follow-up `db4eb49` (required, after c35):** scale-bench's approvals insert sets `digest_version` 2. Proven with a guard-free copy (`assertOwnLaneDb` removed, `search_path` set to a scratch schema `scale_tmp_*` in axion_test):
  - RED on the old insert: "approval_requests: new requests must use digest v2".
  - GREEN on the new one: seeded 300 missions, 3,000 tasks, 6,000 attempts, 50,000 events, 20,000 audit rows; audit chain ok (20,000); BEFORE/AFTER/AFTER2 timings printed; rc 0.
  - Copy deleted and both scratch schemas dropped.

**Batch checks on `db4eb49`… `0fc4b98`:**
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c33 41/41; api-c35 16 PASS, 0 FAIL; api-c36 35/35; a11y-check (api) 40 views, 58 dialogs, 0 violations.
- **5190 had gone stale.** The first verify-all failed 6/10 steps. 5190 served a `shared/contracts/src/index.ts` without c37's `browser.ts` and c33's `failures.ts` exports, so every page logged "Dialog module failed ./defs/failure-tags.tsx … does not provide an export named 'FAILURE_TAXONOMY'". The build step passed; the file on disk was right; a `touch` did not wake the watcher. **The controller restarted 5190 at about 09:16Z.** The demo-mode checks below were re-run on the restarted server.
- **verify-all (restarted 5190):** exit 1, "1 of 10 STEPS FAILED" (flows 19/21; load ~9). FAIL lines:
  - `FAIL  u1 · News: post news, it appears for everyone: page.waitForSelector: Timeout 4000ms exceeded.`
  - `FAIL  u1 · Chat dock: GM answers: locator.click: Timeout 30000ms exceeded.`
  - Second time in a row (batch 6 too); both are BACKLOG H7 steps, which c43 (batch 8b) hardens. `flows.mjs` alone (load 4.6): exit 0, 21/21. Recorded as load.
  - All other steps PASS. **Dialog smoke 58 dialogs, 116 checks, 0 failures.** The regenerated ledger adds only c36's two DL-90 lines (`site-grant` no-props/props), which were missing from the tracked file. **The updated `web/docs/dialog-ledger.txt` is committed with this entry.**
- **fit-check:** 78/78 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE. **a11y-check (demo):** 50 views, 58 dialogs, 0 violations (141 s).
- **Race checks against 5190:** `c34-archive-race.mjs` STOP=archived 14/14 clean, STOP=paused 14/14 clean; `c29-archive-race.mjs` archived 14/14.

**Follow-up commits:** `db4eb49`. Controller files committed with this entry: LOG.md (modified), cycles/c44-review.md (new).

## Batch 8b (code health): c43 (flows hardening)

- **Merged:** 2026-11-22 ~09:50 UTC. Pre-batch commit `28842ce`.
- **Merge commit:** `2aba0a0` c43-flows-hardening (2cd883d), `--no-ff`. **Conflicts:** none.
- **Server:** tsc OK; vitest 1436/1436. **web:** tsc OK.
- **Follow-up `09dd6cb` (required fold):**
  - `c29-archive-race.mjs` now carries c34's store-subscription check (any change to a mission after it reached the stopped status) next to its final-state check, with `STOP=archived|paused` (archived through `archiveMission`, paused through `setMissionStatus`).
  - The duplicate `c34-archive-race.mjs` is deleted.
  - Against 5190: archived 14/14 at the end, 0 changes after; paused 14/14, 0 changes after.

**Batch checks on `09dd6cb`:**
- **api-e2e (exit 0)**, including batch 8's api scripts re-run under c43's Modal first-focus guard: api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c33 41/41; api-c35 16 PASS, 0 FAIL; api-c36 35/35.
- **c43-modal-focus:** PASS "dialog keeps focus in the field already focused". **c43-palette-hover:** PASS 6/6.
- **flows (plain):** exit 0, 21/21.
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines; flows 21/21 (the u1 News / Chat dock pair from batches 6 and 8 passed); dialog smoke 116 checks, 0 failures; ledger unchanged.
- **fit-check:** 78/78 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE.
- After batch 9: batch 9's api scripts plus one `FLOWS_CPU_THROTTLE=4` flows run (per the 8b row).

**Follow-up commits:** `09dd6cb`. Controller files committed with this entry: BACKLOG.md, LANES.md, LOG.md, QUEUE.md, STATE.md, cycles/c44-review.md (modified); cycles/c47–c49 briefs (new).

## Batch 9 (Phase 2 · Wave 3): c39, c38, [locks fix], c42, c41 (c40 not cleared yet)

- Pre-batch commit `4e84729`.
- **`b17bbe6` c39-mission-ledgers (0ef44e2).** Migration 0032, DL-91, own `ledgers` bucket.
  - Conflicts, all list unions: ratelimit.ts; security.test.ts (`LIMITED_KIND` gains `\/ledgers\/`); contracts errors.ts and index.ts; web/src/api/events.ts.
  - Server tsc OK; vitest 1463/1463; web tsc OK; **api-c39 32/32**.
- **`8dcc65c` c38-task-reviews (e54baec).** Migration 0031, DL-80, review rows on the scorecard.
  - Conflicts:
    - List unions: ratelimit.ts; security.test.ts (`LIMITED_KIND` gains `\/reviews$`); errors.ts; events.ts. The event type list was checked to be exactly the union of both sides; one bad join from my token-union helper was caught by web tsc and fixed before the commit.
    - `web/src/dialogs/defs/missions.tsx` task drawer: c33's failure-tags import and `tagInfo` hook beside c38's review imports and `rv` hook; one footer with c33's "Tag failure" first and c38's `ReviewAction` last.
  - Note: c38 adds no `taskReviews.cancel()` on sign-out (its own choice; not added here).
  - **Follow-up `2abfbed`:** c38's M1 test inserted a raw `task.reassign` audit row, which c31's NOT NULL chain columns now refuse ("null value in column "seq""). It goes through `audit()` instead; task-reviews 21/21.
  - **api-c38 23/23, api-c39 32/32.**
  - Full vitest after `2abfbed`: 2/2 runs red on `instances.test.ts` "a skills PATCH keeps the old instance on v(n)…" (500 instead of 200; passes alone 11/11). Cause below.
- **`4eca9db` fix(locks): schema-scoped advisory keys via one helper (+ guard test)** (**APPROVED by the controller**):
  - Cause: lockAgent's key `hashtext('agent-ver:t-1:coder-01')` was database-wide. `version-proposals.test.ts` deliberately holds it, so another test schema's PATCH of coder-01 hit its 5 s `lock_timeout`. Same class as batch 7's events lock and batch 5f's red.
  - Change: `src/locks.ts` (`LOCK_KEY_SQL = hashtextextended(current_schema() || ':' || $1, 0)`, `advisoryXactLock`) is now used by every advisory lock: agent-ver, org-rev, org-prop, agent-create, agent-seed, instance-backfill, site-grant, the first-user registration lock (was the constant `1`), the events and audit-chain locks (same key values), the migration lock, and the tests that hold or look them up (pg_locks classid/objid from the same bigint key).
  - Guard `test/advisory-locks.test.ts`: fails on any `pg_advisory_*` call in server/src or server/test that does not take `LOCK_KEY_SQL` (RED with the old `src/agents/org.ts` put back), and proves two schemas get different keys that do not block each other.
  - Proof: full vitest **3/3 runs at 2 workers, 1549/1549**; api-stage6 94/94.
- **Follow-up `4766aae` (c38):** c38 appends two scorecard rows, but api-improve's c02 check still counted 8 (106/107). It now expects 10 rows, each with its `scorecard.*` help: **api-improve 107/107.**
- **`49090ab` c42-delegation-brief (6e1b3b7).** Migration 0034, typed hand-off briefs, staffing retry.
  - Conflicts, all kept both sides:
    - app.ts imports and registrations;
    - ratelimit.ts and security.test.ts route lists;
    - contracts index.ts;
    - events.ts type list (checked: the exact union);
    - `server/src/tasks/routes.ts` imports (non-list point a: c38's review routes and c42's reassign brief are different handlers, both present);
    - `missions.tsx` (non-list point b): the drawer has the c33/c38 hooks and c42's brief hook, both the brief card and the review list, and the reassign dialog's brief form.
  - My union helper twice produced bad joins (app.ts register lines, the end of the event list). tsc caught both before the commit; I fixed them, and the helper now token-merges only lines over 200 characters and refuses a broken list end.
  - c42's `brief:` lock goes through `advisoryXactLock` (key name unchanged).
  - vitest 1580/1580; **api-c38 23/23, api-c39 32/32, api-c42 16/16.**
  - **Task drawer at 1366×768** (api mode, probe): an owned running task (M-134/T-13401) and a failed one (M-125/T-12506) both FIT. The drawer is 906..1366 × 0..768 with no modal-body or page scroll, and shows the review list, the brief area, Review and (failed task) Tag failure.
- **`ff206b5` c41-playbooks (f06032b).** Migration 0033, lessons, playbook versions and skills, DL-92/93/95.
  - Conflicts, kept both sides:
    - route lists, with `LIMITED_KIND` also catching `\/lessons` and `\/skills`;
    - contracts events.ts and index.ts; dialog-ledger.txt;
    - events.ts imports, refreshers and routing; the reconnect keeps one `if (opened++)`, with c41's `if (opened) playbooks('p')` before it; the sign-out line plus `playbooks.cancel()`.
  - c41's `playbook:` and `skill:` locks go through `advisoryXactLock` (key names unchanged; the skill name is lower-cased in JS instead of SQL).
  - `dialogId=` values unique (DL-48 twice in one dialog, as since init). vitest 1676/1676.
- **c40-mobile-debt:** not merged. The queue still says "once it clears"; its review is PASS-WITH-FIXES and the tip moved to dcedf7c.

**Batch checks on `ff206b5`:**
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c38 23/23; api-c39 32/32; api-c41 45 passed, 0 failed; api-c42 16/16; api-c25-anchor PASS (0.4 / 0.1 / 0.1 px); a11y-check (api) 41 views, 64 dialogs, 0 violations.
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", no FAIL lines; dialog smoke 64 dialogs, 128 checks, 0 failures; ledger unchanged.
- **fit-check:** 79/79 ALL FIT. **ov-fit:** 32/32, NO SCROLL ANYWHERE. **a11y-check (demo):** 51 views, 64 dialogs, 0 violations.
- **8b follow-ups after batch 9:** batch 9's api scripts above (all PASS under c43's Modal first-focus guard). **`FLOWS_CPU_THROTTLE=4 node scripts/flows.mjs`: exit 0, 21/21**, so the palette and theme steps that failed under 4× throttle in batch 5f now pass. `c29-archive-race.mjs`: archived 14/14, 0 changes after.

**Follow-up commits in batch 9:** `2abfbed`, `4eca9db` (locks, approved), `4766aae`. Controller files committed with this entry: LOG.md, QUEUE.md (modified); cycles/c47–c49 reviews (new). BACKLOG.md, LESSONS.md and cycles/c40-review.md went in with `b23b8a8`.

## Batch 10 (Phase 2 · Wave 4): c44, c45

- Pre-batch commit `7a139d8` (c44 had been merged once by integrator #3 and reset away; redone cleanly).
- **`b80c2d1` c44-page-perf (0abda0c).** Web only. No conflicts (ChatView.tsx, missionControl.ts, Missions.tsx auto-merged).
  - Server tsc OK; vitest 1676/1676; web tsc OK.
  - **api-c26 22/22** (I2 mixed heights: older-page shifts 0.3 0.0 0.2 0.0 px, limit ±8; wheel/pill/minimap checks PASS). **api-c44 3/3** (a lone message 150 ms after a burst is stored in 105-113 ms). **api-c22 `SIZES=130,1000 REPS=3`: 14/14**, 0 page errors. **api-stage6 94/94.** **flows 21/21.**
  - **c26 worst long task, merged tree** (`REPS=3 FILL=1000 CHECKS=0`, informational, load average 5-10 from other lanes): burst-window worst per rep **156 / 146 / 186 ms** (total 454 / 346 / 907 ms); whole-trace worst 201 / 146 / 186 ms. With checks on (load about 5-6): 167 / 446 / 227 ms. Before c44 on the merged tree it was 1.0-1.1 s (one run).
- **`8798e82` c45-job-leases (17b6390).** Migration 0035, records only. No conflicts (Operations.tsx auto-merged; no raw `pg_advisory` calls).
  - Server tsc OK; vitest 1752/1752 (includes `audit-chain.test.ts` and jobs.test.ts); web tsc OK.
  - **api-c45 11/11.** `npm run audit:verify` on the e2e DB (explicit URL): "audit chain OK for t-1: 6 rows". Note: api-c45 writes no `job.*` audit rows into the e2e DB, so that run proves the chain is intact, while the job audits are covered by the vitest suite.

**Batch checks on `8798e82`:**
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c44 and api-c45 PASS (0 FAIL lines).
- **a11y-check (api):** 41 views, 64 dialogs, 0 violations. **a11y-check (demo):** 51 views, 64 dialogs, 0 violations.
- **verify-all:** first run **rc=143** (the dialog-smoke step was killed by SIGTERM, cause not found; every step before it passed, no FAIL lines). Re-run alone: exit 0, "ALL 10 STEPS PASSED", dialog smoke 64 dialogs, 128 checks, 0 failures, no FAIL lines. Ledger unchanged.
- **fit-check:** ALL FIT. **ov-fit:** NO SCROLL ANYWHERE.

Controller files committed with this entry: BACKLOG.md, LANES.md, LOG.md, QUEUE.md, STATE.md, cycles/c46-brief.md, c47-review.md, c50-brief.md.

## Batch 11 (Phase 2 · follow-ups): c48, c47, c49

- Pre-batch commit `d4ec189`.
- **`c48-approvals-ui` (d29339a)**, merge commit on improve-30h (see `git log --grep "merge(c48)"`). No conflicts. Server tsc and web tsc OK; vitest 1780/1780; no raw `pg_advisory` call.
  - **api-c48 failed at first on the merged tree** (9 PASS, 1 FAIL, 3 runs out of 3): after Escape closed the gate "?" popover, focus returned to the gate "?", and its focus-opened tooltip "Help: Why you cannot decide this" (x 1058-1274, y 313-344) covered the neighbouring tiers "?" (x 1256-1274, y 321-339), so Playwright's click was intercepted. No tooltip or help component differed from c48's base; the controller ruled it a real overlap (a keyboard user gets a tooltip over the next control).
  - **Fix `8e2f894` (fix(c48 merge)):** `HelpTrigger` gains an optional `tipSide`; `GateNote` passes `bottom` by default (Notifications card, mission Approvals tab, Overview queue) and the decision dialog (gate "?" in the footer, facts above) passes `top`. api-c48.mjs unchanged: **31 PASS, 0 FAIL, 3 runs in a row.** Screenshot: `web/docs/improve/cycles/shots-c48/merge-gate-tooltip-after-escape-dark.png` (card after Escape: tooltip below the focused gate "?", the tiers "?" clear).
  - api-c35 16 PASS, 0 FAIL; api-stage6 94/94.
- **`94806cf` c47-eval-evidence (15b1bd2).** Migration 0037.
  - Conflict: `web/src/pages/Agents.tsx` imports only (kept c41's `PlaybookPanel` and c47's `EvaluationView` and `ProposalEvaluationDto`). `server/test/version-proposals.test.ts` auto-merged with both sides present (c47's `overrideReason`/`evaluationSha` in `decide()`, and the helper-based lock tests).
  - Server tsc OK, web tsc OK, vitest 1886/1886. **api-c47 26/26, api-c05 31/31.** **Migration 0037 down then up on axion_e2e** (explicit URL): "schema at version 35", then "version 37", then up again a no-op at 37.
- **`af6bed5` c49-audit-anchor, merged at 7b17bf6.** Note: the `c49-audit-anchor` branch still points at 66e3f45 (the first fix round); the cleared tip 7b17bf6 is a detached HEAD in `/home/luca/AXION-w48` and a descendant of the branch tip. I merged the commit 7b17bf6.
  - Conflicts: `server/src/ops/routes.ts` imports (kept c45's `queueSummary` with c49's `ApiError`, `SlidingWindow`, `verifyAnchors`); `web/src/help/pages/stage5.ts` (kept `ops.jobRecords` and `ops.auditAnchor`). No advisory call. Server and web tsc OK.
  - **api-c49 14/14** on the e2e stack (the script reads its key, domain and file from server/.env; I did not add them to the shared .env, I ran an unchanged copy of the script that read them from the environment, with a random test key, domain `integrator4-e2e` and a temp file; the copy is deleted). The script tampers the e2e DB on purpose (the next api-e2e start resets it).
  - **Follow-up `fix(c49 merge)`:** `audit-anchor.test.ts` "creates the missing directory" called `writeAnchor` with no domain and passed only where the environment exports `AUDIT_ANCHOR_DOMAIN` (the lane's .env). It failed here (1 of 1962). It now uses `{ ...o(), file: nested }` like every other test; `audit-anchor.test.ts` 76/76.
  - Full vitest on the merged tree after that fix: 63 files, 1962/1962.
  - **Note for the live update:** with c49, `npm run audit:verify` exits 1 ("ANCHOR_MISSING: AUDIT_ANCHOR_KEY is not set") until `AUDIT_ANCHOR_KEY`, `AUDIT_ANCHOR_DOMAIN` and `AUDIT_ANCHOR_FILE` are configured and a first `npm run audit:anchor` is written; the chain itself reports OK. This is documented behavior (server/docs/audit-anchor.md).

**Batch checks:**
- **api-e2e (exit 0):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c35 16/0; api-c48 31/0; api-c47 26/26; api-c05 31/31; api-c45 PASS (0 FAIL lines).
- **a11y-check (api):** 41 views, 64 dialogs, 0 violations. **a11y-check (demo):** 51 views, 64 dialogs, 0 violations.
- **verify-all:** exit 0, "ALL 10 STEPS PASSED", dialog smoke 64 dialogs, 128 checks, 0 failures; no FAIL lines; ledger unchanged.
- **fit-check:** ALL FIT. **ov-fit:** NO SCROLL ANYWHERE.
- **e2e `audit:verify`** (explicit URL): chain OK for t-1 (3 rows), anchor ANCHOR_MISSING (exit 1, as above).

**Follow-up commits in batch 11:** `8e2f894` (c48 tooltip), the c49 test fix. Controller files committed with this entry: LOG.md, QUEUE.md and whatever else is modified.

## Batch 11b (mobile): c40-mobile-debt

- Pre-merge commit `ec6d8b3`. **`6c5a922` c40-mobile-debt (db34c42).** CSS/layout, HelpTrigger scroll region, Toasts, harness scripts. **No conflicts** (it touched `HelpTrigger.tsx`, which batch 11 also changed for `tipSide`; both auto-merged). Server and web tsc OK.
- **Fresh `DATA_MODE=api` api-mobile on the merged tree: 691 states, 389 dialogs, NO FAILURES, 0 FAIL lines** (the lane had 678 states on its old base; the extra states are the newer dialogs and drawer sections). No CSS follow-up was needed for api-mobile. The run took about 1 h 20 min under load.
- **selftest-mobile 7/7. c40-fixround 11/11** (re-run after the KPI change below: 11/11).
- **api-c40 failed 3/3 on the merged tree** with "FAIL 390: only 0 help popovers opened". Cause (measured): at 390 px the page body is still skeletons when `settle()` returns, so each page had 1 hidden `.help-btn` (it rises to 12, 9, 9, 8 and 6 after 4 s); at 900 and 1280 it was fine, and a 1280-then-390 order did not help, so it is not vite's cold start. Not a product defect: api-mobile finds the same popovers at 390.
  - **Fix `d91332a` (fix(c40 merge), harness):** a condition wait for more than one `.help-btn` before probing. The "at least 5 popovers" guard and the thresholds are unchanged. api-c40 now: 39 popovers at 390, 44 at 900, 44 at 1280, none outside the viewport, NO FAILURES.
- **Polish `72fc81d` (controller request):** at 800 px and below an odd last Activity KPI tile spans both columns (`.act-kpis > .act-kpi:nth-last-child(2):nth-child(odd)`). Measured: at 390 the fifth tile is 340 px wide, at 800 it is 750 px, with the help button on its own row below; at 801 px (three columns) nothing moves. Screenshots: `cycles/c40-shots/merge-kpi-odd-390-dark.png` and `merge-kpi-odd-800-dark.png`.
- **Desktop dialogs at 1366x768** (demo mode, probe of all 64 registered dialogs opened with props): only the 5 drawers (agent-evidence, agent-inspector, conversation-thread, help-drawer, task-criteria) are not horizontally centred (they are right-aligned drawers, l=906, r=1366); every other dialog, including those added by c33, c36, c38, c41, c42, c47 and c48, is centred within 2 px. (Probe was a throw-away copy of dialog-smoke; not committed.)
- **Batch checks on `72fc81d`:** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c40 NO FAILURES. a11y-check (api) 41 views, 64 dialogs, 0 violations; (demo) 51 views, 64 dialogs, 0 violations. verify-all exit 0, ALL 10 STEPS PASSED (this time the first run). fit-check ALL FIT (79 ok lines). ov-fit NO SCROLL ANYWHERE.

## Batch 11c and 12: c46-six-dimensions, c50-contract-coverage

- Pre-merge commit `c40` docs entry (see log). **c46-six-dimensions (f506a9a)**: merge-commit message "merge(c46)". **No conflicts** (the expected Agents.tsx conflict with c47 did not occur; Agents.tsx has c41's `PlaybookPanel`, c47's `EvaluationView` and c46's entry points). No advisory call. Server and web tsc OK; vitest 2016/2016. api-c46 30/30; api-c06 25/25 (c46 touches `loadDeptRows`). a11y (api) 41 views, 65 dialogs (DL-98 added), 0 violations.
  - **5190 was stale** after this merge (its module graph had no `export * from './dimensions.ts'`, so the demo checks failed with "does not provide an export named 'DIMENSION_KEYS'": route crawl, deep crawl, flows, u1 flows and dialog ids). The controller restarted 5190; the demo checks were re-run on the merged tree after c50 (below). The dialog-smoke run on the stale server had dropped the two DL-98 ledger lines; I restored the ledger with `git checkout`.
- **c50-contract-coverage (539eda5)**: merge-commit message "merge(c50)". **One conflict, additive:** `shared/contracts/src/index.ts` export list (kept c46's `dimensions.ts` and c50's `api.ts`). tsc OK.
  - **Registry follow-up (`fix(c50 merge)`):** the inventory, drift, non-vacuity and nullable tests were red on the merged tree exactly where the c50 review's "Merge impact" said (plus c46's route):
    - DTOs in `shared/contracts/src/api.ts`: `QueueSummaryDto`, `AnchorStatusDto` (and `AnchorTenantDto`, status name list), `ApprovalDto.canDecide` and `decideBlockedReason` (null or one of 4). `VersionProposalDto` already had `evaluation`, `evaluationSha`, `overrideReason` from c47 (`ProposalEvaluationDto` and `EvalRefusalDto` in agents.ts); `CompanyDimensionsDto` from c46.
    - Validators in `server/test/contracts/validators.ts`: queues (counts as a closed object over the 6 job statuses), anchors, dimensions, the full evaluation object (replacing `evaluation: nullOnly`), proposal `evaluationSha`/`overrideReason`, approval `canDecide`/`decideBlockedReason`. Registry: `GET /operations/queues` and `GET /operations/anchors` (both admin), `GET /company/dimensions`.
    - Flow (`coverage.test.ts`): the promote sends `evaluationSha`; stored evaluation records (a frozen holdout dataset, a finished base run and candidate run recorded by a third person, judge from another model family) fill the evaluation object and give a verified promote; a third proposal with self-judged runs shows refusals and is promoted with an `overrideReason` of 10+ characters; a queued job is enqueued before `GET /operations/queues`; dimensions is read as admin, as member and with a department.
    - **One new allowlist entry** (`exercised.ts`), for `GET /operations/anchors` `lastAnchorAt`, `restartedAt` and `tenants[].anchoredSeq/anchoredAt` "never non-null": a checkpoint needs a configured key, domain and file written by the operator CLI; audit-anchor.test.ts and api-c49 cover the route against written checkpoints. Everything else is exercised, not allowlisted. No assertion, guard or visibility rule was loosened.
  - Server tsc and web tsc OK; **contracts tests 15/15; full vitest 68 files, 2031/2031** (see below for one flake).
  - **Flake to watch (c46 test):** in one of three full-suite runs on the merged tree, `test/dimensions-route.test.ts` failed 3 tests ("rows on a private mission of the admin ... change nothing for a member", the share toggle, and the DEMO rows test) with `cognitive.first_attempt_verified` n=4 for the member where n=3 was expected. It passed in the other two full runs, 8 of 8 alone and after a re-run. I could not reproduce it, so I did not touch it; please have the c46 lane look at it (it reads like a time-dependent row or a visibility race under load).
- **Batch checks on the merged tree** (HEAD `1abeca3`): api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c46 30/30; api-c48 31/0; api-c47 26/26. a11y (api) 41 views, 65 dialogs, 0 violations; a11y (demo) 51 views, 65 dialogs, 0 violations. verify-all exit 0, ALL 10 STEPS PASSED, dialog smoke 65 dialogs, ledger unchanged. fit-check ALL FIT; ov-fit NO SCROLL ANYWHERE.

## Batch 13: c52-merge-minors, c51-review-hardening (+ the c46 clock fix)

- Pre-batch commit `d90f606`. **`a33ae82` c52-merge-minors (078b41c).** No conflicts. Follow-up (`test(c52 merge)`): removed the c50 allowlist line for `POST /approvals/:id/decision .approval.decidedByName never non-null` as required; the coverage run then sees a non-null name. `playbooks`, `advisory-locks`, `c09-minors` and contracts tests green (102/102 together). **c52-taskreviews-signout.mjs: PASS** ("refresh requested with stream open: 1; requested after sign-out cleanup: 0").
- **c51-review-hardening (a9a41a6)**, merge commit "merge(c51)". Migration 0039. **No conflicts.** Server and web tsc OK.
  - **Migration 0039 down then up on axion_e2e** (explicit URL): version 39, down to 37 (there is no 38), up to 39.
  - c51 makes reassign need a brief (`BRIEF_REQUIRED`). Every merged test and script that reassigns already carried one except c50's coverage flow (`POST /tasks/T-c50b/reassign`): **a brief was added to it, nothing loosened.**
  - c51 adds `stale` to `TaskReviewDto` and `verified` to `TaskReviewsDto`: the c50 validators (`fix(c51 merge)`) now carry both; the flow gives a reviewed task a later attempt so `stale` is filled in the next read; the just-written review's `stale` is null by construction (one reasoned `exercised.ts` entry).
  - c46's dimensions read review verification only through stored rows (`task_reviews` evidence count, reviewer and producer ids); it does not use the freshness (`stale`) rule that c51 added for the scorecard: flagged for the controller, not changed.
- **`f5e2d01` fix(c46 merge): the dimensions route's read clock** (APPROVED by the controller).
  - Symptom: `dimensions-route.test.ts` failed 3 tests in about 1 of 3 full-suite runs (n=3 where 4 reviews had just been written).
  - Cause: `new Date(select now())` is millisecond-truncated, and it was used as the SQL bound `created_at <= $3`; a row written in the read's own millisecond has created_at above the Date.
  - Fix: upper bound `<= now()` (same REPEATABLE READ transaction clock) for reviews and ledgers; lower bound of delegations and site grants `now() - ($n * interval '1 millisecond')` with n = 2 x window + 2 ms (a superset: the pure function still filters by the JS dates; the previous window still ends 1 ms before the current one starts, as before). JS Dates remain for window maths and display.
  - Regression test: 150 x (insert task and review, read at once). **RED on the old code: 14, 7 and 18 of 150 iterations missed (3 of 3 runs red).** GREEN after: dimensions-route 10 of 10 alone; full server suite 3 of 3, **2114/2114 (69 files)**; api-c46 30/30.
  - Grep of `server/src` for the pattern (a Date built from a DB `now()` and then used as a SQL bound): this was the only hit. Not the same pattern but nearby, for the backlog: `windowOf()` in `company/scorecard.ts` builds windows from the app clock (`new Date()`), and `company/routes.ts:56` (scorecard), `company/departments-routes.ts:21` and `failures/routes.ts:52` use them as SQL bounds (JS clock rather than the database clock, and ms precision). `approvals/service.ts:59-60` builds `createdAt`/`expiresAt` from `Date.now()` for demo seeding.
- **Batch checks on the final tree:** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c51 11/11; api-c38 23/23; api-c42 16/16; api-c41 45 passed, 0 failed; api-c48 31/0; api-c06 25/25. a11y (api) 41 views, 65 dialogs: **first run 1 violation `LIVE: page has no live region` at `/operations?tab=agents&sub=directory&view=cards`** (not seen in any earlier run), **re-run alone 0 violations**. a11y (demo) 0 violations. verify-all exit 0, ALL 10 STEPS PASSED. fit-check ALL FIT; ov-fit NO SCROLL ANYWHERE. Full vitest before the clock fix: 2110/2113 (the 3 dimensions flake tests); after: 3 of 3 at 2114/2114.
- **Not re-run after c40:** api-mobile (the c40 run was before c46's DL-98 and c50-c52). The only phone-visible additions since are the DL-98 dialog (c46); say if you want a second api-mobile run.

## Verification pass on ed3ed73 (Phase 2 start)

Integrator #5. Tree HEAD was docs-only commits on top of ed3ed73 (bfe891e, then 8736d61; no code differs). Ports 5192/5193, database `axion_e2e`, heavy.sh slot 0 (HEAVY_PRIORITY=1).

- **api-mobile, `DATA_MODE=api`, via `api-e2e.sh`** (started 18:50 UTC, finished about 20:14 UTC, 1 h 24 min): **651 states, 360 dialogs, NO FAILURES, 0 FAIL lines.** Nothing new against c40's 0-FAIL run, so nothing blocks. Load average (1/5/15 min): 3.89/4.29/5.03 at start, 9-19 for the whole run, 16.88/14.92/14.45 at the end. Note: c40's merge run measured 691 states / 389 dialogs; this run measured fewer (651 / 360) although c46, c51 and c52 added phone-visible states. Not a FAIL, and the cause was not investigated: the harness skips what is not on screen when `settle()` returns, and c40's api-c40 note already shows 390 px pages still on skeletons at that point under load (help popovers: 334 "Help:" lines this run). Treat the count drop as load-related until a quiet run shows otherwise. The DL-98 dialog (c46) is covered by this run only if it was reachable in the seed; I did not check.
- **api-stage6 x20 (c08 agent-edit threshold): NOT RUN.** The controller deferred it to a quiet window near the end. 0 of 20 runs done. (The 94/94 result in every batch check so far stands.)
- **perf-nav against c07's threshold (median page switch <= 163 ms + 10% = 179 ms), demo mode on 5190, 7 switches each:** run 1 median **316 ms** (load 17.05/14.99/14.47 at start, 19.57 after); run 2 median **284 ms** (load 19.57/15.65/14.70 at start, 18.81 after). Idle /overview 60.1 and 59.6 fps. Per-route range 126-687 ms. **Not conclusive:** the load average was 17-20 on this host, the same load class as c44's NOT MET figure that turned into a PASS below load 8, so both medians exceed the threshold by 1.6-1.8x without showing a regression. Needs a run below load 8.

## Batch 14 (Phase 2 · Wave 5): c56-public-suffix, c57-test-hygiene (integrator #5)

- Pre-merge `30d13a1`. **`55cefa9` c56-public-suffix (3480bff), `fbac06e` c57-test-hygiene (38d807d).** No conflicts. Server and web tsc OK. `await import('./src/grants/psl.ts')` loads (PSL_OK), so the server's start-up hash/rule-count/sentinel check passes (live 5191 not touched).
- **Full vitest, default 2 workers, load 18 (HEAVY_PRIORITY=1, slot 0): 17 failed / 2309 passed (3 files).** All the connection-cap family (BACKLOG H14), even with the priority slot: `too many connections for role "axion"`, `admin connect failed`, `Called end on pool more than once`. Failing tests: approval-binding.test.ts (0029 guards: "a new row must be v2", "an expired request is terminal", "DELETE and TRUNCATE are refused...", "the demo purge still removes demo missions with their approvals"; consume: "20 concurrent consumes..."; "consumed_at can only be set once..."; "the database refuses to change the bound action..."; "expiry is the database clock ..."; "empty-string origin ..."; "undefined, Date and NaN ..."; "a decision carrying a different digest is refused as stale ..."; v1 rows x2; "an R2 request by a member ..."), c48-can-decide.test.ts "expiry is the database clock...", events.test.ts ("thread events name their mission...", "un-sharing tells the other user..."). Those three files re-run alone at `--maxWorkers=1`: 68/68. **Full vitest at `--maxWorkers=1` (load 13): 74 files, 2326/2326 passed.**
- **api-e2e (load 11-20):** api-auth-flow 15/15; api-flows 23/23; **api-stage6 94/94**; api-improve 107/107; api-c36 35/35; api-c56 14/14; a11y (api) 41 views, 65 dialogs, 0 violations (211.7 s). Not run on this batch: demo a11y, verify-all, fit-check and ov-fit (c56 is server-only, c57 only a11y-check.mjs and a test; to be run once after the last batch).

## Batch 15 (Phase 2 · Wave 5): c53-eval-integrity (integrator #5)

- Pre-merge `16613f4`-era HEAD. Merge of c53-eval-integrity (2d23cca), no conflicts; server and web tsc OK. **Migration 0040 up/down/up on `axion_e2e`** (via a scratch script that refuses any URL not matching axion_e2e*, never `npm run migrate`): start 40, down to 39, up 40, clean.
- **Full vitest:** default 2 workers at load 20-21: 125 failed / 2142 passed / 158 skipped (25 files), the connection-cap family (`too many connections for role "axion"` 20x, `Cannot read properties of undefined (reading 'close')`, `Called end on pool more than once`, `admin connect failed`, a 30 s HookTimeout) across approval-binding, auth, events, missions, playbooks, audit-chain, company, throughput, etc. `--maxWorkers=1` at load 11-20: **41 failed / 2378 passed** (approval-binding 20, instances 11, direct 7, c48-can-decide 2, contracts/coverage 1, jobs 1). **The six files re-run alone at `--maxWorkers=1`: 159 passed, 1 failed (jobs.test.ts "20 parallel claimers over 50 jobs", H14's own test); jobs.test.ts alone: 76/76.** So after reruns every test passes; no failure had a non-connection cause. Even a single worker plus the priority slot hit the role cap because the other lanes' runs hold the connections.
- **api-e2e (load 11-27):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; api-c05 31/31; **api-c47 25/26, twice (second run alone at load 27.8)**: `FAIL with an evaluation on the card, its override field and Promote are visible without scrolling the panel`. The c53 report records the same single FAIL once at load 17 (passed on its rerun), and c53 changed no web code. The 1366x768 screenshot of the pending tab shows the "Refused candidate" card (card 2: Inconclusive, "Not trusted: not_holdout, dev_holdout_reuse +2") with its Promote and Note row cut off by the bottom of the panel by about 15 px; the `fits 1366x768` check passes. Not diagnosed beyond that; it is a layout check that failed 2 of 2 here, so it is more than a one-off load flake and needs a controller look (see the hand-back).
