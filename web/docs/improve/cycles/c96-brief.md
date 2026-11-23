# c96 brief: plan conformance and privilege checker over scripted trajectories (R6-8, part 1)

**Lane:** w94 (`/home/luca/AXION-w94`, branch `c96-plan-conformance`), from improve-30h at the commit that adds this brief. Ports 14490–14493. E2E DB **axion_e2e3** (reused; edit the lane `server/.env` after `new-lane.sh`). **A pure server module, contracts types and tests. No route, no migration, no `web/` change, no model calls.**

**Sources:**
- `phase2/research-r6.md` §R6-8 and `phase2/research-r6-verified.md` §R6-8. The verifier's limits are binding:
  - **part 1 only**: plan conformance and a privilege check over scripted trajectories. **Label propagation is out of scope**, because it can't be tested without real tools;
  - a mutation loop, if you build one, is a **regression test of the checker**, not evidence of resistance to adaptive attackers;
  - D4's split is a closer fit than a plan hash: auto-allow narrowing, require approval for expansion. Prefer it, and say so;
  - no plan-level approval digest in this slice (a later digest version change);
  - the owner sets the extra-approval bound, so report the utility cost and don't pick a target.
- The browser action contract (c37: `classifyAction`, per-action digests, the injection corpus in `browser-contract.test.ts`), the policy service's Rule-of-Two flags (c58), and the site grants origin code.

**HARD RULE:** never connect to, query or read the live `axion` database in any form.

## Items (each its own commit; thresholds and fixture design committed before the runs)
1. **Plan schema** (`shared/contracts/src/exec-plan.ts`): an ordered list of allowed calls. Each call has a tool, argument constraints (exact values, allowed-value sets, string patterns kept simple and linear, numeric bounds) and an origin from the grants. Include a canonical sha256.
2. **Checker** (`server/src/exec-plan/conformance.ts`). Given a validated plan and a proposed call (plus the trajectory so far), it returns one of:
   - `allow`: in plan;
   - `narrow-allow`: a call that is a strict narrowing of a plan call (a subset of its arguments or values), auto-allowed and recorded;
   - `needs-approval`: an expansion (a new tool, a wider argument, a new origin, out of order where order matters);
   - `deny`: a forbidden tool, or an origin outside the grants.
   Rules:
   - untrusted content can never add calls: a call whose provenance is `untrusted` and that isn't in the plan is `deny`, not `needs-approval`;
   - fail closed on anything malformed, with the snapshot discipline from c94 (no accessor re-reads);
   - linear-time matching only, and no regex built from input.
3. **Fixtures and thresholds:**
   - (a) 100% of 50 or more out-of-plan calls are denied or need approval, as specified per fixture, and 100% of in-plan calls are allowed;
   - (b) 100% of the existing c37 injection-corpus cases, turned into scripted trajectories where the injected step proposes an off-plan state-changing call, are blocked;
   - (c) the utility cost: on 20 or more benign scripted workflows, report the share that needs an extra approval, with n. Set no target.
   Optional, if time allows: a seeded mutation loop over the corpus (character, wording, indirection), reported as a regression test only.
4. **Unit tests** for each decision path and the boundaries.

## Pass threshold
- Items 1–4.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: module, contracts, tests and the report.

## Report
`cycles/c96-report.md`, in plain words: "checks a scripted agent against its approved plan; it does not test a real model; label propagation is next phase". **Deadline:** hand back by about 15:00Z.
