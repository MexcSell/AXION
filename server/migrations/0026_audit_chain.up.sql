-- c31 (Phase 2, P5): tamper-evident audit chain. Each audit_events row stores its per-tenant sequence number, the hash of
-- the previous row (prev_hash) and its own hash (row_hash = the spec's chain_ref):
--   row_hash = sha256(prev_hash || E'\n' || canonical({tenantId, seq, at, actor, action, subject, result, correlationId, detail}))
-- The first row of a tenant links to 64 zeros. canonical() is server/src/approvals/service.ts: keys sorted, no spaces;
-- `at` is the UTC microsecond ISO text. The append-only triggers of 0001 stay (UPDATE, DELETE, TRUNCATE are refused).
-- Locking: ALTER TABLE takes ACCESS EXCLUSIVE on audit_events for the whole migration (the table is read and written by
-- every request), and the backfill rewrites every row once. Run it with the server stopped or during a quiet minute.
alter table audit_events add column seq bigint, add column prev_hash text, add column row_hash text;

-- SQL twin of canonical(): sorted keys (byte order, as UTF-16 order for all but astral characters), JSON scalars.
drop function if exists pg_temp.audit_canon(jsonb);
create function pg_temp.audit_canon(j jsonb) returns text language plpgsql immutable as $$
begin
  if jsonb_typeof(j) = 'object' then
    return '{' || coalesce((select string_agg(to_jsonb(e.key)::text || ':' || pg_temp.audit_canon(e.value), ',' order by e.key collate "C") from jsonb_each(j) e), '') || '}';
  elsif jsonb_typeof(j) = 'array' then
    return '[' || coalesce((select string_agg(pg_temp.audit_canon(e.value), ',' order by e.ord) from jsonb_array_elements(j) with ordinality e(value, ord)), '') || ']';
  end if;
  return j::text;
end $$;

-- The backfill is the one legitimate rewrite of old rows: the update trigger is off only inside this transaction.
alter table audit_events disable trigger audit_events_no_update;
do $$
declare r record; t text; n bigint := 0; prev text := repeat('0', 64); h text;
begin
  for r in select id, tenant_id, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_txt, actor, action, subject, result, correlation_id, detail
           from audit_events order by tenant_id collate "C", id loop
    if t is distinct from r.tenant_id then t := r.tenant_id; n := 0; prev := repeat('0', 64); end if;
    n := n + 1;
    h := encode(sha256(convert_to(prev || E'\n' ||
      '{"action":' || to_jsonb(r.action)::text || ',"actor":' || to_jsonb(r.actor)::text || ',"at":' || to_jsonb(r.at_txt)::text ||
      ',"correlationId":' || to_jsonb(r.correlation_id)::text || ',"detail":' || pg_temp.audit_canon(r.detail) ||
      ',"result":' || to_jsonb(r.result)::text || ',"seq":' || n || ',"subject":' || to_jsonb(r.subject)::text || ',"tenantId":' || to_jsonb(r.tenant_id)::text || '}', 'UTF8')), 'hex');
    update audit_events set seq = n, prev_hash = prev, row_hash = h where id = r.id;
    prev := h;
  end loop;
end $$;
alter table audit_events enable trigger audit_events_no_update;
drop function pg_temp.audit_canon(jsonb);

alter table audit_events alter column seq set not null, alter column prev_hash set not null, alter column row_hash set not null;
alter table audit_events add constraint audit_events_tenant_seq unique (tenant_id, seq);

-- Decision tables (c31 review of what lacks a guard): approval_decisions had update/delete protection but no TRUNCATE guard.
create function approval_decisions_no_truncate() returns trigger language plpgsql as $$
begin
  raise exception 'approval_decisions is append-only';
end $$;
create trigger approval_decisions_no_truncate before truncate on approval_decisions for each statement execute function approval_decisions_no_truncate();
