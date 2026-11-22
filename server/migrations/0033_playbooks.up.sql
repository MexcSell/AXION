-- Improvement cycle 41: reviewed playbooks and a skill library (ExpeL, ACE, Voyager, Agent Workflow Memory; spec Stage 9 knowledge:
-- sources, hashes, trust level, expiry, contradiction flags). Records only: nothing executes and nothing here is read by an agent yet.
-- A lesson is proposed with evidence, a different human accepts it, and acceptance appends a NEW playbook version. A version never changes.
-- All three tables are append-only. lesson_candidates and skills change status once (one-way); playbooks never change at all.
-- The only DELETE allowed is the cascade of a demo purge (transaction-local flag axion.purge_demo, as in 0007); TRUNCATE is always refused.

create table lesson_candidates (
  id text primary key,                                         -- 'LC-' + 128 random bits
  tenant_id text not null references tenants(id),
  agent_id text not null references agent_definitions(id),     -- the role's one agent (one agent per role)
  role text not null,
  text text not null check (length(btrim(text)) between 1 and 600),
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 10),
  proposed_by text not null,                                   -- a user id, or an agent id when proposed_by_kind = 'agent'
  proposed_by_kind text not null default 'human' check (proposed_by_kind in ('human','agent')),
  submitted_by text,                                           -- the person who filed an agent's proposal (agents have no session)
  status text not null default 'proposed' check (status in ('proposed','accepted','rejected','superseded')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  review_by date,
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  override_note text,
  accepted_in_version int,
  check ((status = 'proposed') = (decided_at is null)),
  check ((decided_by is null) = (decided_at is null)),
  check (decided_by is null or (decided_by <> proposed_by and decided_by is distinct from submitted_by) or decided_by = 'system'),
  check ((status = 'accepted') = (accepted_in_version is not null))
);
create index lesson_candidates_tenant on lesson_candidates(tenant_id, created_at desc);
create index lesson_candidates_agent on lesson_candidates(agent_id, created_at desc);

create table playbooks (
  id text primary key,                                         -- 'PB-' + 128 random bits
  tenant_id text not null references tenants(id),
  agent_id text not null references agent_definitions(id),
  role text not null,
  version int not null check (version >= 1),
  base_version int not null check (base_version >= 0),
  items jsonb not null check (jsonb_typeof(items) = 'array'),  -- ordered: {lessonId, text, trust, addedInVersion, sources, sha256, reviewBy, contradiction, contradicts, overrideNote}
  kind text not null check (kind in ('accept','rollback')),
  lesson_id text references lesson_candidates(id),
  rollback_to int,
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, agent_id, version),
  check (version = base_version + 1),                          -- gap-free: a version is always the one after its base
  check ((kind = 'accept') = (lesson_id is not null)),
  check ((kind = 'rollback') = (rollback_to is not null)),
  check (rollback_to is null or rollback_to < base_version)
);
create index playbooks_agent on playbooks(tenant_id, agent_id, version desc);

create table skills (
  id text primary key,                                         -- 'SK-' + 128 random bits
  tenant_id text not null references tenants(id),
  name text not null check (length(btrim(name)) between 1 and 80),
  version int not null check (version >= 1),
  description text not null check (length(btrim(description)) between 1 and 500),
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 20),   -- declarative text steps, never code
  preconditions jsonb not null default '[]'::jsonb check (jsonb_typeof(preconditions) = 'array' and jsonb_array_length(preconditions) <= 10),
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 10),
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  proposed_by text not null,
  proposed_by_kind text not null default 'human' check (proposed_by_kind in ('human','agent')),
  submitted_by text,
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  retire_note text,
  check ((approved_by is null) = (approved_at is null)),
  check ((retired_by is null) = (retired_at is null)),
  check ((status = 'draft') = (approved_at is null and retired_at is null)),
  check ((status = 'retired') = (retired_at is not null)),
  check (approved_by is null or (approved_by <> proposed_by and approved_by is distinct from submitted_by))
);
create unique index skills_name_version on skills(tenant_id, lower(name), version);
create unique index skills_one_approved on skills(tenant_id, lower(name)) where status = 'approved';
create index skills_tenant on skills(tenant_id, created_at desc);

create function playbooks_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger playbooks_no_edit before update or delete on playbooks for each row execute function playbooks_guard();
create trigger playbooks_no_truncate before truncate on playbooks for each statement execute function playbooks_guard();

-- a candidate is decided once: proposed -> accepted | rejected | superseded; its content never changes
create function lesson_candidates_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'lesson_candidates is append-only'; end if;
  if old.status <> 'proposed' then raise exception 'a decided lesson candidate never changes'; end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.agent_id <> old.agent_id or new.role <> old.role or new.text <> old.text
     or new.sources <> old.sources or new.proposed_by <> old.proposed_by or new.proposed_by_kind <> old.proposed_by_kind
     or new.submitted_by is distinct from old.submitted_by or new.sha256 <> old.sha256 or new.review_by is distinct from old.review_by or new.created_at <> old.created_at
  then raise exception 'a lesson candidate can only be decided'; end if;
  return new;
end $$;
create trigger lesson_candidates_no_edit before update or delete on lesson_candidates for each row execute function lesson_candidates_guard();
create trigger lesson_candidates_no_truncate before truncate on lesson_candidates for each statement execute function lesson_candidates_guard();

-- a skill version is approved once (draft -> approved) and retired once (draft | approved -> retired); its content never changes
create function skills_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'skills is append-only'; end if;
  if old.status = 'retired' then raise exception 'a retired skill never changes'; end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.name <> old.name or new.version <> old.version or new.description <> old.description
     or new.steps <> old.steps or new.preconditions <> old.preconditions or new.sources <> old.sources or new.proposed_by <> old.proposed_by
     or new.proposed_by_kind <> old.proposed_by_kind or new.submitted_by is distinct from old.submitted_by or new.created_at <> old.created_at
  then raise exception 'a skill can only be approved or retired'; end if;
  if old.status = 'approved' and (new.status <> 'retired' or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at)
  then raise exception 'an approved skill can only be retired'; end if;
  return new;
end $$;
create trigger skills_no_edit before update or delete on skills for each row execute function skills_guard();
create trigger skills_no_truncate before truncate on skills for each statement execute function skills_guard();
