-- c61 (R2-2, R2-3, R2-1): evaluation instrument records. Records and validation only: nothing here runs an evaluation or calls a model.
--
-- R2-2 instrument audit. The evidence is one single-author preprint (A6); the checks are cheap and the evidence is only the motive.
--   * a run records WHO graded it: grader_name and grader_version (both or neither; NULL = not recorded, as on every older run);
--   * a result can be UNGRADED with a reason code (the grader failed to produce a grade). That is not a failed attempt: a NULL score
--     with no reason is still a graded failure (c47/c53), a NULL score with a reason is no grade at all;
--   * episodes attempted, graded and the ungraded reasons are DERIVED from the stored results (eval_run_audit), never stored as
--     counters, because eval_runs is append-only and a counter could disagree with its rows;
--   * a RE-GRADE DIFF (eval_regrades + eval_regrade_cases) records that finished run R, graded by version A, was graded again by
--     version B, with the old and the new grade of every (case, attempt). Verdicts refuse to compare two runs whose graders differ
--     unless such a diff links them (see evolution/proposal-evidence.ts).
alter table eval_runs add column grader_name text;
alter table eval_runs add column grader_version text;
alter table eval_runs add constraint eval_runs_grader_both check (
  (grader_name is null and grader_version is null) or (btrim(coalesce(grader_name, '')) <> '' and btrim(coalesce(grader_version, '')) <> ''));

alter table eval_results add column ungraded_reason text;
alter table eval_results add constraint eval_results_ungraded check (
  ungraded_reason is null or (score is null and ungraded_reason in ('grader_timeout','grader_error','unparseable_output','no_reference','infrastructure_error','excluded_by_rule')));

create function eval_run_audit(rid text) returns table(attempted int, graded int, ungraded_reasons jsonb) language sql stable as $$
  select count(*)::int,
         (count(*) filter (where ungraded_reason is null))::int,
         coalesce((select jsonb_object_agg(r, n) from (select ungraded_reason r, count(*)::int n from eval_results where run_id = rid and ungraded_reason is not null group by ungraded_reason) u), '{}'::jsonb)
    from eval_results where run_id = rid
$$;

create table eval_regrades (
  id text primary key,
  tenant_id text not null references tenants(id),
  run_id text not null references eval_runs(id),
  from_grader_name text not null,
  from_grader_version text not null,
  to_grader_name text not null,
  to_grader_version text not null,
  created_by text not null check (btrim(created_by) <> ''),
  created_at timestamptz not null default now(),
  check ((from_grader_name, from_grader_version) is distinct from (to_grader_name, to_grader_version)),
  check (btrim(to_grader_name) <> '' and btrim(to_grader_version) <> '')
);
create index eval_regrades_run on eval_regrades(run_id);
create table eval_regrade_cases (
  regrade_id text not null references eval_regrades(id),
  case_id text not null,
  attempt int not null check (attempt >= 1),
  old_score numeric,
  new_score numeric check (new_score is null or (new_score >= 0 and new_score <= 100)),
  new_ungraded_reason text,
  primary key (regrade_id, case_id, attempt),
  check (new_ungraded_reason is null or (new_score is null and new_ungraded_reason in ('grader_timeout','grader_error','unparseable_output','no_reference','infrastructure_error','excluded_by_rule')))
);

create function eval_regrades_check() returns trigger language plpgsql as $$
declare r eval_runs;
begin
  select * into r from eval_runs where id = new.run_id;
  if r.finished_at is null then raise exception 'eval run % is not finished; only a finished run can be re-graded', r.id; end if;
  if r.tenant_id <> new.tenant_id then raise exception 'a re-grade diff has the tenant of its run'; end if;
  if r.grader_name is null or (r.grader_name, r.grader_version) is distinct from (new.from_grader_name, new.from_grader_version) then
    raise exception 'a re-grade diff starts from the grader the run recorded (%, %); it names from (%, %)', r.grader_name, r.grader_version, new.from_grader_name, new.from_grader_version;
  end if;
  return new;
end $$;
create trigger eval_regrades_check before insert on eval_regrades for each row execute function eval_regrades_check();
create function eval_regrade_cases_check() returns trigger language plpgsql as $$
declare rg eval_regrades; res eval_results;
begin
  select * into rg from eval_regrades where id = new.regrade_id;
  select * into res from eval_results where run_id = rg.run_id and case_id = new.case_id and attempt = new.attempt;
  if not found then raise exception 'run % has no result for case % attempt %', rg.run_id, new.case_id, new.attempt; end if;
  if res.score is distinct from new.old_score then raise exception 'the old grade (%) differs from the grade stored for case % attempt % (%)', new.old_score, new.case_id, new.attempt, res.score; end if;
  return new;
end $$;
create trigger eval_regrade_cases_check before insert on eval_regrade_cases for each row execute function eval_regrade_cases_check();
create trigger eval_regrades_no_update before update or delete on eval_regrades for each row execute function instances_append_only();
create trigger eval_regrades_no_truncate before truncate on eval_regrades for each statement execute function instances_append_only();
create trigger eval_regrade_cases_no_update before update or delete on eval_regrade_cases for each row execute function instances_append_only();
create trigger eval_regrade_cases_no_truncate before truncate on eval_regrade_cases for each statement execute function instances_append_only();

-- the run guard of 0040 (F3), with the grader columns added to the immutable set
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
