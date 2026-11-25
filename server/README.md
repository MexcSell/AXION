# AXION server (Stages 5–6)

Fastify + PostgreSQL API for the AXION web app: sign-in with administrator approval of users and devices, missions with
a server-side state machine, approvals, notifications, a durable event log and a live event stream (SSE).
**Missions do not execute**: no browser is started and no mission, task or route calls a model (`mission_runs.execution = 'disabled'`).
The one exception is the **live cloud models** (owner requests 2026-11-24, below): administrators can send them prompts from Models › Providers and Playground.

## Run

```bash
cd server && npm install
npm start              # API on 127.0.0.1:5191 (migrates on start)
# In another terminal, from the repository root
cd web && npm ci && npm run build && npm start
```

From your computer: `ssh -L 5190:127.0.0.1:5190 <vps>`, then open http://127.0.0.1:5190.
The first name that connects becomes the administrator. New installations start with an empty mission list.

## Configuration (`server/.env`, mode 600, never committed)

| Key | Meaning |
|---|---|
| `DATABASE_URL` | the `axion` database (role `axion`) |
| `TEST_DATABASE_URL` | `axion_test`: each test file gets its own schema |
| `E2E_DATABASE_URL` | `axion_e2e`: browser checks (`web/scripts/api-e2e.sh`), emptied on every start |
| `RESTORE_DATABASE_URL` | `axion_restore_check`: target of the restore test |
| `COOKIE_SECURE` | `1` once the app is served over HTTPS |
| `HOST`/`PORT` | always 127.0.0.1; 5191 |
| `CLAUDE_CODE_OAUTH_TOKEN1`, `…TOKEN2`, … | one live cloud model per token ("Claude 1", "Claude 2", ids `claude-1`, `claude-2`; an unnumbered `CLAUDE_CODE_OAUTH_TOKEN` is "Claude"). They live in the **repository root** `.env` (mode 600, never committed); `npm run dev`/`start` load it with `--env-file-if-exists=../.env`. None set = no cloud model |
| `CLOUD_MODEL1`, `CLOUD_MODEL2`, … (`CLOUD_MODEL` for all) | model id per token, default `claude-opus-5-5` (must look like `claude-<name>`) |
| `CHAT_MODEL` | the first chat model of the default order (default `claude-2`); administrators override the order in Settings › AI Chat. No chat model usable = the chats get the honest "can't answer yet" note |
| `CLOUD_MODEL_TIMEOUT_MS` | per-prompt limit, default 120000 (5000..600000) |
| `CLAUDE_BIN` / `CLOUD_MODEL_HOME` | path of the `claude` CLI (default: first on PATH, else `~/.local/bin/claude`) and the root of the private HOMEs, one per model (default `server/data/cloud-home/<id>`) |

Only `axion`, `axion_test`, `axion_e2e` and `axion_restore_check` belong to AXION. The other databases on this PostgreSQL
server (`myapp`, `agentapp`, `ajp`, `ajp_test`, `postgres`) are never read or changed.

## Live cloud models (owner requests 2026-11-24)

- `GET /cloud-models` (everyone signed in): `{models: [{id, label, provider, transport, tokenVar, model, enabled, inFlight, lastCall, check}], maxInFlight, canPrompt}`.
  `tokenVar` is the variable's NAME; no token ever leaves the server.
- Administrators use `POST /cloud-models/:id/manage` with an `action` of `refresh`, `enable`, `disable` or `remove`. Refresh sends a short connection test and reads the CLI's account and quota windows. The server keeps the most recent check in the model’s private CLI directory across restarts and shows the account email only to administrators. Disable and Remove persist per tenant. Remove retires that environment slot in AXION.
- `POST /cloud-models/:id/complete {prompt (1..8000 chars), format?: 'text'|'json'}` (administrators only, X-CSRF): the real answer
  `{id, model, text, truncated, format, validJson, durationMs, usage}`. Errors: 400 `VALIDATION`, 404 (no such id), 503 `MODEL_NOT_CONFIGURED`
  (no model at all), 429 `MODEL_BUSY` (2 at once per model) or `RATE_LIMITED` (bucket `cloud`, 10 a minute per session across all models),
  504 `MODEL_TIMEOUT`, 502 `MODEL_FAILED` (the reason goes to the server log only, token scrubbed). Each call writes one audit row
  `model.cloud.complete` (subject `<id>:<model>`) with sizes, token counts and timing, never the prompt or the answer.
