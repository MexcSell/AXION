-- records that name a proposal cannot exist without the column: they are removed first (purge flag, as clearDemo does)
select set_config('axion.purge_demo', 'on', true);
delete from eval_results where run_id in (select id from eval_runs where subject_proposal_id is not null);
delete from eval_runs where subject_proposal_id is not null;
alter table agent_version_proposals drop column override_reason;

create or replace function eval_runs_guard() returns trigger language plpgsql as $$
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
drop index eval_runs_proposal;
alter table eval_runs drop constraint eval_runs_one_subject;
alter table eval_runs drop column evaluator_id;
alter table eval_runs drop column judge_model_family;
alter table eval_runs drop column subject_proposal_id;
alter table eval_runs alter column subject_version_id set not null;

create or replace function eval_cases_guard() returns trigger language plpgsql as $$
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

drop trigger eval_datasets_guard on eval_datasets;
create or replace function eval_datasets_guard() returns trigger language plpgsql as $$
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

drop function eval_freeze_dataset(text);
drop function eval_dataset_sha(text);
drop function eval_json_bad(jsonb);
drop function eval_text_bad(text);
drop function eval_canon(jsonb);
