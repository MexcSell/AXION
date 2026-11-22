# c33 brief: failure-mode tagging (Phase 2 · Wave 2 · E3)

**Lane:** w31 (ports 8190 / 8191 / 8192–8193; e2e DB **axion_e2e5**, already set in server/.env). Migration **0028**.
**Source:** MAST, "Why Do Multi-Agent LLM Systems Fail?" arXiv 2503.13657 (verified: 1,600+ annotated traces; 14 failure modes in 3 categories). **Before you encode the taxonomy, fetch the paper (https://arxiv.org/abs/2503.13657 and its HTML or PDF) and copy the 3 category names and 14 mode names exactly, with their IDs.** If you can't verify them, encode only what you verified and say so in the report. Never write mode names from memory.

## Hypothesis
Today a failed or retried task says nothing about *why*. Without a shared vocabulary, failures can't be counted, so the organisation can't learn from them. With a fixed, versioned taxonomy (MAST), people can tag failures now and agents later, and the scorecard can show counts with n.

## Build (test-first)
1. Migration 0028:
   - `failure_tags` (id, tenant_id, subject_kind 'task'|'task_attempt'|'message'|'mission', subject_id, taxonomy_version, mode_id, note, tagged_by, tagged_by_kind 'user'|'agent', status 'proposed'|'confirmed'|'rejected', created_at, decided_by, decided_at).
   - Append-only history: a decision is a new row, or a once-only status change enforced by trigger. Follow existing trigger patterns, including the TRUNCATE guard and the purge_demo exception.
   - A tag made by an agent stays `proposed` until a human confirms it. The research flags taxonomy labels as subjective.
2. `server/src/failures/`:
   - the taxonomy as frozen, versioned data;
   - a service that checks the subject exists, is visible to the actor (reuse VISIBLE_SQL / existing visibility helpers) and is the same tenant, and that mode_id is in the taxonomy version;
   - routes `POST /failure-tags`, `POST /failure-tags/:id/decision`, `GET /failure-tags?subject…`, and `GET /company/failure-modes?window=` (counts per mode and category with n and the window; null rather than 0 when n = 0);
   - write routes in the rate-limit map; c14's route-table test must stay green.
3. Web (small): on a failed or retried task in Mission Overview (and wherever task attempts show), a "Tag failure" action with a dialog. Pick category, then mode, with a `?` help entry giving each mode's definition from the paper; add an optional note. Show existing tags with their status. Demo mode shows labelled DEMO samples only. Follow the shared PageFrame, help registry and dialog-ledger rules (every dialog needs a tested exit).
4. Events: emit `failure.tagged` and `failure.decided` with the right audience.

## Pass threshold (fixed)
- Every failed or retried task in the e2e seed can carry a tag (browser check `web/scripts/api-c33.mjs`: tag one, confirm it, see the count go to 1 with n shown).
- Server tests: unknown mode → 400; another tenant's or an invisible subject → 404; an agent tag stays proposed; double decision → 409; counts are exact on a fixture with known tags, with n and window; null when n = 0.
- The taxonomy matches the paper: the report quotes where each name came from.
- server tsc and vitest green; web tsc; api-flows, api-stage6 and the a11y check have no new violations; dialog-smoke ledger includes the new dialog; fit-check is still ALL FIT.

## Report
`cycles/c33-report.md`, with screenshots of the dialog and the counts.
