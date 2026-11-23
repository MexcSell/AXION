# Scorecard (measured numbers only)

All numbers below are code-level measurements. Agents don't execute yet, so there is no agent or company performance
number to compare. The loop builds the measurement for those (see LOG.md); it does not claim gains in them.

| Measure | Baseline (2026-11-21 ~11:40Z, b621fbb) | Final |
|---|---|---|
| Server tests | 219/219 in 17 files, 16.6 s | **4409 passed, 36 skipped, 0 failed** in 187 files (1 skipped), full serial run on the final tree 98fecbf (2026-11-23 ~12:15Z) |
| Browser checks (api mode) | auth 15/15 · missions 23/23 · stage 6 94/94 | auth 15/15 · flows 23/23 · stage 6 94/94 (20 of 20 runs) · api-mobile full NO FAILURES on the frozen tree (877 states / 500 dialogs on ebea695) · strict-CSP production check 31/31 · new api-c64/c65/c66/c69/c82/c88/c89 checks all PASS |
| Demo-mode suite (verify-all) | green (dialog smoke 104/0) | ALL 10 STEPS PASSED on the final tree; dialog smoke now covers 66 dialogs (the baseline's 104 counted differently: cause not confirmed) |
| Production build | main chunk 543.9 kB (176.5 kB gzip) · Chips chunk 343.3 kB (118.8 kB gzip) · dist 2.28 MB · build 2.3 s | entry chunk 107.2 kB gzip · Missions chunk 30.1 kB gzip · all JS together 669.7 kB gzip (many more features; split into route chunks) |
| Page switch, dev (perf-nav, headless software rendering) | median 163 ms · idle 60 fps | median 168 / 161 / 174 ms at load 5–7 (threshold 179 ms) · idle 60 fps |
| Agents › Proposals in api mode | DEMO (changes nothing) | recorded server data: version proposals with evidence, org change proposals with guardrail evidence and optional change plans |
| Company scorecard rows backed by recorded data | 0 | every row: a value with n and evidence, or 'not enough evidence'; 33 registry metrics with counter-metrics (6 honestly marked weak) |
| Agent metrics backed by recorded data | 0 (all DEMO) | reliability, six-dimension cells, difficulty-adjusted skill ratings and forecasts are computed from recorded data; cells that need agent execution stay empty ('not enough evidence') |
