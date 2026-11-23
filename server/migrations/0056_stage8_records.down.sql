drop table if exists artifact_versions;
drop table if exists artifacts;
drop function if exists artifact_versions_check();
drop table if exists release_marks;
drop table if exists releases;
drop function if exists releases_check();
drop function if exists release_digest(text, text, text[]);
drop function if exists release_marks_check();
drop function if exists stage8_append_only();
