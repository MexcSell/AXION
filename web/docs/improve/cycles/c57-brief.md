# c57 brief: test hygiene (H12, H13)

**Lane:** w56 (`/home/luca/AXION-w56`, branch `c57-test-hygiene`), from improve-30h at the commit that adds this brief. Ports 10690–10693. E2E DB **axion_e2e15** (reused). No migration.

## Items
1. **H12, live-region race.** The a11y api run on the batch-13 tree once reported `LIVE: page has no live region` on `/operations?tab=agents&sub=directory&view=cards`, then passed on re-run. A pass on re-run is a race. Find when the live region mounts relative to the probe, or a render path where it doesn't mount (loading, error, empty, view switch). Fix the product if a path really lacks a live region; otherwise make the probe wait on a condition. **Never loosen the check.** RED: reproduce it (CPU throttle, repeated runs; record the counts) before fixing.
2. **H13, anchors route.** c50's allowlist has an entry for `GET /operations/anchors` because it needs a configured key and file. Configure a hermetic key, domain and temp anchor file in the contract harness (never the live settings; never print the key), exercise the route, and delete the allowlist line.

## Pass threshold
- H12: the failure reproduced (or NOT REPRODUCED with attempts recorded), then 20 consecutive a11y api passes on that route under throttle. H13: the allowlist line removed and the contracts suite green.
- Full vitest, tsc, a11y in both modes clean.

## Report
`cycles/c57-report.md`.
