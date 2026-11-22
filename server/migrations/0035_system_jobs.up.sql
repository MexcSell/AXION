-- Improvement cycle 45 (J1): durable job records with a lease state machine. RECORDS ONLY: nothing in the API claims,
-- runs or reclaims a job, and the one kind ('noop.test') does nothing outside the database.
-- Safety properties live here, so raw SQL cannot break them:
--   * a finished job (succeeded, failed, canceled, dead) never changes again;
--   * 'leased' always has an owner, an expiry and a heartbeat; the fencing token (lease_token) only grows,
--     by exactly one on every claim and on every release of a lease (reclaim, retry, dead letter, cancel);
--   * completing or failing needs an unexpired lease (compared with the database clock).
create table system_jobs (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null,                                   -- claim order (oldest first)
  tenant_id text not null references tenants(id),
  kind text not null check (kind in ('noop.test')),
  payload_ref text check (length(payload_ref) between 1 and 512 and payload_ref ~ '^[A-Za-z0-9_.:/@#=+-]+$'),  -- opaque reference, never executable
  status text not null default 'queued' check (status in ('queued','leased','succeeded','failed','canceled','dead')),
  attempt int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  lease_owner text check (lease_owner is null or length(lease_owner) between 1 and 128),
  lease_token bigint not null default 0 check (lease_token >= 0),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 1000),
  unique (tenant_id, kind, idempotency_key),
  check (attempt between 0 and max_attempts),
  check ((status = 'leased') = (lease_owner is not null)),
  check ((status = 'leased') = (lease_expires_at is not null)),
  check (status <> 'leased' or (heartbeat_at is not null and lease_token > 0)),
  check ((status in ('succeeded','failed','canceled','dead')) = (finished_at is not null))
);
create index system_jobs_queue on system_jobs(kind, seq) where status = 'queued';
create index system_jobs_leases on system_jobs(lease_expires_at) where status = 'leased';
create index system_jobs_tenant on system_jobs(tenant_id, status);

create function system_jobs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'system_jobs is append-only'; end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
    raise exception 'system_jobs is append-only';
  end if;
  if old.status in ('succeeded','failed','canceled','dead') then raise exception 'a finished job never changes'; end if;
  if new.id <> old.id or new.seq <> old.seq or new.tenant_id <> old.tenant_id or new.kind <> old.kind
     or new.payload_ref is distinct from old.payload_ref or new.idempotency_key <> old.idempotency_key
     or new.created_by <> old.created_by or new.created_at <> old.created_at or new.max_attempts <> old.max_attempts
  then raise exception 'a job identity never changes'; end if;
  if new.attempt < old.attempt or new.lease_token < old.lease_token or (old.cancel_requested and not new.cancel_requested)
  then raise exception 'job counters only grow'; end if;
  new.updated_at := now();
  if old.status = 'queued' then
    if new.status = 'queued' then
      if new.attempt <> old.attempt or new.lease_token <> old.lease_token then raise exception 'illegal job transition'; end if;
    elsif new.status = 'leased' then
      if old.cancel_requested then raise exception 'a job with a cancel request is not claimed'; end if;
      if new.attempt <> old.attempt + 1 or new.lease_token <> old.lease_token + 1 then raise exception 'a claim bumps attempt and token by one'; end if;
    elsif new.status = 'canceled' then
      if new.attempt <> old.attempt or new.lease_token <> old.lease_token then raise exception 'illegal job transition'; end if;
    else raise exception 'illegal job transition: queued -> %', new.status; end if;
  else -- leased
    if new.status = 'leased' then
      if new.lease_token <> old.lease_token or new.attempt <> old.attempt or new.lease_owner <> old.lease_owner then raise exception 'a lease keeps its owner, token and attempt'; end if;
    elsif new.status in ('succeeded','failed') then
      if old.lease_expires_at <= now() then raise exception 'the lease has expired'; end if;
      if new.lease_token <> old.lease_token or new.attempt <> old.attempt then raise exception 'illegal job transition'; end if;
    elsif new.status in ('queued','dead','canceled') then
      if new.lease_token <> old.lease_token + 1 or new.attempt <> old.attempt then raise exception 'releasing a lease bumps the token by one'; end if;
      if new.status = 'queued' and (old.attempt >= old.max_attempts or old.cancel_requested) then raise exception 'illegal job transition: no retry left or cancel requested'; end if;
      if new.status = 'dead' and (old.attempt < old.max_attempts or old.cancel_requested) then raise exception 'illegal job transition: dead needs max attempts'; end if;
      if new.status = 'canceled' and not old.cancel_requested then raise exception 'a leased job is canceled only after a cancel request'; end if;
    else raise exception 'illegal job transition: leased -> %', new.status; end if;
  end if;
  return new;
end $$;
create trigger system_jobs_no_edit before update or delete on system_jobs for each row execute function system_jobs_guard();
create trigger system_jobs_no_truncate before truncate on system_jobs for each statement execute function system_jobs_guard();
