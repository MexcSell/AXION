# c94 report: execution profile validator and request decider (R6-1, first slice)

Lane w92, branch `c94-exec-profile`, base 362ced9. Server module, contracts types and tests only. No route, no migration, no `web/` change, no network, no DNS, no database access beyond the vitest setup the other tests already use.

## In plain words
**This decides, it does not enforce.** The validator says whether a profile is safe to adopt, and the decider says allow or deny, with a reason, for URLs and file paths. Nothing starts a sandbox, filters traffic, or resolves a name. A host name that points at a private address cannot be seen without DNS, so that check belongs to the future egress proxy. Enforcement needs a sandbox and proxy (next phase, owner point O1). The approval-digest binding of the profile hash (R6-1 threshold c) is not part of this slice: it needs a digest version change.

## What was built
- `shared/contracts/src/exec-profile.ts`: versioned profile type (filesystem scope, network default deny with granted origins and blocked ranges, four resource limits, required isolation tier `process|container|microvm`, `untrustedContent` flag), `canonicalJson`, `execProfileSha256`. Not re-exported from `index.ts` because the hash uses `node:crypto` and `index.ts` reaches the web bundle.
- `server/src/exec-profile/validator.ts`: `validateExecProfile`, 25 reason codes, returns every refusal with a path and a message.
- `server/src/exec-profile/decider.ts`: `urlWithinGrantedOrigins` (the one new URL function), `decideUrl`, `decidePath`, `decideRequests`.
- `server/src/exec-profile/paths.ts`: strict absolute-path normaliser, glob matcher, built-in credential patterns.
- No second URL parser: origins come from `originOfUrl` (browser/schema.ts), which calls `normaliseOrigin` (c36, c56). The decider adds a check on the path, query and fragment text for controls, whitespace, backslashes and invisible characters, and a length cap.
- E1 (MCP SSRF guidance) is cited only by analogy for the IP-encoding and redirect checks.

## Items, RED then GREEN (each its own commit)
| Item | RED | GREEN |
|---|---|---|
| 1 Schema and hash | module missing | 3 tests pass |
| 2 Validator | module missing | 62 tests pass |
| 3 Decider | module missing; after the module existed, 5 first-run failures, see "Honest notes" | 370 tests pass |
| 4 Fail closed | 42 of 73 fail on the first run against the item-3 decider | 73 pass |

## Pass thresholds
- **(b) permissive, wildcard, missing limit, missing tier, untrusted on weakest tier: PASS.** 56 refusal fixtures (brief asked for 15 or more), 56 of 56 refused, each with its expected reason code. Includes 5 permissive defaults, 4 wildcard origins, 7 missing or invalid limits, missing and unknown tier, the untrusted-on-process case, unknown fields, bad origins, incomplete blocked ranges, bad paths.
- **(a) request decider: PASS.** Own fixtures: 192 (115 URL deny, 58 path deny, 10 URL allow, 9 path allow). Plus 169 hostile-origins entries reused as requested URLs against `https://good.com` (all 178 entries minus the 9 whose only fault is a path, query or fragment, which are legitimate URLs on a granted origin; non-string inputs are covered in item 4). 100% of must-deny denied (173 own + 169 reused = 342 of 342), 100% of explicit grants allowed (19 of 19), each own case with its exact reason code. Total 361 cases, brief asked for 60 or more.
- **Item 4 fail closed: PASS.** Unknown fields (profile, request, item), `__proto__` keys, accessor and throwing-proxy objects, non-object items, bad `access`, non-array lists, over 1000 items, unparsable and over-long URLs, lone surrogates and line-separator characters in paths: all deny, none throw. A malformed item cannot hide among good ones (it is its own denied item and the request is not allowed).
- Not in this slice, by the brief: threshold (c) digest binding.

## Verification
- tsc (`cd server && npx tsc --noEmit -p .`): clean.
- c94 tests: 4 files, 508 tests, all pass (schema 3, validator 62, decider 370, fail-closed 73).
- Full serial vitest: see the last section.

