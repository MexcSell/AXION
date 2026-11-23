# c73 review (independent): c73-polish, c852be8..c615539 (worktree /home/luca/AXION-w71)

Read-only. Live `axion` DB never touched; only axion_e2e16 (via api-e2e.sh/heavy.sh, ports 12192/12193) and the lane test DB through vitest/heavy.sh. No background job left; ports 12190-12193 free.

## Verdict: NOT CLEAR (one blocker: the P2c follow() fix is not in the branch)

## Findings

### B1 (blocker) P2c: commit 254f982 contains only the test; the follow() fix the report describes does not exist in git
- `git show --stat 254f982`: only `web/scripts/api-c73-pin.mjs` changed. `git log -- web/src/features/chat/ChatView.tsx` last touches it at a8545c4. `git status` / `git diff HEAD` are clean; `git log --all -S"behavior: 'auto'"` finds nothing; no stash.
- At the tip, ChatView.tsx:449 and :480 are still `window.setTimeout(() => scroller.current?.scrollTo({ top: 1e6, behavior: 'smooth' }), 30)`, decided at schedule time (`if (atBottom)`), no jump, no "read the pin when the timer fires". The report's "Fix item 2" and "behaviour change: jumps when more than a screen behind" are not true of the code.
- Evidence: `api-c73-pin` at the tip, REPS=3 BURST=100 (via heavy.sh): rep 1 and 2 `FAIL a reader who scrolls up in the middle of a burst is not pulled back to the bottom - 13 px / 14 px from the bottom`; rep 3 passed (1504 px). This is exactly the 4-of-6 failure the report says the follow-up fixed. The first checks (pinned after burst, 0 px) pass, so the onScroll half (a8545c4) works. The report's "api-c73-pin PASS at tip, BURST 100/200 x3" cannot have been run against the committed tree (probably an uncommitted edit that was lost or not staged).
- Fix required: commit the ChatView follow() change (timer reads atBottomRef when it fires; jump when > 1 screen behind), then rerun api-c73-pin (BURST 100/200, REPS>=3, all must pass), api-c26, api-c55, api-c44, c55-burst. Any numbers in the report for the "tip" run are not evidence for the committed code.

### Diagnosis and what was checked for P2c (against the code that does exist)
- Diagnosis is right: the smooth scroll is scheduled with a stale target, the growing thread outruns it, and the first scroll event sees `scrollHeight - scrollTop - clientHeight >= 40`, so the old onScroll unpinned. My run's scroll log at the tip shows first events at d=969..1057 (down) while still pinned, i.e. the situation the onScroll change now absorbs. The onScroll change (a8545c4) fixes pinning: all three reps pass the "pinned after burst" and "follows next message" checks.
- c55 hold-until-measured anchor: the diff does not touch the restore/hold code (only adds lastTop/catchT refs and a catch-up timer, cleared on unmount). Run at the tip: api-c55 THROTTLE=4 PASS (worst shift 0.2 0.3 0.2 px, bounded exit did not fire); api-c26 PASS (all PASS, still pinned true x3, 0 FAIL); api-c55-burst PASS (page errors 0, pinned true); api-c44 THROTTLE=4 PASS (excess -7 ms vs 80 ms bar; burst arrived whole). So the committed tree does not regress those; they are not evidence for the missing fix.
- Catch-up timer (should-fix once B1 is fixed, minor): the committed 80 ms catch-up does `e.scrollTop = e.scrollHeight` (an instant jump) whenever a downward scroll left a pinned reader > 40 px behind. So the committed code already jumps in the common case; the "smooth glide vs jump" question is partly moot. The catch-up checks `atBottomRef` at fire time, which is the right guard for scroll-up, but the in-flight smooth scroll is what pulls the reader back (the failing 13 px result), hence B1.
- Motion rule: a jump only when pinned and > 1 screen behind is acceptable (a smooth glide over 15k px never completes; that is the bug). A capped fast glide (e.g. scroll the last ~1 screen smoothly after jumping to bottom - 1 screen) would keep some motion, but is not necessary; a jump is what a chat does when the reader is following a flood. Reduced motion: the explicit `behavior: 'smooth'` calls (:449, :480, :615 pill) do not check `prefers-reduced-motion`; a jump is strictly safer for it. Minor: the 1-screen-or-less glide still ignores reduced motion (pre-existing).
- Minor: the test flags `88 px from the bottom` as "followed" for the single next message (passes on newest-visible); fine, but the pinned-bar of 60 px is only applied to the post-burst check.

