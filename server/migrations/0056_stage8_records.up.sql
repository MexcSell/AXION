-- c76 (R1 + A1, PARKED for owner decision Q11): Stage 8 RECORDS only. Nothing here releases, deploys, restarts, rolls back, stores a file or serves one.
-- One shared append-only guard: no UPDATE, no TRUNCATE, and no DELETE except the cascade of a demo purge (axion.purge_demo, set by clearDemo only).
create function stage8_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;

-- R1: a release is a record of what was released, by whom, and from which approvals. change_paths are stored in the normal form of releases/guard.ts.
create table releases (
  id text primary key,                                        -- 'REL-' + 128 random bits (upper-case hex)
  tenant_id text not null references tenants(id),
  version text not null check (version ~ '^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$'),
  what text not null check (length(what) between 1 and 1000),
  change_paths text[] not null check (cardinality(change_paths) between 1 and 200),
  guarded_paths text[] not null default '{}',                 -- the subset of change_paths on a guardrail path (recomputed by the trigger below)
  from_approvals text[] not null default '{}',                -- ids of the approvals the change came from (checked by the service, no foreign key: approvals are never deleted but this is a claim)
  guardrail_approval_id text references approval_requests(id),
  released_by text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);
create unique index releases_one_approval on releases(guardrail_approval_id) where guardrail_approval_id is not null;   -- one approval authorises one release
create index releases_tenant_time on releases(tenant_id, created_at desc, id);

-- The same digest the service computes (releases/guard.ts releaseDigest): sha256 of the canonical JSON {changePaths (UTF-8 byte order), tenantId, v:1, version}.
-- A test compares the two on mixed-case, accented and astral paths.
create function release_digest(t text, v text, paths text[]) returns text language sql immutable as $$
  select encode(sha256(convert_to('{"changePaths":[' || coalesce((select string_agg(to_json(p)::text, ',' order by p collate "C") from unnest(paths) p), '') || '],"tenantId":' || to_json(t)::text || ',"v":1,"version":' || to_json(v)::text || '}', 'UTF8')), 'hex')
$$;

-- The denial, in the database too, as strict as the service: a release touching a guarded path needs an approval that is a release-record request, approved R4
-- of this tenant, bound to this release's digest, decided by someone other than the recorder, spent by the recorder, not expired, and used by no other release.
-- A release not touching one carries none.
create function releases_check() returns trigger language plpgsql as $$
declare g text[]; a approval_requests;
begin
  select coalesce(array_agg(p order by p collate "C"), '{}') into g from unnest(new.change_paths) p where lower(normalize(p, NFKC)) ~ '(^|/)(polic(y|ies)|approvals?|audit[a-z_-]*|locks?|migrations?|migrate|guardrails?|metric-audits?)([/._-]|$)';
  if (select coalesce(array_agg(p order by p collate "C"), '{}') from unnest(new.guarded_paths) p) is distinct from g then raise exception 'release guarded_paths do not match its change_paths'; end if;
  if cardinality(g) = 0 then
    if new.guardrail_approval_id is not null then raise exception 'a release that touches no guarded path carries no guardrail approval'; end if;
    return new;
  end if;
  if new.guardrail_approval_id is null then raise exception 'release touches guarded paths and needs a bound R4 approval'; end if;
  select * into a from approval_requests where id = new.guardrail_approval_id;
  if a.id is null or a.tenant_id <> new.tenant_id or a.risk <> 'R4' or a.state <> 'approved' then raise exception 'the guardrail approval must be an approved R4 request of this tenant'; end if;
  if a.kind <> 'release-record' then raise exception 'the guardrail approval must be a release-record request, not another kind of R4 request'; end if;
  if a.payload->>'releaseDigest' is distinct from release_digest(new.tenant_id, new.version, new.change_paths) then raise exception 'the guardrail approval is not bound to this release'; end if;
  -- a release needs a second person: whoever decided the R4 request cannot be the one recording the release
  if exists (select 1 from approval_decisions d where d.approval_id = a.id and d.decision = 'approved' and d.decided_by = new.released_by) then raise exception 'the guardrail approval was decided by the person recording the release'; end if;
  if a.consumed_at is null or a.consumed_by is distinct from new.released_by then raise exception 'the guardrail approval must be spent (consumed) by the recorder with the record'; end if;
  if a.expires_at <= now() then raise exception 'the guardrail approval expired'; end if;
  return new;
