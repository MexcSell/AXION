import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { seedScale } from './c71-scale-fixtures.ts';
import { tx } from '../src/db.ts';
import { snapshotTx, dbWindow, dbNow } from '../src/company/clock.ts';
import { loadInput } from '../src/company/routes.ts';
import { computeScorecard, computeThroughput, windowOf, type ScoreInput } from '../src/company/scorecard.ts';
import { computeScorecard as computeScorecardV0, computeThroughput as computeThroughputV0 } from './c71-reference/scorecard-v0.ts';
import { loadInputV0 } from './c71-reference/load-v0.ts';
import { STALE_BEFORE_SQL } from '../src/tasks/reviews.ts';
import { DIM_REVIEWS_SQL } from '../src/company/dimensions-routes.ts';

// c71 (P6): the scorecard and throughput were rewritten for scale (per-input preparation, lighter loads). Their output must stay BYTE IDENTICAL
// to the pre-c71 implementation, which is frozen in test/c71-reference/. Two layers: (1) the pure function on random inputs full of ties, restores,
// simulated rows and rows of missions the caller cannot see; (2) the whole read (loader + function) on a seeded company, as admin and as a member.
const json = (x: unknown) => JSON.stringify(x);

// ---------------------------------------------------------------- (1) pure function, random inputs
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const STATES = ['draft', 'running', 'waiting_approval', 'completed', 'failed', 'canceled', 'archived'];
function randomInput(seed: number, now: Date): ScoreInput {
  const r = rng(seed), pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const D = 86_400_000;
  const t = () => new Date(now.getTime() - Math.floor(r() * 40) * 5 * D - (r() < 0.8 ? 0 : Math.floor(r() * 1000))); // 40 slots 5 days apart (windows end on slot edges too): most times tie exactly
  const users = ['u1', 'u2', 'u3'];
  const inp: ScoreInput = { missions: [], runs: [], transitions: [], tasks: [], attempts: [], decisions: [], delegations: [], reviews: [] };
  const nm = 5 + Math.floor(r() * 40);
  let seq = 0;
  for (let i = 0; i < nm + 3; i++) {
    const id = 'm' + i, visible = i < nm; // the last three are not in `missions`: their rows must be ignored everywhere
    if (visible) inp.missions.push({ id, ownerId: pick(users) });
    for (let k = Math.floor(r() * 3); k > 0; k--) inp.runs.push({ missionId: id, startedAt: t() });
    for (let k = Math.floor(r() * 7); k > 0; k--) inp.transitions.push({ missionId: id, from: pick(STATES), to: pick(STATES), at: t() });
    for (let k = Math.floor(r() * 4); k > 0; k--) inp.decisions.push({ missionId: id, decision: pick(['approved', 'approved', 'denied']), decidedBy: pick(users), human: r() < 0.8, at: t() });
    if (r() < 0.5) inp.delegations.push({ missionId: id, edgeKind: pick(['verifies', 'delegated']), simulated: r() < 0.2 });
    for (let k = Math.floor(r() * 5); k > 0; k--) {
      const tid = `${id}-t${k}`;
      inp.tasks.push({ id: tid, missionId: id, status: pick(['passed', 'passed', 'failed', 'running']), simulated: r() < 0.15 });
      for (let a = Math.floor(r() * 4); a > 0; a--) inp.attempts.push({ taskId: tid, attemptNo: a, startedAt: r() < 0.9 ? t() : null, finishedAt: r() < 0.7 ? t() : null });
      for (let q = Math.floor(r() * 3); q > 0; q--) inp.reviews!.push({ taskId: tid, missionId: id, verdict: pick(['accepted', 'accepted', 'changes_requested']), reviewerId: pick(users), producerId: pick(users), principalId: pick(users), evidenceCount: pick([0, 1, 2]), at: t(), seq: ++seq, stale: r() < 0.25 });
    }
  }
  // attempts of a task nobody can see, and a review row without a mission: ignored
  inp.attempts.push({ taskId: 'nope', attemptNo: 1, startedAt: t(), finishedAt: t() });
  return inp;
}

