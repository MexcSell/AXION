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

## Batch 16 (Phase 2 · Wave 6): c60-attribution-otel (integrator #5)

- Merge of c60-attribution-otel (df8c17e), no conflicts. Follow-ups: `chore(c60 merge)` the THIRD_PARTY_NOTICES.md OpenTelemetry entry (exact text from the row); **`fix(c60 merge)` (2 commits): c53 added `eval_runs.holdout_key`, so the c60 test `otel-mapping.test.ts > the mapping table > lists every column of every trace and task table, and nothing that does not exist` failed (89 columns in the DB, 88 mapped).** Added `'eval_runs.holdout_key': none` (internal uniqueness key, reason given) to `server/src/otel/mapping.ts` and regenerated `otel-mapping.md` with `src/otel/write-mapping-doc.ts` (its "generated from the table" test failed after the first edit). Server and web tsc OK. **Migration 0045 up/down/up on `axion_e2e`:** ok (down to 44 lands at version 40 because 0041-0044 are not merged yet; up returns 45).
- **Full vitest `--maxWorkers=1`, load 19-24:** first run 30 failed / 2446 passed (conversations 2, delegation-brief 12, site-grants 15: connection cap, `too many connections for role "axion"`; otel-mapping 1: the real one above). Re-run of those four files alone: 73/74, only the mapping test failed; fixed, then otel-mapping 9/9 and failure-attribution pass.
- **api-e2e (load 11-19):** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-c33 41/41; api-c60 10/10; a11y (api) 41 views, 65 dialogs, 0 violations (213.9 s).

## Batches 17, 18, 19 (Phase 2 · Wave 6): c58-rule-of-two, c59-origin-records, c61-eval-instruments (integrator #5)

- **Batch 17, c58 (7f31c94):** no conflicts. tsc OK. Migration 0043 up/down/up on `axion_e2e` ok. **Full vitest `--maxWorkers=1`: 2650/2650.** api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 107/107; **api-c58 39 PASS lines, 0 FAIL, "RESULT: all PASS"** (the row says 40; the script contains 39 `check(` calls, so 39 is its full count); api-c48 31 PASS 0 FAIL; api-c42 16/16; api-c41 45/0; a11y (api) 41 views, 66 dialogs, 0 violations. Load 9-20.
- **Batch 18, c59 (67b40ed):** **two conflicts, both import lists, keep both:** `server/test/contracts/validators.ts` (c58's DTO types + c59's `ORIGIN_CHANNELS, ORIGIN_CLASSES`) and `server/test/contracts/coverage.test.ts` (c57's `writeAnchor, rotateAnchor` + c59's playbook and retirement imports). tsc OK. Migration 0044 and 0045 round trip (down to 43, up to 45) ok. **Full vitest: 2694/2694.** api-c59 with `PLAYBOOK_ACTIVE_CAP=3`: 26 passed, 0 failed; api-c41 45/0. Release note (from the row): existing agent-proposed c41 rows become class `tool`. Not run on this batch alone: api-mobile, verify-all, demo a11y (planned once at the end).
- **Batch 19, c61 (43c1b7c):** one conflict, the `validators.ts` import list (c59's contribution/retirement types + c61's `GradingDto`, `DatasetValidityDto`): kept both. tsc OK. Migration 0046 up/down/up ok. **Full vitest `--maxWorkers=1`: 2785 passed, 1 failed:** `test/otel-mapping.test.ts > the mapping table > lists every column of every trace and task table, and nothing that does not exist` (`expected [... 89 more] to deeply equal [... 92]`): c61 added `eval_runs.grader_name`, `eval_runs.grader_version`, `eval_results.ungraded_reason`. **Follow-up `fix(c61 merge)`:** three `none` entries with reasons in `server/src/otel/mapping.ts`, `otel-mapping.md` regenerated; otel-mapping + otel-export 40/40, tsc OK (not a loosening: the test still demands every column be mapped). api-c47 **26/26** (at load about 13; it failed 25/26 twice at load 20-27 in batch 15, see there: the layout check is load sensitive, as the controller noted); api-c05 31/31; api-stage6 94/94; a11y (api) 41 views, 66 dialogs, 0 violations.

## Batch 21 (Phase 2 · Wave 5): c54-clock-dimensions (integrator #5)

- Merge of c54 (78e149f) after c58 and c61. **One conflict: `server/src/approvals/service.ts` `requestApproval`**: kept c58's `flags = deriveFlags(loadConfigProfile(...))` and its `evaluate(..., flags)` call, with c54's database-clock `stamp` (`new Date(stamp.at).getTime()` in place of `Date.now()`); c58's insert (with `rule_of_two`) and c54's SQL timestamps both stay. The dimensions-verdicts fixtures did not conflict and the tests pass unchanged (nothing loosened). tsc OK.
- **Full vitest `--maxWorkers=1`: 97 files, 2806/2806.** api-c46 36/36; api-c06 25/25; api-c51 11/11; api-stage6 94/94; api-improve 107/107; a11y (api) 41 views, 65 dialogs, 0 violations (DL-98 retired). Load 10-13. Not run on this batch alone: fit-check, demo a11y, api-mobile, verify-all (planned once at the end).

## Batch 22 (Phase 2 · Wave 7): c63-failure-learning (integrator #5)

