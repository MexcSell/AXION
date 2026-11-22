import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { DelegationBriefIn, canonicalJson, briefSha, scopeViolations, MAX_CHAIN_DEPTH, type Capability } from '../src/delegation/brief.ts';
import { effectiveScope, attachSimBrief } from '../src/delegation/service.ts';
import { tx } from '../src/db.ts';
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

async function setup(shared: boolean | { shared?: boolean; bobOwns?: boolean; noLimit?: boolean } = false) {
  const o = typeof shared === 'boolean' ? { shared } : shared;
  t = await makeTestApp({ staffingStepMs: 30, ...(o.noLimit ? { writeLimits: { proposals: { max: 1_000_000, windowMs: 60_000 } } } : {}) });
  const A = await withAdmin(t.app);
  const bobM = o.bobOwns ? await A.member('Bob') : undefined;
  const m = (await (bobM ? bobM.b : A.admin).req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: !!o.shared }, key())).body.mission.id as string;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
  const inst = (await rows(`select id, agent_id from agent_instances where mission_id=$1 order by seq`, [m])) as { id: string; agent_id: string }[];
  expect(inst.length).toBeGreaterThanOrEqual(4);
  // start from a clean slate: the simulator's own briefs would otherwise be the parents
  await t.pool.query('alter table delegation_briefs disable trigger user');
  await t.pool.query('delete from delegation_briefs');
  await t.pool.query('alter table delegation_briefs enable trigger user');
  const post = (who: { req: Function }, body: unknown) => who.req('POST', `/missions/${m}/delegation-briefs`, body, key());
  return { A, m, inst, post, bobM };
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
    expect(scopeViolations(parent, [{ kind: 'read' }, { kind: 'fill_draft', origin: 'https://a.example' }])).toEqual([]);
    expect(scopeViolations(parent, [{ kind: 'read', origin: 'https://b.example' }])).toEqual(['read @ https://b.example']); // M2: no origin does not mean every origin
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
        for (const cap of chain[d]) expect(chain[a].some((p) => p.kind === cap.kind && p.origin === cap.origin), `chain ${c} level ${d} vs ${a}`).toBe(true);
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
    const { A, m, inst, post, bobM: bob } = await setup({ shared: true, bobOwns: true });
    const r3 = await post(bob!.b, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'release' }, { kind: 'read' }] }) });
    expect(r3.status).toBe(403); expect(r3.body.message).toContain('release'); expect(r3.body.message).not.toContain('read,');
    expect((await post(bob!.b, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'read', origin: 'https://a.example' }] }) })).status).toBe(403);
    expect((await post(bob!.b, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'send_message' }] }) })).status).toBe(201); // R2: a user approves
    for (const who of [A.admin, bob!.b]) {
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

describe('fix round: the effective scope is the intersection along the chain (I1)', () => {
  it('narrowing an ancestor narrows every descendant at once, and the delegate cannot re-delegate what the ancestor lost', async () => {
    const { A, inst, post } = await setup();
    const root = await post(A.admin, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'send_message' }] }) });
    const child = await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'send_message' }] }) });
    expect(child.status).toBe(201);
    expect((await effectiveScope(t.pool, child.body.brief.id)).capabilities.map((c) => c.kind).sort()).toEqual(['read', 'send_message']);
    // the admin narrows the root: its latest brief is now [read]
    expect((await post(A.admin, { toInstanceId: inst[0].id, supersedes: root.body.brief.id, brief: base({ capabilities: [{ kind: 'read' }] }) })).status).toBe(201);
    const eff = await effectiveScope(t.pool, child.body.brief.id);
    expect(eff.capabilities).toEqual([{ kind: 'read' }]);
    expect(eff.narrowedBy.length).toBe(1); expect(eff.narrowedBy[0].dropped).toEqual(['send_message']);
    // rows were not rewritten
    expect((await rows(`select brief from delegation_briefs where id=$1`, [child.body.brief.id]))[0].brief.capabilities.length).toBe(2);
    // the attack: the delegate hands on what its ancestor no longer holds
    const atk = await post(A.admin, { fromInstanceId: inst[1].id, toInstanceId: inst[2].id, brief: base({ capabilities: [{ kind: 'send_message' }] }) });
    expect(atk.status).toBe(403); expect(atk.body.message).toContain('send_message');
    expect((await post(A.admin, { fromInstanceId: inst[1].id, toInstanceId: inst[2].id, brief: base({ capabilities: [{ kind: 'read' }] }) })).status).toBe(201);
    // the API list carries the effective scope
    const g = (await A.admin.req('GET', `/missions/${await missionOf()}/delegation-briefs`)).body.briefs.find((x: any) => x.id === child.body.brief.id);
    expect(g.effective.capabilities).toEqual([{ kind: 'read' }]); expect(g.effective.narrowedBy[0].dropped).toEqual(['send_message']);
    async function missionOf() { return (await rows(`select mission_id from delegation_briefs where id=$1`, [child.body.brief.id]))[0].mission_id as string; }
  });
});

