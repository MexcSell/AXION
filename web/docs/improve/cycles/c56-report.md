# c56 report: pinned Public Suffix List (P4b)

Lane w55, branch `c56-public-suffix`, from improve-30h at bfe891e. No migration used (0042 stays free). E2E DB axion_e2e4, ports 10590-10593.

## Snapshot
- Source: https://publicsuffix.org/list/public_suffix_list.dat (plain GET, generic User-Agent, nothing about the project sent).
- Fetched **2026-11-22T17:50:24Z**, **342,871 bytes**, SHA-256 `017501d3fa7911c60ac7e0f68df4122b07216c585c15dc30e0f0c74b8d13a2b9`.
- List VERSION `2026-11-21_04-33-45_UTC`, COMMIT `87a2c1b8de5886a133ff4da21b2aa6fec88d8739`. MPL-2.0 header untouched (the test checks it).
- Test vectors: publicsuffix/list `tests/test_psl.txt` (CC0), 4,308 bytes, SHA-256 `8f50ad958916d6a8f79fba2363501475571acce752757f9126fe9d2f17dd920d`.
- Manifest: `server/src/grants/public_suffix_list.manifest.json`. To refresh: fetch both files, replace, update the manifest in the same commit.

## RED then GREEN (one commit per item)
| Item | RED (before) | GREEN |
|---|---|---|
| 1 snapshot (fe18042) | `psl-snapshot.test.ts`: `Error: ENOENT: no such file or directory, open '.../public_suffix_list.manifest.json'` | 5/5 pass: size and hash match, header and version stamp intact, a one-byte edit changes the hash, vectors pinned |
| 2 refuse suffixes (380b434) | `psl.test.ts`: `Error: Cannot find module '../src/grants/psl.ts'`. On the unchanged normaliser, `https://test.ck`, `x.kawasaki.jp`, `myshopify.com`, `eu-1.compute.amazonaws.com`, `ide.kyoto.jp`, `uk.com`, `c.mm` were all `{"ok":true}` (accepted) | new psl.ts (normal, wildcard, exception rules; ICANN and PRIVATE; unicode rules converted to punycode); all refused with `public_suffix`; `www.ck`, `city.kawasaki.jp`, `shop.myshopify.com`, `user.github.io`, `example.co.uk` accepted. The partial `PUBLIC_SUFFIXES` set is removed |
| 3 vectors (45d3c67) | `psl-vectors.test.ts`: `Error: Cannot find module '../src/grants/psl.ts'` | 78 vectors parsed; every `registrableDomain` result equals the published expectation (unicode compared in ASCII form); ASCII host vectors run as grant origins (suffix -> `public_suffix`, otherwise accepted); the IDN and `xn--` vectors stay refused (P4a separate) |
| 4 UI (d18ff1d) | `api-c56.mjs` on the unchanged dialog: `FAIL https://co.uk shows the ? help for a public suffix...` (4 such FAILs), then `TimeoutError: locator.click` on the missing `?`; 5/10 | 14/14: plain-words refusal, a `?` ("Public suffix", with an example) beside it, Grant site off; accepted names show no `?` |

