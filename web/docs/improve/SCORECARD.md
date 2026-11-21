# Scorecard (measured numbers only)

All numbers below are code-level measurements. Agents don't execute yet, so there is no agent or company performance
number to compare. The loop builds the measurement for those (see LOG.md); it does not claim gains in them.

| Measure | Baseline (2026-11-21 ~11:40Z, b621fbb) | Final |
|---|---|---|
| Server tests | 219/219 in 17 files, 16.6 s | |
| Browser checks (api mode) | auth 15/15 · missions 23/23 · stage 6 94/94 | |
| Demo-mode suite (verify-all) | green (dialog smoke 104/0) | |
| Production build | main chunk 543.9 kB (176.5 kB gzip) · Chips chunk 343.3 kB (118.8 kB gzip) · dist 2.28 MB · build 2.3 s | |
| Page switch, dev (perf-nav, headless software rendering) | median 163 ms · idle 60 fps | |
| Agents › Proposals in api mode | DEMO (changes nothing) | |
| Company scorecard rows backed by recorded data | 0 | |
| Agent metrics backed by recorded data | 0 (all DEMO) | |
