drop trigger if exists approval_requests_no_truncate on approval_requests;
drop trigger if exists approval_requests_no_delete on approval_requests;
drop function if exists approval_requests_no_delete();
drop trigger if exists approval_requests_insert_guard on approval_requests;
drop function if exists approval_requests_insert_guard();
drop trigger if exists approval_requests_guard on approval_requests;
drop function if exists approval_requests_guard();
alter table approval_requests
  drop constraint if exists approval_consumed_only_if_approved,
  drop constraint if exists approval_consumed_pair,
  drop column if exists consumed_by, drop column if exists consumed_at, drop column if exists requested_by,
  drop column if exists target, drop column if exists origin, drop column if exists task_id, drop column if exists digest_version;
