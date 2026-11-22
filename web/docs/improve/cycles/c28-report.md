# Cycle 28 (lane w26): command palette flake, plus two small gaps

## Root cause (palette)
`CommandPalette` is lazy: it mounts already open. Its effect `if (open) { setQ(''); setSel(0); ... }` runs as a passive effect
after the first commit. A query typed in the instant the input exists (fast typist, or Playwright under load) is processed
first, then the effect's `setQ('')` is queued after it and wipes it. Enter then ran the first default result ("Add mission"),
which closed the palette and opened a dialog; the dialog backdrop then blocked the theme toggle in the next flows step.
The integrator's second guess (lazy help registry) is a smaller real race: help entries joining the index could change the first
result between typing and Enter.

## Fix
- `CommandPalette.tsx`: the query resets in `AnimatePresence onExitComplete` (after closing), never on open.
  Enter while the lazy help registry is still loading waits for it, then acts on the results for the typed query
  (if the registry load fails it acts at once on the current results).
- `api/events.ts`: sign-out cleanup now also calls `versions.cancel()` (c05's version-proposals refresh). `versionProposalsTick()` exported for the check.
- `OrgHistory.tsx`: "Loading history…" is in `LiveStatus`. `Mentoring.tsx`: the two "Loading plans…" (c19) too: they showed up as a
  flaky a11y violation (2 of 5 runs) once the history probe was added.

## Evidence
| Item | RED | GREEN |
|---|---|---|
| Palette, first open typed before passive effects (`scripts/c28-palette-fast.mjs`, deterministic) | 5/5 failed ("query wiped") | 0/5, plus reopen starts empty |
| Palette step of flows, 21 full flows runs, 3 in parallel, with two parallel `vite build` loops as load | not reproducible by load alone (isolated 20 runs under load: 0/20 before; one flows run passed) | 21/21 palette PASS, 21/21 theme toggle PASS |
| Sign-out cancels version-proposals refresh (`scripts/c28-signout-refresh.mjs`) | refresh fired after cleanup: 1 | 0 (control with stream open: 1) |
| a11y probe for History loading (`a11y-check.mjs`, new probe `click: 'History'`) | 3 violations | 0 violations, 3 consecutive api runs |

## Pass threshold
- Flows palette step 0/20 under load: PASS (0/21). Honest note: before-count under load could not be measured (0/20 isolated); the
  deterministic repro (5/5 before, 0/5 after) is the evidence the race is real and fixed.
- Items 2 and 3 fixed, each with a check that failed first: PASS.
- verify-all 10/10 PASS; api-e2e auth 15/15, flows 23/23, api-stage6 94/94, api-improve 107/107; a11y-check api 0 violations: PASS.

## Files
web/src/components/layout/CommandPalette.tsx, web/src/api/events.ts, web/src/api/versionProposals.ts, web/src/features/agents/OrgHistory.tsx,
web/src/features/agents/Mentoring.tsx, web/scripts/a11y-check.mjs, new: web/scripts/c28-palette.mjs, c28-palette-fast.mjs, c28-signout-refresh.mjs.

## Concerns
- Under the same parallel load, two other flows steps failed on this branch and are unrelated to the palette: "Hierarchy: click agent
  → conversation pane switches" (17/21) and "Delete (archive) from the far-right trash icon" (5/21), though verify-all's flows passed
  when run alone. They are load flakes and need their own cycle.
- Rapid reopen within the 200 ms exit animation keeps the previous query (onExitComplete does not fire when the exit is cancelled).

## Fix round (review I1)
`pendingEnter` (an Enter waiting for the lazy help registry) is now cleared when the palette closes (effect on `open`, `reset`, and a click on a
result), and the registry-arrived effect and the load-failure path act only if the palette is still open (`openRef`).
Check `web/scripts/c28-palette-pending.mjs` holds the registry chunk: A) Enter then Escape then release, no navigation or dialog;
B) Enter then click a result then release, exactly one navigation. RED (old code): A navigated, B navigated twice (history 2->4); GREEN: 2/2.
Runs after the fix: flows 0 FAIL (inside verify-all), verify-all 10/10, api-flows all passed.
