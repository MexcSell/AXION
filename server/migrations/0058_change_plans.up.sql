-- c85 (R5-1, first slice): the plan record of an organisation change proposal.
-- A plan is a record of what was planned BEFORE a change (primary metric, direction, margin, minimum n, window, guardrails, why), so the
-- metric cannot be chosen after the data is seen. It is not pre-registration in the statistical sense and gives no verdict.
--   plan      the plan, set or replaced only while the proposal is pending (null = the proposal has no plan; old rows stay null)
--   plan_sha  sha256 of the canonical plan, fixed at approval in the same statement that sets status = 'applied'
-- After the proposal leaves 'pending' the plan columns are locked by a trigger, so not even a direct write changes them.
alter table org_proposals
  add column plan jsonb,
  add column plan_sha text,
  add constraint org_proposals_plan_object check (plan is null or jsonb_typeof(plan) = 'object'),
  add constraint org_proposals_plan_sha_form check (plan_sha is null or (plan is not null and plan_sha ~ '^[0-9a-f]{64}$')),
  add constraint org_proposals_plan_sha_at_approval check (not (status = 'applied' and plan is not null and plan_sha is null));

create function org_proposals_plan_lock() returns trigger language plpgsql as $$
begin
  if old.status <> 'pending' and (new.plan is distinct from old.plan or new.plan_sha is distinct from old.plan_sha) then
    raise exception 'the plan of a proposal that is no longer pending is locked (proposal %)', old.id;
  end if;
  return new;
end $$;
create trigger org_proposals_plan_lock before update on org_proposals for each row execute function org_proposals_plan_lock();

-- After approval a change to the plan is an amendment: the new values, a reason, who, and the database clock. One row per amendment, never edited.
create table org_plan_amendments (
  id bigserial primary key,
  tenant_id text not null references tenants(id),
  proposal_id text not null references org_proposals(id),
  seq int not null check (seq >= 1),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  plan_sha text not null check (plan_sha ~ '^[0-9a-f]{64}$'),
  reason text not null check (length(btrim(reason)) >= 20 and length(reason) <= 1000),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (proposal_id, seq)
);
create index org_plan_amendments_tenant on org_plan_amendments(tenant_id, proposal_id, seq);

-- Append-only with the four guards (UPDATE, DELETE, TRUNCATE, and the one allowed DELETE, the demo purge, axion.purge_demo, set by clearDemo).
create function org_plan_amendments_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger org_plan_amendments_no_update before update or delete on org_plan_amendments for each row execute function org_plan_amendments_append_only();
create trigger org_plan_amendments_no_truncate before truncate on org_plan_amendments for each statement execute function org_plan_amendments_append_only();
