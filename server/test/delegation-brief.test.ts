import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { DelegationBriefIn, canonicalJson, briefSha, scopeViolations, MAX_CHAIN_DEPTH, type Capability } from '../src/delegation/brief.ts';
import { CURRENT_BASELINE } from '../src/policy/index.ts';

let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'c42-' + Date.now() + '-' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;

const base = (over: Record<string, unknown> = {}) => ({
  goal: 'Draft the landing page copy', inputs: ['file:brief.md'], acceptance: ['Copy fits the template', 'A human can read it in under a minute'],
  capabilities: [{ kind: 'read' }, { kind: 'fill_draft' }], escalation: 'Ask the mission owner when a fact is missing', ...over,
});

async function setup(shared = false) {
  t = await makeTestApp({ staffingStepMs: 30 });
  const A = await withAdmin(t.app);
  const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared }, key())).body.mission.id as string;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
  const inst = (await rows(`select id, agent_id from agent_instances where mission_id=$1 order by seq`, [m])) as { id: string; agent_id: string }[];
  expect(inst.length).toBeGreaterThanOrEqual(4);
  // start from a clean slate: the simulator's own briefs would otherwise be the parents
  await t.pool.query('alter table delegation_briefs disable trigger user');
  await t.pool.query('delete from delegation_briefs');
  await t.pool.query('alter table delegation_briefs enable trigger user');
  const post = (who: { req: Function }, body: unknown) => who.req('POST', `/missions/${m}/delegation-briefs`, body, key());
  return { A, m, inst, post };
}

