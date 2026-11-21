drop table if exists task_attempts;
alter table tasks drop column if exists owner_instance_id, drop column if exists weight, drop column if exists criteria,
  drop column if exists evidence, drop column if exists col, drop column if exists row, drop column if exists simulated;
drop table if exists mission_delegations;
drop table if exists agent_instances;
drop function if exists instances_append_only();
