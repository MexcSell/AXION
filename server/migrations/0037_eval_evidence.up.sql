-- c47 (E1b): evaluation evidence on agent version proposals. Records only: nothing here runs an evaluation.
-- 1. a run names a version OR a proposal (a candidate is not an agent_versions row until it is promoted);
--    the run also stores who judged it (model family) and who evaluated it, so the verdict reads them from rows;
-- 2. freezing is safe: the content hash is recomputed in the database from the stored cases (same canonical form as
--    hashDataset in evolution/verdict-v2.ts; a case whose canonical form SQL and JS could render differently is refused, see
--    eval_json_bad / eval_text_bad), zero-case freezes and false hashes are refused, an already-frozen dataset
--    cannot be inserted, and freeze is serialised against case inserts by the dataset row lock;
-- 3. a promotion without a verified evaluation keeps the administrator's override reason on the proposal.

-- ---- canonical form + hash, computed from the stored cases --------------------------------------------------------
-- Mirrors canonical() in verdict-v2.ts: object keys sorted bytewise, arrays in order, numbers without trailing zeros,
-- strings as JSON. The two forms can differ for some values, so eval_dataset_sha REFUSES those (fail closed), never hashes them:
--   integers beyond 2^53-1; non-integers with more than 15 significant digits, below 1e-6 or from 1e21 up (JS prints exponents,
--   rounds, or goes non-finite); and keys or case ids with a code point from U+E000 up (SQL collate "C" orders by code point,
--   JS sort() by UTF-16 unit, which disagree once an astral character meets U+E000..U+FFFF).
create function eval_text_bad(t text) returns boolean language sql immutable as $$
  select exists (select 1 from generate_series(1, char_length(t)) i where ascii(substr(t, i, 1)) >= 57344)
$$;
create function eval_json_bad(v jsonb) returns boolean language plpgsql immutable as $$
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
create function eval_canon(v jsonb) returns text language plpgsql immutable as $$
declare t text := jsonb_typeof(v); r text;
begin
  if t = 'object' then
    select '{' || coalesce(string_agg(to_jsonb(k)::text || ':' || eval_canon(v -> k), ',' order by k collate "C"), '') || '}' into r from jsonb_object_keys(v) as k;
    return r;
  elsif t = 'array' then
    select '[' || coalesce(string_agg(eval_canon(e), ',' order by ord), '') || ']' into r from jsonb_array_elements(v) with ordinality as a(e, ord);
    return r;
  elsif t = 'number' then
    return trim_scale((v #>> '{}')::numeric)::text;
  end if;
  return v::text;
end $$;

-- volatile on purpose: it must see the cases committed while a freeze waited for the dataset row lock
create function eval_dataset_sha(ds text) returns text language plpgsql as $$
begin
  if exists (select 1 from eval_cases where dataset_id = ds and (eval_text_bad(case_id) or eval_json_bad(input) or eval_json_bad(expected))) then
    raise exception 'eval dataset % has a value whose canonical form could differ between the database and the application (integer above 2^53, a number with more than 15 digits or in exponent form, or a key above U+E000); it cannot be hashed', ds;
  end if;
  return (select encode(sha256(convert_to('[' || coalesce(string_agg(
    '{"caseId":' || to_jsonb(case_id)::text || ',"expected":' || eval_canon(expected) || ',"input":' || eval_canon(input) || '}', ',' order by case_id collate "C"), '') || ']', 'UTF8')), 'hex')
    from eval_cases where dataset_id = ds);
end $$;

-- the one way the application freezes: lock the row, hash the stored cases, set both in one statement
create function eval_freeze_dataset(ds text) returns text language plpgsql as $$
declare d eval_datasets; h text;
begin
  select * into d from eval_datasets where id = ds for update;
  if not found then raise exception 'no such eval dataset %', ds; end if;
  if d.frozen_at is not null then raise exception 'eval dataset % is already frozen', ds; end if;
  h := eval_dataset_sha(ds);
  update eval_datasets set frozen_at = now(), content_sha256 = h where id = ds;
  return h;
end $$;

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
drop trigger eval_datasets_guard on eval_datasets;
create trigger eval_datasets_guard before insert or update or delete on eval_datasets for each row execute function eval_datasets_guard();

-- a case insert takes the dataset row FOR SHARE: it waits for a freeze in flight (and is then refused), and a freeze waits for it
create or replace function eval_cases_guard() returns trigger language plpgsql as $$
declare ds text; fz timestamptz;
begin
  ds := case when tg_op = 'DELETE' then old.dataset_id else new.dataset_id end;
  select frozen_at into fz from eval_datasets where id = ds for share;
  if fz is not null and not (tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on') then
    raise exception 'eval dataset % is frozen; its cases cannot change', ds;
  end if;
  if tg_op = 'UPDATE' and (new.dataset_id <> old.dataset_id) then
    raise exception 'eval case cannot move to another dataset';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ---- the subject of a run ------------------------------------------------------------------------------------------
alter table eval_runs alter column subject_version_id drop not null;
alter table eval_runs add column subject_proposal_id text references agent_version_proposals(id);
alter table eval_runs add column judge_model_family text;
alter table eval_runs add column evaluator_id text;
alter table eval_runs add constraint eval_runs_one_subject check ((subject_version_id is null) <> (subject_proposal_id is null));
create index eval_runs_proposal on eval_runs(subject_proposal_id);

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

-- ---- the reason an administrator promoted without a verified evaluation -------------------------------------------
alter table agent_version_proposals add column override_reason text check (override_reason is null or char_length(btrim(override_reason)) >= 10);
