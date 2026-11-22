# Cycle 29 (lane w27): the "Delete (archive)" flows failure

## Hypothesis
Demo-mode `flows.mjs` "Delete (archive) … not in Archived" fails about 5 of 21 times under parallel load (measured by
lane w26) and passes alone. It failed in the integrator's batch 2d run too. A failing archive step can hide a real race
in the demo store: archive is optimistic, and a re-render or a cross-tab `storage` rehydrate can undo it. Real users
could hit the same race.

## Scope
1. **Reproduce:** run flows ≥20× under a bounded parallel CPU load (a short build loop on your lane), and count failures.
   Build a deterministic repro if possible (for example delaying the store write or forcing a rehydrate with route or
   timer control).
2. **Root cause:** in the app (demo store `web/src/store/data.ts` archive/restore, the cross-tab rehydrate listener, the
   Missions list filter) or in the test (fixed sleeps, the wrong wait). Fix it at the source. Never weaken the check.
3. If the app has a real race (archive undone by a rehydrate), fix it and add a check.

## Measure and pass threshold (fixed now)
- Failures before: N/20 under load, plus the deterministic repro RED. After: 0/20 under the same load, and the repro
  GREEN.
- verify-all: all 10 steps pass. The api-e2e standard set stays green.

## Lane
You are lane w27:
- worktree `/home/luca/AXION-w27`, from improve-30h at f400a39 or later;
- port base 7700: dev 7790, e2e 7792/7793;
- database `axion_e2e27`;
- override config `/home/luca/AXION-lanes/vite-w27.config.ts`;
- `OUT=/tmp/axion-verify-w27`.

Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly: never git stash, every heavy run goes through heavy.sh (keep
any load loop short and bounded), never dispatch subagents, commit often. Lane w26 (c28) changed `flows.mjs` and
CommandPalette; it isn't merged yet, so don't touch the palette step. Safety rules:
`/home/luca/AXION/web/docs/improve/PROCESS.md`.
