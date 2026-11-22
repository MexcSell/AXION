# c69 brief: process metrics next to outcomes (R3-5)

**Lane:** w67 (`/home/luca/AXION-w67`, branch `c69-process-metrics`). **Branched from `c66-metric-guard` at 35bb4a9.** c66 is cleared and queued as batch 25. Its metric registry must cover every new row, and its route and writability tests must classify any new write. Ports 11790–11793. E2E DB **axion_e2e6** (reused). No migration unless needed (ask the controller for a number).

**Docs:** read these **read-only** from `/home/luca/AXION/web/docs/improve/`:
- `phase2/research-r3.md` §R3-5;
- `phase2/research-r3-verified.md`, the required changes;
- `PHASE2.md`.

**Evidence honesty:**
- Build only what today's records support. Cost stays null until Stage 9.
- The rework and first-pass definitions in the sources are UNVERIFIED, so **this brief defines them**.
- Don't cite A8 or B5's "11×".
- Claim no "good" threshold.
- **The lag check is dropped** for this wave, because it needs 8 weekly points. Keep a leading or lagging tag only if the UI uses it to say what the metric tends to predict, in plain words, and say that's a design label, not a measured result.

## Definitions (implement exactly these, and adapt names to the real data model)
- **Return-for-rework rate:** among tasks whose first review decision falls in the window, the share returned (not accepted) on that first decision. The cause is the recorded review reason or failure tag mode, shown as a breakdown with n. Open (unreviewed) tasks are reported separately, never in the denominator.
- **First-pass acceptance:** among tasks with at least one review decision in the window, the share accepted on attempt 1, using c51's freshness rule, so a stale review never counts.
- **Duplicate delegation:** two or more delegations in the same mission whose normalised goal text is identical within the window. Normalise by trimming, lower-casing and collapsing whitespace. Report count and share, with n.
- **Reassign churn:** owner changes after the first assignment per task, from `task_owner_history` (c51). Report the median and p90, null below 20 tasks, with n.
- **Handoff wait:** time from delegation created to the delegate's first action, and approval time-to-decision. **Reuse c58/c65's stored latency**; don't recompute it. Use DB time only.

## Items (each test-first, each its own commit)
1. The read model, with **exact-equality unit tests on hand-computed fixtures** for every metric. Open items are reported separately from closed ones in every rate.
2. **c66 registry rows** for every new metric: a counter-metric (or "none known" with a reason), the uncovered dimensions and the inputs. The writability inventory has to classify every input. The gameable flag follows from the inventory, never hand-typed.
3. **UI:**
   - A "Process" group next to the outcome rows on the company and department views. Use c54's Dimensions tab or the KPI area, whichever keeps one screen.
   - Each figure shows n, window, the formula on `?`, and c66's guard popover.
   - It must fit 1366×768 and work at 390 px.
4. **Contracts:** registry, DTO and validator entries for every new field and route. No allowlist lines.

## Pass threshold
- Items 1–4 RED → GREEN. Every c46, c54 and c66 test passes unchanged, or is tightened with a reason.
- Full vitest (serial fallback; name every failure) and tsc. A new api-c69 plus api-c46, api-c66 and api-stage6 pass.
- verify-all 10/10. fit-check and a11y clean in both modes. api-mobile has no new FAIL.

## Report
`cycles/c69-report.md`. Follow the LANES.md Finishing rule.
