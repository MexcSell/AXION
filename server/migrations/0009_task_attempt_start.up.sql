-- Stage 6 task 5: a retry appends an attempt that has not started yet (nothing executes in Stage 6), so started_at may be empty.
alter table task_attempts alter column started_at drop not null, alter column started_at drop default;
