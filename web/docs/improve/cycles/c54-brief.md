# c54 brief: clock bounds from SQL, and six dimensions follow-ups (H11, M1b, M1c)

**Lane:** w53 (`/home/luca/AXION-w53`, branch `c54-clock-dimensions`), from improve-30h at the commit that adds this brief. Ports 10390–10393. E2E DB **axion_e2e2** (reused). Migration **0041** only if needed. Dialog ids: DL-98 may be retired; reserve DL-99 if a new dialog is needed.
**Why one lane:** `company/dimensions-routes.ts` imports `windowOf` from `company/scorecard.ts`, so H11 and M1b/M1c touch the same code.
**Read first:** f5e2d01 (c46 clock fix: its message describes the window-edge convention), `cycles/c46-*`, `c47-*`, `c51-*`, LESSONS "Never round-trip a DB clock".

## Items (each test-first, each its own commit)
1. **H11, clock bounds.** `windowOf()` builds SQL bounds from the app clock. Move every window bound to SQL `now()`, keeping one explicit edge convention (current and previous windows meet with no gap and no overlap). Callers: `company/routes.ts:56`, `company/departments-routes.ts:21`, `failures/routes.ts:52`, dimensions-routes.ts. Also `approvals/service.ts:59-60` (demo `createdAt`/`expiresAt` from `Date.now()`), and make `current` required in `independence()`'s owner-history input (c51). Grep once more for the pattern and list what you found.
   - RED: a deterministic test per route where a row at a non-zero microsecond inside the window is missed or misplaced.
2. **M1c, freshness.** Dimension cells that count review verification must use c51's rule (a review counts only if newer than the task's latest attempt), so the scorecard and the task page agree. Test with a fail → retry → pass task that has an old accepted review.
3. **M1b(1), verdict outcomes.** Source `verdict_outcomes` by recomputing verdictV2 over c47's stored proposal runs (read only). n, window and "not enough evidence" rules as in c46; no composite number.
4. **M1b(2), PageFrame tab.** Move the Six dimensions view from dialog DL-98 into a tab inside the shared PageFrame (owner rule: the shared PageFrame on every page, fit one screen at 1366×768, `?` help, icons). Keep every state c46 shows (ok, none, hidden, unmeasured). Update the dialog ledger, help and a11y.

## Pass threshold
- Items 1–4 RED → GREEN. Full vitest and tsc. api-c46 (updated to the tab, not loosened), api-c06, api-c51, stage6, improve pass. verify-all 10/10, fit-check and a11y (both modes) clean. api-mobile has no new FAIL line for the new tab.
- Contract registry, DTO and validator updated for any changed field.

## Report
`cycles/c54-report.md`, with screenshots of the tab at 1366×768 and 390 px.