describe('fix round: the simulator never wedges (I2)', () => {
  it('a narrower root brief for the manager posted mid-staffing: staffing still completes, children never ask for more', async () => {
    t = await makeTestApp({ staffingStepMs: 120 });
    const A = await withAdmin(t.app);
    const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission.id as string;
    const t0 = Date.now();
    let posted = false;
    while (Date.now() - t0 < 20000) {
      const gm = (await rows(`select id from agent_instances where mission_id=$1 and agent_id='gm'`, [m]))[0];
      if (gm && !posted) {
        const old = (await rows(`select id from delegation_briefs where mission_id=$1 and to_instance=$2 order by seq desc limit 1`, [m, gm.id]))[0];
        const r = await A.admin.req('POST', `/missions/${m}/delegation-briefs`, { toInstanceId: gm.id, ...(old ? { supersedes: old.id } : {}), brief: base({ capabilities: [{ kind: 'read' }] }) }, key());
        expect(r.status).toBe(201); posted = true;
      }
      if ((await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage === 'working') break;
      await new Promise((r) => setTimeout(r, 60));
    }
    expect(posted).toBe(true);
    expect((await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage).toBe('working');
    const b = (await A.admin.req('GET', `/missions/${m}/delegation-briefs`)).body.briefs as any[];
    for (const x of b) if (x.depth > 1 && x.fromKind === 'agent') expect(x.effective.capabilities.every((c: Capability) => c.kind === 'read')).toBe(true);
  });

  it('a brief refused by a rule is skipped and audited as brief_skipped, and the transaction stays usable', async () => {
    const { m, inst } = await setup();
    const tn = (await rows(`select tenant_id from missions where id=$1`, [m]))[0].tenant_id;
    // a parent brief whose deadline has passed (raw row: the API refuses to write it)
    const brief = { goal: 'Old goal', inputs: [], acceptance: ['x y z'], capabilities: [{ kind: 'read' }], deadline: new Date(Date.now() - 60_000).toISOString(), escalation: 'Ask the owner' };
    await t.pool.query(`insert into delegation_briefs(tenant_id, mission_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by) values ($1,$2,'u','user',$3,'x',$4,repeat('a',64),1,'u')`, [tn, m, inst[0].id, JSON.stringify(brief)]);
    const out = await tx(t.app.db, async (c) => {
      const r = await attachSimBrief(c, { tenantId: tn, missionId: m, fromInstanceId: inst[0].id, toInstanceId: inst[1].id, goal: 'x', simulated: false });
      const still = (await c.query('select 1 as one')).rows[0].one;
      return { r, still };
    });
    expect(out.r).toBeNull(); expect(out.still).toBe(1);
    const au = await rows(`select detail, result from audit_events where action='delegation.brief_skipped'`);
    expect(au.length).toBe(1); expect(JSON.stringify(au[0].detail)).toMatch(/deadline/i);
  });
});

describe('fix round: a child inherits the parent\'s deadline and budget (I3)', () => {
  it('omitting them inherits the effective bound, through the chain, and narrowing the parent narrows the child', async () => {
    const { A, inst, post } = await setup();
    const d1 = new Date(Date.now() + 3 * 3600_000).toISOString(), d0 = new Date(Date.now() + 1 * 3600_000).toISOString();
    const root = await post(A.admin, { toInstanceId: inst[0].id, brief: base({ deadline: d1, budget: 100 }) });
    const c1 = await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base() });
    expect(c1.body.brief.brief.deadline).toBe(d1); expect(c1.body.brief.brief.budget).toBe(100);
    const c2 = await post(A.admin, { fromInstanceId: inst[1].id, toInstanceId: inst[2].id, brief: base({ budget: 40 }) });
    expect(c2.body.brief.brief.deadline).toBe(d1); expect(c2.body.brief.brief.budget).toBe(40);
    expect((await post(A.admin, { toInstanceId: inst[0].id, supersedes: root.body.brief.id, brief: base({ deadline: d0, budget: 30 }) })).status).toBe(201);
    const eff = await effectiveScope(t.pool, c2.body.brief.id);
    expect(eff.deadline).toBe(d0); expect(eff.budget).toBe(30);
    // a new child is bounded by the narrowed effective values
    expect((await post(A.admin, { fromInstanceId: inst[1].id, toInstanceId: inst[3].id, brief: base({ budget: 31 }) })).status).toBe(400);
    expect((await post(A.admin, { fromInstanceId: inst[1].id, toInstanceId: inst[3].id, brief: base({ deadline: d1 }) })).status).toBe(400);
    const ok = await post(A.admin, { fromInstanceId: inst[1].id, toInstanceId: inst[3].id, brief: base() });
    expect(ok.status).toBe(201); expect(ok.body.brief.brief.deadline).toBe(d0); expect(ok.body.brief.brief.budget).toBe(30);
  });
});

