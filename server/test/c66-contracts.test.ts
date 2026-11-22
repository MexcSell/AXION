import { describe, it, expect } from 'vitest';
import { ROUTES } from './contracts/registry.ts';
import { SWEEP_SKIP, MEMBER_403_ALLOWED } from './contracts/allowlists.ts';
import { UNEXERCISED_ALLOWED } from './contracts/exercised.ts';
import * as V from './contracts/validators.ts';
import { check } from './contracts/validate.ts';
import { guardRows, PROMOTION_NOTE } from '../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 66, item 6: every new route and DTO is in the contract registry with a validator, and the lane added no
 * allowlist line. The allowlist sizes are pinned to what c54's base had: a new entry in any of them is a reviewed decision, not a
 * quiet edit of this file's neighbours.
 */
describe('c66 contracts', () => {
  it('both new routes have a registry entry with a validator, and the audit route is administrator-only', () => {
    const g = ROUTES['GET /company/metric-guard'], a = ROUTES['POST /company/metric-audits'];
    expect('v' in g && g.v).toBe(V.metricGuard);
    expect('v' in a && a.v).toBe(V.metricAuditResult);
    expect('admin' in a && a.admin).toBe(true);
    expect('admin' in g && g.admin).toBeFalsy();
  });

  it('no allowlist line was added: the sweep, member-403 and unexercised lists have the sizes of the c54 base, and none names a c66 route', () => {
    expect(Object.keys(SWEEP_SKIP).length).toBe(6);
    expect(Object.keys(MEMBER_403_ALLOWED).length).toBe(4);
    expect(UNEXERCISED_ALLOWED.length).toBeLessThanOrEqual(14); // the c54 base had 14; c57 deleted one (an allowlist may shrink, never grow)
    const text = JSON.stringify([SWEEP_SKIP, MEMBER_403_ALLOWED, UNEXERCISED_ALLOWED.map(([r, w]) => [r.source, w])]);
    expect(text).not.toMatch(/metric-guard|metric-audits/);
  });

  it('the validator is not vacuous: it rejects a missing audit block, an unknown counter kind and an extra key', () => {
    const rows = guardRows().map((r) => ({ ...r, audit: { n: 0, disagreements: 0, metricOver: 0, auditOver: 0, divergence: null, bar: 15, minN: 100, state: 'none', flagged: false, lastAuditedAt: null } }));
    const ok = { rows, promotionNote: PROMOTION_NOTE };
    const run = (b: unknown) => { const e: string[] = []; V.metricGuard(b, '$', e); return e; };
    expect(run(ok)).toEqual([]);
    expect(run({ ...ok, rows: rows.map(({ audit: _a, ...r }) => r) }).length).toBeGreaterThan(0);
    expect(run({ ...ok, rows: [{ ...rows[0], counter: { kind: 'weird' } }] }).length).toBeGreaterThan(0);
    expect(run({ ...ok, extra: 1 }).length).toBeGreaterThan(0);
    void check;
  });

  it('the guard response carries no composite: no score, total or overall field anywhere', () => {
    expect(JSON.stringify(guardRows())).not.toMatch(/"(score|total|overall|composite|rating)"/i);
  });
});
