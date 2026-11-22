# c41 brief: reviewed playbooks and a skill library (Phase 2 · Wave 3 · E4)

**Lane:** w39 (from improve-30h). Ports 8990 / 8991 / 8992–8993. E2E DB **axion_e2e13**. Migration **0033**.
**Sources (verified):**
- ExpeL 2308.10144: distils natural-language insights from experience and applies them;
- ACE 2510.04618: evolving playbooks through generate, reflect and curate;
- Reflexion 2303.11366;
- Voyager 2305.16291: a growing skill library;
- Agent Workflow Memory 2409.07429: reusable workflows induced from experience.

Spec invariant 5 also applies, and the spec says knowledge must be "reviewed organizational knowledge with sources, hashes, trust level, expiry and contradiction flags" (Stage 9 text).

## Hypothesis
The papers show agents improve when lessons from experience are distilled and reused. Unreviewed self-written memory is also a known injection and drift risk. A **human-curated** pipeline lets the organisation learn without letting an agent rewrite its own instructions unchecked:
- candidate lessons, each with evidence;
- review;
- a versioned per-role playbook;
- rollback.

## Build (test-first), records only; nothing executes
1. Migration 0033:
   - `lesson_candidates`: id, tenant, role or agent definition, source refs such as failure tags (c33), reviews and missions (at least 1 required), text (bounded), proposed_by (+ kind), status `proposed`|`accepted`|`rejected`|`superseded`, decided_by, decided_at, content sha256.
   - `playbooks`: id, tenant, role, version, items jsonb (ordered list of {lesson_id, text, trust 'reviewed', added_in_version}), base_version, created_by, created_at; unique (role, version).
   - `skills`: id, tenant, name, version, description, steps jsonb (declarative steps only, never code), preconditions, source refs, status `draft`|`approved`|`retired`, approved_by.
   - All three are append-only and versioned, with TRUNCATE and DELETE guards and the purge_demo exception.
2. Rules, server-side:
   - **A candidate never becomes active without a human decision.** Accepting one creates a new playbook version that includes it, under compare-and-set on base_version.
   - **The decider ≠ the proposer.** An agent can propose but never decide.
   - **Rollback** means a new version equal to an older version's items.
   - **Contradictions:** a new item whose text is flagged as conflicting with an existing item, by a simple deterministic check (same subject keywords with negation), is marked `contradiction` and needs an explicit override note.
   - Expiry: an optional `review_by` date; past it, an item shows "needs re-review".
   - Skills hold declarative steps only. Any field that looks like code (`function`, `=>`, `eval`, `<script`) gets 400.
3. Routes: list, propose, decide, playbook versions, diff and rollback; skills: propose, approve and retire. All of them check visibility, are rate-limited, audited, and emit events.
4. UI: in Agents › Development (or the role's page), a "Playbook" panel:
   - the current version's items, each with its source chips;
   - a candidates queue with Accept/Reject (the decider ≠ the proposer rule shows as disabled plus `?`);
   - version history with diff and rollback;
   - a Skills list.

   Labelled DEMO samples only in demo mode. Match the existing look; fit one screen.

## Pass threshold (fixed)
- Tests:
  - a candidate without sources → 400;
  - the proposer deciding → 403;
  - accept → new playbook version, gap-free under 10 concurrent accepts (CAS);
  - rollback creates a new version equal to the target's items;
  - a contradiction is detected on fixtures and needs an override;
  - code-like skill steps → 400;
  - append-only holds;
  - another tenant's or an invisible record → 404.
- Browser check `web/scripts/api-c41.mjs`: propose as B, accept as A, see the new version and diff, roll back, see the version after that.
- server tsc and vitest green; web tsc; api-flows and api-stage6; a11y; dialog ledger (pick dialog ids above DL-91 after grepping all lanes); fit-check ALL FIT.

## Report
`cycles/c41-report.md`.
