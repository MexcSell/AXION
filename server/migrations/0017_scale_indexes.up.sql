-- Cycle 10 (performance P1): indexes for the scorecard (cycle 2) and agent reliability (cycle 3) reads, which filter
-- events / audit_events by tenant + type/action + subject and join tasks by mission. Plain CREATE INDEX (not
-- CONCURRENTLY: migrations run in a transaction). It takes a SHARE lock that blocks writes to the table while it
-- builds; on today's small live database that is milliseconds. No query semantics change.
create index events_tenant_type_subject on events (tenant_id, type, subject_id);
create index audit_events_tenant_action_subject on audit_events (tenant_id, action, subject);
create index tasks_mission on tasks (mission_id);
create index tasks_owner_instance on tasks (owner_instance_id) where owner_instance_id is not null;
create index mission_runs_mission on mission_runs (mission_id, started_at);
