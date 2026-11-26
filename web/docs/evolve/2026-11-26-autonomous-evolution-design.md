# AXION autonomous evolution: design

Date: 2026-11-26. Status: **Approved** by the owner 2026-11-26 ("yes, approved. start step 1"). Decisions E1–E4 and B8 are the owner's; §13 B1–B7 are Claude Code's calls.
Reference used (read-only, designs not code): `/home/thomas/subnet-scout` (AXoR): `backend/app/self_edit.py`, `workbench/`, `k8s/redeploy.sh`,
`k8s/backup.sh`, `backend/app/egress_proxy.py`, `k8s/base/56-sandbox.yaml`.

## 1. Intent

The owner wants AXION to **improve itself continuously and autonomously**: AXION's own agents change the website's code, the agents'
own code (prompts, skills, logic) and the content, and the changes go live without a person doing the work. "It must evolve and develop
autonomously." Today nothing does this: missions are staffed but nothing executes, and the chat model has no tools.

Success, as the owner put it: the site keeps getting better on its own, and a bad change never takes it down.

## 2. Owner decisions (2026-11-26)

| # | Decision | Notes |
|---|---|---|
| E1 | **Approach B**: three separate parts (Workshop, Guard, Live site). Not "the site rebuilds itself" (A), not "native without Docker" (C). | Chosen from A/B/C. |
| E2 | **Docker is allowed** for this. | Reverses master spec §0 ("No Docker/containers ... only by explicit Owner decision"). This is that decision. |
| E3 | **Auto-live vs owner click split** (table in §6) is kept as proposed. | |
| E4 | Use subnet-scout as the reference. | Port its designs; do not copy its two weak points (§10). |

Implied by E1–E3 and recorded here so it is visible: this code-change class **skips the A→E execution roadmap order**
(`FINAL-REPORT-PHASE2.md` §12, decisions O1–O5 were for browsing). The roadmap still applies to browsing/external-action work, which this
design does not enable. It also replaces master spec D-08's "owner-reviewed promote" with automatic promotion for the auto-live list.

## 3. Goals, non-goals, anti-goals

**Goals**
- G1. A continuous loop: idea → change in a sandbox → automatic checks → live, with no human step for auto-live changes.
- G2. Agents change website code, agent code and content (§6 auto-live list).
- G3. Every change is visible in AXION as a mission (who, why, diff, test results, live/rolled back) and recorded in git.
- G4. The live site stays up: a new version goes live only after it is running and healthy beside the old one; failure switches back
  automatically.
- G5. Owner requests (chat or mission marked "website improvement") jump the idea queue.

**Non-goals (this design)**
- Browsing the web, acting on external sites, Stage 7 browser automation. The Workshop has no web access.
- Changing anything outside AXION (other apps on this server, subnet-scout, the shared PostgreSQL cluster's other databases).
- Pushing to GitHub automatically (owner click, §6).
- Several changes in parallel. v1 is one change at a time.

**Anti-goals (a failure even if it "works")**
- The site is down because of an agent change, or stays broken longer than the automatic rollback window.
- Agents weaken the checks that judge them (tests, guard, approval rules) without the owner's click.
- Live data is damaged or lost.
- A secret (Claude tokens, DB password, session data) leaves the server or appears in git (the repo is public).
- Churn: many changes, no measurable improvement, or changes that undo each other.
- The evolution loop uses up the model quota so the GM chat stops answering.

## 4. What exists today (facts this design builds on)

- Live: `vite preview` on 0.0.0.0:5190 serves `web/dist` and proxies `/api` to the API on 127.0.0.1:5191
  (`node --env-file=.env --env-file-if-exists=../.env --import tsx src/main.ts`). Not containerised.
- DB: database `axion` on the host's shared PostgreSQL 16 cluster (also holds other apps' DBs: never touch them). Role `axion`, capped at 45
  connections. Migrations `server/migrations/0001…0065`, run **automatically at API start** (`server/src/main.ts:8`).
- Singleton background work inside the API: the chat responder's startup sweep (`app.ts:83`, answers waiting chat messages) and the
  60-second approval-expiry sweep (`app.ts:172`). Two API instances on one DB would both run them.
- Models: root `.env` `CLAUDE_CODE_OAUTH_TOKEN1/2` → "Claude 1"/"Claude 2", run via locked-down `claude -p` (`server/src/cloud/claude-cli.ts`).
  The GM/agent chat uses Claude 2 (`CHAT_MODEL`).
