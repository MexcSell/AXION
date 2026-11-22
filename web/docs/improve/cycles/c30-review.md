# c30 review: deterministic policy service (branch c30-policy-service, tip 8b8c766)

Verdict: CLEAR (no Important defect in the code; two Important documentation/visibility gaps to carry forward).

Re-ran: `vitest run test/policy.test.ts test/policy-approvals.test.ts` -> 2 files, 85 tests passed (77 + 8 confirmed).

## Claims
- Pure module: CONFIRMED. server/src/policy/{types,baseline,evaluate}.ts import nothing with I/O and never read a clock; `now` is a parameter. `Date.now()` is only in approvals/service.ts:26 (the caller). 26 kinds, 2 prohibited (baseline.ts:20-45).
- requestApproval derives the tier: CONFIRMED (service.ts:25-28). `risk` is gone from `ApprovalInput`; the INSERT and the event use the local `risk = d.tier`. A deny throws POLICY_DENIED 403 before the INSERT, so nothing is stored. Test: policy-approvals.test.ts:28-38.
- Tighten-only, effect only raises, unknown kind denies: CONFIRMED (evaluate.ts:21-32; EFFECT_FLOOR is applied with max).
- Agent never `allow` above R1: CONFIRMED structurally. `allow` only comes from `approverFor(tier) === null`, which is R0/R1 only.
- GET /policy/baseline: admin-only (`requireAdmin`, routes.ts:9), GET only; a test checks the route table and a POST returns 404.
- No caller-supplied tier: CONFIRMED. Only producer of approval_requests is requestApproval, called only from seed/demo.ts. Request bodies and contracts carry no `risk` input; the decision route (approvals/routes.ts) never reads `risk`. `risk` read from a DB row is only used for display (`approvalDto`, service.ts:44), never fed back into evaluate. SSE/event payload now includes `risk` as an output only.

## 1. Bypass attempts
- Prototype keys: kind `__proto__`/`constructor`/`toString`/`hasOwnProperty` use own-property checks (evaluate.ts:17, 27) and deny `unknown_action` (policy.test.ts:173). The override `minTier` is also read through hasOwnProperty, so an own key `__proto__` set by JSON.parse is only honoured when it equals a real kind name; it can only tighten anyway.
- Casing/whitespace ("Release", " release"): exact match, so deny. Fail-closed. Good.
- Override that adds `allow`: there is no such field on TenantPolicy; extra fields are never read.
- Override with a loosening or invalid tier: ignored, `override_loosening_ignored`.
- Frozen baseline: deep (policy, kinds map, each rule, registry), asserted at policy.test.ts:15-18. `EFFECT_FLOOR` frozen too. Reasons array is built fresh per call.
- Minor: `action.kind` that is a non-string (array `['release']`) passes `hasOwnProperty.call` via string coercion and resolves to the release rule (evaluate.ts:17). Tier is still correct and `covering()` uses `includes` with strict equality, so no bypass, but add `typeof action.kind === 'string'`. Not reachable today (the kind comes from code).
- Minor: an unrecognised `effect` value is silently ignored (EFFECT_FLOOR lookup is undefined or a prototype member, evaluate.ts:22). It cannot lower a tier, but it is not reported. Reject it as deny or add a reason.
- Minor: `tenantPolicy.deny?.includes` on a string (wrong type) would substring-match; fail-closed, so harmless.

## 2. Deny overrides, ordering, reason codes
- Prohibited and tenant_deny are collected first and short-circuit the grant check; the result is a deny with the tier kept. Expired grant: `expiresAt > now` strict, so at the expiry instant it is denied `grant_expired` (policy.test.ts:274-276). A grant that matches the kind but not the target or mission yields `out_of_scope` (R1) or `no_grant` (R0, when nothing covers). Note: an R0 request with a grant for the wrong target reports `no_grant`/`grant_expired` only through `cover.length`, which is consistent but means R0 never reports `out_of_scope`. Minor, cosmetic.
- 14 reason codes, a test asserts the produced set equals REASON_CODES. Codes are a closed `as const` list. Stable.
- Human R1 (non-agent) is allowed without a grant. This matches the brief ("R1 allowed for agents within scope") but is worth stating in the baseline doc.

