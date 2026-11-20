-- Durable event log (spec §12.2). Ids commit in order (appendEvent holds an advisory xact lock),
-- so "everything after Last-Event-ID" never skips a late-committing row.
create table events (
  id bigserial primary key,
  tenant_id text not null,
  type text not null,
  mission_id text,
  seq int,
  actor_kind text not null default 'system' check (actor_kind in ('human','agent','system')),
  actor_id text not null default 'system',
  subject_kind text not null,
  subject_id text not null,
  audience text not null default 'all' check (audience in ('all','admins','user','mission')),
  audience_user text,
  payload jsonb not null default '{}'::jsonb,
  correlation_id text not null default '',
  schema_version int not null default 1,
  occurred_at timestamptz not null default now()
);
create unique index events_mission_seq on events(mission_id, seq) where mission_id is not null;
create index events_tenant_id on events(tenant_id, id);

create function events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'events is append-only';
end $$;
create trigger events_no_update before update or delete on events for each row execute function events_append_only();
create trigger events_no_truncate before truncate on events for each statement execute function events_append_only();
