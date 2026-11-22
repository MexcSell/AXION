# c36 brief: site grants with an exact-origin normaliser (Phase 2 · Wave 2 · P4)

**Lane:** w34, branched from **c30-policy-service** (f483e2d). Ports 8490 / 8491 / 8492–8493. E2E DB **axion_e2e8**. Migration **0030**.
**Sources:** spec §11 `site_grants` (id, tenant_id, mission_id, exact_origin, capabilities, issued_by, expires/revoked; "deny absent/expired grants"); spec help text `browser.originGrant`; spec §10.7; WASP 2504.18575 and AgentDojo 2406.13352 (verified) for why the grant boundary must be exact.

## Hypothesis
P1's `evaluate()` takes `Grant`s, but they're in-memory types with no source of truth. A table of exact-origin grants, with a strict normaliser, gives P1 real grants. Paired with a hostile-origin corpus, it shows that no lookalike or internal address can ever match a grant.

## Build (test-first)
1. **`normaliseOrigin(input)`** in `server/src/grants/origin.ts`, pure. It returns `{ok, origin}` or `{ok:false, reason}`.
   - Accept only `https:`. `http:` is refused unless an explicit test-only flag is set.
   - Lowercase the host, apply IDNA to ASCII using Node's `url.domainToASCII`, and drop default ports.
   - Refuse: a path, query or fragment beyond `/`; userinfo; wildcards; IP literals (v4 and v6, including decimal, octal and hex forms); `localhost` and `*.localhost`; `.local`, `.internal` and `.home.arpa`; single-label hosts; and cloud-metadata names (`metadata.google.internal` and similar).
   - Refuse mixed-script or confusable hostnames: refuse any non-ASCII label unless it is a pure single-script label. Document the rule you choose and why.
   - Refuse a trailing dot, empty labels, and labels over 63 chars.
2. **Migration 0030: `site_grants`.**
   - Columns as in the spec, plus `revoked_at`, `revoked_by` and `reason`.
   - Grants are append-only except for a once-only revoke.
   - `exact_origin` is checked against the normaliser output: it is stored normalised, and the service refuses non-normalised input.
   - Add a TRUNCATE guard.
3. **Service and routes.** Grant (admin only, with an expiry required and capped at 30 days), revoke, and list. A grant is an R3 action: it goes through `evaluate()` with the kind `origin-grant`, which already exists in the baseline. `loadGrants(tenant, mission, now)` feeds P1's `evaluate()`. Absent, expired or revoked grants deny. Add the write routes to the rate-limit map.
4. **UI.** An admin "Site grants" panel where the existing structure puts permissions (Users & Governance › Permissions, or wherever the spec maps "Site Grants"; check the route map). It lists grants with their expiry, a grant dialog that validates live using the same rules (mirror the normaliser in shared/ or call a validate endpoint), revoke, and `?` help using the spec's `browser.originGrant` text.
5. **Hostile corpus** in `server/test/fixtures/hostile-origins.json`, with at least 60 entries. Include userinfo tricks (`https://good.com@evil.com`), backslashes, encoded dots, IPv4 in decimal, octal and hex, IPv6 and IPv4-mapped IPv6, `0.0.0.0`, `169.254.169.254`, `metadata.google.internal`, `localhost.`, unicode confusables (Cyrillic `а` in `pаypal.com`), punycode of confusables, trailing dots, ports, `file:`/`javascript:`/`data:`, whitespace and control chars, and over-long labels.

## Pass threshold (fixed)
- 100 % of the hostile corpus is refused; a benign corpus of at least 15 entries is 100 % accepted, with the exact expected normal form.
- An expired grant denies at the expiry instant; a revoked grant denies; a grant for mission A doesn't cover mission B; another tenant's grant never matches.
- `evaluate()` with real loaded grants: an R0 action on a granted origin is allowed, and on an ungranted origin is denied (`no_grant`).
- server tsc and vitest green; browser check `web/scripts/api-c36.mjs` (grant, see it listed, try a hostile origin and see the refusal reason, revoke); api-flows and api-stage6 pass; a11y and fit-check show no new problems.

## Report
`cycles/c36-report.md`.
