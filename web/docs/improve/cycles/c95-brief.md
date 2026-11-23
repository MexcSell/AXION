# c95 brief: run budget and halt checker, pure (R6-5, first slice)

**Lane:** w93 (`/home/luca/AXION-w93`, branch `c95-run-caps`), from improve-30h at the commit that adds this brief. Ports 14390–14393. E2E DB **axion_e2e14** (reused; edit the lane `server/.env` after `new-lane.sh`). **A pure server module, a fake executor for tests, and contracts types. No route, no migration, no `web/` change, no model calls.**

**Sources:**
- `phase2/research-r6.md` §R6-5 and `phase2/research-r6-verified.md` §R6-5. The verifier's limits are binding:
  - no evidence claim: this is an engineering control;
  - the "stopped within the stated bound" bound must be **written down and committed before** the fixtures run;
  - no approval-digest binding of caps (a later digest version change);
  - the halt-record table belongs to a later lane, so this slice takes the halt state as an input.
- The job lease code (c45: lease fencing, `requestCancel`, SQL-clock leases) shows the primitives a future enforcement would use. Don't change them.

**HARD RULE:** never connect to, query or read the live `axion` database in any form.

## Items (each its own commit; the bound and the fixture design are committed before running them)
1. **Caps schema** in `shared/contracts/src/run-caps.ts`: per-run budgets for steps, wall time, tool calls per minute, distinct origins, and money and tokens as **pre-reserved** amounts. Plus a per-class circuit-breaker setting.
2. **Pure checker** `server/src/jobs/run-caps.ts`. Before each step it returns continue, or stop with a reason, given:
   - the caps;
   - the counters so far;
   - the proposed step (tool, origin, its cost estimate);
   - a halt flag;
   - a monotonically increasing fencing token.
   Rules:
   - a step with a stale fencing token is refused;
   - after a halt, every step is refused;
   - a breach gives stop, never retry;
   - a lease without caps is refused for classes marked stage 2 or 3.
3. **Fake executor** for tests, with scripted runaways: an infinite loop, a repeated failing call, a spend spike, a new origin per step, and concurrent steps after a halt. Thresholds:
   - (a) every one of 25 or more runaway fixtures is stopped at or before the cap plus one step;
   - (b) zero steps are accepted after a halt, in 100% of fixtures, including the concurrent ones (simulate the interleavings deterministically);
   - (c) the no-caps refusal.
4. **Unit tests** for each reason, the boundaries (exactly at the cap) and the fencing token.

## Pass threshold
- Items 1–4.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: the module, contracts, tests and the report.

## Report
`cycles/c95-report.md`, in plain words: "an engineering control, not evidence; nothing executes yet". **Deadline:** hand back by about 14:30Z.
