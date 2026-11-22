drop trigger if exists approval_decisions_no_truncate on approval_decisions;
alter table audit_events drop constraint audit_events_tenant_seq;
alter table audit_events drop column row_hash, drop column prev_hash, drop column seq;
drop function if exists approval_decisions_no_truncate();
