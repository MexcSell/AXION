# Integration queue (source of truth for the integrator; the controller edits it)

Integration tree: `/home/luca/AXION`, branch `improve-30h`. Merged so far: cycles 1–3 (done on improve-30h directly), c07 (648e32b), c05 (6f8bd59).

## Merge in batches (each branch gets its own `--no-ff` commit; server tsc + vitest after each merge; full checks once per batch)

| Batch | Branches, in order | Extra checks / notes |
|---|---|---|
| 1 | c13-experiment-verdict, c04-org-history, c11-staffing-follows-org | api-improve (c04 flow inside), api-c11. c11 needs c04's org. |
| 2 | c16-accessibility, c18-profile-fit, c06-department-facts | Both c16 and c18 touch `web/src/components/ui/Tabs.tsx` around line 44: keep both. api-c06. Run `node scripts/a11y-check.mjs` once if it takes ≤ ~3 min. After c18, fit-check 1366×768 and 1280×760 must be ALL FIT (that clears c06's NOT MET item). |
| 2b | c21-honest-exit-codes (CLEARED, reviewed clean) | Merge right after batch 2. From then on verify-all exits 1 on any failure and prints a per-step table, so its exit code is trustworthy. Note: dialog-smoke rewrites docs/dialog-ledger.txt (tracked) on every run; restore it with `git checkout -- web/docs/dialog-ledger.txt` before committing. If the demo flows Hierarchy step now fails verify-all, that's the known flake fixed by c25 (batch 5b): re-run flows alone and record it. |
| 2c | c23-live-regions (CLEARED at acc0c0e) | After c16 (batch 2): Modal.tsx and Form.tsx in c23 are byte-identical to c16's. Run `node scripts/a11y-check.mjs` in demo + api mode (expect 0 violations) and the standard set. |
| 2d | c22-long-thread-perf (CLEARED at 665d71a) | After c23 (both touch `web/src/features/chat/ChatView.tsx`: keep c23's live-region and empty-state role logic AND c22's memoised bubbles/formatters). Fixes the long-known api-stage6 reload stall: from here on **api-stage6 must be 94/94** (the 'known reload stall' exception ends). Run api-c22.mjs (it exits 1 on any FAIL or threshold miss). |
| 3 | c10-db-indexes-scale, c12-throughput-trend, c19-mentoring-plans | c10 = migration 0017, c19 = 0023. c12 after c10 (both touch company/*). api-c12, ov-fit (demo + api), api-c19. |
| 4 | c14-security-hardening | Follow-up commit required (review I1): add c05's version-proposal create/decision/withdraw/rollback and c19's mentoring create/milestone/close to the rate-limit map, plus a route-table test that fails when a messages/proposals/uploads write route is missing. Run api-c05 and api-c19 under `scripts/api-e2e-preview.sh` (the CSP preview), and the standard set. |
| 5 | c20-org-coverage, c09-server-minors, c15-contract-tests | api-c20, api-c09. After c15: tighten its "// remove after c09 merge" tolerances (truncated + decidedByName required, drop the 2 old task.delegated variants) in a follow-up commit, with contract tests green. |
| 5b | c25-test-hygiene (CLEARED at 1d0fd4a), then c08-flaky-checks (CLEARED at 60ee4b7) | c08 after c25: c25 fixes the flows Hierarchy step, c08 reverted its own copy of that fix. Run api-c08.mjs. Re-run the full verify-all on the merged tree. |
| 5c | c24-mobile-fit (CLEARED at bb0551b) | Phone-only CSS (touch.css, every rule inside a ≤900/800/440 px media query) plus api-mobile.mjs (run it; it exits 1 on a FAIL). Desktop fit-check must be unchanged. |
| 6 | c17-owner-guide | Last (needs c04, c05, c06). Run api-c17 and confirm its 3 "runs after merge" checks now RUN and PASS (not SKIP). |

## Standard checks (every batch)

All heavy runs go through `HEAVY_PRIORITY=1 /home/luca/AXION-lanes/heavy.sh …` (the integrator's reserved slot).

- `cd server && npx tsc --noEmit -p . && HEAVY_PRIORITY=1 /home/luca/AXION-lanes/heavy.sh npx vitest run`. vitest gets `--maxWorkers=2` automatically. If you see "too many clients" or "connection limit exceeded for role axion", that's the 45-connection cap, not a regression: re-run once.
- `cd web && npx tsc --noEmit -p .`, then `HEAVY_PRIORITY=1 heavy.sh ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs <the batch's api-cNN scripts>`. Default ports 5192/5193, database `axion_e2e`.
- `HEAVY_PRIORITY=1 heavy.sh ./scripts/verify-all.sh > out.txt` against the dev server on 5190 (it serves this tree), then `grep -nE "FAIL|✗|failed|Error" out.txt`. **verify-all's exit code ignores sub-script FAILs, so every FAIL line counts.**
- `node scripts/fit-check.mjs` and `node scripts/ov-fit.mjs`.

## Known, pre-existing failures (record them, don't block on them)

- **api-stage6** 34/35: page.reload after the 130-message burst stalls about 50 s. **Only until c22 (batch 2d) is merged**; after that, stage6 must be 94/94. A designer-01 Edit-dialog failure before c08 merges is the loadAgents race c08 fixes; re-run once.
- **Demo flows.mjs** "Hierarchy: click agent → conversation pane did not switch" (sometimes also "Conversations: mission agents pane" or the "v1 → v2 migration" step). Three lanes saw it fail identically on their base. Lane w19 (c21) is classifying what predates the lanes. Any *other* flows FAIL blocks.
- **fit-check** at 1366×768 on /agents/<id>, until c18 is merged (batch 2).

## Quiet verification window (scheduled near the end; controller triggers it)

- Once c22 (the long-thread reload fix) is merged, run api-stage6 in full. It must be 94/94 with the 409 steps reached. Then run it 20× in a row for the c08 agent-edit threshold. Then measure perf-nav (c07 threshold: median page switch ≤ baseline 163 ms + 10%).

## Rules

- Never `git stash`, never `pkill -f` (kill by port), never push, never touch lane worktrees, and never restart 5190 or 5191. If 5190 is down, tell the controller.
- A failed batch check with an unclear cause: `git reset --hard <pre-batch commit>` (only your own unpushed merge commits), then merge one at a time.
- Record every batch in `web/docs/improve/MERGES.md` (time, merge commits, conflicts and how resolved, exact check counts, FAIL lines, follow-ups). In the same commit, also commit any modified controller files under `web/docs/improve/`.
- Never weaken a test to make a merge pass.
