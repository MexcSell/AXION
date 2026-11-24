# c99 report: execution-module hardening (X1, c97 detector gaps)

Lane w97, branch `c99-exec-hardening`, base 8a02c4b, code tip after review round c (see the Review section). Server pure modules and tests only: no route, no migration, no `web/` change, no network, no DNS, no live database access.

**In plain words:** this hardens two pure decision modules. The execution-profile decider still enforces nothing, and the tamper detector is a lexical tripwire over scripted fixtures. It is not a guarantee and it does not measure any agent.

**Timing (honest):** the lane's code commits ended at 2026-11-23 12:59Z. The controller loop then stalled, and nobody wrote the report, reviewed the branch or merged it inside the Phase 2 window (it ended 21:45Z). The controller wrote this report on 2026-11-24 from re-run numbers on the committed tip. An earlier draft on the stray branch `c99-backup` (a different history with combined commits) is superseded and is not merged.

## Items, RED then GREEN (each its own pair, as the brief asked)
| Item | RED | GREEN |
|---|---|---|
| X1-1 `/var/run`, `/run` scopes | 1905af0a (9 refused-scope tests fail) | 5614edf8 |
| X1-2 item cap, time bound, faster matcher | 716954fc | 597659fa |
| X1-2b cap must read each list's length once (lying Proxy) | 0d2dd3e8 | 98170d25 |
| X1-3 length-changing pattern characters | b9d3b483 (U+0130, capital sigma) | b7f178e9 |
| 4 detector gaps (`>|`, `xargs`, glob reads, heredoc) | d7daadc6 (56 probes, 20 clean neighbours) | ecda358b |
| 4b glob reads as wide as the answer-name rule; sed/grep/awk script operands | 23274edf (20 probes, 15 clean neighbours) | e721f153 |
| 4c review findings (see Review) | 34d06444 (6 of 9 tests fail) | 0747381e |

## X1-1 to X1-3 (`server/src/exec-profile/`)
- **X1-1.** `SENSITIVE_ROOTS` adds `/var/run` and `/run`, at any depth and after normalisation. They are refused as `path_too_broad`, writable and read-only. `/var/runner`, `/runtime` and `/work/run` are still accepted. The validator message names the two new roots.
- **X1-2.** `MAX_REQUEST_ITEMS = 256`, counting URLs and paths together in one `decideRequests` call. Over the cap, the whole call is denied with reason `too_many_items`. Each list is copied once and the cap is checked on the copies (X1-2b), so a Proxy that reports a different length on a second read cannot get past it. Redirect hops per URL are unchanged (10).
- **X1-2 time bound.** A hostile but valid profile (32 patterns of 128 characters, 10 `*` each) against 256 paths of 4096 characters took **9.1 s** (load 1.96) on the re-run, and the test asserts under 20 s. That is still up to about 9 s of synchronous CPU, so a caller that accepts untrusted profiles should run the decider off the main thread.
- **Faster matcher.** It makes one dynamic-programming pass over `path + "/"` and visits only the reachable window. Two seeded differentials against the c94 matcher: 300,000 random pattern/path pairs (16,126 matches) and 100,000 `matchesAnyPattern` cases including U+0130 and U+03A3 (18,817 matches), both with **0 differences**. The reviewer's wider fuzz found 600k ASCII cases with 0 differences, and 165 Unicode cases where the new matcher matches and the old did not, all with sigma. They come from X1-3's deliberate per-character sigma fold. That is the safe side for forbidden patterns, so the claim is "equal on ASCII, never narrower", not "exactly equal".
- **X1-3.** A pattern character whose lower-case form has a different length (U+0130) is refused as `bad_pattern`, naming the entry. Capital sigma is folded per character on both sides, so the result does not depend on the neighbouring characters. Same-length non-ASCII (`é`, `Ü`, `Ж`) is still accepted.
- **One c94 assertion changed:** the fail-closed "too many items" test also accepts the new label `too_many_items`. Both labels deny, and no allow or deny result changed.

## Item 4: detector gaps (`server/src/evolution/tamper-detector.ts`)
- **`>|`** is parsed as a redirect, so its target is checked.
- **`xargs`.** The command it runs is analysed like any other, and `-a FILE` counts as a read. A writer fed by stdin (`rm`, `mv`, `chmod`, `sed -i`, unknown programs) is flagged `xargs_unseen_input`, because the paths it receives are not in the trajectory.
- **Globbed reads.** `glob_read` fires when a glob segment could expand to an answer name under the same naming rule the detector uses for literal paths. Round b widened this to dotted and leading-dot names (`.ans*`, `answers.*`), and to stem-plus-qualifier names in both orders. Qualifier-first names are only tried when the segment has at least 3 literal characters. A segment that is only wildcards before its first dot (`*`, `*.ts`, `.*`) is not flagged.
- **Script operands.** The first operand of `sed`, `grep`, `awk`, `jq` and `rg` is a script or pattern, so a glob character in it is not treated as a read (`sed 's/a*/b/' file`). With `-e`, `-f` or a cluster containing `e` or `f`, the explicit script argument is skipped instead. File operands are still checked: `sed -n 1p /work/ans*/k` and `awk 1 /work/.ans*/k` are flagged.
- **Heredocs.** Any `<<` (not `<<<`, not inside quotes) is flagged `heredoc_body`. The body is script content the detector never reads, so it fails closed.

