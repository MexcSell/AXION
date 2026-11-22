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

-- ======================================================================================================================
-- R2-3 dataset attestation. ABC-style (A3, NeurIPS 2025 Datasets and Benchmarks): task validity, outcome validity, reporting. The
-- item wording is ours; we do not claim the paper's item list. A person (an administrator, who is not the dataset's author)
-- answers every item before the dataset is frozen; an answer is yes, no, or not_applicable with a written reason.
--   * the attestation stores the content hash of the cases AS THEY ARE when it is written (computed here, never taken from the
--     caller) and a version number; changing an answer is a new version, never an edit;
--   * a freeze records which attestation version (if any) matches the frozen hash (eval_datasets.attested_version, computed by
--     the guard, never taken from the caller). A freeze without one is "unattested" and every verdict on it is flagged unvalidated;
--   * a frozen dataset can no longer be attested: the attestation comes BEFORE the freeze.
-- The per-run "disallowed source reachable" flag is deferred: it needs execution.
alter table eval_datasets add column created_by text;
alter table eval_datasets add column attested_version int;

create function eval_attestation_item_ids() returns text[] language sql immutable as $$
  select array['tv_solvable','tv_environment','tv_no_shortcut','tv_sources_stated','ov_reference_checked','ov_wrong_rejected','ov_equivalent_accepted','ov_grader_stable','rp_contamination','rp_limits','rp_noise','rp_scoring']::text[]
$$;
-- the problem with an answers object, or null when it is complete: every item, no other key, a known answer, and a reason for not_applicable
create function eval_attestation_problem(a jsonb) returns text language plpgsql immutable as $$
declare k text; v jsonb;
begin
  if a is null or jsonb_typeof(a) <> 'object' then return 'answers must be an object with one entry per item'; end if;
  for k in select unnest(eval_attestation_item_ids()) loop
    if not (a ? k) then return 'item ' || k || ' has no answer'; end if;
  end loop;
  for k, v in select * from jsonb_each(a) loop
    if not (k = any(eval_attestation_item_ids())) then return 'unknown item ' || k; end if;
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(v -> 'answer') <> 'string' or (v ->> 'answer') not in ('yes','no','not_applicable') then return 'item ' || k || ' needs an answer of yes, no or not_applicable'; end if;
    if exists (select 1 from jsonb_object_keys(v) x where x not in ('answer','note')) then return 'item ' || k || ' has an unknown field'; end if;
    if (v ->> 'answer') = 'not_applicable' and char_length(btrim(coalesce(v ->> 'note', ''))) < 10 then return 'item ' || k || ' is not applicable and needs a reason of at least 10 characters'; end if;
  end loop;
  return null;
end $$;

create table eval_attestations (
  dataset_id text not null references eval_datasets(id),
  version int not null check (version >= 1),
  tenant_id text not null references tenants(id),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  attestor_id text not null references users(id),
  answers jsonb not null,
  created_at timestamptz not null default now(),
  primary key (dataset_id, version)
);
create function eval_attestations_check() returns trigger language plpgsql as $$
declare d eval_datasets; prev eval_attestations; prob text;
begin
  select * into d from eval_datasets where id = new.dataset_id for update; -- serialises attestations with each other and with the freeze
  if not found then raise exception 'no such eval dataset %', new.dataset_id; end if;
  if d.tenant_id <> new.tenant_id then raise exception 'an attestation has the tenant of its dataset'; end if;
  if d.frozen_at is not null then raise exception 'dataset_frozen: eval dataset % is frozen; an attestation comes before the freeze', d.id; end if;
  if d.created_by is null or btrim(d.created_by) = '' then raise exception 'author_unknown: the author of eval dataset % is not recorded, so "the attestor is not the author" cannot be checked', d.id; end if;
  if lower(btrim(new.attestor_id)) = lower(btrim(d.created_by)) then raise exception 'attestor_is_author: the author of a dataset cannot attest it'; end if;
  if not exists (select 1 from users where id = new.attestor_id and tenant_id = new.tenant_id and role = 'admin' and status = 'approved') then
    raise exception 'attestor_not_admin: only an approved administrator can attest a dataset'; end if;
  prob := eval_attestation_problem(new.answers);
  if prob is not null then raise exception 'attestation_incomplete: %', prob; end if;
  if not exists (select 1 from eval_cases where dataset_id = d.id) then raise exception 'eval dataset % has no cases; it cannot be attested', d.id; end if;
  new.content_sha256 := eval_dataset_sha(d.id);
  select * into prev from eval_attestations where dataset_id = d.id order by version desc limit 1;
  if found and prev.content_sha256 = new.content_sha256 and prev.answers = new.answers then
    raise exception 'attestation_unchanged: version % already records these answers for this content', prev.version; end if;
  new.version := coalesce(prev.version, 0) + 1;
  return new;
end $$;
create trigger eval_attestations_check before insert on eval_attestations for each row execute function eval_attestations_check();
create trigger eval_attestations_no_update before update or delete on eval_attestations for each row execute function instances_append_only();
create trigger eval_attestations_no_truncate before truncate on eval_attestations for each statement execute function instances_append_only();

-- the dataset guard of 0037, plus: the author cannot change once recorded; the attested version of a freeze is computed here
create or replace function eval_datasets_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.frozen_at is not null then raise exception 'eval dataset % cannot be created frozen; freeze it with eval_freeze_dataset', new.id; end if;
    new.attested_version := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.frozen_at is not null and coalesce(current_setting('axion.purge_demo', true), '') <> 'on' then
      raise exception 'eval dataset % is frozen', old.id;
    end if;
    return old;
  end if;
  if old.frozen_at is not null then raise exception 'eval dataset % is frozen', old.id; end if;
  if old.created_by is not null and new.created_by is distinct from old.created_by then raise exception 'the author of eval dataset % cannot change', old.id; end if;
  new.attested_version := null;
  if new.frozen_at is not null then
    if not exists (select 1 from eval_cases where dataset_id = old.id) then
      raise exception 'eval dataset % has no cases; it cannot be frozen', old.id;
    end if;
    if new.content_sha256 is distinct from eval_dataset_sha(old.id) then
      raise exception 'eval dataset % content hash does not match its stored cases', old.id;
    end if;
    new.attested_version := (select max(version) from eval_attestations where dataset_id = old.id and content_sha256 = new.content_sha256);
  end if;
  return new;
end $$;
