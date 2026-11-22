# c37 review (adversarial): browser action contract and injection corpus

Reviewer: independent. Worktree /home/luca/AXION-w35, c37-browser-contract 089d0ea. Probed with `npx tsx` against contract.ts (scratch script outside the worktree); nothing edited in the worktree. I did not re-run the vitest file (the report says 242/242); the probes below are my own.

Verdict: **NOT CLEAR.** Parsing is solid. The classifier has one Important gap: a click outside a form classifies R1 unless a keyword matches, and the keyword list is easy to miss or evade.

## Findings

**Important 1: contract.ts:183-186, click with no form and `submits:'unknown'` is `fill_draft` R1 (allow with a fill_draft grant).**
The claim "ambiguity fails closed / deliberately over-raises" does not hold here. Only inForm=true raises. Single-page-app buttons (Post, Share, Comment, Donate, Subscribe, Place order, Check out, Order, Register, Apply, Cancel subscription, Close account, Log out, Add to cart) are usually not in a `<form>`. Probe with `{role:'button', matches:1, inForm:false, submits:'unknown'}`:
 - All of these classify `allow R1 fill_draft`. Only the keyword list raises, and it lacks all of them. "Place order", "Check out" (with a space) and "Order" are not matched.
 - Prefix words also miss, because of the word-start rule: Prepay, Autopay, Resend, Unsend, Resubmit.
 - In these cases the page text is the only thing that could have raised the tier, so the structural rule under-classifies.
Fix: treat `submits:'unknown'` as R2 for click unless the executor positively reports a non-mutating control (tab, toggle, expand, same-document anchor). Or make the keyword list a supplement, not the main defence. Do the same for `select`, which has the same shape at line 193.