The refusal wording is now: "That is a public suffix: a shared ending that many unrelated sites sit under (like co.uk or github.io), so a grant for it would cover every one of them. Grant one specific site instead, such as example.co.uk or yourname.github.io." The refusal code is the existing `public_suffix` (already in `REFUSAL_REASONS` and the contract's free-text `reason`), so no new code or field and no contract or allowlist change.

Note on vector test shape: items 2 and 3 tests were written and run RED together before psl.ts existed, then committed per item.

## Pass threshold
| Threshold item | Result | Evidence |
|---|---|---|
| Items 1-4 RED then GREEN | PASS | table above |
| Every c36 test still passes | PASS | origin.test.ts and site-grants.test.ts (hostile corpus incl. its `public_suffix` entries, benign corpus) pass; api-c36.mjs 35/35 |
| server tsc | PASS | `npx tsc --noEmit -p .` clean; web tsc also clean |
| Full vitest (via heavy.sh) | PASS | 72 files, 2279 tests passed, 0 failed (149 s, load average 16.7 at the end) |
| api-c36 (site-grants check) | PASS | 35/35, no page errors |
| api-c56 (new) | PASS | 14/14, no page errors |
| stage6 | PASS | api-stage6.mjs 94/94, no page errors |
| a11y | PASS | a11y-check (api): 41 views, 65 dialogs, 0 violations in 212 s. The 20 `probe ... slow/fail` lines are the check's deliberate injected slow and failed requests (each shows its state in a live region), not violations |
| Contract entries for new code or field | PASS (none needed) | the code `public_suffix` already existed; no new route, field or allowlist line |


## Files changed
- server/src/grants/psl.ts (new), public_suffix_list.dat (new), public_suffix_list.manifest.json (new), origin.ts (partial list removed; refusal text)
- server/test/psl-snapshot.test.ts, psl.test.ts, psl-vectors.test.ts (new), fixtures/test_psl.txt (new)
- web/src/dialogs/defs/site-grants.tsx (keeps the refusal reason, shows the `?`), web/src/help/pages/c36-site-grants.ts (`grants.publicSuffix`), web/scripts/api-c56.mjs (new)
- Screenshot: written to /tmp/axion-api-c56-10593/improve-c56-help.png (not committed; set DOC_SHOT_C56 to write it into docs).

## Concerns
- The PSL is a moving list. The snapshot is pinned and will age; a refresh is a manual, reviewed commit (a hash test fails on silent edits, but nothing warns that the snapshot is old). Backlog candidate: an age note in the grants panel or a CI reminder.
- A grant is for one exact origin, so refusing a suffix itself does not stop an admin granting `https://anything.github.io`, which is intended and covers only that site. The existing dialog warning about shared hosting stays.
- `psl.ts` reads the 340 KB file synchronously once at import (about 10 ms). It is only imported by origin.ts.
- `.local`-style non-Internet TLDs listed in the PSL are still refused earlier by the reserved-name rule; the vectors for them are commented out upstream.
- Wall-clock under load: the machine load average was 5-17 during the runs (270 users logged in); the full browser pass was slow, not flaky.

## Fix round (review c56-review.md, controller rulings 1-4)
Commits: efa4494 (ruling 1), the ruling 2 commit, 3dea62f (rulings 3 and 4), 46d2515 (null-safe lower-case in the vector test).

| Ruling | RED | GREEN |
|---|---|---|
| 1 fail closed at load | new `psl-integrity.test.ts`: 6/6 failed (`parseSnapshot is not a function`) | `parseSnapshot(text, expectedSha256)` in psl.ts checks the manifest SHA-256, a floor of 8,000 rules and the sentinels `co.uk`, `github.io`, `*.ck`, `!www.ck`; throws otherwise, so import fails and the server will not start. 6/6: an empty file, a truncated file and a one-byte edit each throw; a self-consistent hash does not save an empty or truncated file; a missing sentinel throws. Import cost, measured with tsx (includes the TypeScript transform): 21-26 ms, hash adds about 1 ms |
| 2 no loosening vs c36 | `grants-deny.test.ts`: all 36 removed entries run through `normaliseOrigin`; 2 failed (`amazonaws.com`, `glitch.me` accepted) | mechanical check: exactly those 2 of the 36 are not covered by the PSL. `EXTRA_REFUSED_HOSTS` in origin.ts ("multi-tenant hosts refused in addition to the PSL") refuses them as `public_suffix`; 39/39, each of the 36 is pinned; subdomains of them stay accepted (one exact origin) |
| 3 THIRD_PARTY_NOTICES.md | n/a (document) | repo root: PSL (MPL-2.0, source, version, commit, unmodified, path) and the vectors (CC0-1.0, source, path) |
| 4 upper-case vectors | `[A-Z]` exclusion removed: `https://example.COM` and `https://WwW.example.COM` failed (expectation compared with the un-lowered input) | the expected origin is lower-cased, as the normaliser does; 143/143, all vectors including upper-case go through `normaliseOrigin` |

Re-run results
- server `tsc --noEmit`: clean.
- Full vitest via heavy.sh: 74 files, 2,326 tests. The shared database server hit "too many connections for role axion" on every full run (other lanes; load average 11-22, 270 users): run 1 77 failed, run 2 131 failed, run 3 (`--maxWorkers=2`) 31 failed, all in DB-backed files unrelated to this cycle (agents, jobs, missions, playbooks, seed, task-reviews, and others) with "too many connections" or the follow-on "Cannot read properties of undefined (close)". Re-running only the failed files with `--no-file-parallelism` left 2 files, and `jobs.test.ts` (76/76) and `task-reviews.test.ts` then passed alone. Every file passed at least once after the last code change; no single full run was green. New and touched files (psl-integrity 6, grants-deny 39, psl 30 incl. snapshot, psl-vectors 143, origin, site-grants) pass in every run. Honest status: full suite not green in one run because of database connection exhaustion by other lanes.
- api-c36: 35/35, no page errors. api-c56: 14/14, no page errors (one heavy.sh run, E2E ports 10592/10593, both ports free afterwards).
- Load average at the api run: 9.9 (13.9 five-minute).