- Existing pieces to reuse: missions + staffing (`server/src/missions`), approvals with exact digests (`server/src/approvals`), run halts
  (`/operations/halts`), trajectory record (`server/src/trajectory`), tamper detector (`server/src/evolution/tamper-detector.ts`),
  execution-profile validator (`server/src/exec-profile`), DB backup + restore check (`server/scripts/db-backup.sh`, `db-restore-check.sh`).
- Checks: server `vitest` (~4822 tests), `tsc` for server and web, `web` build, browser checks (`web/scripts/verify-all.sh`,
  `api-e2e.sh`, `fit-check.mjs`).
- Host: Docker 29 (other apps' containers run here; use a distinct `axion-` name prefix and own network), k3s (subnet-scout's production:
  **do not use it**), nginx on :80 (other apps; not involved), 32 cores, 125 GB RAM.
- Git: integration branch `improve-30h`, `main` pushed to public `github.com/MexcSell/AXION`.

## 5. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | The running site edits its own source, rebuilds, restarts itself in Docker. | Simplest. But a bad build leaves nothing running to fix it; agents can edit their own checks; the site needs the Docker socket (= root on the host); a rebuild can't undo data damage. | Rejected. |
| **B** | **Workshop (sandbox) / Guard (protected) / Live (blue-green).** | More parts. Bad changes are caught or rolled back automatically; checks are out of agents' reach. | **Chosen (E1).** |
| C | B without Docker, everything native. | Less work, but agent-written code runs with access to the whole server. | Rejected. |

## 6. What goes live automatically and what waits for the owner (E3)

| Auto-live (after all checks pass) | Waits for the owner's click in AXION › Approvals |
|---|---|
| Pages, design, text, new features (web) | **Database structure changes** (`server/migrations/**`) |
| Server code outside the protected core | **Login, user roles, approval rules** (`server/src/auth/**`, `server/src/approvals/**`, policy/grant/role code) |
| Agent prompts, skills, settings | **The guard, the tests, deploy and Docker files** (`evolve/**`, Dockerfiles, compose files, test-runner config; existing test files: modify/delete) |
| Content (help, news, docs) | **Secrets and tokens** (`.env*`, `server/src/cloud/claude-cli.ts`, keys) |
| | **Pushing to GitHub** |

Builder's calls to confirm with the owner when the exact path list is written (see §12): new test files that only *add* tests are
auto-live; new or upgraded npm packages (`package.json`, lockfiles) are on the click list (supply-chain risk).

The exact list is a file owned by the Guard (`evolve/protected.txt`), itself protected. The approval is **bound to the commit**: approving
change X approves exactly that commit on that base; if either moves, the approval is void (subnet-scout `self_edit.py` pattern + AXION
digest approvals).

## 7. Design

```
 IDEAS ──► WORKSHOP (container, per change) ──► GUARD (host service, protected) ──► LIVE (blue | green containers)
 agents + owner     agent edits a clone,          classify diff → (click?) →            front proxy :5190 → active slot
 requests           runs checks in a no-network    build → test → boot → backup →        old slot + image kept
                    test container                 start beside live → switch → watch    host PostgreSQL `axion`
                                                   → auto switch back on failure
```

### 7.1 Live site (blue/green)
- Two slots, `axion-blue` and `axion-green`, each one container from an image tagged `<sha>-<utc>` holding the built web + API.
  A small front proxy (protected, Guard-owned) listens on :5190 and routes to the active slot. Users keep the same address.
