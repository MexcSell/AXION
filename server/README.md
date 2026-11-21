# AXION server (Stages 5–6)

Fastify + PostgreSQL API for the AXION web app: sign-in with administrator approval of users and devices, missions with
a server-side state machine, approvals, notifications, a durable event log and a live event stream (SSE).
**Nothing executes**: no model, browser or process is started (`mission_runs.execution = 'disabled'`).

## Run

```bash
cd server && npm install
npm run dev            # API on 127.0.0.1:5191 (migrates on start)
cd ../web && npm run dev   # web on 127.0.0.1:5190, proxies /api to 5191
```

From your computer: `ssh -L 5190:127.0.0.1:5190 <vps>`, then open http://127.0.0.1:5190.
The first name that connects becomes the administrator. With `DEMO_SEED=1` (in `.env`) the prototype's sample missions are
loaded at that moment, owned by the administrator and marked DEMO.

## Configuration (`server/.env`, mode 600, never committed)

| Key | Meaning |
|---|---|
| `DATABASE_URL` | the `axion` database (role `axion`) |
| `TEST_DATABASE_URL` | `axion_test`: each test file gets its own schema |
| `E2E_DATABASE_URL` | `axion_e2e`: browser checks (`web/scripts/api-e2e.sh`), emptied on every start |
| `RESTORE_DATABASE_URL` | `axion_restore_check`: target of the restore test |
| `DEMO_SEED` | `1` = load the DEMO missions when the first administrator registers |
| `COOKIE_SECURE` | `1` once the app is served over HTTPS |
| `HOST`/`PORT` | always 127.0.0.1; 5191 |

Only `axion`, `axion_test`, `axion_e2e` and `axion_restore_check` belong to AXION. The other databases on this PostgreSQL
server (`myapp`, `agentapp`, `ajp`, `ajp_test`, `postgres`) are never read or changed.

## Commands

| Command | What it does |
|---|---|
| `npm test` | 331 Vitest tests against `axion_test` |
| `npm run typecheck` | TypeScript |
| `npm run migrate [-- down <n>]` | migrations up (default) or down to version n (`down 0` empties the schema) |
| `npm run admin:approve-device -- <name>` | recovery: approves that user's newest waiting device (e.g. the only admin lost their cookies) |
| `npm run demo:seed` / `npm run demo:clear` | add / remove the DEMO missions (`demo=true` rows only) |
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
  `GET /organization/graph`, `GET /organization/revisions`. 24 agents and org revision 1 are seeded on every start (idempotent,
  independent of `DEMO_SEED`; `demo:clear` never removes them).
- Organisation proposals (improvement cycle 1): `GET /organization/proposals` (everyone; `{proposals, activeRevision}`),
  `POST /organization/proposals {title, why, baseRevision, edges}` (admin, Idempotency-Key; `?dryRun=1` returns the dry run and
  stores nothing; 409 `ORG_CHANGED`/`DUPLICATE_PROPOSAL`), `POST /organization/proposals/:id/decision {decision, note?, sha}` (admin,
  not the author: 403 `SELF_APPROVAL`; 409 `PROPOSAL_CHANGED`/`ORG_CHANGED`/`PROPOSAL_EXPIRED`/`PROPOSAL_NOT_PENDING`, 422
  `ORG_INVALID`; approve appends one org revision), `POST /organization/proposals/:id/withdraw` (author). Pending proposals expire
  after 7 days, on read or decision. Events `org.proposalCreated|proposalDecided|revisionApplied` (audience all).
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
- **CSRF:** every write needs `X-CSRF` = the session's token (except sign-in, cancel and sign-out, which have no session yet
  or only end one); every write with an `Origin` must be same-origin (or listed in `ALLOWED_ORIGINS`), sign-in included.
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

1. Web: `?data=demo` (or `VITE_DATA_MODE=demo`) brings back the browser-only prototype.
2. Data: `npm run migrate -- down 12` removes the org proposals (0013); `down 5` removes Stage 6 (migrations 0006–0013) and keeps Stage 5 data; `down 0` empties the
   schema; or restore a dump (`backups/axion-20261121T110311Z.dump` was taken right before the Stage 6 migration).
3. Remove everything: `dropdb` `axion`, `axion_test`, `axion_e2e`, `axion_restore_check`; `drop role axion`.
