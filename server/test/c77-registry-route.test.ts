import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeSchema } from './helpers.ts';
import { route, type ModelEntry, type RoutingPolicy } from '../src/models/route.ts';
import { addModelEntry, latestModels, setRoutingPolicy, latestPolicy } from '../src/models/registry.ts';
import { FakeAdapter } from './fakes/fake-adapter.ts';

/** c77 item 2: the model registry, the routing policy as data, and the pure route(). Only a FAKE adapter under test/ ever "answers". */
const e = (model: string, family: string, capabilities: string[], status: ModelEntry['status'] = 'active'): ModelEntry => ({ model, family, version: '1', capabilities, status });
const entries: ModelEntry[] = [
  e('claude-opus-5-5', 'anthropic', ['text', 'code', 'long']),
  e('claude-haiku-5', 'anthropic', ['text']),
  e('gpt-5', 'openai', ['text', 'code']),
  e('gemini-3', 'google', ['text', 'vision'], 'deprecated'),
  e('llama-4', 'meta', ['text', 'code'], 'disabled'),
];
const policy: RoutingPolicy = { name: 'default', version: 1, rules: [
  { id: 'long', requires: ['long'], prefer: ['claude-opus-5-5'] },
  { id: 'code', requires: ['code'], prefer: ['gpt-5', 'claude-opus-5-5', 'llama-4'] },
  { id: 'any', requires: [], prefer: ['claude-haiku-5', 'gpt-5'] },
] };

describe('route(policy, request, entries) (table-driven)', () => {
  const rows: [string, string[], { exclude?: string[]; excludeFamilies?: string[] }, string | null, string][] = [
    ['the first matching rule wins', ['long'], {}, 'claude-opus-5-5', 'rule:long:preferred'],
    ['a code request takes the first preferred entry', ['code'], {}, 'gpt-5', 'rule:code:preferred'],
    ['an excluded model falls to the next preference', ['code'], { exclude: ['gpt-5'] }, 'claude-opus-5-5', 'rule:code:fallback'],
    ['an excluded family is skipped (independence)', ['code'], { excludeFamilies: ['openai'] }, 'claude-opus-5-5', 'rule:code:fallback'],
    ['a disabled entry is never chosen', ['code'], { exclude: ['gpt-5', 'claude-opus-5-5'] }, null, 'no_eligible_model'],
    ['a plain text request uses the catch-all rule', ['text'], {}, 'claude-haiku-5', 'rule:any:preferred'],
    ['an empty request still matches the catch-all', [], {}, 'claude-haiku-5', 'rule:any:preferred'],
    ['an entry lacking a requested capability is skipped', ['text', 'vision'], {}, null, 'no_eligible_model'],
    ['a deprecated entry is not chosen', ['vision'], {}, null, 'no_eligible_model'],
    ['an entry must hold every requested capability, so a later rule cannot widen the request', ['long', 'code'], { exclude: ['claude-opus-5-5'] }, null, 'no_eligible_model'],
    ['a later matching rule is tried when the first has no eligible entry', ['text'], { exclude: ['claude-haiku-5'] }, 'gpt-5', 'rule:any:fallback'],
  ];
  for (const [name, capabilities, extra, model, reason] of rows) {
    it(name, () => {
      const r = route(policy, { capabilities, ...extra }, entries);
      expect(r.entry?.model ?? null).toBe(model);
      expect(r.reason).toBe(reason);
    });
  }
  it('fails closed on a malformed policy, an unknown preferred model and a null family', () => {
    expect(route({ ...policy, rules: [{ id: '', requires: [], prefer: ['gpt-5'] }] }, { capabilities: [] }, entries)).toEqual({ entry: null, reason: 'invalid_policy' });
    expect(route({ name: 'x', version: 1, rules: [] }, { capabilities: [] }, entries)).toEqual({ entry: null, reason: 'invalid_policy' });
    expect(route({ name: 'x', version: 1, rules: [{ id: 'r', requires: [], prefer: ['ghost'] }] }, { capabilities: [] }, entries).reason).toBe('no_eligible_model');
    expect(route(policy, { capabilities: [] }, [e('weird-model', 'anthropic', ['text'])]).entry).toBeNull();
  });
  it('is pure and deterministic, and does not change its inputs', () => {
    const s = JSON.stringify([policy, entries]);
    expect(route(policy, { capabilities: ['code'] }, entries)).toEqual(route(policy, { capabilities: ['code'] }, entries));
    expect(JSON.stringify([policy, entries])).toBe(s);
  });
  it('the chosen entry is handed to a FAKE adapter by the caller; route() itself never takes or calls an adapter', () => {
    const adapter = new FakeAdapter();
    expect(route.length).toBe(3);
    const r = route(policy, { capabilities: ['text'] }, entries);
    expect(adapter.calls).toHaveLength(0);
    const out = adapter.complete(r.entry!, 'hello');
    expect(out).toBe('[fake anthropic/claude-haiku-5] 5 chars');
    expect(adapter.calls).toEqual([{ model: 'claude-haiku-5', prompt: 'hello' }]);
  });
});

