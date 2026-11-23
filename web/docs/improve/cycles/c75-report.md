# c75 report: approval decision evidence is tamper-evident (P3c)

Lane w73, branch `c75-approval-evidence`, base 0759872. No migration (0055 unused). All runs on e2e DB axion_e2e17 through the harness; the live `axion` DB was never touched, and no `audit:*` or `migrate` command was run by hand.

## Design
- **Option B (separate evidence hash), no migration.** `requestApproval` seals the Rule-of-Two record: `rule_of_two.evidenceDigest = sha256(canonical({v:1, approvalId, actionDigest, evidence: record}))`. The record is already immutable by the 0043 trigger; the digest makes an edit visible when the trigger is bypassed.
- **Decide** recomputes it and refuses with `APPROVAL_EVIDENCE_MISMATCH` (409); the request stays pending. **Consume** does the same, and also cross-checks the decide audit row (digest, latency, queue size, fast-bulk, fired, rule) against the stored record and the `approval_decisions` row.
- **Old requests** (no digest, or `rule_of_two` null) are "legacy" and still decide and consume. Digest v3 was not used because a v3 would need a migration (the 0029 check allows only 1 and 2) and could not name the cause.
- **Audit:** `approval.decide` detail adds `latencyMs, queueSize, fastBulk, fired, rule, evidenceDigest` (named `evidenceDigest` because `redact()` drops any key matching /hash/). They enter the c31 chain.
- **Privacy:** the digest is stripped from the DTO (shape unchanged). No route returns audit rows; `/audit/verify` is admin-only and returns no detail.

## RED / GREEN
Item 1 (`c75-evidence.test.ts`), RED on unchanged code, 7 failures in the first run (the three audit ones moved to item 2):
- "a new request stores an evidence digest": `TypeError: .toMatch() expects to receive a string, but got undefined`
- "tampered flag row makes DECIDE refuse": `expected 200 to be 409`
- "tampered fired rule": `expected undefined to be 'APPROVAL_EVIDENCE_MISMATCH'`
- "tampered AFTER the decision makes CONSUME refuse": `promise resolved ... instead of rejecting`
GREEN (7721acc): 8 tests pass; c58-record and approval-binding still pass (42 tests together).

Item 2 (`c75-audit.test.ts`), RED: "evidence in the audit detail" `expected { mission: ... } to match object { decision, ..., latencyMs ...}`; "stripping the digest after a decision is caught" and "decision row edited to disagree with its audit row" both `promise resolved ... instead of rejecting`. GREEN: pass (with c58-quality, 29 tests). `verifyChain` green and a changed `latencyMs` is detected (`row content does not match its hash`); this detection test already passed on unchanged code because the chain hashes the whole detail, so it is a guard, not a RED.

Item 3 (`c75-privacy.test.ts`): **no RED exists.** The existing visibility rule already holds (member `/audit/verify` 403, no audit-row routes, member DTO has no latency, queue size or digest). It is a regression guard, and it checks that the new digest does not leak. Stated honestly: it passed on first run.

Item 4: `ApprovalDecideAuditDetail` type, `approvalDecideAuditDetail` validator (used on a real audit row in item 2's test), error code `APPROVAL_EVIDENCE_MISMATCH` added to `ERROR_CODES`. RED was a missing-import compile failure before the type existed. No registry entry changed because no served shape changed. No allowlist lines.

## Final runs (from the committed tree)
- tsc: clean.
- Full vitest via heavy.sh, parallel: 8 failures in 3 files, all `too many connections` / `admin connect failed` (site-grants and others; H14). Serial fallback: 3182 passed, 44 skipped; one suite-level failure `test/c71-equivalence.test.ts` "relation with OID ... does not exist" (a schema dropped by a concurrent run). Rerun alone: 8/8 pass. No failure touches c75, c58 or c35 code.
- api-c58, api-c48, api-stage6 via heavy.sh api-e2e.sh (ports 12392/12393): exit 0, no FAIL lines (c48 31 PASS 0 FAIL, stage6 94/94).
- No migration, so no migrate down/up.

## Diff stat (0759872..HEAD)
```
 server/src/approvals/quality.ts     |  6 ++-
 server/src/approvals/routes.ts      |  8 ++--
 server/src/approvals/service.ts     | 47 ++++++++++++++++++++--
 server/test/c75-audit.test.ts       | 69 +++
 server/test/c75-evidence.test.ts    | 79 +++
 server/test/c75-privacy.test.ts     | 48 +++
 server/test/contracts/validators.ts |  3 +-
 shared/contracts/src/api.ts         |  5 +
 shared/contracts/src/errors.ts      |  2 +-
```

## Threshold
| Item | Result | Evidence |
|---|---|---|
| 1 bind evidence, named code, old rows verify | PASS | RED/GREEN above; old-row test |
| 2 audit row evidence in chain, verify green, change detected | PASS | tests; verifyChain-in-test on e2e schema only |
| 3 member privacy | PASS (no RED) | guard test only |
| 4 contracts | PASS | type, validator, error code; no allowlist |
| c58 and c35 tests pass | PASS | full serial run |
| Full vitest and tsc | PASS with named flake | parallel connection-limit failures, serial clean except c71-equivalence setup flake, passes alone |
| api-c58, c48, stage6 | PASS | exit 0 |
| migrate down/up | NOT APPLICABLE | no migration |
| `audit:verify` CLI on e2e DB | NOT RUN | I did not run the CLI; the chain is verified through `verifyChain` in tests |

## Concerns
1. **Downgrade before decision.** Stripping `evidenceDigest` from a pending request makes it look legacy, and decide accepts it. After the decision the audit row pins the digest, so consume catches it. A request-time anchor (digest v3 plus a migration) would close this; not done.
2. A tamperer who rewrites both the flags and the digest on a pending request, before decide, is not detected (same trust boundary as the action digest). After decide the audit chain catches it at consume.
3. Decisions made before c75 have no audit evidence, so consume skips the cross-check for them.
4. Not done (still in P3c): widening flag (b), nested 7/30/90 windows, hiding `n` below the floor.
