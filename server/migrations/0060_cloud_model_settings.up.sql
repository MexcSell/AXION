create table cloud_model_settings (
  tenant_id text not null references tenants(id) on delete cascade,
  model_id text not null,
  state text not null check (state in ('enabled', 'disabled', 'removed')),
  primary key (tenant_id, model_id)
);