- How it runs: each token is a Claude Code credential; a direct Messages API probe on 2026-11-24 was refused (one 429), so `src/cloud/claude-cli.ts` runs
  `claude -p` locked down: no tools, no setting sources, MCP servers, slash commands or saved sessions, a HOME of its own per model, a child
  environment with only PATH, HOME and that model's token (no `DATABASE_URL`), the prompt on stdin, and a hard timeout. That file is the only server file allowed to
  start a process (`test/approvals.test.ts`), and only `cloud/routes.ts`, `config.ts` and `conversations/responder.ts` may import it.
- Each token is one of the owner's own subscriptions: that is why only administrators may prompt here. Tests never use it (fake adapter, fake CLI).

## Live chat answers (owner 2026-11-25)

- Every message to the General Manager or an agent in the Chat dock (`POST /channels/gm|agent:<id>/messages`, the sender's own channel) is answered by the
  tenant's chat model route, for every approved user, with no rate bucket and no in-flight cap (owner: no restrictions). Mission threads never call a model.
- The route (Settings › AI Chat, migration 0062 `chat_model_routes`): administrators order the cloud models; no row = the default order (`CHAT_MODEL`,
  default claude-2, then every other configured model). `GET /chat-model` (everyone), `PUT /chat-model {models: [ids] | null}` (administrators, audited
  `model.chat.route`), `GET /chat-model/usage?days=1..90` (administrators).
- `src/cloud/router.ts`, the model router: a model Disabled or Removed on Models is never tried; a provider limit keeps a model out until its reported reset
  (else 15 min); a timeout or failure keeps it out 1, 2, 4 … min (at most 30); a success or an "available" check clears it. One answer tries the usable models
  in order, then the cooling ones (soonest back first); a system note appears only when every model failed. The router learns from the chats, the
  Playground calls and the provider checks; its health is in memory.
- The agent answers as itself: its definition, active version (model, skills, tools) and current playbook go into the prompt (`<about_you>`).
- GM mission drafts: when asked for work, the GM may end its reply with a `<mission_draft>{title, text, criteria}</mission_draft>` block. The server
  validates it, removes it from the text and stores it in `messages.draft`; the web shows a "Create mission" card that creates a private mission with
  that title and criteria. Nothing executes.
- `src/conversations/responder.ts`: after the post commits, one worker per thread marks the waiting messages `delivered`, sends the company data and the
  conversation on stdin, and posts the reply as the agent (`author_kind` agent, `author_id` gm or the agent id, kind `reply`) with the answered messages
  `acknowledged`. Receipts reach the owner live (`conversation.receipt` with `payload.channel`). A failure posts a system note; the waiting messages are
  answered with the next message, or by the sweep at the next server start. Audit `model.cloud.chat`: sizes, tokens and timing only.
- `src/conversations/company-context.ts`: the data the model sees, read-only and tenant-scoped: the app's pages, agents and reporting lines, the missions
  (with tasks and pending approvals) the asker may see, their visible notifications, the people list for administrators only, and the cloud model names.
  Never other people's chats, passwords, sessions, audit rows, uploads, tokens or the environment.

## Commands

| Command | What it does |
|---|---|
| `npm test` | 4,601 Vitest tests (203 files) against `axion_test` |
| `npm run typecheck` | TypeScript |
| `npm run migrate [-- down <n>]` | migrations up (default) or down to version n (`down 0` empties the schema) |
| `npm run admin:approve-device -- <name>` | recovery: approves that user's newest waiting device (e.g. the only admin lost their cookies) |
| `npm run demo:clear` | clean up legacy sample missions |
| `npm run db:backup` | `pg_dump -Fc axion` on one snapshot → `../backups/axion-<UTC>.dump` + `.json` manifest of row counts (+ uploads archive), keeps 14 |
| `npm run db:restore-check` | restores the newest dump into `axion_restore_check` and compares row counts with its manifest |
| `npm run e2e:serve` | API on 5192 with `axion_e2e` (used by the browser checks) |

## API (prefix `/api/v1`)

- Errors: `{code, message, correlationId, retryable, fieldErrors?}`; no stack traces, paths or SQL.
- Sessions: HTTP-only `SameSite=Strict` cookie `axion_sid` (only its sha256 is stored), 30-day absolute and 24-hour idle limit.
  Every write needs `X-CSRF` (from `me.csrf`); a cross-site `Origin` is refused.
- Auth: `POST /auth/connect`, `GET /auth/wait`, `POST /auth/cancel`, `GET /auth/hello`, `GET /me`, `PATCH /me`,
  `POST /me/password`, `DELETE /me/devices/:did` (one of your other devices), `POST /auth/logout`, `GET /people`.
- Sign-in limit: 10 wrong passwords per name per minute (per name, not per address: behind the local proxy every client
  is 127.0.0.1, and `X-Forwarded-For` is not trusted).
- Admin: `GET /users`, `POST /users/:id/approve|reject`, `PATCH /users/:id`, `POST /users/:id/devices/:did/approve|block`,
  `DELETE /users/:id/devices/:did`, `GET /operations/health`.
- Missions: `GET /missions`, `GET /missions/:id`, `POST /missions` (Idempotency-Key), `PATCH /missions/:id` (If-Match),
  `POST /missions/:id/share`, `POST /missions/:id/actions/{start|pause|resume|cancel|retry|archive|restore}` (Idempotency-Key),
  `DELETE /missions/:id`, `POST /uploads` (≤ 25 MB, type checked from the bytes), `GET /uploads/:id`.
- Approvals: `GET /approvals`, `POST /approvals/:id/decision {decision, digest, reason?}`.
- Notifications: `GET /notifications`, `POST /notifications/:id/ack`, `POST /notifications/ack-all {ids}`.
- Agents (Stage 6): `GET /agents`, `GET /agents/:id` (with versions), `POST /agents` (admin, Idempotency-Key; 409
  `ROLE_TAKEN`/`DUTY_TAKEN`), `PATCH /agents/:id` (admin, If-Match; a model/skills/tools change adds an immutable version),
  `GET /organization/graph`, `GET /organization/revisions`. The server ensures that the initial 24 role definitions and first organization revision exist at startup.
- Organisation proposals (improvement cycle 1): `GET /organization/proposals` (everyone; `{proposals, activeRevision}`),
  `POST /organization/proposals {title, why, baseRevision, edges}` (admin, Idempotency-Key; `?dryRun=1` returns the dry run and
  stores nothing; 409 `ORG_CHANGED`/`DUPLICATE_PROPOSAL`), `POST /organization/proposals/:id/decision {decision, note?, sha}` (admin,
  not the author: 403 `SELF_APPROVAL`; 409 `PROPOSAL_CHANGED`/`ORG_CHANGED`/`PROPOSAL_EXPIRED`/`PROPOSAL_NOT_PENDING`, 422
  `ORG_INVALID`; approve appends one org revision), `POST /organization/proposals/:id/withdraw` (author). Pending proposals expire
  after 7 days, on read or decision. Events `org.proposalCreated|proposalDecided|revisionApplied` (audience all).
- Organisation history (improvement cycle 4): `GET /organization/revisions` (everyone; oldest first, each with `createdByName`,
  `source` = proposal | agent | seed | other, `appliedFromProposal`, `changed` = lines changed against the revision before),
  `GET /organization/revisions/:seq` (+ `edges`), `GET /organization/revisions/:seq/diff?against=` (default the revision before;
  0 = before any revision) → `{seq, against, added, removed, moved[{subordinate, from, to}], impact}`, where `impact` lists the
  caller's visible, non-final, non-archived missions with an instance of an agent whose manager changed (read only: instances
  are never changed). `POST /organization/revisions/:seq/rollback-proposal {why?}` (admin, Idempotency-Key) stores an ordinary
  proposal "Roll back to revision N" with revision N's lines on the latest base, through the same path as
  `POST /organization/proposals`; 422 `NOTHING_TO_ROLL_BACK` (the latest revision, or the same lines), 409 `DUPLICATE_PROPOSAL`
  (a pending proposal with those lines), 404 for another tenant's revision. Another administrator decides it as usual.
