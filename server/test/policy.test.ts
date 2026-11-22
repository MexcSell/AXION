import { describe, it, expect } from 'vitest';
import { evaluate, BASELINE_POLICY_V1, BASELINE_POLICIES, REASON_CODES, TIERS, tierRank, type Action, type Grant, type ReasonCode, type RiskTier, type TenantPolicy } from '../src/policy/index.ts';

const NOW = 1_800_000_000_000;
const user = { id: 'u-1', kind: 'user' as const, role: 'admin' };
const agent = { id: 'release-01', kind: 'agent' as const, role: 'release' };
const act = (kind: string, over: Partial<Action> = {}): Action => ({ kind, requester: agent, effect: 'read', payload: {}, ...over });
const grant = (over: Partial<Grant> = {}): Grant => ({ id: 'g-1', subjectId: agent.id, kinds: ['read', 'fill_draft', 'screenshot'], expiresAt: NOW + 60_000, ...over });
const ev = (a: Action, g: Grant[] = [], t: TenantPolicy = {}) => evaluate(a, g, t, NOW);

describe('policy: baseline registry', () => {
  it('is versioned, frozen and in the registry', () => {
    expect(BASELINE_POLICY_V1.version).toBe(1);
    expect(BASELINE_POLICIES[1]).toBe(BASELINE_POLICY_V1);
    expect(Object.isFrozen(BASELINE_POLICY_V1)).toBe(true);
    expect(Object.isFrozen(BASELINE_POLICY_V1.kinds)).toBe(true);
    expect(Object.isFrozen(BASELINE_POLICY_V1.kinds.release)).toBe(true);
    expect(Object.isFrozen(BASELINE_POLICIES)).toBe(true);
  });
  it('covers every tier R0-R4', () => {
    const tiers = new Set(Object.values(BASELINE_POLICY_V1.kinds).map((k) => k.tier));
    expect([...tiers].sort()).toEqual([...TIERS]);
  });
  it('lists prohibited R4 kinds', () => {
    const p = Object.entries(BASELINE_POLICY_V1.kinds).filter(([, k]) => k.prohibited);
    expect(p.map(([k]) => k).sort()).toEqual(['autonomous_gate_change', 'security_policy_rewrite']);
    expect(p.every(([, k]) => k.tier === 'R4')).toBe(true);
  });
});

describe('policy: tiers per baseline kind', () => {
  const cases: [string, RiskTier][] = [
    ['read', 'R0'], ['screenshot', 'R0'], ['summarize', 'R0'], ['render_local', 'R0'],
    ['fill_draft', 'R1'], ['transform_local', 'R1'], ['test_fixture', 'R1'],
    ['submit_form', 'R2'], ['send_message', 'R2'], ['publish_post', 'R2'], ['submit_bid', 'R2'], ['change_external_setting', 'R2'], ['browser-action', 'R2'],
    ['release', 'R3'], ['update_live_site', 'R3'], ['merge_source', 'R3'], ['move_agent_permissions', 'R3'], ['add_integration', 'R3'], ['rotate_credential', 'R3'], ['origin-grant', 'R3'],
    ['production_deploy', 'R4'], ['irreversible_delete', 'R4'],
  ];
  it.each(cases)('%s is %s', (kind, tier) => {
    const g = grant({ kinds: [kind] });
    expect(ev(act(kind), [g]).tier).toBe(tier);
    expect(BASELINE_POLICY_V1.kinds[kind].tier).toBe(tier);
  });
});

describe('policy: R0 observation', () => {
  it('is allowed with a covering grant', () => {
    expect(ev(act('read'), [grant()])).toMatchObject({ outcome: 'allow', tier: 'R0', approver: null, policyVersion: 1 });
  });
  it('is denied without a grant (no_grant)', () => {
    expect(ev(act('read'))).toMatchObject({ outcome: 'deny', tier: 'R0' });
    expect(ev(act('read')).reasons).toContain('no_grant');
  });
  it('is denied when the grant is expired (grant_expired)', () => {
    const d = ev(act('read'), [grant({ expiresAt: NOW - 1 })]);
    expect(d.outcome).toBe('deny');
    expect(d.reasons).toContain('grant_expired');
  });
  it('treats a grant that expires exactly now as expired', () => {
    expect(ev(act('read'), [grant({ expiresAt: NOW })]).reasons).toContain('grant_expired');
  });
  it('is denied when the grant belongs to another subject', () => {
    expect(ev(act('read'), [grant({ subjectId: 'someone-else' })]).reasons).toContain('no_grant');
  });
  it('is denied when the grant lists another kind', () => {
    expect(ev(act('read'), [grant({ kinds: ['screenshot'] })]).reasons).toContain('no_grant');
  });
  it('honours a target-limited grant', () => {
    const g = grant({ target: 'status.example.com' });
    expect(ev(act('read', { target: 'status.example.com' }), [g]).outcome).toBe('allow');
    expect(ev(act('read', { target: 'other.example.com' }), [g]).outcome).toBe('deny');
    expect(ev(act('read'), [g]).outcome).toBe('deny');
  });
  it('matches the grant target against the origin when there is no target', () => {
    expect(ev(act('read', { origin: 'status.example.com' }), [grant({ target: 'status.example.com' })]).outcome).toBe('allow');
  });
  it('honours a mission-limited grant', () => {
    const g = grant({ missionId: 'M-1' });
    expect(ev(act('read', { missionId: 'M-1' }), [g]).outcome).toBe('allow');
    expect(ev(act('read', { missionId: 'M-2' }), [g]).outcome).toBe('deny');
  });
  it('uses a still-valid grant when another one is expired', () => {
    expect(ev(act('read'), [grant({ expiresAt: NOW - 5 }), grant({ id: 'g-2' })]).outcome).toBe('allow');
  });
  it('also needs a grant for a human requester', () => {
    expect(ev(act('read', { requester: user }), []).reasons).toContain('no_grant');
    expect(ev(act('read', { requester: user }), [grant({ subjectId: user.id })]).outcome).toBe('allow');
  });
});

