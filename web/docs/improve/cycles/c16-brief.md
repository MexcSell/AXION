# Cycle 16 — Lane w14 · accessibility: keyboard, focus and labels on the new features

## Hypothesis
The owner's UI rules require icon-first controls with `?` help. Icon-only buttons without accessible names, dialogs
without focus traps, and live regions that don't announce are easy to miss in new code. Cycles 1–3 and Stage 6 added
many controls: proposals, scorecard, reliability, channels, versions. Audit them in api mode and fix what's missing,
without changing the look.

## Scope
1. A new script `web/scripts/a11y-check.mjs` (Playwright, no new deps). For the api-mode pages (Missions, Agents with
   all tabs, Agent Profile, Overview, Notifications, Settings) and every dialog reachable from them, it checks:
   - every button, link and input has an accessible name;
   - icon-only buttons have `aria-label` or a title;
   - dialogs trap focus and restore it on close;
   - Escape closes dialogs;
   - Tab order reaches every control;
   - images have alt text;
   - live status regions use `aria-live`.
   It runs through `api-e2e.sh` on your lane ports, and in demo mode against your dev server.
2. Fix every violation found in the app code. Keep the visual design identical, with before/after screenshots of 3
   pages.
3. Add the script to `verify-all.sh` (demo mode) **only if** it's fast (under 60 s) and stable; otherwise document how
   to run it.

## Measure and pass threshold (fixed now)
- Record the number of violations before. **After: 0 violations** in the checked scope, or every remaining one listed
  with a reason.
- The whole suite and verify-all stay green.

## Lane
You are lane w14: worktree `/home/luca/AXION-w14`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w14.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
