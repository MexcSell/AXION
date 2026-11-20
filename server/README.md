# AXION server (Stage 5)

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
| `npm test` | 107 Vitest tests against `axion_test` |
| `npm run typecheck` | TypeScript |
| `npm run migrate [-- down <n>]` | migrations up (default) or down to version n (`down 0` empties the schema) |
| `npm run admin:approve-device -- <name>` | recovery: approves that user's newest waiting device (e.g. the only admin lost their cookies) |
| `npm run demo:seed` / `npm run demo:clear` | add / remove the DEMO missions (`demo=true` rows only) |
| `npm run db:backup` | `pg_dump -Fc axion` → `../backups/axion-<UTC>.dump`, keeps 14 |
| `npm run db:restore-check` | restores the newest dump into `axion_restore_check` and compares row counts |
| `npm run e2e:serve` | API on 5192 with `axion_e2e` (used by the browser checks) |

## API (prefix `/api/v1`)

- Errors: `{code, message, correlationId, retryable, fieldErrors?}`; no stack traces, paths or SQL.
- Sessions: HTTP-only `SameSite=Strict` cookie `axion_sid` (only its sha256 is stored), 30-day absolute and 24-hour idle limit.
  Every write needs `X-CSRF` (from `me.csrf`); a cross-site `Origin` is refused.
- Auth: `POST /auth/connect`, `GET /auth/wait`, `POST /auth/cancel`, `GET /auth/hello`, `GET /me`, `PATCH /me`,
  `POST /me/password`, `POST /auth/logout`, `GET /people`.
- Admin: `GET /users`, `POST /users/:id/approve|reject`, `PATCH /users/:id`, `POST /users/:id/devices/:did/approve|block`,
  `DELETE /users/:id/devices/:did`, `GET /operations/health`.
- Missions: `GET /missions`, `GET /missions/:id`, `POST /missions` (Idempotency-Key), `PATCH /missions/:id` (If-Match),
  `POST /missions/:id/share`, `POST /missions/:id/actions/{start|pause|resume|cancel|retry|archive|restore}` (Idempotency-Key),
  `DELETE /missions/:id`, `POST /uploads` (≤ 25 MB, type checked from the bytes), `GET /uploads/:id`.
- Approvals: `GET /approvals`, `POST /approvals/:id/decision {decision, digest, reason?}`.
- Notifications: `GET /notifications`, `POST /notifications/:id/ack`, `POST /notifications/ack-all {ids}`.
- Live: `GET /events/stream` (SSE; `Last-Event-ID` replay; `ping` every 15 s; per-user filtering).

## Patterns taken from the axor backend (`/home/luca/axor/backend`, read only)

argon2id hashing; storing only a hash of the session token; SameSite=Strict cookies; a new token at every sign-in step;
idle + absolute session limits; Origin check next to the CSRF header; the last-administrator guard; revoking every session on
disable/reject/password change; compare-and-set `UPDATE … WHERE status = … RETURNING` for every state change and approval
decision; approvals bound to a hash with expiry; secrets never written to the audit log; SSE that re-checks the session on
every wake-up and sends `X-Accel-Buffering: no`.
Not taken: axor's single-connection SQLite→Postgres shim, ad hoc migrations and its 12-character password rule
(owner update u1 keeps ≥ 4 characters at sign-up and ≥ 8 for a change).

## Rollback

1. Web: `?data=demo` (or `VITE_DATA_MODE=demo`) brings back the browser-only prototype.
2. Data: `npm run migrate -- down 0`, or restore a dump.
3. Remove everything: `dropdb` `axion`, `axion_test`, `axion_e2e`, `axion_restore_check`; `drop role axion`.
