# c63 brief: organisation-level failure learning (R3-8)

**Lane:** w61 (`/home/luca/AXION-w61`, branch `c63-failure-learning`). **Branched from `c60-attribution-otel` at df8c17e** (c60 is cleared and queued as batch 16, and you extend its failure files). Ports 11190–11193. E2E DB **axion_e2e12** (reused). Migration **0047**.
**Docs:** read this brief, `PHASE2.md` (the Wave 5 standing rules, and Waves 6–7), `phase2/research-r3.md` §R3-8 and `phase2/research-r3-verified.md` (its required changes) **read-only** from `/home/luca/AXION/web/docs/improve/`. Read LANES.md, LESSONS.md and the c33, c05, c41 and c60 cycle files from your worktree, or from the integration tree if they're missing.
**Evidence honesty:** D2 is a single author on a single runtime. It motivates the detection-channel field and gives no rate. D1's 24% is not a rate: never quote it.

## Items (each test-first, each its own commit)
1. **Detection fields.** Add three **optional** fields to `failure_tags`:
   - detection channel, a fixed enum: `test`, `audit`, `human_review` (a person looking at the result), `other_agent`, `reported_later`;
   - detected-after, the time from occurrence to detection, computed with DB `now()` and timestamps, never the app clock;
   - mechanism and control, also fixed enums, with an "other + note" escape: what part failed, which control should have caught it, and which control did.
   Keep append-only behaviour consistent with c33/c60. Wherever these fields are counted, show the share where they're missing; never hide it.
2. **Recurrence rule.** Within a window, when the same tag mode recurs in at least 3 failures across at least 2 departments, open a **row in c41's `lesson_candidates`** with the failures as sources. Don't build a new queue. The rule is idempotent: one open candidate per pattern per window.
   - Boundary tests: it fires at exactly 3 failures and 2 departments, and not at 2/2 or 3/1.
   - Test that no path creates an active playbook; activation stays c41's human review.
   - c59 (a separate branch) adds origin classes to lessons. Mark these candidates as system-derived from tool records, and note this for the integrator.
3. **"Detected only by a human" share.** Show it on the failure-modes view, with n and window. It is null below 5 failures. Use a plain-words label and a `?`.
4. **UI.** The tag dialog gets the optional fields (the c60 dialog area), and each enum value has a plain-words label and a `?`. Fit one screen at 1366×768.
5. **Contracts.** Add registry, DTO and validator entries for every new field and route. No allowlist lines.

## Pass threshold
- Items 1–5 RED → GREEN. Every c33 and c60 test passes unchanged, or is tightened with a reason.
- Full vitest (serial fallback for the connection cap; name every failure) and tsc. api-c33, api-c60, api-c41, stage6 and improve pass.
- verify-all 10/10, and fit-check and a11y clean in both modes.

## Report
`cycles/c63-report.md` in your worktree. Follow the LANES.md Finishing rule.