describe('policy: R1 reversible preparation', () => {
  it('is allowed for an agent inside its grant, with an audit reason', () => {
    const d = ev(act('fill_draft', { effect: 'prepare' }), [grant()]);
    expect(d).toMatchObject({ outcome: 'allow', tier: 'R1' });
    expect(d.reasons).toContain('audit_required');
  });
  it('is denied for an agent outside its scope (out_of_scope)', () => {
    const d = ev(act('fill_draft', { effect: 'prepare' }), [grant({ kinds: ['read'] })]);
    expect(d.outcome).toBe('deny');
    expect(d.reasons).toContain('out_of_scope');
  });
  it('reports an expired grant for an agent', () => {
    expect(ev(act('fill_draft', { effect: 'prepare' }), [grant({ expiresAt: NOW - 1 })]).reasons).toContain('grant_expired');
  });
  it('is allowed for a human without a grant', () => {
    expect(ev(act('fill_draft', { effect: 'prepare', requester: user }))).toMatchObject({ outcome: 'allow', tier: 'R1' });
  });
});

describe('policy: R2, R3, R4 need a human', () => {
  it('R2 needs the requesting user to approve', () => {
    const d = ev(act('submit_form', { effect: 'external' }));
    expect(d).toMatchObject({ outcome: 'needs_approval', tier: 'R2', approver: 'user' });
    expect(d.reasons).toContain('approval_user');
  });
  it('R3 needs an admin', () => {
    const d = ev(act('release', { effect: 'infra' }));
    expect(d).toMatchObject({ outcome: 'needs_approval', tier: 'R3', approver: 'admin' });
    expect(d.reasons).toContain('approval_admin');
  });
  it('R4 needs the owner', () => {
    const d = ev(act('production_deploy', { effect: 'critical' }));
    expect(d).toMatchObject({ outcome: 'needs_approval', tier: 'R4', approver: 'owner' });
    expect(d.reasons).toContain('approval_owner');
  });
  it('a grant never turns R2 into allow', () => {
    expect(ev(act('submit_form', { effect: 'external' }), [grant({ kinds: ['submit_form'] })]).outcome).toBe('needs_approval');
  });
  it('a grant never turns R3 or R4 into allow', () => {
    expect(ev(act('release'), [grant({ kinds: ['release', 'production_deploy'] })]).outcome).toBe('needs_approval');
    expect(ev(act('production_deploy'), [grant({ kinds: ['production_deploy'] })]).outcome).toBe('needs_approval');
  });
  it('a human requester also needs approval above R1', () => {
    expect(ev(act('release', { requester: user })).outcome).toBe('needs_approval');
  });
});

describe('policy: agent ceiling', () => {
  it('an agent never reaches allow above R1, for any known kind, with every kind granted', () => {
    const all = grant({ kinds: Object.keys(BASELINE_POLICY_V1.kinds) });
    for (const kind of Object.keys(BASELINE_POLICY_V1.kinds)) {
      const d = ev(act(kind), [all]);
      if (d.outcome === 'allow') expect(tierRank(d.tier)).toBeLessThanOrEqual(1);
    }
  });
});

