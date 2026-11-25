-- Phase A (A3): approval digest v3 = v2's bound action + the execution profile hash (c94) + the run caps (c95). Records only: nothing executes.
-- v3 stays OFF until the owner approves O1b: the server writes v3 rows only when APPROVAL_DIGEST_VERSION=3. Rows of digest v1 and v2 are not touched
-- and keep verifying with their own version. The two new columns are part of the bound action: immutable, like the others.
alter table approval_requests drop constraint approval_requests_digest_version_check;
alter table approval_requests add constraint approval_requests_digest_version_check check (digest_version in (1,2,3));
alter table approval_requests
  add column exec_profile_sha256 text check (exec_profile_sha256 is null or exec_profile_sha256 ~ '^[0-9a-f]{64}$'),
  -- exactly the six cap fields and nothing else (the integer check is done in code, server/src/approvals/service.ts)
  add column run_caps jsonb check (run_caps is null or (jsonb_typeof(run_caps) = 'object'
    and run_caps ?& array['maxSteps','maxWallMs','maxToolCallsPerMinute','maxDistinctOrigins','reservedMoneyMicros','reservedTokens']
    and (run_caps - 'maxSteps' - 'maxWallMs' - 'maxToolCallsPerMinute' - 'maxDistinctOrigins' - 'reservedMoneyMicros' - 'reservedTokens') = '{}'::jsonb)),
  add constraint approval_v3_binding_only check (digest_version = 3 or (exec_profile_sha256 is null and run_caps is null));

-- the 0043 guard again, with the two new columns added to the immutable list (everything else is unchanged)
create or replace function approval_requests_guard() returns trigger language plpgsql as $$
begin
  -- the bound action never changes: a different action is a new request
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.mission_id is distinct from old.mission_id
     or new.agent_id is distinct from old.agent_id or new.kind is distinct from old.kind or new.risk is distinct from old.risk
     or new.payload is distinct from old.payload or new.action_digest is distinct from old.action_digest
     or new.digest_version is distinct from old.digest_version or new.task_id is distinct from old.task_id
     or new.origin is distinct from old.origin or new.target is distinct from old.target
     or new.requested_by is distinct from old.requested_by or new.expires_at is distinct from old.expires_at
     or new.rule_of_two is distinct from old.rule_of_two
     or new.exec_profile_sha256 is distinct from old.exec_profile_sha256 or new.run_caps is distinct from old.run_caps then
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

-- new rows are v2, or v3 (v1 exists only for rows made before 0029)
create or replace function approval_requests_insert_guard() returns trigger language plpgsql as $$
begin
  if new.digest_version is distinct from 2 and new.digest_version is distinct from 3 then raise exception 'approval_requests: new requests must use digest v2 or v3'; end if;
  return new;
end $$;
