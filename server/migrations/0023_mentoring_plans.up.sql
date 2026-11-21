-- Improvement cycle 19: mentoring plans. An administrator records a plan for an agent (the mentee): a mentor (another agent),
-- a target skill, 1-5 milestones and a re-evaluation date. A person ticks milestones (who and when are recorded).
-- No score or gain is stored: nothing is measured yet. Plans are append-only in spirit: a plan is closed (completed or
-- cancelled) once, never deleted, and a closed plan and its milestones never change.
create table mentoring_plans (
  id text primary key,                                    -- 'MP-' + 128 random bits
  tenant_id text not null references tenants(id),
  mentee_id text not null references agent_definitions(id),
  mentor_id text not null references agent_definitions(id),
  skill text not null check (length(btrim(skill)) > 0),
  reeval_on date not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_by text not null,
  created_at timestamptz not null default now(),
  closed_by text,
  closed_at timestamptz,
  note text,
  check (mentor_id <> mentee_id),
  check ((status = 'active') = (closed_at is null))
);
create unique index mentoring_plans_one_active on mentoring_plans(tenant_id, mentee_id) where status = 'active';
create index mentoring_plans_tenant on mentoring_plans(tenant_id, created_at desc);
create index mentoring_plans_mentee on mentoring_plans(mentee_id, created_at desc);

create table mentoring_milestones (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references mentoring_plans(id),
  seq int not null check (seq between 1 and 5),
  text text not null check (length(btrim(text)) > 0),
  done_by text,
  done_at timestamptz,
  unique (plan_id, seq),
  check ((done_by is null) = (done_at is null))
);

create function mentoring_plans_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'mentoring_plans is append-only'; end if;
  if old.status <> 'active' then raise exception 'a closed mentoring plan never changes'; end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.mentee_id <> old.mentee_id or new.mentor_id <> old.mentor_id
     or new.skill <> old.skill or new.reeval_on <> old.reeval_on or new.created_by <> old.created_by or new.created_at <> old.created_at
  then raise exception 'a mentoring plan can only be closed'; end if;
  return new;
end $$;
create trigger mentoring_plans_no_edit before update or delete on mentoring_plans for each row execute function mentoring_plans_guard();
create trigger mentoring_plans_no_truncate before truncate on mentoring_plans for each statement execute function mentoring_plans_guard();

create function mentoring_milestones_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'mentoring_milestones is append-only'; end if;
  if old.done_at is not null then raise exception 'a milestone is ticked once'; end if;
  if new.id <> old.id or new.plan_id <> old.plan_id or new.seq <> old.seq or new.text <> old.text then raise exception 'a milestone text never changes'; end if;
  if (select status from mentoring_plans where id = old.plan_id) <> 'active' then raise exception 'a closed mentoring plan never changes'; end if;
  return new;
end $$;
create trigger mentoring_milestones_no_edit before update or delete on mentoring_milestones for each row execute function mentoring_milestones_guard();
create trigger mentoring_milestones_no_truncate before truncate on mentoring_milestones for each statement execute function mentoring_milestones_guard();
