create table tenants (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);
insert into tenants (id, name) values ('t-1', 'AXION');

create table users (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text not null,
  name_key text not null,
  pass_hash text not null,
  role text not null check (role in ('admin', 'member')),
  status text not null check (status in ('pending', 'approved', 'rejected', 'disabled')),
  avatar jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  password_changed_at timestamptz,
  unique (tenant_id, name_key)
);

create table devices (
  id text primary key,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id) on delete cascade,
  client_id text not null,
  name text not null,
  kind text not null,
  browser text not null,
  status text not null check (status in ('pending', 'approved', 'blocked')),
  added_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create table sessions (
  token_hash text primary key,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id) on delete cascade,
  device_id text references devices(id) on delete cascade,
  kind text not null check (kind in ('full', 'wait')),
  csrf text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user on sessions(user_id);

create table audit_events (
  id bigserial primary key,
  tenant_id text not null,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  subject text not null,
  result text not null,
  correlation_id text not null,
  detail jsonb not null default '{}'::jsonb
);
create index audit_events_tenant_at on audit_events(tenant_id, at desc);

create function audit_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end $$;
create trigger audit_events_no_update before update or delete on audit_events
  for each row execute function audit_events_append_only();
create trigger audit_events_no_truncate before truncate on audit_events
  for each statement execute function audit_events_append_only();
