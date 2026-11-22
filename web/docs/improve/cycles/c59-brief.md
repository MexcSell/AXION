# c59 brief: origin-bound memory and skill records (R2-5)

**Lane:** w58 (`/home/luca/AXION-w58`, branch `c59-origin-records`), from improve-30h at the commit that adds this brief. Ports 10890–10893. E2E DB **axion_e2e17** (reused). Migration **0044** if needed.
**Sources (verified):** `phase2/research-r2.md` §R2-5, with the required changes in `phase2/research-r2-verified.md`. The "origin never rises" rule rests on a single-author preprint (C6), so **test our own rule and don't quote its 0%**. AXION skills are internal quoted data, and importing external skills stays out of scope.
**Read first:** `cycles/c41-*` (playbooks and skills: human activation, decider ≠ proposer, `trust`, `sources`) and `server/src/agents/playbooks.ts`. **Build on c41's fields, not a parallel structure.** Human-only activation already exists; don't rebuild it.

## Items (each test-first, each its own commit)
1. **Origin class.** Each lesson, playbook item or skill records its write channel: human entry, agent output, tool output, or a summary or merge of other records. It also gets an origin class derived from that channel.
   - A derived item's class is **never higher than its weakest source**, whether it comes from summarising, merging, or agreement between agent-written items.
   - Agent-side routes can never set the class to "human".
   - Tests cover every channel and a 3-level derivation chain.
2. **Contribution log.** Add an append-only log per record (who or what changed it, when, and from which sources), with all four guards plus the `axion.purge_demo` exception.
3. **Active cap.** Set a cap on active items per role. Activating past the cap is refused with a named code, and the UI explains it with a `?`.
4. **Retirement proposals (fixture-only).** When a fixture's outcome score falls below a stated floor, a retirement proposal appears. A person decides on it; nothing retires automatically. Label it in the UI as "no outcome data yet" until agents actually use skills.
5. **Contracts.** Add registry, DTO and validator entries for every new field and route. No allowlist lines.

## Pass threshold
- Items 1–5 RED → GREEN. Every c41 test passes unchanged (tightened only with a stated reason).
- Full vitest and tsc. api-c41, stage6 and improve pass. verify-all 10/10. fit-check and a11y clean.

## Report
`cycles/c59-report.md`.
