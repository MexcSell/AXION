-- Improvement cycle 59 (R2-5): origin-bound memory and skill records, an append-only contribution log, and fixture-only skill outcomes.
-- Builds on c41's tables and `sources`. Records only: nothing executes and no agent reads a playbook or a skill yet.
--  * Every lesson candidate and skill records its write CHANNEL and an origin CLASS derived from it (tool < agent < human). The class is
--    set once, by the server at write time; review (accept, approve, rollback) never changes it. A derived record (a summary or merge of
--    other records, named in `sources` as 'lesson' or 'skill' refs) is never above its weakest source, and the database checks that too.
--  * record_contributions: one append-only line per change to a lesson or skill (who or what, when, from which sources).
--  * skill_outcomes: append-only fixture scores. Only fixtures exist until agents use skills.

-- 1. the columns (rows from before this migration keep what their proposer kind implies; the c41 guard must be off for that one update)
alter table lesson_candidates add column origin_channel text not null default 'human_entry', add column origin_class text not null default 'human';
alter table skills add column origin_channel text not null default 'human_entry', add column origin_class text not null default 'human';
alter table lesson_candidates disable trigger lesson_candidates_no_edit;
alter table skills disable trigger skills_no_edit;
-- Fail closed: what cannot be proven gets the LOWEST class, so a down then up round trip can never raise one. An agent-kind row is not human, but whether it
-- was agent or tool output is not recorded before 0044 (or is dropped by `down`), so it becomes tool. A person's row that cites lessons or skills was derived: tool.
-- Only a person's row with no record source is provably a typed entry (the only code path that writes it), and it stays human_entry.
update lesson_candidates set origin_channel = 'tool_output', origin_class = 'tool' where proposed_by_kind = 'agent';
update skills set origin_channel = 'tool_output', origin_class = 'tool' where proposed_by_kind = 'agent';
update lesson_candidates set origin_channel = 'derived', origin_class = 'tool' where proposed_by_kind = 'human' and exists (select 1 from jsonb_array_elements(sources) s where lower(s->>'kind') in ('lesson','skill'));
update skills set origin_channel = 'derived', origin_class = 'tool' where proposed_by_kind = 'human' and exists (select 1 from jsonb_array_elements(sources) s where lower(s->>'kind') in ('lesson','skill'));
alter table lesson_candidates enable trigger lesson_candidates_no_edit;
alter table skills enable trigger skills_no_edit;
alter table lesson_candidates alter column origin_channel drop default, alter column origin_class drop default;
alter table skills alter column origin_channel drop default, alter column origin_class drop default;

-- 2. the rules the database itself holds: the channel fixes the class, and an agent's record or one filed on a person's behalf is never human
alter table lesson_candidates
  add constraint lesson_origin_values check (origin_channel in ('human_entry','agent_output','tool_output','derived') and origin_class in ('tool','agent','human')),
  add constraint lesson_origin_channel check ((origin_channel = 'human_entry' and origin_class = 'human') or (origin_channel = 'agent_output' and origin_class = 'agent')
    or (origin_channel = 'tool_output' and origin_class = 'tool') or origin_channel = 'derived'),
  add constraint lesson_origin_agent check ((proposed_by_kind = 'human' and submitted_by is null) or (origin_class <> 'human' and origin_channel <> 'human_entry'));
alter table skills
  add constraint skill_origin_values check (origin_channel in ('human_entry','agent_output','tool_output','derived') and origin_class in ('tool','agent','human')),
  add constraint skill_origin_channel check ((origin_channel = 'human_entry' and origin_class = 'human') or (origin_channel = 'agent_output' and origin_class = 'agent')
    or (origin_channel = 'tool_output' and origin_class = 'tool') or origin_channel = 'derived'),
  add constraint skill_origin_agent check ((proposed_by_kind = 'human' and submitted_by is null) or (origin_class <> 'human' and origin_channel <> 'human_entry'));

create function origin_rank(c text) returns int language sql immutable as $$ select case c when 'tool' then 1 when 'agent' then 2 when 'human' then 3 end $$;

