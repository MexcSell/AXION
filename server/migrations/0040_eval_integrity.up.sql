-- c53 (E1c): eval-run integrity. Records only: nothing here runs an evaluation.
-- 1. a holdout dataset is used once per subject, across ALL proposals: one candidate run per (tenant, agent, candidate config
--    sha, holdout dataset) and one base run per (tenant, base version, holdout dataset). Withdrawing and re-proposing the same
--    config, or re-running the base, cannot buy a fresh run. Enforced here (trigger + unique index), so any writer is bound.

alter table eval_runs add column holdout_key text;
-- backfill (the append-only guard is switched off for this one statement): the first run per key gets it, later duplicates stay NULL
alter table eval_runs disable trigger eval_runs_guard;
update eval_runs r set holdout_key = k.key
  from (select r2.id,
               case when r2.subject_proposal_id is not null
                    then jsonb_build_array('candidate', r2.tenant_id, p.agent_id, p.candidate_sha, r2.dataset_id)::text
                    else jsonb_build_array('base', r2.tenant_id, r2.subject_version_id, r2.dataset_id)::text end as key,
               row_number() over (partition by r2.tenant_id, r2.dataset_id, coalesce(p.agent_id, ''), coalesce(p.candidate_sha, ''), coalesce(r2.subject_version_id::text, '') order by r2.started_at, r2.id) as rn
          from eval_runs r2
          join eval_datasets d on d.id = r2.dataset_id and d.split = 'holdout'
          left join agent_version_proposals p on p.id = r2.subject_proposal_id) k
 where r.id = k.id and k.rn = 1;
alter table eval_runs enable trigger eval_runs_guard;
create unique index eval_runs_holdout_once on eval_runs(holdout_key) where holdout_key is not null;

create or replace function eval_runs_guard() returns trigger language plpgsql as $$
declare fz timestamptz; tn text; vt text; sp text; ag text; sha text; key text; other eval_runs;
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
      select tenant_id, agent_id, candidate_sha into vt, ag, sha from agent_version_proposals where id = new.subject_proposal_id;
      if vt is distinct from new.tenant_id then raise exception 'eval run tenant differs from the tenant of its subject proposal'; end if;
      key := jsonb_build_array('candidate', new.tenant_id, ag, sha, new.dataset_id)::text;
    end if;
    -- the key is derived here, never taken from the caller; only holdout datasets are counted
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
  return new;
end $$;

-- 2. resumable runs. A run is in one of three states:
--      open      not finished, and at least one (case, attempt) result is missing (for example, the runner crashed);
--      complete  not finished, every case has every attempt 1..k recorded (a failed attempt is a result with a NULL score);
--      finished  finished_at is set. Immutable: the append-only guards refuse any change, and no result can be added.
--    An open run is RESUMED (add the missing results from eval_run_missing), then finished with eval_finish_run. A second run on the
--    same holdout is refused (holdout_rerun), so a crash never burns the holdout and never buys a second try.
create function eval_run_missing(rid text) returns table(case_id text, attempt int) language plpgsql stable as $$
declare r eval_runs;
begin
  select * into r from eval_runs where id = rid;
  if not found then raise exception 'no such eval run %', rid; end if;
  if r.finished_at is not null then raise exception 'eval run % is finished and immutable; nothing to resume', rid; end if;
  return query
    select c.case_id, a.n::int from eval_cases c cross join generate_series(1, r.k) as a(n)
     where c.dataset_id = r.dataset_id
       and not exists (select 1 from eval_results x where x.run_id = rid and x.case_id = c.case_id and x.attempt = a.n)
     order by c.case_id, a.n;
end $$;
create function eval_run_state(rid text) returns text language plpgsql stable as $$
declare r eval_runs;
begin
  select * into r from eval_runs where id = rid;
  if not found then return null; end if;
  if r.finished_at is not null then return 'finished'; end if;
  return case when exists (select 1 from eval_run_missing(rid)) then 'open' else 'complete' end;
end $$;
-- the one way to finish: lock the run, refuse an unknown or finished run and an incomplete one (run_incomplete), then set finished_at
create function eval_finish_run(rid text) returns timestamptz language plpgsql as $$
declare r eval_runs; miss int;
begin
  select * into r from eval_runs where id = rid for update;
  if not found then raise exception 'no such eval run %', rid; end if;
  if r.finished_at is not null then raise exception 'eval run % is already finished', rid; end if;
  select count(*) into miss from eval_run_missing(rid);
  if miss > 0 then raise exception 'run_incomplete: eval run % is missing % result(s); resume it before finishing', rid, miss; end if;
  update eval_runs set finished_at = now() where id = rid;
  return (select finished_at from eval_runs where id = rid);
end $$;

-- 4. numbers. A non-integer is now accepted when JS and SQL render it identically, not only up to 15 digits. jsonb keeps a number's
--    exact decimal text, JS prints the SHORTEST text that reads back to the same double, and PostgreSQL (12+) prints float8 the same way
--    (shortest round-trip, with extra_float_digits >= 1, pinned on the function). So the stored decimal prints like JS exactly when it
--    equals its own double's shortest text: (n::float8)::text::numeric = n. Anything else (a 17-digit decimal that is not the shortest
--    form of its double, such as 0.3000000000000000444) is refused. Outside [1e-6, 1e21) JS prints exponents, so those stay refused,
--    and so do integers above 2^53-1. The canonical text and hash of everything already accepted are unchanged.
create or replace function eval_json_bad(v jsonb) returns boolean language plpgsql immutable set extra_float_digits = 1 as $$
declare t text := jsonb_typeof(v); n numeric;
begin
  if t = 'object' then
    return exists (select 1 from jsonb_object_keys(v) k where eval_text_bad(k) or eval_json_bad(v -> k));
  elsif t = 'array' then
    return exists (select 1 from jsonb_array_elements(v) e where eval_json_bad(e));
  elsif t = 'number' then
    n := (v #>> '{}')::numeric;
    if n = trunc(n) then return abs(n) > 9007199254740991; end if;
    if abs(n) >= 1e21 or abs(n) < 0.000001 then return true; end if;
    return (n::float8)::text::numeric <> n;
  end if;
  return false;
end $$;
