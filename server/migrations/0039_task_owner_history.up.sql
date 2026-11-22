-- c51 (O3a): who has owned a task, as a data row with a constraint instead of a log read. The independent-review rule
-- (c38) excludes every agent that owned or received the task earlier. It used to read audit rows and delegation rows, which
-- a raw UPDATE, a future route or an audit purge would leave blank (fail-open). Now a trigger on tasks writes one row
-- whenever owner_agent or owner_instance_id changes (also on insert, also for raw SQL), the table is append-only, and a task
-- with an owner but no history row refuses every review (fail-closed).
create table task_owner_history (
  seq bigserial primary key,
  tenant_id text not null,
  task_id text not null references tasks(id) on delete cascade,
  agent_id text,                       -- the agent that owned the task from this row on (resolved from the instance when owner_agent is empty)
  owner_agent text,
  owner_instance_id text,              -- no foreign key on purpose: the history must outlive an ended instance
  source text not null check (source in ('insert','change','backfill','audit','delegation')),
  at timestamptz not null default now()
);
create index task_owner_history_task on task_owner_history(task_id, seq);

-- Backfill: earlier owners named by reassign audit rows and by delegations, then the current owner of every task.
insert into task_owner_history(tenant_id, task_id, agent_id, owner_agent, owner_instance_id, source, at)
select t.tenant_id, t.id, a.detail->>'fromAgent', a.detail->>'fromAgent', null, 'audit', a.at
  from audit_events a join tasks t on t.id = a.subject and t.tenant_id = a.tenant_id
 where a.action = 'task.reassign' and a.detail->>'fromAgent' is not null;
insert into task_owner_history(tenant_id, task_id, agent_id, owner_agent, owner_instance_id, source, at)
select t.tenant_id, t.id, i.agent_id, i.agent_id, a.detail->>'fromInstanceId', 'audit', a.at
  from audit_events a join tasks t on t.id = a.subject and t.tenant_id = a.tenant_id join agent_instances i on i.id = a.detail->>'fromInstanceId'
 where a.action = 'task.reassign';
insert into task_owner_history(tenant_id, task_id, agent_id, owner_agent, owner_instance_id, source, at)
select t.tenant_id, t.id, i.agent_id, i.agent_id, i.id, 'delegation', d.at
  from mission_delegations d join tasks t on t.id = d.task_id join agent_instances i on i.id = d.to_instance;
insert into task_owner_history(tenant_id, task_id, agent_id, owner_agent, owner_instance_id, source)
select t.tenant_id, t.id, coalesce(t.owner_agent, i.agent_id), t.owner_agent, t.owner_instance_id, 'backfill'
  from tasks t left join agent_instances i on i.id = t.owner_instance_id
 where t.owner_agent is not null or t.owner_instance_id is not null;

-- Append-only, same pattern as 0007/0031/0034: the one allowed DELETE is the cascade of a demo purge (axion.purge_demo, set by clearDemo).
create function task_owner_history_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger task_owner_history_no_update before update or delete on task_owner_history for each row execute function task_owner_history_append_only();
create trigger task_owner_history_no_truncate before truncate on task_owner_history for each statement execute function task_owner_history_append_only();

-- The recorder: SECURITY INVOKER is enough (the table has no other writers); it runs after the row is final.
create function task_owner_history_record() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.owner_agent is not distinct from old.owner_agent and new.owner_instance_id is not distinct from old.owner_instance_id then return null; end if;
  if tg_op = 'INSERT' and new.owner_agent is null and new.owner_instance_id is null then return null; end if;
  insert into task_owner_history(tenant_id, task_id, agent_id, owner_agent, owner_instance_id, source)
  values (new.tenant_id, new.id, coalesce(new.owner_agent, (select agent_id from agent_instances where id = new.owner_instance_id)), new.owner_agent, new.owner_instance_id,
          case when tg_op = 'INSERT' then 'insert' else 'change' end);
  return null;
end $$;
create trigger task_owner_history_ins after insert on tasks for each row execute function task_owner_history_record();
create trigger task_owner_history_upd after update of owner_agent, owner_instance_id on tasks for each row execute function task_owner_history_record();
