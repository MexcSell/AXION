# c96 review: NOT CLEAR (3 majors, all fixable without redesign)

Checked: tsc clean. Thresholds commit a403bff precedes the code (d1da034) and the tests (f351752), and the report is last. Scope is clean: 9 files, no route, migration or web change. The tree is clean after my probes (probe file deleted, conformance.ts restored).

Probes (all deny unless noted): "1" vs 1, array for scalar, NaN, Infinity, 1e309, -0 against range min 1, case and ZWSP variants of exact values, an uppercase origin, a trailing-slash origin, getter, Proxy, extra top-level key, null history, proto-key history. Accessor, proxy and snapshot discipline holds. The plan is snapshotted once and the validated copy is used.

Mutation check (I ran it): always-allow fails 49/87. Untrusted-as-trusted fails 4. Ignoring max fails 4. Dropping the origin-grant check fails 2. Dropping extra_arg fails 2. The suite detects broken checkers.

## Findings
1. MAJOR: untrusted narrow-allow is unsafe for part 1. Omitting an optional argument or sending an empty list is labelled narrowing, but omission usually means a default or "no filter", which is wider. Probe: `tickets.tag {tags: []}` untrusted gives narrow-allow. `docs.search` with `limit` omitted untrusted gives narrow-allow (4 repeats, equal to max). Narrowings are bounded by `max` (no accumulation beyond it), but the content is chosen by the injected call, and the empty-list and omitted-optional cases can be wider than the approver saw. Ruling: untrusted narrowing should be `needs-approval`, or `deny` per the off-plan rule, until label propagation exists. Keep auto narrow-allow for user and system provenance only. Fix in conformance.ts: after the best match, if `narrowed && provenance === 'untrusted'`, return deny with reason `untrusted_off_plan`. Also make an empty subsetOf list a non-narrowing (reject, or require a `minItems` constraint).
2. MAJOR: T-b is largely tautological. The injected click, fill, select and download tools are simply absent from the plan, so they are denied as new_tool. Only `navigate` exercises argument constraints, via an exact URL. A realistic plan that allows click or fill (such as the fixtures' shop or form plans) would pass an injected in-plan click as allow. That is inherent to plan checks and the report only half says so. Add this to the report, and add a T-b variant using the broader shopPlan or formPlan that reports how many injected cases are allowed.
3. MAJOR: the corpus mapper (`toCall`, exec-plan.test.ts:238) is a test-only flattening. Unknown keys become arguments, so any extra key means extra_arg and the call is denied regardless of intent. The 100% figure partly measures the mapper, not the checker. Report this plainly.
4. MINOR: `subsetOf` with `maxItems` below `values.length` labels in-plan lists shorter than `maxItems` as narrow-allow (conformance.ts, `v.length < cap`). This is mislabelled as narrowing.
5. MINOR: `range` does not require integers. `id: 1.5` is allowed in plan (probe). Add an `integer` flag.
6. MINOR: text `prefix` and `contains` on URLs and paths are not path-normalised. `SHOP + '/../x'` is allowed. The plan author must tighten these.
7. MINOR: `forbiddenTools` is case-sensitive, so `Email.send` gives new_tool (needs-approval if trusted, deny if untrusted). That is safe here, but note it for the dispatcher.
8. MINOR: history and provenance are fully trusted. A forged `history` can satisfy `after` or reset counts. The report already says so.
9. MINOR: no RED run was recorded. I ran the mutation check above (results shown). Add one broken-checker test to the suite.
10. NOTE: T-c's 50% is set by the 12/12 authored mix, and the report says so. Fine.
