# Phase 2 input: gap analysis against the master spec (2026-11-22)

Source: an Explore agent read the spec (§10–16), BACKLOG, and the server modules and migrations. Gaps 12 and 13 are inferred from absent modules and migrations.

Ranked gaps (the suggested order is 1 → 2 → 3 → 4, then 10, 6, 5, 7, 9, 8, 11, 12, 13):
1. Deterministic policy service: `evaluate(action, grants, tenantPolicy)` returns allow / needs-approval(tier) / deny, with reason codes. Policy lives in code (§10.1, §13.2, inv. 10). Size M. **Foundation; build first.**
2. Browser action contract types plus validator (§10.7): strict schemas, bounds, canonical digest, action → tier classifier, an injection/ambiguity fixture corpus. M.
3. Approval binding to the exact action (inv. 7): digest v2 over the full action plus origin, task, tier and requester; server-recomputed verification; single-use consume; no self-approval for R2+. S–M.
4. Site grants (§11, §10.7): table, service, an origin normaliser that rejects wildcards, userinfo, IDN confusables and private/loopback/link-local/metadata addresses; `grantCovers(origin, capability)`. M.
5. Six-dimension scorecard scaffold (§16.1, B4). M.
6. Usage ledger plus budget caps (§11, §10.8): append-only with corrections; hard-cap check; a fake meter in tests only. M.
7. Knowledge items and experience candidates with a review queue (§11, inv. 5). M.
8. Release / last-good records, plus a guardrail-path denial for patches (§11, §13.3). Records only. M.
9. Generic evolution proposals, experiments, evaluation results and promotion decisions wired to the existing verdict(); thresholds frozen at creation; post-promotion watch (records). M.
10. Audit-trail tamper evidence: per-tenant prev-hash chain plus a verify route; append-only triggers on audit and decision tables. S–M.
11. Artifacts and immutable versions (metadata, sha256, signed download tickets). M–L.
12. Model gateway registry and routing policy, with a fake adapter only. M.
13. system_jobs lease/retry state machine plus browser session/action/observation tables (schema only, no worker). M.
14. Spec-parity data-model gaps (task dependency cycle checks, immutable mission revisions, previews, per-run budget snapshot, §12 routes). S–M each.
15. Needs owner approval (not buildable now): the Playwright worker, any model call, experiment execution, code-executing previews, deploy/restart/merge gates, VPS backup drills, systemd changes.