- Company scorecard (improvement cycle 2): `GET /company/scorecard?window=7d|30d|90d&includeDemo=0|1` (default `30d`, DEMO excluded;
  every signed-in user) → `{window, from, to, includeDemo, rows}`; each row `{key, label, value|null, unit, n, evidence, state: ok|none}`.
  Computed by a pure function (`src/company/scorecard.ts`) only from the caller's visible missions (tenant, not deleted,
  `VISIBLE_SQL`) and their runs, `mission.stateChanged` events, tasks, task attempts, approval decisions and `verifies`
  delegations. Rates and medians need n ≥ 3, otherwise `value: null, state: 'none'`. No new table, no new event.
- Agent reliability (improvement cycle 3): `GET /agents` and `GET /agents/:id` carry `reliability {value|null, n, window: '90d',
  evidence, includesSimulated}` (`?includeSimulated=1` adds simulated DEMO tasks). Pure function `src/agents/reliability.ts`, one
  query for all agents over the caller's visible missions (tenant, not deleted, `VISIBLE_SQL`). Evidence = tasks now `passed`/`failed`
  whose finish (the latest of the last `task.stateChanged` into that state, the last attempt and the creation time) is in the last
  90 days. Every outcome counts against the agent that owned the task when it happened: each agent a task was reassigned away from
  gets one unreliable (read from the `task.reassign` audit rows: the `delegated` row names the mission lead, not the previous
  owner); the final owner is judged only on its own attempts after the last handover (reliable = passed with exactly one own
  attempt; retried = more; failed = failed under it; a pass with no own attempt, or a failed task taken over without an own
  attempt, is not counted). Canceled and open tasks don't count. `value` is a whole percentage, null while n < 5. No migration.
