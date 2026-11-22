# c36 report: site grants with an exact-origin normaliser (Phase 2 · Wave 2 · P4)

Lane w34, branch `c36-site-grants`, built on c30-policy-service (f483e2d). Migration 0030. E2E DB axion_e2e8.

## What was built
- `server/src/grants/origin.ts`: `normaliseOrigin(input, {allowInsecureHttpForTests?})`, pure, fails closed (any thrown error becomes `unparseable`), Node built-ins only (`url.domainToASCII` / `domainToUnicode`), no DNS, no network, no new dependency. The raw string is checked by hand (invisible chars, backslash, `%`, `*`, `?`/`#`, `@`, scheme, `//`, path, authority, port, labels, IDNA, scripts) BEFORE the forgiving URL parser, which is used only as a final round-trip consistency check.
- Script rule chosen: a non-ASCII label must be a pure single-script label (fixed script list, else refused); Latin labels may use non-ASCII letters only when they are an ASCII base plus combining marks or ss/ae/oe/o-stroke (so dotless i, script g, l-with-stroke are refused); an all-Cyrillic/all-Greek label made only of Latin look-alike letters is refused; the label must survive the IDNA round trip (no folding, no dropped chars, no new dots). Why: grants match by exact string equality of normal forms, so a look-alike can never equal a granted origin; these rules also stop an admin being tricked into granting one. Known limit: whole-script look-alikes that use a mix of non-lookalike letters, and public-suffix grants (https://co.uk), are not detectable without lists.
- Migration `0030_site_grants`: table per spec plus `revoked_at/revoked_by/reason`; CHECKs (coarse normal-form regex, no local/internal TLD, expiry in (issued_at, issued_at+30 days], capabilities limited to read/screenshot/summarize/fill_draft, 1..8); trigger: only one revoke allowed, no edit, no delete; TRUNCATE guard. mission_id is NOT NULL (no all-missions grant).
- `server/src/grants/service.ts`: `loadGrants(db, tenant, mission, now, subjectId)` feeds `evaluate()`; `decideOnOrigin` normalises the raw origin first (unnormalisable origin: deny + refusal reason); `decideGrant` runs `evaluate()` with kind `origin-grant` (R3, approver admin); `assertNormal` refuses a non-normal origin before insert. Capabilities are asserted to be R0/R1 baseline kinds at load.
- Routes (admin only): `GET /site-grants`, `GET /site-grants/validate?origin=` (pure check), `POST /site-grants` (Idempotency-Key, expiry required, max 30 days, duplicate active = 409), `POST /site-grants/:id/revoke`. Both writes are in `LIMITED_ROUTES` (proposals bucket); the route-table test regex was extended with `site-grants`. Audit on every issue, revoke and every refused origin (input stored JSON-escaped). Events `grant.issued` / `grant.revoked` (admins only).
- UI: Settings › Browser › "Site grants" panel (admin, api mode), with expiry countdown, state chips, revoke with reason, R3 and 30-day chips, `?` help (`browser.originGrant` spec text plus `grants.*` entries). Dialog DL-90 "Grant a site" validates live by calling the server's own normaliser (validate endpoint), shows the stored normal form. Screenshots: `web/docs/screenshots/improve-c36-site-grants-dark.png`, `improve-c36-dialog-refused-dark.png`.

## RED / GREEN
- RED: `vitest run origin` before `origin.ts` existed: "Test Files 1 failed, no tests" (module missing). First run with the implementation: 11 of 143 failed (ordering of reasons for `https:///`, `intranet`, `xn--`, emoji, fullwidth digits; benign `.example` TLD is reserved). Each was fixed in the code or the fixture expectation (never by loosening an assertion); one fixture reason text was lengthened. Later RED in site-grants tests: NUL byte in the audit detail gave HTTP 500 (fixed by escaping), zod errors are 400 not 422 (test corrected).
- GREEN: server `tsc --noEmit` OK; `heavy.sh npx vitest run`: 41 files, 837 tests, 0 FAIL (includes origin.test.ts 144 tests and site-grants.test.ts 17 tests); web `tsc --noEmit` OK.

## Pass threshold
| Item | Result |
|---|---|
| Hostile corpus 100 % refused | PASS: 117 entries in `server/test/fixtures/hostile-origins.json` (60 required), 117/117 refused, each asserted against its stated expected reason code and a stated `why` (29 distinct reason codes). Also 116 string entries via GET validate (api test) and all as `decideOnOrigin` actions (deny + refusal). |
| Benign corpus 100 % accepted, exact normal form | PASS: 19 entries (15 required) in `benign-origins.json`, 19/19 with exact expected output; idempotence checked. |
| Fuzz (extra) | 20000 deterministic mutations; every accepted result obeyed the invariants (plain lowercase ASCII https origin, >=2 labels, alpha TLD, not reserved, re-normalises to itself). |
| Expired grant denies at the expiry instant | PASS: allow at expiresAt-1 ms, deny `grant_expired` at expiresAt. |
| Revoked denies | PASS (`no_grant`). |
| Mission A grant does not cover mission B | PASS. |
| Another tenant's grant never matches | PASS (`loadGrants` for t-2 is empty; decision deny). |
| evaluate() with loaded grants: R0 on granted origin allowed, ungranted denied `no_grant` | PASS. Also look-alikes (`pаypal.com`, punycode, `.evil.com` suffix, `@`, port, scheme, path, trailing dot) all deny while spelling variants of the granted origin allow. |
| server tsc, vitest | PASS (above). |
| Browser check api-c36 | PASS: 29/29 (grant, listed, hostile origin refused live with reasons, API 422/403/409, revoke, fit, no overflow). |
| api-flows, api-stage6 | PASS: 23/23, 94/94. |
| a11y | PASS: demo mode (dev 8490) 50 views, 57 dialogs, 0 violations; api mode 40 views, 57 dialogs, 0 violations. |
| fit-check | PASS for what ran: demo fit-check on dev 8490, 55 route/tab views ok with 0 FAIL, and `ONLY=settings` "ALL FIT" for all 11 Settings tabs. The full run was interrupted at its end (the dev server was stopped while it was finishing) and a rerun of operations/help/results/jobSearch/agentProfile timed out at 100 s, so those were not re-confirmed; none are touched by this cycle. In api mode (where the new panel shows) api-c36 asserts `main` does not scroll and no horizontal overflow at 1600x940. |

NOT MET: none.

## Corpus coverage notes
Hostile reasons by count: ip_literal 20, control_or_space 12, reserved_name 8, scheme_not_https 7, bad_port 6, idna_mapped 5, mixed_script 5, percent_encoding 4, query_or_fragment 4, bad_label 4, scheme_required 4, and others. It includes userinfo tricks, backslashes, encoded dots, decimal/octal/hex IPv4, IPv6 and IPv4-mapped IPv6, 0.0.0.0, 169.254.169.254, metadata.google.internal, `localhost.`, Cyrillic a in paypal, punycode of confusables, trailing dots, malformed ports, file:/javascript:/data:/blob:, whitespace, control, zero-width and bidi chars, over-long labels and hosts. 8 of the 117 raw strings pass the database CHECK alone (punycode and similar); the normaliser is the real gate, the CHECK is a second coarse fence.

## Files changed
New: `server/src/grants/{origin,service,routes}.ts`, `server/migrations/0030_site_grants.{up,down}.sql`, `server/test/{origin,site-grants}.test.ts`, `server/test/fixtures/{hostile,benign}-origins.json`, `web/src/api/siteGrants.ts`, `web/src/features/settings/SiteGrants.tsx`, `web/src/dialogs/defs/site-grants.tsx`, `web/src/help/pages/c36-site-grants.ts`, `web/src/theme/pages/site-grants.css`, `web/scripts/api-c36.mjs`, screenshots, this report.
Edited: `server/src/app.ts`, `server/src/ratelimit.ts`, `server/test/security.test.ts` (route-table regex and list extended, not loosened), `shared/contracts/src/{agents,events}.ts`, `web/src/api/events.ts`, `web/src/pages/Settings.tsx`.

## Concerns
1. Policy approval: issuing is evaluated as `origin-grant` (R3, approver admin) and the issuing administrator counts as that approver (no pending-approval queue, no second person). The decision, tier and policyVersion are audited. A separate-approver flow would need a design decision.
2. `loadGrants` takes a 4th argument (`subjectId`) beyond the brief's signature: site grants are mission-wide, but P1's `Grant` is per subject, so the loader stamps the asking agent. The caller must check that the agent belongs to the mission.
3. "Service refuses non-normalised input": the route normalises and stores the normal form (friendly for the UI); the layer below (`assertNormal`) and the DB CHECK refuse anything not already in normal form.
4. Reserved TLDs `test`, `example`, `invalid`, `onion`, `svc` are refused as well (never public); fixtures and tests use example.com. Ports other than the default are allowed (part of the exact origin).
5. DL-90 was chosen for the dialog; other lanes may pick the same number (spec ends at DL-65, c19 uses DL-77). Check at merge.
6. Nothing consumes grants at run time yet (agents do not execute); `decideOnOrigin` is the entry point for Stage 7.
7. Whole-script and public-suffix limits described above.

## Fix round (after the c36 review, NOT CLEAR at a6b8b39)
Test-first: the new hostile entries and the moved IDN entries were added to the corpus, then the old `origin.ts` was run against them: RED = 61 failed / 143 passed of 204 tests. After the fix: GREEN.

| Review item | Fix | Evidence |
|---|---|---|
| I1 IDN look-alikes (ruling: fail closed) | Every IDN is refused with `idn_not_supported` (any non-ASCII host character, or any `xn--` label in the final ASCII form). Input that case-folds to ASCII from non-ASCII (Kelvin sign) is refused, not folded; capital sharp s and Angstrom sign are refused as IDNs. 1-character TLD and digit-bearing TLD refused (`bad_tld`). Public suffixes refused (`public_suffix`) from a partial embedded list of 36 suffixes (all 15 requested plus others); dialog shows an "exactly this origin" warning. Header comment rewritten; the Cyrillic/Greek/script checks stay only as defence in depth. | Hostile corpus 117 -> 178 entries (7 former benign IDN entries moved, all 35 review-table bypasses added, 4 TLD, 15 public suffix), 178/178 refused with the expected reason. Benign corpus 18 entries (12 kept + 6 new), 18/18 exact. |
| I2 clearDemo | Migration 0030 (unmerged, edited in place): `mission_id ... on delete cascade`; guard trigger honours `axion.purge_demo = 'on'` for DELETE like 0007/0008; outside a purge a delete is still refused. | New test: seeded demo mission with a grant, `clearDemo` succeeds, grant and mission gone, direct delete still refused. |
| I3 clock skew | `loadGrants` no longer compares `revoked_at` with the app clock: a revoked row is never loaded. Mission soft-delete also excludes grants. Duplicate/expiry checks in the issue route already compare in SQL (`now()`). | Revoke test rewritten: now = revoke instant minus 60 s, minus 1 ms, exactly the instant, plus 1 ms, and today: always `[]` and deny `no_grant`. |
| I4 single-admin approval | Audit detail records `approverId` = issuer and `approval: 'issuer is approver (single-admin approval)'`; documented in `server/README.md` (two-person rule is backlog P3b). | Tests assert both audit fields, and that a member's issue attempt returns 403 and stores 0 rows. |
| I5 membership | `loadGrants` returns grants only if the subject has a live instance (`agent_instances`, `ended_at is null`) on the mission. | New test: unstaffed agent, ended instance, soft-deleted mission all return `[]` / deny; staffed agent gets the grant. All grant tests now use a staffed mission and coder-01. |
| Minors | Zone-less expiry refused (422; `+00:00` accepted). Concurrent duplicates: a partial unique index cannot express "not expired", so the issue transaction takes `pg_advisory_xact_lock` on (tenant, mission, origin) before the duplicate check (deviation from the suggested index, with the same effect). DB port regex now <= 65535 and TLD >= 2 letters. `grants.expiry` help matches the fixed durations. A failed validate call shows an error with a Retry button instead of "Checking...". api-c36 gained refused-origin-leaves-dialog-open, Escape, and Cancel steps and the exact-origin warning check. | Concurrency test: 5 parallel issues give statuses [201,409,409,409,409], 1 row. |

Verification (fix round): server `tsc --noEmit` OK; web `tsc --noEmit` OK; `heavy.sh npx vitest run`: 41 files, 901 tests, 0 FAIL (was 837); api-flows 23/23; api-stage6 94/94; api-c36 35/35 (was 29); a11y api mode 40 views, 57 dialogs, 0 violations. The demo-mode a11y and fit-check were not re-run (no demo-mode UI changed; the panel and dialog render only in api mode).

Remaining concerns: IDN grants are not possible until P4a; the public-suffix list is partial; `grants` for the same origin can be issued again after the old one is revoked or has expired (by design).
