# Parallel lanes: rules every lane implementer follows

The owner asked (2026-11-21) to use all resources and run many cycles at once. Each cycle runs in its own git worktree
("lane"). The controller reviews each lane and merges it into `improve-30h`.

## Your lane
Lane L lives in `/home/luca/AXION-wL` on its own branch. Port base B is 5000 + L×100 for lanes 2–9, and
6000 + (L−10)×100 for lanes 10 and up (so w28 = 7800, w30 = 8000).

| Purpose | Port / name |
|---|---|
| Your dev server (demo-mode suite, fit checks, perf) | B+90 |
| `vite preview` (production build checks) | B+91 |
| e2e API / e2e web (api-mode browser checks) | B+92 / B+93 |
| e2e database | `axion_e2eL` (already set in your lane's `server/.env`) |

## Commands (run from your worktree)
- **Every heavy run goes through the shared gate:** `/home/luca/AXION-lanes/heavy.sh <command>`. This applies to server
  tests, browser checks and verify-all. The gate allows at most 6 heavy runs at once on the whole machine, because the
  shared PostgreSQL server (max 100 connections) also serves other apps. Never bypass it. Typecheck (`tsc`) and builds
  don't need it.
- **Server tests:** `cd server && npx tsc --noEmit -p . && /home/luca/AXION-lanes/heavy.sh npx vitest run`
  - The `axion` DB role is capped at 45 connections shared by every lane. If a full run fails with `too many connections for role "axion"` or `admin connect failed`, re-run serially: `heavy.sh npx vitest run --maxWorkers=1 --no-file-parallelism`, and name the failing tests (BACKLOG H14).
- **Browser checks:** `cd web && E2E_API_PORT=$((B+92)) E2E_WEB_PORT=$((B+93)) /home/luca/AXION-lanes/heavy.sh ./scripts/api-e2e.sh <scripts>`
- **Dev server:** `cd web && setsid node node_modules/vite/bin/vite.js --config /home/luca/AXION-lanes/vite-wL.config.ts --host 127.0.0.1 --port $((B+90)) --strictPort > /tmp/wL-vite.log 2>&1 &`
  - The override config only adds the symlinked `node_modules` to Vite's `fs.allow`. Never commit it.
  - Demo suite: `OUT=/tmp/axion-verify-wL BASE=http://127.0.0.1:$((B+90)) /home/luca/AXION-lanes/heavy.sh ./scripts/verify-all.sh` (own OUT dir: the default /tmp/axion-verify is shared).
  - Stop the dev server by port when done.

## Never
- Never copy `AUDIT_ANCHOR_*` settings from the live `.env` (new-lane.sh strips them; set hermetic test values in tests).
- Never touch `/home/luca/AXION` (the integration tree), another lane's worktree, or ports 5190 (live web) and 5191
  (live API). Never use another lane's ports.
- Never use the real `axion` database (your `.env` points it at `axion_lane_disabled`). Never run `npm run dev`,
  `migrate` or `demo:*` in `server/`.
- Never `git stash`: the stash is shared by every worktree, so another lane can pop yours. Commit work-in-progress on your branch instead, and squash it later if you like.
- Never `pkill -f`: kill by port with `ss -ltnpH "sport = :PORT"`. Kill by PID **only** a PID you recorded when you started that process (write it to `/tmp/wL-<name>.pid`). Never kill a process because it looks stale: check `readlink /proc/<pid>/cwd` is under your own worktree first, and if in doubt, leave it (2026-11-22: a lane killed the integrator's verify-all by PID). Never push, merge or rebase onto other branches.
- Never loosen auth, visibility, append-only rules, the execution guard or a test to make something pass.

## Migrations
Migrations 0001–0013 are on `improve-30h`. Reserved numbers, so lanes never collide:

| Lane | Migration |
|---|---|
| w2 | 0014 |
| w3 | 0015 |
| w4 | 0016 |
| w8 | 0017 |
| w7 | 0018 |
| w9 | 0019 |
| w10 | 0020 |
| w11 | 0021 |
| w12 | 0022 |
| w17 | 0023 |
| w18 | 0024 |
| w28 (c30, only if needed) | 0025 |
| w29 (c31) | 0026 |
| w30 (c32) | 0027 |
| w31 (c33) | 0028 |
| w33 (c35) | 0029 |
| w34 (c36) | 0030 |
| w36 (c38) | 0031 |
| w37 (c39; dev port 8794, because 8790 is used by another app) | 0032 |
| w39 (c41) | 0033 |
| w41 (c42; lane 40 skipped, because port 9090 is used by another app) | 0034 |
| w44 (c45 job leases) | 0035 |
| M1 scorecard lane (c46, after batch 9; only if needed) | 0036 |
| w46 (c47 eval evidence) | 0037 |
| w48 (c49 audit anchor, only if needed; unused) | 0038 |
| w50 (c51 review hardening) | 0039 |
| w52 (c53 eval integrity, only if needed) | 0040 |
| w53 (c54 clock and dimensions, only if needed) | 0041 |
| w55 (c56 public suffix, only if needed) | 0042 |
| w57 (c58 rule of two, only if needed) | 0043 |
| w58 (c59 origin records, only if needed) | 0044 |
| w59 (c60 attribution and OTel, only if needed) | 0045 |
| w60 (c61 eval instruments) | 0046 |
| w61 (c63 failure learning) | 0047 |
| w62 (c64 restructure guardrails) | 0048 |
| w63 (c65 review capacity, only if needed) | 0049 |
| w64 (c66 metric guard, only if needed) | 0050 |
| w66 (c68 attention queue, only if needed) | 0051 |
| w68 (c70 hardening, only if needed) | 0052 |
| w69 (c71 scorecard scale, only if needed) | 0053 |
| w70 (c72 skill ratings; unused) | 0054 |
| w73 (c75 approval evidence, only if needed) | 0055 |
| w74 (c76 Stage 8 records, PARKED) | 0056 |
| w75 (c77 Stage 9 records, PARKED) | 0057 |

Use your number only if you really need a migration.

## Commits and reports
- Commit on your branch. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Put your report in `web/docs/improve/cycles/cNN-report.md` and commit it. Include RED/GREEN evidence, each pass
  threshold item marked PASS/FAIL/NOT MET with honest evidence, the files changed, screenshots if the UI changed, and
  concerns.
- Other lanes change files in parallel. Keep your diff to what your brief needs, and prefer new files over editing
  shared ones (for example a new browser-check script `web/scripts/api-cNN.mjs` instead of extending `api-improve.mjs`).
- **Finishing:** start your final check script (verify-all, fit, a11y, api-mobile) as soon as the code is done, and write the report while it runs. Record every background PID in `/tmp/wL-<name>.pid`. Stop your servers by port before handing back. **Before you report, check that `git status` is clean and that `git diff <base>..HEAD --stat` lists every file your report says you changed; take your final GREEN runs from that committed tree** (2026-11-23: c73 reported a ChatView fix that was never committed). **Hand back exactly once**, and never leave a background job running after your hand-back (2026-11-22: lanes ran out of context mid-checks or looped re-sending reports).
- In api mode never wait for `networkidle`, and never add fixed sleeps. Use `domcontentloaded` + `settle()` and
  condition waits.

## Test databases for lanes 28 and up
The `axion` role can't create databases, and nobody uses sudo for that. New lanes reuse a retired lane's e2e DB, which the harness empties and re-migrates on every start: w28 → axion_e2e2, w29 → axion_e2e3, w30 → axion_e2e4. w31 → axion_e2e5, w32 → axion_e2e6, w33 → axion_e2e7, w34 → axion_e2e8, w35 → axion_e2e9, w36 → axion_e2e10, w37 → axion_e2e11, w38 → axion_e2e12, w39 → axion_e2e13, w41 → axion_e2e14, w42 → axion_e2e15, w43 → axion_e2e16, w44 → axion_e2e17, w46 → axion_e2e2 (reused again; c30 merged), w47 → axion_e2e3 (c31 merged), w48 → axion_e2e4 (c32 merged), w45 → axion_e2e18, w49 → axion_e2e15 (c43 merged), w50 → axion_e2e16 (c44 merged), w51 → axion_e2e17 (c45 merged). Wave 5 (all earlier branches merged): w52 → axion_e2e18, w53 → axion_e2e2, w54 → axion_e2e3, w55 → axion_e2e4, w56 → axion_e2e15. Wave 6: w57 → axion_e2e16, w58 → axion_e2e17, w59 → axion_e2e14, w60 → axion_e2e13, w61 → axion_e2e12, w62 → axion_e2e11, w63 → axion_e2e10, w64 → axion_e2e9, w65 → axion_e2e8, w66 → axion_e2e7, w67 → axion_e2e6, w68 → axion_e2e5, w69 → axion_e2e14, w70 → axion_e2e13, w71 → axion_e2e16, w72 → axion_e2e15, w73 → axion_e2e17, w74 → axion_e2e18, w75 → axion_e2e2, w76 → axion_e2e3, w77 → axion_e2e4, w78 → axion_e2e5. Next free: axion_e2e18 (reserved for the M1 lane), then the DBs of lanes whose branches have merged (check with the controller). Edit the new lane's `server/.env` after `new-lane.sh`.
