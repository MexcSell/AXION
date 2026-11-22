-- Improvement cycle 60 (Phase 2, R2-10): failure attribution. A failure tag can carry attribution entries: which agent and which
-- step of a trace a person (or an agent) thinks the failure came from, and whether the full trace is available to check it.
-- An entry exists only for a task or task attempt with a recorded failure. Entries are append-only; when two people attribute
-- the same failure differently both entries stay and the reader shows a disagreement count (never "the latest wins").
-- "agent_id" and "step_ref" are claims written by the attributor, not foreign keys: a trace can name an agent or step that is no longer stored.
create table failure_attributions (
  id text primary key,                                    -- 'FA-' + 128 random bits
  tenant_id text not null references tenants(id),
  tag_id text not null,                                   -- no foreign key: a referenced failure_tags could not be TRUNCATE-refused by its own guard (the insert trigger checks the tag; tags are append-only)
  mission_id text not null references missions(id) on delete cascade,
  agent_id text check (agent_id is null or length(agent_id) between 1 and 120),
  step_ref text check (step_ref is null or length(step_ref) between 1 and 120),
  full_trace_available boolean not null default false,    -- a claim by the attributor that the whole trace exists for checking
  attributed_by text not null,                            -- user id, or agent instance id
  attributed_by_kind text not null check (attributed_by_kind in ('user','agent')),
  created_at timestamptz not null default now(),
  check (agent_id is not null or step_ref is not null)
);
-- the same person does not repeat the same entry on one tag (a different entry is kept next to it)
create unique index failure_attributions_once on failure_attributions(tag_id, attributed_by_kind, attributed_by, coalesce(agent_id, ''), coalesce(step_ref, ''));
create index failure_attributions_tag on failure_attributions(tag_id, created_at, id);
create index failure_attributions_mission on failure_attributions(mission_id);

-- Only a task or task attempt with a recorded failure takes an entry: a task that failed (status failed, or any attempt
-- result 'failed'), or an attempt whose result is 'failed'. Checked here too, so no raw insert can bypass the service.
create function failure_attributions_check() returns trigger language plpgsql as $$
declare f failure_tags; ok boolean := false;
begin
  select * into f from failure_tags where id = new.tag_id;
  if f.id is null or f.tenant_id <> new.tenant_id or f.mission_id <> new.mission_id then raise exception 'failure attribution does not match its tag'; end if;
  if f.subject_kind = 'task' then
    select (t.status = 'failed' or exists (select 1 from task_attempts a where a.task_id = t.id and a.result = 'failed')) into ok
      from tasks t where t.id = f.subject_id and t.tenant_id = f.tenant_id;
  elsif f.subject_kind = 'task_attempt' and f.subject_id ~ '^[1-9][0-9]{0,17}$' then
    select (a.result = 'failed') into ok from task_attempts a join tasks t on t.id = a.task_id where a.id = f.subject_id::bigint and t.tenant_id = f.tenant_id;
  end if;
  if not coalesce(ok, false) then raise exception 'failure attribution needs a task or task attempt with a recorded failure'; end if;
  return new;
end $$;
create trigger failure_attributions_check before insert on failure_attributions for each row execute function failure_attributions_check();

-- Append-only: no UPDATE, no TRUNCATE, and no DELETE except the cascade of a demo purge (axion.purge_demo, set by clearDemo only).
create function failure_attributions_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception 'failure_attributions is append-only';
end $$;
create trigger failure_attributions_no_edit before update or delete on failure_attributions for each row execute function failure_attributions_guard();
create trigger failure_attributions_no_truncate before truncate on failure_attributions for each statement execute function failure_attributions_guard();
