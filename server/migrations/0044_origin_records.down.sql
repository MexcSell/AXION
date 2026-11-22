-- Down for 0044: restores the c41 guard bodies exactly as 0033 wrote them, then removes the c59 objects.
drop trigger if exists lesson_candidates_contribution on lesson_candidates;
drop trigger if exists skills_contribution on skills;
drop function if exists contribution_trigger();
drop table if exists skill_outcomes;
drop table if exists record_contributions;
drop function if exists c59_append_only();
create or replace function lesson_candidates_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'lesson_candidates is append-only'; end if;
  if old.status in ('rejected','superseded') then raise exception 'a decided lesson candidate never changes'; end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.agent_id <> old.agent_id or new.role <> old.role or new.text <> old.text
     or new.sources <> old.sources or new.proposed_by <> old.proposed_by or new.proposed_by_kind <> old.proposed_by_kind
     or new.submitted_by is distinct from old.submitted_by or new.sha256 <> old.sha256 or new.review_by is distinct from old.review_by or new.created_at <> old.created_at
  then raise exception 'a lesson candidate can only be decided'; end if;
  if old.status = 'accepted' and (new.status <> 'superseded' or new.withdrawn_in_version is null or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at or new.decision_note is distinct from old.decision_note or new.override_note is distinct from old.override_note
     or new.accepted_in_version is distinct from old.accepted_in_version)
  then raise exception 'an accepted lesson never changes, except that a rollback can withdraw it'; end if;
  return new;
end $$;
create or replace function skills_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'skills is append-only'; end if;
  if old.status = 'retired' then raise exception 'a retired skill never changes'; end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.name <> old.name or new.version <> old.version or new.description <> old.description
     or new.steps <> old.steps or new.preconditions <> old.preconditions or new.sources <> old.sources or new.proposed_by <> old.proposed_by
     or new.proposed_by_kind <> old.proposed_by_kind or new.submitted_by is distinct from old.submitted_by or new.created_at <> old.created_at
  then raise exception 'a skill can only be approved or retired'; end if;
  if old.status = 'approved' and (new.status <> 'retired' or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at)
  then raise exception 'an approved skill can only be retired'; end if;
  return new;
end $$;
drop trigger if exists lesson_candidates_origin on lesson_candidates;
drop trigger if exists skills_origin on skills;
drop function if exists origin_before_insert();
drop function if exists origin_rank(text);
alter table lesson_candidates drop constraint lesson_origin_agent, drop constraint lesson_origin_channel, drop constraint lesson_origin_values;
alter table skills drop constraint skill_origin_agent, drop constraint skill_origin_channel, drop constraint skill_origin_values;
alter table lesson_candidates drop column origin_channel, drop column origin_class;
alter table skills drop column origin_channel, drop column origin_class;
