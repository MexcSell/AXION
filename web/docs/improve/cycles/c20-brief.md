# Cycle 20 (lane w18, theme A5): org coverage check

## Hypothesis
The owner's rules are "one agent per role, every duty unique, no teams", and every agent must have a place in the org.
Cycle 1's dry run checks for cycles, managers and orphans, but nothing tells the owner whether the **structure covers
the company's needs**. After this cycle a coverage report runs on the active org revision, and on every proposal's
proposed lines. It shows facts only:
- each role in the role catalog (`web/src/data/roles.ts` / server equivalent): covered by an active agent or **missing**;
- duplicate roles among active agents;
- departments without a head;
- managers with no reports;
- agents with no duty;
- span of control (reports per manager) with the largest span;
- depth of the chart.

## Measure and pass threshold (fixed now)
1. **Server:**
   - a pure `orgCoverage(edges, agents, roles)` with unit tests for every fact;
   - `GET /organization/coverage` (active revision) and a `coverage` block added to each proposal's dry-run result
     (cycle 1's `validateOrg` result). Coverage facts are **warnings**, never errors: they never block approval;
   - tenant scoping; tests.
2. **Web (api mode):**
   - the Proposals dry run shows coverage changes ("this proposal leaves role X uncovered" / "adds a head to Dept Y");
   - the cycle 4 History view shows coverage per revision;
   - a compact coverage card on Agents › Policies or Departments, whichever fits without breaking the one-screen rule;
   - demo mode unchanged.
   - A browser check `web/scripts/api-c20.mjs`.
3. The whole suite, verify-all and fit-check stay green.

## Lane
You are lane w18:
- worktree `/home/luca/AXION-w18`, **branched from `c04-org-history`** (cycle 4, reviewed, not yet merged; build on its
  History view);
- port base 6800: dev 6890, e2e 6892/6893;
- database `axion_e2e18`;
- override config `/home/luca/AXION-lanes/vite-w18.config.ts`.

Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly: never git stash, and route every heavy run through
`heavy.sh`. No migration expected (0024 reserved). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
