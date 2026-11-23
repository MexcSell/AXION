# c82 review (H16, H22), 5891ad7..67d995d: CLEAR

Independent reviewer, 2026-11-23. This is the controller's copy of the hand-back; the reviewer's scratch file was a placeholder.

**Checks run:**
- tsc is clean.
- `api-c82-strip-effects` passed:
  - (A) a parent re-render keeps the scroll at 805 → 805;
  - (B) focused tabs sit 92 and 117 px clear of both edges.
- `api-c82-tabs` (api mode) found 0 problems on every 390 px view up to /notifications. The reviewer's own 560 s timeout under load stopped it there.
- fit-check demo at 1366×768 is ALL FIT. 1280×760 did not finish under load.

**Findings (all minor):**
1. **The pixel-equivalence claim is sound for Tabs-component strips.**
   - `base.css:290` sets `.tabs > .tab { flex: none }`. The comparison reverts it with `flex: 0 1 auto !important`, which is the old default.
   - Gaps: the comparison ignores the strips' siblings, and covers 20 paths.
   - Optional fix: screenshot the main area too.
2. **The dropped button-level scrollWidth check is a fair removal.** The label-level, spill and sibling-overlap checks still catch a real clipped label. A tolerance of about 3 px is optional.
3. **fit-check's rendered wait** needs a `.fit-scroll` or `.fit-fill` with height > 0. A timeout prints FAIL "not rendered", and the fit thresholds are unchanged. A page with neither class would now FAIL as "not rendered"; none exists today.

**Checked and OK:**
- `Tabs.tsx` depends on `[value, idKey]`, with no stale closure.
- A focused tab scrolls 32 px clear of the 28 px fade.
- `crawl-deep` retries only `net::ERR_NETWORK_CHANGED`, once; it prints RETRIED and counts it, and a second occurrence fails. Nothing is masked.
