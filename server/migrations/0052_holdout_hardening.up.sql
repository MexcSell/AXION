-- c70 (E1d): holdout shopping gaps. Records only: nothing here runs an evaluation.
-- 1. canonical config: all Unicode whitespace, NFC, empty names. 2. the holdout limit also keys on the dataset content hash.
-- 3. a re-grade of a BASE run by an author of a proposal on that base is refused in the database.

-- c70 (E1d): eval_canon_config collapses ALL Unicode whitespace (tab, NBSP, ideographic and zero-width spaces: runs become one space, the ends
-- are trimmed), normalises names to NFC, and drops empty-string skills and tools. The application normalises the same way before it writes
-- (JS trim), so this only narrows what a raw writer can do. stricter, never looser: two configs that were the same stay the same.
create or replace function eval_canon_name(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(normalize(coalesce(t, ''), NFC), '[\s\u0085\u00a0\u1680\u180e\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ')
$$;
create or replace function eval_canon_config(c jsonb) returns text language sql immutable as $$
  select jsonb_build_object(
    'model', lower(eval_canon_name(c ->> 'model')),
    'skills', coalesce((select jsonb_agg(x order by x) from (select distinct eval_canon_name(e) x from jsonb_array_elements_text(case when jsonb_typeof(c -> 'skills') = 'array' then c -> 'skills' else '[]'::jsonb end) e) q where x <> ''), '[]'::jsonb),
    'tools', coalesce((select jsonb_agg(x order by x) from (select distinct eval_canon_name(e) x from jsonb_array_elements_text(case when jsonb_typeof(c -> 'tools') = 'array' then c -> 'tools' else '[]'::jsonb end) e) q where x <> ''), '[]'::jsonb))::text
$$;

-- the holdout limit is also keyed on the dataset CONTENT hash: the same cases under a new dataset id is the same holdout
alter table eval_runs add column holdout_content_key text;

-- backfill (the append-only guard is switched off for these statements): keys are rebuilt with the new canonical form; the first run per key keeps it, later legacy duplicates stay NULL
alter table eval_runs disable trigger eval_runs_guard;
update eval_runs set holdout_key = null where holdout_key is not null;
update eval_runs r set holdout_key = k.key, holdout_content_key = k.ckey
  from (select r2.id,
               case when r2.subject_proposal_id is not null
                    then jsonb_build_array('candidate', r2.tenant_id, p.agent_id, eval_canon_config(p.candidate), r2.dataset_id)::text
                    else jsonb_build_array('base', r2.tenant_id, r2.subject_version_id, r2.dataset_id)::text end as key,
               case when r2.subject_proposal_id is not null
                    then jsonb_build_array('candidate', r2.tenant_id, p.agent_id, eval_canon_config(p.candidate), d.content_sha256)::text
                    else jsonb_build_array('base', r2.tenant_id, r2.subject_version_id, d.content_sha256)::text end as ckey,
               row_number() over (partition by r2.tenant_id, r2.dataset_id, coalesce(p.agent_id, ''), coalesce(eval_canon_config(p.candidate), ''), coalesce(r2.subject_version_id::text, '') order by r2.started_at, r2.id) as rn_ds,
               row_number() over (partition by r2.tenant_id, d.content_sha256, coalesce(p.agent_id, ''), coalesce(eval_canon_config(p.candidate), ''), coalesce(r2.subject_version_id::text, '') order by r2.started_at, r2.id) as rn_ct
          from eval_runs r2
          join eval_datasets d on d.id = r2.dataset_id and d.split = 'holdout'
          left join agent_version_proposals p on p.id = r2.subject_proposal_id) k
 where r.id = k.id and k.rn_ds = 1 and k.rn_ct = 1;
alter table eval_runs enable trigger eval_runs_guard;
create unique index eval_runs_holdout_content_once on eval_runs(holdout_content_key) where holdout_content_key is not null;

create or replace function eval_runs_guard() returns trigger language plpgsql as $$
declare fz timestamptz; tn text; vt text; sp text; ag text; cfg text; key text; ckey text; csha text; other eval_runs; miss int;
begin
  if tg_op = 'INSERT' then
    select frozen_at, tenant_id, split, content_sha256 into fz, tn, sp, csha from eval_datasets where id = new.dataset_id;
    if fz is null then raise exception 'eval dataset % is not frozen; a run needs a frozen dataset', new.dataset_id; end if;
    if tn <> new.tenant_id then raise exception 'eval run tenant differs from its dataset'; end if;
    if new.subject_version_id is not null then
      select d.tenant_id into vt from agent_versions v join agent_definitions d on d.id = v.agent_id where v.id = new.subject_version_id;
      if vt is distinct from new.tenant_id then raise exception 'eval run tenant differs from the tenant of its subject version'; end if;
      key := jsonb_build_array('base', new.tenant_id, new.subject_version_id, new.dataset_id)::text;
      ckey := jsonb_build_array('base', new.tenant_id, new.subject_version_id, csha)::text;
    else
      select tenant_id, agent_id, eval_canon_config(candidate) into vt, ag, cfg from agent_version_proposals where id = new.subject_proposal_id;
      if vt is distinct from new.tenant_id then raise exception 'eval run tenant differs from the tenant of its subject proposal'; end if;
      key := jsonb_build_array('candidate', new.tenant_id, ag, cfg, new.dataset_id)::text;
      ckey := jsonb_build_array('candidate', new.tenant_id, ag, cfg, csha)::text;
    end if;
    new.holdout_key := null; new.holdout_content_key := null;
    if sp = 'holdout' then
      select * into other from eval_runs where holdout_key = key;
      if found then
        raise exception 'holdout_rerun: holdout dataset % already has a run for this subject (run %, %); resume or finish that run, or freeze a fresh holdout dataset',
          new.dataset_id, other.id, case when other.finished_at is null then 'unfinished' else 'finished' end;
      end if;
      -- c70 (E1d): the same CONTENT under another dataset id is the same holdout
      select * into other from eval_runs where holdout_content_key = ckey;
      if found then
        raise exception 'holdout_rerun: holdout dataset % has the same content as dataset % (run %, %), which this subject already ran on; freeze a holdout with new cases',
          new.dataset_id, other.dataset_id, other.id, case when other.finished_at is null then 'unfinished' else 'finished' end;
      end if;
      new.holdout_key := key; new.holdout_content_key := ckey;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
    raise exception 'eval_runs is append-only';
  end if;
  if old.finished_at is not null
     or new.finished_at is null
     or (new.id, new.tenant_id, new.dataset_id, new.subject_version_id, new.subject_proposal_id, new.k, new.started_at, new.judge_model_family, new.evaluator_id, new.holdout_key, new.holdout_content_key, new.grader_name, new.grader_version)
        is distinct from (old.id, old.tenant_id, old.dataset_id, old.subject_version_id, old.subject_proposal_id, old.k, old.started_at, old.judge_model_family, old.evaluator_id, old.holdout_key, old.holdout_content_key, old.grader_name, old.grader_version) then
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
  elsif r.subject_version_id is not null then
    -- c70 (E1d): nor the base run of a proposal they wrote (the loader would not link it, but the database refuses it outright)
    if exists (select 1 from agent_version_proposals where tenant_id = r.tenant_id and base_version_id = r.subject_version_id and created_by = new.created_by) then
      raise exception 'regrader_is_author: the author of a proposal cannot re-grade the base run it is compared with'; end if;
  end if;
  if r.finished_at is null then raise exception 'eval run % is not finished; only a finished run can be re-graded', r.id; end if;
  if r.tenant_id <> new.tenant_id then raise exception 'a re-grade diff has the tenant of its run'; end if;
  if r.grader_name is null or (r.grader_name, r.grader_version) is distinct from (new.from_grader_name, new.from_grader_version) then
    raise exception 'a re-grade diff starts from the grader the run recorded (%, %); it names from (%, %)', r.grader_name, r.grader_version, new.from_grader_name, new.from_grader_version;
  end if;
  return new;
end $$;
