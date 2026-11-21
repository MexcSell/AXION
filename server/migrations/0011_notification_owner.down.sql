delete from notifications where audience = 'owner';
alter table notifications drop constraint notifications_audience_check;
alter table notifications add constraint notifications_audience_check check (audience in ('all','admins','user','mission'));
