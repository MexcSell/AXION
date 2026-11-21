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
  - Nevertheless the reload navigation did not even commit until 52.5 s after it started. The `page.screenshot` right after it stalled 22.4 s before "waiting for fonts".
  - So the page's main thread was busy (browser-side). It was not the API, not Vite and not the dependency cache.
- **A/B on identical setup:** a throwaway worktree in the integrator's scratchpad, with its own node_modules of per-package symlinks, the priority slot and ports 5192/5193. The worktree has since been removed.

  | Build | Plain run | Debug run | Reload commit after start | Screenshot stall | Load avg |
  |---|---|---|---|---|---|
  | 74117b8 (before c07) | 34/35, same reload timeout | 34/35 | 48.9 s | 18.9 s | ~25 |
  | 648e32b (c07 merged) | — | 34/35 | 55.3 s | 25.3 s | ~25 |

  Both builds fail identically, and the difference is within single-sample noise at load ~25. c07 is not the cause.
- **History:** stage6 was 94/94 in lane runs c01–c05 at lower load. The failure is environmental or pre-existing on this tree. Possibly the page is still processing the 130-message burst when the reload is issued, and on a CPU-starved host that takes more than 30 s.
- **Status:** the controller is holding the merge queue (c05 → c13 → c04 → c11 → c16). c05's gate m5 needs api-stage6 green against axion_e2e.

**Follow-up commits:** none.
