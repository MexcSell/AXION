# c75 review (independent)

Worktree /home/luca/AXION-w73, 0759872..30b7233. git status clean. Diff stat is 16 files incl. docs; 10 are code/test (quality.ts, routes.ts, service.ts, 3 c75 tests, validators.ts, api.ts, errors.ts) = matches the claim. Tests: c75 + c58 + c35 via heavy.sh: 10 files, 190 passed. c71-equivalence alone: 8/8 pass (H21 flake; c75 does not touch seedScale or c71 files).

## Findings

### F1 BLOCKER: demo clear then re-seed makes every demo approval undecidable (409 APPROVAL_EVIDENCE_MISMATCH)
Demo approvals have fixed fixture ids (seed/demo.ts passes `id: a.id`). `demo:clear` deletes the approval rows (cascade from missions) but leaves the chained `approval.request` audit rows. A re-seed creates new requests with the SAME id and a new expiry (so a new action digest and a new evidence digest) and appends a second `approval.request` row. `assertEvidenceAnchored` (service.ts:112) reads `order by seq limit 1`, i.e. the OLDEST row, whose digest no longer matches.
Reproduced on the test schema (scratch test, harness only): seed -> 4 request rows, verifyChain ok; clear -> 0 approvals, chain ok (8 rows); reseed -> chain ok (13 rows); POST /approvals/APR-M-126-1/decision -> `409 APPROVAL_EVIDENCE_MISMATCH`.
Fix: look up the NEWEST request row (`order by seq desc limit 1`). An attacker cannot add audit rows, and the current approval row always corresponds to the latest request row. Add a test: seed, clear, reseed, decide one demo approval and consume it. (Consume's decide-row lookup already uses `seq desc`.)
Item 7 answer: chain stays green across purge (the purge never touches audit_events; it adds 1 row per demo request and 1 for demo.clear), but the decide path is broken as above.

### F2 should-fix (minor if documented): legacy status is open-ended
Legacy = no chained request row naming a digest (service.ts:112-113). Row-level write on approval tables only cannot create it for an existing post-c75 request (strip digest -> refused, rewrite flags+digest -> refused; tests c75-evidence.test.ts:94,101). Creating the legacy condition needs deleting the audit row: audit_events has an append-only trigger (0001:69) so that needs trigger-disable/owner rights, and deletion leaves a seq gap that verifyChain reports (`seq N is missing`); deleting only the newest row is a truncation covered by the c49 anchor. A forged brand-new approval_requests row (never audited) is also "legacy", but that attacker could already forge an approved row and its action digest before c75, so this is not a regression. Suggest documenting that legacy is permanent and that detection of a deleted request row is by audit:verify only; optionally a cutoff marker (audit row written at deploy) so later rows with no request row are refused.
Test note: the changed OLD-requests test (c75-evidence.test.ts:68-76) deletes the request row, which is a legitimate pre-c75 simulation (the strip-on-fresh case is now its own RED test). It does leave a seq gap, which a real pre-c75 request would not; harmless. No assertion was loosened.

### F3 minor: no test that deleting a request row is caught by verifyChain
Reasoning above says seq/prev_hash checks catch it, but no test asserts it. Add one (tamperAudit delete of a non-last request row, expect verifyChain ok:false with "missing").

### F4 minor: pre-c75 decisions are not cross-checked at consume
assertEvidence skips when the decide audit row has no evidenceDigest key (service.ts: `a.evidenceDigest === undefined`). Pre-c75 decided requests therefore have rule_of_two and approval_decisions unprotected. Already stated as concern 3 in the report; accepted limitation. Post-c75 decisions of legacy requests store `evidenceDigest: null`, which is cross-checked (null === null), fine.

## Checks with no defect
1. Binding: canonical() sorts keys recursively, undefined -> null, numbers/bools via JSON.stringify; arrays keep order. Hash covers {v:1, approvalId, actionDigest, evidence: whole record (flags, because, fired, rule, policyVersion)}; every record field is covered, id and action digest are inside, so no cross-request replay. Tests flip a flag and the fired rule.
2. Anchoring lookups are tenant scoped and keyed to the exact id (`tenant_id=$1 and action='approval.request' and subject=$2 and result='ok'`). Request audit is written in the same transaction as the insert (requestApproval takes a Tx; every caller uses tx()), so a failed audit write rolls the request back and cannot produce a post-c75 request without a row. Decide runs inside one tx with the audit tenant advisory lock; request commits both atomically, so no request/decide race. Only F1 (ordering) breaks the lookup.
3. Consume cross-check covers digest, latency, queue size, fastBulk, fired, rule against the approval_decisions row (test c75-audit.test.ts:61).
5. Redaction: audit detail keys are evidenceDigest, rule, fired, kind, mission, latencyMs etc.; none matches /pass|password|token|secret|csrf|hash|cookie/. No payload or title in the row. `rule` value is a fixed string.
6. Privacy: c75-privacy.test.ts passes; no route returns audit rows, /audit/verify is admin-only and returns only {ok, checked}; DTO strips evidenceDigest. Note the decide audit row carries latency with actor = decider, so per-person latency is in the DB for whoever can read audit_events (not served by any route).
7. Chain growth: one row per request; accepted, noted in report.
8. Contracts: ApprovalDecideAuditDetail type, validator (approvalDecideAuditDetail, applied to a real row in tests) and the new code APPROVAL_EVIDENCE_MISMATCH are consistent; no served shape changed (ruleOfTwo DTO strips the digest).
9. c71-equivalence: passes alone 8/8; not related to c75.

## Verdict
CLEAR AFTER FIXES: F1 (newest request row, plus a clear/reseed/decide test) is required. F3 and a documented F2 note are recommended.