### H18 (clear, minor note)
- Probe change reviewed: `waitForFunction` up to 15 s for the expected live-region text with the catch swallowed, then the unchanged `audit`. If the text never appears the audit still reports LIVEPROBE.
- Mutation (c57 style, applied to a scratch copy in the scratchpad, never the lane file): after each probe's goto, remove every `[aria-live],[role=status],[role=alert],[role=log]` and keep removing via MutationObserver; `A11Y_PROBE=sub=proposals`. Result: `a11y-check (api): 0 views, 0 dialogs, 8 violations {"LIVE":4,"LIVEPROBE":4}` - `LIVEPROBE no loading text matching /loading proposals/i in a live region (saw: )`, `/loading history/i`, `/not loaded/i` (fail mode). So the probe cannot pass when the live region never announces. The lane's 20 s delay case also still fails by design (15 s wait).
- Minor: the cause (late lazy mount) is inferred; the original `saw:` text was never recorded. The fix is aimed at a plausible race and the injection reproduces the symptom; the wait is a condition wait, not a sleep, and does not loosen the check. One more thing: `.catch(() => {})` hides a wait timeout, but the audit after it reports it, so nothing is lost.

### P4c
- Age: manifest `listVersion` date vs `(now() at time zone 'utc')::date` in SQL (psl-age.ts), so no app clock. Boundary: age 90 not stale, 91 stale, a future date not stale; test covers 0/1/90/91/200 against the DB date. `vitest test/psl-age.test.ts otel-export contracts`: 5 files, 54 tests pass. Day-count semantics: the warning flips at the first UTC midnight after day 90 (as the report says). The date is the list's version date, not the day the snapshot was fetched, so the age slightly overstates (conservative, fine).
- No refresh route (test checks 3 paths do not succeed); `/operations/health` uses `requireAdmin`; the panel help `ops.serverHealth` says in plain words what the tile is, the 90-day rule and that refresh is a reviewed code change. Minor: the new tile has only a Tip, no own `?`; the panel-level `?` covers it.
- **should-fix: when the age query fails, the panel is silent.** routes.ts returns `publicSuffix: null`; ServerHealth.tsx renders the tile only `{ps && ...}` (ps = `h?.publicSuffix`, falsy for null). The tile just disappears, and also the audit-anchor card keeps `gridColumn: ps ? 'span 2' : '1 / -1'`. An operator cannot tell "list is fresh" from "age unknown". The server-side guard (health stays 200) is right; the UI should show the tile with an "unknown" warn state ("age unavailable"). The Health interface in the web (`publicSuffix?: {...}`) also does not model null.
- Minor: the swallowed catch has no log line.

### H15
- Reproduced the exact regexes from export.ts (SECRET_SHAPE, TOOL_NAME, LONG_DIGITS, ident, agentName) in a scratch script, plus the real tests: `otel-export.test.ts` passes, including all S1 sentinels (the sentinel `sk-TESTSENTINEL...` strings are refused by SECRET_SHAPE regardless of hyphen).
- Results: `sk-abc`, `pk-abc`, `rk-abc`, `SK-abc`, `ghp-abc123`, `xoxb-123-456`, `xoxp-1`, `AKIA...`, `eyJ...`, `sk-` all `_OTHER`; `web-search`, `read-file.v2` kept. `1234567890123`, 13 zeros `_OTHER`; 12 digits kept.
- **minor (defence in depth, newly opened for tool names only): hyphenated vendor tokens whose prefix is not in SECRET_SHAPE are now kept as tool names**: `glpat-abcDEF123456`, `xapp-1-A0-123`, `github-pat-11AAAA`, `shpat-abc123`, `Bearer-abcdef123456`, `api-key-abcdef123456` all KEPT (before this cycle the hyphen alone made them `_OTHER`). Case/dataset ids and agent names already allowed hyphens before c73, so only the tool-name surface grew. The brief only required sk-/pk-/rk-; the help text tells operators not to put anything sensitive in a name. Suggest adding `glpat|xapp|shpat|github[-_]pat|npm` to SECRET_SHAPE if cheap, else document.
- **minor: `4111-1111-1111-1111` (digits with hyphens) is kept as a case id / dataset id / agent name**; the LONG_DIGITS rule only catches pure digit runs, as specified ("all-digit"). Also `4111 1111 1111 1111` is kept as an agent name (space allowed), and `hunter2 pw` stays exported. Acceptable as documented: the help now says identifier-shaped ids and names leave in default mode and not to put anything sensitive in them. Not a blocker.
- Help text (cli.ts USAGE, mapping note, otel-mapping.md) says what leaves, matches behaviour; S3 test (`not.toMatch(/secret|127\.0\.0\.1/)`) still passes.

### Process (minor)
- The first RED of psl-age ran outside heavy.sh (plain `npx vitest run`), admitted in the report; it only failed at import, no DB load. Noted.
- The report states tip-run results for api-c73-pin and a stack of other checks as PASS "at the tip (254f982)", and they are the only evidence for P2c; given B1 these were run on a tree that is not what is committed. The branch's tip commit message also describes code it does not contain. Lesson for LESSONS.md: before the report, `git diff <base>..HEAD --stat` must list every file the report names, and the RED/GREEN runs must come from a clean checkout of the tip (`git status` empty).
- c73-health.png is committed, shows the tile (not re-viewed).

