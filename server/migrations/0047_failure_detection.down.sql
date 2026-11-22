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
  then raise exception 'a failure tag can only be decided'; end if;
  if new.self_confirmed is distinct from (new.status = 'confirmed' and old.tagged_by_kind = 'user' and new.decided_by = old.tagged_by)
  then raise exception 'self_confirmed must record whether the tagger confirmed their own tag'; end if;
  return new;
end $$;
alter table failure_tags drop constraint failure_tags_detected_after_needs_channel, drop constraint failure_tags_other_needs_note,
  drop column detection_channel, drop column detected_after_seconds, drop column mechanism, drop column control_expected, drop column control_caught, drop column detection_note;
