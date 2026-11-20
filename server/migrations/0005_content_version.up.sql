-- Review I2: If-Match protects what people edit (title, kind, priority, text, criteria).
-- System writes (staffing steps, approval counts, state changes) bump row_version only.
alter table missions add column content_version int not null default 1;
