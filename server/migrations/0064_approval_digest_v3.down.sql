-- Phase A (A3): down. This FAILS while any digest v3 row exists (the table is append-only, so such a row cannot be removed): that is deliberate.
create or replace function approval_requests_insert_guard() returns trigger language plpgsql as $$
begin
  if new.digest_version is distinct from 2 then raise exception 'approval_requests: new requests must use digest v2'; end if;
  return new;
end $$;
create or replace function approval_requests_guard() returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.mission_id is distinct from old.mission_id
     or new.agent_id is distinct from old.agent_id or new.kind is distinct from old.kind or new.risk is distinct from old.risk
     or new.payload is distinct from old.payload or new.action_digest is distinct from old.action_digest
     or new.digest_version is distinct from old.digest_version or new.task_id is distinct from old.task_id
     or new.origin is distinct from old.origin or new.target is distinct from old.target
     or new.requested_by is distinct from old.requested_by or new.expires_at is distinct from old.expires_at
     or new.rule_of_two is distinct from old.rule_of_two then
    raise exception 'approval_requests: the bound action is immutable; ask again with a new request';
  end if;
  if old.state in ('approved','denied','expired') and new.state is distinct from old.state then
    raise exception 'approval_requests: a decided request cannot change state';
  end if;
  if old.consumed_at is not null and (new.consumed_at is distinct from old.consumed_at or new.consumed_by is distinct from old.consumed_by) then
    raise exception 'approval_requests: already consumed';
  end if;
  if old.consumed_at is null and new.consumed_at is not null and old.state <> 'approved' then
    raise exception 'approval_requests: only an approved request can be consumed';
  end if;
  return new;
end $$;
alter table approval_requests drop constraint if exists approval_v3_binding_only;
alter table approval_requests drop column if exists run_caps, drop column if exists exec_profile_sha256;
alter table approval_requests drop constraint if exists approval_requests_digest_version_check;
alter table approval_requests add constraint approval_requests_digest_version_check check (digest_version in (1,2));