describe('pure scorecard and throughput: identical to the frozen pre-c71 code', () => {
  it('400 random inputs x 3 windows (+ an empty input): scorecard, previous window, trends and throughput match byte for byte', () => {
    const now = new Date('2026-11-23T12:00:00.123Z');
    let nonTrivial = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const input = randomInput(seed, now);
      for (const w of ['7d', '30d', '90d'] as const) {
        const win = windowOf(w, now);
        const a = computeScorecard(input, { window: w, from: win.from, to: win.to, includeDemo: false });
        const b = computeScorecardV0(input, { window: w, from: win.from, to: win.to, includeDemo: false });
        expect(json(a), `seed ${seed} ${w}`).toBe(json(b));
        if (a.rows.some((x) => x.state === 'ok' && x.value !== null && x.key !== 'started') && a.rows.some((x) => x.trend)) nonTrivial++;
      }
      for (const weeks of [1, 8, 26]) expect(json(computeThroughput(input, { weeks, to: now, includeDemo: false })), `seed ${seed} weeks ${weeks}`).toBe(json(computeThroughputV0(input, { weeks, to: now, includeDemo: false })));
    }
    expect(nonTrivial, 'the random inputs must reach measured rows and trends, or this test proves nothing').toBeGreaterThan(300);
    const e: ScoreInput = { missions: [], runs: [], transitions: [], tasks: [], attempts: [], decisions: [], delegations: [] };
    const win = windowOf('30d', now);
    expect(json(computeScorecard(e, { window: '30d', from: win.from, to: win.to, includeDemo: true }))).toBe(json(computeScorecardV0(e, { window: '30d', from: win.from, to: win.to, includeDemo: true })));
  });
});

// ---------------------------------------------------------------- (2) the whole read on a seeded company
let t: TestApp, admin: Browser, member: Browser, adminId = '', memberId = '';
beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  const bea = await w.member('Bea');
  admin = w.admin; member = bea.b; adminId = w.adminId; memberId = bea.id;
  await seedScale(t.pool, { tasks: 2000, adminId, memberId, perMission: 4 });
});
afterAll(async () => { await t?.close(); });

const ctxOf = (id: string, role: 'admin' | 'member') => ({ tenantId: 't-1', user: { id, role } }) as any;

