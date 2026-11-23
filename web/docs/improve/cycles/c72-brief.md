# c72 brief: difficulty-adjusted skill ratings, no leaderboard (R3-7, absorbing R3-1)

**Lane:** w70 (`/home/luca/AXION-w70`, branch `c72-skill-ratings`), from improve-30h at the commit that adds this brief. Ports 12090–12093. E2E DB **axion_e2e13** (reused). Migration **0054**.
**Docs:** read `phase2/research-r3.md` §R3-7 and `phase2/research-r3-verified.md`, which list the required changes for R3-7 and R3-1.
- C1 and C2 are cited for the **shape only**. Their accuracy claims are from benchmarks and exams.
- C3 is cited only for storing pair ratings separately. Don't copy its text.
- This is **fixture-only**: agents don't execute, so real cells stay null until there's data. Keep it small.

## Items (each test-first, each its own commit)
1. **Brief fields.** Add an optional **task class** (fixed enum, plain-words labels) and an optional **difficulty** (ordinal 1–5) to the delegation brief (c42). The delegator sets them when delegating.
   - Difficulty is **gameable**, since the delegator can make tasks look hard. Classify both fields in c66's writability inventory, and add a registry note that ratings depend on them.
   - Add contract entries for both fields.
2. **Read model.** For each agent, a skill vector over task classes. Each cell is a success rate adjusted for difficulty, with an interval.
   - Use a simple, documented method, for example a stratified rate re-weighted to a fixed reference difficulty mix, with a Wilson or bootstrap interval. Name the method.
   - Cells with n < 5 are null.
   - Pair ratings (agent with a human) are stored and shown separately from solo ratings, if the data can tell them apart. If it can't, say so and don't build it.
3. **No leaderboard.**
   - Comparisons say only "distinguishable" or "indistinguishable", from interval overlap.
   - **No API or screen returns agents ordered by this rating.** Add a contract test that fails if any response sorts agents by it.
4. **Seeded simulation (threshold).** Agent A gets only easy tasks and agent B only hard ones, with equal true skill.
   - The raw-rate comparison calls A better in at least 90% of 1,000 seeded trials.
   - The adjusted comparison calls them distinguishable in at most 10%.
   - Report the measured values, and confirm on a second seed you fix before running it.
   - If the target isn't met, report NOT MET honestly.
5. **UI.** The Agent Profile's Performance tab shows the skill vector: n, interval and "not enough evidence" below 5. It never shows a rank or position.
   - Use the owner's UI rules: fit 1366×768 (api and demo fit-check), `?` help and icons.
   - A comparison view, if any, shows only distinguishable or indistinguishable.

## Pass threshold
- Items 1–5 RED → GREEN.
- Full vitest (serial fallback; name every failure) and tsc.
- A new api-c72 including the no-ordering check. api-c42, api-c66 and api-stage6 pass.
- verify-all 10/10, fit-check in demo and api mode, a11y in both modes, api-mobile.
- Migrate down/up 0054 once.

## Report
`cycles/c72-report.md`. Follow the LANES.md Finishing rule.
