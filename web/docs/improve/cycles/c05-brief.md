# Cycle 5 (theme C, agent performance): agent version proposals, with promote and rollback under governance

## Hypothesis
Today an agent's version changes the moment an admin saves new skills, tools or model in Edit (Stage 6, E3). There is
no proposal, no review by a second person, no comparison and no rollback. After this cycle, improving an agent follows
the governed flow the spec asks for: propose a candidate version, have it reviewed by someone other than the author,
promote it, and roll back to the previous stable version.

Running missions stay pinned to their version throughout. "Last good" is always one click away, and every step is
audited. Agents › Development, today a DEMO, shows these proposals in api mode.

Sources:
- Spec: §4.11 (proposal, promotion, history; "restore allowed version"), §10.9 (author ≠ evaluator; immutable previous
  revision; rollback is a new decision), Stage 10 ("candidate cannot self-approve", "independent restore to last-good").
- subnet-scout `evolution.py` 811-860: promotion is bound to `base_sha`, gives 409 if the agent changed since, keeps
  `before_version` and `after_version`, and rollback restores `before_version`.

## Measure and pass threshold (fixed now; never lowered)
1. Server: the tests below pass; the whole suite stays green.
2. A browser check in api mode:
   - admin A proposes a candidate version of an agent (new skills) and sees the before/after diff;
   - admin B promotes it;
   - the agent's active version becomes v(n+1) live in a third browser, while a running mission's instance still shows v(n);
   - admin B rolls back, which creates v(n+2) with v(n)'s configuration, and the agent shows it live.
3. The author can't promote their own proposal (403). A proposal whose base changed gets 409.
4. `verify-all.sh` stays green, and demo mode is unchanged.

## Server
- **Migration 0015** (lane rule: this lane uses 0015; the org-history lane uses 0014; 0001–0013 are frozen).
  - Table `agent_version_proposals`:
    - `id` (128-bit random), `tenant_id`, `agent_id`;
    - `base_version_id` (the agent's active version when proposed), `base_sha` (the sha of that version's config);
    - `candidate jsonb` ({model, skills, tools}), `candidate_sha`;
    - `title`, `hypothesis` (why it should be better);
    - `status` (`pending|promoted|rejected|withdrawn|expired`);
    - `created_by`, `created_at`, `expires_at` (+14 d);
    - `decided_by`, `decided_at`, `note`;
    - `promoted_version_id`.
  - A unique partial index: one pending proposal per (tenant, agent, candidate_sha).
- **Routes** (prefix `/api/v1`):
  - `GET /agents/:id/version-proposals`.
  - `POST /agents/:id/version-proposals {title, hypothesis, candidate, baseVersionId}`: admin, Idempotency-Key.
    - 409 `AGENT_CHANGED` if `baseVersionId` isn't active.
    - 422 if the candidate equals the base.
  - `POST /version-proposals/:pid/decision {decision:'promote'|'reject', sha, note?}`: admin, not the author (403 `SELF_APPROVAL`).
    - Inside one transaction with compare-and-set, check in this order:
      1. the proposal is still pending;
      2. the agent's active version = `base_version_id` (409 `AGENT_CHANGED`);
      3. the sha matches (409 `PROPOSAL_CHANGED`);
      4. it hasn't expired (409).
    - Promote creates a new immutable `agent_versions` row from the candidate through the **existing** Stage 6 version
      path. Reuse it; don't fork it. The new row has `parent_version_id` = base and becomes the agent's active version,
      and `promoted_version_id` is set.
  - `POST /version-proposals/:pid/withdraw`: the author only, while pending.
  - `POST /agents/:id/rollback {toVersionId, why}`: admin, Idempotency-Key.
    - Creates a **new** version whose config equals `toVersionId`, with `parent_version_id` = the current active
      version, and makes it active.
    - It never deletes a version or reuses an old id (append-only).
    - 422 when `toVersionId` is already active or belongs to another agent.
    - Audited with the reason.
