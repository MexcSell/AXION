# c40 brief: mobile layout debt (code health · from the c24 merge)

**Lane:** w38 (from improve-30h; contains c24's touch.css and api-mobile.mjs). Ports 8890 / 8891 / 8892–8893. E2E DB **axion_e2e12**. No migration.
**Source:** integrator batch 5c. On the merged tree, api-mobile.mjs exits 1 with 31 FAIL lines across 651 states. An A/B probe showed every FAIL family exists **without** touch.css too, so it is pre-existing UI debt that c24's harness was the first to measure. The owner's rule: everything fits one screen, at every supported size.

## FAIL families (from the integrator's A/B)
1. Activity `act-card` is 416 px wide in a 390 px viewport (plus icon-btn.xs clipped at 390).
2. Help popovers render off-screen: top −113 / −119 at small sizes.
3. DL-75 "Propose a change" is 1040 px wide at 900 px.
4. "Dismiss notification" is clipped only during the toast's exit animation (x: 40). That is a **measurement artefact**: the harness should skip elements that are animating out (e.g. `[data-state="closed"]`, or exiting via framer-motion), not the UI. Fix the harness narrowly, prove the toast fits at rest, and don't loosen anything else.

## Build (test-first)
- Run api-mobile.mjs on your lane first and record the exact FAIL list (RED).
- Fix each family in CSS/layout, with the smallest change that respects the desktop look:
  - cards: min-width:0 and wrapping;
  - popovers: use the existing popover lib's collision handling (Radix `avoidCollisions`, `collisionPadding`), or clamp;
  - dialogs: max-width:calc(100vw − 2×gutter) and responsive internal grid.
- The desktop fit-check must remain ALL FIT, and the desktop screenshots must be unchanged except where a fix necessarily touches a shared rule. Show before/after.

## Pass threshold (fixed)
- api-mobile.mjs: **0 FAIL**, exit 0 on the lane's merged-equivalent tree (improve-30h base).
- The harness change for exiting elements comes with its own selftest: a static element clipped by 10 px still FAILs.
- Desktop fit-check (1672×941, 1366×768, 1280×760) is ALL FIT; verify-all passes all 10 steps; a11y in demo mode has 0 violations.

## Report
`cycles/c40-report.md`, with before/after screenshots at 390 and 900.
