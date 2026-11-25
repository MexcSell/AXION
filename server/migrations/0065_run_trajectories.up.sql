-- Phase A (A1, R6-3 first slice): the run trajectory record. Records only: nothing executes, no model is called, no run exists yet; the only writer today is a
-- scripted fake executor in the tests. Both tables are append-only (same shape as 0057) and tenant-scoped.
-- A run is written ONCE, when it has finished, together with all its steps and one anchor row in the audit log (action run.trajectory.recorded), in one transaction.
-- step_hash = sha256 over the canonical JSON of the step and the previous step's hash; head_hash is the hash of the last step; run_digest covers the run's own fields.
-- The cost columns keep "unknown" apart from zero: cost_status 'known' needs a number, 'unknown' stores NULL (never 0), and the sum of the known step costs is kept
-- separately as a labelled lower bound.
create table run_trajectories (
  tenant_id text not null,
  id text not null check (length(id) between 1 and 120),
  job_ref text check (job_ref is null or length(job_ref) between 1 and 120),      -- the lease or job this run belongs to, when there is one
  task_class text not null check (length(task_class) between 1 and 120),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  final_claim text not null check (final_claim in ('success','failure','none')),
  env_check jsonb,                                                                -- the final environment-state check; null when none was recorded
  step_count int not null check (step_count >= 0),
  tokens_total bigint check (tokens_total is null or tokens_total >= 0),          -- null = unknown
  cost_status text not null check (cost_status in ('known','unknown')),
  cost_micros bigint check (cost_micros is null or cost_micros >= 0),             -- fixed-point millionths of one currency unit; null = unknown, never 0
  cost_lower_bound_micros bigint not null check (cost_lower_bound_micros >= 0),   -- sum of the known step costs; a lower bound, not the cost, when unknown
  cost_missing_steps int not null check (cost_missing_steps >= 0),                -- executed steps that reported no cost
  profile_sha256 text check (profile_sha256 is null or profile_sha256 ~ '^[0-9a-f]{64}$'),
  caps jsonb check (caps is null or jsonb_typeof(caps) = 'object'),
  breaker jsonb not null check (jsonb_typeof(breaker) = 'object'),
  head_hash text not null check (head_hash ~ '^[0-9a-f]{64}$'),
  run_digest text not null check (run_digest ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  primary key (tenant_id, id),
  check (ended_at >= started_at),
  constraint run_trajectories_cost_known check ((cost_status = 'known') = (cost_micros is not null))
);
create index run_trajectories_recent on run_trajectories(tenant_id, recorded_at desc, id);

create table trajectory_steps (
  tenant_id text not null,
  run_id text not null,
  seq int not null check (seq >= 1),
  model_request_hash text check (model_request_hash is null or model_request_hash ~ '^[0-9a-f]{64}$'),
  tool text not null check (length(tool) between 1 and 120),
  args jsonb not null,                                                            -- REDACTED before it is hashed and stored
  redactions int not null check (redactions >= 0),
  inputs jsonb not null,
  decision jsonb not null,
  policy_decision_id text not null check (length(policy_decision_id) between 1 and 120),
  executed boolean not null,
  ok boolean,
  result_hash text check (result_hash is null or result_hash ~ '^[0-9a-f]{64}$'), -- the result itself is not stored (untrusted content), only its hash
  approval_id text check (approval_id is null or length(approval_id) between 1 and 120),
  credential_handle_id text check (credential_handle_id is null or length(credential_handle_id) between 1 and 120),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  tokens bigint check (tokens is null or tokens >= 0),                            -- null = unknown
  tool_cost_micros bigint check (tool_cost_micros is null or tool_cost_micros >= 0),
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  step_hash text not null check (step_hash ~ '^[0-9a-f]{64}$'),
  primary key (tenant_id, run_id, seq),
  foreign key (tenant_id, run_id) references run_trajectories(tenant_id, id),
  check (ended_at >= started_at),
  -- a step that did not run has no outcome, result, tokens or cost; a step that ran says whether it succeeded
  constraint trajectory_steps_outcome check ((executed and ok is not null) or (not executed and ok is null and result_hash is null and tokens is null and tool_cost_micros is null))
);

create function trajectory_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger run_trajectories_no_update before update or delete on run_trajectories for each row execute function trajectory_append_only();
create trigger run_trajectories_no_truncate before truncate on run_trajectories for each statement execute function trajectory_append_only();
create trigger trajectory_steps_no_update before update or delete on trajectory_steps for each row execute function trajectory_append_only();
create trigger trajectory_steps_no_truncate before truncate on trajectory_steps for each statement execute function trajectory_append_only();
