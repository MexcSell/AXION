-- Improvement cycle 39 (Phase 2, O1): mission ledgers, after the Orchestrator of Magentic-One (arXiv 2411.04468).
-- A mission keeps two kinds of ledger: 'task' (facts and plan) and 'progress' (satisfied, looping, progressing, next
-- speaker, stall counter). A save is a new row with the next version number; rows are never updated or deleted.
-- Version numbers are assigned by the writer under the mission row lock (so they are gap-free); the unique key is the backstop.
create table mission_ledgers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id),
  mission_id text not null references missions(id) on delete cascade,
  kind text not null check (kind in ('task','progress')),
  version int not null check (version >= 1),
  body jsonb not null check (jsonb_typeof(body) = 'object' and pg_column_size(body) < 65536),
  author_id text not null,
  author_kind text not null check (author_kind in ('human','agent','system')),
  created_at timestamptz not null default now(),
  demo boolean not null default false,
  unique (mission_id, kind, version)
);
create index mission_ledgers_mission on mission_ledgers(mission_id, kind, version desc);

-- Append-only. The one allowed delete is the cascade of a demo purge (the transaction-local flag axion.purge_demo, set by clearDemo only).
create function mission_ledgers_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger mission_ledgers_no_update before update or delete on mission_ledgers for each row execute function mission_ledgers_append_only();
create trigger mission_ledgers_no_truncate before truncate on mission_ledgers for each statement execute function mission_ledgers_append_only();