describe('pure rules', () => {
  it('rejects an empty acceptance list, unknown keys and bad bounds', () => {
    expect(DelegationBriefIn.safeParse(base()).success).toBe(true);
    expect(DelegationBriefIn.safeParse(base({ acceptance: [] })).success).toBe(false);
    expect(DelegationBriefIn.safeParse(base({ extra: 1 })).success).toBe(false);
    expect(DelegationBriefIn.safeParse(base({ goal: 'x'.repeat(501) })).success).toBe(false);
    expect(DelegationBriefIn.safeParse(base({ deadline: 'tomorrow' })).success).toBe(false);
    expect(DelegationBriefIn.safeParse(base({ budget: 0 })).success).toBe(false);
  });
  it('sha256 is stable under key order, capability order and duplicates', () => {
    const a = DelegationBriefIn.parse(base({ capabilities: [{ kind: 'read' }, { kind: 'fill_draft', origin: 'https://A.example/path' }] }));
    const b = DelegationBriefIn.parse({ escalation: 'Ask the mission owner when a fact is missing', capabilities: [{ origin: 'https://a.example', kind: 'fill_draft' }, { kind: 'read' }, { kind: 'read' }],
      acceptance: ['Copy fits the template', 'A human can read it in under a minute'], inputs: ['file:brief.md'], goal: 'Draft the landing page copy' });
    expect(briefSha(a)).toBe(briefSha(b));
    expect(briefSha(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson({ b: 1, a: { d: 1, c: [2, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[2,{"y":2,"z":1}],"d":1},"b":1}');
    expect(briefSha({ ...a, goal: 'Another goal' })).not.toBe(briefSha(a));
  });
  it('scopeViolations names the items outside the parent', () => {
    const parent: Capability[] = [{ kind: 'read' }, { kind: 'fill_draft', origin: 'https://a.example' }];
    expect(scopeViolations(parent, [{ kind: 'read', origin: 'https://b.example' }, { kind: 'fill_draft', origin: 'https://a.example' }])).toEqual([]);
    expect(scopeViolations(parent, [{ kind: 'fill_draft' }, { kind: 'send_message' }])).toEqual(['fill_draft', 'send_message']);
    expect(scopeViolations(parent, [{ kind: 'fill_draft', origin: 'https://c.example' }])).toEqual(['fill_draft @ https://c.example']);
    expect(MAX_CHAIN_DEPTH).toBe(3);
    expect(Object.isFrozen(CURRENT_BASELINE)).toBe(true);
  });
  it('property: over 300 random chains no accepted delegate holds a capability an ancestor lacked', () => {
    let seed = 42;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const kinds = Object.keys(CURRENT_BASELINE.kinds);
    const origins = [undefined, 'https://a.example', 'https://b.example', 'https://c.example'];
    const pick = (): Capability => { const o = origins[Math.floor(rnd() * origins.length)]; return { kind: kinds[Math.floor(rnd() * kinds.length)], ...(o ? { origin: o } : {}) }; };
    let accepted = 0, refused = 0;
    for (let c = 0; c < 300; c++) {
      let chain: Capability[][] = [Array.from({ length: 1 + Math.floor(rnd() * 8) }, pick)];
      for (let d = 1; d < MAX_CHAIN_DEPTH; d++) {
        const parent = chain[d - 1];
        const ask: Capability[] = Array.from({ length: Math.floor(rnd() * 6) }, () => (rnd() < 0.6 && parent.length ? parent[Math.floor(rnd() * parent.length)] : pick()));
        if (scopeViolations(parent, ask).length === 0) { chain.push(ask); accepted++; } else { refused++; break; }
      }
      // every accepted level is covered by every ancestor
      for (let d = 1; d < chain.length; d++) for (let a = 0; a < d; a++) {
        for (const cap of chain[d]) expect(chain[a].some((p) => p.kind === cap.kind && (p.origin === undefined || p.origin === cap.origin)), `chain ${c} level ${d} vs ${a}`).toBe(true);
      }
    }
    expect(accepted).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(20);
  });
});

describe('delegation briefs (API)', () => {
  it('subset rule holds at depth 1, 2 and 3; a superset is 403 naming the items; depth over the cap is 400', async () => {
    const { A, m, inst, post } = await setup();
    const r1 = await post(A.admin, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'fill_draft' }, { kind: 'send_message' }] }) });
    expect(r1.status).toBe(201); expect(r1.body.brief.depth).toBe(1); expect(r1.body.brief.fromKind).toBe('user');
    const r2 = await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'fill_draft' }] }) });
    expect(r2.status).toBe(201); expect(r2.body.brief.depth).toBe(2); expect(r2.body.brief.parentBriefId).toBe(r1.body.brief.id);
    const r3 = await post(A.admin, { fromInstanceId: inst[1].id, toInstanceId: inst[2].id, brief: base({ capabilities: [{ kind: 'read' }] }) });
    expect(r3.status).toBe(201); expect(r3.body.brief.depth).toBe(3);
    // superset at depth 3: the parent (depth 2) lacks send_message, although the root had it
    const sup = await post(A.admin, { fromInstanceId: inst[1].id, toInstanceId: inst[3].id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'send_message' }, { kind: 'fill_draft' }] }) });
    expect(sup.status).toBe(403);
    expect(sup.body.message).toContain('send_message'); expect(sup.body.message).not.toContain('fill_draft');
    expect(sup.body.fieldErrors.capabilities).toContain('send_message');
    // depth 4
    const deep = await post(A.admin, { fromInstanceId: inst[2].id, toInstanceId: inst[3].id, brief: base({ capabilities: [{ kind: 'read' }] }) });
    expect(deep.status).toBe(400); expect(deep.body.message).toMatch(/depth/i);
    expect((await rows(`select count(*)::int n from delegation_briefs where mission_id=$1`, [m]))[0].n).toBe(3);
  });

  it('no acceptance criteria is 400; a child deadline after the parent is 400; the child budget may not exceed the parent', async () => {
    const { A, inst, post } = await setup();
    const soon = new Date(Date.now() + 3600_000).toISOString(), later = new Date(Date.now() + 7200_000).toISOString();
    expect((await post(A.admin, { toInstanceId: inst[0].id, brief: base({ acceptance: [] }) })).status).toBe(400);
    expect((await post(A.admin, { toInstanceId: inst[0].id, brief: base({ deadline: new Date(Date.now() - 1000).toISOString() }) })).status).toBe(400);
    expect((await post(A.admin, { toInstanceId: inst[0].id, brief: base({ deadline: soon, budget: 100 }) })).status).toBe(201);
    const late = await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base({ deadline: later }) });
    expect(late.status).toBe(400); expect(late.body.fieldErrors.deadline).toBeTruthy();
    expect((await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base({ budget: 101 }) })).status).toBe(400);
    expect((await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base({ deadline: soon, budget: 50 }) })).status).toBe(201);
  });

  it('the root is checked through evaluate(): a member cannot include a kind only an admin could approve, nor an origin; a prohibited kind is refused for everyone', async () => {
    const { A, m, inst, post } = await setup(true);
    const bob = await A.member('Bob');
    const r3 = await post(bob.b, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'release' }, { kind: 'read' }] }) });
    expect(r3.status).toBe(403); expect(r3.body.message).toContain('release'); expect(r3.body.message).not.toContain('read,');
    expect((await post(bob.b, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'read', origin: 'https://a.example' }] }) })).status).toBe(403);
    expect((await post(bob.b, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'send_message' }] }) })).status).toBe(201); // R2: a user approves
    for (const who of [A.admin, bob.b]) {
      const p = await post(who, { toInstanceId: inst[1].id, brief: base({ capabilities: [{ kind: 'autonomous_gate_change' }] }) });
      expect(p.status).toBe(403); expect(p.body.message).toContain('autonomous_gate_change');
    }
    // an agent may never hold a kind that is prohibited for agents, even though an admin could approve it
    const sp = await post(A.admin, { toInstanceId: inst[1].id, brief: base({ capabilities: [{ kind: 'security_policy_rewrite' }] }) });
    expect(sp.status).toBe(403);
    expect((await post(A.admin, { toInstanceId: inst[1].id, brief: base({ capabilities: [{ kind: 'not_a_kind' }] }) })).status).toBe(400);
    expect((await post(A.admin, { toInstanceId: 'nope', brief: base() })).status).toBe(422);
    void m;
  });

  it('a brief is immutable: a change is a new brief that supersedes the old one; the latest one is the delegator\'s scope', async () => {
    const { A, inst, post } = await setup();
    const a = await post(A.admin, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'fill_draft' }] }) });
    const b = await post(A.admin, { toInstanceId: inst[0].id, supersedes: a.body.brief.id, brief: base({ capabilities: [{ kind: 'read' }] }) });
    expect(b.status).toBe(201); expect(b.body.brief.supersedesId).toBe(a.body.brief.id);
    // the narrowed brief is now the scope: fill_draft is no longer delegable
    expect((await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base({ capabilities: [{ kind: 'fill_draft' }] }) })).status).toBe(403);
    expect((await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base({ capabilities: [{ kind: 'read' }] }) })).status).toBe(201);
    expect((await post(A.admin, { toInstanceId: inst[0].id, supersedes: 'no-such', brief: base() })).status).toBe(422);
  });

  it('identical briefs have the same sha256 whatever the key order', async () => {
    const { A, inst, post } = await setup();
    const a = await post(A.admin, { toInstanceId: inst[0].id, brief: base() });
    const reorder = JSON.parse(JSON.stringify(base()));
    const shuffled = Object.fromEntries(Object.entries(reorder).reverse());
    const b = await post(A.admin, { toInstanceId: inst[1].id, brief: shuffled });
    expect(a.body.brief.sha256).toBe(b.body.brief.sha256);
  });

  it('is append-only: UPDATE, DELETE and TRUNCATE throw; the demo purge cascade still works', async () => {
    const { A, m, inst, post } = await setup();
    await post(A.admin, { toInstanceId: inst[0].id, brief: base() });
    await expect(t.pool.query(`update delegation_briefs set sha256 = repeat('0', 64)`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from delegation_briefs`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate delegation_briefs`)).rejects.toThrow(/append-only/);
    const c = await t.pool.connect();
    try {
      await c.query('begin'); await c.query(`set local axion.purge_demo = 'on'`);
      await c.query(`delete from missions where id=$1`, [m]);
      await c.query('commit');
    } finally { c.release(); }
    expect((await rows(`select count(*)::int n from delegation_briefs`))[0].n).toBe(0);
  });

  it('visibility: a private mission is 404 for another member, for reads and writes; reads list briefs with tiers', async () => {
    const { A, m, inst, post } = await setup(false);
    const a = await post(A.admin, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'send_message' }] }) });
    const bob = await A.member('Bob');
    expect((await bob.b.req('GET', `/missions/${m}/delegation-briefs`)).status).toBe(404);
    expect((await post(bob.b, { toInstanceId: inst[0].id, brief: base() })).status).toBe(404);
    const g = await A.admin.req('GET', `/missions/${m}/delegation-briefs`);
    expect(g.status).toBe(200); expect(g.body.maxDepth).toBe(3);
    expect(g.body.briefs.map((x: any) => x.id)).toContain(a.body.brief.id);
    const dto = g.body.briefs.find((x: any) => x.id === a.body.brief.id);
    expect(dto.tiers).toMatchObject({ read: 'R0', send_message: 'R2' });
    expect((await A.admin.req('GET', `/missions/${m}/delegation-briefs`)).body.kinds.length).toBeGreaterThan(10);
  });

  it('reassign with a brief records it for the task; reassign without a brief still works (legacy)', async () => {
    const { A, m, inst } = await setup();
    const tn = (await rows(`select tenant_id from missions where id=$1`, [m]))[0].tenant_id;
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ('T-c42a',$1,$2,'A task','ready',$3,$4),('T-c42b',$1,$2,'B task','ready',$3,$4)`, [tn, m, inst[1].agent_id, inst[1].id]);
    const bad = await A.admin.req('POST', '/tasks/T-c42a/reassign', { toInstanceId: inst[2].id, brief: base({ acceptance: [] }) }, key());
    expect(bad.status).toBe(400);
    expect((await rows(`select owner_instance_id o from tasks where id='T-c42a'`))[0].o).toBe(inst[1].id); // nothing half-done
    const ok = await A.admin.req('POST', '/tasks/T-c42a/reassign', { toInstanceId: inst[2].id, reason: 'x', brief: base() }, key());
    expect(ok.status).toBe(200);
    const b = await rows(`select task_id, to_instance, depth from delegation_briefs where mission_id=$1`, [m]);
    expect(b).toEqual([{ task_id: 'T-c42a', to_instance: inst[2].id, depth: 1 }]);
    expect((await A.admin.req('POST', '/tasks/T-c42b/reassign', { toInstanceId: inst[3].id, reason: 'x' }, key())).status).toBe(200);
    expect((await rows(`select 1 from delegation_briefs where task_id='T-c42b'`)).length).toBe(0);
  });

  it('the DEMO simulator attaches valid briefs to the delegations it records (parent chain, subset)', async () => {
    t = await makeTestApp({ staffingStepMs: 30 });
    const A = await withAdmin(t.app);
    const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission.id as string;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
    const b = await rows(`select id, parent_brief_id, to_instance, depth, brief from delegation_briefs where mission_id=$1 order by seq`, [m]);
    expect(b.length).toBeGreaterThan(2);
    for (const x of b) {
      expect(x.depth).toBeLessThanOrEqual(3);
      expect(x.brief.acceptance.length).toBeGreaterThan(0);
      if (x.parent_brief_id) {
        const p = b.find((y) => y.id === x.parent_brief_id)!;
        expect(scopeViolations(p.brief.capabilities, x.brief.capabilities)).toEqual([]);
      }
    }
  });
});
