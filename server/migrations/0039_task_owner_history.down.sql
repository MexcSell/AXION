drop trigger if exists task_owner_history_ins on tasks;
drop trigger if exists task_owner_history_upd on tasks;
drop function if exists task_owner_history_record();
drop table if exists task_owner_history;
drop function if exists task_owner_history_append_only();
