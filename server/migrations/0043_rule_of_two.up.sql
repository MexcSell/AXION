-- c58 (Phase 2, R2-6 and R2-9): why an approval was asked, and how it was decided. Records only: nothing here changes a decision.
-- rule_of_two: the three derived flags, their sources and the rule that fired, stored with the request (c58 item 3). Immutable, like the bound action.
alter table approval_requests
  add column rule_of_two jsonb check (rule_of_two is null or jsonb_typeof(rule_of_two) = 'object');

-- the 0029 guard again, with the new column added to the immutable list (everything else is unchanged)
create or replace function approval_requests_guard() returns trigger language plpgsql as $$
begin
  -- the bound action never changes: a different action is a new request
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.mission_id is distinct from old.mission_id
     or new.agent_id is distinct from old.agent_id or new.kind is distinct from old.kind or new.risk is distinct from old.risk
     or new.payload is distinct from old.payload or new.action_digest is distinct from old.action_digest
     or new.digest_version is distinct from old.digest_version or new.task_id is distinct from old.task_id
     or new.origin is distinct from old.origin or new.target is distinct from old.target
     or new.requested_by is distinct from old.requested_by or new.expires_at is distinct from old.expires_at
     or new.rule_of_two is distinct from old.rule_of_two then
    raise exception 'approval_requests: the bound action is immutable; ask again with a new request';
  end if;
  -- a decided or expired approval never goes back
  if old.state in ('approved','denied','expired') and new.state is distinct from old.state then
    raise exception 'approval_requests: a decided request cannot change state';
  end if;
  -- consumed exactly once, and only while approved
  if old.consumed_at is not null and (new.consumed_at is distinct from old.consumed_at or new.consumed_by is distinct from old.consumed_by) then
    raise exception 'approval_requests: already consumed';
  end if;
  if old.consumed_at is null and new.consumed_at is not null and old.state <> 'approved' then
    raise exception 'approval_requests: only an approved request can be consumed';
  end if;
  return new;
end $$;