describe('fix round: who may act (I4, M1, M2)', () => {
  it('speaking as an agent needs an admin or the mission owner', async () => {
    const { A, inst, post, bobM } = await setup({ shared: true, bobOwns: true });
    const carol = await A.member('Carol');
    expect((await post(bobM!.b, { toInstanceId: inst[0].id, brief: base() })).status).toBe(201); // the owner writes the root
    expect((await post(carol.b, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base() })).status).toBe(403);
    expect((await post(bobM!.b, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base() })).status).toBe(201);
    expect((await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[2].id, brief: base() })).status).toBe(201);
  });

  it('members of a shared mission can read briefs but cannot write root briefs', async () => {
    const { A, m, inst, post } = await setup(true);
    const carol = await A.member('Carol');
    expect((await carol.b.req('GET', `/missions/${m}/delegation-briefs`)).status).toBe(200);
    const w = await post(carol.b, { toInstanceId: inst[0].id, brief: base() });
    expect(w.status).toBe(403);
    expect((await rows(`select 1 from delegation_briefs`)).length).toBe(0);
  });

  it('superseding needs the original author or an admin; a superseded root is re-checked against the original author too', async () => {
    const { A, inst, post, bobM } = await setup({ shared: true, bobOwns: true });
    const carol = await A.member('Carol');
    const a = await post(bobM!.b, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'read' }] }) });
    expect(a.status).toBe(201);
    expect((await post(carol.b, { toInstanceId: inst[0].id, supersedes: a.body.brief.id, brief: base({ capabilities: [{ kind: 'read' }] }) })).status).toBe(403);
    // an admin passes the role check but Bob could never approve `release`: the narrower authority wins
    const up = await post(A.admin, { toInstanceId: inst[0].id, supersedes: a.body.brief.id, brief: base({ capabilities: [{ kind: 'release' }] }) });
    expect(up.status).toBe(403); expect(up.body.message).toContain('release');
    // the author may narrow his own, and the admin may replace it with something both could approve
    expect((await post(bobM!.b, { toInstanceId: inst[0].id, supersedes: a.body.brief.id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'summarize' }] }) })).status).toBe(201);
  });

  it('an agent with no brief of its own does not inherit a root brief written for another agent (M1)', async () => {
    const { A, inst, post } = await setup();
    expect((await post(A.admin, { toInstanceId: inst[0].id, brief: base() })).status).toBe(201);
    const r = await post(A.admin, { fromInstanceId: inst[2].id, toInstanceId: inst[3].id, brief: base({ capabilities: [{ kind: 'read' }] }) });
    expect(r.status).toBe(403);
  });

  it('read without an origin does not imply every origin (M2); the human gate is consistent', async () => {
    const { A, inst, post, bobM } = await setup({ shared: true, bobOwns: true });
    expect((await post(A.admin, { toInstanceId: inst[0].id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'summarize' }, { kind: 'fill_draft', origin: 'https://a.example' }] }) })).status).toBe(201);
    const wild = await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base({ capabilities: [{ kind: 'read', origin: 'https://b.example' }] }) });
    expect(wild.status).toBe(403); expect(wild.body.message).toContain('read @ https://b.example');
    expect((await post(A.admin, { fromInstanceId: inst[0].id, toInstanceId: inst[1].id, brief: base({ capabilities: [{ kind: 'read' }, { kind: 'fill_draft', origin: 'https://A.example/x' }] }) })).status).toBe(201);
    expect((await post(bobM!.b, { toInstanceId: inst[2].id, brief: base({ capabilities: [{ kind: 'read', origin: 'https://b.example' }] }) })).status).toBe(403); // a member cannot approve an origin grant
  });
});

