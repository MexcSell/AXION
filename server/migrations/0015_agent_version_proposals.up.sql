-- Improvement cycle 5: agent version proposals. A proposal is a candidate configuration ({model, skills, tools}) made
-- against the agent's active version when it was proposed (base_version_id; base_sha = that version's prompt_hash).
-- Another administrator promotes it once: a NEW immutable agent_versions row (agent_versions stays append-only) that
-- becomes the active version; promoted_version_id is that row. Rollback needs no table: it is a new version too.
create table agent_version_proposals (
  id text primary key,                                    -- 'VP-' + 128 random bits
  tenant_id text not null references tenants(id),
  agent_id text not null references agent_definitions(id),
  base_version_id uuid not null references agent_versions(id),
  base_sha text not null,
  candidate jsonb not null,                               -- {model, skills, tools}
  candidate_sha text not null,                            -- promptHash(candidate): equals the promoted version's prompt_hash
  title text not null,
  hypothesis text not null default '',
  status text not null default 'pending' check (status in ('pending','promoted','rejected','withdrawn','expired')),
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  decided_by text,
  decided_at timestamptz,
  note text,
  promoted_version_id uuid references agent_versions(id),
  check (jsonb_typeof(candidate) = 'object'),
  check ((status = 'promoted') = (promoted_version_id is not null))
);
create unique index agent_version_proposals_pending on agent_version_proposals(tenant_id, agent_id, candidate_sha) where status = 'pending';
create index agent_version_proposals_tenant on agent_version_proposals(tenant_id, created_at desc);
create index agent_version_proposals_agent on agent_version_proposals(agent_id, created_at desc);
