# c37 re-review (scoped, after fix round)

Worktree /home/luca/AXION-w35, c37-browser-contract, fix tip a8e8745 (first review at 089d0ea). Read-only. Vitest `browser-contract.test.ts`: 359/359 pass. Probes were scratch scripts outside the worktree (/tmp/claude-0/s/p.ts, q.ts).

Verdict: **NOT CLEAR**, on one Important (sensitive-field facts) and one Important (obligation on the needs_approval path). Everything in the first review's table is closed.

## 1. First review's bypass table, re-run

| Attempt | Now |
|---|---|
| click Post, Place order, Check out, Donate, Cancel subscription, Prepay, Autopay, Resend with `submits:'unknown'` or absent, no form | needs_approval R2 `ambiguous_effect` (also `submits:'NO'`, `true`, matches 2) |
| same names with `submits:'no'` | R2 with `keyword_raise` (publish_post, submit_form, change_external_setting, send_message) |
| Cyrillic "Ѕend", "Se̶nd" (U+0336), fullwidth "Ｂuy", Cherokee "Ꭺpply" | R2 (`mixed_script_name` and/or keyword_raise) |
| whitespace-only names (NBSP, U+3000), empty-string element name | R2 `blank_name` |
| css `xpath=..`, `a >> b`, `text=`, `a:has(`, `:is(`, `a:hover`, `*`, `,`, `+`, `~`, `>` without spaces | rejected |
| download of arbitrary link | `allow_with_obligations`, obligations `['quarantine']` (see Important 2) |
| fill `val_` into password, cc-number, "Credit Card", "Mot de passe", "Passwort", Cyrillic "Pаssword" | deny `secret_via_value_ref` |

All held or are closed. Navigate, origin, scroll, proto and size rows were not touched by the fix diff and are unchanged.

## 2. Fresh bypasses

