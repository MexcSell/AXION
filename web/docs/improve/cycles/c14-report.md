# Cycle 14 report: security S1, HTTP hardening (lane w12)

Implementer report for `c14-brief.md`. Branch `c14-security-hardening` in `/home/luca/AXION-w12`, base `2ed66e9`.
No migration, no new dependency, no change to auth, visibility, append-only tables, the execution guard or the audit log.
Everything here is stricter than before.

## What was built

### Server
- **`src/http-headers.ts`** (new): the API's security headers and its own CSP `default-src 'none'; frame-ancestors 'none'`.
  - `app.ts` `onSend` sets them on every response. It sets the CSP only when a route didn't set its own one, so uploads
    keep their sandbox.
  - New on every response: `Cross-Origin-Opener-Policy: same-origin` and the CSP with `frame-ancestors 'none'`.
  - Already present before this cycle, now tested on every kind of response: `nosniff`, `no-referrer`, `X-Frame-Options:
    DENY`, `Cache-Control: no-store`.
  - **SSE** (`events/stream.ts`): the stream is hijacked, so `onSend` never ran there and the stream carried none of these
    headers. Its `writeHead` now sends them too (Cache-Control stays `no-cache, no-transform`).
  - **Uploads** (`missions/uploads.ts`): the CSP is now `sandbox; default-src 'none'; frame-ancestors 'none'`.
- **`src/ratelimit.ts`** (new): per-session write rate limits.
  - A `preHandler` resolves the session for a limited route (the CSRF check runs there too). It then counts the attempt in
    a sliding 60-second window keyed by the session's token hash.
  - **messages** 60/min, shared by `POST /threads/:id/messages`, `/channels/:key/messages` and
    `/channels/admin/:userId/messages`.
  - **proposals** 30/min, shared by create, decision and withdraw.
  - **uploads** 30/min, checked before the file is read.
  - Over the limit, the response is `429` with `{code: 'RATE_LIMITED', message, correlationId, retryable: true}` and
    `Retry-After`.
  - Every attempt counts, also a refused one or an idempotent replay. Reads are never limited, and a request without a
    session still gets 401 and is not counted.
  - `Config.writeLimits` overrides the limits; the tests use 3.
- **Cookie clears** (`auth/session.ts` `clear()`): before, a cookie was deleted with only `Path=/`. It is now deleted with
  the same flags it was set with: `HttpOnly`, `SameSite=Strict`, `Secure` when `COOKIE_SECURE=1`.
- **Route table** (`app.ts`): an `onRoute` hook records every route as registered (`app.routeTable`). The tests walk it, so
  a write route added later is covered automatically.
- **e2e server** (`cli/e2e-serve.ts`): only the message limit is lifted, to 1000/min.
  - Why: `api-stage6.mjs` seeds a paged thread with 130 messages from one session in about 2 s, which the real limit
    refuses. Measured: the first preview run failed 4 of 54 checks.
  - Proposals and uploads keep the real limits there. The production default is unchanged and covered by the server tests.
- `server/README.md`: a new section "HTTP hardening (cycle 14)" with an nginx reverse-proxy snippet (CSP, headers, HSTS,
  body size, SSE buffering).

