import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
vi.mock('../../src/agents/seed.ts', async (orig) => { const real = await orig<typeof import('../../src/agents/seed.ts')>(); const m = await import('./seedmock.ts'); return { ...real, seedCompany: (c: any, t: string) => (t === 't-1' ? real.seedCompany(c, t) : m.seedPrefixedCompany(c, t)) }; });
import { buildWorld, seedTenant, type World } from './fixture.ts';
import { forgedScope, FORGED } from './forged.ts';
import type { Violation } from './isolation.ts';

/** c81 item 7: MR4, the forged-scope corpus, on the real code. */
let w: World;
beforeAll(async () => { w = await buildWorld(); await seedTenant(w, w.A); await seedTenant(w, w.B); }, 120000);
afterAll(async () => { await w?.close(); });
const show = (v: Violation[]) => v.slice(0, 12).map((x) => `${x.relation} | ${x.where} | ${x.detail}`).join('\n');

describe('MR4 forged scope', () => {
  it('the reviewed table has at least 40 distinct forged inputs and covers every class the brief names', () => {
    expect(FORGED.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FORGED.map((f) => f.id)).size).toBe(FORGED.length);
    const cls = new Set(FORGED.map((f) => f.cls));
    for (const c of ['case', 'whitespace', 'urlencoding', 'dotdot', 'confusable', 'prefix', 'array', 'jsonpath']) expect(cls, c).toContain(c);
    expect(FORGED.some((f) => /b-/.test(f.id) || /agent/.test(f.id))).toBe(true);
    console.log(`MR4: ${FORGED.length} forged inputs; by class ${JSON.stringify(FORGED.reduce((a: Record<string, number>, f) => ({ ...a, [f.cls]: (a[f.cls] ?? 0) + 1 }), {}))}`);
  });
  it('every forged input, sent as tenant A with tenant B\'s ids, is refused or answered without B\'s data', async () => {
    const r = await forgedScope(w, w.A, w.B);
    const hist = r.rows.reduce((a: Record<string, number>, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {});
    console.log(`MR4: ${r.rows.length} requests (admin and member); statuses ${JSON.stringify(hist)}`);
    expect(show(r.violations)).toBe('');
  }, 240000);
});
