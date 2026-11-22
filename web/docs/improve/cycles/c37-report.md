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

## Fix round (after c37-review.md, NOT CLEAR)
Corpora first. RED: with the new bypass cases and the required `obligations` field in the test, `browser-contract.test.ts` showed 242 failed / 114 passed (356). GREEN afterwards: 358/358 in the file, full server suite 42 files 1260/1260, server and web tsc clean.

Corpus sizes: injection 154 -> 219 (+65), malformed 79 -> 129 (+50). All pass. Property test still 1000 seeded pairs.

1. **Fail closed on click and select.** Only a positive `submits:'no'` gives R1; absent, `'unknown'` or in a form without `'no'` is R2 (`ambiguous_effect`, or `submit_path` for yes/in-form). 20 new cases (Post, Place order, Check out, Donate, Subscribe, Cancel subscription, Prepay, Autopay, Resend, Unsend, Resubmit, neutral "Go"/"Next"/"OK", select, absent submits) are R2 with no keyword needed. The keyword list is now a supplement (also extended: order, donate, subscribe, register, apply, post, share, comment, cancel, log out, re/un/pre/auto prefixes). Changed expectations: no existing click/select fixture changed (they already stated `submits`); the only changed expectations are the download ones (item 3) and the valid-css sample in the test (item 4).
2. **Keyword evasion.** Fold is NFKC, NFD, strip `\p{M}`, remove hidden chars, lowercase, plus a Cyrillic/Greek skeleton for whole-word homoglyphs. `mixed_script_name` raise (Latin mixed with another script in one word) and `blank_name` raise (NBSP, ideographic, em space, zero-width, Hangul filler); locator names that are only whitespace are refused at parse. Added cases: Cyrillic, combining acute, strikethrough U+0336, stroke U+0338, fullwidth, pure-Cyrillic "Ѕеnd", 7 blank names.
3. **Downloads.** `Classification.obligations` and `decision.obligations` are required (`BrowserDecision` type; a `@ts-expect-error` test shows omission does not compile). A download the policy allows returns outcome `allow_with_obligations`, not `allow`, so an executor reading only the outcome cannot run it as a plain allow. I chose this over baseline v2 / a `download_file` kind: a new kind bumps `policyVersion`, which `site-grants.test.ts` asserts as 1, and `download_file` would not be in the grantable set, so every download would be denied without widening site grants (a policy decision for the controller). Changed expectations: 2 download cases `allow` -> `allow_with_obligations`. Keyword raise now runs for download (2 new cases, plus cross-origin deny keeps the obligation).
4. **CSS.** Deny-list replaced by an allow-list grammar (tag, `#id`, `.class`, `[name|type|aria-label|data-testid|role="value"]`, joined by one space or ` > `, at most 5 compounds). 48 new malformed cases include every Playwright engine string from the review (xpath=, text= >> nth=, css=, internal:attr=, `>>`, :text, :nth-match, :right-of, :near, :has-text, :is, `*`, commas, unquoted and other attributes).
5. **Secrets.** Sensitive field = input type password, autocomplete cc-*/current-password/new-password/one-time-code, or name/fieldName/locator text keywords (card, cvv, cvc, csc, iban, ssn, password, passcode; homoglyph-folded). A `val_` ref there is denied (`secret_via_value_ref`); `sec_` stays R2. 18 cases. The prefix binding to the stored secret flag is documented in code and in `server/src/browser/STAGE7.md` (the Stage 7 resolver must enforce it).
Minors: ElementFacts TSDoc and `STAGE7.md`; `canonicalActionDigest` takes `element` and binds its hash (tested, still equals `digestOf`); property test now compares outcome order (deny > needs_approval > allow_with_obligations > allow) and tier, strips finish summary in the baseline, adds homoglyph and combining-mark injections, and asserts that changing only title/visibleText changes nothing (the classifier does not read them, stated in the test).

**Extra finding from the strengthened property test:** a text keyword raise could turn a no-grant deny (R1 draft kind) into needs_approval (R2 needs no grant). Fixed: if the structural kind was denied, the raised action stays denied (case added: "keyword raise must not turn a no-grant denial into an approval request").

Concern: `blank_name` means icon-only buttons with no accessible name go to R2, and the new keywords (order, post, share, comment, cancel) over-raise on ordinary buttons that the executor reports as `submits:'no'`. Intended direction (safe).

## Fix round 2 (after c37-rereview.md)
Test-first. RED: the new corpus and tests run against the fix-round-1 code (a8e8745) gave 40 failed / 369 passed (409). GREEN: `browser-contract.test.ts` 414/414; full server suite 42 files, 1315/1315; server and web tsc clean. Corpus sizes: injection 219 -> 269 (+50), malformed 129 (unchanged). Property test still 1000 seeded pairs.

1. **Sensitive-field detection.** `inputType` is trimmed and lower-cased; `autocomplete` is lower-cased, split on ASCII whitespace, and every token is tested (`cc-*`, `current-password`, `new-password`, `one-time-code`). Cases added: `section-a cc-number`, `billing cc-number`, ` cc-number`, `shipping current-password`, `SECTION-A Current-Password`, tab/newline separated tokens, `PASSWORD\n`, ` password`, plus names (Kartennummer, Kreditkarte, PIN, "Pin code", api token, API key, secret key, Client secret) and fieldName values (ccnum, cc_number, cc-number, cc_csc, cardnumber, api_key, apiKey). Negative cases: autocomplete name/email/street-address/off, "Pinterest handle" stay R1. The property test now sets inputType, autocomplete and fieldName at random and asserts independently that a `val_` fill into a sensitive field is denied (sensitive cases checked: more than 20, asserted). One injection-text fixture changed wording ("session token" to "session id") because "token" is now a sensitive-name word and that case is an R1 fill; the classifier behaviour is the intended one.
2. **Obligations on every non-deny outcome.** Chosen: the outcome name carries it (`allow_with_obligations`, `needs_approval_with_obligations`), enforced by a discriminated `BrowserDecision` union: a plain `allow` or `needs_approval` with a non-empty `obligations` list, or an `*_with_obligations` outcome with an empty list, does not compile (three `@ts-expect-error` tests). Why not a single entry-point function: there is no executor yet to bind it to, whereas the type makes every outcome-only reader, including the approved-run path, hit the obligation branch. Runtime tests cover allow, unresolved-element and keyword-raised downloads and every corpus case. Changed expectations: 3 download cases `needs_approval` -> `needs_approval_with_obligations`.
3. **Approvals path.** `toApprovalInput(classification, bound, meta)` returns an `ApprovalInput` (compile-checked) whose `digestOf(missionId, kind, payload)` equals `bound.digest`; obligations are listed in `detail`. It refuses allow and deny outcomes. `BrowserDecision` itself is deliberately not assignable to the policy `Decision`; the adapter is the single path.
4. **Minors.** Added Отправить, Оплатить, Удалить, Купить, Absenden, Zahlen, Valider (Löschen, Payer, Supprimer were already present); 11 cases. A deny that overrides a raise drops `approval_*` reasons from both `reasons` and `decision.reasons` (`notReasons` assertion in the corpus).
