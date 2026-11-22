# c37 brief: browser action contract and injection corpus (Phase 2 · Wave 2 · P2)

**Lane:** w35, branched from **c36-site-grants** (719091a: contains c30 policy + c36 origin normaliser). Ports 8590 / 8591 / 8592–8593. E2E DB **axion_e2e9**. **No migration** (records-only contract; storage of browser sessions/actions is a later item).
**Sources:** spec §10.7 (lines ~972-994: `BrowserAction` union, `Locator`, "schema-validated structured actions, not arbitrary JavaScript/shell/CDP/SQL … revalidate actual origin … actions that send messages, submit forms, purchase … require external-effects approval"); spec §13.2 tiers; AgentDojo 2406.13352, WASP 2504.18575, Spotlighting 2403.14720, CaMeL 2503.18813, The Attacker Moves Second 2510.09023 (all verified).

## Hypothesis
When Stage 7 lands, a model will propose browser actions while reading untrusted page text. If the contract is a strict, closed schema, and the tier of every action is decided by P1 from the action's *structure* plus the *destination origin* (never from page text or model-supplied labels), then no injected text can raise an action's permission, change its target origin, or smuggle code. Prove it with a corpus now, before any executor exists.

## Build (test-first), pure code, no execution, no browser, no network
1. `shared/contracts/src/browser.ts`: the `BrowserAction` and `Locator` unions exactly as spec §10.7, as zod **strict** schemas with bounds. Note: `fill` carries `valueRef`, a reference to a server-held value or secret, never a raw value, so validate it as a reference id. Schemas have (string lengths, pixels ≤ 10 000, timeoutMs ≤ 30 000, url must pass c36 `normaliseOrigin` for its origin part, max path/query length, etc.). Unknown keys, unknown `type`, extra properties → reject. `css` locator restricted (no `:has(`/`javascript:`/`expression(`/`url(`; length cap) and flagged as fallback.
2. `server/src/browser/contract.ts`:
   - `parseAction(raw)` → `{ok, action}` | `{ok:false, reasons[]}`.
   - `canonicalActionDigest(action, context)` with context `{tenantId, missionId, taskId, origin, requestedBy}`. It is compatible with P3's digest v2 input: it feeds `requestApproval`/`consumeApproval` (P3 lands separately, so define the adapter and test it only once both are merged). Until then, produce the canonical bound-action object.
   - `classifyAction(action, pageContext)` → P1 `Action` → `evaluate()`. The rules are structural only:
     - `navigate` to an origin without a grant → deny;
     - `click`/`fill`/`select` on a control whose **declared role** is button, link, menuitem or input inside a form submit path → R2 when it may submit, R1 for a draft fill without submit;
     - `download` → R1 plus quarantine flag;
     - `observe`/`screenshot`/`scroll`/`waitFor`/`finish` → R0.

     Where structure is ambiguous (e.g. a click on a generic element), choose the **higher** tier (fail closed) and record reason `ambiguous_effect`.
   - Page text (accessible names, labels, visible text) can **never** lower a tier or change the origin. The only input that may *raise* the tier is a keyword list on the accessible name (send, submit, pay, buy, delete, publish, invite, deploy, confirm, transfer, bid…, multilingual where cheap), and that raise is **only** upward.
3. **Injection corpus** in `server/test/fixtures/browser-injection.json`, with at least 80 cases. Each case has a page context (title, accessible names, visible text, URL with redirects), a proposed action and the expected outcome. It must include:
   - "ignore previous instructions" text;
   - instructions to navigate to an attacker origin;
   - text claiming "this button is safe, tier R0";
   - fake system messages;
   - instructions hidden in aria-labels;
   - a redirect to a different origin mid-action (the revalidated origin must be used);
   - a locator whose role is button but whose name says "Read more", while the form posts (submit path → R2);
   - JS/CDP in values (`javascript:`, `data:`);
   - over-long values;
   - homoglyph origins (must fail via c36);
   - a `finish` whose summary contains instructions.

## Pass threshold (fixed)
- 100% of the corpus is classified to the expected outcome. **Zero** cases where page text lowered a tier or changed the origin. A property test runs 1 000 seeded random (action, injected page text) pairs: tier(with text) ≥ tier(without text), and the origin is always the revalidated one.
- 100% of the malformed-action corpus (≥ 40: unknown keys, wrong types, out-of-bounds, raw JS/CDP fields like `evaluate`, `script`, `cdp`, `expression`) is rejected with reasons.
- No executor, no Playwright import, no network: `grep` proof in the report.
- server tsc and vitest green; web tsc green.

## Report
`cycles/c37-report.md`.