describe('policy: prohibited R4', () => {
  it('an autonomous gate change is denied for an agent', () => {
    const d = ev(act('autonomous_gate_change', { effect: 'critical' }));
    expect(d).toMatchObject({ outcome: 'deny', tier: 'R4' });
    expect(d.reasons).toContain('prohibited');
  });
  it('an autonomous gate change is denied for the owner too', () => {
    expect(ev(act('autonomous_gate_change', { effect: 'critical', requester: user })).outcome).toBe('deny');
  });
  it('a security policy rewrite by an agent is denied', () => {
    expect(ev(act('security_policy_rewrite', { effect: 'critical' })).reasons).toContain('prohibited');
  });
  it('a security policy rewrite by a human still needs the owner', () => {
    expect(ev(act('security_policy_rewrite', { effect: 'critical', requester: user }))).toMatchObject({ outcome: 'needs_approval', approver: 'owner' });
  });
  it('a tenant policy cannot un-prohibit anything', () => {
    expect(ev(act('autonomous_gate_change'), [], { minTier: { autonomous_gate_change: 'R0' } }).outcome).toBe('deny');
  });
});

describe('policy: unknown kinds', () => {
  it('an unknown kind is denied as R4 (unknown_action)', () => {
    expect(ev(act('make_coffee'))).toMatchObject({ outcome: 'deny', tier: 'R4', reasons: ['unknown_action'] });
  });
  it('object-prototype names are unknown, not inherited', () => {
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(ev(act(k)).reasons).toEqual(['unknown_action']);
  });
  it('the empty kind is unknown', () => {
    expect(ev(act('')).outcome).toBe('deny');
  });
  it('a tenant policy cannot make an unknown kind known', () => {
    expect(ev(act('make_coffee'), [], { minTier: { make_coffee: 'R0' } }).outcome).toBe('deny');
  });
});

describe('policy: effect label', () => {
  it('a caller cannot lower a tier by labelling the effect "read"', () => {
    expect(ev(act('release', { effect: 'read' })).tier).toBe('R3');
  });
  it('a higher effect label raises the tier (effect_raises_tier)', () => {
    const d = ev(act('read', { effect: 'external' }), [grant()]);
    expect(d.tier).toBe('R2');
    expect(d.outcome).toBe('needs_approval');
    expect(d.reasons).toContain('effect_raises_tier');
  });
  it('a critical effect on a low kind needs the owner', () => {
    expect(ev(act('fill_draft', { effect: 'critical' }), [grant()])).toMatchObject({ tier: 'R4', approver: 'owner' });
  });
});

describe('policy: tenant/owner policy tightens only', () => {
  it('raises a tier (tenant_raised_tier)', () => {
    const d = ev(act('submit_form', { effect: 'external' }), [], { minTier: { submit_form: 'R3' } });
    expect(d).toMatchObject({ tier: 'R3', approver: 'admin', outcome: 'needs_approval' });
    expect(d.reasons).toContain('tenant_raised_tier');
  });
  it('raising R1 to R2 removes the agent allow', () => {
    expect(ev(act('fill_draft', { effect: 'prepare' }), [grant()], { minTier: { fill_draft: 'R2' } }).outcome).toBe('needs_approval');
  });
  it('adds a deny (tenant_deny)', () => {
    const d = ev(act('send_message', { effect: 'external' }), [], { deny: ['send_message'] });
    expect(d.outcome).toBe('deny');
    expect(d.reasons).toContain('tenant_deny');
  });
  it('a deny wins over a covering grant', () => {
    expect(ev(act('read'), [grant()], { deny: ['read'] }).outcome).toBe('deny');
  });
  it('ignores a looser override and says so (override_loosening_ignored)', () => {
    const d = ev(act('release', { effect: 'infra' }), [], { minTier: { release: 'R1' } });
    expect(d.tier).toBe('R3');
    expect(d.outcome).toBe('needs_approval');
    expect(d.reasons).toContain('override_loosening_ignored');
  });
  it('ignores an override to R0 for an R4 kind', () => {
    expect(ev(act('production_deploy'), [], { minTier: { production_deploy: 'R0' } })).toMatchObject({ tier: 'R4', outcome: 'needs_approval' });
  });
  it('ignores an invalid tier string as loosening', () => {
    const d = ev(act('release'), [], { minTier: { release: 'R9' as RiskTier } });
    expect(d.tier).toBe('R3');
    expect(d.reasons).toContain('override_loosening_ignored');
  });
  it('an equal override is a no-op without a loosening report', () => {
    const d = ev(act('release'), [], { minTier: { release: 'R3' } });
    expect(d.reasons).not.toContain('override_loosening_ignored');
    expect(d.reasons).not.toContain('tenant_raised_tier');
  });
  it('an override for another kind changes nothing', () => {
    expect(ev(act('release'), [], { minTier: { submit_form: 'R4' } }).tier).toBe('R3');
  });
  it('an override cannot reach through the prototype', () => {
    expect(ev(act('release'), [], { minTier: Object.create({ release: 'R4' }) }).tier).toBe('R3');
  });
});

