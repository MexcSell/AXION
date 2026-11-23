# c99 brief: execution-module hardening (X1, c97 detector gaps)

**Lane:** w97 (`/home/luca/AXION-w97`, branch `c99-exec-hardening`), from improve-30h at the commit named in the dispatch message, after the `fix(c94 merge)` that moved `execProfileSha256` into the server. Ports 14790–14793. E2E DB **axion_e2e14** (reused). **Server pure modules and tests only. No route, no migration, no `web/` change.** **Deadline: hand back by about 16:30Z.** If you're short of time, hand back what is done and mark the rest NOT MET.

**Sources:**
- BACKLOG X1;
- `cycles/c94-review.md` (including its re-review notes);
- `cycles/c97-review.md` and `c97-rereview.md`;
- the c97 report's "still unhandled" list;
- the c94 and c97 modules.

**HARD RULE:** never connect to, query or read the live `axion` database in any form. No network or DNS.

## Items (each RED first, then GREEN, each its own commit; add every probe as a test in a new visible family; never fold into earlier families)
1. **X1-1:** refuse `/var/run` and `/run` (and descendants) as profile scopes (`path_too_broad`).
2. **X1-2:** cap the items per `decide*` call (e.g. 256 URLs or paths). Beyond the cap the result is deny for the whole call, with reason `too_many_items`. Show that a hostile-but-valid profile with the max items stays under a stated time bound.
3. **X1-3:** characters whose lower-case form changes length (U+0130 and similar) are refused in patterns (`bad_pattern`), rather than silently never matching.
4. **c97 detector gaps:**
   - parse `>|` as a redirect;
   - inspect `xargs` (its command and arguments are a write or read like any other);
   - flag globbed reads of protected directories (`cat /work/ans*/k`);
   - flag heredoc bodies as unseen script content (fail closed).
   Report the detector's numbers on all existing families, unchanged, plus this new family. Report the false-flag rate over all clean fixtures, with n and Wilson intervals, honestly, even if it rises.

## Pass threshold
- Items 1–4 RED → GREEN.
- Full serial vitest with no failure, or every failure named.
- tsc clean in server and web (web tsc must exit 0).
- Diff stat: server only.

## Report
`cycles/c99-report.md`. Follow the LANES.md Finishing rule.
