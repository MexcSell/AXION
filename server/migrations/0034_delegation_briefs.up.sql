-- c42 (Phase 2, O2): the typed brief of a delegation. Append-only: a change is a new row that supersedes the old one.
-- Legacy delegations (mission_delegations rows without a brief) stay as they are and render as "no brief (legacy)".
create table delegation_briefs (
  seq bigserial unique,
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id),
  mission_id text not null references missions(id) on delete cascade,
  task_id text,
  from_id text not null,                                   -- a user id, or an agent instance id
  from_kind text not null check (from_kind in ('user','agent')),
  to_instance text not null references agent_instances(id) on delete cascade,
  to_agent text not null,
  brief jsonb not null check (jsonb_typeof(brief) = 'object'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),  -- over the canonical JSON of `brief`
  parent_brief_id uuid references delegation_briefs(id) on delete cascade,
  supersedes_id uuid references delegation_briefs(id) on delete cascade,
  depth int not null check (depth between 1 and 3),        -- the cap lives in code too (frozen policy); this is the last line
  simulated boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  check ((parent_brief_id is null) = (depth = 1))
);
create index delegation_briefs_mission on delegation_briefs(mission_id, seq);
create index delegation_briefs_to on delegation_briefs(to_instance, seq desc);
create index delegation_briefs_task on delegation_briefs(task_id) where task_id is not null;

-- Same pattern as 0007: the one allowed DELETE is the cascade of a demo purge (axion.purge_demo, set by clearDemo).
create function delegation_briefs_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger delegation_briefs_no_update before update or delete on delegation_briefs for each row execute function delegation_briefs_append_only();
create trigger delegation_briefs_no_truncate before truncate on delegation_briefs for each statement execute function delegation_briefs_append_only();
