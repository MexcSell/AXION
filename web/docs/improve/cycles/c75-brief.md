# c75 brief: approval decision evidence is tamper-evident (P3c)

**Lane:** w73 (`/home/luca/AXION-w73`, branch `c75-approval-evidence`), from improve-30h at the commit that adds this brief. Ports 12390–12393. E2E DB **axion_e2e17** (reused). Migration **0055** if needed.

**Source:** BACKLOG P3c, from the c58 review F5 and re-review.
- Today c58's Rule-of-Two flags, the rule that fired, the decision latency, the queue size and the fast-bulk flag are protected only by triggers.
- They aren't in `digestV2` or in the audit chain.
- The `approval.decide` audit row carries none of them.

## Items (each test-first, each its own commit)
1. **Bind the evidence.** Bind the derived Rule-of-Two flags and the fired rule into what an approval decision is checked against. Two options:
   - include them in the digest (digest v3, with v2 still verifying old rows);
   - or add a separate evidence hash bound at request time and re-verified at decision and at consume.

   A tampered flag row must make decide or consume refuse, with a named code. Old requests created before this change still verify. Test both.
2. **Audit.** Add latency, queue size, the fast-bulk flag and the fired rule to the `approval.decide` audit row, so they enter the per-tenant hash chain (c31). `audit:verify` must stay green, and a changed value must be detected.
3. **Member privacy.** Members must not gain new visibility of per-person latency through the audit route. Check `GET /audit`, or whatever exposes the audit rows, and keep its existing visibility rule. Add a test.
4. **Contracts.** Registry, DTO and validator entries for any changed shape. No allowlist lines.

## Pass threshold
- Items 1–4 RED → GREEN, nothing loosened. All c58 and c35 tests pass.
- `audit:verify` passes on the e2e DB **only**. Never run any `audit:*` or `migrate` against the live DB.
- Full vitest (serial fallback; name every failure) and tsc.
- api-c58, api-c48 and api-stage6 pass.
- Migrate down/up once if you add a migration.

## Report
`cycles/c75-report.md`. Follow the LANES.md Finishing rule, including the committed-diff check.
