# c36 review (site grants, exact-origin normaliser)

Reviewer: independent, read-only. Worktree /home/luca/AXION-w34, branch c36-site-grants @ a6b8b39, diff f483e2d...c36-site-grants.
Ran `origin.test.ts` + `site-grants.test.ts` through the gate: 161/161 pass. Probed `normaliseOrigin` with about 330 hand-made inputs (no network).

**Verdict: NOT CLEAR**, narrowly. The normaliser holds against every WHATWG-quirk attack tried. The blockers are (I1) the whole-script look-alike gap is wider than "a few letters", (I2) `demo:clear` breaks, (I3) the revoke/clock-skew fail-open, (I4) the R3 evaluation is decorative.

## Normaliser: what held (all refused, correct reason)
Tab/newline/space, backslash, `%2e`, fullwidth/ideographic/halfwidth dots (U+FF0E, U+3002, U+FF61, U+2024), soft hyphen, zero-width, NBSP, fraction/division slash, `https:/h`, `https:h`, `:0443`, `:00443`, `:65536`, `:0`, `:+80`, fullwidth-digit port, `https://:80`, trailing dot (before and after path), `1`, `1.2`, `0x7f.1`, `127.1`, `a.0x`, `[::1]`, `0.0.0.0`, `xn--a`, `xn--`, uppercase `XN--` (lowercased and handled; `XN--ZCA.com` gives `xn--zca.com`), `ex--ample`, `_`, leading/trailing hyphen, fullwidth letters, compat chars (`ⅷ`, `ǆ`, `ſ`, `℀`, ZWJ, combining grapheme joiner), `ı`, `ɡ`, `ᴀ`, mixed Latin+Cyrillic/Greek, `аррӏе.com`, Greek `ΑΒΕ`, `xn--e1awd7f` / `xn--80ak6aa92e`, `.test/.example/.onion/.localhost`, `https://com` (single_label), `http:`. Accepted-and-correct: `HTTPS://EXAMPLE.COM`, `:443` (dropped), `:8443/`, `1.1.1.1.com`, `123.com`, `0x.com`, `bücher.com` = `xn--bcher-kva.com` (same as its punycode input).

## Normaliser: accepted inputs that should arguably be refused
| Input | Output | Why it is a problem |
|---|---|---|
| `https://ѵо.com` (U+0475 U+043E) | `https://xn--n1a3i.com` | Cyrillic izhitsa + o reads as `vo`; ѵ is not in LATIN_LOOKALIKE.Cyrillic |
| `https://ёе.com`, `https://ё.com` | `xn--e1a9c.com`, `xn--61a.com` | Cyrillic ё reads as Latin ë; not in set |
| `https://ӓ.com`, `https://ӧо.com` | `xn--w5a.com`, `xn--n1a15a.com` | Cyrillic ä / ö look-alikes |
| `https://ѡ.com` | `xn--n2a.com` | looks like w |
| `https://γ.com`, `https://η.com`, `https://μ.com`, `https://π.com`, `https://ω.com`, `https://σ.com` | `xn--oxa.com` etc. | Greek letters that resemble y, n, u, n/pi, w, o; the Greek set omits them |
| `https://օո.com`, `https://օ.com`, `https://ց.com`, `https://Ս.com` | `xn--mbbz.com` etc. | Armenian is in SCRIPTS but has NO look-alike set at all; `օո` reads as `on` |
| `https://ו.com`, `https://ם.com` (Hebrew) | `xn--9db.com` | look like `l` / `o`; no set |
| `https://ロ.com`, `https://カカ.com`, `https://エ.com`, `https://卜.com`, `https://工.com`, `https://口.com`, `https://一.com` | `xn--hek.com` etc. | CJK/Katakana shapes that mimic `ro`, `ca`, `I`, `h`/`l`, `工`=I, `口`=o, `一`=-; no set |
| `https://i̇.com` (i+U+0307), `İ.com` | `https://xn--i-9bb.com` | visually identical to `i.com`; ASCII+combining mark is allowed wholesale |
| `https://l̸.com`, `https://o̸.com`, `https://ø.com` | `xn--l-2eb.com`, `xn--o-2eb.com`, `xn--pda.com` | overlay-stroke marks / ø are near-identical to l/o; zalgo stacks (`a̸̸`, `é́́`) accepted with no cap on marks |
| `https://K.com` (Kelvin U+212A) | `https://k.com` | non-ASCII input silently becomes the ASCII origin; also `ẞ` -> `ß`, `Å` -> `å`. toLowerCase folds before the round-trip check, so the "no folding" rule of the header comment is not true for case folds. Matches browser behaviour, so Minor |
| `https://co.uk`, `https://github.io`, `https://a.b`, `https://example.c0m`, `https://example.comx` | same | public suffixes, 1-char and digit-bearing TLDs accepted (known limit). `https://github.io` grants all of github.io's tenants |
| `https://example.com:80` | `https://example.com:80` | allowed non-default port (documented) |

