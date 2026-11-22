# c58 review (Rule-of-Two profile + approval-quality records), commits 5b3e32b..c11dd1e, worktree /home/luca/AXION-w57

Method: read brief, report, full diff of server/shared/web code, migration 0043 up/down; ran
`heavy.sh npx vitest run --maxWorkers=2 test/c58-*.test.ts test/policy.test.ts test/contracts` -> 9 files, 236 tests passed, no
"too many connections" (log: scratchpad/c58-vitest.log). Probed the e2e-URL regex with node. Viewed two screenshots. Did NOT re-run
browser suites (api-c58, a11y, fit-check) or the full vitest; those report claims are unverified by me.

## Findings

### F1 should-fix: flag (b) has no data-access source, so the classic exfiltration trio can never fire on R2 actions
rule-of-two.ts SENSITIVE_EFFECTS = infra|critical only. Every kind with those effects is already R3/R4 (admin/owner approval). `read`,
`summarize`, internal records (`contentOrigins: ['internal']`) and `send_message` never set (b). Consequence: untrusted page + read of company
data + send_message (the scenario the Rule of Two exists for) yields flags (a) true, (b) false, (c) true: NOT fired. The rule can only ever
raise an R0/R1 action (via decideOnOrigin) for an agent that also holds an infra/critical capability, and requestApproval can never change
(report concern 1 admits the latter; it does not admit that (b) is nearly redundant with tier >= R3). The lane's judgement "send_message is (c) not (b)" is
correct in isolation; the gap is that nothing models "can read private/company data". Not a safety regression (nothing is weakened), but the
control is much narrower than its name/UI wording ("Reaches live systems or sensitive data"). Fix or owner-question: add a (b) source
(e.g. a capability of kind read/summarize with no origin = internal records, or a mission with internal content), or state the narrowing in the report and `approval.ruleOfTwo` help.

### F2 should-fix: e2e-extra-approvals.ts guard is bypassable (regex copied from e2e-serve.ts)
`/\/axion_e2e\d*(\?|$)/.test(url)` runs on the whole URL. Run in node, all return true:
- `postgres://u:p@h/axion?x=/axion_e2e` (real db `axion`, query string)
- `postgres://u:p@h/axion#/axion_e2e`, `...?application_name=/axion_e2e5`, `...?dbname=/axion_e2e`
- `postgres://axion_e2e` (host/user named e2e, db defaults)
Correctly rejected: `/axion_e2e16x`, `/axion_e2e_prod`, `/my_axion_e2e`. The script writes approvals (requestApproval) into the first mission of
any tenant (`order by id limit 1`). Fix: `new URL(url).pathname` must match `^/axion_e2e\d*$` and host/search empty of db overrides; share one helper with e2e-serve.ts.
It is only reachable via tsx (no package.json script, not wired in the server), but it lives in src/cli and is not excluded from the tsc/build path.

### F3 should-fix: the aggregate is per-person in a one-approver tenant
`aggregateQuality` gates only on n >= 5 decisions, not on distinct approvers. With a single approver (common here) the "everyone" aggregate
(rate, median time, quick-run count) IS that person's record, available to every member via GET /approvals/quality. It names nobody, but the
brief's "no inference" intent fails. Also windowDays 1..365 lets a member difference two adjacent windows (each n >= 5) to isolate single
decisions' outcome/fast flag. Mitigation: require >= 2 distinct approvers (and optionally >= 5 each or coarse windows 7/30/90) before returning numbers.
(Who decided each request and the outcome are already visible to members through `decidedByName`, so the new leak is latency/fast-bulk.)

### F4 should-fix (minor-to-should): uploads miss chat attachments; only the latest revision counts
loadConfigProfile reads only `mission_revisions.files` of the newest revision. `message_attachments` (conversation uploads, see uploads.ts lines ~111-117)
are not counted, and a later revision with no files clears (a) even if an agent read the earlier upload. A mission editor can therefore lower (a)
(not "requester text", but not tamper-resistant either). Fix: union over all revisions and message_attachments of the mission.