describe('seeded company: the whole read matches the pre-c71 read', () => {
  for (const who of ['admin', 'member'] as const) for (const includeDemo of [false, true]) {
    it(`${who}, includeDemo=${includeDemo}: scorecard (7d/30d/90d) and throughput (1/8/26 weeks) identical, one snapshot, one clock`, async () => {
      const ctx = ctxOf(who === 'admin' ? adminId : memberId, who === 'admin' ? 'admin' : 'member');
      await snapshotTx(t.app.db, async (c) => {
        const now = await dbNow(c);
        const newIn = await loadInput(c, ctx, includeDemo), oldIn = await loadInputV0(c, ctx, includeDemo);
        let measured = 0;
        for (const w of ['7d', '30d', '90d'] as const) {
          const win = windowOf(w, now);
          const a = computeScorecard(newIn, { window: w, from: win.from, to: win.to, includeDemo });
          const b = computeScorecardV0(oldIn, { window: w, from: win.from, to: win.to, includeDemo });
          expect(json(a)).toBe(json(b));
          measured += a.rows.filter((r) => r.state === 'ok' && (r.value ?? 0) > 0).length;
        }
        expect(measured, 'the seeded data must produce measured, non-zero rows').toBeGreaterThan(12);
        const tIn = await loadInput(c, ctx, includeDemo, 'throughput');
        for (const weeks of [1, 8, 26]) expect(json(computeThroughput(tIn, { weeks, to: now, includeDemo }))).toBe(json(computeThroughputV0(oldIn, { weeks, to: now, includeDemo })));
      });
    });
  }

  it('the HTTP routes return the same rows as the pre-c71 read (the data is static; only the clock differs)', async () => {
    for (const [who, br, id, role] of [['admin', admin, adminId, 'admin'], ['member', member, memberId, 'member']] as const) {
      for (const w of ['7d', '30d', '90d'] as const) {
        const got = (await br.req('GET', `/company/scorecard?window=${w}`)).body;
        const want = await snapshotTx(t.app.db, async (c) => { const win = await dbWindow(c, w); return computeScorecardV0(await loadInputV0(c, ctxOf(id, role), false), { ...win, includeDemo: false }); });
        expect(json(got.rows), `${who} ${w}`).toBe(json(want.rows));
        expect(got.window).toBe(want.window);
      }
      const gt = (await br.req('GET', '/company/throughput?weeks=8')).body;
      const wt = await snapshotTx(t.app.db, async (c) => computeThroughputV0(await loadInputV0(c, ctxOf(id, role), false), { weeks: 8, to: await dbNow(c), includeDemo: false }));
      const counts = (ws: { started: number; finished: number }[]) => ws.map((x) => [x.started, x.finished]); // the week stamps carry each read's own clock
      expect(json(counts(gt.weeks))).toBe(json(counts(wt.weeks)));
    }
  });

  it('a review is stale in the new loader exactly when STALE_BEFORE_SQL (c51) says so, review by review', async () => {
    await tx(t.app.db, async (c) => {
      const want = new Map((await c.query(`select r.seq, (${STALE_BEFORE_SQL('r')} is not null) as stale from task_reviews r`)).rows.map((r) => [String(r.seq), r.stale as boolean]));
      const got = (await loadInput(c, ctxOf(adminId, 'admin'), true)).reviews!;
      expect(got.length).toBeGreaterThan(500);
      expect(got.filter((r) => r.stale).length, 'some reviews are stale, some fresh').toBeGreaterThan(20);
      expect(got.filter((r) => !r.stale).length).toBeGreaterThan(20);
      for (const r of got) expect(!!r.stale, `review seq ${r.seq}`).toBe(want.get(String(r.seq)));
    });
  });

  it('GET /company/dimensions: the reviews read returns the same rows as the pre-c71 query, and the whole answer does not depend on migration 0053 index', async () => {
    expect(DIM_REVIEWS_SQL).not.toContain('${');
    const oldSql = `select r.task_id, r.mission_id, r.reviewer_id, r.reviewer_kind, r.reviewer_model_family, r.producer_id, r.producer_kind, r.producer_model_family, r.principal_id,
                  r.verdict, jsonb_array_length(r.evidence) as ev, r.created_at, r.seq, (t.simulated or m.demo) as simulated, (${STALE_BEFORE_SQL('r')} is not null) as stale
             from task_reviews r join tasks t on t.id=r.task_id join missions m on m.id=r.mission_id
            where r.tenant_id=$1 and r.mission_id = any($2::text[]) and r.created_at <= now()`;
    await tx(t.app.db, async (c) => {
      const ids = (await c.query(`select id from missions where tenant_id='t-1'`)).rows.map((m) => m.id as string);
      const a = (await c.query(DIM_REVIEWS_SQL, ['t-1', ids])).rows.sort((x, y) => Number(x.seq) - Number(y.seq));
      const b = (await c.query(oldSql, ['t-1', ids])).rows.sort((x, y) => Number(x.seq) - Number(y.seq));
      expect(a.length).toBeGreaterThan(500);
      expect(json(a)).toBe(json(b));
      expect(a.some((r) => r.stale) && a.some((r) => !r.stale)).toBe(true);
    });
    const dims = async () => { const r = (await admin.req('GET', '/company/dimensions?window=90d')).body; return JSON.stringify(r.dimensions, (k, v) => (k === 'from' || k === 'to' ? undefined : v)); }; // each read stamps its own clock
    const withIndex = await dims();
    await t.pool.query('drop index approval_decisions_approval');
    try { expect(await dims()).toBe(withIndex); } finally { await t.pool.query('create index approval_decisions_approval on approval_decisions (approval_id, decided_at)'); }
    expect(withIndex).toContain('collective.approval_decision_h');
  });
});
