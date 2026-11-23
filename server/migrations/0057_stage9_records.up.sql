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
