import { describe, it, expect } from 'vitest';
import { validateOrg, type OrgAgent, type EdgeIn } from '../src/organization/validate.ts';

// A small company: GM; Engineering (eng-head → coder, tester); Ops (ops-head); a retired agent nobody manages.
const AG: OrgAgent[] = [
  { id: 'gm', status: 'active', dept: 'Executive', role: 'manager' },
  { id: 'eng-head', status: 'active', dept: 'Engineering' },
  { id: 'coder', status: 'active', dept: 'Engineering' },
  { id: 'tester', status: 'active', dept: 'Engineering' },
  { id: 'ops-head', status: 'active', dept: 'Operations' },
  { id: 'old', status: 'retired', dept: 'Operations' },
];
const e = (supervisorId: string, subordinateId: string): EdgeIn => ({ supervisorId, subordinateId });
const BASE: EdgeIn[] = [e('gm', 'eng-head'), e('eng-head', 'coder'), e('eng-head', 'tester'), e('gm', 'ops-head')];
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('validateOrg (dry run)', () => {
  it('the current tree is valid: no errors, no warnings, nothing added or removed', () => {
    const r = validateOrg(BASE, AG, BASE);
    expect(r).toEqual({ ok: true, errors: [], warnings: [], added: [], removed: [] });
  });

  it('a moved reporting line is one line removed and one added (A → B)', () => {
    const next = BASE.map((x) => (x.subordinateId === 'tester' ? e('ops-head', 'tester') : x));
    const r = validateOrg(next, AG, BASE);
    expect(r.ok).toBe(true);
    expect(r.added).toEqual([{ supervisorId: 'ops-head', subordinateId: 'tester', edgeType: 'reports_to' }]);
    expect(r.removed).toEqual([{ supervisorId: 'eng-head', subordinateId: 'tester', edgeType: 'reports_to' }]);
  });

  it('error: an unknown agent (as supervisor or as subordinate)', () => {
    const r1 = validateOrg([...BASE, e('ghost', 'old')], AG, BASE);
    expect(r1.ok).toBe(false);
    expect(codes(r1.errors)).toContain('UNKNOWN_AGENT');
    expect(r1.errors.find((x) => x.code === 'UNKNOWN_AGENT')!.agentId).toBe('ghost');
    const r2 = validateOrg([...BASE, e('gm', 'nobody')], AG, BASE);
    expect(codes(r2.errors)).toEqual(['UNKNOWN_AGENT']);
  });

  it('error: self-management', () => {
    const r = validateOrg(BASE.map((x) => (x.subordinateId === 'coder' ? e('coder', 'coder') : x)), AG, BASE);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toContain('SELF_MANAGED');
  });

  it('error: a reporting cycle (two agents managing each other)', () => {
    const next = BASE.filter((x) => x.subordinateId !== 'eng-head').concat(e('coder', 'eng-head'));
    const r = validateOrg(next, AG, BASE);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toContain('CYCLE');
  });

  it('error: a chain longer than the limit (64) counts as a cycle', () => {
    const many: OrgAgent[] = [{ id: 'gm', status: 'active', dept: 'Executive' }, ...Array.from({ length: 70 }, (_, i) => ({ id: `a${i}`, status: 'active', dept: 'Deep' }))];
    const chain = [e('gm', 'a0'), ...Array.from({ length: 69 }, (_, i) => e(`a${i}`, `a${i + 1}`))];
    expect(codes(validateOrg(chain, many).errors)).toContain('CYCLE');
    expect(validateOrg(chain.slice(0, 40), many.slice(0, 41)).ok).toBe(true);
  });

  it('error: more than one manager for an agent', () => {
    const r = validateOrg([...BASE, e('ops-head', 'coder')], AG, BASE);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toEqual(['MULTIPLE_MANAGERS']);
    expect(r.errors[0].agentId).toBe('coder');
  });

  it('error: an active agent other than the GM with no manager (a retired one is fine)', () => {
    const r = validateOrg(BASE.filter((x) => x.subordinateId !== 'ops-head'), AG, BASE);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([expect.objectContaining({ code: 'NO_MANAGER', agentId: 'ops-head' })]);
    expect(codes(validateOrg(BASE, AG).errors)).not.toContain('NO_MANAGER'); // gm and the retired agent have no manager
  });

  it('warning: a manager with no reports (had reports in the active revision, has none in the proposal)', () => {
    const next = [e('gm', 'eng-head'), e('gm', 'coder'), e('gm', 'tester'), e('gm', 'ops-head')];
    const r = validateOrg(next, AG, BASE);
    expect(r.ok).toBe(true); // warnings never block
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'MANAGER_WITHOUT_REPORTS', agentId: 'eng-head' })]);
  });

  it('warning: a department without a head (no member reports to the GM)', () => {
    const next = BASE.map((x) => (x.subordinateId === 'ops-head' ? e('eng-head', 'ops-head') : x));
    const r = validateOrg(next, AG, BASE);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'DEPT_WITHOUT_HEAD', dept: 'Operations' })]);
  });
});
