-- c86 (R5-7, first slice): the forecast ledger. A person records, BEFORE the first review of a task exists, the probability that this first
-- review will be "accepted". One row per (task, forecaster), append-only: a forecast is never edited, deleted or replaced. The outcome is NOT
-- stored: it is read from task_reviews (the first row of the task by seq) every time, so no copy can drift from the review table.
-- Independent of 0058 (another lane's table): this file touches only its own table and function and references only tasks and missions.
create table forecasts (
  seq bigserial unique,
  id text primary key,                                    -- 'FC-' + 96 random bits
  tenant_id text not null references tenants(id),
  mission_id text not null references missions(id) on delete cascade,
  task_id text not null references tasks(id) on delete cascade,
  forecaster_id text not null,                            -- a user id, plain text (like task_reviews.reviewer_id): no cascading FK into an append-only table
  question text not null default 'first_review_accepted' check (question = 'first_review_accepted'),
  probability numeric(3,2) not null check (probability between 0.01 and 0.99),
  made_at timestamptz not null default now(),             -- the database clock, never a client value
  unique (task_id, forecaster_id, question)
);
create index forecasts_forecaster on forecasts(tenant_id, forecaster_id, seq);
create index forecasts_task on forecasts(task_id);

-- Append-only with the four guards (UPDATE, DELETE, TRUNCATE, and the one allowed DELETE, the demo purge, axion.purge_demo, set by clearDemo).
create function forecasts_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger forecasts_no_update before update or delete on forecasts for each row execute function forecasts_append_only();
create trigger forecasts_no_truncate before truncate on forecasts for each statement execute function forecasts_append_only();
