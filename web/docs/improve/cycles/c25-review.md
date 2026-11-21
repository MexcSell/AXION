# Cycle 25 review (independent)

Spec verdict: PARTIAL. Quality verdict: ACCEPTABLE WITH FIXES.

## Important
1. Unlisted absence checks weakened by fixed sleep -> calm() (api-improve.mjs). `calm()` waits for animations and 2 frames, not for data or events.
   - c02 "Missions list header shows no success rate" (was 600 ms after the header appears): an invented rate that arrives with the list fetch is no longer reliably caught.
   - c02 "panel still shows 3 finished (DEMO off)" after cancel (was 900 ms): a stale or wrong live re-read landing later is missed.
   - c03 "Coder-01 still says not enough evidence" after retry (was 600 ms): the re-read is only known to have started (agentReads), not rendered.
   These are absence waits, so they are not condition-convertible. They should have stayed as justified, commented absence waits (or wait on a positive signal such as the scorecard/profile response, then assert). The report's "4 absence waits" list is incomplete. Per PROCESS.md a check may not be loosened.
2. inventedNumbers misses "<number> <word>" (e.g. "4000 tokens", "12 ms latency", "3 coverage"): only a number AFTER the word (or any %) is flagged. The old rule banned the words entirely, so a figure like "4000 tokens saved" on a proposal card used to fail and now passes. selftest-guards only tests the number-after-word form. Add `\d+\s*(tokens|ms)` and number-before-word alternatives plus selftest cases.

## Minor
- DECISION_BUTTON is anchored `^(Approve|Reject|Withdraw)$`. It catches the real buttons (ServerProposals.tsx/VersionProposals.tsx use exactly these names) and the "Decision note" label is real (used by fill() at line 198), so an Approve/Reject shown to a member would still fail. A differently named decision control (e.g. "Apply") would pass; the brief asked for this narrowing, so acceptable.
- Shared guard: `requireE2eDatabase()`/`isE2eDatabaseUrl()` refuse `axion`, `axion_lane_disabled`, `axion_e2e_x`, empty, undefined (selftest proves 3 accept / 7 refuse). Only api-improve.mjs uses it, but grep shows no other api script touches the database (no pg, no E2E_DATABASE_URL), so "all api scripts" is satisfied in substance. Brief wording ("each api script has its own guard") was inaccurate; fine.
- selftest-guards.mjs is pure, covers the three guards; not wired into verify-all (check).
- Converted waits that are sound: api-flows "Enable Mina" button appears (positive state, 8 s timeout); api-stage6 `until(held.length>0, 4000)` waits for the exact route being held (until returns false on timeout, later checks then fail); scroll/anchor `calm` after a `grew` condition is fine since the page already arrived. The 4 kept absence waits (api-flows:67, stage6 3500/2500/4500) are justified and commented.
- flows.mjs Hierarchy (15f8d0b): same two locators, same text filters, same failure messages; now `.first().waitFor({timeout:8000})` -> true/false into the existing `expect`. Original was a real check (count awaited), so equivalent and strictly more robust; times out into false so failure still reported. The preceding 800 ms sleep remains (listed).
- Web: "?" label only changes before the registry loads (`entry || reg ? e.title : 'this topic'`); demo mode has the registry/entry so unchanged. featuredAgents/threadMessages: no remaining references in src or scripts. Stale-anchor fix is logically sound (recapture while loadingOlder; requestOlder still gated), but has no automated test for a slow page.
- Source diff is 4 files, small; no demo-mode behavior change found.
