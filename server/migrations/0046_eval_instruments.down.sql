-- c61: down (re-runnable: every drop is conditional). Restores the 0040 run guard.
-- c61: down (re-runnable: every drop is conditional). Restores the 0037 dataset guard and the 0040 run guard.
drop table if exists eval_attestations;
drop function if exists eval_attestations_check();
create or replace function eval_datasets_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.frozen_at is not null then raise exception 'eval dataset % cannot be created frozen; freeze it with eval_freeze_dataset', new.id; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.frozen_at is not null and coalesce(current_setting('axion.purge_demo', true), '') <> 'on' then
      raise exception 'eval dataset % is frozen', old.id;
    end if;
    return old;
  end if;
  if old.frozen_at is not null then raise exception 'eval dataset % is frozen', old.id; end if;
  if new.frozen_at is not null then
    if not exists (select 1 from eval_cases where dataset_id = old.id) then
      raise exception 'eval dataset % has no cases; it cannot be frozen', old.id;
    end if;
    if new.content_sha256 is distinct from eval_dataset_sha(old.id) then
      raise exception 'eval dataset % content hash does not match its stored cases', old.id;
    end if;
  end if;
  return new;
end $$;
drop function if exists eval_attestation_problem(jsonb);
drop function if exists eval_attestation_item_ids();
alter table eval_datasets drop column if exists attested_version;
alter table eval_datasets drop column if exists created_by;
drop table if exists eval_regrade_cases;
drop table if exists eval_regrades;
drop function if exists eval_regrade_cases_check();
drop function if exists eval_regrades_check();
create or replace function eval_runs_guard() returns trigger language plpgsql as $$
declare fz timestamptz; tn text; vt text; sp text; ag text; cfg text; key text; other eval_runs; miss int;
begin
  if tg_op = 'INSERT' then
    select frozen_at, tenant_id, split into fz, tn, sp from eval_datasets where id = new.dataset_id;
    if fz is null then raise exception 'eval dataset % is not frozen; a run needs a frozen dataset', new.dataset_id; end if;
    if tn <> new.tenant_id then raise exception 'eval run tenant differs from its dataset'; end if;
    if new.subject_version_id is not null then
      select d.tenant_id into vt from agent_versions v join agent_definitions d on d.id = v.agent_id where v.id = new.subject_version_id;
      if vt is distinct from new.tenant_id then raise exception 'eval run tenant differs from the tenant of its subject version'; end if;
      key := jsonb_build_array('base', new.tenant_id, new.subject_version_id, new.dataset_id)::text;
    else
      select tenant_id, agent_id, eval_canon_config(candidate) into vt, ag, cfg from agent_version_proposals where id = new.subject_proposal_id;
      if vt is distinct from new.tenant_id then raise exception 'eval run tenant differs from the tenant of its subject proposal'; end if;
      key := jsonb_build_array('candidate', new.tenant_id, ag, cfg, new.dataset_id)::text;
    end if;
    new.holdout_key := null;
    if sp = 'holdout' then
      select * into other from eval_runs where holdout_key = key;
      if found then
        raise exception 'holdout_rerun: holdout dataset % already has a run for this subject (run %, %); resume or finish that run, or freeze a fresh holdout dataset',
          new.dataset_id, other.id, case when other.finished_at is null then 'unfinished' else 'finished' end;
      end if;
      new.holdout_key := key;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
    raise exception 'eval_runs is append-only';
  end if;
  if old.finished_at is not null
     or new.finished_at is null
     or (new.id, new.tenant_id, new.dataset_id, new.subject_version_id, new.subject_proposal_id, new.k, new.started_at, new.judge_model_family, new.evaluator_id, new.holdout_key)
        is distinct from (old.id, old.tenant_id, old.dataset_id, old.subject_version_id, old.subject_proposal_id, old.k, old.started_at, old.judge_model_family, old.evaluator_id, old.holdout_key) then
    raise exception 'eval_runs is append-only: only finished_at may be set, once';
  end if;
  select count(*) into miss from eval_run_missing(old.id);
  if miss > 0 then raise exception 'run_incomplete: eval run % is missing % result(s); it cannot be finished', old.id, miss; end if;
  return new;
end $$;
drop function if exists eval_run_audit(text);
alter table eval_results drop constraint if exists eval_results_ungraded;
alter table eval_results drop column if exists ungraded_reason;
alter table eval_runs drop constraint if exists eval_runs_grader_both;
alter table eval_runs drop column if exists grader_version;
alter table eval_runs drop column if exists grader_name;
