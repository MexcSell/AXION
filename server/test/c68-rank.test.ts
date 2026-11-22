import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { rankItems, compareItems, bandOf, NO_TIER_BAND, type Rankable } from '../src/attention/rank.ts';
import { TIERS } from '../src/policy/types.ts';
import { TIER_BAND } from '../src/attention/rank.ts';
import { ATTENTION_RANKING } from '../../shared/contracts/src/index.ts';
import { makeWorld, approval, orgProposal, failure, staleReview, type World } from './c68-fixtures.ts';

// c68 item 2: a pure, documented ranking. Tier, then expiry proximity, then age, then id. A design choice that changes no decision.
const it_ = (id: string, tier: string | null, expiresInSec: number | null, ageSec: number): Rankable => ({ id, tier, expiresInSec, ageSec });
const ids = (l: Rankable[]) => l.map((x) => x.id);
const permutations = <T,>(a: T[]): T[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));

describe('c68 item 2: tier first', () => {
  it('R4 before R3 before R2 before an item with no tier, whatever the age and expiry', () => {
    const l = [it_('none-old', null, 10, 9_999_999), it_('r2', 'R2', null, 1), it_('r3', 'R3', null, 1), it_('r4', 'R4', null, 1)];
    expect(ids(rankItems(l))).toEqual(['r4', 'r3', 'r2', 'none-old']);
  });
  it('the no-tier band sits between R2 and R1; the bands are documented constants', () => {
    expect(bandOf(it_('a', 'R2', null, 0))).toBeGreaterThan(NO_TIER_BAND);
    expect(bandOf(it_('a', null, null, 0))).toBe(NO_TIER_BAND);
    expect(bandOf(it_('a', 'R1', null, 0))).toBeLessThan(NO_TIER_BAND);
    expect(ATTENTION_RANKING).toEqual(['tier', 'expiry', 'age', 'id']);
  });
  it('the band table covers exactly the policy tiers, in order', () => {
    expect(Object.keys(TIER_BAND)).toEqual([...TIERS]);
    expect(Object.values(TIER_BAND)).toEqual([...Object.values(TIER_BAND)].sort((a, b) => a - b));
  });
  it('an unknown tier fails closed: it ranks with the highest', () => {
    expect(ids(rankItems([it_('r4', 'R4', null, 1), it_('weird', 'R9', null, 1), it_('r3', 'R3', null, 1)]))[2]).toBe('r3');
    expect(bandOf(it_('weird', 'R9', null, 0))).toBe(bandOf(it_('x', 'R4', null, 0)));
  });
});

describe('c68 item 2: expiry proximity, then age', () => {
  it('within a tier the soonest expiry is first, and a row that expires comes before one that does not', () => {
    const l = [it_('never', 'R2', null, 5000), it_('later', 'R2', 7200, 10), it_('soon', 'R2', 600, 10)];
    expect(ids(rankItems(l))).toEqual(['soon', 'later', 'never']);
  });
  it('expiry outranks age: a young item expiring soon is before an old one expiring later', () => {
    expect(ids(rankItems([it_('old', null, 90_000, 500_000), it_('young', null, 100, 5)]))).toEqual(['young', 'old']);
  });
  it('with equal expiry (or none) the longest wait is first', () => {
    expect(ids(rankItems([it_('a', null, null, 100), it_('b', null, null, 900), it_('c', null, null, 500)]))).toEqual(['b', 'c', 'a']);
    expect(ids(rankItems([it_('a', 'R3', 60, 100), it_('b', 'R3', 60, 900)]))).toEqual(['b', 'a']);
  });
  it('tier outranks expiry: an R2 about to expire is after an R3 with a day left', () => {
    expect(ids(rankItems([it_('r2-soon', 'R2', 30, 5), it_('r3-day', 'R3', 86_400, 5)]))).toEqual(['r3-day', 'r2-soon']);
  });
});

describe('c68 item 2: deterministic ties', () => {
  it('identical rank keys are ordered by id, whatever order they arrive in (all 120 permutations of five equal items)', () => {
    const l = ['e', 'b', 'a', 'd', 'c'].map((id) => it_(id, 'R2', 100, 100));
    const want = ['a', 'b', 'c', 'd', 'e'];
    for (const p of permutations(l)) expect(ids(rankItems(p))).toEqual(want);
  });
  it('a mixed list gives one order for every permutation of its input', () => {
    const l = [it_('a', 'R3', 50, 9), it_('b', 'R3', 50, 9), it_('c', null, null, 70), it_('d', 'R2', 20, 1), it_('e', null, 20, 1)];
    const first = ids(rankItems(l));
    for (const p of permutations(l)) expect(ids(rankItems(p))).toEqual(first);
  });
  it('compareItems is a total order: antisymmetric and zero only for the same id', () => {
    const l = [it_('a', 'R3', 50, 9), it_('b', 'R3', 50, 9), it_('c', null, null, 70)];
    for (const x of l) for (const y of l) { expect(Math.sign(compareItems(x, y)) + 0).toBe(-Math.sign(compareItems(y, x)) + 0); expect(compareItems(x, y) === 0).toBe(x.id === y.id); }
  });
  it('does not change its input', () => {
    const l = [it_('b', null, null, 1), it_('a', 'R4', null, 1)];
    const copy = JSON.parse(JSON.stringify(l));
    rankItems(l);
    expect(l).toEqual(copy);
  });
});

describe('c68 item 2: the ranking is pure and affects nothing', () => {
  const src = readFileSync(new URL('../src/attention/rank.ts', import.meta.url), 'utf8');
  it('takes only the list: no viewer, no clock, no database, no decision code', () => {
    expect(rankItems.length).toBe(1);
    expect(src).not.toMatch(/Date\.now|new Date|now\(\)|process\.env|import .*db\.ts|import .*policy|import .*approvals|query\(/);
  });
});

describe('c68 item 2: the route serves rows in that order and decides nothing', () => {
  it('rows come back in ranked order, and reading changes no approval tier or state', async () => {
    const w: World = await makeWorld();
    try {
      await approval(w, w.mShared, 'submit_form'); await approval(w, w.mShared, 'production_deploy'); await approval(w, w.mBen, 'release');
      await orgProposal(w, 5); await failure(w, w.mShared); await staleReview(w, w.mShared);
      const before = (await w.t.pool.query(`select id, risk, state, action_digest from approval_requests order by id`)).rows;
      const rows = (await w.admin.req('GET', '/attention')).body.rows as { id: string; tier: string | null; expiresInSec: number | null; ageSec: number }[];
      expect(rows.length).toBeGreaterThanOrEqual(6);
      expect(rows.map((r) => r.id)).toEqual(ids(rankItems(rows.map((r) => ({ id: r.id, tier: r.tier, expiresInSec: r.expiresInSec, ageSec: r.ageSec })))));
      expect(rows[0].tier).toBe('R4');
      expect(rows.map((r) => r.tier).slice(0, 3)).toEqual(['R4', 'R3', 'R2']);
      expect((await w.t.pool.query(`select id, risk, state, action_digest from approval_requests order by id`)).rows).toEqual(before);
    } finally { await w.t.close(); }
  }, 60_000);
});
