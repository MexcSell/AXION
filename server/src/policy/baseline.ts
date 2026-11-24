// The frozen baseline policy (spec §13.2). Code only: no table, no route writes it (invariant 10).
// Pattern: evolution/verdict.ts. A caller names nothing here; new policies are new versions added by a code change.
import type { Effect, RiskTier, Approver } from './types.ts';

export interface KindRule {
  readonly tier: RiskTier;
  readonly effect: Effect;
  /** 'any': always denied. 'agent': denied when an agent asks (a human still goes through the owner gate). */
  readonly prohibited?: 'any' | 'agent';
  readonly why: string;
}
export interface BaselinePolicy { readonly version: number; readonly source: string; readonly kinds: Readonly<Record<string, KindRule>> }

const r = (tier: RiskTier, effect: Effect, why: string, prohibited?: 'any' | 'agent'): KindRule => Object.freeze({ tier, effect, why, ...(prohibited ? { prohibited } : {}) });

export const BASELINE_POLICY_V1: BaselinePolicy = Object.freeze({
  version: 1,
  source: 'built-in',
  kinds: Object.freeze({
    // R0 observation: may execute under a covering grant
    read: r('R0', 'read', 'Reading a permitted page or record changes nothing.'),
    screenshot: r('R0', 'read', 'A screenshot only observes.'),
    summarize: r('R0', 'read', 'Summarising existing material changes nothing.'),
    render_local: r('R0', 'read', 'Local rendering leaves no outside trace.'),
    // R1 reversible preparation: bounded scope, audited
    fill_draft: r('R1', 'prepare', 'A draft form is filled but not submitted.'),
    transform_local: r('R1', 'prepare', 'A local data transformation can be undone.'),
    test_fixture: r('R1', 'prepare', 'A test fixture is local and reversible.'),
    // R2 external effect: a human approves the exact action
    submit_form: r('R2', 'external', 'Submitting a form reaches an outside system.'),
    send_message: r('R2', 'external', 'A sent message cannot be unsent.'),
    publish_post: r('R2', 'external', 'A published post is public.'),
    submit_bid: r('R2', 'external', 'A job bid commits the company outside.'),
    change_external_setting: r('R2', 'external', 'Changing an external account setting has outside effect.'),
    'browser-action': r('R2', 'external', 'A browser action that submits or changes something outside.'),
    // R3 infrastructure and organisation: Admin gate + tests + rollback
    release: r('R3', 'infra', 'A release updates what is live.'),
    update_live_site: r('R3', 'infra', 'Updating the live site changes production content.'),
    merge_source: r('R3', 'infra', 'Merging source changes the code base.'),
    move_agent_permissions: r('R3', 'infra', 'Moving agent permissions changes who can do what.'),
    add_integration: r('R3', 'infra', 'A new integration opens a new outside connection.'),
    rotate_credential: r('R3', 'infra', 'Rotating a credential can lock services out.'),
    'origin-grant': r('R3', 'infra', 'Granting an origin gives an agent standing access to a site.'),
    // R4 critical: Owner only; some actions are prohibited
    // c76 (parked): the one kind that can authorise recording a release that touches guardrail paths. Dedicated, so a record never spends an approval meant for a real deploy.
    'release-record': r('R4', 'critical', 'Recording a release that changes policy, approvals, audit, locks or migrations needs a critical-tier approval bound to that release.'),
    production_deploy: r('R4', 'critical', 'A production deployment is hard to reverse.'),
    irreversible_delete: r('R4', 'critical', 'Irreversible deletion cannot be undone.'),
    security_policy_rewrite: r('R4', 'critical', 'Rewriting the security policy: an agent may never do this.', 'agent'),
    autonomous_gate_change: r('R4', 'critical', 'No actor may switch an approval gate to autonomous.', 'any'),
  }),
});

/** Trusted registry: the only place policy comes from. */
export const BASELINE_POLICIES: Readonly<Record<number, BaselinePolicy>> = Object.freeze({ 1: BASELINE_POLICY_V1 });
export const CURRENT_BASELINE: BaselinePolicy = BASELINE_POLICY_V1;

export const approverFor = (tier: RiskTier): Approver | null => ({ R0: null, R1: null, R2: 'user', R3: 'admin', R4: 'owner' } as const)[tier];
