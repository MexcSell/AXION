# c91 brief: skill promotion gate, pure module on synthetic data (R5-5)

**Lane:** w89 (`/home/luca/AXION-w89`, branch `c91-skill-gate`), from improve-30h at the commit that adds this brief. Ports 13990–13993. E2E DB **axion_e2e14** (reused; edit the lane `server/.env` after `new-lane.sh`). **One pure module plus tests and a fixture or simulation script. No route, no DTO, no migration, no `web/` change, no model calls.**

**Sources:**
- `phase2/research-r5.md` §R5-5 and `phase2/research-r5-verified.md` §R5-5. The verifier's limits are binding:
  - a pure module plus a gate-run results table on synthetic data only;
  - wording "tests the gate, not any skill";
  - **the held-out second probe is a requirement, not an option**;
  - don't claim support for "admission-time verification" (unseen in its source).
- Existing skills and playbooks code (c41, c59 origin records, `skill_outcomes`, c72 skill ratings) for the shapes a future caller would pass. Don't wire it in.

**HARD RULE:** never connect to, query or read the live `axion` database in any form.

## Items (each its own commit; commit the gate's constants and the fixture design before running it)
1. **Gate module** `server/src/evolution/skill-gate.ts`, pure. Input:
   - a candidate (id, the evidence task ids used to write it, a contract text);
   - per-class scores on **probe A** (the tuning probe) and **probe B** (the held-out second probe, never shown to the generator);
   - scores on a **replay** set of historical tasks per class;
   - the incumbent's scores on the same sets.
   It admits only if all of these hold:
   - (i) net gain on probe A above a stated margin;
   - (ii) net gain on probe B above a stated margin (the held-out check against gate overfitting by repeated candidates);
   - (iii) no class loses more than a stated regression budget on replay;
   - (iv) no evidence task id overlaps probe A, probe B or replay (the leakage check);
   - (v) each probe has at least a stated minimum per class; otherwise "not enough evidence".
   Return a structured decision with every reason. The constants are named, exported and documented.
2. **Repeated-candidate correction.** State how the gate handles many candidates tried against the same probe A (for example, probe B as a fresh check, plus a stated cap on the attempts per probe A before it must be refreshed). Implement the cap as a pure check on a given attempt count.
3. **Synthetic fixture set,** at least 30 candidates of these kinds: true gain, no gain with noise, harmful on one class, gain only on probe A (overfit), leaky evidence, too-small probe. Thresholds from the research file:
   - 100% of true-gain admitted;
   - 100% of harmful-on-one-class and leaky refused;
   - overfit-to-A refused by probe B in at least a stated share;
   - the no-gain false-admit rate reported against a stated bound, over two fixed seeds.
   Save the gate-run results table as a file under `cycles/`.
4. **Unit tests** for each reason path, and the boundaries (exactly at the margin, exactly at the budget).

## Pass threshold
- Items 1–4 done.
- The thresholds in item 3 met, or NOT MET stated honestly.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: the new module, its tests, the script and outputs, the report.

## Report
`cycles/c91-report.md`, in plain words: "this tests the gate, not any skill"; what each check protects against; what is still EXEC. **Deadline:** hand back by about 13:00Z.
