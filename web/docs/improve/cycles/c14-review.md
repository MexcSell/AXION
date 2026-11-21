# Cycle 14 review: security S1, HTTP hardening (lane w12)

Independent review of branch `c14-security-hardening` (`/home/luca/AXION-w12`, base `2ed66e9`, head `14e1124`), against
`c14-brief.md`, the PROCESS.md safety rules and the implementer report. Read-only: no tests, servers or database runs; the
evidence is the code, the diff and programmatic route enumeration with `git grep`.

**Spec verdict: PASS.** All five scope items are implemented with tests. One caveat on the thresholds: one verify-all step
is red. That is the demo `flows.mjs` Hierarchy step, and the implementer's A/B shows it red on the base config too. I re-ran
nothing, so every green count in the report is as the implementer reported it.
**Quality verdict: PASS, with one Important item to do at merge** (I1). Nothing is loosened in production, and no dependency
changed.

The only thing I executed: an in-process bare `Fastify()` from the lane's `node_modules` (5.12.8), with no DB and no
listen. It had the same `onSend` pattern, a not-found handler and one `/a/:id` route, called with `inject`. Results:
- `OPTIONS /a/1` → 404 with the `onSend` header;
- `HEAD /a/1` → 200 with the header;
- `GET /a/%E0` → 400 `FST_ERR_BAD_URL` **without** the header, with the path reflected in the body.

## What was checked, with evidence