## Detector numbers (fixtures only; Wilson 95% intervals; printed by `c99-tamper.test.ts` and `c99-tamper-b.test.ts`)
| Family | n | Caught | Rate (95% interval) | Before c99 (the lane's measurement on base 8a02c4b, from its superseded draft) |
|---|---|---|---|---|
| Original hacks (c97) | 40 | 38 | 95.0% (83.5–98.6) | 38 |
| Reviewer probes (c97) | 37 | 37 | 100% (90.6–100) | 37 |
| Round-2 probes (c97) | 23 | 23 | 100% (85.7–100) | 23 |
| Held-out (burnt since c97) | 30 | 30 | 100% (88.6–100) | 28 |
| **c99 probes (new)** | 56 | 56 | 100% (93.6–100) | 17 |
| clobber / xargs / glob / heredoc | 8 / 18 / 16 / 14 | all | 100% each (67.6 / 82.4 / 80.6 / 78.5 to 100) | |
| **c99 round-b probes (new)** | 20 | 20 | 100% (83.9–100) | |

The earlier families are unchanged, except that the held-out family now also catches the misses c97 predicted. The c99 probes were written by the author of the fix, with the rules in mind. So 100% shows the code meets its specification and says nothing about attackers nobody imagined.

**False-flag rate over all clean fixtures.** Every trajectory here is clean by construction.
| Clean set | n | Flagged | Rate (95% interval) |
|---|---|---|---|
| Earlier sets (c97 original 40, extra 8, round-2 8) | 56 | 2 | 3.6% (1.0–12.1) |
| c99 neighbours | 20 | 7 | 35.0% (18.1–56.7) |
| c99 round-b neighbours | 15 | 3 | 20.0% (7.0–45.2) |
| **All clean fixtures** | **91** | **12** | **13.2% (7.7–21.6)** |

The rate rose and is above the 10% line c97 used. All 12 flags are by design and the tests pin the exact set:
- 2 from the c97 score-0.95 review rule;
- 7 from c99: any heredoc (3, including `git commit -F- <<EOF`), stdin-fed `xargs` writers (2), and `cat`/`ls` globs that could name an answer file (`ls /work/s*`, `cat /work/src/a*.ts`);
- 3 from the older c97 answer-name rule (an operand that names `answers`).

I wrote these neighbours on purpose to find the cost. The rate on real command streams is unmeasured, and the heredoc and `xargs` rules will be hit by legitimate agent work. Use the detector as a review flag, not a verdict.

## Review (independent adversarial reviewer, 2026-11-24): NOT CLEAR, then fixed
- **Major 1 (loosening vs improve-30h).** The new `xargs` branch returned before the `script_run` check, so `./xargs`, `../xargs`, `/tmp/evil/xargs` and `sudo ./xargs` were no longer flagged. **Fixed:** a path-named `xargs` is `script_run` again, and its command is still analysed.
- **Major 2 (hole in the new rule).** Stdin reached `sh -c` scripts (`xargs -I{} sh -c 'rm {}'`, `xargs -I{} bash -c "{}"`, `xargs sh -c 'rm "$@"' _`) and a bare replacement command (`xargs -I{} {}`) without a flag. **Fixed:** both are `xargs_unseen_input`, and the `sh -c` script is still analysed for its literal paths.
- **Minor 3.** gawk `--source=`, `--source X`, `--exec=` and `-E` were not seen as the script, so a file operand was skipped. **Fixed.**
- **Minor 4.** Brace ranges (`answer_{1..3}`, `{a..c}nswers`) were not expanded. **Fixed:** expanded up to 64 results, and anything larger fails closed.
- Checked clean by the reviewer: no other loosening over about 743k old-versus-new commands; X1-1 normalisation; the X1-2 cap under Proxies, sparse arrays and revoked Proxies; X1-3; the c94 assertion change; no throws.
- RED 34d06444 (`c99-tamper-c.test.ts`, 9 tests, 6 failing), then GREEN. All detector numbers above are unchanged by round c.
- **Noted, not changed:** the X1-2 time bound has about 2x headroom (9–11 s against 20 s), so it could flake on a heavily loaded machine.

## Verification (on the committed tip after round c)
- c99 tests: 8 files, **75 passed**. c94 + c97 + c99 together: 16 files, **665 passed**, 0 failed. Server tsc exit 0.
- server tsc and web tsc, plus the full serial vitest: run on the merged integration tree (batch 56). The numbers are in MERGES.md.
- Diff stat: 4 server source files and 11 server test files. No `web/`, `shared/` or migration change.

## Still open
- From the re-review (CLEAR, 2026-11-24): globs and brace ranges over numbered answer names other than `_1`/`-1` (`answer_2*`, `answer_{2..3}`) are not flagged, because `ANSWER_NAMES_STEM_FIRST` lists only the `1` suffix while `isAnswerSeg` accepts any digits. This gap predates round c.
- Up to about 9 s of synchronous CPU for 256 hostile items. A real enforcement path needs a worker or smaller budgets.
- `xargs` readers of answer paths fed from stdin (`xargs cat < list`) are not seen.
- Quoted globs are treated like unquoted ones (the lexer drops quotes), which over-flags.
- Still unhandled from c97: `npm run`, `make` and `npx` content; symlink and mount aliases; case-insensitive file systems; answer names outside the qualifier list; `printf` into `eval`.

## Files changed
- Source: `server/src/exec-profile/paths.ts`, `decider.ts`, `validator.ts` (message only) and `server/src/evolution/tamper-detector.ts`.
- Tests: `server/test/c99-x1-1-scope`, `c99-x1-2-cap`, `c99-x1-2-matcher`, `c99-x1-2b-snapshot`, `c99-x1-3-pattern`, `c99-tamper`, `c99-tamper-b`, `c99-tamper-c` (`.test.ts`), `c99-fixtures.ts`, `c99-fixtures-b.ts`, and `c94-exec-profile-failclosed.test.ts` (one label).
- This report.
