-- Mission ids keep the UI's M-<n> form; the fixtures end at M-136.
create sequence mission_seq start 137;

create table missions (
  id text primary key,
  tenant_id text not null references tenants(id),
  owner_id text not null references users(id),
  shared boolean not null default false,
  status text not null check (status in ('draft','queued','planning','running','waiting_approval','verifying','paused','completed','failed','retry_queued','canceled','archived')),
  current_revision int not null default 1,
  demo boolean not null default false,
  presentation jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  deleted_at timestamptz,
  row_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index missions_tenant on missions(tenant_id) where deleted_at is null;

create table mission_revisions (
  mission_id text not null references missions(id) on delete cascade,
  revision int not null,
  title text not null,
  kind text not null,
  priority text not null check (priority in ('low','normal','high','critical')),
  text text not null,
  files jsonb not null default '[]'::jsonb,
  criteria jsonb not null default '[]'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (mission_id, revision)
);

create table mission_runs (
  id bigserial primary key,
  mission_id text not null references missions(id) on delete cascade,
  revision int not null,
  status text not null,
  execution text not null default 'disabled',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table tasks (
  id text primary key,
  tenant_id text not null references tenants(id),
  mission_id text not null references missions(id) on delete cascade,
  run_id bigint references mission_runs(id),
  title text not null,
  status text not null default 'created' check (status in ('created','ready','running','waiting_agent','waiting_user','verifying','passed','failed','retry_ready','canceled')),
  owner_agent text,
  created_at timestamptz not null default now()
);
create table task_dependencies (
  task_id text not null references tasks(id) on delete cascade,
  depends_on text not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on),
  check (task_id <> depends_on)
);

create table uploads (
  id text primary key,
  tenant_id text not null references tenants(id),
  owner_id text not null references users(id),
  sha256 text not null,
  name text not null,
  mime text not null,
  kind text not null,
  size bigint not null,
  excerpt text,
  created_at timestamptz not null default now()
);

create table idempotency_keys (
  tenant_id text not null,
  user_id text not null,
  key text not null,
  request_hash text not null,
  status int,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, key)
);