describe('model registry and routing policy records', () => {
  let s: Awaited<ReturnType<typeof makeSchema>>;
  beforeAll(async () => { s = await makeSchema(); });
  afterAll(async () => { await s?.drop(); });
  const T = 'ten-1';
  const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);

  it('stores entries; the family must be the c38 vendor-table family of the model name (unknown names fail closed)', async () => {
    const r = await addModelEntry(s.pool, { tenantId: T, model: 'claude-opus-5-5', family: 'anthropic', version: '5.5', capabilities: ['text', 'code'], status: 'active' });
    expect(r).toMatchObject({ model: 'claude-opus-5-5', family: 'anthropic', capabilities: ['code', 'text'], status: 'active' }); // stored sorted
    await expect(addModelEntry(s.pool, { tenantId: T, model: 'claude-opus-5-5', family: 'openai', version: '1', capabilities: [], status: 'active' })).rejects.toThrow(/family/);
    await expect(addModelEntry(s.pool, { tenantId: T, model: 'my-proxy', family: 'anthropic', version: '1', capabilities: [], status: 'active' })).rejects.toThrow(/family/);
    await expect(addModelEntry(s.pool, { tenantId: T, model: 'gpt-5', family: 'openai', version: '1', capabilities: [], status: 'bogus' as never })).rejects.toThrow();
  });
  it('a status change is a new row; the latest row per model counts; earlier rows stay', async () => {
    await addModelEntry(s.pool, { tenantId: T, model: 'claude-opus-5-5', family: 'anthropic', version: '5.5', capabilities: ['text', 'code'], status: 'deprecated' });
    await addModelEntry(s.pool, { tenantId: T, model: 'gpt-5', family: 'openai', version: '5', capabilities: ['text'], status: 'active' });
    const now = await latestModels(s.pool, T);
    expect(now.map((m) => [m.model, m.status])).toEqual([['claude-opus-5-5', 'deprecated'], ['gpt-5', 'active']]);
    expect(Number((await q(`select count(*) from model_entries where model='claude-opus-5-5'`)).rows[0].count)).toBe(2);
    expect(await latestModels(s.pool, 'other-tenant')).toEqual([]);
  });
  it('policies are versioned rows; the latest version of a name counts; the stored data routes', async () => {
    const p1 = await setRoutingPolicy(s.pool, { tenantId: T, name: 'default', rules: [{ id: 'any', requires: [], prefer: ['claude-opus-5-5'] }] });
    const p2 = await setRoutingPolicy(s.pool, { tenantId: T, name: 'default', rules: [{ id: 'any', requires: [], prefer: ['gpt-5'] }] });
    expect([p1.version, p2.version]).toEqual([1, 2]);
    const pol = (await latestPolicy(s.pool, T, 'default'))!;
    expect(pol.version).toBe(2);
    expect(route(pol, { capabilities: [] }, await latestModels(s.pool, T)).entry?.model).toBe('gpt-5');
    await expect(setRoutingPolicy(s.pool, { tenantId: T, name: 'bad', rules: [] })).rejects.toThrow(/policy/);
    expect(await latestPolicy(s.pool, T, 'nope')).toBeNull();
  });
  it('both tables are append-only with all four guards (update, delete, truncate, purge_demo exception)', async () => {
    for (const t of ['model_entries', 'routing_policies']) {
      await expect(q(`update ${t} set tenant_id = tenant_id`)).rejects.toThrow(/append-only/);
      await expect(q(`delete from ${t}`)).rejects.toThrow(/append-only/);
      await expect(q(`truncate ${t}`)).rejects.toThrow(/append-only/);
    }
    const c = await s.pool.connect();
    try {
      await c.query('begin'); await c.query("set local axion.purge_demo = 'on'");
      expect((await c.query(`delete from model_entries where tenant_id=$1`, [T])).rowCount).toBeGreaterThan(0);
      expect((await c.query(`delete from routing_policies where tenant_id=$1`, [T])).rowCount).toBeGreaterThan(0);
      await c.query('commit');
    } finally { c.release(); }
  });
});

describe('no route calls a model', () => {
  const SRC = join(__dirname, '../src');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
  it('nothing outside src/models imports it, and no src file imports a fake, an SDK or a network module', () => {
    for (const f of walk(SRC)) {
      const t = readFileSync(f, 'utf8');
      if (!f.includes('/src/models/')) expect(/models\/(?:route|registry)/.test(t), f).toBe(false);
      expect(/test\/fakes|fake-adapter|fake-meter/.test(t), f).toBe(false);
      expect(/from\s+['"](?:openai|@anthropic-ai\/[^'"]+|@google\/[^'"]+|@aws-sdk\/[^'"]+|undici|axios|node-fetch|(?:node:)?(?:https?|net|tls|dns))['"]/.test(t), f).toBe(false);
    }
    for (const f of walk(join(SRC, 'models'))) expect(/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(readFileSync(f, 'utf8')), f).toBe(false);
  });
});
