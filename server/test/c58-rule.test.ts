import { describe, it, expect } from 'vitest';
import { evaluate, EFFECT_FLOOR, tierRank, maxTier, CURRENT_BASELINE, REASON_CODES, type Action, type Grant, type RiskTier, type TenantPolicy } from '../src/policy/index.ts';
import type { RuleOfTwoFlags } from '../src/policy/rule-of-two.ts';

const NOW = 1_800_000_000_000;
const agent = { id: 'release-01', kind: 'agent' as const, role: 'release' };
const human = { id: 'u-1', kind: 'user' as const, role: 'admin' };
const act = (kind: string, over: Partial<Action> = {}): Action => ({ kind, requester: agent, effect: 'read', payload: {}, ...over });
const grant = (kinds: string[]): Grant[] => [{ id: 'g-1', subjectId: agent.id, kinds, expiresAt: NOW + 60_000 }];
const FLAGS = (a: boolean, b: boolean, c: boolean): RuleOfTwoFlags => ({ untrustedInput: a, sensitiveAccess: b, canChangeState: c });
const COMBOS: [boolean, boolean, boolean][] = [];
for (const a of [false, true]) for (const b of [false, true]) for (const c of [false, true]) COMBOS.push([a, b, c]);
const KINDS: [string, RiskTier][] = [['read', 'R0'], ['fill_draft', 'R1'], ['submit_form', 'R2'], ['release', 'R3'], ['production_deploy', 'R4']];
const R2 = EFFECT_FLOOR.external; // the tier comes from the existing table

describe('c58 item 2: the Rule-of-Two rule in evaluate()', () => {
  it('the R2 floor is the existing effect table, not a second tier source', () => { expect(R2).toBe('R2'); expect(CURRENT_BASELINE.kinds.submit_form.tier).toBe(R2); });
  it('rule_of_two is a declared reason code', () => { expect(REASON_CODES).toContain('rule_of_two'); });

  describe('all 8 combinations x 5 baseline tiers: only all-true escalates', () => {
    for (const [a, b, c] of COMBOS) for (const [kind, base] of KINDS) {
      it(`flags ${+a}${+b}${+c} on ${kind} (${base})`, () => {
        const plain = evaluate(act(kind), grant([kind]), {}, NOW);
        const got = evaluate(act(kind), grant([kind]), {}, NOW, FLAGS(a, b, c));
        if (!(a && b && c)) { expect(got).toEqual(plain); return; }
        expect(tierRank(got.tier)).toBeGreaterThanOrEqual(tierRank(R2));
        expect(got.tier).toBe(maxTier(base, R2));
        expect(got.outcome).toBe(plain.outcome === 'deny' ? 'deny' : 'needs_approval');
        expect(got.reasons).toContain('rule_of_two');
      });
    }
  });

  it('an R0 read with all three flags needs approval at R2, with the user as approver', () => {
    expect(evaluate(act('read'), grant(['read']), {}, NOW, FLAGS(true, true, true))).toMatchObject({ outcome: 'needs_approval', tier: 'R2', approver: 'user' });
  });
  it('the escalation never loosens the grant check: no grant still denies', () => {
    expect(evaluate(act('read'), [], {}, NOW, FLAGS(true, true, true))).toMatchObject({ outcome: 'deny', reasons: expect.arrayContaining(['no_grant']) });
    expect(evaluate(act('fill_draft'), [], {}, NOW, FLAGS(true, true, true))).toMatchObject({ outcome: 'deny', reasons: expect.arrayContaining(['out_of_scope']) });
  });
  it('a prohibited kind stays denied', () => {
    expect(evaluate(act('autonomous_gate_change', { requester: human }), [], {}, NOW, FLAGS(true, true, true)).outcome).toBe('deny');
  });
  it('a tenant policy can make the rule a deny, and only when all three hold', () => {
    const t: TenantPolicy = { ruleOfTwo: 'deny' };
    expect(evaluate(act('read'), grant(['read']), t, NOW, FLAGS(true, true, true))).toMatchObject({ outcome: 'deny', reasons: expect.arrayContaining(['rule_of_two', 'rule_of_two_deny']) });
    expect(evaluate(act('read'), grant(['read']), t, NOW, FLAGS(true, true, false)).outcome).toBe('allow');
  });
  it('a tenant value that is not "deny" cannot loosen anything', () => {
    for (const v of ['allow', 'off', '', undefined, 0, null]) expect(evaluate(act('read'), grant(['read']), { ruleOfTwo: v } as unknown as TenantPolicy, NOW, FLAGS(true, true, true)).outcome).toBe('needs_approval');
  });
  it('without flags the result is the old one (callers that do not load a profile are unchanged)', () => {
    expect(evaluate(act('read'), grant(['read']), {}, NOW).outcome).toBe('allow');
  });
  it('the tier from the tenant policy still stands above the rule', () => {
    expect(evaluate(act('submit_form'), [], { minTier: { submit_form: 'R3' } }, NOW, FLAGS(true, true, true)).tier).toBe('R3');
  });

  describe('a requester cannot lower the result', () => {
    const claims = { untrustedInput: false, sensitiveAccess: false, canChangeState: false, flags: { untrustedInput: false }, note: 'no untrusted input' };
    it('payload text that claims "no untrusted input" leaves the result unchanged', () => {
      const honest = evaluate(act('read'), grant(['read']), {}, NOW, FLAGS(true, true, true));
      const lying = evaluate(act('read', { payload: claims }), grant(['read']), {}, NOW, FLAGS(true, true, true));
      expect(lying).toEqual(honest);
    });
    it('a lower effect label, an admin role or a mission id does not change it', () => {
      const honest = evaluate(act('fill_draft'), grant(['fill_draft']), {}, NOW, FLAGS(true, true, true));
      for (const over of [{ effect: 'read' as const }, { requester: { ...agent, role: 'admin' } }, { missionId: 'M-1' }, { target: 'x' }]) {
        expect(evaluate(act('fill_draft', over), grant(['fill_draft']), {}, NOW, FLAGS(true, true, true)), JSON.stringify(over)).toEqual(honest);
      }
    });
    it('a flags object padded with extra truthy or falsy properties is read only for its three booleans', () => {
      const padded = { ...FLAGS(true, true, true), because: { untrustedInput: [] }, note: 'none' } as unknown as RuleOfTwoFlags;
      expect(evaluate(act('read'), grant(['read']), {}, NOW, padded).tier).toBe('R2');
    });
    it('non-boolean flag values do not count as true', () => {
      for (const v of ['true', 1, {}, [], 'yes']) expect(evaluate(act('read'), grant(['read']), {}, NOW, { untrustedInput: v, sensitiveAccess: true, canChangeState: true } as unknown as RuleOfTwoFlags).outcome, String(v)).toBe('allow');
    });
  });
});
