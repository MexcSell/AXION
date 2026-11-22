-- c70: down (re-runnable). Restores the 0046 run guard and re-grade check and the 0040 canonical form.
drop index if exists eval_runs_holdout_content_once;
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
     or (new.id, new.tenant_id, new.dataset_id, new.subject_version_id, new.subject_proposal_id, new.k, new.started_at, new.judge_model_family, new.evaluator_id, new.holdout_key, new.grader_name, new.grader_version)
        is distinct from (old.id, old.tenant_id, old.dataset_id, old.subject_version_id, old.subject_proposal_id, old.k, old.started_at, old.judge_model_family, old.evaluator_id, old.holdout_key, old.grader_name, old.grader_version) then
    raise exception 'eval_runs is append-only: only finished_at may be set, once';
  end if;
  select count(*) into miss from eval_run_missing(old.id);
  if miss > 0 then raise exception 'run_incomplete: eval run % is missing % result(s); it cannot be finished', old.id, miss; end if;
  return new;
end $$;

create or replace function eval_regrades_check() returns trigger language plpgsql as $$
declare r eval_runs; pa text;
begin
  select * into r from eval_runs where id = new.run_id;
  -- a re-grade is evidence, so it has a person of standing: an approved user of the tenant, who did not write the proposal under test
  if not exists (select 1 from users where id = new.created_by and tenant_id = new.tenant_id and status = 'approved') then
    raise exception 'regrader_unknown: a re-grade is recorded by an approved person of this tenant'; end if;
  if r.subject_proposal_id is not null then
    select created_by into pa from agent_version_proposals where id = r.subject_proposal_id;
    if pa = new.created_by then raise exception 'regrader_is_author: the author of a proposal cannot re-grade its runs'; end if;
  end if;
  if r.finished_at is null then raise exception 'eval run % is not finished; only a finished run can be re-graded', r.id; end if;
  if r.tenant_id <> new.tenant_id then raise exception 'a re-grade diff has the tenant of its run'; end if;
  if r.grader_name is null or (r.grader_name, r.grader_version) is distinct from (new.from_grader_name, new.from_grader_version) then
    raise exception 'a re-grade diff starts from the grader the run recorded (%, %); it names from (%, %)', r.grader_name, r.grader_version, new.from_grader_name, new.from_grader_version;
  end if;
  return new;
end $$;

-- re-spelt sha cannot buy a fresh run.
create or replace function eval_canon_config(c jsonb) returns text language sql immutable as $$
  select jsonb_build_object(
    'model', lower(btrim(coalesce(c ->> 'model', ''))),
    'skills', coalesce((select jsonb_agg(x order by x) from (select distinct btrim(e) x from jsonb_array_elements_text(case when jsonb_typeof(c -> 'skills') = 'array' then c -> 'skills' else '[]'::jsonb end) e) q), '[]'::jsonb),
    'tools', coalesce((select jsonb_agg(x order by x) from (select distinct btrim(e) x from jsonb_array_elements_text(case when jsonb_typeof(c -> 'tools') = 'array' then c -> 'tools' else '[]'::jsonb end) e) q), '[]'::jsonb))::text
$$;

alter table eval_runs disable trigger eval_runs_guard;
update eval_runs set holdout_key = null where holdout_key is not null;
update eval_runs r set holdout_key = k.key
  from (select r2.id,
               case when r2.subject_proposal_id is not null
                    then jsonb_build_array('candidate', r2.tenant_id, p.agent_id, eval_canon_config(p.candidate), r2.dataset_id)::text
                    else jsonb_build_array('base', r2.tenant_id, r2.subject_version_id, r2.dataset_id)::text end as key,
               row_number() over (partition by r2.tenant_id, r2.dataset_id, coalesce(p.agent_id, ''), coalesce(eval_canon_config(p.candidate), ''), coalesce(r2.subject_version_id::text, '') order by r2.started_at, r2.id) as rn
          from eval_runs r2
          join eval_datasets d on d.id = r2.dataset_id and d.split = 'holdout'
          left join agent_version_proposals p on p.id = r2.subject_proposal_id) k
 where r.id = k.id and k.rn = 1;
alter table eval_runs enable trigger eval_runs_guard;
alter table eval_runs drop column if exists holdout_content_key;
drop function if exists eval_canon_name(text);