- Merge of c63 (99376e4) after c60, c59, c54. **Conflicts:** `failures/routes.ts` imports (c63's contract constants + c54's `dbWindow`, `windowOf` import dropped); `failures/service.ts` `failureModeCounts` (c63's select and `group by 1..9` with c54's closed ms-grid predicate and `$6`; c63's `WINDOW_DAYS` removed); `test/contracts/validators.ts` import list (kept both); `otel-mapping.md` (regenerated from the table).
- **Required follow-ups, both done in the merge commit `2769728`:** (1) `patterns.ts` `proposeLesson(... channel: 'tool_output' ...)`; `failure-patterns.test.ts` now asserts `origin_channel='tool_output'` and `origin_class='tool'` on the derived candidate. (2) One shared closed predicate, `sqlInWindow(col, msParam)` in `server/src/company/clock.ts`, used by `failureModeCounts` and by `qualifying()` in patterns.ts (which had an open lower bound `>`; it now takes `days * 86_400_000` ms as `$5`). Boundary tests added to failure-patterns.test.ts: `sqlInWindow` exactly N days old inside, 1 ms older outside, a later row outside; and a tag just outside the 30 days (30 days 5 s old) is not counted in a candidate. (A first draft of the exact-edge test used `interval '30 days'`, which is calendar arithmetic and differs from 2,592,000,000 ms across a DST change; the test uses `720 hours`. Worth knowing for anyone writing a window test.)
- tsc OK; migration 0047 up/down/up ok. **Full vitest `--maxWorkers=1`: 99 files, 2839/2839.** api-c63 23/23; api-c60 10/10; api-c33 41/41; api-c41 45/0; api-stage6 94/94; a11y (api) 41 views, 65 dialogs, 0 violations. Load 9-19.

## Batches 23, 24, 20 (Phase 2 · Wave 7 and 5): c64-restructure-guardrails, c65-review-capacity, c55-thread-followups (integrator #5)

- **Batch 23, c64 (9f7582a):** one conflict, `shared/contracts/src/errors.ts` error-code list (c59's `ACTIVE_CAP_REACHED`, `ORIGIN_NOT_ALLOWED` and c64's `ORG_COOLDOWN`, `ORG_CHURN_BUDGET`): kept both. tsc OK; migration 0048 up/down/up ok. Full vitest `--maxWorkers=1`: 104 files, 2928/2928. api-c64 28 PASS, "ALL PASS"; api-improve **108/108**; api-c11 16/16; api-c20 14 PASS, 0 FAIL; api-stage6 94/94; a11y (api) 41 views, 65 dialogs, 0 violations.
- **Batch 24, c65 (fdcbaa0):** conflict in `server/test/contracts/validators.ts` import list: kept both. **Required clock follow-up done:** `server/src/capacity/model.ts` `reviewCapacity` and `reviewPeople` run in c54's `snapshotTx` when given a pool; `windowStart` is `dbWindow(c, key).from` (7/30/90 mapped through `WINDOW_DAYS`); the SQL keeps the `make_interval(hours => N*24)` lower bound and every `arrived >= w.s` is now `arrived between w.s and w.e` (closed upper bound `now()`). **A second merge impact:** `c65-contracts.test.ts` "NO ALLOWLIST LINE was added by this cycle" required the allowlist files to be byte-identical to c65's base 7f31c94, which c57 legitimately broke by deleting a line; it now asserts that no line was ADDED since the base (still fails on any added allowlist line). c65 tests, clock-bounds and contracts pass.
- **Batch 20, c55 (c1289a1):** merged with no conflicts; web tsc OK.
- **Checks on the tree with c55, c65 and everything before (HEAD after the c55 merge):** full vitest `--maxWorkers=1`: **111 files, 2973/2973**. api-e2e (load 7-14): api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 108/108; api-c65 0 FAIL; api-c58 all PASS; api-c48 31/0; api-c55 (THROTTLE=4) PASS (worst shift 0.4 px, no page errors); api-c26 REPS=3 FILL=1000 **22/22**, page errors 0; api-c44 PASS (excess 23 ms against the 80 ms margin); a11y (api) 41 views, 65 dialogs, 0 violations. **api-c22 `SIZES=130,1000 REPS=3`: first run 13/14, `FAIL N=1000: scrolling up loads the next older page, the top message stays put, no duplicates — 50 → 50 rows, shift 0.0 px` (load 14-17); two re-runs 14/14 and 14/14.** The row mentioned only an N=130 flake; this one was at N=1000. Not reproduced, recorded.
- **perf-nav (c07 threshold: median page switch <= 179 ms), run on the merged tree through the e2e Vite on 5193 (demo mode), 7 switches each, load 5.3-6.8:** medians **168, 161, 174 ms: all within the threshold; idle 60 fps.** At load below 8 this is a conclusive pass for the current tree. (The same script against 5190 gave 174, 176, 229 ms; but 5190 is stale, see below.)
- **5190 is STALE.** `curl http://127.0.0.1:5190/@fs/home/luca/AXION/shared/contracts/src/errors.ts` returns an error-code list that lacks `ACTIVE_CAP_REACHED`, `ORIGIN_NOT_ALLOWED`, `ORG_COOLDOWN` and `ORG_CHURN_BUDGET` (the last ORG_ code served is `ORG_INVALID`, then `BRIEF_REQUIRED`). The watcher stopped seeing `shared/contracts` changes (LESSONS: the same thing happened twice before). I did not restart it. verify-all, demo a11y, fit-check and ov-fit run against 5190 and so were **not run**: their result would not describe this tree.
- **api-stage6 x20: still deferred.** Load was 5-7 for about 20 minutes around the perf-nav runs, which would have been a usable window.

## Batch 25 (Phase 2 · Wave 7): c66-metric-guard (integrator #5)

- Merge of c66 (35bb4a9). **Conflicts:** `server/test/contracts/registry.ts` (c63's `GET /company/failure-patterns` and c66's `GET /company/metric-guard`: both kept) and the `validators.ts` import list (both kept). tsc OK; migration 0050 up/down/up ok (down to 49 lands at 48 because 0049 is not merged).
- **Writability inventory (the intended failures, scan unchanged):** after the merge 5 tests failed, as the controller predicted. Classified in `shared/contracts/src/metric-guard.ts`: `POST /failure-tags/:id/attributions` (c60) and `POST /skills/:sid/retirement-dismiss` (c59) in ROUTE_NO_INPUT with reasons; `failures/patterns.ts` as a declared `proposeLesson` caller (c63: system, proposed with channel `tool_output`, only an administrator can accept); `cli/e2e-extra-approvals.ts` as a `requestApproval` caller. **Beyond what the row listed, the scan also found:** `approvals/quality.ts` now writes `approval_decisions` (c58 moved the insert out of `approvals/routes.ts`, whose site claimed it: reported as a stale site) -> new site `recordDecision`, and `approvalRoutes` now declares only `approval_requests.record`; `cli/e2e-capacity-seed.ts` (c65) and `cli/e2e-extra-approvals.ts` (c58) writes -> two harness sites (system, e2e only); `evolution/eval-runs.ts` `startRun` writes `eval_runs` (c53) -> a system site, so `eval_runs.results` now has a writer, and the test line "eval_runs has no writer on purpose (the scan fails if one appears)" now expects every field written (that line said the scan would fail when one appeared; it did).
- **Other follow-ups:** scan limits added to the writability test header (SQL comments between keywords, string-built SQL, runtime `.sql`, namespace imports, re-exports, dynamic imports, edits inside `instances/service.ts`); `c66-contracts.test.ts` `minN: 60` -> 100; and `UNEXERCISED_ALLOWED.length` pinned to 14 failed at 13 because c57 deleted a line, so it is now "at most 14" (same shape as the c65 fix: may shrink, never grow).
- **Full vitest `--maxWorkers=1`: 117 files, 3014/3014.** api-c66 26/26; api-c46 36/36; api-c06 25/25; api-stage6 94/94; api-improve 108/108; a11y (api) 41 views, 65 dialogs, 0 violations. Load 11-16.

## Batches 26 and 27 (Phase 2 · hardening and UI): c70-hardening, c67-profile-fit (integrator #5)

- **Batch 26, c70 (bdfcbde):** no conflicts. tsc OK; migration 0052 up/down/up ok (down to 51 lands at 50, 0051 is not merged). **One full PARALLEL vitest (default 2 workers, load about 8): 120 files, 3051/3051, no connection-cap failure** (H14's mitigation held at that load).
- **Batch 27, c67 (111e6e5):** no conflicts; web tsc OK. api-e2e on the tree with c70 and c67 (load 9-11): api-auth-flow 15/15; api-flows 23/23; api-stage6 94/94; api-improve 108/108; api-c47 **26/26**; api-c05 31/31; api-c58 all PASS; api-c36 35/35; **api-mode fit-check `1366 768`: ALL FIT; `1280 760`: ALL FIT** (the new standard check, run on its own fresh stack each); a11y (api) 41 views, 65 dialogs, 0 violations (202.6 s).
- **api-mobile:** the run on the batch-25 tree was stopped by me (my own PIDs only) after about 33 minutes (300 of about 1,100 expected lines, no FAIL line yet) so the remaining batches could merge; it will be run once on the final tree. Not yet run on the tree with c54, c65, c66, c70 and c67.

## Batch 28 (Phase 2 · Wave 7): c68-attention-queue (integrator #5)

- Merge of c68 (7ba9f49). **One conflict: `server/test/contracts/validators.ts`** (c66's metric-guard validators and c68's attention validators: kept both). **The CSS auto-merged with no conflict** (`frame.css`: c54's tab fade and c68's `.tb-tabs > .tabs > .tab { flex: none }` both present; `overview-fit.css`; Tabs). 390 px tab strips are covered by the api-mobile run still to do.
- **Full vitest `--maxWorkers=1`:** 127 files passed, 1 failed: c66-writability (2 tests): **`cli/e2e-attention.ts` (c68's harness) imports `proposeLesson` and `requestApproval` and writes `tasks`, `task_attempts`, `task_reviews`, `failure_tags`, `agent_version_proposals`**, all unclassified. Fix: one `e2eAttention` system site (e2e only) plus the two HELPER_CALLERS entries; the scan is unchanged; c66 tests 17/17 after. `GET /attention` is read-only and needed no classification. Total then 3126 tests with that fixed.
- **api-e2e (load 8-12), one run each:** api-c68 **36 PASS, "all PASS"**; api-stage6 94/94; api-improve 108/108; **fit-check api 1366x768 ALL FIT, 1280x760 ALL FIT; fit-check demo (through the e2e Vite, since 5190 is stale) 1366x768 ALL FIT, 1280x760 ALL FIT**; ov-fit NO SCROLL ANYWHERE; a11y (api) **42 views**, 65 dialogs, 0 violations; a11y (demo) 52 views, 65 dialogs, 0 violations (the new Needs-you tab is the extra view).

## Batch 29 (Phase 2 · Wave 7): c69-process-metrics (integrator #5)

- Merge of c69 (0226053). **Conflicts:** `server/test/contracts/validators.ts` import list (c68's attention types + c69's `ProcessDto, ProcessCell, PROCESS_WINDOWS`: kept both) and `web/scripts/api-mobile.mjs` (the Operations tab list: c65/c68's `queues` plus c69's `agents&sub=dimensions` and `agents&sub=dimensions&view=process`: all 8 tabs in one list).
- **Required follow-up done (commit `79acbea`):** the 'approval time to decision' cell is measured from c58's stored `latency_ms`. One loader query in `process-routes.ts` (the latest decision per approval via a lateral join, `demo = false`, `latency_ms is not null`, window bound from the database clock) and one `measure` function in `process.ts` (median and p90, nearest rank, in hours; null below 20 decisions, the c58/c65 floor; department by the requesting agent; live missions; nothing recomputed from timestamps). Registry row now reads `approval_requests.record` and `approval_decisions.decision` (covers timeliness). **Derived consequence: its gameable flag is now true** (approval requests are written by `requestApproval`, an agent-identity site); pinned in `c69-registry.test.ts` as a reviewed decision. DEMO mode shows `n = 0` (no invented rows), the help text no longer says "unmeasured". Hand-computed fixture tests: latencies 1..20 h give median 10.5 h and p90 18 h; 19 decisions are below the floor (null, n 19); decided-before-window, demo-mission and other-department rows are excluded. The c66 route classification: `GET /company/process` and `GET /attention` are read-only and needed none (the test passes).
- **Second merge impact, found only by the browser script:** wiring the cell makes **six** measured cards in a grid of five columns, so the Process view wrapped to two rows: `api-c69` failed 5/40: "five measured cards, in order", "the two figures with no source ...", "the approval time and the cost are unmeasured in the API", **"the Process view fits 1366x768 without scrolling — {inner 65, noteBottom 758}"** and "390 px: ... every process card is on screen — 6 cards". Fixed in a follow-up commit: `c69-process.css` `.proc-grid` has six columns; `api-c69.mjs` expects six measured cards, cost as the only unmeasured figure, and the approval cell as `none` with n 0 on the seed. After that **api-c69 40/40** (including the 1366x768 fit and the 390 px check). The controller may want to look at the six-column cards at 1280 px (api fit-check below is ALL FIT, but it is a screenshot-less metric).
- **Checks:** full vitest `--maxWorkers=1`: **131 files, 3164/3164**. api-e2e (load 11-14): api-c46 36/36; api-c66 26/26; api-stage6 94/94; api-improve 108/108; fit-check api and demo, 1366x768 and 1280x760: **ALL FIT x4** (re-run after the CSS change); ov-fit NO SCROLL ANYWHERE; a11y (api) 44 views, 65 dialogs, 0 violations; a11y (demo) 54 views, 65 dialogs, 0 violations.

## Batch 30 (Phase 2 · performance): c71-scorecard-scale (integrator #5)

- Merge of c71 (75dd86d), no conflicts. tsc OK. **Migration 0053 up/down/up on `axion_e2e` ok** (the e2e DB has been migrated through 0053 on this tree).
- **Follow-ups done:** (1) c69's `process-routes.ts` now reads review freshness through `STALE_JOINS` + `STALE_FLAG` (the join form: one lateral join, the review's own attempt joined once) instead of `STALE_BEFORE_SQL` per row; `api-c69` 40/40 and the c69 process tests agree. (2) `/company/process?window=30d` added to `ROUTES` in `c71-budget.test.ts`, and **the budget test run once: 36/36 passed, load 7.7 at the start and 8.5 at the end** (180 s). (3) c68's `/attention` still calls `STALE_BEFORE_SQL` twice, but on one latest review per task of the rows already filtered, not per review row of the whole company, so the cheap switch was not made; it keeps working through the re-export.
- **Full vitest `--maxWorkers=1` (before the c71 follow-up commit): 135 files passed + 1 skipped (the budget test), 3178 passed, 36 skipped; no failure.** api-e2e: api-c46 36/36; api-c69 40/40; api-c68 all PASS; api-stage6 94/94; api-improve 108/108; api-c06 25/25.
- **Not done and open:** a full `DATA_MODE=api` api-mobile on the final tree (c54, c65, c66, c68, c69 and c67 all landed since the last complete run at c40 and the 18:50 run on ed3ed73; one run on the batch-25 tree was stopped by me at about a quarter of the way, no FAIL line yet); verify-all and 5190-based checks (5190 is stale, see batches 23, 24 and 20); api-stage6 x20 (deferred by the controller).

## Verification pass on 229536a (post live update; controller request)

- **verify-all against 5190 (restarted by the controller, serving the new contracts; checked with curl first), load 6.4-8.3:** the first run was **9/10: `deep crawl` failed with one line, `/missions/M-126?tab=overview ERROR Failed to load resource: net::ERR_NETWORK_CHANGED`** (a browser network event, not an app response). The deep crawl re-run alone: **NO PROBLEMS, rc 0** (15 missions, 24 agents). A second full verify-all (load 6.8-8.9 during, 6.8 at the end): **ALL 10 STEPS PASSED**, no FAIL line, the dialog ledger unchanged (tree clean).
- **api-mobile, `DATA_MODE=api`, full run on the merged tree (229536a plus docs):** started 02:11 UTC at load 7.12 8.89 8.74; load during the run 5.1, 2.2, 9.8, 9.6-11.9 (a lane burst around 02:46), 5.7, 2.7, 3.8, 4.1, 4.9, 4.6; ended 03:33 at load 5.01 4.67 5.25. **862 states, 494 dialogs, NO FAILURES, 0 FAIL lines** (1 h 22 min). **390 px tab strips:** `tabsAt` scrolls each tab into view and clicks it; the Overview tabs measured at 390 are Pulse, **Needs you (c68's 5th tab)**, Portfolio, Activity and Health, each `over=0 clipped=0`; Operations (agents&sub=dimensions and view=process, queues and the others) measured too, all over=0 clipped=0. So c54's tab-strip fade and c68's `.tab { flex: none }` coexist without a phone FAIL.
- **api-stage6 x20 (the c08 agent-edit threshold), `api-e2e.sh api-stage6.mjs`, fresh stack per run, load 5.1-7.7 (1/5/15-minute averages 2.6-7.7 throughout): 20 of 20 runs 94/94, 0 FAIL lines, rc 0 each** (03:36-04:07 UTC, about 96 s a run). Load stayed below 10 for the whole series, so this is a conclusive pass of the threshold (the c08 agent-edit step did not flake once in 20 runs).

## Batches 31-37 (Phase 2 · Wave 7, polish, tooling, security, hygiene): c72, c73, c74, c75, c78, c80, c79 (integrator #5)

Order merged: c72 (6511c04), c73 (59b78cf), c74 (8d9a9c3), c75 (af54328), c78 (96ed66e), c80 (909577e), c79 (6ee88cf); every tip equals the cleared one. Verification pass numbers are in the section above.

- **Batch 31, c72-skill-ratings:** conflicts in `shared/contracts/src/index.ts` (c69's `process` export and c72's `skills` export: both kept) and the `validators.ts` import list. **The no-ranking key scan on every coverage response did not trip** on c68's `/attention` or c69's process routes. One merge impact: `c69-registry.test.ts` "task_owner_history is written only by a database trigger" failed with `e2eSkillFixture: expected true to be false`, because c72's `cli/e2e-skill-fixture.ts` site lists `tasks.owner` but not its trigger-written `task_owner_history.owner` (c69's rule); added the field to that site. Full vitest `--maxWorkers=1`: 3222 passed, 36 skipped. api-c72 **55 PASS, 0 FAIL**; api-c42 16/16; api-c66 26/26; api-stage6 94/94; api-c68 all PASS; fit-check api 1366x768 and 1280x760 ALL FIT; a11y api 44 views, 65 dialogs, 0 violations; a11y demo 54 views, 65 dialogs, 0 violations. **Demo fit-check at 1366x768: one `BAD /agents/coder-01?tab=performance  mainOver 0 regions []`** (no `.fit-scroll` found yet, i.e. the tab had not rendered its body after the 600 ms wait); not reproduced in 3 re-runs of that route (`regions [[338,494]]`, ALL FIT) and the 1280x760 demo run was ALL FIT. Recorded as a transient.
- **Batch 32, c73-polish:** merged with no conflicts. Full vitest 142 files passed + 1 skipped, 3232 passed, 36 skipped. At load 2.6-5: api-c73-pin BURST=100 and BURST=200 all PASS (0 px from the bottom, newest visible, pill 0; reader scrolled up is not pulled back); api-c26 REPS=3 FILL=1000 **22/22**; api-c55 THROTTLE=4 PASS (worst shift 0.2 px, no flake this time); api-c44 THROTTLE=4 PASS (excess 10 ms, bar 80 ms); api-c55-burst pinned in 3/3 reps; api-c73-psl (`DATA_MODE=api`) PASS (fresh, stale 120 d, age unavailable); api-c56 14/14; api-c60 10/10; api-flows 23/23 (also 23/23 under the throttle line, though that env var only affects `flows.mjs`); **demo `flows.mjs` plain and `FLOWS_CPU_THROTTLE=4`: 21 PASS each, no FAIL**; api-stage6 94/94; fit-check api and demo, both sizes, ALL FIT x4; a11y 0 violations in both modes.
- **Batch 33, c74-shared-watch:** no conflicts; `vite.config.ts` now has `watch: { usePolling: true, interval: 300 }`; web tsc OK. `shared-watch-check.sh` was not run (it rewrites `shared/contracts/src`; the controller restarts 5190 after the merge).
- **Batch 34, c75-approval-evidence:** no conflicts (approvals/service.ts merged cleanly with c54 and c58). Full vitest 145 files passed + 1 skipped, 3251 passed, 36 skipped. api-c58 all PASS; api-c48 31/0; api-stage6 94/94. **e2e-only seed -> clear -> reseed -> decide:** the c75 test `F1: demo seed, clear, re-seed (same approval ids, new request rows) still decides and consumes` passes in the full run; and on `axion_e2e` (a scratch script that refuses any other URL), after api-c58's decisions: chain OK 29 rows, `clearDemo` (13 missions) -> chain OK 30, `seedDemo` (13 missions, 4 approvals) -> chain OK 35. Nothing was run against the live DB; `demo:clear` and `audit:verify` were not used (their CLIs read the live `.env`).
- **Batch 35, c78-test-hygiene-2:** no conflicts. **Required follow-up done:** `RATING_FIELDS['GET /agents/:id/skills'] = ['classes[].adjusted.value']`, with a reasoned `RATED_LIST_ALLOWED` entry for `GET /agents/:id/skills::classes` (one agent's own cells, one per task class, fixed class order); the H20 scan, c72's no-ranking tests (including the metamorphic reversal over the coverage bodies), contracts, c71 and org tests: 156 passed, 36 skipped.
- **Batch 36, c80-migration-guard:** no conflicts; its generated four-guards test and the migration lint with its frozen baseline pass in the full run.
- **Batch 37, c79-tenant-isolation:** no conflicts, **but the route-generated sweep tripped on c72's `GET /agents/:id/skills/compare`:** `admin/member GET /agents/:id/skills/compare 400` ("every generated case really answers") and `FOREIGN-GET ... status 400, expected 404 or 403`. Diagnosis, before changing anything: the route needs a second agent (`?with=`) and answers 400 before its tenant check when it is missing, so the generated URL never reached it; the handler itself resolves both agents with `getAgent(app.db, ctx.tenantId, ...)`. Fix (harness input, not an exception and nothing loosened): `QUERY['GET /agents/:id/skills/compare'] = ['?with=__agent2__']` in `test/tenant/isolation.ts` and `ids.tester` in `test/tenant/fixture.ts`. Then the own-tenant case answers 200, a foreign `:id` is 404, MR1 and MR3 (marker absence) pass for both tenants, and the 17 seeded mutants are still caught: `test/tenant` 27/27. **No isolation finding.**
- Full vitest after all seven merges: see the next line.
- **Full vitest `--maxWorkers=1` on the final tree (after the c79 harness fix): 152 files passed + 1 skipped (the c71 budget test), 3414 passed, 36 skipped, no failure.** (The run before the fix had exactly the 3 c79 failures named above.) Not re-run after batches 31-37: verify-all (5190 had not yet been restarted for c74's polling) and a full api-mobile on the final web tree (the controller's end-of-freeze pass); the api-mobile in the verification pass above was on 229536a, before c68's later web changes landed only c73 and c74 touched `web/`.

## Batch 38 (Phase 2 · Wave 8 · E1e): c84-judge-split (integrator #6)

- **Merged:** 2026-11-23 about 07:12Z, `--no-ff`, tip verified equal to 4b5158e before merging. **Merge commit 69c799c.** No conflicts, no migration, no `shared/` or `web/` change (server only).
- server `tsc --noEmit`: OK.
- Targeted (judge-calibration, judge-calibration-remedies, eval-attestation, eval-audit, eval-evidence, eval-evidence-db, eval-integrity-db, eval-model): 8 files, **324/324 passed**.
- **Full vitest `--maxWorkers=1 --no-file-parallelism` (heavy.sh, normal slot): 152 files passed + 1 skipped, 3429 passed, 36 skipped, 1 failed.** The failure: `test/auth.test.ts > connect > disabling a signed-in user revokes their session`, first error line `Error: admin connect failed {"code":"INTERNAL","message":"Something went wrong on the server. Try again.",...}` (withAdmin, test/helpers.ts:73). A transient 500 on the admin connect during a run with other heavy jobs on the machine; **re-run of auth.test.ts alone: 22/22 passed.** c84 does not touch auth. Treat as a flake, watch for recurrence.
- Not run (server-only batch): web checks, api-mobile (the controller's baseline holds ports 5192/5193), verify-all.

## Batch 39 (Phase 2 · Wave 8 · M2b): c83-metric-guard-2 (integrator #6)

- **Merged:** 2026-11-23 about 07:45Z, `--no-ff`, tip 3ef9d2d verified. **Merge commit 6ade4d4.** No conflicts, no migration. Server and web tsc OK. A served `metric-registry.ts` on 5190 exports `parseSampleRef`.
- Targeted (c83 x3, c66 x6, c69 x3, test/contracts): 15 files, 116/116. **Full vitest `--maxWorkers=1 --no-file-parallelism`: 156 files passed + 1 skipped, 3450 passed, 36 skipped, 0 failed.**
- Browser checks on ports 5292/5293, database `axion_e2e5` (the controller's api-mobile baseline held 5192/5193): api-c46 36/36, api-c69 40/40, api-c66 28/28 (100 typed records labelled, free-text ref refused 400, run last), no FAIL lines, no page errors.

## Batches 40, 41, 42 (Phase 2 · Wave 8): c81-tenant-fixes, c86-forecast-ledger, c85-change-plans (integrator #6)

- **Batch 40, c81 (2afe16c, merge 2181361):** no conflicts. The MR2 swap test tripped on c83's `POST /company/metric-audits`: `swap.ts` sent a free-text `sampleRef: newName('s')`, which c83 refuses with a 422 whose body echoes the unique name, so the plain and forged requests could never match. A stale harness input, not a leak. **Fix `7095740` (`fix(c81 merge)`):** the case now sends `mission:<tenant A's own mission id>`. No exception, nothing loosened. Proof: test/tenant 5 files, 42/42 pass (including MR2 and MR4); mutants test passes with all 23 mutants killed; no other free-text `sampleRef` exists in test/tenant (swap, forged, writes, isolation: only swap.ts:61). **Full serial vitest: 160 files + 1 skipped, 3466 passed, 36 skipped, 0 failed.**
- **Batch 41, c86 (d84882d, merge e0a1f58):** no conflicts, migration 0059. tsc OK. Targeted (c86 x3, c80 x2, c51, c66, c78, reviews, test/tenant, test/contracts, c83 columns): 20 files, 286/286.
- **Batch 42, c85 (0f1a26b, merge 34661c8):** one conflict, `shared/contracts/src/index.ts` export list: kept both (`forecasts.ts`, `org-plan.ts`). Migration 0058 after 0059 (migrator applies any missing version). Server and web tsc OK. **Full serial vitest on the final tree: 168 files + 1 skipped, 3544 passed, 36 skipped, 0 failed** (c80 migration guards and the tenant sweep included).
- **c83 column guard scope (reported, guard not changed):** `companyFiles()` scans only `server/src/company/*.ts`, plus loaders that a registry row names. Neither `server/src/forecasts/` nor `server/src/organization/plan-metrics.ts` is named, so both are **outside** the guard's loader scope.
- Not run: browser checks for 41/42 (server and contracts only).

## Batch 43 (Phase 2 · Wave 8c): c87-visibility-sweep (integrator #6) -- finding open

- **Merged:** `--no-ff` of 4756324, merge commit 7b1bbc5, no conflicts, no migration. **Follow-up commit** `fix(c87 merge)`: removed the `POST /notifications/:id/ack` FINDINGS entry (c81's fix is on the tree). server tsc OK. test/tenant, c87/c65 tests and test/contracts: 125 tests, 124 passed; the ack case passes (404 for both ids).
- **One failure, a finding on a merged route (c86):** `test/tenant/vis.test.ts > NOT_REACHED`: `unchanged routes with no entry in NOT_REACHED: expected [ 'GET /me/forecasts' ] to deeply equal []`. The sweep's administrator response for `GET /me/forecasts` does not change in the private-mission states, so the sweep is vacuous there and the table has no entry. No entry added. Reported to the controller; full vitest and the web checks not run yet.

### Batch 43 resolved (integrator #6)

- **c87-visibility-sweep:** merge 7b1bbc5; follow-ups `589688a` (ack FINDINGS entry removed; 404 for both ids passes) and **`efa6ab2` (`fix(c87 merge)`, test-only, no table entry):** the NOT_REACHED trip on `GET /me/forecasts` was made reachable instead of excused. `vis-fixture.ts`: M and the administrator each forecast a task of M's visible mission through the real `POST /tasks/:id/forecasts` before its first review (research, difficulty 2); two earlier visible research/2 outcomes are reviewed first (M's baseline n = 2, under the floor of 5). The private mission's hidden research/2 tasks are inserted directly (the tables are append-only, inserts are allowed) with briefs and first reviews **backdated to before the forecasts' made_at**: 3 accepted in b1, 2 rejected in b2. The administrator's baseline moves (n 5, rate 1, then n 7, rate 5/7); M's stays identical.
- **Proof it is not vacuous:** scratch edit of `server/src/forecasts/ledger.ts` (VISIBLE_SQL removed from the `hist` CTE only), `vis.test.ts` failed on `V1 | GET /me/forecasts | member`: a->b1 `skill.n, skill.text, forecasts[].baseline` and b1->b2 `forecasts[].baseline.n, rate, brier, logLoss`. The edit was reverted (`git checkout`), not committed. Also added **mutant V11** (`histAnyone` seam, the same fault in the test process): `vis-mutants.test.ts` 12/12, all 11 mutants killed.
- Checks on the tree: test/tenant 42+ passing; **full serial vitest 171 files + 1 skipped, 3566 passed, 36 skipped, 0 failed**; web tsc OK; api-c65 37 PASS, 0 FAIL; fit-check api 1366x768 ALL FIT.

## Batch 44 (Phase 2 · Wave 8d): c88-evidence-scope (integrator #6)

- **Merged:** `--no-ff` of 1f8ba45, merge commit 4df4ae2, no conflicts, no migration. **`fix(c88 merge)` 7a3acc6:** removed the `/organization/proposals` FINDINGS entry; the sweep passes (member evidence invariant). The optional stray whitespace line in `proposals.ts:92` was left alone.
- server and web tsc OK. test/tenant, c88 and c83 tests, contracts: 14 files, 104/104. **Full serial vitest: 172 files + 1 skipped, 3573 passed, 36 skipped, 0 failed.**
- api-c88 (DATA_MODE=api), api-c64, api-c20 via api-e2e.sh on 5192/5193: 0 FAIL lines (57 PASS lines); `check-help.mjs` (verify-all's help-keys step): 540 entries defined, "All referenced help keys are defined" (`org.proposal.evidenceHidden` is defined in `help/pages/overview-org-agent.ts` and used in `OrgRestructure.tsx`). fit-check api 1366x768 ALL FIT; fit-check demo (5190) exit 0.

## Batches 45, 46, 47 (Phase 2 · Wave 8e): c92-script-guards, c90-sequential, c91-skill-gate (integrator #6)

- **Batch 45, c92-script-guards (fd6a021, merge 15d7a68), batch 46, c90-sequential (16efdda, merge e87de40), batch 47, c91-skill-gate (8734f80, merge 060f9ab):** all three tips verified, merged back to back, no conflicts, no migration. Server and web tsc OK.
- **One full serial vitest after all three: 175 files passed + 1 skipped, 3620 passed, 36 skipped, 0 failed** (includes c92-script-base, c83-registry-columns, the sequential and skill-gate tests; a first run on batch 45 alone was stopped by the integrator to merge 46 and 47 first, so it counts for nothing).
- **verify-all from the integration tree (default BASE, 5190, nothing exported): ALL 10 STEPS PASSED** (typecheck+build, route x tab crawl 81 views, deep crawl, flows, auth flow, u1 flows, dialog smoke, dialog ids, help keys, dev-server file guard); no FAIL or Error lines.
- Not run: browser checks beyond verify-all (these batches are scripts and pure server modules).

## Batches 48-54, final checks on the frozen web tree (integrator #6)

- **Batch 48, c82-tabstrip (67d995d, merge 79f6e28):** no textual conflicts (`fit-check.mjs` and `crawl-deep.mjs` auto-merged; both c92's `resolveBase` and c82's rendered-main wait and single ERR_NETWORK_CHANGED retry are present). **Merge interaction, fix `e2300f9` (`fix(c82 merge)`):** c82's new `web/scripts/c82-pixel.mjs` defaulted `BASE` to 5190 on its own, which c92's guard test refuses; it now uses `resolveBase()` (argv[2] stays the shot directory). c92-script-base 6/6. The guard test is unchanged.
- **Batch 49, c93-conn-cap (1a5d2b6, merge 563c9bc):** no conflicts. c93, auth, site-grants, playbook and jobs tests: 6 files, 207/207.
- **Batch 50, c89-plans-forecasts-ui (1983259, merge 3b3748c):** no conflicts (the last web merge; the web tree is frozen at 3b3748c plus c82's script-only fix).
- **Batch 51, c95-run-caps (f71fa58, merge 0d6f5a2), batch 52, c94-exec-profile (db0995f, merge b333330), batch 53, c96-plan-conformance (381304e, merge 2594efa), batch 54, c97-outcome-graders (c69e5b1, merge cc632d3):** no conflicts, no migration.
- **Final full serial vitest on the final tree (cc632d3): 187 files passed + 1 skipped, 4409 passed, 36 skipped, 0 failed** (an earlier run on 51-53: 184 files, 4363 passed, 0 failed).
- **Final checks on the frozen web tree** (web tsc OK; production build OK: entry chunk 107.2 kB gzip, Missions chunk 30.1 kB gzip, 669.7 kB gzip for all JS together; no `/missions` first-load figure is printed by the build): verify-all ALL 10 STEPS PASSED (from the integration tree, 5190 default; also on the 48 tree); fit-check demo and api at 1366x768 and 1280x760: ALL FIT x4; a11y demo 55 views, 66 dialogs, 0 violations; a11y api 45 views, 66 dialogs, 0 violations (batch 48 tree: demo 54/65, api 44/65, 0 violations); api-c89, c88, c64, c20, c38 (DATA_MODE=api): 143 PASS lines, no FAIL; `api-e2e-preview.sh "node scripts/api-c14.mjs"` (production build and strict CSP): 31/31 PASS, no CSP violation; **api-mobile full (DATA_MODE=api): NO FAILURES**, exit 0 (only the SMALL tap-target lines it prints for information).
- **`Request failed (500)` lines in the api a11y output:** 1 (batch 48 tree: 2), all inside the `probe ... fail` rows. They are the a11y check's own mocked failures (`a11y-check.mjs` fulfils the probed route with `status: 500, message: 'mocked failure'` to see the failure state), not server errors; the e2e API log has no 500 and no error line. Demo mode: 0.
- Batch 48 checks on its own tree: verify-all 10/10, fit demo and api x4 ALL FIT, api-c82-tabs, api-c46, api-c68 exit 0 (36/36 on the one that prints a total).
- Slots: the api-mobile run held slot 0 (HEAVY_PRIORITY) and the other checks used normal slots and ports 5292/5293 with `axion_e2e5`. Load averages 2.7-5.8 during the runs.

### Fix after the freeze: c94 contracts file imported node:crypto (integrator #6)

- **Found by the controller on HEAD:** web tsc failed with `shared/contracts/src/exec-profile.ts(9,28): error TS2591: Cannot find name 'node:crypto'` (the web project typechecks the whole `shared/contracts` folder). My web-tsc pass ran before batch 52 merged and I did not re-run it on the final tree; the production build and api-c14 were unaffected because nothing in the web app imports that file. Lesson: re-run web tsc after every merge, including server-only batches that touch `shared/`.
- **Fix `7678a3f` (`fix(c94 merge)`):** `execProfileSha256` and the `node:crypto` import moved to `server/src/exec-profile/hash.ts`; `canonicalJson` and the types stay in the contract; the validator and the two c94 tests (schema, validator) import the hash from the server module. Nothing added to `index.ts`. `shared/contracts/src` has no other `node:` import.
- web tsc exit 0, server tsc exit 0, production build ok; full serial vitest **187 files + 1 skipped, 4409 passed, 36 skipped, 0 failed**.

### Close-out, 2026-11-24 (controller; the loop had stalled after batch 55 at about 13:00Z on 2026-11-23)

- **Batch 55, c98-test-infra (19e0592, merge 960e975):** merged by the controller at 12:55Z on 2026-11-23, no conflicts, test infrastructure plus the `src/db.ts` PoolOpts change (production pool max 10 and the 53300 retry unchanged). It was not recorded here at the time.
- **Batch 56, c99-exec-hardening (4d99d45, merge b598113):** no conflicts. The diff is server source and tests plus the c99 report only (16 files, +999/−103); no `web/`, `shared/` or migration change.
  - server tsc exit 0; **web tsc exit 0**.
  - **Full serial vitest on b598113 (`npx vitest run --maxWorkers=1 --no-file-parallelism`): 196 files passed + 1 skipped, 4489 passed, 36 skipped, 0 failed.**
  - Browser checks were not re-run: the web tree has been unchanged since the freeze (batches 51–56 touch no `web/` source).
- **Live update 2026-11-24 ~01:02Z to b598113:** stop 5191 by PID; backup `backups/axion-20261124T010230Z.dump`, restore check PASS; migrate no-op (schema 59); audit verify OK; restart from a clean tree (PID 3577265); audit anchor line 6; verify OK; health `GET /api/v1/health` 200 direct and via 5190.
- 01:10Z: 5191 relaunched detached with `setsid` (the first start was not a session leader); PID 3577265; audit verify OK; health 200 direct and via 5190.

### Owner took the parked branches (Q11), 2026-11-24

- **Batch 57, c76-stage8-records (dfd1bff, merge c69b48c):** one conflict in `server/test/contracts/validators.ts` (two additive hunks, c72/c86 validators beside c76's release and artifact validators; both kept). server and web tsc exit 0.
- **Batch 58, c77-stage9-records (da75e62, merge eaca1a7):** no conflicts.
- **First full serial run: 6 failed**, all in the privacy sweeps (`test/tenant/c81-swap`, `real`, `vis`), which were built after c76 was parked: the c76 routes had no generated case. **Fix `2d81672` (`test(c76 merge)`):** the tenant fixture records an artifact, a release and a last-good mark per tenant (with markers); `artifacts:id` and `releases:id` id sources; foreign-id write cases for `POST /artifacts/:id/versions` and `POST /releases/:id/marks`; swap cases for `POST /artifacts` and `POST /releases`; NOT_REACHED reasons for `GET /artifacts` and `GET /releases` (administrator-only, no mission data). No sweep was loosened. test/tenant 7 files, 60/60.
- **Full serial vitest after the fix: 201 files passed + 1 skipped, 4587 passed, 36 skipped, 0 failed.**
- **Live update ~04:49Z:** stop 5191; backup `axion-20261124T044814Z.dump`, restore check PASS; migrate applied 0056 and 0057 (`schema_migrations` now 59, 58, 57, 56, 53, ...; tables `releases`, `artifacts`, `usage_ledger` present); audit verify OK; restart detached (PID 3818198); anchor line 7; verify OK; health 200 direct and via 5190; `GET /releases` and `GET /artifacts` answer 401 without a session.
