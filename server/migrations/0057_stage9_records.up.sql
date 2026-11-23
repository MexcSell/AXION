-- c77 (M2, G1; PARKED for owner decision Q11): Stage 9 records only. Nothing here meters real usage, calls a model or is read by a route.
-- 1. usage_ledger: append-only usage lines. A mistake is fixed by a CORRECTION row (signed delta that points at an original), never by an update.
create table usage_ledger (
  id bigserial primary key,
  tenant_id text not null,
  subject text not null check (length(subject) between 1 and 200),
  unit text not null check (unit in ('tokens_in','tokens_out','requests','seconds')),
  quantity bigint not null,
  cost_micros bigint not null,            -- fixed-point: millionths of one currency unit, never a float
  source text not null check (length(source) between 1 and 120),
  correction_of bigint references usage_ledger(id),
  recorded_at timestamptz not null default now(),
  constraint usage_ledger_original_nonneg check (correction_of is not null or (quantity >= 0 and cost_micros >= 0))
);
create index usage_ledger_subject on usage_ledger(tenant_id, subject, unit, id);
create index usage_ledger_correction on usage_ledger(correction_of) where correction_of is not null;

-- a correction points at an ORIGINAL row of the same tenant, subject and unit (a correction is never corrected)
create function usage_ledger_check_correction() returns trigger language plpgsql as $$
declare o usage_ledger%rowtype;
begin
  if new.correction_of is null then return new; end if;
  select * into o from usage_ledger where id = new.correction_of;
  if not found then raise exception 'a correction needs an existing original row'; end if;
  if o.correction_of is not null then raise exception 'a correction must point at an original row, not at another correction'; end if;
  if o.tenant_id <> new.tenant_id or o.subject <> new.subject or o.unit <> new.unit then raise exception 'a correction must match its original tenant, subject and unit'; end if;
  return new;
end $$;
create trigger usage_ledger_correction_check before insert on usage_ledger for each row execute function usage_ledger_check_correction();

-- Append-only with the four guards (UPDATE, DELETE, TRUNCATE, and the one allowed DELETE, the demo purge, axion.purge_demo, set by clearDemo).
create function stage9_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger usage_ledger_no_update before update or delete on usage_ledger for each row execute function stage9_append_only();
create trigger usage_ledger_no_truncate before truncate on usage_ledger for each statement execute function stage9_append_only();

-- 2. model_entries: the model registry. A status change is a NEW row; the latest row per (tenant, model) counts. The family is checked against the
-- c38 vendor table in code (src/models/registry.ts), because the table is code, not data.
create table model_entries (
  id bigserial primary key,
  tenant_id text not null,
  model text not null check (length(model) between 1 and 120),
  family text not null check (length(family) between 1 and 40),
  version text not null check (length(version) between 1 and 40),
  capabilities text[] not null default '{}',
  status text not null check (status in ('active','deprecated','disabled')),
  recorded_at timestamptz not null default now()
);
create index model_entries_latest on model_entries(tenant_id, model, id desc);

-- 3. routing_policies: the routing policy as DATA (ordered rules naming preferred models). Versioned rows; the latest version of a name counts.
create table routing_policies (
  id bigserial primary key,
  tenant_id text not null,
  name text not null check (length(name) between 1 and 80),
  version int not null check (version >= 1),
  rules jsonb not null check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) between 1 and 50),
  recorded_at timestamptz not null default now(),
  unique (tenant_id, name, version)
);
create trigger model_entries_no_update before update or delete on model_entries for each row execute function stage9_append_only();
create trigger model_entries_no_truncate before truncate on model_entries for each statement execute function stage9_append_only();
create trigger routing_policies_no_update before update or delete on routing_policies for each row execute function stage9_append_only();
create trigger routing_policies_no_truncate before truncate on routing_policies for each statement execute function stage9_append_only();
