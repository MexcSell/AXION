# Cycle 8 — Lane w6 · code health H4: remove the flaky browser checks

## Hypothesis
Three cycles recorded one-off api-mode browser failures that didn't reproduce:
- `api-stage6.mjs`, agent Edit dialog: "after the 409 the next Save succeeds" / designer-01 save (c01, c02 and c04);
- the cycle 1 proposal-expiry step in `api-improve.mjs`: another browser's re-read can expire the proposal before Approve
  (c02 papered over it with a settle condition).

Flaky checks hide real regressions and cost re-runs. Find the **root cause** of each, in the app or in the test, and fix it.

## Measure and pass threshold (fixed now)
1. Before any change, reproduce: run `api-stage6.mjs` and `api-improve.mjs` **10 times each** (through `heavy.sh`) and
   record the failure count. Increase the stress if needed, for example with CPU load from a parallel build, to make the
   flakes show up.
2. After the fix: **0 failures in 20 consecutive runs of each script.**
3. No assertion removed or loosened. If a check was wrong, fix the check and explain why in the report. Fixed sleeps
   are not allowed.
4. `verify-all` stays green.

## Notes
- The agent Edit/409 flow lives in `web/src/dialogs/defs/agents.tsx` (AgentEdit, rowVersion adoption after 409) and
  `web/src/api/agents.ts` (`updateAgent`, `loadAgents`). Look for a race between the catalog reload triggered by
  `agent.*` / `org.*` events and the dialog's rowVersion.
- Lane w3 (agent version proposals) also changes agent edit and version code in parallel. Keep your app change minimal
  and well-explained, so the merge is easy.

## Lane
You are lane w6: worktree `/home/luca/AXION-w6`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w6.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
