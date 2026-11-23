drop table if exists org_plan_amendments;
drop function if exists org_plan_amendments_append_only();
drop trigger if exists org_proposals_plan_lock on org_proposals;
drop function if exists org_proposals_plan_lock();
alter table org_proposals
  drop constraint if exists org_proposals_plan_sha_at_approval,
  drop constraint if exists org_proposals_plan_sha_form,
  drop constraint if exists org_proposals_plan_object,
  drop column if exists plan_sha, drop column if exists plan;
