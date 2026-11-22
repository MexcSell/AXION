# c36 re-review (site grants, after fix round)

Reviewer: independent, read-only. Worktree /home/luca/AXION-w34, branch c36-site-grants, tip 719091a, diff a6b8b39..719091a.
`origin.test.ts` + `site-grants.test.ts` through the gate: 225/225 pass.

**Verdict: CLEAR.** No accepted bad input found. Two Minor notes.

## 1. Normaliser
Every row of the first review's bypass table was re-run: all Cyrillic, Greek, Armenian, Hebrew, Han/Kana, combining-mark, o-stroke and Kelvin/sharp-s/Angstrom inputs now return `idn_not_supported`; `co.uk` and `github.io` return `public_suffix`; `a.b`, `example.c0m` return `bad_tld`. `https://example.comx` is accepted (a 5-letter TLD of letters, valid by the rule; not a defect).

Fresh attacks (all refused):
- Fullwidth `ｇｏｏｇｌｅ.com`, mathematical `𝐠𝐨𝐨𝐠𝐥𝐞.com` and `𝒈.com`, circled `ⓖoogle.com`, superscript `googleᵐ.com`, `²a.com`, `a.ᵃᵇ`, ligatures `ﬁle.com`, `ﬃ.com`, `file.ﬁ`, long s, `™`, fullwidth TLD, ideographic full stop: all `idna_mapped` (NFC does not apply compatibility folding, so the IDNA map is caught by the "ascii result has no xn--" test, labelToAscii origin.ts:128-139). None silently becomes ASCII.
- Kelvin sign in any position (`K.com`, `a.Kom`, `Ka.com`, doubled): `idn_not_supported` (origin.ts:128). Capital sharp s, Angstrom, Ohm, dotted I, `i`+U+0307: `idn_not_supported`.
- `xn--` in any case (`XN--`, `Xn--`, `xN--`): `idn_not_supported`; `xn--.com` is `invalid_punycode`.
- Uppercase public suffixes (`CO.UK`, `Co.Uk`, `GITHUB.IO`, `GitHub.Io:443`) and with a port (`github.io:8443`): `public_suffix` (host is lower-cased before the check). With a trailing dot: `trailing_dot`. `a.github.io` and `example.co.uk` are accepted by design (a specific site).
- bad_tld: `c-m`, `x1`, `1x`, `1e3` bad_tld; `-com`, `com-` bad_label; numeric / hex last labels ip_literal. TLD of 2+ letters only, and the DB regex (0030:10) matches `[a-z]{2,}` plus the 65535 port ladder.

## 2. I3
`loadGrants` (service.ts:47-53): `g.revoked_at is null`, no clock parameter used (`_now`). True, never loads a revoked row, at any app clock. Test (site-grants.test.ts, "revoked grant denies") checks the revoke instant -60 s..+now. Expiry: `expires_at` is returned and `evaluate()` compares it with the app clock (single clock for that decision). A skew remains only in routes.ts:80: the duplicate check uses DB `now()` while issue validation uses `Date.now()`. Effect: at worst a duplicate is 409 or allowed within the skew of an expiry boundary. Minor, harmless.

## 3. I5
SQL: join `missions m ... m.deleted_at is null`, `g.tenant_id=$1 and g.mission_id=$2 and g.revoked_at is null`, `exists (agent_instances i where i.tenant_id=$1 and i.mission_id=$2 and i.agent_id=$3 and i.ended_at is null)`. Soft-deleted mission and ended instance give `[]` (test covers both, plus an un-ended instance restoring the grant, and an unknown agent via `decideOnOrigin`). Tenant scope is on both the grant and the instance. Correct.

## 4. Concurrency
Key `hashtext('site-grant:tenant:mission:origin')` taken with `pg_advisory_xact_lock` inside the idempotent transaction before the dup select. Identical strings always give the same key, so duplicates cannot pass; a 32-bit hash collision with another key only serialises two unrelated requests. Other locks (grep): agent-ver, agent-seed, agent-create, org-rev, org-prop, instance-backfill (all `hashtext` of distinct prefixes), EVENTS_LOCK (events/log.ts:22, a fixed constant) and `lock(1)` in auth. The grant route takes its lock first, then EVENTS_LOCK inside `emit`; no path takes EVENTS_LOCK and then a grant lock, so no ordering cycle. The five-concurrent test passes (one 201, four 409, one row). Row-level guarantee is by lock, not by index (accepted deviation). Minor: a direct SQL insert (not via the route) can still duplicate.

## 5. I2
Guard returns `old` on DELETE only when `current_setting('axion.purge_demo', true) = 'on'`; the only setter in `server/src` is `clearDemo` (seed/demo.ts, `set local`, transaction-bound). TRUNCATE still refused; UPDATE rules untouched; the test shows a plain DELETE still raises "append-only" and clearDemo cascades the grant away. A non-demo mission cannot be deleted by clearDemo (`demo=true` filter); the app has no other delete of missions. Only the cascade (FK `on delete cascade`) is reachable.

## 6. Tests not loosened
Diff of test files: hostile-origins.json additions only (305 lines, no deletions); benign-origins.json drops the IDN entries (intended by the ruling: those inputs are now hostile) and adds ASCII entries; the revoke test is stronger (clock sweep); the security test untouched; the DB-fence list gains entries. `staffingStepMs` 60000 to 30 is for staffing missions, not a loosening.

## Findings
- Minor routes.ts:80 and :66: duplicate check uses DB `now()`, issue/expiry uses the app clock (see 2).
- Minor routes.ts:78-80: duplicates are prevented by an advisory lock only; no DB constraint backs it.
- Minor origin.ts:98-101: PUBLIC_SUFFIXES is partial by statement (documented); `example.comx`-style long TLDs accepted.
