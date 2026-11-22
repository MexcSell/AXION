-- Phase 2 E1: evaluation data model. Datasets are frozen (hash recorded) before any run uses them; a frozen dataset's
-- cases never change; results are append-only. Nothing here runs an evaluation: these are records only.
create table eval_datasets (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text not null,
  version int not null default 1 check (version >= 1),
  content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  frozen_at timestamptz,
  split text not null check (split in ('dev','holdout')),
  created_at timestamptz not null default now(),
  unique (tenant_id, name, version),
  check (frozen_at is null or content_sha256 is not null)
);

create table eval_cases (
  dataset_id text not null references eval_datasets(id),
  case_id text not null,
  input jsonb not null,
  expected jsonb not null,
  primary key (dataset_id, case_id)
);

create table eval_runs (
  id text primary key,
  tenant_id text not null references tenants(id),
  dataset_id text not null references eval_datasets(id),
  subject_version_id uuid not null references agent_versions(id),
  k int not null check (k between 1 and 20),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index eval_runs_dataset on eval_runs(dataset_id);
create index eval_runs_subject on eval_runs(subject_version_id);

create table eval_results (
  run_id text not null references eval_runs(id),
  case_id text not null,
  attempt int not null check (attempt >= 1),
  score numeric check (score is null or (score >= 0 and score <= 100)),
  cost_units numeric not null default 0 check (cost_units >= 0),
  trace jsonb not null check (jsonb_typeof(trace) = 'object' and coalesce(jsonb_typeof(trace->'steps') = 'array', false)),
  recorded_at timestamptz not null default now(),
  primary key (run_id, case_id, attempt)
);

-- a dataset: freezing is one-way; once frozen nothing about it changes and it cannot be deleted
create function eval_datasets_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.frozen_at is not null and coalesce(current_setting('axion.purge_demo', true), '') <> 'on' then
      raise exception 'eval dataset % is frozen', old.id;
    end if;
    return old;
  end if;
  if old.frozen_at is not null then raise exception 'eval dataset % is frozen', old.id; end if;
  if new.frozen_at is not null and not exists (select 1 from eval_cases where dataset_id = old.id) then
    raise exception 'eval dataset % has no cases; it cannot be frozen', old.id;
  end if;
  return new;
end $$;
create trigger eval_datasets_guard before update or delete on eval_datasets for each row execute function eval_datasets_guard();

-- cases of a frozen dataset cannot be added, changed or removed
create function eval_cases_guard() returns trigger language plpgsql as $$
declare ds text; fz timestamptz;
begin
  ds := case when tg_op = 'DELETE' then old.dataset_id else new.dataset_id end;
  select frozen_at into fz from eval_datasets where id = ds;
  if fz is not null and not (tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on') then
    raise exception 'eval dataset % is frozen; its cases cannot change', ds;
  end if;
  if tg_op = 'UPDATE' and (new.dataset_id <> old.dataset_id) then
    raise exception 'eval case cannot move to another dataset';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger eval_cases_guard before insert or update or delete on eval_cases for each row execute function eval_cases_guard();

-- a run needs a frozen dataset of the same tenant; afterwards only finished_at may be set, once
create function eval_runs_guard() returns trigger language plpgsql as $$
declare fz timestamptz; tn text; vt text;
begin
  if tg_op = 'INSERT' then
    select frozen_at, tenant_id into fz, tn from eval_datasets where id = new.dataset_id;
    if fz is null then raise exception 'eval dataset % is not frozen; a run needs a frozen dataset', new.dataset_id; end if;
    if tn <> new.tenant_id then raise exception 'eval run tenant differs from its dataset'; end if;
    select d.tenant_id into vt from agent_versions v join agent_definitions d on d.id = v.agent_id where v.id = new.subject_version_id;
    if vt is distinct from new.tenant_id then raise exception 'eval run tenant differs from the tenant of its subject version'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
    raise exception 'eval_runs is append-only';
  end if;
  if old.finished_at is not null
     or new.finished_at is null
     or (new.id, new.tenant_id, new.dataset_id, new.subject_version_id, new.k, new.started_at)
        is distinct from (old.id, old.tenant_id, old.dataset_id, old.subject_version_id, old.k, old.started_at) then
    raise exception 'eval_runs is append-only: only finished_at may be set, once';
  end if;
  return new;
end $$;
create trigger eval_runs_guard before insert or update or delete on eval_runs for each row execute function eval_runs_guard();
create trigger eval_runs_no_truncate before truncate on eval_runs for each statement execute function instances_append_only();

-- results: attempt within 1..k, the case belongs to the run's dataset, the run is not finished; then append-only
create function eval_results_check() returns trigger language plpgsql as $$
declare r eval_runs;
begin
  select * into r from eval_runs where id = new.run_id;
  if r.finished_at is not null then raise exception 'eval run % is finished', r.id; end if;
  if new.attempt > r.k then raise exception 'attempt % is above k=% of run %', new.attempt, r.k, r.id; end if;
  if not exists (select 1 from eval_cases where dataset_id = r.dataset_id and case_id = new.case_id) then
    raise exception 'case % is not in dataset % of run %', new.case_id, r.dataset_id, r.id;
  end if;
  return new;
end $$;
create trigger eval_results_check before insert on eval_results for each row execute function eval_results_check();
create trigger eval_results_no_update before update or delete on eval_results for each row execute function instances_append_only();
create trigger eval_results_no_truncate before truncate on eval_results for each statement execute function instances_append_only();

-- no TRUNCATE on any evaluation record (same guard as the other append-only history tables)
create trigger eval_datasets_no_truncate before truncate on eval_datasets for each statement execute function instances_append_only();
create trigger eval_cases_no_truncate before truncate on eval_cases for each statement execute function instances_append_only();
