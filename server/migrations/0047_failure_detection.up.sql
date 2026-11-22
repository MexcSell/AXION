-- Improvement cycle 63 (Phase 2, R3-8): organisation-level failure learning.
-- 1. Optional detection fields on failure_tags: how a failure was noticed (channel), how long after it happened (computed by the
--    service from database timestamps, never sent by a caller), what part failed (mechanism), which control should have caught it and
--    which did. All nullable. "other" values need a note. Columns are written at tag time only: the decision trigger below makes them
--    as immutable as the rest of the row (append-only, as c33 and c60).
-- (see section 2 below) failure_pattern_candidates: one append-only row per recurrence pattern that opened a row in c41's lesson_candidates. c41's table is
--    not touched. The row names the failures behind the candidate and marks it as derived by the system from tool records.
alter table failure_tags
  add column detection_channel text check (detection_channel in ('test','audit','human_review','other_agent','reported_later')),
  add column detected_after_seconds bigint check (detected_after_seconds >= 0),
  add column mechanism text check (mechanism in ('instructions','context','tool','reasoning','handoff','environment','other')),
  add column control_expected text check (control_expected in ('test','review','approval','monitoring','validation','none','other')),
  add column control_caught text check (control_caught in ('test','review','approval','monitoring','validation','none','other')),
  add column detection_note text check (detection_note is null or length(btrim(detection_note)) between 1 and 300),
  add constraint failure_tags_detected_after_needs_channel check (detected_after_seconds is null or detection_channel is not null),
  add constraint failure_tags_other_needs_note check (detection_note is not null or (mechanism is distinct from 'other' and control_expected is distinct from 'other' and control_caught is distinct from 'other'));

create or replace function failure_tags_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'failure_tags is append-only'; end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
    raise exception 'failure_tags is append-only';
  end if;
  if old.status <> 'proposed' then raise exception 'a decided failure tag never changes'; end if;
  if new.status = 'proposed' or new.decided_by is null or new.decided_at is null then raise exception 'a failure tag can only be decided'; end if;
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.mission_id is distinct from old.mission_id
     or new.subject_kind is distinct from old.subject_kind or new.subject_id is distinct from old.subject_id
     or new.taxonomy_version is distinct from old.taxonomy_version or new.mode_id is distinct from old.mode_id
     or new.note is distinct from old.note or new.tagged_by is distinct from old.tagged_by
     or new.tagged_by_kind is distinct from old.tagged_by_kind or new.created_at is distinct from old.created_at
     or new.detection_channel is distinct from old.detection_channel or new.detected_after_seconds is distinct from old.detected_after_seconds
     or new.mechanism is distinct from old.mechanism or new.control_expected is distinct from old.control_expected
     or new.control_caught is distinct from old.control_caught or new.detection_note is distinct from old.detection_note
  then raise exception 'a failure tag can only be decided'; end if;
  if new.self_confirmed is distinct from (new.status = 'confirmed' and old.tagged_by_kind = 'user' and new.decided_by = old.tagged_by)
  then raise exception 'self_confirmed must record whether the tagger confirmed their own tag'; end if;
  return new;
end $$;

-- 2. One row per recurrence pattern that opened a candidate. The candidate itself is an ordinary row of c41's lesson_candidates (proposed,
--    never active); this row says which failures it came from and that the system derived it from stored records (tool records), not a person.
--    candidate_id has no foreign key on purpose: a referenced lesson_candidates could no longer be TRUNCATE-refused by its own guard (as c60's tag_id).
create table failure_pattern_candidates (
  id text primary key,                                          -- 'FP-' + 128 random bits
  tenant_id text not null references tenants(id),
  mode_id text not null check (mode_id ~ '^FM-[0-9]+\.[0-9]+$'),
  window_days int not null check (window_days in (7, 30, 90)),
  candidate_id text not null unique,
  failure_count int not null check (failure_count >= 3),        -- distinct failed tasks
  department_count int not null check (department_count >= 2),
  departments jsonb not null check (jsonb_typeof(departments) = 'array'),
  task_ids jsonb not null check (jsonb_typeof(task_ids) = 'array'),
  tag_ids jsonb not null check (jsonb_typeof(tag_ids) = 'array'),
  origin text not null default 'system_failure_pattern' check (origin = 'system_failure_pattern'),
  created_at timestamptz not null default now()
);
create index failure_pattern_candidates_pattern on failure_pattern_candidates(tenant_id, mode_id, window_days, created_at desc);
create function failure_pattern_candidates_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception 'failure_pattern_candidates is append-only';
end $$;
create trigger failure_pattern_candidates_no_edit before update or delete on failure_pattern_candidates for each row execute function failure_pattern_candidates_guard();
create trigger failure_pattern_candidates_no_truncate before truncate on failure_pattern_candidates for each statement execute function failure_pattern_candidates_guard();