## Not run
Full vitest, flows, verify-all, fit-check, a11y full (demo/api), 20x probe: not repeated; B1 forces a new tip anyway. I ran: api-c73-pin (REPS=3 BURST=100), api-c26, api-c55-burst, api-c55 THROTTLE=4, api-c44 THROTTLE=4, vitest psl-age/otel-export/contracts (54 pass), H18 strip-live mutation, H15 regex probes.

## Fixes required (CLEAR AFTER FIXES once done)
1. B1: commit the missing ChatView follow() change and rerun api-c73-pin (BURST 100 and 200, REPS>=3, zero FAIL), plus c26/c55/c44 (x4)/c55-burst on the final tip from a clean tree; correct the report if numbers change.
2. P4c: show the tile with an "age unavailable" warn state when publicSuffix is null (and type the web interface as nullable).
3. Optional: extend SECRET_SHAPE to glpat/xapp/shpat/github-pat, or note the gap.

---

# Re-review (fix round), c615539..59b78cf (tip 59b78cf)

`git status` clean; `git diff c852be8..59b78cf --stat` lists 18 files, matching the report's claim (incl. ChatView.tsx +34, ServerHealth.tsx, stage5.ts, api-c73-psl.mjs, export.ts). All runs on the committed tip, via heavy.sh, ports 12190-12193, live DB untouched.

## B1 (P2c): RESOLVED
- The fix is now in git (30f2129): `toBottom(el)` jumps (`behavior:'auto'`) when more than one `clientHeight` behind or when `matchMedia('(prefers-reduced-motion: reduce)')` matches, else glides; `follow()` reads `atBottomRef` when the 30 ms timer fires, used by both the message and typing effects; the "N new" pill also uses `toBottom`. Reduced-motion behaviour verified by code reading only (not browser-run). It also closes the earlier minor about the pill and follow ignoring reduced motion.
- `api-c73-pin` BURST=100 x3 and BURST=200 x3: every check PASS in all 6 reps (0 px from bottom, no pill, next message followed, scroll-up leaves reader 1504-1592 px above the bottom). The 2-of-3 failure from round 1 is gone.
- api-c26 3 reps no FAIL (still pinned true); api-c55-burst PASS (reload pinned, 0 distance); api-c44 THROTTLE=4 PASS (excess +16 ms vs 80 ms bar, burst whole, no page errors).
- api-c55 THROTTLE=4: first run FAILED (page 1 worst shift 999 px) at load 14-33 caused by other lanes; rerun alone PASS (worst shift 0.3 0.1 0.4 px, bounded exit not fired). The 999 px at heavy load is a flake I could not attribute (c55 anchor code untouched by this round); minor, but note the c55 bar did fail once under load 14+ with this tip.
- Also api-c44 first run timed out waiting for the composer at load 33; passed on rerun at load 16.

## Other checks
- verify-all (own OUT, dev server on 12190, which I started and stopped by port): rc 0, all steps passed. flows at FLOWS_CPU_THROTTLE=4: rc 0 (flows x1 runs inside verify-all). a11y demo: `52 views, 65 dialogs, 0 violations`.
- P4c: `DATA_MODE=api node scripts/api-c73-psl.mjs` PASS 3/3: fresh "2 d old, snapshot 2026-11-21 - 10,469 rules"; 120 days "older than 90 days: refresh it"; null "Age unavailable - could not be read: do not assume it is fresh"; each tile has its own `?` (`ops.publicSuffix`, plain-words help entry). The route now logs the failed read. (Run without `DATA_MODE=api` the script shows the demo page and fails: harness invocation, not a bug; the script header does not say so.) Minor.
- H15: extended SECRET_SHAPE tested with the real regex: sk-/pk-/rk-/xoxb-/AKIA/ya29./glpat-/xapp-/shpat-/github-pat-/npm_/hf_/ghu_/ghr_ all `_OTHER`; `npm-install`, `hf-search`, `github-search`, `skill-run`, `pkg-install` kept; otel-export tests (incl. S1 sentinels) passed in the lane's tip run (3,135 vitest per report; I did not rerun vitest this round). Pre-existing `gho`/`ghs`/`AIza` prefix without a separator over-match: `ghost-writer`, `ghostwrite`, `Aizawa-tool` become `_OTHER`. It fails closed (loses a name, leaks nothing), so acceptable; minor, could add a separator for gho/ghs.

## Remaining
Nothing blocking. Minors only: the over-match above, the c55 once-under-load flake, psl script needs `DATA_MODE=api` stated in its header, not re-run: full vitest, fit-check, api-c56/c60/stage6.

## Verdict: CLEAR
