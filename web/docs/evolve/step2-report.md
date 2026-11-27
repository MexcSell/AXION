# Evolution step 2 (Workshop): report

Date: 2026-11-27. Written for the owner. Design: `2026-11-26-autonomous-evolution-design.md` (approved). Plan:
`2026-11-26-step2-plan.md`. Branch `evolve-step2`, merged into `improve-30h` and `main` and pushed to GitHub on your word
("When you're done, push it to GitHub and start step 3", 2026-11-27).

## Result

**Step 2 is done and its exit check passed.** An administrator's request typed into AXION now becomes an `improve` mission.
AXION's own engineer agent changes the code in a sealed Workshop container, the change is checked, and the Guard takes it
live, all without Claude Code.

| Exit check | What happened |
|---|---|
| three real owner requests live | **M-138** "updated Invalid Date" → "updated —" (live 08:10Z); **M-139** long "Files changed" list shows 20 + "Show all N files" (live 08:29Z); **M-140** loading texts announced to screen readers in 5 places (live 08:50Z). Each one passed on its first attempt, and each came with its own test. |
| one forced failure rolled back | **M-141** (run with `--inject-failure`): went live, began answering 503, and after 3 bad polls the Guard switched back to the previous version by itself (09:00Z). `evolve/main` did not move, the mission shows "Rolled back". |

Timing per change: the engineer, the gates, the typecheck and the reviewer took **1–3 minutes**. The Guard (build, 4878
tests, boot, backup, switch, 2-minute watch) took about **17.5 minutes**.

One more request, **M-137**, was the first try of M-138's request. The engineer's change was correct, but the Guard rejected it
at its backup step because of a fault on the host side. See "Incident" below. The live site was not touched.

## What is new

- **"Improve AXION itself"**: a new mission kind, for administrators only (tick it in Add mission). A member cannot create one,
  edit one, or turn their own mission into one. The mission's Results and Reports tabs show the change: its state, commit, files,
  diff summary, checks, the Guard's verdict, the engineer's report and the last 5 attempts.
- **Runner `axion-evolve`**: a systemd service, enabled. It polls every 30 s and takes one mission at a time. Commands: `status`,
  `pause [reason]`, `resume`, `approve <mission>`, `file --owner <name> --text …`, `once`, `sweep`.
  - **Limits:** at most 12 changes per UTC day and 3 attempts per mission. After 2 rollbacks in a row the runner writes
    `/srv/axion-evolve/PAUSED` and stops.
  - **Kill switches:** the run halts in Settings, `axion-evolve pause`, or `systemctl stop axion-evolve`.
- **Workshop:**
  - **Account:** the engineer runs on Claude 1. The chat stays on Claude 2.
  - **Sandbox:** a container on an internal network whose only way out is `api.anthropic.com` through the egress proxy. The
    engineer sees a copy of the code with no git history, and runs as a system user with no login (`axion-ws`).
  - **Tools:** Read, Edit, Write, Glob and Grep; it has no shell. Every settings source and project config (`.claude`,
    `CLAUDE.md`, `.mcp.json`, …) is switched off.
- **Gates before the Guard:**
  - the protected-files check;
  - a secret scan, which also looks for encoded forms;
  - static flags for new network calls, eval, file writes, environment reads and destructive SQL;
  - unsafe file names;
  - a typecheck with no network;
  - a separate reviewer model call, which can send the change back with feedback.
  - A protected or flagged change is first typechecked and reviewed, then held for you: `axion-evolve approve <mission>`.
- **Protected list grew:**
  - agent, editor and CI config;
  - the files the mission tool trusts (`db.ts`, `run-halts.ts`, `machine.ts`, `events/log.ts`);
  - `web/docs/evolve/**` and `web/docs/improve/**`.
- **Users:** `axion-ws` and `axion-egress` were created. No container that runs agent-written or candidate code runs as a login
  account any more; the egress proxy used to run as uid 1000 (`thomas`).

## Verification (numbers)

- **Build process:** 4 tasks, each built by a fresh AI worker and reviewed by a separate reviewer: 7 fix rounds, every Important
  finding fixed. Then a whole-branch review found 1 Critical, 5 Important and 12 Minor findings. One fix wave and one smaller
  follow-up round fixed them, and the follow-up's re-review came back **clean**.
- **Tests:** runner 137, Guard 139 (0 failed). The server suite in the Guard's container: **4878 passed**, 0 failed; that is the
  new floor.
- **Real proofs before go-live:**
  - The engineer ran as an unresolved uid, and `/proc/<pid>/environ` of the claude process was owned by that uid, not 1000.
  - The Guard's real build and checks passed with its workers as that uid.

## Incident, and one disclosure each

- **I-S2-1, first live mission rejected (M-137).** The service's PATH lacked `/usr/sbin`, so the Guard it started could not find
  `runuser` for the backup. My step 1 deploys never hit this, because they ran from a root shell.
  - **Fix** (`e556cd7a`): the unit's PATH includes the sbin dirs, and `backup.sh` adds them itself. A test pins it.
  - **Proof:** I deployed the fix with the old short PATH on purpose, and the backup ran.
  - **Afterwards:** M-137 stays "failed" (by design, a rejected change fails its mission), so I filed the request again as M-138.
- **Note:** after that reinstall, systemd still ran the old unit settings until I ran `daemon-reload` myself, although the
  installer had run one. It is harmless now. After any install that changes the unit, check
  `systemctl show axion-evolve -p Environment`.
- **D1, token in a process list (from the Task 3 proof).** The Claude 1 token was briefly an argument of a `grep` on the host, so
  anyone running `ps` at that moment could have seen it. It was never printed or stored. **You decide whether to rotate
  TOKEN1.**