- The DB stays the host's `axion` database (not moved into Docker). **No change to the shared PostgreSQL cluster's config and no
  restart** (`listen_addresses` is localhost-only; changing it restarts every app's database). Instead: a host OS user `axion` is created,
  the Live containers run as its uid and connect through the mounted Unix socket `/var/run/postgresql`, which the existing
  `local all all peer` rule already accepts for role `axion`. (See §13 B4.)
- **Leader lock:** the singleton background work (responder sweep, approval-expiry sweep, any future timer) runs only in the instance
  holding a PostgreSQL advisory lock. A starting candidate does not hold it; the switch hands it over. This removes double answers.
- **Migrations no longer run at API start in container mode.** The Guard runs them as an explicit step, and only for an owner-approved
  change. (Native dev mode keeps today's behaviour.)
- The last good image and the previous slot are always kept; rollback = switch the proxy back.

### 7.2 Workshop (where agents change code)
- One container per change, from a Workshop image (Node, git, Claude CLI). Never the Docker socket, never a host mount except its own
  clone directory, never the live DB.
- Its code is a fresh clone of the Guard's repository at the live commit (not `/home/luca/AXION`).
- Its DB is a throwaway PostgreSQL container restored from the latest live backup, **scrubbed**: sessions, device tokens, password
  hashes, upload contents and secret references replaced. Needed so agents can see realistic data shapes.
- Model: **Claude 1** (`CLAUDE_CODE_OAUTH_TOKEN1`) only; Claude 2 stays for the chat (anti-goal: the loop must not starve the chat).
- Network: egress allowlist only (Anthropic API; npm registry read, used only if a dependency change was approved). Everything else denied.
- Agent-written code is executed (tests, build, app boot) in a **second container with `--network none` and no token**
  (subnet-scout `tests/run-unit.sh` pattern), so code the agent wrote never sees the token.
- Claude CLI runs with settings sources off and no hooks (subnet-scout lesson: a planted `.claude/settings.json` hook runs next time).
  Protected paths are denied at the tool level **and** re-checked on the diff afterwards (two layers).
- Output: one commit on a branch `evolve/<change-id>` handed to the Guard, plus the agent's report (goal, what changed, how it was
  checked, expected effect).

### 7.3 Guard (the part agents can never change)
A host service (systemd), its code under `evolve/` in the repo and on the protected list; it runs from an owner-approved copy, not from
the branch it is judging. Per change:
1. **Classify** the diff against `evolve/protected.txt`. Protected hit → create an approval (bound to commit + base) and wait.
2. **Base check:** the candidate contains the live commit (subnet-scout PX-B17).
3. **Build** the image; `tsc` server + web, web build.
4. **Test** in no-network containers with a throwaway DB: full server suite, web checks, browser checks. **Test-count floor:** the
   number of tests may not drop; existing test files unchanged unless approved; tamper detector run over the Workshop's recorded steps.
5. **Offline boot:** the image starts with no network and empty data and answers `/api/v1/health`.
6. **Backup** the live DB (`db-backup.sh`) before every switch; keep the restore check.
7. **Migrations** (approved changes only).
8. **Start the candidate** in the idle slot on the live DB without the leader lock; smoke checks (health, sign-in, key read routes,
   page loads).
9. **Drain:** wait for in-flight chat answers and requests (bounded wait).
10. **Switch** the proxy; candidate takes the leader lock; old slot kept stopped-but-present.
11. **Watch** for a set window (health, 5xx rate, error log count). Failure → switch back automatically, mark the change rolled back,
    revert it on `evolve/main`.
12. **Record**: commit on `evolve/main`, `evolve/history.jsonl`, and the change's mission in AXION updated (diff, checks, result).

### 7.4 Ideas and the loop
- Every change is an AXION **mission** (kind "website improvement"), so the existing Missions UI shows staffing, conversation, report and
  result. Owner requests from the chat or a manual mission go first.
- Agents also propose changes themselves from AXION's own signals: failed checks, error logs, rolled-back changes, `BACKLOG.md`, the GM
  chat's requests, run halts, page fit/perf checks. Each idea states a goal and how success will be checked.
- One change at a time. Caps (Guard-enforced, owner-adjustable in Settings): changes per day, model time per change, wall time per
  change, consecutive rollbacks before the loop pauses itself.
- **Kill switch:** Settings › Evolution "Pause" plus the existing run halt; the Guard checks it before every step.
- Anti-churn: a change that is rolled back cannot be retried unchanged; the same file area changed and reverted twice pauses that idea.

### 7.5 Git and the owner's own development
- From go-live, `evolve/main` (in the Guard's repo) is what runs live. Claude Code's own work (owner-requested) is fed through the same
  Guard as an owner-authored change, so there is one history and one path to live.
- GitHub pushes stay an owner click (the repo is public). Before any push, a secret scan on the commits.

## 8. Rollout (each step ends with a demo to the owner)
1. **Containerise live** (blue/green, front proxy, leader lock, migrations-as-a-step, Guard with build/test/switch/rollback). Changes
   still come only from Claude Code. Exit: a deliberately broken change is rolled back automatically.
2. **Workshop**: an owner request becomes a mission, an agent makes the change in the Workshop, the Guard takes it live. Exit: three
   real owner-requested changes live, one forced failure rolled back.
3. **Autonomous loop**: agents generate ideas, caps and kill switch on. Exit: 24 h unattended run with the report.

## 9. Measuring "better"
Per change: its stated check passes, and the existing checks still pass. Over time (Evolution page / scorecard): changes live vs rolled
back, time to roll back, test count, page load time, error rate, chat answer success, owner thumbs up/down per change.

## 10. From subnet-scout: taken and not taken
Taken: two-layer protected paths; approval bound to commit + base; base must contain the live commit; offline boot check; drain before
switch; post-deploy checks with automatic undo; image tags `<sha>-<ts>` + history file; settings sources off for the CLI; agent code
run in a no-network container; daily backup with restore check.
Not taken: its Workbench runs as root on the host with no OS sandbox (ours is a container); its tests are editable by agents (ours are
protected); its in-place web replacement with downtime (ours is blue/green); its "merge never deploys" (the owner chose automatic
live for the auto-live list).

## 11. Risks that remain
- A change can pass every test and still be wrong in ways tests don't see (UX regressions). Mitigation: owner thumbs-down → revert;
  fit/perf checks in the suite.
- Data written by a new version during the watch window stays if it rolls back (shapes stay compatible: auto-live changes have no
  migration, approved ones are expand-only, §13 B2).
- Claude 1 quota: when exhausted the loop pauses; the chat is unaffected.

## 13. Builder-check answers (Claude Code's calls, 2026-11-26, for the owner to check)
- **B1 Threat model.** Assume mistakes **and** a misled agent (prompt injection through data it reads: chat messages, mission text,
  content). Added, without changing the §6 split: (a) the Live containers get an egress allowlist too (Anthropic API only; nothing else);
  (b) an **independent review step** in the Guard after the tests: a separate model call (not the one that wrote the change) plus a static
  scan of the diff for new network calls, `process.env`/secret reads, filesystem writes outside the data volume, destructive SQL, and
  test/guard edits. Any flag moves that change to the owner-click list. (c) Residual risk accepted as written: a harmful change that
  passes tests, review and scan can still go live; the watch window, backups and owner thumbs-down are the remaining defence.
- **B2 Migrations and rollback.** Approved migrations must be **expand-only** (add tables/columns/indexes; no drop/rename/type change in the
  same change); the old slot must run on the new schema, so rollback is still a proxy switch. Drops/renames come as a separate later
  approved change once no running version uses the old shape. The existing c80 migration lint gets an `expand-only` rule. Restoring the
  DB from backup is never automatic; it stays an owner decision.
- **B3 Non-DB state.** Uploads, `data/audit-anchors.jsonl` and the CLI home move to one host directory owned by user `axion`, mounted into
  both slots; only the leader-lock holder writes audit anchors, so the chain continues across switches and rollbacks. `db-backup.sh` is
  extended to include that directory. The Workshop's scrubbed copy has no uploads (placeholders only).
- **B4 Host trust.** The Guard needs Docker, which is root-equivalent; it is unavoidable for B and is why agents can never edit it.
  The Guard runs from its own repository and directory (`/srv/axion-evolve`), installed and updated only by an owner command
  (`evolve/install.sh`, run by Claude Code on the owner's word); agents' branches never reach it. Postgres: socket + peer auth (§7.1),
  no cluster config change. Connections: role `axion` stays capped at 45; budget 2 slots × 10 + Guard 3 + test DBs; the Workshop uses
  its own throwaway Postgres container, not the cluster.
- **B5 What the agents are.** v1: per change, the mission is staffed with existing roles (one agent per role, no teams):
  **GM** picks the idea and writes the goal; one **engineer** agent = one Claude CLI session in the Workshop; one **reviewer** agent = the
  independent review call of B1. The mission UI shows them from Guard events. Agent prompts, skills and playbooks live **in the DB**
  (`agent_definitions`, `agent_versions`, playbooks), not in git: those changes use the existing agent-version path (new version →
  checked → promoted; rollback = re-pin the previous version), with the same caps and records. Content that lives in code goes through git.
- **B6 Transition.** `main` = `improve-30h` = `origin/main` = `cd470901` today: that is the baseline. The Guard's repo is seeded from it.
  `/home/luca/AXION` stays Claude Code's working checkout: Claude Code's changes go to the Guard as an incoming branch (one path to
  live), and `evolve/main` is pulled back into the checkout. The first cutover of :5190 to the front proxy causes a few seconds' outage
  at a time the owner is told in advance.
- **B7 Check time.** Target ≤ 20 minutes per change end to end. Browser checks run headless in the test image (Playwright with its own
  Chromium); the full server suite runs once per change. If the first measured run is slower, the cap is raised, not the checks cut.
- **B8 Model accounts (owner, 2026-11-26).** Claude 1 is a **spare account: the loop may use it fully** (no daily token cap of its own).
  On a quota/rate-limit error the loop pauses until the limit resets, then continues. The loop never uses Claude 2 (chat).

## 12. Left to the builder
Proxy technology; image layout (one image vs web + API); exact cap numbers; watch-window length; idea ranking; how the Workshop hands
the commit to the Guard; the exact protected path list (to be shown to the owner once before step 1 goes live).