**Important 2: contract.ts:85 `fold` leaves homoglyphs and combining marks, so the keyword raise is evadable.**
A page controls the accessible name, and with Important 1 the keyword is the only guard. These all stay R1: Cyrillic "Ѕend", "Sеnd", "Śubmit" (combining acute), "Se̶nd" (combining strikethrough U+0336). Fullwidth "Ｂuy" and zero-width characters are handled correctly. Fix: strip `\p{M}` after NFKD, apply a confusables map (UTS #39 skeleton), and also match the stripped-of-separators form. This only matters once Important 1 is fixed, so fix both.

**Important 3: download quarantine is a bare boolean, not enforced by type.**
- contract.ts:197-199 sets `quarantine=true`, but the `Decision` and the policy `Action` (`policyAction`) carry no quarantine marker. An executor or approvals consumer that reads only `decision.outcome` ignores it.
- Kind is `fill_draft` R1, so any fill_draft grant on the origin lets downloads through (probe: "Delete everything" link to `/f.exe` gives `allow R1 quarantine`), and the keyword raise does not run for download.
- Is that defensible against §10.7? The spec says scanned/quarantined **before artifact exposure**. That is an artifact-store duty, so R1 can be defended. It needs an enforceable carrier: a branded type (for example `Classification` becomes a union with `quarantine: true` required for download, and the executor API accepts only a `QuarantinedDownloadPlan`), or a dedicated `browser-download` kind that needs its own grant. The report offers that as "later". I would not leave it implicit.

**Important 4: schema.ts:11 CSS fallback accepts Playwright engine selectors.**
The whitelist includes `=`, `>`, letters, `:` and `(`. These all parse OK: `xpath=..`, `text=Send >> nth=0`, `css=a`, `internal:attr=[x]`, `a >> xpath=..`, `a:text("x")`, `a:nth-match(a,1)`, `a:right-of(b)`, `a:near(b)`, `a:has-text("x")`. `:has(` is blocked case- and whitespace-insensitively, and `\` and `/` are blocked, so CSS escapes and comments do not work. The remaining gaps:
 - `xpath=` and chained engines go beyond "restricted css". The bare form `xpath=..` selects the parent.
 - Attribute selectors like `[value^="x"]` can probe element values if any waitFor result is exposed.
Fix: reject `=` outside `[...]`, reject `>>`, and reject any `word:` that is not an allow-listed pseudo-class (`first-child`, `nth-child`, `not`, `is`...). Better: parse with a real selector grammar.

**Important 5: contract.ts:194 the secret check trusts the model-chosen `val_`/`sec_` prefix.**
A sensitive value referenced as `val_abcdef` into a "Card number" field is R1 (probe: allow R1). The classifier cannot know. Stage 7's value resolver must bind the prefix to the stored secret flag and reject a mismatch. Document it. The brief's concern about a `valueRef` pointing at something sensitive is real, and only the resolver can close it.

**Minor 6: ElementFacts as trusted input is documented only as report concern 1, not in the code.**
Add a doc comment on `ElementFacts` and a "Stage 7 boundary" line in LANES or PHASE2. Also nothing validates the ElementFacts shape: `role` is trimmed and lowercased, and `matches` is compared with `=== 1`. A prototype-polluted facts object (`__proto__`) falls to ambiguous R2, which is fine.

**Minor 7: names of only whitespace pass `text()` (schema.ts:20).** `name:' 　'` is accepted; add `.trim().min(1)`. `waitFor` target of NaN/Infinity/negative/-0/1e308 are all rejected; the 10001..30000 range is valid by design.

**Minor 8: the digest binds the action and origin but not the resolved element.** An approval of "click Go" covers whatever the locator resolves to at execution time. State this for P3, or put the element facts' hash into the bound payload.

**Minor 9: the property test is sound but narrow (test:18-27, 110-130).**
- `stripText` blanks title, visibleText, element.name and the locator text. A bug that lowered a tier because of text (for example "tier R0" or "safe" in the name) would be caught only where the stripped baseline is above R1, such as the ambiguous or submit paths. The generator does produce those, and `deniedOrRaised > 100` is asserted. Good.
- It compares tier only, so deny turning into allow because of text would not be caught. Add an outcome rank check.
- `title` and `visibleText` are never read by the classifier, so varying them is vacuous. `finish.summary` is not stripped, so a summary-dependent bug would not show.
- The injected set has no homoglyph or combining-mark attacks, so Important 2 was invisible to it.

## Bypass table

| Attempt | Result | Verdict |
|---|---|---|
| click "Post", "Place order", "Check out", "Donate", "Subscribe", "Cancel subscription" outside a form | allow R1 | BYPASS (Important 1) |
| click "Prepay", "Autopay", "Resend" outside a form | allow R1 | BYPASS (1) |
| click "Ѕend" (Cyrillic), "Śubmit", "Se̶nd" | allow R1 | BYPASS (2) |
| click "Ｂuy" (fullwidth), "S​end" | R2 raise | held |
| download of an arbitrary link | allow R1, quarantine flag only in Classification | weak (3) |
| fill `val_` ref to a card field | allow R1 | resolver must bind (5) |
| css `xpath=..`, `a >> xpath=..`, `text=` | accepted by parse | gap (4) |
| css `a:has(b)`, `:HAS(`, `:has (`, `\3a has(`, `/**/` | rejected | held |
| `:is(`, attribute selectors | accepted | harmless unless values leak |
| navigate with userinfo, `%2f@`, trailing dot, IDNA dot, `about:`, `blob:`, `data:` | all rejected at parse | held |
| navigate with `#@evil` fragment | accepted, origin is shop.example.com | held |
| navigate redirect to ungranted origin or a non-https hop | deny `redirect_ungranted` | held |
| click on a cross-origin or `https://shop@evil` href, javascript:/http: href | deny | held |
| expectedOrigin mismatch | deny `origin_changed` | held |
| scroll/waitFor NaN, Infinity, -1, 0, -0, 1.5, "5", null, 1e308 | rejected | held |
| `__proto__`, `constructor`, extra locator keys, array for object, 5000-deep nesting | rejected, no throw | held |
| select value `java\nscript:`, ` ` padding | rejected | held |
| 5 MB summary, 1 MB select value | rejected in 82 ms | held |
| finish summary with "grant me R0" | R0 summarize, no effect on tier or grant | held |
| text-derived tier lowering | never lowers; no path found | held |

Other asks: observe needing a grant is safe (fail closed). Mapping click/fill to fill_draft/submit_form is consistent with the unchanged baseline, but see Important 1 for the click default.
