# c84 brief: judge-calibration gate without selection bias (E1e)

**Lane:** w82 (`/home/luca/AXION-w82`, branch `c84-judge-split`), from improve-30h at the commit that adds this brief (batches through 37 merged). Ports 13290–13293. E2E DB **axion_e2e17** (reused; edit the lane `server/.env` after `new-lane.sh`). **Server and shared/contracts only: no `web/` change. No migration. No model or provider calls: everything is simulated.**
**Sources:**
- BACKLOG rows E1e and E1d;
- `cycles/c61-brief.md`, `c61-report.md`, `c61-review.md` and the c61 re-review;
- `phase2/research-r2.md` §R2-1 and its verified file;
- the c61 code: find the gate (`MIN_JUDGE_MARGIN`), the interval and the fixed 72-cell coverage grid with its NOT_MET pins.

**HARD RULE:** never connect to, query or read the live `axion` database in any form.

## Background
c61 gates a judge on its *estimated* margin (Youden J), at a 0.5 floor. That admits middling judges whose calibration sample was lucky, so conditional coverage falls to 66–93% in pinned cells. A lower confidence bound on J does **not** fix this, because it conditions on the same labels.

## Items (each its own commit)
1. **Reproduce.** Re-run c61's grid on your base, on two seeds, and show the pinned NOT_MET cells with their coverage.
2. **Remedy 1: sample splitting.** Decide eligibility on a pilot subset of the calibration labels and compute the interval from the remaining labels only.
   - Choose the split fraction by a stated rule, not by tuning on the grid's outcome. Write down the rule before you run the grid, and commit it first; the commit order is the evidence.
   - Keep the fail-closed behaviour: an ineligible judge gives no interval ("not enough evidence"), never a wider guess.
3. **Remedy 3, as a comparison: a Fieller-type interval** that becomes unbounded when the margin's confidence set includes 0, with no gate.
   - Implement it as a pure function, next to the split remedy, and simulate it on the same grid and seeds.
4. **Evaluate both honestly.** For each remedy, report per cell:
   - coverage;
   - the share of judges admitted (or the share of bounded intervals);
   - the median interval width.
   Mark a cell PASS only if coverage is at least 93% with a Monte Carlo standard error stated. Remove a NOT_MET pin only for cells that reach 93% on **both** seeds under the remedy you wire in.
5. **Wire in one remedy.** Pick the remedy that meets coverage with the least loss of admitted judges, behind the existing interface, so the callers and DTO are unchanged. Keep the other as a tested pure function, documented as the alternative. If neither meets 93% in every assessed cell, wire in the better one, keep the remaining pins, and say so; NOT MET is an acceptable, honest outcome.
6. **Docs.** Add a short method note to the c61 code header and to your report: what is conditioned on, what is not, and why. Use plain words; the owner reads the report.

## Standing rules
PHASE2.md "Standing rules for every Wave 5+ brief" apply. Seeds are fixed and printed. Print the simulation size and run time next to every result.

## Pass threshold
- Item 1 shown.
- Items 2–3 implemented, with tests: the pure functions have unit tests, including the unbounded case and a degenerate all-agree sample.
- Item 4 table complete for both seeds.
- Item 5 wired, with the existing c61 tests green, except the pins it honestly removes.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: no `web/` and no migration.

## Report
`cycles/c84-report.md`. Follow the LANES.md Finishing rule. **Deadline:** hand back by about 12:30Z.
