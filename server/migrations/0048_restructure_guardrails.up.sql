-- c64 (R3-6): restructure guardrails on organisation change proposals.
--   triggers      the triggers the proposer PICKED (a closed list); the counts behind them are computed by the server and stored in `result`
--   baseline      what the proposal is compared with ("no change", or a simple rule-based assignment), required text
--   expected_cost the expected added cost (coordination, extra hops), required text
--   lines_changed reporting lines this proposal changes (added + removed + re-pointed), so a later proposal can be held to the churn budget
--   rollback_to   for a rollback proposal, the revision it restores (null for any other); decides whether it is the exempt undo of the last change
-- Existing rows keep '' / [] / 0: their payload_sha was made without these fields and still verifies (see proposals.ts payloadSha).
alter table org_proposals
  add column triggers jsonb not null default '[]'::jsonb,
  add column baseline text not null default '',
  add column expected_cost text not null default '',
  add column lines_changed int not null default 0,
  add column rollback_to int,
  add constraint org_proposals_triggers_array check (jsonb_typeof(triggers) = 'array'),
  add constraint org_proposals_text_len check (length(baseline) <= 1000 and length(expected_cost) <= 1000),
  add constraint org_proposals_lines_changed check (lines_changed >= 0);
