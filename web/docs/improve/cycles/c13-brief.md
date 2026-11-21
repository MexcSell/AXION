# Cycle 13 — Lane w11 · theme C3: an honest experiment verdict (scaffold for agent evaluation)

## Hypothesis
Cycle 5 adds agent version proposals, but there is no rule for when a candidate counts as *better*. Build the
evaluation core the spec requires, before any execution exists, so it can't be bent later. It is a pure, well-tested
function that compares a baseline and a candidate on the **same** cases.

Pattern: subnet-scout `evolution.py` 125-172. "Verified" requires all of these:
- n ≥ `minCases`;
- mean delta ≥ `margin`;
- losses ≤ wins;
- zero failed candidate answers;
- an evaluator different from the author;
- the same dataset hash for both runs.

It returns `{verified, reasons[]}`, where every unmet rule is a human-readable reason, plus the smallest detectable gain
for the given n and spread.

## Measure and pass threshold (fixed now)
1. `server/src/evolution/verdict.ts` with a pure `verdict(input)` and at least 25 unit tests covering every rule, its
   boundary, and the reasons text.
   - Thresholds come from an explicit, versioned policy object. The policy can't be changed by the candidate's author.
   - Model this as a parameter whose source is recorded in the output.
2. Optional, only if it stays small: `POST /evaluations/verdict` for admins, which computes and stores nothing; or a
   read-only "Evaluation rules" help entry. **No fake evaluation data anywhere.**
3. The execution guard test stays green, and nothing in this module calls a model or a process.
4. The whole suite stays green.

## Migration
None expected (0021 reserved).

## Lane
You are lane w11: worktree `/home/luca/AXION-w11`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w11.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