- **Lock path.** Cycle 1's lesson: when a feature adds a new writer of existing data, give every writer one safe path.
  Changing an agent's active version now has three writers: `PATCH /agents/:id` (Stage 6), promote and rollback. All
  three must take the same per-agent lock (e.g. `pg_advisory_xact_lock` on the agent id) and then read the active
  version. Add a deterministic race test: a PATCH waiting on the lock while a promote commits must not silently
  overwrite it. It either rebases on the new version or 409s via If-Match.
- **Running missions:** instances keep `agent_version_id`. Test it.
- **Audit and events:** an audit row on every write. Events `agent.versionProposed`, `agent.versionPromoted` and
  `agent.rolledBack`, audience all, `subjectKind: 'agent'`; add them to the `EventType` union. Existing
  `agent.versionCreated` and `agent.updated` events still fire when the active version changes, so the catalog refreshes.

## Web (api mode; demo mode keeps today's DEMO Development tab exactly)
- **Agents › Development (api mode):**
  - a list of version proposals across agents: title, agent, hypothesis, base → candidate diff (skills and tools
    added/removed, model change), status, author, age;
  - admins who aren't the author get Promote and Reject; authors get Withdraw;
  - errors show inline.
- **Agent Profile › Versions** (Stage 6 list), api mode:
  - mark Active and Last good (the version before the active one);
  - admins get "Propose a change", a dialog that edits skills/tools/model from the active version and asks for a
    hypothesis;
  - admins get "Roll back to this version" on any non-active version, with a reason;
  - running instances show their pinned version, as Stage 6 already does.
- **No invented evaluation numbers.** The proposal card says "No evaluation yet. Evaluations run once agents execute"
  where a comparison would go.
- **Live:** refresh on `agent.*` events. Add `?` help for every new control.

## Tests (write first)
- **Proposals:**
  - propose, then a different admin promotes; a new version exists with the candidate config and parent = base, and it
    is active;
  - the author promoting → 403;
  - a member → 403;
  - a stale base (the agent PATCHed after the proposal) → 409;
  - a tampered sha → 409;
  - expired → 409;
  - a duplicate pending → 409;
  - withdraw is for the author only.
- **Rollback:**
  - creates a new version equal to the target, and the old rows are unchanged (append-only trigger);
  - to the active version → 422;
  - another agent's version → 422.
- **Instances and races:**
  - a running instance keeps its version through a promote and a rollback;
  - the race test above.
- **Tenant:** another tenant's proposal → 404.
- **Migration:** 0015 up/down/up on a populated schema.
- **Browser** (extend `web/scripts/api-improve.mjs`, or add `api-c05.mjs`): the flow in "Measure and pass threshold"
  item 2. Use condition waits only.

## Lane setup (you work in a separate git worktree, in parallel with other lanes)
- **Worktree:** `/home/luca/AXION-w3`, branch `c05-version-proposals`. Work, build and commit **only** there. Never touch
  `/home/luca/AXION` or other worktrees.
- **Browser checks:**
  `cd /home/luca/AXION-w3/web && E2E_API_PORT=5392 E2E_WEB_PORT=5393 ./scripts/api-e2e.sh <scripts>`.
  The lane's `server/.env` already points `E2E_DATABASE_URL` at `axion_e2e3`; never use 5192/5193.
- **Demo-mode suite:**
  - start your own dev server: `cd /home/luca/AXION-w3/web && setsid node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5390 --strictPort > /tmp/w3-vite.log 2>&1 &`;
  - run `BASE=http://127.0.0.1:5390 ./scripts/verify-all.sh`;
  - stop the server by port when done.
- **Never:** 5190, 5191, the real `axion` database (the lane's `.env` disables it), `npm run dev`, `migrate`, `demo:*`.
- **Server tests:** `cd /home/luca/AXION-w3/server && npx tsc --noEmit -p . && npx vitest run` (`axion_test`, schema per file, parallel-safe).
- **Commits:** on your branch, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't merge; the
  controller merges after review.
