alter table org_proposals
  drop constraint if exists org_proposals_triggers_array,
  drop constraint if exists org_proposals_text_len,
  drop constraint if exists org_proposals_lines_changed,
  drop column if exists triggers, drop column if exists baseline, drop column if exists expected_cost, drop column if exists lines_changed;
