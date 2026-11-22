-- Improvement cycle 36 (Phase 2, P4): site grants. A grant lets agents of ONE mission use ONE exact origin for a bounded list of
-- low-risk capabilities for a limited time (spec §11 site_grants, browser.originGrant). Absent, expired and revoked grants deny.
-- The row stores the NORMALISED origin only (server/src/grants/origin.ts); the check below is a second, coarse fence behind the
-- service: lowercase https, plain host labels, optional non-default port, nothing else.
-- Append-only (except the demo purge cascade): a grant is revoked once (revoked_at, revoked_by, reason) and never edited or deleted. TRUNCATE is refused.
create table site_grants (
  id text primary key,                                              -- 'SG-' + 128 random bits
  tenant_id text not null references tenants(id),
  mission_id text not null references missions(id) on delete cascade,
  exact_origin text not null check (exact_origin ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(:([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?$'
    and exact_origin !~ '\.(localhost|local|internal|arpa|invalid)(:[0-9]+)?$' and length(exact_origin) <= 270),
  capabilities text[] not null check (cardinality(capabilities) between 1 and 8 and capabilities <@ array['read','screenshot','summarize','fill_draft']),
  issued_by text not null references users(id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text references users(id),
  reason text check (reason is null or length(reason) <= 500),
  check (expires_at > issued_at and expires_at <= issued_at + interval '30 days'),
  check ((revoked_at is null) = (revoked_by is null))
);
create index site_grants_lookup on site_grants(tenant_id, mission_id, exact_origin);
create index site_grants_tenant on site_grants(tenant_id, issued_at desc);

create function site_grants_guard() returns trigger language plpgsql as $$
begin
  -- the one allowed delete is the cascade of clearDemo, which sets the transaction-local flag axion.purge_demo (as 0007 and 0008 do)
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'site_grants is append-only'; end if;
  if old.revoked_at is not null then raise exception 'a revoked site grant never changes'; end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.mission_id <> old.mission_id or new.exact_origin <> old.exact_origin
     or new.capabilities <> old.capabilities or new.issued_by <> old.issued_by or new.issued_at <> old.issued_at or new.expires_at <> old.expires_at
  then raise exception 'a site grant can only be revoked'; end if;
  if new.revoked_at is null then raise exception 'a site grant can only be revoked'; end if;
  return new;
end $$;
create trigger site_grants_no_edit before update or delete on site_grants for each row execute function site_grants_guard();
create trigger site_grants_no_truncate before truncate on site_grants for each statement execute function site_grants_guard();
