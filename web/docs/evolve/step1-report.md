# Evolution step 1: report

Date: 2026-11-26. Written for the owner. Design: `2026-11-26-autonomous-evolution-design.md` (approved). Plan:
`2026-11-26-step1-plan.md`. Branch `evolve-step1` (local only; not merged, not pushed).

## Result

**Step 1 is done and its exit check passed.** Since **2026-11-26 17:07Z** the live AXION site on port 5190 runs in
Docker under the Guard. A change that breaks only once it is live was taken off the site automatically about 30 seconds after it began failing.

| Exit check | What happened |
|---|---|
| (a) a change that breaks the build | rejected at `build` (type error); the live site was not touched |
| (b) a change to a protected file, no approval | stopped with "needs the owner's approval" (exit 3); nothing built |
| (c) a change that passes every check but fails live | went live 19:44:23Z, started failing at 19:45:15Z, the Guard switched back by itself at 19:45:47Z; the version history (`evolve/main`) did not move |

A first version of (c) was caught even earlier, at the "boot on its own" check, before reaching the site. The second
version, which fails only after a minute as the live leader, was needed to show the automatic rollback.

## What is new

- **Live site:** two slots (`axion-blue`, `axion-green`), one image per commit, behind `axion-front` (nginx) on 0.0.0.0:5190.
  Only the active slot restarts after a reboot.
- **Guard:** `axion-guard deploy | status | rollback | revert | history | front-port`, installed in `/srv/axion-evolve/guard`
  (agents cannot change it). Every deploy runs these steps: lock → check protected files → contains the live version →
  build (the candidate's code is built with no network) → all tests in a read-only container with no internet, judged by the
  Guard's own copy of the check script (4836+ server tests + typechecks + sign-in browser check; the count may never drop below the
  last live version's) → boot on its own → backup → start beside live → smoke (`/`, sign-in route, health) → drain → switch → watch
  (health + error answers) → record. `revert` takes the live version back to the previous one on purpose.
- **Server:** only one copy runs the background jobs (chat answers for waiting messages, approval expiry, staffing
  resume), using a database lock; health shows the commit and which copy leads; in Docker, database updates are a
  separate approved step.
- **Network:** live copies have no internet except Claude's API, through `axion-egress` (exact allowlist; private
  addresses refused; nothing secret logged), and since 2026-11-26 22:12Z they cannot reach any service on the host either (checked:
  ports 22, 80, 8081, 5432 on every host address closed from inside the live network).
- **Database:** unchanged location; slots connect through the local socket as a new system user `axion`. No change to
  the database server's settings, no restart, no other app touched.

## Verification (numbers)

- Every part was built by a fresh AI worker and reviewed by a separate reviewer before the next started
  (Tasks 1–6: 9 review rounds in total, every Important finding fixed). Guard: 102 tests; egress: 24; server suite in the
  container: 4836 passed, 0 failed, 36 skipped (opt-in).
- Trial on a copy of the database (port 5290): first deploy 8.5 min end to end (build 1.6, tests 4.7, boot 4 s,
  watch 2 min); 66 chat messages sent around a switch → **66 answered exactly once**; the event stream reconnected in
  1 s; killing the Guard mid-switch → `rollback` restored the old copy, a second `rollback` said "nothing to do"; two
  deploys at once → the second refused; front starts while a slot is down and recovers by itself.
- Cutover: API down **1.1 s** (restart onto the new code), site down **1.3 s** (port move). Public IP answers.

## Final review, one incident, and the fix wave

A separate reviewer read the whole branch at the end. It found one real problem on the live server and a list of gaps in the
checks.

- **Incident (17:07–20:03Z, fixed):** the old native site had two system services set to restart themselves. After the cutover, the
  old API came back on its own and ran on the live database beside the new Docker copy for about 3 hours. I switched both services
  off at 20:03Z (`systemctl disable --now axion-api axion-web`, reversible) and checked the database: in that window no person posted,
  no message was answered twice, no mission ran, and the only new audit entries were my own checks. The install script now does
  this itself.
- **Fix wave (all fixed, then re-reviewed clean):**
  - Candidate code can no longer change the things that judge it: the tests run read-only with the Guard's own check script, the
    test tools start without npm, and the build runs without network.
  - Live, check and boot copies cannot reach the host's own services.
  - More files are protected: the type-check and build settings, the server's start-up, database update and leader code, and the
    health route.
  - Smoke checks the home page and the sign-in route.
  - Watch also counts error answers.
  - The test floor follows the last live version.
  - Old images are removed after every deploy, not only after a successful one.
  - New `revert` command.
  - Backups cover the right database and prune whole sets.
  - Log size limits.
  - Tests: Guard 126, server 4835 passed, 0 failed. The Guard's real checks were run against hostile test candidates: every attempt
    to write was refused.
