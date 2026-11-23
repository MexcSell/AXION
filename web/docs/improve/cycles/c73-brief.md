# c73 brief: polish bundle (P2c, H18, P4c, H15)

**Lane:** w71 (`/home/luca/AXION-w71`, branch `c73-polish`), from improve-30h at the commit that adds this brief. Ports 12190–12193. E2E DB **axion_e2e16** (reused). No migration.
**Source:** BACKLOG rows P2c, H18, P4c and H15. Read them in full, plus the reviews they cite (c55, c69, c56, c60).

## Items (each test-first, each its own commit)
1. **P2c: the reader is not pinned after a fast burst.**
   - After 100–200 live messages, the reader sits 15–17k px above the bottom and `pinned` is false. This was confirmed on base by the c55 review.
   - Find where the pin is lost: scroll handler or commit order.
   - Fix it, and add an api check that the reader stays pinned through a burst. RED first.
   - Don't break c55's hold-until-measured anchor. api-c26, api-c55 and api-c44 must still pass.
2. **H18: the LIVEPROBE "loading proposals" race.**
   - The probe looks for transient loading text that can finish before the probe samples it.
   - Make the probe hold the request open with route interception until it has checked the live region, as the other probes do.
   - Reproduce it first (RED by injection is fine). Never loosen the check.
3. **P4c: public-suffix snapshot age.**
   - Show the PSL snapshot date and age in System Operations health, and warn past 90 days.
   - Refreshing stays a reviewed commit with a new manifest. There is no refresh route.
   - Add tests for the age computation and the warning (DB time or the manifest date, never the app clock as a bound).
4. **H15: OTel export follow-ups.**
   - Allow hyphens in tool names. `SECRET_SHAPE` still rejects `sk-`/`pk-`/`rk-`, and the secret sentinel tests must still pass.
   - Reject all-digit strings of 13+ characters as identifiers.
   - Document in the export help that identifier-shaped ids and names are exported by default.

## Pass threshold
- Items 1–4 RED → GREEN, nothing loosened.
- Full vitest (serial fallback; name every failure) and tsc.
- api-c26, api-c44, api-c55, api-c22 (`SIZES=130`), api-c56, api-c60, api-stage6, flows (also at FLOWS_CPU_THROTTLE=4), a11y in both modes (20 consecutive api runs of the proposals probe under throttle), verify-all, fit-check in demo and api mode.

## Report
`cycles/c73-report.md`. Follow the LANES.md Finishing rule.
