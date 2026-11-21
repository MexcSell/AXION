-- Stage 6 task 6 fix: a notification for one user only; unlike 'user', administrators do not see it.
alter table notifications drop constraint notifications_audience_check;
alter table notifications add constraint notifications_audience_check check (audience in ('all','admins','user','mission','owner'));