## Honest notes
- Five first-run decider failures were my guessed reason codes, not security gaps; each case was denied. `169.254.169.254.:80` and `[fe80::1%25eth0]` come back `url_refused` (trailing dot, percent-encoding) rather than `ip_literal_denied`; `http://127.0.0.1/` as a redirect hop is `redirect_not_granted` (wrong scheme is checked first); `../etc/passwd` is `path_not_absolute`. I changed the expected reasons in the fixtures, never an allow/deny result. The fifth was my own DNS-spy test trying to patch ES module exports; replaced by CJS spies plus a static check that the sources import no I/O module.
- Real gaps the item-4 RED run found, now fixed: a 100,000-character URL path was allowed, and paths with a lone surrogate, U+2028 or a bidi override were allowed.
- Host case: `https://GOOD.com` is allowed as the granted `https://good.com` (names are case-insensitive and the normaliser lowercases). Look-alikes that fold to it under Unicode (Kelvin sign, fullwidth, small roman numeral) are denied as `lookalike_host`. If the owner wants any case difference denied, that is one line.
- All IP literals are denied, including public ones (`https://1.1.1.1/`), because the grant normaliser refuses them. `blockedRanges` is therefore a required, checked record (the nine mandatory ranges must be listed) that the proxy will use later; the decider's IP denial does not depend on it.
- Symlinks inside a granted directory, DNS rebinding, and a name that resolves to a private address cannot be seen by a pure decider. They are enforcement-phase work.
- `blockedRanges` must contain the nine required CIDR strings exactly; a broader range such as `0.0.0.0/0` does not satisfy the check. Deliberate for a first slice.

## Files
New: `shared/contracts/src/exec-profile.ts`; `server/src/exec-profile/{paths,validator,decider}.ts`; `server/test/c94-exec-profile-{schema,validator,decider,failclosed}.test.ts`; `server/test/fixtures/exec-profile-good.ts`, `server/test/fixtures/exec-profile-requests.json`; this report.

## Review round (controller findings, fixed)
RED commit first (28 of the non-hanging review and decider tests failed; the ReDoS group could not be run to completion because the glob matcher hung the event loop, which is the finding), then the GREEN commit.
1. **Major, profile read twice (accessors).** `validateExecProfile` validated the input, then copied it with `JSON.parse(JSON.stringify(input))`, so a getter could answer differently the second time. Now it takes one deep snapshot first (data properties only; getters, proxies, symbol keys, non-plain prototypes, functions, cycles and nesting over 6 levels make it refuse as `unparseable`), validates that snapshot, and returns that same snapshot. The input is never read again. Tests cover the 3-reads-then-evil getter probe, getters at three levels, proxies, class instances, cycles and detachment of the result.
2. **Major, ReDoS in forbidden patterns.** The regex built from `**/` could go exponential. Replaced by `globMatch`, a dynamic-programming matcher (cost is tokens times path length, no backtracking), and the validator now refuses (`bad_pattern`) patterns over 128 characters, more than 3 `**`, more than 12 `*` or `?`, control characters, a backslash, and lists over 32 patterns. Tests: hostile patterns refused; a worst-case allowed pattern decides a 4096-character path in under 50 ms; glob meaning unchanged.
3. **Sensitive scopes.** `/`, `/etc`, `/proc`, `/root`, `/sys`, `/dev` and everything under them are refused as writable or read-only scope (`path_too_broad`). Look-alike names (`/etcetera`, `/rooted`) are still fine.
4. **Credential directories.** Matching now also tries the path with a trailing slash, so `/work/out/.ssh`, `.aws`, `.gnupg`, `.kube` and `.config/gcloud` themselves are denied, not only their children.
5. **Redirect tag.** A hop with a wrong scheme or no scheme (`http://127.0.0.1/`, `//169.254.169.254/`, `ftp://localhost/`) is now tagged `redirect_internal` when its host is internal. It was already denied.
6. **Not handled (Linux only).** Windows path spellings such as `.env ` with a trailing space or `.env::$DATA` are not handled. They do not exist on the Linux hosts this targets.

## Full test run
Round 1 (before the review fixes): 4164 tests, 4127 passed, 36 skipped, 1 failed.

Round 2 (after the review fixes; serial, `heavy.sh`, 621 s): 181 files, 4200 tests, **4163 passed, 36 skipped, 1 failed**. The c94 tests are 5 files, 544 tests, all passing. `tsc` is clean.

The one failure is the known `test/c92-script-base.test.ts > c92 H23 ... no script hard-codes a live port default` (`c82-pixel.mjs:7`). It reads a `web/scripts` file this lane does not touch, so it is ignored here.