### Web
- **`web/security-headers.ts`** (new): the built app's CSP and headers, used by `vite preview` (`vite.config.ts`, one line)
  and copied into the README snippet:
  `default-src 'self'; script-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none';
  frame-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
  - **`style-src-elem 'unsafe-inline'` is a measured exception.**
    - The first run with plain `style-src 'self'` showed exactly one violation, from the account dropdown menu.
    - The Radix dropdown's scroll lock (react-remove-scroll, in the `Chips` chunk) adds a `<style>` element containing
      the scrollbar width. Its content varies, so a hash can't match, and a static server has no nonce.
    - Only `<style>` elements are allowed. `style=""` attributes in markup stay blocked: `style-src-attr` falls back to
      `'self'`. React's `style` prop goes through CSSOM and is not affected.
    - Scripts stay fully strict: no inline script, no eval.
  - The dev server does not get the CSP, because Vite's HMR and the React preamble are inline scripts.
- **`web/scripts/api-e2e-preview.sh`** (new): the same throw-away stack as `api-e2e.sh`, but it builds once and serves the
  production build with `vite preview`, which sends the CSP.
  - It refuses to run the checks when the page arrives without the CSP.
  - `api-e2e.sh` itself is unchanged.
- **`web/scripts/api-c14.mjs`** (new, 31 checks): headers on the page and on static files, and the CSP directives.
  - The app works under the CSP: sign-in, the live stream, 12 pages, a help popover, a dropdown menu, the command
    palette dialog, and a message sent with the page's session.
  - A cross-site Origin through the proxy gets 403 CSRF.
  - The CSP is enforced: an injected inline script and a string timer are blocked and reported.
  - There are zero other violations and no page errors.
- **`web/scripts/api-improve.mjs`**: one regex now accepts lane databases (`axion_e2e<N>`), the same rule `e2e-serve.ts`
  already used. Before, the script stopped on every lane with "E2E_DATABASE_URL must point at axion_e2e", which was an
  environment issue, not a product failure.

## npm audit
`npm audit --omit=dev` (2026-11-21, registry contacted) found **server 0 vulnerabilities, web 0 vulnerabilities**. Run
without `--omit=dev`, both are also 0. Nothing to fix and nothing left to list. `node_modules` is a symlink into the
integration tree, so nothing was installed or upgraded.

## Cookie flags and CSRF + Origin review (scope 5)
- Cycles 1–3 added no cookie and no write route that skips `requireUser`/`requireAdmin`. Every handler resolves the
  session first, so the CSRF check comes before any validation or lookup. The tests confirm that every route returns 403
  `CSRF`, never a 400 or 404.
- **Boundary for "since Stage 5":** `dda96f3` (the last Stage 5 commit) to `HEAD`. The new write routes are:
  - `POST /agents`, `PATCH /agents/:id`;
  - `POST /channels/:key/messages`, `POST /channels/admin/:userId/messages`;
  - `POST /missions/:id/threads`, `POST /threads/:id/messages`;
  - `POST /organization/proposals`, `…/:id/decision`, `…/:id/withdraw`;
  - `POST /tasks/:id/:action`.
- GET routes are not CSRF-checked by design: they are reads, cookies are `SameSite=Strict`, and no CORS header is ever
  sent. A test asserts that a cross-site GET gets no `Access-Control-Allow-*` header.

## Tests: RED, then GREEN

`server/test/security.test.ts`, 54 tests.

**RED, first run** (route table and the limit constants only): 10 failed, 44 passed. Three of the failures were the
harness, not the product. They were fixed without changing what is asserted:
- a second session must reuse the approved device cookie (a new device waits for approval, so the request got 401);
- direct-channel posts need an `Idempotency-Key`;
- there are exactly 30 write routes, so the sanity floor became `≥ 30`.

The SSE test also hung on close after a failed assertion, so `abort()` moved into `finally`.

**RED, clean run on the fixed harness** (`server/src` temporarily reverted to the pre-cycle behaviour: no
`installWriteLimits`, the old `onSend` headers, the old `clear()`, the old stream `writeHead` and the old upload CSP; then
`git checkout -- server/src`): **9 failed, 45 passed**. Every failure is for the right reason:

| Test | RED failure |
|---|---|
| samples | `limited: 400` instead of 429 (no limit) |
| CSP `frame-ancestors` | `health: expected 'undefined' to match /frame-ancestors 'none'/` |
| COOP | `health: expected undefined to be 'same-origin'` |
| upload CSP | `expected "sandbox; default-src 'none'" to contain "frame-ancestors 'none'"` |
| SSE headers | `expected null to be 'nosniff'` (the hijacked stream had none of the headers) |
| messages limit | `expected 201 to be 429` |
| proposals limit | `expected 400 to be 429` |
| uploads limit | `expected 201 to be 429` |
| cookie flags | `axion_wait: expected undefined to be true` (a cleared cookie had no `HttpOnly`) |

**Green on arrival**, already enforced before this cycle; these tests now guard against regressions:
- `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, `Cache-Control: no-store` on all 8 kinds of response;
- 413 with the envelope on all 30 write routes for a JSON body over 1 MB, and no route raising the limit;
- uploads ≤ 25 MB;
- 403 `CSRF` for a missing or a wrong `X-CSRF` and for a cross-site Origin (with a valid `X-CSRF`) on all 10 write routes
  added since Stage 5;
- a missing `X-CSRF` refused on every write route (only `/auth/connect` and `/auth/cancel` exempt), and a cross-site
  Origin refused on every write route, sign-in included;
- no CORS grant, also on a cross-site GET;
- the flags on cookies that are set.

**GREEN:** the whole server suite 385/385 (331 before, plus 54 new). The final `security.test.ts` run on the final tree
(after the sign-out exemption was removed) is 54/54.

## Commits
- `3a82013` feat(c14): headers, rate limits, cookie clears, route table, preview CSP, preview runner, api-c14 check, README
- `bcb626a` fix(c14): measured `style-src-elem` exception, string-code check, e2e message limit, api-improve lane database
- `39130bd` test(c14): sign-out not exempt from `X-CSRF`, README
- this report

## Results against the pass threshold

