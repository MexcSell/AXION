# Cycle 14 — Lane w12 · security S1: HTTP hardening

## Hypothesis
The API and the web app are served on 127.0.0.1 behind an SSH tunnel today, but spec §13.1 asks for hardening before
any wider exposure, and defence in depth matters now. Audit and harden the HTTP layer without new runtime dependencies.

## Scope
1. **Security headers** on every API response:
   - `X-Content-Type-Options: nosniff`;
   - `Referrer-Policy: no-referrer`;
   - `X-Frame-Options: DENY` / `frame-ancestors 'none'`;
   - `Cross-Origin-Opener-Policy: same-origin`;
   - `Cache-Control: no-store` on authenticated JSON.
   Uploads keep their CSP sandbox. Add a strict Content-Security-Policy for the built web app, via `vite preview`
   headers and a documented reverse-proxy snippet in `server/README.md`. Verify the app still works under it.
2. **Body and size limits:** confirm JSON body limits on every route; uploads stay ≤ 25 MB.
3. **Rate limits:** a per-session rate limit on write routes (messages, proposals, uploads), generous enough for real
   use, returning `429` with the standard error envelope. Sign-in already has one.
4. **`npm audit --omit=dev`** for server and web: record the results and fix what is fixable without major upgrades;
   list the rest.
5. **Review the cookie flags and the CSRF + Origin checks** for any new route added in cycles 1–3; add tests if missing.

## Measure and pass threshold (fixed now)
- A test per header and limit.
- A test that every route added since Stage 5 rejects a missing `X-CSRF` and a cross-site Origin.
- The whole suite, the api-mode browser checks and verify-all stay green. The app works in a browser under the CSP:
  run the api-mode checks against `vite preview` with the CSP on, or document precisely why only the dev server is
  checked.

## Lane
You are lane w12: worktree `/home/luca/AXION-w12`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w12.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
