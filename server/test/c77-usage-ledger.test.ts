import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeSchema } from './helpers.ts';
import { recordUsage, recordCorrection, netUsage } from '../src/usage/ledger.ts';
import { checkBudget } from '../src/usage/budget.ts';
import { FakeMeter } from './fakes/fake-meter.ts';

/** c77 item 1: the append-only usage ledger. Rows come only from a FAKE meter that lives under test/; nothing real is metered. */
let s: Awaited<ReturnType<typeof makeSchema>>;
beforeAll(async () => { s = await makeSchema(); });
afterAll(async () => { await s?.drop(); });
const T = 'ten-1';
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);

describe('usage_ledger', () => {
  it('records a row with fixed-point cost, the database time and its source', async () => {
    const r = await recordUsage(s.pool, { tenantId: T, subject: 'agent:a1', unit: 'tokens_in', quantity: 1200, costMicros: 3600, source: 'fake-meter' });
    expect(r).toMatchObject({ tenant_id: T, subject: 'agent:a1', unit: 'tokens_in', quantity: '1200', cost_micros: '3600', source: 'fake-meter', correction_of: null });
    expect(Math.abs(Date.now() - new Date(r.recorded_at).getTime())).toBeLessThan(60_000);
  });
  it('refuses a negative original row, an empty subject, a fractional quantity and an unknown unit', async () => {
    const bad = (o: object) => recordUsage(s.pool, { tenantId: T, subject: 'agent:a1', unit: 'tokens_in', quantity: 1, costMicros: 0, source: 'fake-meter', ...o });
    await expect(bad({ quantity: -1 })).rejects.toThrow();
    await expect(bad({ costMicros: -1 })).rejects.toThrow();
    await expect(bad({ subject: '' })).rejects.toThrow();
    await expect(bad({ quantity: 1.5 })).rejects.toThrow();
    await expect(bad({ unit: 'bananas' })).rejects.toThrow();
  });
  it('is append-only: UPDATE, DELETE and TRUNCATE are refused, and a raw correction of someone else\'s tenant too', async () => {
    await expect(q(`update usage_ledger set quantity = 1`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from usage_ledger`)).rejects.toThrow(/append-only/);
    await expect(q(`truncate usage_ledger`)).rejects.toThrow(/append-only/);
    const orig = (await q('select id from usage_ledger limit 1')).rows[0].id;
    await expect(recordCorrection(s.pool, { tenantId: 'other', correctionOf: Number(orig), quantity: -1, costMicros: 0, source: 'fake-meter' })).rejects.toThrow();
  });
  it('allows the demo purge exception only, and clearDemo-style deletes then work', async () => {
    const c = await s.pool.connect();
    try {
      await c.query('begin'); await c.query("set local axion.purge_demo = 'on'");
      await recordUsage(c, { tenantId: 'purge-t', subject: 'x', unit: 'requests', quantity: 1, costMicros: 0, source: 'fake-meter' });
      expect((await c.query(`delete from usage_ledger where tenant_id='purge-t'`)).rowCount).toBe(1);
      await c.query('commit');
    } finally { c.release(); }
  });
  it('a correction is a new row that points at an original; a correction cannot be corrected and may be negative', async () => {
    const o = await recordUsage(s.pool, { tenantId: T, subject: 'agent:a2', unit: 'tokens_out', quantity: 1000, costMicros: 5000, source: 'fake-meter' });
    const c1 = await recordCorrection(s.pool, { tenantId: T, correctionOf: Number(o.id), quantity: -200, costMicros: -1000, source: 'fake-meter' });
    expect(c1).toMatchObject({ correction_of: o.id, quantity: '-200', cost_micros: '-1000', subject: 'agent:a2', unit: 'tokens_out' });
    await expect(recordCorrection(s.pool, { tenantId: T, correctionOf: Number(c1.id), quantity: 1, costMicros: 0, source: 'fake-meter' })).rejects.toThrow(/original/);
    await expect(recordCorrection(s.pool, { tenantId: T, correctionOf: 999999, quantity: 1, costMicros: 0, source: 'fake-meter' })).rejects.toThrow();
    expect((await q('select quantity from usage_ledger where id=$1', [o.id])).rows[0].quantity).toBe('1000'); // the original never changed
    // a raw correction that disagrees with its original's subject or unit is refused by the database
    await expect(q(`insert into usage_ledger(tenant_id,subject,unit,quantity,cost_micros,source,correction_of) values ($1,'agent:zz','tokens_out',-1,0,'x',$2)`, [T, o.id])).rejects.toThrow();
  });
  it('net usage adds corrections to originals per subject and unit, and feeds the pure budget check', async () => {
    const meter = new FakeMeter();
    for (const e of meter.events('agent:net', 'requests', [10, 20, 30])) await recordUsage(s.pool, { tenantId: T, ...e });
    const first = (await q(`select id from usage_ledger where subject='agent:net' order by id limit 1`)).rows[0].id;
    await recordCorrection(s.pool, { tenantId: T, correctionOf: Number(first), quantity: -5, costMicros: -50, source: 'fake-meter' });
    const net = await netUsage(s.pool, T, 'agent:net');
    expect(net).toEqual([{ unit: 'requests', quantity: 55, costMicros: 550 }]);
    expect(checkBudget([{ unit: 'requests', limit: 60 }], net).decision).toBe('warn');
    expect(meter.calls).toBe(3); // the fake meter only produced events; no real usage was read
  });
});

describe('nothing meters real usage', () => {
  const SRC = join(__dirname, '../src');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
  it('no route handler or other src file calls the ledger writers, and no src file imports a fake', () => {
    for (const f of walk(SRC)) {
      const t = readFileSync(f, 'utf8');
      if (f.endsWith('usage/ledger.ts')) continue;
      expect(/recordUsage|recordCorrection/.test(t), f).toBe(false);
      expect(/test\/fakes|fake-meter|fake-adapter/.test(t), f).toBe(false);
    }
  });
  it('the usage module imports no network, http or provider SDK', () => {
    for (const f of walk(join(SRC, 'usage'))) {
      const t = readFileSync(f, 'utf8');
      expect(/from\s+['"](?:node:)?(?:http|https|net|tls|dns|undici|axios|node-fetch|openai|@anthropic-ai\/[^'"]+|@google\/[^'"]+|@aws-sdk\/[^'"]+)['"]/.test(t), f).toBe(false);
      expect(/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(t), f).toBe(false);
    }
  });
});
