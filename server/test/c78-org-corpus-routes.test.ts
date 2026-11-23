import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { addVersion } from '../src/agents/service.ts';
import { createOrgRevision } from '../src/agents/org.ts';
import { tx } from '../src/db.ts';
import { BASE, BASE_AGENTS, BAD, GOOD, type Case } from './org-corpus.ts';

/**
 * c78 (O1c, c64 review S7): the org guardrail corpus through the REAL proposal routes, not only the pure function.
 * The 27 corpus agents (their models and states set per case) are inserted into a company whose chart is otherwise the seeded one, and each
 * case is posted as a dry run (POST /organization/proposals?dryRun=1), stored (POST /organization/proposals) and approved by a second
 * administrator (POST .../decision). Every bad case must be refused with the same rule the pure function names, and nothing else; every good
 * case must come back clean. A case with `max` runs in a second app whose operator setting is that escalation limit.
 */
const ST = { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' };
const NEW_RULES = ['TEAM_REVIEWERS', 'ESCALATION_TOO_DEEP'];
const CORPUS_IDS = BASE_AGENTS.filter((a) => a.id !== 'gm').map((a) => a.id);
type Edge = { supervisorId: string; subordinateId: string };

class World {
  t!: TestApp; Adm!: Browser; Bea!: Browser; n = 0; seedEdges: Edge[] = []; state = new Map<string, { status: string; model: string }>();
  key = () => ({ 'idempotency-key': 'oc' + Math.random().toString(36).slice(2) + this.n++ });
  async start(maxEscalationLevels?: number) {
    this.t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false, writeLimits: { proposals: { max: 5000, windowMs: 60_000 } }, ...(maxEscalationLevels !== undefined ? { orgGuardrails: { maxEscalationLevels } } : {}) });
    const w = await withAdmin(this.t.app);
    this.Adm = w.admin;
    const b = await w.member('Bea'); this.Bea = b.b;
    expect((await this.Adm.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
    await tx(this.t.app.db, async (c) => {
      for (const a of BASE_AGENTS) {
        if (a.id === 'gm') continue;
        await c.query(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ($1, 't-1', $1, $2, $3, $1, 'c78')`, [a.id, a.role ?? 'dev', a.dept ?? 'Dept']);
        await addVersion(c, { agentId: a.id, model: a.model ?? 'mystery-model', skills: [], tools: [], createdBy: 'c78' });
        this.state.set(a.id, { status: 'active', model: a.model ?? 'mystery-model' });
      }
      await createOrgRevision(c, { tenantId: 't-1', edges: (latest) => [...latest, ...BASE], note: 'c78 corpus chart', createdBy: 'c78' });
    });
    this.seedEdges = ((await this.graph()).edges).filter((e) => !CORPUS_IDS.includes(e.subordinateId));
  }
  graph = async () => (await this.Adm.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };
  /** Make the stored agents match what the case says (status and model), changing only what differs. */
  async setAgents(want: typeof BASE_AGENTS) {
    await tx(this.t.app.db, async (c) => {
      for (const a of want) {
        if (a.id === 'gm') continue;
        const cur = this.state.get(a.id)!;
        if (cur.status !== a.status) await c.query(`update agent_definitions set status=$2 where id=$1`, [a.id, a.status ?? 'active']);
        if (cur.model !== a.model) await addVersion(c, { agentId: a.id, model: a.model ?? 'mystery-model', skills: [], tools: [], createdBy: 'c78' });
        this.state.set(a.id, { status: a.status ?? 'active', model: a.model ?? 'mystery-model' });
      }
    });
  }
  async body(c: Case) {
    await this.setAgents(c.agents ?? BASE_AGENTS);
    const g = await this.graph();
    return { title: 'corpus', why: '', baseRevision: g.revision.seq, edges: [...this.seedEdges, ...c.edges], ...ST };
  }
  async stop() { await this.t?.close(); }
}

const bad = BAD.filter((c) => c.expect);
const defaultCases = (xs: Case[]) => xs.filter((c) => c.max === undefined);
const maxCases = (xs: Case[]) => xs.filter((c) => c.max !== undefined);
const codes = (r: { result?: { errors: { code: string }[] } }) => (r.result?.errors ?? []).map((e) => e.code);

describe('the corpus on the proposal routes (default limit of 6 levels)', () => {
  const W = new World();
  beforeAll(async () => { await W.start(); }, 120_000);
  afterAll(async () => { await W.stop(); });

  it('the corpus chart is in place: the same lines as the pure test, plus the seeded company, and the unchanged chart is a clean dry run', async () => {
    const r = await W.Adm.req('POST', '/organization/proposals?dryRun=1', await W.body(GOOD[0]));
    expect(r.status).toBe(200);
    expect(r.body.result.errors).toEqual([]);
    expect(r.body.result.contracts.every((k: { ok: boolean }) => k.ok)).toBe(true);
  });

  for (const c of defaultCases(bad)) {
    it(`dry run refuses: ${c.name}`, async () => {
      const r = await W.Adm.req('POST', '/organization/proposals?dryRun=1', await W.body(c));
      expect(r.status).toBe(200);
      expect(r.body.result.ok).toBe(false);
      const got = codes(r.body);
      expect(got, 'the rule the pure function names').toContain(c.expect);
      for (const code of c.also ?? []) expect(got).toContain(code);
      expect(got.filter((x) => !NEW_RULES.includes(x)), 'no older rule fires: the new rule alone refuses it').toEqual([]);
      expect(r.body.result.contracts.some((k: { ok: boolean; reasons: string[] }) => !k.ok && k.reasons.length > 0)).toBe(true);
    });
  }

  for (const c of defaultCases(GOOD)) {
    it(`dry run accepts: ${c.name}`, async () => {
      const r = await W.Adm.req('POST', '/organization/proposals?dryRun=1', await W.body(c));
      expect(r.status).toBe(200);
      expect(r.body.result.errors).toEqual([]);
      expect(r.body.result.ok).toBe(true);
      expect(r.body.result.contracts.every((k: { ok: boolean; reasons: string[] }) => k.ok && k.reasons.length === 0)).toBe(true);
    });
  }

  // stored and approved: every c78 shape and every third older one (each is a create plus a decision)
  const stored = defaultCases(bad).filter((c, i) => c.name.startsWith('c78') || i % 3 === 0);
  for (const c of stored) {
    it(`stored with the failed check and refused at approval (422 ORG_INVALID): ${c.name}`, async () => {
      const made = await W.Adm.req('POST', '/organization/proposals', await W.body(c), W.key());
      expect(made.status).toBe(201);
      expect(made.body.proposal.result.ok).toBe(false);
      expect(codes(made.body.proposal)).toContain(c.expect);
      const dec = await W.Bea.req('POST', `/organization/proposals/${made.body.proposal.id}/decision`, { decision: 'approve', sha: made.body.proposal.sha });
      expect(dec.status).toBe(422);
      expect(dec.body.code).toBe('ORG_INVALID');
      expect((await W.Adm.req('GET', '/organization/graph')).body.revision.seq, 'a refused approval changes nothing').toBe(made.body.proposal.baseRevision);
    });
  }

  it('a good proposal is stored clean and approved by a second administrator, and the new chart is the active one (last: it moves the revision)', async () => {
    const c = GOOD.find((x) => x.name.startsWith('c78 an agent is promoted above its lead'))!;
    const body = await W.body(c);
    const made = await W.Adm.req('POST', '/organization/proposals', body, W.key());
    expect(made.status).toBe(201);
    expect(made.body.proposal.result.ok).toBe(true);
    const dec = await W.Bea.req('POST', `/organization/proposals/${made.body.proposal.id}/decision`, { decision: 'approve', sha: made.body.proposal.sha });
    expect(dec.status).toBe(200);
    expect(dec.body.proposal.status).toBe('applied');
    const after = (await W.graph()).edges;
    expect(after.find((e) => e.subordinateId === 'lead-a')?.supervisorId).toBe('a1');
    expect(after.find((e) => e.subordinateId === 'a1')?.supervisorId).toBe('gm');
  });
});

describe('the corpus on the proposal routes (operator limit of 3 levels)', () => {
  const W = new World();
  beforeAll(async () => { await W.start(3); }, 120_000);
  afterAll(async () => { await W.stop(); });
  it('the cases that depend on the setting are in the corpus', () => { expect(maxCases(bad).length).toBeGreaterThanOrEqual(1); });
  for (const c of maxCases(bad)) {
    it(`dry run, stored and approval refuse: ${c.name}`, async () => {
      const body = await W.body(c);
      const dry = await W.Adm.req('POST', '/organization/proposals?dryRun=1', body);
      expect(dry.status).toBe(200);
      expect(codes(dry.body)).toContain(c.expect);
      expect(codes(dry.body).filter((x) => !NEW_RULES.includes(x))).toEqual([]);
      const made = await W.Adm.req('POST', '/organization/proposals', body, W.key());
      expect(made.status).toBe(201);
      const dec = await W.Bea.req('POST', `/organization/proposals/${made.body.proposal.id}/decision`, { decision: 'approve', sha: made.body.proposal.sha });
      expect(dec.status).toBe(422);
      expect(dec.body.code).toBe('ORG_INVALID');
    });
  }
});
