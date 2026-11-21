# Cycle 15 — Lane w13 · quality Q1: API contract tests

## Hypothesis
`shared/contracts` holds TypeScript types only, with no runtime validation. Reviews found drift twice (missing event
types, payload shapes). A contract test suite that calls every route and checks the JSON response against the shared
types catches drift automatically.

## Scope
1. Write runtime validators that mirror the contract types:
   - for every DTO returned by the API (missions, agents, instances, tasks, threads/messages, channels, approvals,
     notifications, org graph/revisions/proposals, scorecard, reliability, health);
   - for every SSE event payload type in `EventType`.
   Use plain TS type guards, or zod only if it's already a server dependency (check; don't add new deps). Put them
   under `server/test/contracts/`.
2. A test file that drives each route through the API (with the existing test helpers) and validates the responses.
   Also subscribe to the event stream during a scripted flow and validate every event received.
3. Fix any drift found, preferring to fix the contract type when the server is right, and list each fix in the report.

## Measure and pass threshold (fixed now)
Every route registered in `server/src/app.ts` (enumerate them programmatically) has at least one validated response.
Every `EventType` member is emitted and validated at least once, or listed as "not reachable without execution". The
whole suite stays green.

## Lane
You are lane w13: worktree `/home/luca/AXION-w13`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w13.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
