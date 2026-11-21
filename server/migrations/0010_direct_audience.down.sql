-- events is append-only; the 'owner' rows are removed under the same trigger bypass the demo purge uses, then the check is restored.
alter table events disable trigger events_no_update;
delete from events where audience = 'owner';
alter table events enable trigger events_no_update;
alter table events drop constraint events_audience_check;
alter table events add constraint events_audience_check check (audience in ('all','admins','user','mission'));