The brief's "pure single-script label" rule is satisfied by every row above (each is single-script); the defect is that the whole-script confusable list is a small hand list for two scripts only. That is the implementer's stated known limit, but the surface is bigger than stated (Armenian, Hebrew, Katakana/Han, Cyrillic ѵ ё ӓ ӧ ѡ, many Greek letters, combining marks on ASCII). No two distinct inputs of the normaliser collide into one origin except via legit IDNA equivalence (`bücher.com` vs `xn--bcher-kva.com`, case, `:443`, trailing `/`), and no ASCII-only host ever changes. Exact string matching still holds, so the harm is an admin granting a look-alike by mistake, not a grant match bypass.

## Findings

### Important
- **I1** server/src/grants/origin.ts:57-60 (LATIN_LOOKALIKE) and :85-95 (`checkUnicodeLabel`). Whole-script look-alike protection exists only for Cyrillic and Greek and with a short list; Armenian, Hebrew, Han/Kana and combining-mark-on-ASCII labels are accepted (table). Because the Armenian/Hebrew/Han/Kana scripts are in SCRIPTS, they are allowed with zero confusable screening. Suggest: extend the Cyrillic/Greek sets (ѵ ё ӓ ӧ ѡ ї ј γ η μ π ω σ ...), add sets for Armenian/Hebrew, or drop Armenian/Hebrew/Kana/Han from SCRIPTS until needed; refuse U+0307/U+0338 (dot-above, overlay) on ASCII bases and cap combining marks per label at 1. The brief's "refuse mixed-script or confusable" intent is only partly met.
- **I2** server/migrations/0030_site_grants.up.sql:9 and :27. `mission_id` references `missions(id)` with no cascade, and the guard trigger refuses every DELETE. `clearDemo` (server/src/seed/demo.ts:50-52) deletes demo missions after `set local axion.purge_demo = 'on'`; the other append-only tables (0007, 0008) honour that flag and cascade. site_grants does not, so any grant on a demo mission makes `npm run demo:clear` fail with a FK / append-only error. Fix: honour `current_setting('axion.purge_demo', true) = 'on'` in the guard and `on delete cascade` on mission_id (as 0007/0008 do), or document and test that demo missions cannot be granted.
- **I3** server/src/grants/service.ts:50-52 (`loadGrants`). Revocation is read as `revoked_at > $now` with `$now` from the app clock while `revoked_at` is the DB `now()` (routes.ts revoke). If the app clock is behind the DB clock, a just-revoked grant still loads and still allows: a fail-open on skew. The comment says "revoked rows are left out", the SQL does not do that. The test (site-grants.test.ts:188-196) hides this by passing `now = Date.now()+1000`. Fix: `revoked_at is null` only (a future "as of" evaluation is not needed), and move the dedupe/expiry comparisons in routes.ts:66 to one clock too.
- **I4** server/src/grants/routes.ts:61-62 and service.ts:30-33. The "R3 evaluation" is real in that `evaluate()` runs, but it cannot deny an admin: `decideGrant` passes `{}` as tenant policy (so no `tenant_deny` or `minTier` can ever apply), `role` is ignored by `evaluate()`, and the route accepts `needs_approval` as success with the issuer as approver. So it is a stamp, not a gate. Acceptable only if stated; the report and the UI chip ("R3 · you approve as administrator") do state it. Minor if the owner accepts self-approval; Important if "R3" is meant to mean a second admin.
- **I5** loadGrants and the caller contract (service.ts:42-53). `loadGrants(db, tenant, mission, now, subjectId)` stamps ANY subjectId onto every grant of that mission and does no membership check; the caller must supply it. It cannot return another tenant's or another mission's rows (SQL is scoped to both), so cross-tenant and cross-mission leakage is not possible. But a caller that passes an agent and a mission the agent is not in gets a valid grant for that mission. No caller exists yet. Marked Important only as a standing trap: add a `missionMember(agentId, missionId)` check inside `loadGrants` / `decideOnOrigin`, or rename it `loadGrantsUnchecked`.