describe('fix round: the random model drives the real service (M5)', () => {
  it('60 random chains of posts, delegations, supersedes and narrowings: no effective capability is ever outside any ancestor\'s latest brief', async () => {
    const { A, m, inst, post } = await setup({ noLimit: true });
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const kinds = ['read', 'summarize', 'fill_draft', 'send_message'];
    const origins = [undefined, 'https://a.example'];
    const pickCaps = (): Capability[] => Array.from({ length: Math.floor(rnd() * 5) }, () => { const o = origins[Math.floor(rnd() * 2)]; return { kind: kinds[Math.floor(rnd() * 4)], ...(o ? { origin: o } : {}) }; });
    const key2 = (c: Capability) => `${c.kind}|${c.origin ?? ''}`;
    let accepted = 0, refused = 0, superseded = 0, gated = 0;
    for (let c = 0; c < 60; c++) {
      await t.pool.query('alter table delegation_briefs disable trigger user');
      await t.pool.query('delete from delegation_briefs');
      await t.pool.query('alter table delegation_briefs enable trigger user');
      const held = new Set<number>();
      for (let step = 0; step < 6; step++) {
        const to = Math.floor(rnd() * 4), from = Math.floor(rnd() * 4);
        const caps = pickCaps();
        const list = (await A.admin.req('GET', `/missions/${m}/delegation-briefs`)).body.briefs as any[];
        const mine = list.filter((b) => b.toInstanceId === inst[to].id).pop();
        const r = rnd();
        let res;
        if (r < 0.25 || held.size === 0) res = await post(A.admin, { toInstanceId: inst[to].id, ...(mine && rnd() < 0.7 ? { supersedes: mine.id } : {}), brief: base({ capabilities: caps }) });
        else res = await post(A.admin, { fromInstanceId: inst[from].id, toInstanceId: inst[to].id, brief: base({ capabilities: caps }) });
        if (res.status === 201 && res.body.brief.fromKind === 'agent') {
          // the creation gate: what was accepted lies inside the delegator's effective scope read just before the post
          const before = list.filter((b) => b.toInstanceId === inst[from].id).pop();
          const allowed = new Set<string>((before?.effective.capabilities ?? []).map(key2));
          for (const cp of res.body.brief.brief.capabilities as Capability[]) expect(allowed.has(key2(cp)), `chain ${c} step ${step}: accepted ${key2(cp)} outside the delegator's effective scope`).toBe(true);
          gated++;
        }
        if (res.status === 201) { accepted++; held.add(to); if (res.body.brief.supersedesId) superseded++; } else { refused++; expect([400, 403, 422]).toContain(res.status); }
        // the invariant, on the whole current state: effective(b) is inside b and inside the latest brief of every ancestor
        const now = (await A.admin.req('GET', `/missions/${m}/delegation-briefs`)).body.briefs as any[];
        const latest = new Map<string, any>(); for (const b of now) latest.set(b.toInstanceId, b);
        for (const b of now) {
          const eff = new Set<string>(b.effective.capabilities.map(key2));
          for (const k of eff) expect(new Set<string>(b.brief.capabilities.map(key2)).has(k)).toBe(true);
          for (let p = b.parentBriefId ? now.find((x) => x.id === b.parentBriefId) : undefined, n = 0; p && n < 5; p = p.parentBriefId ? now.find((x) => x.id === p.parentBriefId) : undefined, n++) {
            const pl = latest.get(p.toInstanceId) ?? p;
            const have = new Set<string>(pl.brief.capabilities.map(key2));
            for (const k of eff) expect(have.has(k), `chain ${c} step ${step}: ${k} outside ancestor ${pl.id}`).toBe(true);
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(100); expect(refused).toBeGreaterThan(20); expect(superseded).toBeGreaterThan(10); expect(gated).toBeGreaterThan(30);
  }, 120_000);
});

describe('fix round 2: another tenant (404)', () => {
  it('an admin of another tenant gets 404 on the briefs route and on reassign-with-brief', async () => {
    const { A, m, inst, post } = await setup();
    await t.pool.query(`insert into tenants(id,name) values ('t-2','Other')`);
    await t.pool.query(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
    await t.pool.query(`insert into missions(id,tenant_id,owner_id,shared,status) values ('M-9002','t-2','u-x',true,'running')`);
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status) values ('T-x2','t-2','M-9002','Other task','ready')`);
    expect((await A.admin.req('GET', `/missions/M-9002/delegation-briefs`)).status).toBe(404);
    expect((await post({ req: (mm: string, u: string, b: unknown, h: Record<string, string>) => A.admin.req(mm, u.replace(m, 'M-9002'), b, h) }, { toInstanceId: inst[0].id, brief: base() })).status).toBe(404);
    const r = await A.admin.req('POST', '/tasks/T-x2/reassign', { toInstanceId: inst[0].id, reason: 'x', brief: base() }, key());
    expect(r.status).toBe(404);
    expect((await rows(`select 1 from delegation_briefs where mission_id='M-9002'`)).length).toBe(0);
  });
});
