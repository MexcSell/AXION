# c55 brief: thread follow-ups (P2b)

**Lane:** w54 (`/home/luca/AXION-w54`, branch `c55-thread-followups`), from improve-30h at the commit that adds this brief. Ports 10490–10493. E2E DB **axion_e2e3** (reused). No migration.
**Read first:** `cycles/c44-*` and `c26-*`, LESSONS "A performance fix can expose a latent race" and "Numbers taken at different loads aren't comparable". Code: `web/src/features/chat/ChatView.tsx` (RESTORE_HOLD_MS), `useMissionNodes`.

## Items
1. **Restore anchor.** Replace the 1 s `RESTORE_HOLD_MS` timer with "hold until every row above the anchor is measured" (with a bounded safety exit that is logged, not silent). RED: under CPU throttle, a row measured after 1 s makes the anchor drift on today's code. Keep api-c26's I2 bar (≤ 0.3 px) unchanged.
2. **Forced layout.** Remove the forced synchronous layout from `ChatView.hold`'s `scrollTop` read (about 150–175 ms in the full burst). Show the trace before and after, with load averages.
3. **Relative latency bar.** Make api-c44's 200 ms absolute bar relative to a quiet control measured in the same run, interleaved, same flags. Show it still fails on a known-bad mutation.
4. **Production number.** Measure the full-burst cost on a production build (`vite preview` on your B+91) as a secondary number next to the dev number.
5. **api-c22 N=1000 reload hang.** Try to reproduce (record attempts, load and result). Diagnose if it reproduces; otherwise record NOT REPRODUCED with the attempt count.

## Pass threshold
- Items 1–3 RED → GREEN, 4 measured, 5 recorded honestly. api-c26, api-c44, api-c22, stage6 pass. verify-all 10/10, flows (also at FLOWS_CPU_THROTTLE=4), a11y clean.

## Report
`cycles/c55-report.md`.