### Minor
- routes.ts:60: `Date.parse` on an ISO string without a zone (`2026-11-23T10:00`) is read in server local time; require `Z` or an offset.
- routes.ts:66-70: duplicate check is select-then-insert with no unique index; two concurrent issues both succeed (duplicate active grants). Harmless for matching, but add a partial unique index on (tenant, mission, origin) where not revoked.
- routes.ts:52-53: the mission check runs after the policy decision and after the audit-of-denied path; a deleted (soft) mission is excluded, but `loadGrants` never checks `deleted_at`.
- migration check regex allows port up to 99999 (`:[1-9][0-9]{0,4}`); the service limits to 65535, so this is only a coarse second fence. No DB check that the TLD has 2+ characters.
- web/src/help/pages/c36-site-grants.ts (`grants.expiry`): says "or set an exact date and time", the dialog offers only fixed durations.
- web/src/api/siteGrants.ts `checkOrigin`: returns null on any failure and the dialog then shows "Checking..." forever with Grant disabled. No retry or message.
- web/scripts/api-c36.mjs: the dialog's exit is only tested through the successful grant (line 106). There is no Escape or Cancel step, and no test that a refused origin leaves the dialog open and Grant disabled then closes with Escape. The brief asks for a tested exit.
- DL-90: no collision found in any AXION-w* tree or docs at review time; re-check at merge.

## Checked and fine
- **Expiry**: `g.expiresAt > now` in evaluate (policy/evaluate.ts:44) so it denies exactly at the instant; the DTO state uses `<= now`; test at site-grants.test.ts:173 asserts both sides by one millisecond.
- **Revoke once**: row lock `for update`, 409 on second revoke, audited as denied, trigger blocks any further change after `revoked_at` is set. Tenant scoped (`tenant_id` in the select; other tenant gets 404). ID format checked.
- **Scoping**: `loadGrants` SQL filters tenant and mission; evaluate's `covering` also matches mission and subject. Cross-tenant and cross-mission tests exist.
- **Auth and limits**: all four routes call `requireAdmin`; both writes are in LIMITED_ROUTES (bucket `proposals`); the GET validate is pure and unlimited (admin only). Body schemas are `.strict()`, capabilities limited to R0/R1 kinds with a load-time assertion against the baseline.
- **Migration 0030**: update guard permits only a revoke (all other columns compared, `revoked_at` required non-null, `revoked_at`/`revoked_by` check), DELETE and TRUNCATE trigger refuse; `down` drops table (and its triggers) then the function, order is correct. Only the purge_demo exception is missing (I2).
- **security.test.ts**: diff is +2/-1: the LIMITED_KIND regex is widened with `site-grants` and the two routes are added to the expected set. Extended, not loosened.
- **UI**: live validation calls `GET /site-grants/validate`, which runs the same `normaliseOrigin` as the issue route; stale answers are dropped via `verdict.for === origin` and AbortController; server errors and field errors are shown; help entries exist for every field.
