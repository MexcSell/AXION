# c66 brief: metric-gaming guard for the scorecards (R3-4)

**Lane:** w64 (`/home/luca/AXION-w64`, branch `c66-metric-guard`). **Branched from `c54-clock-dimensions` at 78e149f.** c54 is cleared and queued as batch 21, and it owns the scorecard files you extend. Ports 11490–11493. E2E DB **axion_e2e9** (reused). Migration **0050** only if needed.

**Docs.** Read these **read-only** from `/home/luca/AXION/web/docs/improve/`:
- this brief;
- `PHASE2.md` (Wave 5 standing rules, Wave 7);
- `phase2/research-r3.md` §R3-4;
- `phase2/research-r3-verified.md` (required changes).

Read LANES.md and the B1, c08, c46 and c54 cycle files from your worktree.

**Evidence honesty.** B2's "about half of episodes" figure is a motive only; don't carry it over. Threshold (c) below is a fixture test of the flag. It is **not** evidence that the flag catches real gaming, and the report must say so.

## Items (each test-first, each its own commit)
1. **Row registry metadata.** Every scorecard, KPI and six-dimension row declares three things:
   - **(i) a counter-metric** that would rise if the primary metric were gamed. Allow an explicit **"no known counter-metric" with a reason**, rather than filler text.
   - **(ii) the quality dimensions it does not cover.**
   - **(iii) whether any input is writable by the agent or department being measured.**

   A contract test over the row registry enforces 100% coverage.
2. **Writability inventory, first.**
   - Build an inventory of which stored fields an agent identity can write: through which routes or service functions, and under which kinds.
   - **Test it against the route table**, so a new write route that touches a scorecard input fails until it's classified.
   - Item 1(iii) is derived from this inventory, never hand-typed.
3. **"Gameable" flag, display-only.** A row whose input is agent-writable is flagged "gameable", in plain words with a `?`. The promotion-input rule waits for R3-3 (owner Q13), so record it only as a note.
4. **Human-audited sample, scaffold.**
   - A periodic human audit label can be stored per row sample, as append-only records.
   - A divergence between the metric and the audit labels above a stated bar flags the row.
   - Fixture test: with a seeded 20% gamed share the flag fires at the bar in at least 95% of 1,000 seeded trials; with 0% gamed, in at most 5%. Report the measured rates and say the test is circular.
5. **UI.** Each scorecard row (the six-dimensions tab and the KPI tiles) shows its counter-metric, what it doesn't cover, and the gameable flag, through progressive disclosure: a `?` or expand, without crowding the one-screen layout at 1366×768.
6. **Contracts.** Registry, DTO and validator entries for every new field and route. No allowlist lines.

## Pass threshold
- Items 1–6 RED → GREEN.
- Every c46 and c54 test passes unchanged, or is tightened with a reason.
- Full vitest (serial fallback; name every failure) and tsc.
- api-c46, api-c06, api-stage6 and improve pass.
- verify-all 10/10, and fit-check and a11y clean in both modes.

## Report
`cycles/c66-report.md`. Follow the LANES.md Finishing rule.