### (1) Headers on every response type
- `server/src/app.ts:53-57`: a global `onSend` sets `no-store`, `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, COOP
  `same-origin`, and the API CSP `default-src 'none'; frame-ancestors 'none'` (only when the route has not set its own one).
  `onSend` also runs for replies from `setErrorHandler` (401/403/413/415/429/500), from the 404 handler (`app.ts:72`), and so
  for `OPTIONS`. Fastify 5 has no automatic OPTIONS, and there is no CORS plugin, so a preflight gets a 404 with the headers
  and no `Access-Control-*`. This is verified with the bare-Fastify `inject` above: `OPTIONS` → 404 with the `onSend`
  header.
- SSE: the only hijacked response (`grep hijack` finds just `events/stream.ts`). `events/stream.ts:69` now spreads
  `API_SECURITY_HEADERS` and the CSP into `writeHead`. It keeps `cache-control: no-cache, no-transform` and
  `x-accel-buffering: no`, so streaming is not affected. The 401 before the hijack goes through the normal path.
- Uploads: `missions/uploads.ts:124` CSP is `sandbox; default-src 'none'; frame-ancestors 'none'`, and `app.ts:56` does not
  overwrite it. `uploads.ts:125` `private, max-age=3600` is dead code, because `onSend` overwrites it with `no-store`.
  This was already so before the cycle, and it is the stricter value (nit).
- Tests: `security.test.ts` checks 8 response kinds × 7 header assertions, plus the upload CSP and the SSE stream over a real
  socket.
- Gap (m1): responses that Fastify writes raw, without hooks, carry none of these headers. That covers `onBadUrl`
  (`node_modules/fastify/fastify.js:691-701`, a 400 for an undecodable path parameter, with the path reflected in JSON), the
  503 while closing, and `clientError`. The bad-URL case is reproduced: `GET /a/%E0` → 400 with no `onSend` header. They are JSON or empty bodies, so the real risk is low.
  It is still a gap in "every response", and it is closable with the `frameworkErrors` option.

### (2) The web app's CSP
- `web/security-headers.ts:8-24`: `script-src 'self'`, no `'unsafe-eval'` anywhere, `object-src 'none'`, `base-uri 'none'`,
  `frame-ancestors 'none'`, `connect-src 'self'`.
- Applied in `web/vite.config.ts:17` (`preview.headers`). Vite applies them to static files and to the SPA HTML fallback
  (`vite/dist/node/chunks/node.js:35770-35777` and `:18276`). The `/api` proxy middleware is mounted first (`:35767`), so the
  API keeps its own headers there. The dev server is untouched, which is correct: Vite's HMR needs inline scripts.
- The built `web/dist/index.html` has no inline script or style, and `web/src` has no iframe, object or embed, so
  `frame-src`/`object-src 'none'` breaks nothing.
- `scripts/api-e2e-preview.sh:26` refuses to run the checks unless the page actually carries `script-src 'self'`.
  `api-c14.mjs` proves the policy is enforced: an injected inline script and a string timer are blocked and reported, and
  12 pages, a popover, a menu and a dialog show 0 violations.
- **`style-src-elem 'self' 'unsafe-inline'`: accepted.**
  - It is measured and narrow: `style-src-attr` falls back to `style-src 'self'`, and React's style prop is CSSOM.
  - It is documented in three places.
  - Exploiting it needs HTML injection first, and even then it gives CSS only, never script.
  - The real alternatives are a nonce from a templating server with `get-nonce`'s `setNonce`, or Radix `modal={false}` on
    the dropdown. Both are a larger change; queue them as a follow-up rather than block on them.
- README nginx snippet (`server/README.md:131-156`), m2: the `add_header` lines sit at server level and `location /api/` has
  none. So nginx **inherits** them onto every API response, and that response carries two CSPs and duplicate XFO, nosniff
  and COOP headers. This is still safe: two CSPs are enforced as their intersection. But the text says both "proxy `/api`
  unchanged (the API sets its own headers)" and "add no headers inside `location /api/`". Pick one. Either move the
  `add_header` lines into `location /`, or say the duplication is intended. Also add
  `proxy_set_header X-Forwarded-Host $host;`. `checkOrigin` prefers a client-sent `X-Forwarded-Host`
  (`auth/session.ts:95`, existing code). A cross-site browser cannot set it without a preflight, which fails, but pinning it
  at the proxy is cheap.

### Body and size limits (brief scope 2)
- The global JSON limit is `bodyLimit: 1_000_000` (`app.ts:41`). No route sets `bodyLimit` and no custom content-type parser
  exists (`git grep bodyLimit|addContentTypeParser|attachFieldsToBody` finds only `app.ts`).
- Multipart is limited to `fileSize: 25 MB, files: 1, fields: 4` (`app.ts:77`).
- Tests:
  - `security.test.ts:139-150`: all write routes from the route table → 413 with the envelope, and no route raises
    `bodyLimit`;
  - a 900 kB control;
  - 25 MB + 10 bytes → 413 `UPLOAD_REJECTED`.

### (3) Rate limits
- Keyed by the session's token hash (`ratelimit.ts:52`, `ctx.tokenHash` from `requireUser`), not by IP.
  `trustProxy: false` is unchanged (`app.ts:42`).
- `requireUser` is cached per request (`auth/session.ts:58`), so the preHandler adds no second DB query. It runs the CSRF
  check before counting, so cross-site attempts are never counted.
- Coverage: the 3 message routes, the 3 organisation-proposal routes and `POST /uploads` (`ratelimit.ts:20-28`), as the brief
  asks.
  - The bucket is resolved from `req.routeOptions.url` (`:49`), and the global `preHandler` is installed before any route
    plugin (`app.ts:76`).
  - Uploads are refused before `req.file()` reads the stream.
- Envelope: an `ApiError('RATE_LIMITED', 429, …, {retryable: true})` goes through the standard error handler, with
  `Retry-After` = seconds until the oldest hit leaves the window (`:54`). `RATE_LIMITED` is already in
  `shared/contracts/src/errors.ts:4`.
- No lockout of sign-in or the admin:
  - `/auth/*` is not limited.
  - Only requests that already have a session are counted, so no third party can spend someone else's budget.
  - A 429'd attempt itself is not counted (`take` returns before `push`), so a stuck client does not extend its own block.
  - The admin can always open a new session.
- Memory is bounded:
  - Each key holds at most `max` timestamps.
  - A key only exists for a valid session.
  - Keys with no hit in the window are swept once there are more than 5000 (`:40`). The sweep is O(n) per request only
    above 5000 live sessions, which is unrealistic here.
- m3: per-session keying (as the brief specifies) can be bypassed by signing in again, because a successful sign-in is not
  limited. That stops a runaway script, not a determined insider. A per-user ceiling (for example 3× the session limit) is
  the follow-up for wider exposure.
- m4: other creating writes stay unlimited: `POST /missions`, `/missions/:id/threads`, `/agents`, and task actions. This is
  outside the brief's list, so it is a follow-up only.

### (4) The e2e-only message-limit override
- It is a code constant in `server/src/cli/e2e-serve.ts:27`, passed as `buildApp({... writeLimits})` at `:29`. **No
  environment variable is read for it.** `configFromEnv()` (`config.ts:29-40`) has no `writeLimits`, and the production entry
  `src/main.ts:6-10` uses only `configFromEnv()`.
- `e2e-serve.ts:18` refuses any database except `axion_e2e\d*`, and it runs as its own process. The override cannot reach
  the production app.
- Proposals and uploads keep their real limits in e2e. The cost is that no browser check exercises the real 60/min
  message limit; only the server tests do. That is acceptable: the browser fixture (130 seeded messages in about 2 s) is not
  user behaviour.

### (5) CSRF and Origin coverage for routes added since Stage 5
- Programmatic enumeration with `git grep app.(post|put|patch|delete)` at `dda96f3` and at HEAD: 20 → 30 write routes. The
  10 new ones are exactly `SINCE_STAGE5_WRITES` (`security.test.ts:34-45`).
- Beyond the hand-kept list, `security.test.ts:248-268` walks `app.routeTable` (`app.ts:51`, the `onRoute` hook):
  - every write route except `/auth/connect` and `/auth/cancel` must return 403 `CSRF` without `X-CSRF`;
  - every write route, sign-in included, must refuse a cross-site Origin.
- So routes merged later are covered automatically. On the integration branch that means c05's
  `/agents/:id/version-proposals`, `/version-proposals/:pid/{decision,withdraw}` and `/agents/:id/rollback`. Every route is
  under `/api/v1` (all `register` calls carry that prefix).

### (6) Nothing loosened; dependencies
- No change to `package.json` or the lockfiles.
- The cookie `clear()` now repeats `HttpOnly`, `SameSite=Strict` and `Secure`, which is stricter. `Secure` stays
  env-gated, as before.
- The upload CSP gains `frame-ancestors`.
- The test change for `/auth/logout` makes the test stricter.
- The only widening is the `api-improve.mjs` guard regex, `axion_e2e` → `axion_e2e\d*`. That is the lane naming from
  LANES.md:15 and the same rule `e2e-serve.ts` already used. No production database name matches it. Accepted.
- Sign-in, permissions, visibility, append-only tables, the execution guard and the audit log are untouched.

## Findings

### Critical
None.

### Important
- **I1 (at merge): the "proposals" limit will not cover c05's version-proposal routes.** `LIMITED_ROUTES`
  (`ratelimit.ts:20-28`) is a hand-kept map. After merging into `improve-30h`, four governance writes stay unlimited:
  - `POST /agents/:id/version-proposals`;
  - `/version-proposals/:pid/decision`;
  - `/version-proposals/:pid/withdraw`;
  - `/agents/:id/rollback`.

  These are `server/src/agents/versions.ts:133,168,215,235` on the integration branch. Unlike CSRF, no test fails when a new
  write route of a limited kind is missing from the map.

  Fix during the merge:
  - add these routes to the `proposals` bucket (or to a `versions` bucket);
  - add a route-table test so that every write route whose path matches `/messages$|proposals|/uploads$` must be in
    `LIMITED_ROUTES`;
  - re-run `api-c05.mjs` under `api-e2e-preview.sh` to confirm it stays under 30 proposal writes a minute per session.

### Minor
- **m1:** Fastify's raw responses carry no security headers: bad-URL 400, 503 while closing, `clientError`. Set
  `frameworkErrors` to route them through the envelope and `onSend`, or narrow the README's "every API response".
- **m2:** the README nginx snippet: server-level `add_header` is inherited by `/api/`, so API responses get duplicate
  headers and two CSPs. That is safe but contradicts "proxy unchanged". Also pin `X-Forwarded-Host $host`. For SSE through
  nginx, `proxy_http_version 1.1; proxy_set_header Connection "";` is the usual pair.
- **m3:** per-session limits can be bypassed by a fresh sign-in. Add a per-user ceiling before wider exposure.
- **m4:** mission, thread and agent creation and task actions are not rate-limited (out of brief scope). Queue them for S2.
- **m5:** the header samples do not include an explicit `OPTIONS` preflight. It gets the 404 path with the headers
  (verified on bare Fastify above), but one sample line in `security.test.ts` would pin it.
- **m6:** two GET routes added since Stage 5 write to the database. "GETs are reads, not CSRF-checked by design" is
  therefore not quite literal.
  - The routes are `GET /threads/:id/messages` and `GET /channels/:key/messages`. Both reach `readPage`
    (`conversations/service.ts:114-116`), which upserts `thread_reads` (the read marker) unless `mark=0`.
  - It cannot be exploited: the cookies are `SameSite=Strict`, so a cross-site navigation or `<img>` carries no session, and
    no CORS is granted. The only effect would be to advance the caller's own read marker.
  - Document it in the report and README note, or move marking to a POST later. My enumeration for (5) was by HTTP method,
    which is how I found these two.
- **nit:** `uploads.ts:125` (`private, max-age=3600`) is dead, because it is always overwritten with `no-store`. Delete it,
  or comment that `onSend` wins.

## Notes for the controller
- Merge conflicts to expect:
  - the `server/README.md` test count (385 vs the integration count);
  - `e2e-serve.ts`;
  - `api-improve.mjs`, the same one-line regex fix that other lanes may make.
- The demo `flows.mjs` Hierarchy step failing with and without this change is an A/B on the lane, under load average 19–28.
  It is not attributable to c14, because `git diff 2ed66e9 -- web/src` is empty. Re-check it on a quiet host at
  integration.
- `api-e2e-preview.sh` defaults to port 5193 for `vite preview`. Lane runs must set `E2E_WEB_PORT` to the lane's B+91
  (LANES.md:13).
