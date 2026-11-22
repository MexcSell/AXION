-- c35 approval binding v2: the digest covers tenant, mission, task, kind, origin, target, payload, tier, requester and expiry.
-- Old rows keep digest_version 1 (the v1 digest) and are verified with it. An approval is consumed at most once.
alter table approval_requests
  add column digest_version int not null default 1 check (digest_version in (1,2)),
  add column task_id text,
  add column origin text,
  add column target text,
  add column requested_by text,
  add column consumed_at timestamptz,
  add column consumed_by text,
  add constraint approval_consumed_pair check ((consumed_at is null) = (consumed_by is null)),
  add constraint approval_consumed_only_if_approved check (consumed_at is null or state = 'approved');

create function approval_requests_guard() returns trigger language plpgsql as $$
begin
  -- the bound action never changes: a different action is a new request
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.mission_id is distinct from old.mission_id
     or new.agent_id is distinct from old.agent_id or new.kind is distinct from old.kind or new.risk is distinct from old.risk
     or new.payload is distinct from old.payload or new.action_digest is distinct from old.action_digest
     or new.digest_version is distinct from old.digest_version or new.task_id is distinct from old.task_id
     or new.origin is distinct from old.origin or new.target is distinct from old.target
     or new.requested_by is distinct from old.requested_by or new.expires_at is distinct from old.expires_at then
    raise exception 'approval_requests: the bound action is immutable; ask again with a new request';
  end if;
  -- a decided approval never goes back
  if old.state in ('approved','denied') and new.state is distinct from old.state then
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
create trigger approval_requests_guard before update on approval_requests for each row execute function approval_requests_guard();
