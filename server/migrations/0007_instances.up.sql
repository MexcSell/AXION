-- Stage 6 task 2: mission-scoped agent instances, delegations, task rows.
create table agent_instances (
  seq bigserial unique,
  id text primary key,                                   -- <missionId>:<agentId>
  tenant_id text not null references tenants(id),
  mission_id text not null references missions(id) on delete cascade,
  run_id bigint references mission_runs(id) on delete set null,
  agent_id text not null references agent_definitions(id),
  agent_version_id uuid not null references agent_versions(id),   -- pinned at insert (spec 10.5)
  manager_instance_id text references agent_instances(id) deferrable initially deferred,
  state text not null default 'working' check (state in ('working','waiting','blocked','idle','verifying','done','reporting')),
  task_label text not null default '',
  progress int not null default 0 check (progress between 0 and 100),
  task_count int not null default 0,                     -- display count (fixture value on demo missions)
  pending int not null default 0,
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check (manager_instance_id is distinct from id)
);
create index agent_instances_mission on agent_instances(mission_id, seq);
create index agent_instances_agent on agent_instances(agent_id);

create table mission_delegations (
  id bigserial primary key,
  mission_id text not null references missions(id) on delete cascade,
  from_instance text not null references agent_instances(id) on delete cascade,
  to_instance text not null references agent_instances(id) on delete cascade,
  edge_kind text not null check (edge_kind in ('delegated','consults','verifies','mentors')),
  task_id text,
  simulated boolean not null default false,
  at timestamptz not null default now()
);
create index mission_delegations_mission on mission_delegations(mission_id, id);

alter table tasks
  add column owner_instance_id text references agent_instances(id) on delete set null,
  add column weight int not null default 1,
  add column criteria jsonb not null default '[]'::jsonb,
  add column evidence int not null default 0,
  add column col int not null default 0,
  add column row int not null default 0,
  add column simulated boolean not null default false;

create table task_attempts (
  id bigserial primary key,
  task_id text not null references tasks(id) on delete cascade,
  attempt_no int not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result text,
  evidence_ref text,
  unique (task_id, attempt_no)
);

-- Append-only. The one allowed delete is the cascade of a purge that sets the transaction-local flag axion.purge_demo (clearDemo only).
create function instances_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger mission_delegations_no_update before update or delete on mission_delegations for each row execute function instances_append_only();
create trigger mission_delegations_no_truncate before truncate on mission_delegations for each statement execute function instances_append_only();
create trigger task_attempts_no_update before update or delete on task_attempts for each row execute function instances_append_only();
create trigger task_attempts_no_truncate before truncate on task_attempts for each statement execute function instances_append_only();