- **D3, two unnamed containers.** During the uid audit two throw-away `--rm` containers (`id` on the postgres and nginx images) ran
  without the agreed test name prefix. They are gone and touched nothing.
- **D4, no chat traffic to watch.** No chat traffic happened in the 6 hours around the go-live, so I could not watch a real chat
  reply after it. I checked the parts it depends on instead: health answers, the leader is set, and the live copy reaches
  Claude's API through the new egress. Chat code did not change.

## Things to know (honest list)

- **Not on live:** this report and the updated STATE.md live only in git (protected docs). The live site runs
  `evolve/main` = `594d3b8f`, which now equals `main` minus these two docs.
- **History repo:** agent changes land in `/srv/axion-evolve/repo.git` `evolve/main`. They reach `/home/luca/AXION` only when
  Claude Code merges them on purpose, as I did today after reading them (R49).
- **Root containers:** a few containers still start as root: the dependency install stage of the build, the throw-away postgres,
  and the nginx master. None of them runs agent or candidate code, and dependency files are protected. Removing root entirely
  would need Docker's user-namespace mode, which is a host-wide change (R37, R42).
- **Rare cases where a mission shows "Going live" for too long:**
  - a stop signal arriving during a one-shot `approve`;
  - the history trim dropping one recovery note.
  - In both, the next runner restart clears it (R43).
- **When the mission tool cannot reach the database,** the runner retries once every 30 s with no back-off. The history no longer
  grows during such an outage.
- **`went-live.jsonl`** gets one line per live change and is never trimmed, so a change already made is never made twice.
- **Cost:** Claude 1 quota is used only by the engineer and reviewer calls, about 1–3 minutes of model time per change.

## Open for you

- **Rotate TOKEN1** (D1)?
- **The admin channel:** rename, hide, or remove (options 1–3 from earlier).
- **Step 3** (the autonomous loop: agents propose their own ideas, with limits and kill switch on; 24 h unattended run): you
  said start it. Planning is underway.

## Rulings I made on your behalf (each: what it costs if wrong)

- **P1** The `file` command runs the staffing steps itself. Cost: owner-filed missions look slightly different in the Timeline.
- **P2** The mission tool starts with only `DATABASE_URL`. Cost: a small refactor.
- **P3** The Workshop sees the tree without `.git`. Cost: none.
- **P4** The typecheck copies the read-only tree into memory. Cost: none.
- **P5** The mission tool runs from the live image (`axion-app:<active image>`). Cost: none.
- **P6** The installer's data copy never overwrites (`--ignore-existing`). Cost: none.
- **P7** Model choice per task: Opus for the database and security parts. Cost: more tokens.
- **R23** A running mission whose last change failed can be taken again. Cost: a retried mission uses another attempt.
- **R24** One host lock for the runner, for approve and for recovery. Cost: an approve waits while a change runs.
- **R25 → R27** Tests may be added but existing protected test files cannot be overwritten (exact-path denies). Cost: the engineer
  cannot edit an existing test; it adds a new one.
- **R26** Agent, editor and CI config are protected and denied to the engineer. Cost: changing them needs you.
- **R28** The secret scan looks for the values of secret-named keys. Cost: a secret under an innocent name is caught only by the
  static flags.
- **R29** Engineer timeouts and errors use the next attempt (max 3). Cost: up to 2 more Claude 1 runs.
- **R30** Change trees are kept under `/srv/axion-evolve/changes/`. Cost: disk.
- **R31** Dedicated no-login users `axion-ws` and `axion-egress`; uids are looked up at run time. Cost: two system users.
- **R32** The mission tool's trusted imports are protected. Cost: changes to 4 core server files need you.
- **R33** The controller docs and editor/dev-container settings are protected. Cost: you approve changes to these docs via the
  Guard.
- **R34** A change held for you is typechecked and reviewed first. Cost: a few minutes before the hold.
- **R35** The eval flag fires only on calls, not on words like `data-eval-id`. Cost: an fs read import is no longer flagged.
- **R36** The installer installs the unit but does not enable it. Cost: one manual `systemctl enable`.
- **R37 / R42** "No container as a login uid" means no container that runs agent or candidate code or holds TOKEN1. Cost: root
  remains in the build's dependency stage and in postgres and nginx.
- **R38** A few stricter flags than the review asked for. Cost: a few more holds for you.
- **R39** An approve that finds the Guard busy for 30 min puts the mission back to waiting. Cost: one extra mission event.
- **R40** Smaller deviations accepted (already-live missions are completed without a second change, and others). Cost: none
  seen.
- **R41** One extra fix round instead of none, for a history bug that could have deployed a change twice. Cost: about an hour.
- **R43** Two rare "stuck until restart" cases deferred. Cost: a mission can show "Going live" until the next restart.
- **R44 / R47** I approved the two Claude Code deploys of this step's protected code under your delegation (`8e38ea12`,
  `e556cd7a`). No agent-written protected change was approved. Cost: a defect there would be live, though rollback and revert
  are available.
- **R45** Your third demo request ("the help text says admin-only") was already true, so I replaced it with the files-list
  button. Cost: a different third change than planned.
- **R46** The 3-line PATH fix had no separate reviewer; a test pins it and the real run proved it. Cost: none seen.
- **R48** M-137 was left failed and its request filed again. Cost: one failed mission in the list.
- **R49** I merged the agents' three live commits into `main` after reading them, so GitHub matches live. Cost:
  agent-written code in the integration tree (each commit can be reverted).
