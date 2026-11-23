# c74 report: the dev server watches shared contracts (H19)

Lane w72, branch `c74-shared-watch`, from improve-30h at 0759872. Web config only, no migration.

## Root cause
`shared/contracts` lies outside Vite's root (`web/`). Vite's chokidar watcher only learns of such files one at a time, as each is imported (file-level watch by inode). A merge or editor save replaces a file by atomic rename, which gives it a new inode. The file watch dies with the old inode and chokidar's atomic-write handling is racy, so the next change is not seen and the module graph keeps serving the old module. A watched directory did not help: adding `shared/contracts/src` with `server.watcher.add` still gave 5/10 (tried, rejected).

## RED (default config, dev server on 12290, same command shape as 5190)
`web/scripts/shared-watch-check.sh` does 10 rounds: write a new file under `shared/contracts/src`, atomically rename a new `index.ts` that exports it, then curl `/@fs/.../index.ts` and wait up to 4 s for the new export.
- Run 1: `5/10 fresh` (rounds 2, 4, 6, 8, 10 STALE). Run 2: `5/10 fresh` (the odd rounds STALE).
- So the miss is every second atomic rename of a file already in the module graph, not a one-off, and it never recovers by itself. This matches the "5 of 10 verify-all steps failed" history.
- Server log showed events for `index.ts.tmp` but none for `index.ts` in the stale rounds.

## Fix (`web/vite.config.ts`, one line plus comment)
`server.watch: { usePolling: true, interval: 300 }`. Polling stats paths, so it is rename-proof. Rejected: directory add (5/10).

## GREEN (committed tree)
- `shared-watch-check.sh` 10/10 fresh, repeated (3 earlier runs 10/10 each, plus the final run from the committed tree 10/10).
- Cost: idle dev-server CPU about 2% (measured over 10 s, 836 files under web/ excluding node_modules). HMR latency up to 300 ms.
- Lane override config merges the base config (mergeConfig), so `server.watch` carries through; verify-all ran through the override.

## Pass threshold
| Item | Result |
|---|---|
| RED reproduced | PASS (5/10, 5/10) |
| GREEN 10/10 | PASS |
| verify-all 10/10 (own OUT /tmp/axion-verify-w72, dev 12290) | PASS: "ALL 10 STEPS PASSED", 0 FAIL lines (a first attempt was cut by my own 580 s timeout under load 16, then rerun whole) |
| fit-check (demo) | PASS: ALL FIT, 82 ok, 0 BAD |
| web tsc | PASS |

## Files changed
- `web/vite.config.ts` (polling)
- `web/scripts/shared-watch-check.sh` (new; restores index.ts and removes probes on exit)
- `web/docs/improve/QUEUE.md` (one standard-check line)
- `web/docs/improve/cycles/c74-report.md`

## Concerns
- Polling applies to the whole web root, not only `shared`; chokidar cannot poll one subtree from `server.watch`. Cost measured as small.
- The e2e Vite (api-e2e.sh) uses the base config, so it polls too; not separately measured.
- 5190 only gains the fix after the controller restarts it; the check script run against 5190 proves it (it restores what it touches, but it does write to the tree `/home/luca/AXION/shared/contracts/src`, so run it only when no merge is in flight).
- Not tested: a real `git merge` or `git checkout` rewriting many files at once; renames were the measured failure.
