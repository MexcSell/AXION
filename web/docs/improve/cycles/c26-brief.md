# Cycle 26 (lane w24): virtualise long conversation threads (P2)

## Hypothesis
Cycle 22 fixed the reload stall, but a live burst into a 1,000-message open thread still keeps the page busy: each 60 ms
batch takes 0.4–1.6 s to render, because every message is in the DOM. Render only the visible window of rows, plus an
overscan, so the cost no longer grows with thread length.

Constraints:
- the minimap still shows every message;
- scroll-to-bottom, keeping the reader's position when older pages load, gap fill, unread and "N new" counters, and
  keeping drafts all behave as before;
- screen readers can still reach every message. Use an accessible pattern: `role=log` with messages added in order, and
  rows stay in the accessibility tree via aria-setsize/aria-posinset, or a "load more" approach. Explain your choice.

## Measure and pass threshold (fixed now)
1. **Before:** using cycle 22's `web/scripts/api-c22.mjs` method, measure main-thread busy time during a live burst of
   200 messages into an open thread that already holds 1,000. Record the long-task total and the worst task, 3 runs each.
2. **After:**
   - long-task total during the burst at most 30% of before;
   - worst single task ≤ 200 ms;
   - reload → interactive stays within cycle 22's thresholds (3 s / 5 s).
3. **No behaviour change:**
   - api-c22, api-stage6 (94/94), api-improve and api-c09 stay green;
   - a11y-check (from c16/c23) shows 0 violations;
   - verify-all passes every step;
   - the minimap still counts every message.
4. **api-stage6 counts one DOM row and one minimap block per message.** You may update the DOM-row count check to assert
   the *intent* (every message reachable: scroll to the top and assert the first message renders, and assert the total
   count from the minimap or an aria-setsize). Show that it still fails when a message is actually missing (forced
   defect). Never just delete the check.

## Lane
You are lane w24: worktree `/home/luca/AXION-w24` (branched from improve-30h at a67d2dd: cycles 1–7, 11, 13, 16, 18, 6, 21, 22, 23 merged), port base 7400: dev 7490, e2e 7492/7493, database `axion_e2e24`, override config `/home/luca/AXION-lanes/vite-w24.config.ts`, `OUT=/tmp/axion-verify-w24`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (never git stash; every heavy run through heavy.sh; never dispatch subagents; commit work-in-progress often). verify-all's exit code is now honest (c21 merged): every step must pass. api-stage6 must be 94/94 (c22 merged). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