describe('policy: deny overrides everything', () => {
  it('prohibited plus tenant deny lists both reasons', () => {
    const d = ev(act('autonomous_gate_change'), [], { deny: ['autonomous_gate_change'] });
    expect(d.reasons).toEqual(expect.arrayContaining(['prohibited', 'tenant_deny']));
  });
  it('a deny has no approver', () => {
    expect(ev(act('read')).approver).toBeNull();
  });
  it('deny keeps the raised tier', () => {
    expect(ev(act('release'), [], { deny: ['release'], minTier: { release: 'R4' } })).toMatchObject({ outcome: 'deny', tier: 'R4' });
  });
});

describe('policy: reason codes', () => {
  it('every reason code is produced by some input', () => {
    const seen = new Set<ReasonCode>();
    const add = (d: { reasons: ReasonCode[] }) => d.reasons.forEach((r) => seen.add(r));
    add(ev(act('read'), [grant()]));
    add(ev(act('release', { effect: 'read' }), [], { minTier: { release: 'R1' } }));
    add(ev(act('read', { effect: 'external' }), [grant()]));
    add(ev(act('submit_form'), [], { minTier: { submit_form: 'R4' } }));
    add(ev(act('make_coffee')));
    add(ev(act('autonomous_gate_change')));
    add(ev(act('send_message'), [], { deny: ['send_message'] }));
    add(ev(act('read')));
    add(ev(act('read'), [grant({ expiresAt: 1 })]));
    add(ev(act('fill_draft'), [grant({ kinds: [] })]));
    add(ev(act('fill_draft'), [grant({ kinds: ['fill_draft'] })]));
    add(ev(act('submit_form')));
    add(ev(act('release')));
    add(ev(act('production_deploy')));
    expect([...seen].sort()).toEqual([...REASON_CODES].sort());
  });
});

describe('policy: purity', () => {
  it('does not mutate its inputs', () => {
    const a = act('release', { payload: { v: 1 } });
    const g = [grant()];
    const t: TenantPolicy = { minTier: { release: 'R4' }, deny: ['x'] };
    const before = JSON.stringify([a, g, t]);
    ev(a, g, t);
    expect(JSON.stringify([a, g, t])).toBe(before);
  });
  it('depends on `now` only through the argument', () => {
    const g = [grant({ expiresAt: 1000 })];
    expect(evaluate(act('read'), g, {}, 999).outcome).toBe('allow');
    expect(evaluate(act('read'), g, {}, 1000).outcome).toBe('deny');
  });
  it('ignores the payload', () => {
    expect(ev(act('release', { payload: { a: 1 } }))).toEqual(ev(act('release', { payload: { b: [2] } })));
  });
});

describe('policy: property test, 500 seeded triples', () => {
  function rng(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const kinds = [...Object.keys(BASELINE_POLICY_V1.kinds), 'nope', 'constructor'];
  const effects = ['read', 'prepare', 'external', 'infra', 'critical'] as const;
  it('is deterministic and never below the baseline tier', () => {
    const r = rng(20261122);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    let known = 0;
    for (let i = 0; i < 500; i++) {
      const kind = pick(kinds);
      const action: Action = { kind, requester: pick([user, agent]), effect: pick(effects), payload: { i }, target: r() < 0.5 ? 't' : undefined, missionId: r() < 0.5 ? 'M' : undefined };
      const grants: Grant[] = Array.from({ length: Math.floor(r() * 3) }, (_, k) => ({ id: 'g' + k, subjectId: pick([user.id, agent.id, 'x']), kinds: [pick(kinds), pick(kinds)], target: r() < 0.5 ? 't' : undefined, missionId: r() < 0.5 ? 'M' : undefined, expiresAt: NOW + (r() < 0.5 ? -10 : 10) }));
      const override: TenantPolicy = { minTier: r() < 0.7 ? { [kind]: pick(TIERS) } : undefined, deny: r() < 0.2 ? [pick(kinds)] : undefined };
      const a = evaluate(action, grants, override, NOW);
      const b = evaluate(structuredClone(action), structuredClone(grants), structuredClone(override), NOW);
      expect(b).toEqual(a);
      const base = BASELINE_POLICY_V1.kinds[kind];
      if (Object.prototype.hasOwnProperty.call(BASELINE_POLICY_V1.kinds, kind)) { known++; expect(tierRank(a.tier)).toBeGreaterThanOrEqual(tierRank(base.tier)); }
      else { expect(a.outcome).toBe('deny'); expect(a.tier).toBe('R4'); }
      if (a.outcome === 'allow') expect(tierRank(a.tier)).toBeLessThanOrEqual(1);
      if (a.outcome === 'allow' && action.requester.kind === 'agent') expect(tierRank(a.tier)).toBeLessThanOrEqual(1);
    }
    expect(known).toBeGreaterThan(400);
  });
});
