create or replace function eval_runs_guard() returns trigger language plpgsql as $$
declare fz timestamptz; tn text; vt text;
begin
  if tg_op = 'INSERT' then
    select frozen_at, tenant_id into fz, tn from eval_datasets where id = new.dataset_id;
    if fz is null then raise exception 'eval dataset % is not frozen; a run needs a frozen dataset', new.dataset_id; end if;
    if tn <> new.tenant_id then raise exception 'eval run tenant differs from its dataset'; end if;
    if new.subject_version_id is not null then
      select d.tenant_id into vt from agent_versions v join agent_definitions d on d.id = v.agent_id where v.id = new.subject_version_id;
      if vt is distinct from new.tenant_id then raise exception 'eval run tenant differs from the tenant of its subject version'; end if;
    else
      select tenant_id into vt from agent_version_proposals where id = new.subject_proposal_id;
      if vt is distinct from new.tenant_id then raise exception 'eval run tenant differs from the tenant of its subject proposal'; end if;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
    raise exception 'eval_runs is append-only';
  end if;
  if old.finished_at is not null
     or new.finished_at is null
     or (new.id, new.tenant_id, new.dataset_id, new.subject_version_id, new.subject_proposal_id, new.k, new.started_at, new.judge_model_family, new.evaluator_id)
        is distinct from (old.id, old.tenant_id, old.dataset_id, old.subject_version_id, old.subject_proposal_id, old.k, old.started_at, old.judge_model_family, old.evaluator_id) then
    raise exception 'eval_runs is append-only: only finished_at may be set, once';
  end if;
  return new;
end $$;
drop index eval_runs_holdout_once;
alter table eval_runs drop column holdout_key;
drop function eval_finish_run(text);
drop function eval_run_state(text);
drop function eval_run_missing(text);
create or replace function eval_json_bad(v jsonb) returns boolean language plpgsql immutable as $$
declare t text := jsonb_typeof(v); n numeric; digits text;
begin
  if t = 'object' then
    return exists (select 1 from jsonb_object_keys(v) k where eval_text_bad(k) or eval_json_bad(v -> k));
  elsif t = 'array' then
    return exists (select 1 from jsonb_array_elements(v) e where eval_json_bad(e));
  elsif t = 'number' then
    n := (v #>> '{}')::numeric;
    if n = trunc(n) then return abs(n) > 9007199254740991; end if;
    digits := ltrim(regexp_replace(abs(trim_scale(n))::text, '[^0-9]', '', 'g'), '0');
    return abs(n) >= 1e21 or abs(n) < 0.000001 or char_length(digits) > 15;
  end if;
  return false;
end $$;
drop function eval_canon_config(jsonb);
drop trigger agent_version_proposals_identity on agent_version_proposals;
drop function agent_version_proposals_identity();
