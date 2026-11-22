-- c66 (R3-4): human audit labels for the scorecard rows. A person re-checks a sample of the units a row counted and records what the
-- metric said (metric_label) next to what they found (audit_label). Append-only: a correction is a new row, and the latest row of
-- a (metric, sample) counts. The table feeds a display-only flag; nothing reads it to decide anything.
create table metric_audit_labels (
  id bigserial primary key,
  tenant_id text not null,
  metric_id text not null check (length(metric_id) between 1 and 120),
  sample_ref text not null check (length(sample_ref) between 1 and 120),
  metric_label boolean not null,
  audit_label boolean not null,
  audited_by text not null,
  note text check (note is null or length(note) <= 300),
  audited_at timestamptz not null default now()
);
create index metric_audit_labels_metric on metric_audit_labels(tenant_id, metric_id, sample_ref, id desc);

-- Append-only with the four guards (UPDATE, DELETE, TRUNCATE, and the one allowed DELETE, the demo purge, axion.purge_demo, set by clearDemo).
create function metric_audit_labels_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger metric_audit_labels_no_update before update or delete on metric_audit_labels for each row execute function metric_audit_labels_append_only();
create trigger metric_audit_labels_no_truncate before truncate on metric_audit_labels for each statement execute function metric_audit_labels_append_only();