-- fills the defaults (so a raw insert that names no origin still works) and holds the derivation rule: a derived record names at least
-- one lesson or skill source, every such source exists in the tenant, and the class is never above the weakest of them.
create function origin_before_insert() returns trigger language plpgsql as $$
declare refs int; found int; floor_rank int; ceiling text;
begin
  if new.origin_channel is null then new.origin_channel := case when new.proposed_by_kind = 'agent' then 'agent_output' else 'human_entry' end; end if;
  select count(*) into refs from jsonb_array_elements(new.sources) s where lower(s->>'kind') in ('lesson','skill');
  if new.origin_channel <> 'derived' then
    if refs > 0 then raise exception 'a record that cites other records is derived'; end if;   -- no way to name a lower record and keep a higher class
    if new.origin_class is null then new.origin_class := case new.origin_channel when 'human_entry' then 'human' when 'agent_output' then 'agent' else 'tool' end; end if;
    return new;
  end if;
  select count(*), min(origin_rank(r.cls)) into found, floor_rank from (
    select lc.origin_class as cls from jsonb_array_elements(new.sources) s join lesson_candidates lc on lower(s->>'kind') = 'lesson' and lc.id = s->>'id' and lc.tenant_id = new.tenant_id
    union all
    select sk.origin_class from jsonb_array_elements(new.sources) s join skills sk on lower(s->>'kind') = 'skill' and sk.id = s->>'id' and sk.tenant_id = new.tenant_id) r;
  if refs = 0 or found <> refs then raise exception 'a derived record needs lesson or skill sources that exist'; end if;
  ceiling := case when new.proposed_by_kind = 'agent' then 'agent' else 'human' end;  -- the writer's own class is also a ceiling
  if new.origin_class is null then new.origin_class := case least(floor_rank, origin_rank(ceiling)) when 1 then 'tool' when 2 then 'agent' else 'human' end; end if;
  if origin_rank(new.origin_class) > floor_rank or origin_rank(new.origin_class) > origin_rank(ceiling) then raise exception 'a derived record is never above its weakest source'; end if;
  return new;
end $$;
create trigger lesson_candidates_origin before insert on lesson_candidates for each row execute function origin_before_insert();
create trigger skills_origin before insert on skills for each row execute function origin_before_insert();

-- 3. the c41 guards, replaced so the new columns are immutable too (a raw UPDATE can never raise a class)
create or replace function lesson_candidates_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'lesson_candidates is append-only'; end if;
  if old.status in ('rejected','superseded') then raise exception 'a decided lesson candidate never changes'; end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.agent_id <> old.agent_id or new.role <> old.role or new.text <> old.text
     or new.sources <> old.sources or new.proposed_by <> old.proposed_by or new.proposed_by_kind <> old.proposed_by_kind
     or new.submitted_by is distinct from old.submitted_by or new.sha256 <> old.sha256 or new.review_by is distinct from old.review_by or new.created_at <> old.created_at
     or new.origin_channel <> old.origin_channel or new.origin_class <> old.origin_class
  then raise exception 'a lesson candidate can only be decided'; end if;
  if old.status = 'accepted' and (new.status <> 'superseded' or new.withdrawn_in_version is null or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at or new.decision_note is distinct from old.decision_note or new.override_note is distinct from old.override_note
     or new.accepted_in_version is distinct from old.accepted_in_version)
  then raise exception 'an accepted lesson never changes, except that a rollback can withdraw it'; end if;
  return new;
end $$;
create or replace function skills_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'skills is append-only'; end if;
  if old.status = 'retired' then raise exception 'a retired skill never changes'; end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.name <> old.name or new.version <> old.version or new.description <> old.description
     or new.steps <> old.steps or new.preconditions <> old.preconditions or new.sources <> old.sources or new.proposed_by <> old.proposed_by
     or new.proposed_by_kind <> old.proposed_by_kind or new.submitted_by is distinct from old.submitted_by or new.created_at <> old.created_at
     or new.origin_channel <> old.origin_channel or new.origin_class <> old.origin_class
  then raise exception 'a skill can only be approved or retired'; end if;
  if old.status = 'approved' and (new.status <> 'retired' or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at)
  then raise exception 'an approved skill can only be retired'; end if;
  return new;
end $$;

