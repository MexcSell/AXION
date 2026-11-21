# Cycle 27 (lane w25): sweep of deferred minors in already-merged cycles

## Hypothesis
Reviews of merged cycles left small, real defects in `web/docs/improve/LOG.md` and the `cycles/c0x-review.md` files.
Cheap now, costly later. Fix the safe ones, each with a check where possible. **Scope: only code from merged cycles 1–7,
11, 13, 16, 18, 6, 21, 22, 23.** Don't touch files that unmerged branches change (c08, c09, c10, c12, c14, c15, c17,
c19, c20, c24, c25); if a fix would touch one, list it instead.

## Candidates (verify each against the code first; skip any that are wrong or already fixed)
- **c05 m7:** the rollback reason goes to every user in the event stream. Decide whether the reason belongs in the
  public event, or only in the audit row and the admin view; a reason may name people. **m6:** a refused rollback is not
  audited as denied.
- **c05 m8:** right after a rollback, "last good" marks the version just rolled away from, and its button looks like the
  recommended action. Make the label and UI honest.
- **c04 m6:** a pointless rollback button on a revision whose lines equal the active one. Hide or disable it, with a
  reason.
- **c06:** System Operations tiles "Working / Learning / Evolving" above the tabs show fixture numbers without a DEMO tag
  in api mode. Tag them, or derive them from real data as c19 did for Agents (check whether c19's change applies here:
  c19 is not merged, so only tag).
- **c11 m3:** the `mission.create` help repeats the kind → department table by hand. Generate it from `KIND_DEPT`, or
  link to one source.
- **c22 M2:** neighbour row layout animation lost. Restore a cheap version if possible without regressing c22's numbers;
  otherwise list it.
- **c16:** the a11y trap test doesn't check that Tab wraps last → first. If c23 already added this, skip it.
- **Stage 6 ledger "minor (deferred)" items** on merged code that are clearly safe, e.g. the thread list not
  virtualised (skip: c26 does it), `?chat=admin` dropping the query string, the trailing read-mark timer (check whether
  c09 already fixed it: c09 is not merged, so skip if c09 touches it).

## Measure and pass threshold (fixed now)
1. **Before:** list each candidate with VALID / ALREADY FIXED / WRONG, with evidence.
2. **After:**
   - each VALID item is fixed with a test or browser check that fails without the fix (RED), or is listed with a reason;
   - nothing loosened;
   - server suite, api checks (api-stage6 94/94) and verify-all all green.

## Lane
You are lane w25: worktree `/home/luca/AXION-w25` (branched from improve-30h at a67d2dd: cycles 1–7, 11, 13, 16, 18, 6, 21, 22, 23 merged), port base 7500: dev 7590, e2e 7592/7593, database `axion_e2e25`, override config `/home/luca/AXION-lanes/vite-w25.config.ts`, `OUT=/tmp/axion-verify-w25`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (never git stash; every heavy run through heavy.sh; never dispatch subagents; commit work-in-progress often). verify-all's exit code is now honest (c21 merged): every step must pass. api-stage6 must be 94/94 (c22 merged). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
