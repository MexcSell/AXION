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
- **Guard:** `axion-guard deploy | status | rollback | history | front-port`, installed in `/srv/axion-evolve/guard`
  (agents cannot change it). Every deploy runs these steps: lock → check protected files → contains the live version →
  build → all tests in a container with no internet (4836 server tests + typechecks + sign-in browser check; the count
  may never drop) → boot on its own → backup → start beside live → smoke → drain → switch → watch → record.
- **Server:** only one copy runs the background jobs (chat answers for waiting messages, approval expiry, staffing
  resume), using a database lock; health shows the commit and which copy leads; in Docker, database updates are a
  separate approved step.
- **Network:** live copies have no internet except Claude's API, through `axion-egress` (exact allowlist; private
  addresses refused; nothing secret logged).
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
8. The Guard keeps images of rejected candidates until the next successful deploy; I removed the demo ones by hand.
9. Two unnamed Docker volumes appeared on the host during the day; one at a time the Guard was idle, so they are most
   likely another app's. I did not delete them.

## Open for you

- Merge `evolve-step1` into `improve-30h`/`main` and push (your decision; nothing is pushed).
- The step 2 go: AXION's own agents make changes in the Workshop (an owner request → mission → engineer agent → Guard).

## Rulings I made on your behalf

See the ledger list in the hand-over message; each says what it costs if wrong.
