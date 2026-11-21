alter table task_attempts disable trigger task_attempts_no_update;
update task_attempts set started_at = coalesce(finished_at, now()) where started_at is null;
alter table task_attempts enable trigger task_attempts_no_update;
alter table task_attempts alter column started_at set default now(), alter column started_at set not null;