end $$;
create trigger releases_check before insert on releases for each row execute function releases_check();
create trigger releases_no_edit before update or delete on releases for each row execute function stage8_append_only();
create trigger releases_no_truncate before truncate on releases for each statement execute function stage8_append_only();

-- The last-good pointer and the rollback-target records are one append-only log of marks. The pointer is the newest last_good mark; a rollback_target
-- mark says "if this release is ever rolled back, the known-good one to return to is target_release_id". Recording a mark moves nothing and runs nothing.
create table release_marks (
  id bigint generated always as identity primary key,
  tenant_id text not null references tenants(id),
  release_id text not null references releases(id) on delete cascade,
  kind text not null check (kind in ('last_good','rollback_target')),
  target_release_id text references releases(id) on delete cascade,
  marked_by text not null,
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  check ((kind = 'rollback_target') = (target_release_id is not null)),
  check (target_release_id is distinct from release_id)
);
create index release_marks_tenant on release_marks(tenant_id, kind, id desc);
-- A mark stays inside its releases' tenant, even for an insert that bypasses the service (the same check artifact_versions has).
create function release_marks_check() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from releases r where r.id = new.release_id and r.tenant_id = new.tenant_id) then raise exception 'release mark tenant does not match its release'; end if;
  if new.target_release_id is not null and not exists (select 1 from releases r where r.id = new.target_release_id and r.tenant_id = new.tenant_id) then raise exception 'release mark tenant does not match its target release'; end if;
  return new;
end $$;
create trigger release_marks_check before insert on release_marks for each row execute function release_marks_check();
create trigger release_marks_no_edit before update or delete on release_marks for each row execute function stage8_append_only();
create trigger release_marks_no_truncate before truncate on release_marks for each statement execute function stage8_append_only();

-- A1: artifact METADATA and immutable versions. No content is stored here or anywhere by this migration: there is no bytea, large object, path or URL column,
-- and the routes (artifacts/routes.ts) record only what a person or agent CLAIMS about a file: its sha256, size, media type and producer.
-- Deferred on purpose (needs file storage, which is not built): signed download tickets. Their data model would be an append-only artifact_tickets table
-- (id, artifact_id, version, issued_to, issued_at, expires_at by the DB clock, single use consumed_at) signed with a server-held key. Without stored bytes
-- a ticket opens nothing, and a ticket route is a download route, so none exists. Decide it with the storage backend (owner approval).
create table artifacts (
  id text primary key,                                        -- 'ART-' + 128 random bits (upper-case hex)
  tenant_id text not null references tenants(id),
  name text not null check (length(name) between 1 and 200),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create trigger artifacts_no_edit before update or delete on artifacts for each row execute function stage8_append_only();
create trigger artifacts_no_truncate before truncate on artifacts for each statement execute function stage8_append_only();

create table artifact_versions (
  artifact_id text not null references artifacts(id) on delete cascade,
  version int not null check (version >= 1),
  tenant_id text not null references tenants(id),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 1099511627776),   -- at most 1 TiB, so the number is exact in JSON
  media_type text not null check (media_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$'),
  producer text not null check (length(producer) between 1 and 120),                      -- who or what made the file: a claim, not a foreign key
  producer_kind text not null check (producer_kind in ('user','agent','system')),
  recorded_by text not null,                                                              -- the signed-in person who recorded it
  created_at timestamptz not null default now(),
  primary key (artifact_id, version)
);
create index artifact_versions_tenant on artifact_versions(tenant_id, created_at desc);

-- Versions are numbered 1, 2, 3 without a gap, and stay in their artifact's tenant, even for an insert that bypasses the service.
create function artifact_versions_check() returns trigger language plpgsql as $$
declare a artifacts; last int;
begin
  select * into a from artifacts where id = new.artifact_id;
  if a.id is null or a.tenant_id <> new.tenant_id then raise exception 'artifact version does not match its artifact'; end if;
  select coalesce(max(version), 0) into last from artifact_versions where artifact_id = new.artifact_id;
  if new.version <> last + 1 then raise exception 'artifact versions must be added in sequence (next is %)', last + 1; end if;
  return new;
end $$;
create trigger artifact_versions_check before insert on artifact_versions for each row execute function artifact_versions_check();
create trigger artifact_versions_no_edit before update or delete on artifact_versions for each row execute function stage8_append_only();
create trigger artifact_versions_no_truncate before truncate on artifact_versions for each statement execute function stage8_append_only();
