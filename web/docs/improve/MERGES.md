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