### F5 minor: "tamper-evident" is trigger-only
rule_of_two is immutable by the replaced guard (0043 copy of 0029 guard plus the new column; no later migration touched the guard; test c58-record.test.ts:56),
and approval_decisions new columns are append-only (0004 update/delete trigger, 0026 truncate; test c58-quality.test.ts:146-147). But the flags are not in
`digestV2` and the `approval.decide` audit row carries no latency/queue/fast_bulk/rule, so the hash chain does not cover them. Matches c29 level of guard, weaker than "tamper-evident". Add rule.fired/flags and latency to the decide audit detail.

### F6 minor: latency baseline and demo rows
`created_at` of the request is written from the app clock (`createdAt = new Date(Date.now() - createdAgoMin...)`, service.ts:63), so "DB now() against the request row"
mixes clocks (acceptable on one host; backdated demo requests give large latencies). The WHERE clause does not exclude `demo=true` requests, so `demo:seed` pollutes real statistics. Exclude demo rows.

### F7 minor: web data path for the flags is shown only with a rewritten response
api-c58 asserts the server list carries `ruleOfTwo` with three booleans (line ~63) and screenshots use a rewritten /approvals; no web unit test renders RuleOfTwoNote
from the DTO and no test makes the real server return fired:true. The server derivation is tested in vitest and the DTO is contract-validated, so risk is low; add one component test or an api-c58 case that seeds a configuration producing fired:true. RuleOfTwoNote assumes `because[key]` exists (server always writes it).

### F8 minor: UI
Fired dialog at 1366x768 (screenshot) fits, plain words, `?` present, tick/dash with aria-labels, sr-only reasons. Phone shot of DL-100 fits at 390 (cells wrap to 2 columns; fixed 74px cell height with overflow hidden could clip "not enough evidence" text at narrow widths: not seen in the shots). Aggregate "Decisions n" is shown even below 5 (counts, no rates): acceptable. I did not run a11y/fit scripts.

### F9 minor: RED evidence not independently checkable
Each item's tests and implementation are in the same commit (2da7e5f, db557c7, d6af8f3, 464c731), so RED cannot be reproduced from history; the quoted failures are plausible (module missing, column missing). The only test altered after being written: one c58-quality case (400 -> assert stored values are DB-computed) which is within the same new file, not a loosening of an existing test. policy.test.ts edit (lines 274-276) only adds two `add(...)` calls so the completeness check (`seen == REASON_CODES`) covers `rule_of_two` and `rule_of_two_deny`: legitimate, nothing loosened.

## Checks that passed (with evidence)
1. Flags derived: ConfigProfile has no text field; inputs are brief capabilities (kind/origin only, zod-strict, capability grammar in delegation/brief.ts), live site grants (SQL with DB now(), GRANTABLE = read/screenshot/summarize/fill_draft so a grant cannot carry an R2+ kind: "site grants set only (a)" is sound), upload count, and action kind/origin from the server caller. payload/title/detail are never read (service.ts:55-58). Unknown kinds set (b)+(c) (fail closed); a brief author can only narrow capabilities (legitimate). Uploads as untrusted is a sound call. Gaps: F1, F4. Capability `read` without origin sets nothing (a); arguable but consistent with c42 "no origin = no standing site access".
2. Policy rule: tier from `EFFECT_FLOOR.external` via maxTier (evaluate.ts), no second table; BULK_TIERS also derived from TIERS. Only all three `=== true` fire; padded/truthy values do not. Grant check uses tierBeforeRule so the rule never removes a grant requirement; deny stays deny; tenant `ruleOfTwo` accepts only 'deny' (cannot loosen). Evaluate's `flags` param defaults to "no rule" (fail-open if a server caller forgets; the two callers pass it). decideOnOrigin has no route caller; requestApproval is called only by the seed and the harness, so concern 1 is honest and nothing is weakened.
3. Records: latency in SQL `now() - r.created_at`, queue counted in the same tx before the CAS, body cannot supply either; pre-0043 rows have null latency_ms and `d.latency_ms is not null` excludes them. Migration down is symmetrical.
4. Privacy: /approvals/quality/approvers uses requireAdmin (403 for member, only roles admin/member exist); decisionRecord gated in approvalDto by `viewer.role==='admin'` and decided state; no latency/flags in events, audit or SSE (grep). Below 5, cells are null and UI says "not enough evidence (n = k)". See F3 for the aggregate caveat.
5. No decision change: recordDecision runs after the CAS update; the flag is only inserted; tests assert flagged approve/deny/consume unchanged; I found no path where a flag blocks or delays.
8. Contracts: RuleOfTwoDto, DecisionRecordDto, ApprovalQualityDto, Approver* DTOs, validators, registry entries for both routes (approvers `admin: true`), coverage calls both; no allowlist lines in the diff. Contract suite passes.