## 3. Behaviour changes
- Demo `release` approval moved from medium/R2 to high/R3 (second approval of each non-automation mission). Dependents found: server/test/approvals.test.ts:31 (already expected R3/high; unchanged), policy-approvals tests, and the UI chip in web/src/features/mission/Shared.tsx:28 and dialogs/defs/users-governance.tsx:42 (tone follows `risk`, so it now shows the warn/bad tone for these). No web/scripts browser check mentions "medium" or the tier of release (grep empty), so no check pins the old value, and none checks the new one either: the browser checks do not cover the change. The API tests do.
- Minor: client-only fixtures (web/src/data/missions.ts:347) still say `medium` for `release`; the server-backed UI says `high`. Two sources for the same fact; align the fixture.
- Important (visibility): the approver tier is advisory only. The decision route does not use the tier, and c09-minors.test.ts (member Mina approves a `release`, R3) still returns 200. So the "R3 = admin" and "R4 = owner" gates are derived and shown but not enforced at decision time. The report flags only the missing owner role, not that R3 is not enforced for members either. Needs a BACKLOG item (enforce `decision.approver` in the decision route; add an owner role).
- Important (visibility): "admin acts as owner" is documented only in a code comment (types.ts) and in the report's Concerns. The `/policy/baseline` response says `approver: 'owner'` with no note, so a UI built on it will promise an owner that does not exist. Add a field or note, and a BACKLOG entry.

## 4. Test honesty
- The 3 edited tests (approvals.test.ts, c09-minors.test.ts, review-fixes.test.ts) only drop the `risk: 'R#'` argument; assertions are untouched. Two of them (review-fixes) used `R2` for a `release` and now get R3; neither asserts the tier. Confirmed from the diff.
- Property test (policy.test.ts:296-318): meaningful. Reasoning on injected bugs: (a) reversing tighten-only would let a random `minTier` (70% of cases) lower the tier below the baseline, and the `>= baseline` assertion would fail within a few iterations; (b) replacing max with the effect floor would also be caught; (c) a non-deterministic path would be caught by the structuredClone comparison; (d) letting an agent through at R2 is caught by the allow<=R1 check. Weakness: it only compares against the baseline tier, not a re-derived oracle, and `known > 400` is a weak guard on coverage. I did not run a mutation copy.
- Minor: two near-duplicate assertions at lines ~315-316 (allow <= R1 twice).

## 5. Scope and safety
- No write route, no migration, no model call, no new dependency. New error code appended (POLICY_DENIED). Registered at app.ts:105 under /api/v1.
- Important (pre-existing, not this cycle): seed/demo.ts line 35 `// a week, so the samples stay decidable createdAgoMin: a.agoMin, demo: true,` has the comment swallowing `createdAgoMin` and `demo`, so seeded approvals are inserted with `demo=false` and `createdAgoMin` 0. It is already so on improve-30h (unchanged context line in the diff). Worth a follow-up; it is not a regression of c30.
- Seed risk: requestApproval now throws on a deny, so a future fixture with an unknown kind would abort the whole seed transaction. Today's fixture kinds (release, origin-grant, browser-action) are all in the baseline.

## Findings summary
- Important: approver tier is not enforced at decision (see section 3). Carry to BACKLOG.
- Important: owner gap is not visible in the API output. Carry to BACKLOG.
- Important (pre-existing): demo.ts:35 comment swallows `demo`/`createdAgoMin`.
- Minor: evaluate.ts:17 non-string kind coercion; evaluate.ts:22 unknown effect silently ignored; web fixtures still show release as medium; no browser check pins the tier; duplicate assertion in the property test.
