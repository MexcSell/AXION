-- Stage 6 task 6: a member's private gm/agent channels must not reach administrators.
-- audience 'owner' = delivered only to audience_user (never to admins, unlike 'user').
alter table events drop constraint events_audience_check;
alter table events add constraint events_audience_check check (audience in ('all','admins','user','mission','owner'));
