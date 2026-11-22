# c68 brief: operator attention queue, "needs you" (R3-9)

**Lane:** w66 (`/home/luca/AXION-w66`, branch `c68-attention-queue`), from improve-30h at the commit that adds this brief. Batches 14–19, 21, 22 and 23 are merged, including c58, c59, c60, c61, c63 and c54. Ports 11690–11693. E2E DB **axion_e2e7** (reused). Migration **0051** only if needed.

**Docs.** Read `phase2/research-r3.md` §R3-9 and `phase2/research-r3-verified.md` (its required changes). Evidence honesty:
- No source shows that a "why" reduces rubber-stamping, so claim navigation and traceability only, **never safety or error reduction**.
- The 39%/3%/13.6% approval figures are UNVERIFIED. Don't use them.
- The ranking order is a **design choice**; say so.

**The owner cares most about this kind of screen:** a polished, dense, one-screen UI with icons, `?` help and consistent motion. Match the existing look exactly and use the shared PageFrame.

## Items (each test-first, each its own commit)
1. **Read model.** One ranked list of what needs a human now. Row kinds:
   - pending approvals, by tier and age (reuse c58's latency and queue data);
   - stale task reviews (c51's stale rule);
   - tasks waiting on a person past an expected time (define it as an operator setting, or use a fixed documented default);
   - failures confirmed without a detection channel (c63);
   - proposals nearing expiry (org proposals and agent version proposals);
   - lesson candidates awaiting review (c41, including c63's system-derived ones).

   Each row has a **reason code** and a **templated one-sentence why** built from stored fields only, with no model-written text. A contract test fails on any row without both.
2. **Fixed ranking.** A pure, documented function: tier first, then expiry proximity, then age. Fixture tests cover tier, age and expiry ordering, and ties are broken deterministically. The ranking has no effect on any decision or tier.
3. **Collapse related items.** Related items collapse into one row with a count, for example 12 failures of the same mode or 5 pending approvals from one mission. The collapsed count must always equal the hidden total, tested on a fixture of 200 related events with the reduction ratio stated.

   **No alert budget and no suppression in v1.** Nothing is hidden except by explicit collapse, and R3/R4 approvals are never collapsed out of view.
4. **Three levels of detail.** Each row expands into activity, then action, then evidence. The evidence level shows **the check that would expose a defect**, not a reassuring summary. Examples:
   - for an approval, the bound digest and the Rule-of-Two flags;
   - for a review, the freshness rule;
   - for a failure, the missing detection channel.

   The evidence is at most 3 clicks from the list.
5. **View.** A "Needs you" section on Overview, or a tab in System Operations if Overview can't take it while keeping one screen.
   - It fits 1366×768 with no page scroll at 12 rows (fit-check).
   - Plain words, icons and a `?` on every reason code.
   - Keyboard navigable, with a11y clean.
   - It works at 390 px.
6. **Privacy.**
   - Members see only items they could already see through existing routes. Every row passes the same visibility rule as its source route; test this for each row kind.
   - No per-person ranking for non-admins.
7. **Contracts.** Registry, DTO and validator entries for every new field and route. No allowlist lines.

## Pass threshold
- Items 1–7 RED → GREEN.
- Full vitest (serial fallback; name every failure) and tsc.
- A new api-c68 with fit, 3-click evidence, member visibility per row kind and 390 px checks; api-stage6, api-improve and api-c58 pass.
- verify-all 10/10. fit-check and a11y clean in both modes. api-mobile has no new FAIL.

## Report
`cycles/c68-report.md`, with screenshots at 1366×768 (both themes) and 390 px. Follow the LANES.md Finishing rule.
