import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { ROUTES } from './contracts/registry.ts';
import { check } from './contracts/validate.ts';
import * as C from './contracts/validators.ts';
import { decided, addAgent, type Fx } from './c65-fixtures.ts';

let t: TestApp; let f: Fx; let A: Awaited<ReturnType<typeof withAdmin>>;
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  A = await withAdmin(t.app);
  f = { pool: t.pool, mission: (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'c65c' + Date.now() })).body.mission.id as string };
  await addAgent(f, 'c65-ops-1', 'Operations');
  for (let i = 0; i < 22; i++) await decided(f, 'C' + i, 'c65-ops-1', 5 * 3_600_000, (i + 1) * 60_000, 'u-' + (i % 3));
});
afterEach(async () => { await t.close(); });

describe('c65 item 7: contracts for every new field and route', () => {
  it('both routes have registry entries; the per-person one is flagged admin', () => {
    expect(ROUTES['GET /review-capacity']).toMatchObject({ v: C.reviewCapacityBody });
    expect(ROUTES['GET /review-capacity']).not.toHaveProperty('admin');
    expect(ROUTES['GET /review-capacity/people']).toMatchObject({ v: C.capacityPeopleBody, admin: true });
  });
  it('the live responses satisfy their validators, and each validator rejects a missing field, an extra field and a wrong value (every new field is checked)', async () => {
    const body = (await A.admin.req('GET', '/review-capacity')).body;
    expect(check('review', C.reviewCapacityBody, body)).toEqual([]);
    const paths: string[][] = [];
    const walk = (o: any, p: string[]) => { if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) { paths.push([...p, k]); walk(o[k], [...p, k]); } else if (Array.isArray(o) && o[0]) walk(o[0], [...p, '0']); };
    walk(body.review, ['review']);
    expect(paths.length).toBeGreaterThan(40);
    const clone = () => JSON.parse(JSON.stringify(body));
    const at = (o: any, p: string[]) => p.slice(0, -1).reduce((x, k) => x[k], o);
    for (const p of paths) {
      const miss = clone(); delete at(miss, p)[p[p.length - 1]];
      expect(check('x', C.reviewCapacityBody, miss), `missing ${p.join('.')}`).not.toEqual([]);
    }
    const extra = clone(); extra.review.total.rank = 1;
    expect(check('x', C.reviewCapacityBody, extra)).not.toEqual([]); // an unknown field (for example a rank) is a contract failure
    const bad = clone(); bad.review.utilisation.value = 0.7;
    expect(check('x', C.reviewCapacityBody, bad), 'utilisation can never carry a number in v1').not.toEqual([]);
    const people = (await A.admin.req('GET', '/review-capacity/people')).body;
    expect(check('people', C.capacityPeopleBody, people)).toEqual([]);
    const pm = JSON.parse(JSON.stringify(people)); delete pm.people[0].name;
    expect(check('x', C.capacityPeopleBody, pm)).not.toEqual([]);
  });
  it('NO ALLOWLIST LINE was added by this cycle: the allowlist files are byte-identical to the base commit', () => {
    const base = '7f31c94';
    for (const f of ['test/contracts/allowlists.ts', 'test/contracts/exercised.ts'])
      expect(execFileSync('git', ['diff', '--stat', base, '--', f], { encoding: 'utf8' }), f).toBe('');
  });
});
