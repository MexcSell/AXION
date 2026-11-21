-- Stage 6 task 1: agent registry, immutable versions, org revision graph.
create table agent_definitions (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text not null,
  role text not null,
  dept text not null,
  duty text not null,
  parent_id text references agent_definitions(id),
  site text,
  avatar jsonb not null default '{}'::jsonb,
  description text not null default '',
  profile jsonb not null default '{}'::jsonb,   -- display-only fields (decision E2)
  status text not null default 'active' check (status in ('active','retired')),
  active_version_id uuid,
  row_version int not null default 1,
  created_by text not null,
  created_at timestamptz not null default now()
);
create unique index agent_definitions_duty on agent_definitions(tenant_id, lower(duty));
create index agent_definitions_role on agent_definitions(tenant_id, role) where status = 'active';

create table agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agent_definitions(id),
  seq int not null,
  label text not null,
  parent_version_id uuid references agent_versions(id),
  model text not null,
  skills jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  prompt_hash text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (agent_id, seq)
);
alter table agent_definitions add constraint agent_definitions_active_version
  foreign key (active_version_id) references agent_versions(id);

create table org_revisions (
  id bigserial primary key,
  tenant_id text not null references tenants(id),
  seq int not null,
  note text not null default '',
  created_by text not null,
  active_from timestamptz not null default now(),
  unique (tenant_id, seq)
);
create table org_edges (
  revision_id bigint not null references org_revisions(id),
  supervisor_id text not null references agent_definitions(id),
  subordinate_id text not null references agent_definitions(id),
  edge_type text not null default 'reports_to',
  primary key (revision_id, subordinate_id)
);

create function agents_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger agent_versions_no_update before update or delete on agent_versions for each row execute function agents_append_only();
create trigger agent_versions_no_truncate before truncate on agent_versions for each statement execute function agents_append_only();
create trigger org_revisions_no_update before update or delete on org_revisions for each row execute function agents_append_only();
create trigger org_revisions_no_truncate before truncate on org_revisions for each statement execute function agents_append_only();
create trigger org_edges_no_update before update or delete on org_edges for each row execute function agents_append_only();
create trigger org_edges_no_truncate before truncate on org_edges for each statement execute function agents_append_only();