- **Live update:** the Guard was reinstalled at `298af32b` and the live network recreated (22:12Z, about 1 s). The fixes were then
  deployed through the Guard itself, with my approval under your delegation because they touch protected files. Result: **live 2026-11-26 23:17:52Z** in `axion-blue` (image `298af32be93b-20261126T231015Z`): build 2.4 min, checks 4.9 min (4836 passed = the floor), boot 5 s, smoke, switch, 10 min watch clean; health `leader:true`; Claude 2 answers from the slot through the egress proxy. The previous version (`43ebf7ae`) is kept for `rollback`.

## Things to know (honest list)

1. **One "denied sign-in" entry for `admin`** is in the audit log at ~17:08Z: I checked that sign-in works after the
   cutover with a deliberately wrong password on the existing account (a new name would have registered a user).
2. **Claude CLI was missing** from the container image in the plan; found in the trial, fixed (pinned 2.1.325, the
   host's version). That change touched a protected file, so it went through the approval path; I approved it under your
   24-hour delegation.
3. The live site has **Claude 2 only** (as designed). Claude 1 is not configured inside the live copies.
4. The browser check `api-flows.mjs` is **out of date since 2026-11-25** (it expects the removed demo missions); the
   Guard runs `api-auth-flow.mjs` only until it is updated.
5. The site answers on the IP address and `localhost`; a **host name** (e.g. a domain) gets 403 from the web server.
   This was the same before the cutover.
6. `/home/luca/AXION/server/data` is **no longer written**; live data is in `/srv/axion-evolve/data`. Backups are in
   `/srv/axion-evolve/backups` (one before every switch, 14 kept).
7. A test member `evolve-trial` exists only in the copy database `axion_restore_check`, not in the live one.
8. During the fix wave, a worker ran `docker image prune -f` once across the whole host. It reported nothing removed.
9. Two unnamed Docker volumes appeared on the host during the day; one at a time the Guard was idle, so they are most
   likely another app's. I did not delete them.

## Open for you

- **Push to GitHub:** you said "merge it" (2026-11-26 21:49Z). I merged `evolve-step1` into `improve-30h` and moved `main` to it
  locally. I did not push.
- Known gaps that remain:
  - a test left running by a candidate could fake the number of passed tests, though not whether they passed (R19);
  - `server/src/app.ts` is not protected (R21);
  - two Guards started at the same moment on a stale lock could both run (Guards are started by people today).

## Rulings I made on your behalf (each: what it costs if wrong)

- R1 egress proxy port 3128 — one config value.
- R2 image working dir `/app` with the whole repo tree — a path edit.
- R3 two images per commit (app; checks with Chromium) — an image layout change.
- R4 host/live steps run by me, not by workers — none.
- R5 the checks get the git history through a read-only mount (one server test diffs against an old commit) — one test fails.
- R6 only the sign-in browser check runs until `api-flows.mjs` is updated (out of date since 2026-11-25) — the mission-flow
  browser path is not checked.
- R7/R11 the Guard judges with its own installed copies of the check script, Dockerfiles and `evolve/`, never the candidate's —
  a candidate's own `evolve/` edits never take effect.
- R8 the egress proxy also refuses private and cloud-metadata addresses — a few lines.
- R9 an approval is bound to the commit and the live version it was made against — small.
- R10 "boot on its own" = no internet and an empty throwaway database — none.
- R12 drain = 5 s grace, old copy stopped with 30 s for in-flight answers — an answer taking over 30 s is answered again by the new
  copy.
- R13 Docker commands tested with a fake runner, then for real in the trial — bugs surfaced in the trial (one did: the Claude CLI).
- R14 extra hardening pulled into a review round — none.
- R15 I fixed the app image myself (Claude CLI line) and approved deploying it under your delegation — none.
- R16 one fix wave after the final review, live update afterwards — a larger branch to review.
- R17 "merge it" = local merge into `improve-30h` and `main`, no push — you push with one command.
- R18 the old Docker builder is kept (needed for no-network builds) — deploys fail, safely, if a Docker upgrade drops it.
- R19 the passed-count forgery above is accepted for now — a change that deletes tests could pass the floor once.
- R20 the test floor has no owner override — an approved test deletion needs a protected baseline edit first.
- R21 `server/src/app.ts` stays unprotected — a candidate that drops the health route fails smoke (one rejected deploy).
- R22 I approved the fix-wave deploy (`298af32b`) under your delegation — the Guard rolls back on its own, or `axion-guard rollback`.
