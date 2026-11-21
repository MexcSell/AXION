# Cycle 20 review (org coverage facts, lane w18)

Reviewer read the diff, `server/src/organization/coverage.ts`, `coverageRoutes.ts`, the proposals/history wiring, `OrgCoverage.tsx`, `server/test/org-coverage.test.ts` and `web/scripts/api-c20.mjs` in /home/luca/AXION-w18. No runs.

Spec verdict: PASS. Quality verdict: PASS with minor findings. No Critical, no Important.

## Fact correctness
- Missing role: covered only by an active, placed agent (coverage.ts: `placed`, `holders`); retired agents are excluded (statuses are only active/retired, migration 0006:`status check`). Tested (retired security => missing, unplaced qa => missing).
- Duplicate roles: active agents, case-insensitive, regardless of placement (coverage.ts `dup`). Matches the u1 rule (routes.ts:61 uses `status='active' and lower(role)`). The seeded company really shares roles, so the card truthfully warns; the implementer states this. Small inconsistency: duplicates ignore placement while covered/missing requires placement (Minor).
- Depts without head: same reading as validateOrg DEPT_WITHOUT_HEAD (validate.ts:109), GM dept excluded. Consistent. It duplicates an existing warning, so changes shown twice is possible (Minor).
- Managers without reports: role manager or managed in prior lines; `prior` is passed only for the proposed side (coverageRoutes.ts dryRunCoverage). Fine.
- Span/depth: loop-safe (LIMIT 64), GM = 1. Edges of every edge_type are counted as reports (`up` ignores edgeType); only 'reports_to' exists today (0006:53). Minor, latent.
- Duty: duty is NOT NULL and uniquely indexed (0006), so "no duty" can only be blank/whitespace; the fact is real but rarely on.

## Never blocks
- Coverage sits in its own `coverage` key; `ok`/errors/warnings come from untouched validateOrg (proposals.ts:41-45). Approval re-runs dryRun (proposals.ts:161) and reads only `check.ok`. Test approves a coverage-only proposal.
- Minor: approval now also executes the coverage queries and pure code inside the decision transaction, so a throw there would 500 an approval, which contradicts "never blocks" in spirit. Columns are NOT NULL so it cannot realistically throw. Cheap hardening: have line 161 call validateOrg only (or wrap coverage in try/catch).
- Minor: the test never exercises ROLE_UNCOVERED on an approvable proposal. That is hard to build, because an uncovered role needs an unplaced agent, which validateOrg already rejects as an orphan. So role-uncovered is nearly always already an error in the same dry run; the new line adds role wording rather than new information. Honest, but worth knowing.

## Tenant scoping, N+1
- All queries filter `tenant_id=$1` (coverageRoutes.ts). History loads agents once for all revisions (history.ts, one query). Dry run does 1 extra agents query plus the existing one (duplicate agents fetch in dryRun, Minor). No N+1.
- Tenant test is weak: the other tenant has an agent but no edges/revision, so it proves little beyond no leakage of ids. Minor.
- Stored proposals carry `current` coverage computed at creation; a pending proposal's "current" can be stale if agents changed (base revision guard covers edges, not agents). Minor.

## Honesty, demo, fit
- Facts and counts only; no scores or percentages. "18/18 roles covered" is a count. Demo gated by isApi(). Fit checked by api-c20 at 1600x940 (reported, not re-run). 1366x768 fit-check BAD on /agents/coder-01 not compared to base; implementer should confirm it also fails on c04 (Minor, unverified).
- ROLE_CATALOG server copy with a test that seeded roles are in it; but the test does not check catalog equals web `roles.ts` keys, so a role added there will silently not be "missing" (Minor).

## Older c01/c04 assertions
- api-improve.mjs:303 and :376 ban `/coverage|latency|tokens|estimate/` text and percentages. The intent is "no invented metrics". Banning the word itself is brittle; the number-based part (`\d+%`) is the meaningful part. The "no buttons in a member's proposal card" check guards "members cannot decide", and a `?` help button is not a decision control. Avoiding the word and the button works around both. Better: next cycle narrow both old checks (drop the word "coverage"; assert no decision/approve buttons, not no buttons) rather than keep contorting wording. Not blocking; the implementer did not weaken any test. Note the `?` help (org.coverage) is present on the Policies card but absent in History/proposals, a small deviation from the owner's "? help" rule.

## Tests
Unit tests assert concrete values per fact; route tests cover endpoint, auth, dry run, approval, history. Admitted: pure functions written before tests (process lapse; 6 route tests were RED first). Browser script asserts real text and fit, sets DATA_MODE itself.