| Threshold item | Result | Evidence |
|---|---|---|
| A test per header | **PASS** | `security.test.ts`: one test each for `nosniff`, `no-referrer`, `X-Frame-Options`, CSP (`default-src 'none'; frame-ancestors 'none'`), COOP and `no-store`, each over 8 kinds of response (200 public, 200 authenticated JSON, 401, 403, 404, 413, 429, 500). Plus "no CORS grant", the upload CSP sandbox, and the SSE stream's headers. |
| A test per limit | **PASS** | JSON 1 MB on all 30 write routes, plus a just-under-the-limit control; uploads 25 MB; one 429 test each for messages, proposals and uploads (envelope, `retryable`, `Retry-After`, nothing written, another session unaffected, reads unlimited); 401 without a session, not counted; the defaults are generous (≥ 60, 20 and 20 per minute). |
| Every route added since Stage 5 rejects a missing `X-CSRF` and a cross-site Origin | **PASS** | All 10 write routes since `dda96f3`: exact 403 `CSRF` for a missing `X-CSRF`, a wrong `X-CSRF`, and a cross-site Origin with a valid `X-CSRF` (30 parameterised tests). A presence test makes sure the list matches the registered routes, and a same-origin control is not refused. Extended to every write route through `app.routeTable`. GET routes are reads and are not CSRF-checked by design (see above). |
| Whole server suite green | **PASS** | 385/385, 25 files (331 before, plus 54 new). Run through the gate on the final server code. The later test-only commit removes `/auth/logout` from the `X-CSRF` exemption, a stricter test. It passed in the clean RED run, since logout's check doesn't depend on this cycle's code, and again in the final `security.test.ts` run below. |
| api-mode browser checks green | **PASS, against `vite preview` with the CSP on** | One final run on the final tree with `api-e2e-preview.sh`: api-c14 31/31, api-auth-flow 15/15, api-flows 23/23, api-improve 83/83, api-stage6 94/94 (246/246). |
| The app works in a browser under the CSP | **PASS** | api-c14: the document and static files carry the CSP. Sign-in, the live stream, 12 pages, a popover, a dropdown menu and a dialog work with zero violations. An injected inline script and a string timer are blocked and reported, which proves the CSP is enforced. The other four api scripts ran under the same CSP. |
| verify-all green | **PASS except one step that also fails on the base config** | Dev server on 6290 (lane override config). Typecheck and build, route×tab crawl (77 views), deep crawl, auth flow, u1 flows, dialog smoke (106/106), dialog ids, help keys and the fs guard are all green. In `flows.mjs`, 20 of 21 passed in the first run and 19 of 21 in a rerun. Different steps failed each time ("Hierarchy … pane did not switch", then also "Conversations … thread did not switch"). Both use fixed `waitForTimeout(500)` sleeps after a click, in demo mode, at load average 19–28. This cycle changes no file under `web/src`: `git diff 2ed66e9 -- web/src` is empty, and the dev server sends no new headers. A third run failed only the Hierarchy step (20/21). **A/B:** with `vite.config.ts` restored to base `2ed66e9` and the dev server restarted, the same Hierarchy step fails the same way (20/21). So that step fails without this cycle's change, under the current machine load. Not caused by this cycle; worth a look by the controller on the integration tree. |
| npm audit recorded, fixable fixed | **PASS** | Server and web: 0 vulnerabilities with `--omit=dev`, and 0 with dev dependencies too. |

## Files changed
- server: `src/app.ts`, `src/http-headers.ts` (new), `src/ratelimit.ts` (new), `src/config.ts`, `src/events/stream.ts`,
  `src/missions/uploads.ts`, `src/auth/session.ts`, `src/cli/e2e-serve.ts`, `test/security.test.ts` (new), `README.md`
- web: `security-headers.ts` (new), `vite.config.ts` (one line), `scripts/api-e2e-preview.sh` (new),
  `scripts/api-c14.mjs` (new), `scripts/api-improve.mjs` (one regex)
- No UI change, so no screenshot.

## Concerns
- **The e2e server lifts the message limit to 1000/min.** This is not a loosening of production or of a test assertion.
  `api-stage6.mjs` seeds 130 messages from one session in about 2 s, and with the real 60/min it failed 4 of 54 checks
  (the first preview run). Only the throw-away e2e server (`cli/e2e-serve.ts`) lifts it; proposals and uploads keep the
  real limits there. As a result, no browser check exercises the real message limit; the server tests cover it.
- **`style-src-elem 'unsafe-inline'`.** Inline `<style>` elements are allowed for the dropdown's scroll lock. An attacker
  who could inject markup could also inject CSS, but never script. Removing it would need a nonce-capable server or a
  dropdown without react-remove-scroll (`modal={false}`). Browsers without `style-src-elem` fall back to `style-src 'self'`
  and only lose the scrollbar-gap compensation.
- **Upload downloads were already `no-store`.** The global `onSend` overrides the upload route's
  `Cache-Control: private, max-age=3600`. That was already true before this cycle and is the stricter value, so it is
  kept. The dead line in `uploads.ts` is left alone to keep the diff small.
- **The limits are in memory and per process.** They reset on restart and are not shared across processes. That is
  enough for the single API process today, but it is listed for wider exposure.
- **`Secure` cookies stay off by default** (`COOKIE_SECURE=1` turns them on), because the app is served over plain http
  through the tunnel. The README says so.
- **The `api-improve.mjs` regex fix** touches a shared script, as a one-line change. Another lane may make the same fix.
- **The demo `flows.mjs` Hierarchy step** fails here with and without this change (A/B above). It uses fixed sleeps after
  clicks under heavy machine load.
