# c56 review: pinned Public Suffix List (branch c56-public-suffix, bfe891e..3afdb9d)

Reviewer ran: server `tsc` (clean); vitest on psl, psl-vectors, psl-snapshot, origin and site-grants (all pass; the first site-grants run hit "too many connections for role axion" from other lanes, the rerun passed 21/21); probe scripts in the scratchpad against psl.ts and normaliseOrigin. The browser checks were not rerun (the DB connection limit was already hit once); the report's 14/14, 35/35, 94/94 and a11y numbers are unverified by me.

## Findings

### 1. should-fix: a corrupt or empty snapshot fails OPEN, silently
Evidence: with the `.dat` replaced by an empty file, `normaliseOrigin('https://co.uk')` returns `{"ok":true,...}` and so does `https://github.io`. A missing file throws ENOENT at import, so the server will not start (loud, fail closed). The hash is only checked in vitest, never at runtime, and `load()` (psl.ts:14-27) has no sanity check. Any truncation, bad deploy or partial copy leaves only the implicit `*` rule, so only bare TLDs are refused.
Fix: at load, compute SHA-256 of the file and compare with the manifest (about 1 ms for 340 KB), or at least assert `n > 8000` and that sentinel rules (`co.uk`, `github.io`, a `*.ck` wildcard and `!www.ck` exception) are present. Throw on failure so the server refuses to start. Add a test that a truncated copy throws.

### 2. should-fix (document, or decide): two hosts c36 refused are now accepted
Evidence: running the 36 removed `PUBLIC_SUFFIXES` entries through `normaliseOrigin`: `amazonaws.com` and `glitch.me` return `{"ok":true}`. Neither is a rule in the current list (`amazonaws.com` is a registrable domain; only `s3.amazonaws.com`, `*.compute.amazonaws.com` and others are). Per the PSL this is correct, but it is a loosening against c36 behaviour, and no c36 test pins either name, which is why "every c36 test passes" did not notice. The grant is still one exact origin, so exposure is small, but `https://amazonaws.com` is plausible to mistype for an S3 URL.
Fix: either state it in the report as an intended consequence, or keep a tiny additive deny list (`amazonaws.com`, `glitch.me`) on top of the PSL, with a test. I lean toward the deny list, since removing a safeguard was not in the brief ("replace c36's partial embedded list with the snapshot" is satisfied either way).

### 3. minor: the manifest is not independently protected
Evidence: `psl-snapshot.test.ts` compares the `.dat` to the hash in the manifest, and both live in the same directory and commit. An editor who changes both passes the test. The "one changed byte changes the hash" test (lines 35-38) only tests SHA-256, not the repo. The test does catch an edit to the `.dat` alone, a stale manifest, and a header or version-stamp edit. Mitigation that costs little: pin `manifest.list.sha256` in the report and in the review of the refresh commit (done in the report), and make the refresh commit its own reviewed commit. No code change is required; I would not call this a blocker.

### 4. minor: three upper-case vectors are skipped as grant origins
Evidence: psl-vectors.test.ts line 21 excludes `/[A-Z]/` inputs from the "as grant origins" set. The normaliser lowercases (probe: `https://CO.UK` gives `public_suffix`), so these vectors do apply. They still run through `registrableDomain` (all 78 are covered there; `grep -c '^checkPublicSuffix'` gives 78 and all parse). The only other exclusions are legitimate: no dot (single_label), a leading dot, the `example` TLD (reserved), and IDN/xn-- (refused by c36 by design; asserted refused). Fix: drop the `[A-Z]` exclusion (and compare against `want`) or add one explicit case-test line.

### 5. minor: licensing and notices
Nothing in the repo (no LICENSE, NOTICE or THIRD_PARTY file). MPL-2.0 is file-level copyleft: shipping the unmodified `.dat` with its header intact, with the source named in the manifest, meets it (the test enforces the header). The vectors are CC0, no obligation. Adequate: add a short `THIRD_PARTY_NOTICES.md` (or a section in an existing doc) listing the PSL (MPL-2.0, source URL, version/commit, that the file is unmodified) and the vectors (CC0-1.0). Do not add a heavy LICENSES tree. Note the list is Mozilla-owned and MPL requires that if the file is ever edited, the edit stays under MPL; the manifest already says "do not edit by hand".

### 6. minor: no staleness signal (the report's own concern)
The pinned list will age. A refresh reminder (backlog) is reasonable; not needed to merge.

## Verified OK

- **Algorithm** (psl.ts:30-45): exception returns suffix = rule minus first label and wins immediately; wildcard `*.x` matches exactly one extra label; longest match; implicit `*` default (`a.b.nosuchtld` gives suffix `nosuchtld`). Probes: `ck` is a suffix (implicit), `test.ck` suffix, `www.ck` not, `a.www.ck` has registrable `www.ck`, `TEST.CK`/`CO.UK` lowercased, 28-label host under `test.ck` handled, `blogspot.com` suffix and `x.blogspot.com` not, `xn--p1ai` suffix. Rules with `*.`/`!` stripped and put through `domainToASCII` (the Unicode rules become punycode); my probe shows 10,469 rules parsed and 0 dropped by `domainToASCII`. ICANN and PRIVATE sections are both loaded. The refusal is "the host itself is a suffix" (`labels.length <= suffixLength`), which is the right condition: registrable domain would equal the suffix only when the host is the suffix. `registrableDomain` and `isPublicSuffix` are consistent. Hostile and odd input: trailing dot, leading dot and empty labels return null in psl.ts (not "suffix"), but normaliseOrigin refuses these earlier (`trailing_dot`, `empty_label`), so there is no hole. IP-like hosts are refused earlier as `ip_literal`. Fullwidth dots and look-alikes are refused by c36 as `idna_mapped`. `isPublicSuffix` is called only after the c36 checks, so none of c36's refusals (IDN, private addresses, confusables, ip, metadata, reserved, bad_tld) was weakened by the removal; the removed code was only the final set lookup.
- **Fail-closed, missing file:** import error aborts startup (see finding 1 for corrupt).
- **Performance:** one synchronous read and parse at import (about 10 ms by the report); 100k lookups of a 9-label host took 377 ms (about 4 us each); memory is three Sets of about 10k short strings. Parsed once; only origin.ts imports it.
- **Tests / RED evidence:** credible and specific (ENOENT, missing module, concrete accepted-before hosts). The report admits items 2 and 3 were run RED together; acceptable. No c36 test file was modified in the diff (only new tests added), so nothing loosened.
- **UI:** refusal text is plain words with examples; `?` (`HelpTrigger k="grants.publicSuffix"`) appears only when `reason === 'public_suffix'`; help entry `grants.publicSuffix` exists in c36-site-grants.ts. api-c56.mjs uses a condition-wait helper (`until`, polling a predicate to a timeout, 150 ms step) and `waitFor`, no fixed sleeps. Its idempotency key prefix still says `c36-` (cosmetic, unused).
- **Contracts:** no new route, field or code; `public_suffix` already in `REFUSAL_REASONS`; only the free-text message changed. `reason` is passed through from the existing check response. No c50 contract change needed (I did not run the contract tests).

## Verdict: CLEAR AFTER FIXES

Fixes: (1) runtime integrity or sanity check on load, with a truncated-file test; (2) decide on `amazonaws.com` and `glitch.me`: keep an additive deny list, or record it as an intended loosening in the report. Optional: findings 4 and 5 (the upper-case vector and the THIRD_PARTY note).