### CSS grammar (schema.ts:11-30) - holds
Probed ~40 samples. Rejected: trailing `>`, `[role="x"] >`, double space, tab, NBSP, leading/trailing space, `> >`, 6 compounds (5 accepted), unquoted or single-quoted attributes, `[ROLE=..]`, ` i` flag, escapes (`\` is excluded from the value class), non-ASCII identifiers (`é`, `.é`), U+2028 in a value, 81-char values, `#1a`. Accepted: non-ASCII inside a quoted value, and `]`, `>` or space inside quotes (inert inside a CSS string). The sticky regex has no ambiguous repetition; adversarial 100-char inputs ran in 0 ms. No gap found.

### `submits:'no'` plus a dangerous name in another language - does not matter much, noted
"Senden", "Envoyer", "送信" raise. "Отправить" (Russian), "Zahlen", "Absenden", "Valider" stay R1 fill_draft with `submits:'no'`. Since `'no'` is a positive claim from the trusted executor (STAGE7.md item 2), a page cannot make a real submit control report `'no'`; the keyword list is a supplement. Not a finding. **Minor** (contract.ts:101-108): the list is thin outside en/de/fr/es/it/ja/zh; add ru ("отправить", "оплатить", "удалить", "купить") for cheap defence in depth.

### Sensitive-field evasion through executor facts
- **Important 1, contract.ts:130 and :241.** `SENSITIVE_AUTOCOMPLETE = /^(?:cc-|current-password|new-password|one-time-code)/i` is anchored at the start and unnormalised. HTML autocomplete is a token list, and `autocomplete="section-a cc-number"`, `"billing cc-number"` and `"shipping ... "` are valid and common. These all give `allow R1` for a `val_` ref: `' cc-number'` (leading space), `'section-a cc-number'`, `'billing cc-number'`; `inputType:' password'`/`'password\n'` also pass (the `inputType` compare is not trimmed). Trailing-space `'cc-number '` and uppercase `CC-NUMBER`/`PASSWORD` are caught. Fix: split autocomplete on whitespace, lower-case, and test every token; trim `inputType`. Add corpus cases.
- **Minor, contract.ts:131.** `SENSITIVE` names miss "Kartennummer", "Kreditkarte", "PIN", "cc_number"/"ccnum" fieldName, "api token". Names only ever raise, so this matters only when the executor leaves `inputType`/`autocomplete` empty; widen the list or treat unknown text fields without `autocomplete` as not-sensitive explicitly in STAGE7.md.
- The sensitive path is not in the property test (generator sets no `inputType`, `autocomplete` or `fieldName`), so nothing random would catch a regression there.

### Deny stays deny, across every raise path - holds
Keyword raise, `mixed_script_name`, `blank_name`, `sec_` raise and the ambiguous path were all run with no grant and with a read-only grant: the no-grant case stays `deny` (`out_of_scope`), including a keyword-raised send_message. The deny-stays-deny override (contract.ts:285-291) runs after all three text raises; the `sec_` raise happens before `structuralKind` is fixed, so it is part of the structural kind (a sec_ fill without grant is the same either way). `unsafe_href`, `link_origin_ungranted`, redirect denies and `origin_changed` all return before or after as a hard deny. **Minor (contract.ts:289-290):** a denied-by-override decision keeps the raised kind's reasons such as `approval_user` next to `out_of_scope`; cosmetic, but a reader of `reasons` may think approval is on offer.

### `allow_with_obligations` exhaustiveness
No `switch` on a decision outcome exists in server/src outside policy; the only consumers are `approvals/service.ts:27` and `grants/routes.ts:71` (both take the policy `Decision`, and `BrowserDecision` is deliberately not assignable to it because `outcome` is widened and `obligations` is required, so wiring it into either fails to compile; good). So nothing is skipped today.
- **Important 2, contract.ts:173-174 (`withObligations`).** Only `allow` is turned into `allow_with_obligations`. A download that needs approval (no element facts, an unresolved element, or a keyword-raised name; probe: `download no el` and `download kw` with fill_draft-only grant) keeps outcome `needs_approval` with `obligations:['quarantine']`. An executor that, after the approval is granted, reads only the outcome (`needs_approval` then approved, run) can run the download without quarantine, which is exactly the failure the ruling meant to close. Fix: map every non-deny outcome when `obligations.length` is non-zero (`needs_approval_with_obligations`), or state in the type that the approved-run path must re-check `obligations` and make the executor entry point take the `Classification` and branch on `obligations` rather than on outcome. STAGE7.md item 4 says to execute only through obligation-aware code, which is prose only for this path.
- Answer to ruling 3: for the `allow` path an outcome-only reader cannot run a download unquarantined (it never sees `allow`); for the `needs_approval` path it can.

## 3. Property test
- It varies element name, locator text, title, visibleText, role, matches, inForm, formMethod, submits, autoSubmit, href, origins, redirects, actual URL and expected origin, over 1000 seeded runs with homoglyph, combining-mark, fullwidth, NBSP and Cherokee inputs added. `title`/`visibleText` are now asserted irrelevant (`toEqual`), which is a real check.
- It compares outcome rank (`allow < allow_with_obligations < needs_approval < deny`) as well as tier, and asserts `lowered === 0`. By reasoning, removing the deny-stays-deny override would be caught: a keyword-raised name with no grant would become needs_approval against a bare deny (the generator has `origins=[]` cases and `deniedOrRaised > 100` is asserted). I did not mutate the worktree to confirm.
- **Minor (test:150-152).** The element generator never sets `inputType`, `autocomplete` or `fieldName`, so sensitive-field logic and the `sec_` path versus facts are not property-covered (only by fixtures).

## 4. No test loosened
- Two download corpus cases: `outcome` `allow` -> `allow_with_obligations`, plus a new `obligations:['quarantine']` assertion; the test now asserts `obligations` equals `[]` for every other case. Tighter, not looser.
- css valid-action sample: `ul > li:nth-child(2)` -> `ul > li.item`. Forced by the new grammar (pseudo-classes are deliberately rejected); the removed form is now a rejection case in the malformed fixture (501 added lines, 0 removed). Not a loosening.
- The two removed lines in browser-injection.json are exactly the two `allow` outcomes above; all other fixture changes are additions (+2383).
- `stripText` now also blanks `finish.summary` and replaces the element name with `'x'` rather than `''` (this avoids a false `blank_name` raise in the baseline): correct.

## Other
- Digest now binds the element by hash (contract.ts:34-45), tested for submits and name changes and for `digestOf` equality. Closed (first review Minor 8).
- ElementFacts trust boundary is documented in code and in STAGE7.md (first review Minor 6). Closed.
- Whitespace-only names are rejected in schema.ts:43 (first review Minor 7). Closed.
