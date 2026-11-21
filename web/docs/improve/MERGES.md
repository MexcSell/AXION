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