-- 4. the contribution log: append-only (UPDATE, DELETE, TRUNCATE refused; the one allowed DELETE is the cascade of a demo purge)
create table record_contributions (
  seq bigserial primary key,
  tenant_id text not null references tenants(id),
  record_kind text not null check (record_kind in ('lesson','skill')),
  record_id text not null,                               -- no foreign key on purpose: the log outlives the row it describes
  action text not null check (action in ('proposed','accepted','rejected','closed_duplicate','withdrawn','restored','approved','retired','replaced','retirement_kept')),
  actor text not null,
  actor_kind text not null check (actor_kind in ('human','agent','system')),
  origin_channel text not null check (origin_channel in ('human_entry','agent_output','tool_output','derived')),
  origin_class text not null check (origin_class in ('tool','agent','human')),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  version int,
  note text,
  filed_by text,                                         -- the person who filed an agent's proposal (the actor is then the agent)
  ref text,                                              -- a retirement_kept line names the skill_outcomes row it dismissed
  at timestamptz not null default now()
);
create index record_contributions_record on record_contributions(tenant_id, record_kind, record_id, seq);

create table skill_outcomes (
  seq bigserial primary key,
  tenant_id text not null references tenants(id),
  skill_id text not null references skills(id) on delete cascade,
  score numeric(4,3) not null check (score >= 0 and score <= 1),
  n int not null check (n >= 1),
  source text not null default 'fixture' check (source = 'fixture'),   -- the only kind that exists until agents use skills
  at timestamptz not null default now()
);
create index skill_outcomes_skill on skill_outcomes(skill_id, seq);

create function c59_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger record_contributions_no_edit before update or delete on record_contributions for each row execute function c59_append_only();
create trigger record_contributions_no_truncate before truncate on record_contributions for each statement execute function c59_append_only();
create trigger skill_outcomes_no_edit before update or delete on skill_outcomes for each row execute function c59_append_only();
create trigger skill_outcomes_no_truncate before truncate on skill_outcomes for each statement execute function c59_append_only();

-- 5. completeness by construction: every status or content change of a lesson or skill writes its own log row, so no raw UPDATE can skip the log.
-- The actor comes from transaction-local settings (axion.actor, axion.actor_kind; optional axion.contrib_note, axion.contrib_action). An UPDATE without an actor
-- is refused (fail closed). An INSERT without one falls back to the row's own proposer, which is data on the row, not a guess.
create function contribution_trigger() returns trigger language plpgsql as $$
declare act text; actor text := nullif(current_setting('axion.actor', true), ''); akind text := nullif(current_setting('axion.actor_kind', true), '');
        note text := nullif(current_setting('axion.contrib_note', true), ''); over text := nullif(current_setting('axion.contrib_action', true), '');
        kind text; ver int; filed text;
begin
  if tg_table_name = 'lesson_candidates' then
    kind := 'lesson';
    if tg_op = 'INSERT' then act := 'proposed'; filed := new.submitted_by;
    elsif old.status = 'proposed' and new.status = 'accepted' then act := 'accepted'; ver := new.accepted_in_version; note := coalesce(note, new.decision_note);
    elsif old.status = 'proposed' and new.status = 'rejected' then act := 'rejected'; note := coalesce(note, new.decision_note);
    elsif old.status = 'proposed' and new.status = 'superseded' then act := 'closed_duplicate'; note := coalesce(note, new.decision_note);
    elsif old.status = 'accepted' and new.status = 'superseded' then act := 'withdrawn'; ver := new.withdrawn_in_version;
    else return null; end if;
  else
    kind := 'skill'; ver := new.version;
    if tg_op = 'INSERT' then act := 'proposed'; filed := new.submitted_by;
    elsif old.status = 'draft' and new.status = 'approved' then act := 'approved';
    elsif old.status <> 'retired' and new.status = 'retired' then act := coalesce(over, 'retired'); note := coalesce(note, new.retire_note);
    else return null; end if;
  end if;
  if actor is null then
    if tg_op = 'INSERT' then actor := new.proposed_by; akind := new.proposed_by_kind;
    else raise exception 'contribution actor not set (axion.actor)'; end if;
  end if;
  insert into record_contributions(tenant_id, record_kind, record_id, action, actor, actor_kind, origin_channel, origin_class, sources, version, note, filed_by)
  values (new.tenant_id, kind, new.id, act, actor, coalesce(akind, 'human'), new.origin_channel, new.origin_class, new.sources, ver, note, filed);
  return null;
end $$;
create trigger lesson_candidates_contribution after insert or update on lesson_candidates for each row execute function contribution_trigger();
create trigger skills_contribution after insert or update on skills for each row execute function contribution_trigger();
