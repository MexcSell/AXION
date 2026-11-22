# c52 report: merge minors (H10)

Lane w51, branch `c52-merge-minors`, base `b06554e`. No migration. One commit per item.

## Item 1: skill lock key from SQL lower() (a92d9e4): PASS
- `server/src/locks.ts` gains `advisoryXactLockLower(c, prefix, name)`: the key is `LOCK_KEY_SQL` over `prefix || lower($2)`, so the folding is PostgreSQL's `lower()`, the function the `skills(tenant_id, lower(name), version)` unique index uses. `skillLock` in `agents/playbooks.ts` calls it. Still schema-scoped, still no raw `pg_advisory` outside `locks.ts` (guard test passes). Keys for ASCII names are unchanged.
- Tests (`test/playbooks.test.ts`): (a) deterministic: a transaction holds the key built from SQL `lower()` of "i" (and of "ασ"); creating "İ" (and "ΑΣ", whose JS lower-case is "ας") must wait for it, then returns 201. The test asserts first that SQL lower() treats each pair as equal and JS toLowerCase does not. (b) two concurrent creates of such names give 201 and 201 with versions {1, 2}.
- RED: (a) "creating "İ" must wait for the lock held for "i": expected true to be false"; (b) `expected [ 201, 500 ] to deeply equal [ 201, 201 ]` (raw unique violation as a 500). GREEN: playbooks + advisory-locks 80/80.
- "Conflict code": in this code base a same-name create is the next version (201, version n+1), not an error, so that is what the second create now returns. The 500 is what is gone.

## Item 2: task reviews cancelled on sign-out (1fc39ef): PASS
- `web/src/api/events.ts` cleanup now calls `taskReviews.cancel()`; `taskReviews.ts` exports `taskReviewsTick()` (like `versionProposalsTick`).
- Test: `web/scripts/c52-taskreviews-signout.mjs`, built like c28's: a fake EventSource, fire `task.reviewed`, count refreshes. RED: `FAIL ... open: 1; requested after sign-out cleanup: 1`. GREEN: `PASS ... open: 1; requested after sign-out cleanup: 0`.

## Item 3: c04 History check narrowed (968139f): PASS, with a note on RED
- c04's intent (report and review): the History view invents nothing: no percentages, no estimates. The old check also banned the word "coverage", which is no longer right because c20 shows the server's structure facts in History.
- New check in `web/scripts/api-improve.mjs`, applied to the History panel text only. It still forbids: any `N%`; the words latency, tokens, estimate; and a coverage claim, meaning "coverage" next to a figure, ratio, score, rate, level, index or "of N" ("coverage 80", "coverage: 3", "coverage score", "coverage of 4 roles"), or a figure before it ("3/4 coverage", "80% coverage"). It now allows only the bare word "coverage" with no figure. The regex was tried on 9 sample strings (bare label allowed; all claims forbidden).
- Note: the old check does not fail on today's UI either (I ran the old script: 107/107, the History panel text has no "coverage" word), so there is no RED to show; this is a narrowing made ahead of the word appearing. GREEN: api-improve 107/107.

## Item 4: decidedByName in the decision response (d5b57e4): PASS
- `POST /approvals/:id/decision` re-reads the row with the same decider join as `GET /approvals`. Test (`c09-minors.test.ts`): the decision response has `decidedByName: 'Mina'` and equals the row `GET /approvals` returns. RED: `expected null to be 'Mina'`. GREEN: c09-minors + approvals tests 14/14.
- **For the integrator:** c50 is not in this base (`server/test/contracts` does not exist), so the allowlist entry could not be removed here. When c50 merges, delete this line from `server/test/contracts/exercised.ts` (line 21 on c50's branch): `[/^POST \/approvals\/:id\/decision \.approval\.decidedByName never non-null$/, 'FINDING (c50 report): ...']`. Without the removal the coverage run may report an unused allowlist entry.

## Item 5: the 3 vitest failures after c09 (b18c5a2): NOT MET (not reproduced, not named)
- Scratch worktree `/tmp/c52-c09` at b18c5a2 (server/.env copied mode 600, server node_modules symlinked), removed afterwards. `npx vitest run --maxWorkers=2` through heavy.sh, 3 times with the lane DB settings: 37 files, 583 tests passed every time. No failure to name.
- The integrator's failure list is not recorded in LOG/STATE/LESSONS, so the three names cannot be recovered from the docs either. The most likely cause stays the global advisory-lock class (4eca9db, committed 140 commits after b18c5a2; LESSONS.md has the rule): it only bites when another schema parks a writer on the same key, which a quiet 2-worker run does not produce. This is a hypothesis, not a finding.

## Pass threshold
- Full vitest: 63 files, 1964 tests passed. `tsc` (server, web): clean.
- api-c41 45/45, api-c48 31/31, api-improve 107/107 (includes the c04 History step), api-stage6 94/94: PASS.
- verify-all: 10/10 steps PASS (a first run was cut off by my own 595 s timeout, rc 124, not a failure; the rerun without a timeout passed).

## Files changed
`server/src/locks.ts`, `server/src/agents/playbooks.ts`, `server/src/approvals/routes.ts`, `server/test/playbooks.test.ts`, `server/test/c09-minors.test.ts`, `web/src/api/events.ts`, `web/src/api/taskReviews.ts`, `web/scripts/c52-taskreviews-signout.mjs` (new), `web/scripts/api-improve.mjs`, this report.

## Concerns
- Item 5 has no diagnosis (above).
- Item 3 has no RED (above).
- Item 4's allowlist removal is left to the integrator.
