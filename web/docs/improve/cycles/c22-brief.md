# Cycle 22 (lane w20): long conversation threads load fast

## Hypothesis
In `api-stage6.mjs`, after 130 messages are posted to one thread, `page.reload()` does not commit for about 50 s.
This was measured on the integration tree, and also before the parallel lanes started, under host load around 25.
During the stall the page's main thread is busy while every server answers in milliseconds. Lanes saw it 7 of 7 times.
That is not just a slow test: a user who opens a long thread may get a frozen page.

Find what the browser spends that time on (rendering every message, the minimap, receipts, event replay after a
reload, an O(n²) merge…), and fix it in the app. Candidates: virtualise the message list (cycle 4 noted it isn't),
render only the newest page and lazy-render older ones, make merges linear, and keep the minimap cheap.

## Measure and pass threshold (fixed now)
1. **Before:** a browser script measures time from reload to interactive (composer focusable, newest message visible) for
   a thread with 130 messages and with 1,000 messages, in api mode on your lane stack. Record a CPU profile summary
   (top functions by self time) from Playwright/CDP tracing, plus host load at the time. Measure 3× each.
2. **Threshold:**
   - reload → interactive for 130 messages ≤ 3 s, and for 1,000 messages ≤ 5 s, at the host's current load (state it);
   - `api-stage6.mjs` passes 94/94, including the reload step, without changing its timeout;
   - the main-thread long tasks during the reload are listed before and after.
3. **No behaviour change:**
   - paging, gap fill and unread counts still work (`api-stage6.mjs`, `api-improve.mjs` stay green);
   - minimap, scroll position and drafts behave as before;
   - demo mode is unchanged (`verify-all`, with FAIL lines grepped).
4. Lane w6 is working on flaky checks in parallel and may touch `api-stage6.mjs`. You own the **app-side** fix; don't
   edit `api-stage6.mjs` except to add timing output.

## Lane
You are lane w20: worktree `/home/luca/AXION-w20` (branched from improve-30h at f169636, with cycles 1–3, 5 and 7 merged), port base 7000: dev 7090, e2e 7092/7093, database `axion_e2e20`, override config `/home/luca/AXION-lanes/vite-w20.config.ts`, `OUT=/tmp/axion-verify-w20` for verify-all. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly: never git stash, every heavy run goes through `heavy.sh` (vitest gets --maxWorkers=2 automatically), never dispatch subagents. **verify-all's exit code is not trustworthy yet** (lane w19 is fixing it): grep its output for FAIL and report every FAIL line honestly. Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
