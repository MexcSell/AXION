# Cycle 12 — Lane w10 · theme B2: throughput and trend against the previous period

## Hypothesis
The cycle 2 scorecard shows one window but no direction. An owner wants to know whether things are improving. Add an
honest comparison with the previous equal-length window for every scorecard row: the previous value, its n, and a
trend that is **null whenever either period lacks enough evidence**. Never show a fake delta. Add weekly throughput:
missions started and finished per week for the last 8 weeks, as counts with no ratios.

Pattern: subnet-scout `analytics.py` 58-70 (trend only when both periods have validated work).

## Measure and pass threshold (fixed now)
1. **Server:**
   - `GET /company/scorecard` rows gain `{previous: {value|null, n}, trend: 'up'|'down'|'flat'|null}`;
   - new `GET /company/throughput?weeks=8` returns weekly counts;
   - both use `VISIBLE_SQL`, the tenant filter and DEMO exclusion exactly like cycle 2;
   - pure-function tests cover the trend rules (null when either n is below threshold; flat within ±1 point), plus
     route privacy tests.
2. **Web (api mode):**
   - the Overview scorecard panel shows the previous value and a trend arrow only when the trend is non-null, and the
     `?` help explains the rule;
   - a small weekly throughput chart uses the existing custom SVG chart components;
   - the Overview one-screen rule holds: `node scripts/ov-fit.mjs` gives NO SCROLL in demo and api mode.
3. A new browser check (`web/scripts/api-c12.mjs`): a fresh database shows no arrows; the throughput chart matches the
   server counts.
4. The whole suite and verify-all stay green.

## Lane
You are lane w10: worktree `/home/luca/AXION-w10`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w10.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
