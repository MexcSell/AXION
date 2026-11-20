create table approval_requests (
  id text primary key,
  tenant_id text not null references tenants(id),
  mission_id text not null references missions(id) on delete cascade,
  agent_id text not null,
  kind text not null,
  title text not null,
  detail text not null default '',
  risk text not null check (risk in ('R0','R1','R2','R3','R4')),
  payload jsonb not null default '{}'::jsonb,
  action_digest text not null,
  state text not null default 'pending' check (state in ('pending','approved','denied','expired','revoked')),
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index approval_requests_mission on approval_requests(mission_id);

create table approval_decisions (
  id bigserial primary key,
  approval_id text not null references approval_requests(id) on delete cascade,
  decision text not null check (decision in ('approved','denied')),
  reason text not null default '',
  digest text not null,
  decided_by text not null,
  decided_at timestamptz not null default now()
);
create function approval_decisions_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from approval_requests where id = old.approval_id) then return old; end if; -- cascade from a purged mission
  raise exception 'approval_decisions is append-only';
end $$;
create trigger approval_decisions_no_update before update or delete on approval_decisions for each row execute function approval_decisions_append_only();

create table notifications (
  id text primary key,
  tenant_id text not null references tenants(id),
  audience text not null check (audience in ('all','admins','user','mission')),
  audience_user text,
  mission_id text,
  severity text not null check (severity in ('critical','warning','info','success')),
  category text not null check (category in ('mission','agent','system','approval','evolution')),
  title text not null,
  body text not null default '',
  route text,
  actionable boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_tenant on notifications(tenant_id, created_at desc);
create sequence notification_seq;

-- read state per user; notice ids may also be the DEMO fixture ids (N-1 …)
create table notification_reads (
  tenant_id text not null,
  user_id text not null references users(id) on delete cascade,
  notice_id text not null,
  read_at timestamptz not null default now(),
  primary key (tenant_id, user_id, notice_id)
);
