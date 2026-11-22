# Stage 7 boundary notes for the browser contract (c37)

This module is pure: it classifies a proposed action. The executor (Stage 7) must uphold these, or the classifier's tiers mean nothing.

1. **ElementFacts are the executor's own facts.** `role`, `matches`, `inForm`, `formMethod`, `submits`, `autoSubmit`, `href`, `inputType`, `autocomplete` come from the executor's DOM inspection of the single resolved element, never from the model or from page text. `name` and `fieldName` are page text: untrusted, they can only raise a tier.
2. **`submits: 'no'` is a positive claim.** Report it only for a control known not to mutate (type=button outside a form, tab, toggle, same-document anchor). Absent or `'unknown'` is R2.
3. **Revalidate before every action.** `actualUrl` must be the URL the browser is on right now, after redirects. Use the navigate redirect chain for `redirects`.
4. **Obligations.** A decision with `obligations` (today `quarantine` for downloads) has outcome `allow_with_obligations`. Execute only through code that performs the obligation: download into quarantine, scan, and expose no artifact before the scan passes.
5. **valueRef prefixes.** The value resolver binds `sec_` to the stored value's secret flag: a `sec_` ref must resolve to a secret value and a `val_` ref to a non-secret one; a mismatch is refused. The classifier decides which fields are sensitive (password, cc-*, one-time-code, card/cvv/iban/ssn names) and denies `val_` there (`secret_via_value_ref`).
6. **Digest.** Bind the resolved element: pass `element` to `canonicalActionDigest` so an approval covers that element, not whatever the locator resolves to at execution.
7. **Grants.** The origin comes only from the revalidated URL; a link or redirect to another origin needs its own site grant.
