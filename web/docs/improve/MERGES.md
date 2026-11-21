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
