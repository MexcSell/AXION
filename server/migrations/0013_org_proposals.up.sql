-- Improvement cycle 1: organisation change proposals. A proposal is the full proposed set of reporting lines against the
-- revision that was active when it was made (base_revision = org_revisions.seq). Approval applies it once, as a new
-- org revision (org_revisions/org_edges stay append-only); applied_revision is that revision's seq.
create table org_proposals (
  id text primary key,
  tenant_id text not null references tenants(id),
  title text not null,
  why text not null default '',
  base_revision int not null,
  edges jsonb not null,                       -- [{supervisor, subordinate, edge_type}]
  payload_sha text not null,                  -- sha256 of canonical title + why + base_revision + sorted edges
  status text not null default 'pending' check (status in ('pending','approved','rejected','applied','failed','expired','withdrawn')),
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  applied_revision int,
  result jsonb not null default '{}'::jsonb,  -- the dry-run report at creation
  check (jsonb_typeof(edges) = 'array'),
  check ((status = 'applied') = (applied_revision is not null))
);
create unique index org_proposals_pending_sha on org_proposals(tenant_id, payload_sha) where status = 'pending';
create index org_proposals_tenant on org_proposals(tenant_id, created_at desc);
