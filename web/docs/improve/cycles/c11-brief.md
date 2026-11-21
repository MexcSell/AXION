# Cycle 11 — Lane w9 · theme A4: new missions are staffed by the active organisation

## Hypothesis
New missions are staffed by a fixed fixture plan (`web/src/features/mission/staffing-plan.ts`: executor by mission
kind, planned agents by kind). This ignores the company's actual structure: cycles 1/4 let admins change the org chart,
but staffing never follows it.

After this cycle, when a real (non-DEMO) mission is staffed:
- the executor is chosen from the active org revision: the head of the department responsible for the mission kind,
  falling back to the fixture rule when there is no head;
- each planned agent's `manager_instance_id` follows its org-revision supervisor when that supervisor is in the
  mission, otherwise the executor.

Running missions never change (instances stay pinned). DEMO missions keep today's behaviour exactly.

## Measure and pass threshold (fixed now)
1. **Server tests:**
   - after an org proposal moves agent X under a new manager M, a newly created real mission that staffs X and M has
     X's instance under M's instance;
   - a mission created before the change keeps its old structure;
   - DEMO staffing is byte-identical to before (compare hierarchy JSON).
2. The kind → department mapping is explicit and documented, in one table.
3. A browser check (new script `web/scripts/api-c11.mjs`): an admin applies a proposal, creates a mission, and the
   hierarchy shows the new structure.
4. The whole suite, the api-mode browser checks and verify-all stay green.

## Migration
Only if needed: 0019.

## Lane
You are lane w9: worktree `/home/luca/AXION-w9`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w9.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
