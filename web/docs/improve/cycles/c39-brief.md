# c39 brief: mission ledgers (Phase 2 · Wave 3 · O1)

**Lane:** w37 (from improve-30h). Ports 8790 / 8791 / 8792–8793. E2E DB **axion_e2e11**. Migration **0032**.
**Source:** Magentic-One (arXiv 2411.04468, verified in research-org-verified.md). The orchestrator keeps a **task ledger** (given or verified facts, facts to look up, facts to derive, educated guesses, and the plan) and a **progress ledger** (is the request satisfied? are we in a loop? is progress being made? who acts next, and with what instruction?), and re-plans when progress stalls. Before encoding the field names, check the paper's description (https://arxiv.org/abs/2411.04468, HTML version). Use the paper's structure but **AXION's own wording**, with attribution and a link. Don't copy sentences.

## Hypothesis
Today a mission's state is spread across tasks, messages and events. An explicit, versioned, append-only ledger gives the owner one place to see what the team believes, what it plans and whether it is progressing, and it gives future agents a structured place to write. That is the precondition for detecting loops and stalls (MAST failure modes) instead of guessing.

## Build (test-first)
1. Migration 0032:
   - `mission_ledgers`: id, tenant_id, mission_id (FK, cascade), kind 'task'|'progress', version int, body jsonb (schema-checked), author_id, author_kind, created_at, demo bool;
   - unique (mission_id, kind, version);
   - append-only: a new version is a new row; TRUNCATE and DELETE guards with the purge_demo exception.
2. Shared zod schemas:
   - task ledger: facts {given[], to_look_up[], to_derive[], guesses[]} with each item text plus optional source ref; plan steps[] {id, text, owner?, status};
   - progress ledger: satisfied bool, looping bool, progressing bool, next_speaker?, next_instruction?, notes, with a stall counter;
   - strict, with bounds.
3. Routes:
   - `GET /missions/:id/ledgers` (latest of each kind plus a version list);
   - `GET /missions/:id/ledgers/:kind/:version`;
   - `POST /missions/:id/ledgers/:kind`: humans only for now, admin or mission owner. It requires `baseVersion` and returns 409 if stale (compare-and-set). It is rate-limited, and the version number is assigned in a locked transaction.
   - Emit `ledger.updated`.
4. A pure `stallCheck(progressHistory)` that flags `stalled` after N consecutive non-progressing entries, with N in a frozen policy. A `looping` flag set twice in a row also counts. Tests use fixtures.
5. UI: Mission Overview gets a "Ledger" panel or tab, fitting one screen:
   - facts grouped by kind;
   - plan steps with status;
   - a progress strip with the latest flags and a stall badge;
   - version history with a diff between two versions;
   - an Edit dialog that saves a new version, with conflict handling on 409;
   - `?` help explaining the two ledgers and the attribution.

   DEMO missions show a clearly labelled DEMO sample ledger (seeded only for demo).

## Pass threshold (fixed)
- Tests:
  - version numbers are gap-free under 10 concurrent writers;
  - a stale baseVersion gets 409;
  - an invalid body gets 400 with paths;
  - an invisible mission gets 404;
  - append-only holds;
  - stallCheck known-answer fixtures.
- Browser check `web/scripts/api-c39.mjs`: open the ledger, edit, see v2, see the diff, then a conflicting edit from a second session shows the conflict UI.
- Server tsc and vitest green; web tsc; api-flows and api-stage6 pass; a11y clean; dialog ledger; fit-check ALL FIT.

## Report
`cycles/c39-report.md`.
