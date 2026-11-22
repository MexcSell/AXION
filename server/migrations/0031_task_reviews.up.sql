-- Improvement cycle 38: independent task review (spec invariant 5: a "verified" item references evidence and a verifier
-- distinct from its producing actor). One append-only row says who checked what, against which criteria, with what evidence.
-- The producer is derived on the server from the task's owner (its agent instance, with that instance's PINNED version model);
-- the principal is the mission owner who commissioned the work. A reviewer may be neither of them, and two agents may not
-- share a model family (a model prefers its own family's output; 2404.13076). The family is stored at review time.
create table task_reviews (
  seq bigserial unique,
  id text primary key,                                    -- 'TR-' + 96 random bits
  tenant_id text not null references tenants(id),
  mission_id text not null references missions(id) on delete cascade,
  task_id text not null references tasks(id) on delete cascade,
  attempt_id bigint references task_attempts(id) on delete cascade,
  reviewer_id text not null,
  reviewer_kind text not null check (reviewer_kind in ('user','agent')),
  reviewer_model_family text,
  producer_id text not null,
  producer_kind text not null check (producer_kind in ('user','agent')),
  producer_model_family text,
  principal_id text not null,                             -- the mission owner at review time (the person the producer worked for)
  rubric jsonb not null check (jsonb_typeof(rubric) = 'array' and jsonb_array_length(rubric) between 1 and 30),
  verdict text not null check (verdict in ('accepted','changes_requested','rejected')),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 20),
  created_at timestamptz not null default now(),
  check (reviewer_id <> producer_id),
  check (reviewer_id <> principal_id),
  check (verdict <> 'accepted' or jsonb_array_length(evidence) >= 1),
  check (reviewer_kind <> 'user' or reviewer_model_family is null),
  -- two agents: both families must be known and different (a NULL comparison would pass silently, so it is spelled out)
  check (reviewer_kind <> 'agent' or producer_kind <> 'agent'
         or (reviewer_model_family is not null and producer_model_family is not null and reviewer_model_family <> producer_model_family))
);
create index task_reviews_task on task_reviews(task_id, seq);
create index task_reviews_mission on task_reviews(mission_id, seq);
create index task_reviews_tenant on task_reviews(tenant_id, created_at desc);

-- Append-only. The one allowed delete is the cascade of a purge that sets the transaction-local flag axion.purge_demo (clearDemo only).
create function task_reviews_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger task_reviews_no_update before update or delete on task_reviews for each row execute function task_reviews_append_only();
create trigger task_reviews_no_truncate before truncate on task_reviews for each statement execute function task_reviews_append_only();
