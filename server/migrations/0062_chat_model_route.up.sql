-- Owner 2026-11-25: administrators choose which cloud models answer the GM and agent chats, in order of preference.
-- The first usable model answers; the model router moves to the next one when a model is disabled, removed, limited or failing.
create table chat_model_routes (
  tenant_id text primary key references tenants(id) on delete cascade,
  models text[] not null check (cardinality(models) between 1 and 20),
  updated_by text not null references users(id),
  updated_at timestamptz not null default now()
);
-- Owner 2026-11-25: a GM reply may carry a mission draft the person can create with one click (nothing executes).
alter table messages add column draft jsonb check (draft is null or jsonb_typeof(draft) = 'object');
