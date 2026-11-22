# c50 brief: API contract tests that can't fall behind (H9, replacing the held c15)

**Lane:** w49, from improve-30h at 7a139d8 (batches 4–9 merged, except c40 which is UI only). Ports 9990 (dev), 9991 (preview) and 9992–9993 (e2e). E2E DB **axion_e2e15** (reused; c43 is merged). No migration.
**Source:** BACKLOG H9. c15 (branch `c15-contract-tests`) wrote response validators for the API, but it predates cycles 4–20 and Phase 2. At batch 5 it had 53 drifted fields, 19 routes with no check and 7 event types missing, so it was held. Since then about 40 more routes and events have been added (c30–c42).

## Hypothesis
Hand-written contract tests rot because nothing forces them to grow with the API. If the list of routes to check is **generated from the running Fastify route table**, and the list of event types from the shared contracts, then a new route or event without a contract check fails the suite on the day it is added. Validating real responses against the shared DTO shapes in `shared/contracts` then catches drift between server and client types.

## Build (test-first)
1. **Route inventory.**
   - Build the app in a test (`makeTestApp`) and read every registered route (`app.printRoutes` or an `onRoute` hook) as method plus path.
   - A test fails if a route has neither a contract entry nor an explicit, reasoned exclusion. Health, static and SSE routes may be excluded with a one-line reason each.
   - Do the same for event types: every type in `shared/contracts` events must have a payload validator, and every validator must match an emitted type.
2. **Validators.**
   - Reuse what is sound in c15 (`git show c15-contract-tests:server/test/contracts/...`), but rebuild against today's DTOs.
   - Prefer deriving validators from the shared TypeScript types. A small hand-written structural checker, as in c15, is fine. Don't add a new runtime dependency to the web bundle; zod is server-only.
   - Checks are strict on extra fields (drift shows) and on nullability.
3. **Coverage run.**
   - For each route, make at least one real call in its happy state, as the right role. Also call every role-gated route as a member to see the 403 shape.
   - Validate the body against the contract and the error shape (`{code, message, correlationId, retryable}`).
   - Use the existing test helpers and fixtures, and seed through the API where possible.
4. **Drift report.** On failure, print a compact table: route, field, expected, got.

## Pass threshold (fixed)
- The route-inventory test lists **100 %** of registered routes as checked or excluded with a reason. Adding a dummy route in a test makes it fail (RED proof).
- Every event type has a validator. A dummy event type makes the test fail (RED proof).
- All contract checks pass on the merged tree. Any real drift found is **fixed at its cause**, server or contracts, in a separate commit with a note, or reported as a finding if fixing it would change behaviour. Never loosen the validator to make it pass.
- Full vitest passes (run through heavy.sh) and tsc is clean.
- The report lists every exclusion with its reason, plus every drift found and fixed.

## Report
`cycles/c50-report.md`.
