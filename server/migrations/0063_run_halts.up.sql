-- Phase A (A2): the durable halt record that c95's run-caps checker reads. Records only: nothing executes and no run exists yet.
-- Append-only. A halt is a row with halted=true; a LIFT is a new row with halted=false, never an update. For each (tenant, scope, target) the row with
-- the highest id decides. The effective halt of a run looks at the global scope first, then the run's task class, then the run itself.
create table run_halts (
  id bigserial primary key,
  tenant_id text not null,
  scope text not null check (scope in ('global','class','run')),
  target text not null check (length(target) <= 120),
  halted boolean not null,
  reason text not null check (length(reason) between 1 and 500),
  created_by text not null check (length(created_by) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint run_halts_target_shape check ((scope = 'global' and target = '') or (scope <> 'global' and length(target) >= 1))
);
create index run_halts_latest on run_halts(tenant_id, scope, target, id desc);

create function run_halts_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'run_halts is append-only: lift a halt with a new row';
end $$;
create trigger run_halts_no_update before update or delete on run_halts for each row execute function run_halts_append_only();
create trigger run_halts_no_truncate before truncate on run_halts for each statement execute function run_halts_append_only();