- Agent version proposals (improvement cycle 5): `GET /version-proposals` (all agents) and `GET /agents/:id/version-proposals`
  (everyone; `{proposals}`, each with base and candidate `{model, skills, tools}`, the diff, `sha`, `stale`, `evaluation: null`),
  `POST /agents/:id/version-proposals {title, hypothesis, candidate, baseVersionId}` (admin, Idempotency-Key; 409 `AGENT_CHANGED` when
  the base is not the active version, 409 `DUPLICATE_PROPOSAL`, 422 `CANDIDATE_UNCHANGED`), `POST /version-proposals/:pid/decision
  {decision: promote|reject, sha, note?}` (admin, not the author: 403 `SELF_APPROVAL`; checks in this order: pending (409
  `PROPOSAL_NOT_PENDING`), base still active (promote only, 409 `AGENT_CHANGED`), sha (409 `PROPOSAL_CHANGED`), expiry (409
  `PROPOSAL_EXPIRED`); promote = a new immutable version through `addVersion`, parent = the base, made active),
  `POST /version-proposals/:pid/withdraw` (author), `POST /agents/:id/rollback {toVersionId, why}` (admin, Idempotency-Key; a NEW
  version with the target's configuration, parent = the active one; 422 `ALREADY_ACTIVE`/`SAME_CONFIG`/`VERSION_NOT_OF_AGENT`).
  Pending proposals expire after 14 days, on read or decision. PATCH, promote and rollback take the same per-agent lock
  (`lockAgent`, before reading the agent); promote and rollback move `row_version` on, so an edit opened before answers 409.
  Events `agent.versionProposed|versionPromoted|rolledBack|versionProposalDecided` (audience all, subject kind `agent`), plus
  `agent.versionCreated` and `agent.updated` on every new active version. Running instances keep their pinned version.
- Mission instances: `GET /missions/:id/hierarchy`, `GET /missions/:id/tasks`, `GET /agent-instances[?agentId=]`,
  `GET /agent-instances/:id`. Each instance is pinned to the agent version active when it joined. A startup backfill gives
  existing missions their instances, delegations, tasks and (demo) threads; it is idempotent and skips a broken mission.
- Tasks: `POST /tasks/:id/{retry|reassign|cancel}` (Idempotency-Key). Every other task state change is system-only.
- Conversations: `GET /missions/:id/threads`, `POST /missions/:id/threads {instanceId}`,
  `GET /threads/:id/messages?before=&limit=&mark=0` → `{messages, hasMore, nextBefore}`, `POST /threads/:id/messages`
  (Idempotency-Key; the author is always the signed-in user; only `command`/`reply`; 422 `THREAD_NOT_HUMAN` in agent↔agent
  threads). Real missions get one honest note instead of invented replies; DEMO missions get a labelled simulation.
- Direct channels: `GET /channels`, `GET|POST /channels/{gm|admin|agent:<id>}/messages`, admins:
  `/channels/admin/:userId/messages`. GM and agent channels are private to their owner (event + notification audience
  `owner`, never admins).
- Live: `GET /events/stream` (SSE; `Last-Event-ID` replay; `ping` every 15 s; per-user filtering).

## Policy service (c30)
`src/policy/` is a pure, deterministic `evaluate(action, grants, tenantPolicy, now)`: allow / needs_approval / deny, with a risk tier
R0-R4 from the frozen `BASELINE_POLICY_V1` (spec 13.2). Deny overrides; a tenant policy can only tighten; an unknown kind or effect
is reported, never trusted. `requestApproval` derives the tier from it; no caller supplies one. The decision route enforces the
approver: R2 any signed-in human, R3 and R4 an administrator (`403 POLICY_DENIED` otherwise). There is no owner role yet, so for R4
the baseline says `approver: 'owner'` with `heldBy: 'admin'` and a note. `GET /policy/baseline` (admin, read-only) lists the kinds;
there is no write route.

## Site grants (c36)
`src/grants/`: `normaliseOrigin` is the exact-origin normaliser (https only, no path, userinfo, wildcard, IP literal, local or internal name,
public suffix, or internationalised name: IDNs fail closed with `idn_not_supported`; allowlisting them is backlog P4a). Table
`site_grants` (migration 0030) is append-only except one revoke and the `clearDemo` cascade. Routes (admin only): `GET /site-grants`,
`GET /site-grants/validate`, `POST /site-grants`, `POST /site-grants/:id/revoke`. Issuing is an R3 `origin-grant` through `evaluate()`.
**Approval is single-admin: the issuing administrator is the approver** (recorded in the audit detail as `approverId` and
`approval: 'issuer is approver (single-admin approval)'`); a two-person rule is backlog P3b. `loadGrants` returns grants only for an
agent with a live instance on the mission. The public-suffix list is a partial embedded list, not the full Public Suffix List.

## HTTP hardening (cycle 14)

Today the API and the web app are reachable only on 127.0.0.1 through an SSH tunnel. These rules hold anyway, and they are
the checklist before any wider exposure (spec §13.1). Tests: `test/security.test.ts`; browser check under the CSP:
`web/scripts/api-e2e-preview.sh` (`api-c14.mjs`).

- **Headers on every API response** (`src/http-headers.ts`, also on the hijacked SSE stream): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
  `Cross-Origin-Opener-Policy: same-origin`, `Cache-Control: no-store` (the stream: `no-cache, no-transform`). No CORS headers
  are ever sent. A downloaded upload keeps its own `Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors 'none'`.
- **Body limits:** 1 MB for every JSON body (no route raises it; a bigger body gets `413` with the error envelope); uploads
  25 MB, one file, multipart only.
- **Per-session write rate limits** (`src/ratelimit.ts`, sliding 60-second window, counted per signed-in session, refused
  attempts count too): messages 60/min (thread and direct-channel posts share it), organisation proposals 30/min
  (create, decide, withdraw), uploads 30/min (checked before the file is read). Over the limit: `429` with
  `{code: 'RATE_LIMITED', retryable: true}` and `Retry-After`. Sign-in has its own limit (10 wrong passwords per name per minute).
- **CSRF:** every write needs `X-CSRF` = the session's token, sign-out included. The exceptions are sign-in
  (`/auth/connect`) and leaving the waiting room (`/auth/cancel`), which have no session yet. Every write that has an
  `Origin` must be same-origin (or listed in `ALLOWED_ORIGINS`), sign-in included.
- **Cookies:** `axion_sid`, `axion_dev`, `axion_wait` are `HttpOnly`, `SameSite=Strict`, `Path=/`; `Secure` once
  `COOKIE_SECURE=1` (it must stay off on plain http, or the browser drops the cookies and nobody can sign in).
- **`npm audit --omit=dev`** (2026-11-21): server 0 vulnerabilities, web 0 vulnerabilities (with dev dependencies: 0 and 0).

### Serving the built web app behind a reverse proxy

`npm run build` in `web/` writes `web/dist`. `vite preview` already sends the web app's headers (from
`web/security-headers.ts`). A reverse proxy in front must send the same headers on the app's pages and proxy `/api` unchanged
(the API sets its own headers). Example for nginx, with TLS and `COOKIE_SECURE=1`:

