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

  // ---- fix round (review I-2, minors): the chart must be one tree under the GM
  it('error: a retired agent as a manager (and the active agent under it is not under the GM)', () => {
    const ag = [...AG, { id: 'b', status: 'active', dept: 'Operations' }];
    const r = validateOrg([...BASE, e('old', 'b')], ag, BASE);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toEqual(['RETIRED_MANAGER', 'NOT_UNDER_GM']);
    const nu = r.errors.find((x) => x.code === 'NOT_UNDER_GM')!;
    expect(nu.agentId).toBe('old'); // the top of the detached chain
    expect(nu.message).toContain('b');
  });

  it('error: an unknown agent as a manager of an active agent', () => {
    const ag = [...AG, { id: 'b', status: 'active', dept: 'Operations' }];
    const r = validateOrg([...BASE, e('ghost', 'b')], ag, BASE);
    expect(codes(r.errors)).toContain('UNKNOWN_AGENT');
    expect(codes(r.errors)).toContain('NOT_UNDER_GM');
  });

  it('error: the GM as a subordinate', () => {
    const r = validateOrg([...BASE, e('old', 'gm')], AG, BASE);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toContain('GM_HAS_MANAGER');
  });

  it('error: an active chain that does not end at the GM', () => {
    // eng-head loses its manager: it is NO_MANAGER, and coder and tester under it are not under the GM
    const r = validateOrg(BASE.filter((x) => x.subordinateId !== 'eng-head'), AG, BASE);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toContain('NO_MANAGER');
    expect(r.errors.filter((x) => x.code === 'NOT_UNDER_GM').map((x) => x.agentId)).toEqual(['eng-head']);
    expect(r.errors.find((x) => x.code === 'NOT_UNDER_GM')!.message).toMatch(/coder.*tester|tester.*coder/);
  });

  it('error: a 3-agent cycle is reported once, naming its members', () => {
    const next = [e('gm', 'ops-head'), e('tester', 'eng-head'), e('eng-head', 'coder'), e('coder', 'tester')];
    const r = validateOrg(next, AG, BASE);
    expect(r.ok).toBe(false);
    const cyc = r.errors.filter((x) => x.code === 'CYCLE');
    expect(cyc.length).toBe(1);
    for (const id of ['eng-head', 'coder', 'tester']) expect(cyc[0].message).toContain(id);
  });

  it('the depth boundary: 64 levels below the GM is fine, 65 is CYCLE', () => {
    const mk = (n: number) => ({
      ag: [{ id: 'gm', status: 'active', dept: 'Executive' }, ...Array.from({ length: n }, (_, i) => ({ id: `d${i}`, status: 'active', dept: 'Deep' }))],
      ed: [e('gm', 'd0'), ...Array.from({ length: n - 1 }, (_, i) => e(`d${i}`, `d${i + 1}`))],
    });
    const a = mk(64), b = mk(65);
    expect(validateOrg(a.ed, a.ag).ok).toBe(true);
    expect(codes(validateOrg(b.ed, b.ag).errors)).toContain('CYCLE');
  });

  it('a duplicated identical line is DUPLICATE_LINE, not MULTIPLE_MANAGERS', () => {
    const r = validateOrg([...BASE, e('eng-head', 'coder')], AG, BASE);
    expect(codes(r.errors)).toEqual(['DUPLICATE_LINE']);
  });
});

