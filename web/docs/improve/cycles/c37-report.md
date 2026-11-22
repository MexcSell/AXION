# c37 report: browser action contract and injection corpus (Phase 2, Wave 2, P2)

Lane w35, branch `c37-browser-contract`, from c36-site-grants (719091a). No migration. No executor, browser, network or model call.

## What was built
- `shared/contracts/src/browser.ts`: `BrowserAction` and `Locator` types exactly as spec §10.7 (navigate, observe, click, fill with valueRef, select, scroll, waitFor, screenshot, download, finish; Locator by role, label, testId, css) plus `BROWSER_LIMITS`. Deviation from the brief: the **zod strict schemas live in `server/src/browser/schema.ts`**, not in shared, because zod is a server-only dependency (shared/ and web/ cannot resolve it) and the url check needs the server-side c36 `normaliseOrigin`.
- `server/src/browser/schema.ts`: `z.strictObject` union. Bounds: url 2048 (path+query 1500, origin part through c36 `normaliseOrigin`; no whitespace, backslash or hidden chars), names/labels 200, testId charset, pixels 1..10000 integer, timeoutMs 1..30000 integer, select value 200 and no `javascript:`/`data:`/`vbscript:`/`file:`/`blob:` start, summary 2000, `valueRef` must match `^(val|sec)_[A-Za-z0-9]{6,64}$` (a reference id, never a raw value). css locator: charset whitelist, 200 cap, no `:has(` / `javascript:` / `expression(` / `url(` / `@import`, flagged `css_fallback`. Hidden/zero-width/bidi/control characters are refused in every text field.
- `server/src/browser/contract.ts`: `parseAction` (reasons list; names forbidden fields such as evaluate, script, cdp, expression), `canonicalActionDigest` (bound object `{missionId, kind:'browser-action', payload:{v,tenantId,taskId,origin,requestedBy,action}}`; its digest equals approvals `digestOf(missionId, kind, payload)`, tested; the P3 adapter itself is untested until P3 merges), `classifyAction(action, pageContext, {requester, grants, now, missionId, tenantPolicy})` which builds a P1 `Action` and calls `evaluate()`.
- Fixtures: `server/test/fixtures/browser-injection.json` (generated once by a throwaway script, committed as data), `browser-malformed.json`. Tests: `server/test/browser-contract.test.ts`.

## Classifier rules (structure only)
- Origin comes only from the revalidated `actualUrl` (non-navigate) or the navigate URL plus every redirect hop. `expectedOrigin` mismatch denies (`origin_changed`), even if the new origin is granted. Invalid origin (c36 refusal, IDN, IP) denies at R4 (`origin_invalid`).
- navigate/observe/scroll/waitFor: `read` R0; screenshot: `screenshot` R0; finish: `summarize` R0 (all need a covering grant on the origin, else deny).
- click/fill/select: facts about the resolved element come from the executor (`ElementFacts`: role, matches, inForm, formMethod, submits, autoSubmit, href). Submit path (submits yes, or in a form and not declared non-submitting, or autoSubmit) -> `submit_form` R2. Otherwise draft `fill_draft` R1. Unknown role, not exactly one match, or no element facts -> R2 with `ambiguous_effect`. `sec_` valueRef -> at least R2 (`secret_value`).
- download: R1 (`fill_draft`) plus `quarantine`; ambiguous -> R2.
- Links: cross-origin href needs its own grant (`link_origin_ungranted`); javascript:, data:, non-https, backslash or whitespace hrefs deny (`unsafe_href`).
- Keyword raise (NFKC fold, zero-width stripped, word-start match for Latin, substring for CJK; en/fr/es/de/it/ja/zh) on locator text and accessible name, click/fill/select only. It maps to send_message, publish_post, submit_bid, change_external_setting, submit_form (R2) or release (R3, deploy). Raise only: the highest-tier kind wins.
- Policy baseline NOT changed: no new kinds were needed (download maps to `fill_draft`), and adding a V2 would change `policyVersion` that site-grants tests assert. A dedicated `browser-download` kind is a later option.

## RED / GREEN
RED: with `server/src/browser` absent the test file failed to load (`Failed to resolve import ../src/browser/contract.ts`, "no tests"). Then the first GREEN attempt showed 4 failures, all fixture mistakes (an injection text containing the word "message" was correctly raised; zero-width characters in model-supplied locator text are correctly rejected at parse), fixed in the fixtures, not by loosening a rule.
GREEN: `test/browser-contract.test.ts` 242/242. Full server suite 42 files, 1143/1143. `tsc --noEmit` server and web both clean.

## Threshold
| Item | Result |
|---|---|
| 100% of injection corpus classified to the expected outcome (tier, outcome, origin, reasons) | PASS: 154/154 (>= 80 required; 24 are parse-level rejections, 130 classified) |
| Zero cases where text lowered a tier or changed the origin | PASS: asserted per case against the same case with all page text stripped; 0 lowered, 0 origin changes |
| Property test, 1000 seeded random (action, injected text) pairs: tier(with text) >= tier(without), origin = revalidated one | PASS: 1000/1000, lowered 0, changed 0; the generator hits raising/denial in more than 100 pairs (asserted) |
| Malformed corpus >= 40 rejected with reasons | PASS: 79/79 rejected, each with at least one reason; forbidden `evaluate`/`script`/`cdp`/`expression` named |
| Required families (ignore-previous, attacker navigate, "tier R0" claim, fake system messages, aria-label, redirect mid-action, button "Read more" in posting form, javascript:/data:, over-long, homoglyph origin, finish with instructions) | PASS: all present, checked by a coverage test |
| No executor, Playwright, network | PASS: see grep below |
| server tsc, vitest, web tsc | PASS |

No NOT MET items.

## No-executor proof
`grep -rniE "playwright|puppeteer|cdp\b|fetch\(|node:http|node:https|from 'http|from 'https|undici|axios|node-fetch|WebSocket|node:net" server/src/browser shared/contracts/src/browser.ts` finds only two comments and the `FORBIDDEN_KEYS` string list (words "CDP"/"cdp" in text). Imports of the new code are only: `zod`, `node:crypto`, `shared/contracts/src/browser.ts`, `../grants/origin.ts`, `../policy/index.ts`, `./schema.ts`.

## Files changed
shared/contracts/src/browser.ts (new), shared/contracts/src/index.ts (one export line), server/src/browser/schema.ts, server/src/browser/contract.ts, server/test/browser-contract.test.ts, server/test/fixtures/browser-injection.json, server/test/fixtures/browser-malformed.json, this report.

## Concerns
1. Trust boundary: `ElementFacts` (role, submits, href, matches) must come from the executor's own DOM inspection, never from the model. The classifier trusts them; a lying executor defeats it. Stage 7 must own that.
2. Over-raising: keyword and fail-closed rules mean a "Display" style false positive is avoided, but words like "message", "remove", "confirm" will send ordinary buttons to R2. Intended (safe direction).
3. Any in-form click not declared `submits: 'no'` is R2, including GET search forms.
4. Locale coverage of the keyword list is partial (cheap multilingual only); it can only raise, so a missed language falls back to the structural tier.
5. `finish`/`observe` need a grant on the origin (R0 policy rule), so a plan with no grants cannot even observe.
6. P3 digest v2 adapter not tested (not merged); only compatibility with the current `digestOf` is.
7. zod schemas in server not shared, so the web app cannot reuse them (types only).
