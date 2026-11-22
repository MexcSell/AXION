# c43 brief: flows.mjs hardening under load (code health · H7)

**Lane:** w42 (from improve-30h HEAD; it includes c28 palette fixes and c29 archive fix plus its FLOWS_CPU_THROTTLE hook). Ports 9290 / 9291 / 9292–9293. E2E DB **axion_e2e15**. No migration.
**Source:** H7 in BACKLOG.
- c29 found these flows.mjs steps flaky under load: Hierarchy (even at 1×), Conversations, palette, theme, help popover, u1 News post and u1 Chat dock.
- Integrator 5f: palette and theme still FAIL at 4× throttle.
- c39: News and Chat dock timeouts at load about 11.
- c34 added `c34-archive-race.mjs`, which overlaps c29's `c29-archive-race.mjs`.

## Hypothesis
These failures come from the checks, not the app: counts read before paint, fixed short timeouts, clicks before handlers attach. c29 proved this for the archive step. Condition waits with the same assertions make every step pass at 4× CPU throttle without weakening any assertion. If a step still fails at 4× with condition waits, it's a real app race: find and fix it in the app.

## Build (test-first)
1. RED: run `FLOWS_CPU_THROTTLE=4 node scripts/flows.mjs` 5× against your dev server and record every failing step, with its error.
2. For each failing step, find the cause (screenshot plus timing). Replace reads-after-networkidle and short fixed timeouts with condition waits (`waitForFunction` or locator waits on the exact final state) **with the same assertions and messages**. A timeout must still become a FAIL. No new fixed sleeps.
3. If the app is at fault (e.g. the palette's Enter before the registry loads, a handler attached late), fix the app minimally and add a regression check.
4. Merge `c34-archive-race.mjs` and `c29-archive-race.mjs` into one script, keeping the strongest checks of both (the store subscription plus the final state, archived and paused), and delete the duplicate. This applies only if both are in your tree; c34 may not be merged yet, in which case note it for the integrator.

## Pass threshold (fixed)
- `FLOWS_CPU_THROTTLE=4 node scripts/flows.mjs`: **10/10 runs with 0 FAIL**.
- Plain flows: 10/10 runs with 0 FAIL.
- `git diff` shows no assertion removed or loosened. List every changed `step()` with before/after in the report.
- verify-all passes all 10 steps; api-flows passes.

## Report
`cycles/c43-report.md`.
