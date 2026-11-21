drop table if exists org_edges;
drop table if exists org_revisions;
alter table agent_definitions drop constraint if exists agent_definitions_active_version;
drop table if exists agent_versions;
drop table if exists agent_definitions;
drop function if exists agents_append_only();
