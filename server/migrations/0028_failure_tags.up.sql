-- Improvement cycle 33: failure-mode tags (MAST taxonomy, arXiv 2503.13657v3). A person or an agent tags a failed task, a task
-- attempt, a message or a mission with one failure mode of a fixed, versioned taxonomy (the list lives in code, the tag keeps
-- the version it was made under). Every tag starts 'proposed': the research flags the labels as subjective, so a person
-- confirms or rejects it, once. Only confirmed tags are counted. The row is append-only except that single decision.
-- mission_id is the mission the subject belongs to (task, attempt, message and mission all resolve to one): it carries the
-- visibility rule, the DEMO filter, the event audience and the demo purge cascade (subject_id is polymorphic, no foreign key).
create table failure_tags (
  id text primary key,                                    -- 'FT-' + 128 random bits
  tenant_id text not null references tenants(id),
  mission_id text not null references missions(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('task','task_attempt','message','mission')),
  subject_id text not null check (length(subject_id) between 1 and 120),
  taxonomy_version text not null check (length(taxonomy_version) between 1 and 64),
  mode_id text not null check (mode_id ~ '^FM-[0-9]+\.[0-9]+$'),
  note text check (note is null or length(note) <= 1000),
  tagged_by text not null,                                -- user id, or agent instance id
  tagged_by_kind text not null check (tagged_by_kind in ('user','agent')),
  status text not null default 'proposed' check (status in ('proposed','confirmed','rejected')),
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  self_confirmed boolean not null default false,          -- confirmed by the person who tagged it (a one-person tenant can do this; it stays visible)
  check ((status = 'proposed') = (decided_at is null)),
  check (not self_confirmed or status = 'confirmed'),
  check ((status = 'proposed') = (decided_by is null))
);
-- the same mode is not proposed or confirmed twice on one subject (a rejected tag may be made again)
create unique index failure_tags_live on failure_tags(tenant_id, subject_kind, subject_id, taxonomy_version, mode_id) where status <> 'rejected';
create index failure_tags_subject on failure_tags(tenant_id, subject_kind, subject_id, created_at desc);
create index failure_tags_mission on failure_tags(mission_id, created_at desc);
create index failure_tags_tenant on failure_tags(tenant_id, created_at desc);

-- Append-only: no TRUNCATE, no DELETE (the one exception is the cascade of a demo purge, axion.purge_demo, set by clearDemo
-- only), and the one UPDATE allowed is the decision: proposed -> confirmed or rejected, once, filling decided_by and decided_at.
create function failure_tags_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'failure_tags is append-only'; end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
    raise exception 'failure_tags is append-only';
  end if;
  if old.status <> 'proposed' then raise exception 'a decided failure tag never changes'; end if;
  if new.status = 'proposed' or new.decided_by is null or new.decided_at is null then raise exception 'a failure tag can only be decided'; end if;
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.mission_id is distinct from old.mission_id
     or new.subject_kind is distinct from old.subject_kind or new.subject_id is distinct from old.subject_id
     or new.taxonomy_version is distinct from old.taxonomy_version or new.mode_id is distinct from old.mode_id
     or new.note is distinct from old.note or new.tagged_by is distinct from old.tagged_by
     or new.tagged_by_kind is distinct from old.tagged_by_kind or new.created_at is distinct from old.created_at
  then raise exception 'a failure tag can only be decided'; end if;
  if new.self_confirmed is distinct from (new.status = 'confirmed' and old.tagged_by_kind = 'user' and new.decided_by = old.tagged_by)
  then raise exception 'self_confirmed must record whether the tagger confirmed their own tag'; end if;
  return new;
end $$;
create trigger failure_tags_no_edit before update or delete on failure_tags for each row execute function failure_tags_guard();
create trigger failure_tags_no_truncate before truncate on failure_tags for each statement execute function failure_tags_guard();
