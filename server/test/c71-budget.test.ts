import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });
import { appendFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { seedScale } from './c71-scale-fixtures.ts';

/**
 * c71 (P6) latency budget, ON DEMAND (it seeds 25,000 tasks twice and times every company route, so it is not in the default suite):
 *
 *   cd server && C71_BUDGET=1 C71_BUDGET_OUT=/tmp/w69-budget.txt /home/luca/AXION-lanes/heavy.sh npx vitest run test/c71-budget.test.ts --maxWorkers=1 --no-file-parallelism
 *
 * Budget: at 25,000 tasks the p95 of every company route stays under C71_BUDGET_MS (default 1000 ms) on this machine, for the admin and for a
 * member, with 10 tasks per mission and with 3 per mission (many small missions was the c69 reviewer's shape). The load average is printed with every
 * line: numbers taken at different loads are not comparable (LESSONS), so a failure at a high load1 is a reason to re-run, not to loosen.
 */
const RUN = !!process.env.C71_BUDGET;
const BUDGET = Number(process.env.C71_BUDGET_MS ?? 1000);
const RUNS = Number(process.env.C71_RUNS ?? 12);
const ROUTES = ['/company/scorecard?window=7d', '/company/scorecard?window=30d', '/company/scorecard?window=90d', '/company/throughput?weeks=8', '/company/dimensions?window=30d', '/company/dimensions?window=90d', '/departments', '/company/failure-modes?window=30d'];
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];
const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.5) - 1];

describe.skipIf(!RUN)('c71 budget: p95 of every company route at 25,000 tasks', () => {
  for (const tpm of [10, 3]) {
    describe(`${tpm} tasks per mission`, () => {
      let t: TestApp, admin: Browser, member: Browser;
      beforeAll(async () => {
        t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
        const w = await withAdmin(t.app);
        const bea = await w.member('Bea');
        admin = w.admin; member = bea.b;
        await seedScale(t.pool, { tasks: 25_000, adminId: w.adminId, memberId: bea.id, perMission: tpm });
      });
      afterAll(async () => { await t?.close(); });
      for (const who of ['admin', 'member'] as const) for (const route of ROUTES) {
        it(`${who} ${route}`, async () => {
          const br = who === 'admin' ? admin : member;
          for (let i = 0; i < 2; i++) await br.req('GET', route);
          const ts: number[] = [];
          for (let i = 0; i < RUNS; i++) { const a = performance.now(); const r = await br.req('GET', route); ts.push(performance.now() - a); expect(r.status).toBe(200); }
          const line = `c71 budget ${tpm}/mission ${who.padEnd(6)} ${route.padEnd(36)} p50 ${p50(ts).toFixed(0).padStart(5)} ms  p95 ${p95(ts).toFixed(0).padStart(5)} ms  (budget ${BUDGET})  load1 ${loadavg()[0].toFixed(1)}`;
          console.log(line);
          if (process.env.C71_BUDGET_OUT) appendFileSync(process.env.C71_BUDGET_OUT, line + '\n');
          expect(p95(ts), `p95 of ${route} as ${who} at load1 ${loadavg()[0].toFixed(1)}`).toBeLessThan(BUDGET);
        });
      }
    });
  }
});