```nginx
server {
  listen 443 ssl;
  server_name axion.example.internal;
  root /srv/axion/web/dist;
  client_max_body_size 26m;            # uploads are at most 25 MB; JSON at most 1 MB (the API enforces both)
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header X-Frame-Options "DENY" always;
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Strict-Transport-Security "max-age=31536000" always;
  location /api/ {
    proxy_pass http://127.0.0.1:5191;  # keep Host: the API compares Origin with it
    proxy_set_header Host $host;
    proxy_buffering off;               # the live event stream
    proxy_read_timeout 1h;
  }
  location / { try_files $uri /index.html; }
}
```

The policy (keep it equal to `web/security-headers.ts`): scripts only from this origin (no inline script, no eval), stylesheets
from this origin and no `style=""` attributes in markup, images and media also from `data:`/`blob:`, fetch and the event
stream only to this origin, no plugins, no `<base>`, no frames, no framing. One exception, measured: `style-src-elem` allows
inline `<style>` elements, because the dropdown menu's scroll lock (react-remove-scroll) adds one with the scrollbar width
in it (its content varies, so a hash can't match, and a static server has no nonce). The dev server (`npm run dev`) cannot run under it: Vite's hot reload injects inline scripts.
In nginx an `add_header` inside a `location` block replaces the server-level ones, so add no headers inside `location /api/`.

## Patterns taken from the axor backend (`/home/luca/axor/backend`, read only)

argon2id hashing; storing only a hash of the session token; SameSite=Strict cookies; a new token at every sign-in step;
idle + absolute session limits; Origin check next to the CSRF header; the last-administrator guard; revoking every session on
disable/reject/password change; compare-and-set `UPDATE … WHERE status = … RETURNING` for every state change and approval
decision; approvals bound to a hash with expiry; secrets never written to the audit log; SSE that re-checks the session on
every wake-up and sends `X-Accel-Buffering: no`.
Not taken: axor's single-connection SQLite→Postgres shim, ad hoc migrations and its 12-character password rule
(owner update u1 keeps ≥ 4 characters at sign-up and ≥ 8 for a change).

## Stopping a running API

`npm run dev` fails with EADDRINUSE while another API holds 5191:
`kill $(ss -ltnpH "sport = :5191" | grep -o 'pid=[0-9]*' | cut -d= -f2)`.

## Rollback

1. Web: rebuild and serve the previously deployed frontend and matching API revision.
2. Data: `npm run migrate -- down 14` removes the agent version proposals (0015; versions they promoted stay, as ordinary versions); `npm run migrate -- down 12` removes the org proposals (0013); `down 5` removes Stage 6 (migrations 0006–0013) and keeps Stage 5 data; `down 0` empties the
   schema; or restore a dump (`backups/axion-20261121T110311Z.dump` was taken right before the Stage 6 migration).
3. Remove everything: `dropdb` `axion`, `axion_test`, `axion_e2e`, `axion_restore_check`; `drop role axion`.