## Verdict: CLEAR AFTER FIXES
Required before merge: F2 (URL guard, trivial and testable), F3 (distinct-approver floor or document single-approver behaviour as an owner decision), F4 (union uploads/attachments across revisions), and either fix or explicitly document F1 in the report and help text. F5-F9 may go to the backlog.

## Re-review (fix round), c11dd1e..7f31c94

Ran `heavy.sh npx vitest run --maxWorkers=1 test/c58-*.test.ts test/policy.test.ts test/contracts`: 11 files, 268 tests passed. Browser suites not re-run (api-c58 F7 checks read from the script only).

- **F2 fixed.** `cli/e2e-url.ts` (`new URL().pathname`, decoded, must match `^/axion_e2e\d*$`) is used by both e2e-serve.ts and e2e-extra-approvals.ts. Ran 32 URLs through it. False: `?x=/axion_e2e`, `#/axion_e2e`, `?application_name=/axion_e2e5`, `?dbname=/axion_e2e`, `postgres://axion_e2e`, `//axion_e2e` (double slash), trailing slash, Arabic-Indic and full-width digits, no pathname, `/`, `%2F..`, `%00`, `%0a`, `/../`, `_e2e16x`, `my_axion_e2e`, empty, undefined, non-URL. True only for real `axion_e2e[N]` (and `%5F` encoded, which pg decodes to the same name: harmless). I checked pg-connection-string: `?database=`/`?dbname=` do not override the pathname database. Minor residue: `?host=`/`?user=` can still point at another server, but the database there must still be named axion_e2e*. Accepted.
- **F1 fixed (documented, not modelled).** I checked the 25 baseline kinds: read, screenshot, summarize, render_local, fill_draft, transform_local, test_fixture are mission-local; nothing reads other-mission data, tenant data or secrets outside the 11 infra/critical kinds. The lane is right. Wording is exact now: "Can reach live systems or credentials", help says "Reading company records is not counted yet". `c58-sensitive.test.ts` pins the 11 kinds, so a new kind forces a decision. Residual (not a blocker): the rule is still narrow by design; the owner should know.
- **F4 fixed.** Union over all revisions of the mission plus `message_attachments` joined through messages and threads on `t.mission_id=$1`. Mission ids are a global text primary key and the thread FK is to missions, so there is no cross-mission or cross-tenant bleed; mission-less direct threads are excluded. Tests cover a later empty revision and a chat attachment.
- **F6 fixed.** `r.demo = false` is in the shared WHERE, used by aggregate and per-approver; test with six demo decisions gives n=0.
- **F3 fixed, one minor residue.** Window is a literal union of 7/30/90 (400 for 1, 8, 29, 365, 0, -7, 30.5, abc, empty; both routes). A non-admin gets numbers only at n >= 5 and >= 3 distinct approvers; admins keep totals. Approvers are `decided_by` users (the decision route is user-only), so agents don't count. No other route or SSE carries the numbers (grep earlier). Changing the existing member test to three approvers is a legitimate adaptation (the new floor makes the old fixture correctly return nothing); the new test covers 1 and 2 approvers. Residue (minor): windows are nested, so 30-day minus 7-day differencing can isolate a few decisions (their approved/denied outcome, which `decidedByName` already exposes, plus an approximate fast-bulk count). Below the floor the member still sees `n` and `approverCount`, so with one approver n is that person's decision count. Neither exposes latency or rate. Backlog.
- **F7 fixed.** The harness inserts a real `delegation_briefs` row (read at an origin + release) and calls `requestApproval` for `release`; flags are derived by the server (`because` includes "capability read at https://example.com"). api-c58 reads the real /approvals response for both the fired and the plain request and renders the dialog from it (no rewrite). The harness is behind `isE2eDatabaseUrl`. The brief row is a direct SQL insert from a CLI that only runs on e2e DBs: fine.

### Verdict: CLEAR
Backlog only: nested-window differencing and n/approverCount visibility below the floor (F3 residue); F1 narrowness is documented, owner may want a data-access source later; F5 (audit chain does not cover flags) and F9 unchanged.
