import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';
import { seedDemo } from '../src/seed/demo.ts';
import { configDiff, normalizeConfig } from '../src/agents/versions.ts';
import { LOCK_KEY_SQL } from '../src/locks.ts';

// Improvement cycle 5 (theme C): agent version proposals, promote and rollback under governance
// (brief web/docs/improve/cycles/c05-brief.md, "Tests").
let t: TestApp;
let A: Browser; // administrator who proposes
let B: Browser; // second administrator who decides
let M: Browser; // member
let aId = '', bId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'v' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await rows(sql, p))[0].n as number;
const until = async (f: () => Promise<boolean>, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };

const AG = 'coder-01';
type Cfg = { model: string; skills: string[]; tools: string[] };
const agent = async (id = AG) => (await A.req('GET', `/agents/${id}`)).body.agent as Cfg & { versionId: string; versionLabel: string; rowVersion: number; versions: { id: string; seq: number; label: string; parentVersionId: string | null }[] };
async function propose(by: Browser, change: (c: Cfg) => Cfg, extra: Record<string, unknown> = {}, id = AG) {
  const a = await agent(id);
  const candidate = change({ model: a.model, skills: [...a.skills], tools: [...a.tools] });
  return by.req('POST', `/agents/${id}/version-proposals`, { title: 'Add a skill', hypothesis: 'Fewer review rounds on frontend tasks.', candidate, baseVersionId: a.versionId, ...extra }, key());
}
const addSkill = (s: string) => (c: Cfg) => ({ ...c, skills: [...c.skills, s] });
// c47: a promotion without a verified evaluation needs a written reason; these cycle-5 tests have no evaluation runs, so the
// override path applies (tests/eval-evidence.test.ts covers the gate itself).
const decide = (by: Browser, p: { id: string; sha: string; evaluationSha?: string }, decision: 'promote' | 'reject', extra: Record<string, unknown> = {}) =>
  by.req('POST', `/version-proposals/${p.id}/decision`, { decision, sha: p.sha, ...(decision === 'promote' ? { overrideReason: 'No evaluation yet; reviewed by hand.', evaluationSha: p.evaluationSha } : {}), ...extra });
const pinned = async () => rows(`select id, agent_version_id from agent_instances where agent_id=$1 order by id`, [AG]);

beforeAll(async () => {
  // c14 merge: these routes now share the per-session proposals budget (30/min). This suite makes more governance writes
  // per admin session per minute than a person would, so only here the budget is lifted; security.test.ts tests the limit.
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea');
  B = b.b; bId = b.id;
  expect((await A.req('PATCH', `/users/${bId}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b;
  await seedDemo(t.app.db, 't-1', aId); // DEMO missions with instances pinned to the agents' versions
});
afterAll(async () => { await t.close(); });

describe('pure helpers', () => {
  it('normalizeConfig trims and de-duplicates; configDiff lists added/removed skills and tools and a model change', () => {
    expect(normalizeConfig({ model: ' m ', skills: [' a', 'b', 'a'], tools: ['t', 't'] })).toEqual({ model: 'm', skills: ['a', 'b'], tools: ['t'] });
    expect(configDiff({ model: 'm1', skills: ['a', 'b'], tools: ['x'] }, { model: 'm2', skills: ['b', 'c'], tools: ['x', 'y'] }))
      .toEqual({ skillsAdded: ['c'], skillsRemoved: ['a'], toolsAdded: ['y'], toolsRemoved: [], model: { from: 'm1', to: 'm2' }, changed: true });
    expect(configDiff({ model: 'm', skills: ['a', 'b'], tools: [] }, { model: 'm', skills: ['b', 'a'], tools: [] }).changed).toBe(false); // order only
  });
});

describe('permissions and creation', () => {
  it('every signed-in user can read proposals (all, and per agent); anonymous cannot', async () => {
    const r = await M.req('GET', '/version-proposals');
    expect(r.status).toBe(200);
    expect(r.body.proposals).toEqual([]);
    expect((await M.req('GET', `/agents/${AG}/version-proposals`)).status).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/version-proposals' })).statusCode).toBe(401);
    expect((await A.req('GET', '/agents/nobody-99/version-proposals')).status).toBe(404);
  });

  it('a member proposing is 403; POST needs an Idempotency-Key', async () => {
    expect((await propose(M, addSkill('Svelte'))).status).toBe(403);
    const a = await agent();
    const r = await A.req('POST', `/agents/${AG}/version-proposals`, { title: 'x', hypothesis: 'y', candidate: { model: a.model, skills: [...a.skills, 'Svelte'], tools: a.tools }, baseVersionId: a.versionId });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await count('select count(*)::int n from agent_version_proposals')).toBe(0);
  });

  it('a base that is not the active version is 409 AGENT_CHANGED', async () => {
    const r = await propose(A, addSkill('Svelte'), { baseVersionId: '00000000-0000-4000-8000-000000000000' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('AGENT_CHANGED');
  });

  it('a candidate equal to the base (also: only reordered or repeated) is 422', async () => {
    const same = await propose(A, (c) => c);
    expect(same.status).toBe(422);
    expect(same.body.code).toBe('CANDIDATE_UNCHANGED');
    const reordered = await propose(A, (c) => ({ ...c, skills: [...c.skills].reverse().concat(c.skills[0]) }));
    expect(reordered.status).toBe(422);
    expect(await count('select count(*)::int n from agent_version_proposals')).toBe(0);
  });
});

describe('propose → another admin promotes', () => {
  let p: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let base: Awaited<ReturnType<typeof agent>>;
  let before: { id: string; agent_version_id: string }[];
  it('admin A proposes new skills: stored with base, candidate, diff and a sha; audited; announced to everyone', async () => {
    base = await agent();
    before = await pinned();
    expect(before.length).toBeGreaterThan(0); // a running (DEMO) mission has an instance of this agent: non-vacuous
    expect(before.every((i) => i.agent_version_id === base.versionId)).toBe(true);
    const r = await propose(A, addSkill('Svelte'));
    expect(r.status).toBe(201);
    p = r.body.proposal;
    expect(p.id).toMatch(/^VP-[0-9A-F]{32}$/);
    expect(p).toMatchObject({ agentId: AG, status: 'pending', baseVersionId: base.versionId, baseVersionLabel: base.versionLabel, activeVersionId: base.versionId, stale: false,
      createdBy: aId, createdByName: 'Luca', promotedVersionId: null, title: 'Add a skill', hypothesis: 'Fewer review rounds on frontend tasks.' });
    expect(p.base).toEqual({ model: base.model, skills: base.skills, tools: base.tools });
    expect(p.candidate.skills).toEqual([...base.skills, 'Svelte']);
    expect(p.diff).toMatchObject({ skillsAdded: ['Svelte'], skillsRemoved: [], toolsAdded: [], toolsRemoved: [], model: null });
    expect(p.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(p.candidateSha).toMatch(/^[0-9a-f]{64}$/);
    expect(p.baseSha).toBe((await rows('select prompt_hash from agent_versions where id=$1', [base.versionId]))[0].prompt_hash);
    expect(p.evaluation).toBeNull(); // no invented evaluation numbers
    expect(new Date(p.expiresAt).getTime() - new Date(p.createdAt).getTime()).toBe(14 * 24 * 3600 * 1000);
    expect(await count(`select count(*)::int n from audit_events where action='agent.version.propose' and subject=$1 and result='ok'`, [p.id])).toBe(1);
    const ev = await rows(`select * from events where type='agent.versionProposed'`);
    expect(ev.length).toBe(1);
    expect(ev[0]).toMatchObject({ subject_kind: 'agent', subject_id: AG, audience: 'all' });
    expect(ev[0].payload.proposalId).toBe(p.id);
    // nothing changed on the agent yet
    expect((await agent()).versionId).toBe(base.versionId);
    // lists: everyone, all agents and per agent
    expect((await M.req('GET', '/version-proposals')).body.proposals.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect((await M.req('GET', `/agents/${AG}/version-proposals`)).body.proposals.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect((await M.req('GET', `/agents/designer-01/version-proposals`)).body.proposals).toEqual([]);
  });

  it('the same candidate again (another key) is 409 DUPLICATE_PROPOSAL', async () => {
    const r = await propose(A, addSkill('Svelte'), { title: 'Same again' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DUPLICATE_PROPOSAL');
    expect(await count(`select count(*)::int n from agent_version_proposals where status='pending'`)).toBe(1);
  });

  it('the author promoting is 403 SELF_APPROVAL (audited as denied); rejecting their own is 403 too', async () => {
    const r = await decide(A, p, 'promote');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SELF_APPROVAL');
    expect((await decide(A, p, 'reject')).body.code).toBe('SELF_APPROVAL');
    expect(await count(`select count(*)::int n from audit_events where action='agent.version.decide' and subject=$1 and result='denied'`, [p.id])).toBe(2);
    expect((await rows('select status from agent_version_proposals where id=$1', [p.id]))[0].status).toBe('pending');
  });

  it('c47: promoting a proposal with no evaluation and no override reason is 409 EVAL_OVERRIDE_REQUIRED (nothing changes)', async () => {
    const q = await propose(A, addSkill('Gate-check'));
    const r = await decide(B, q.body.proposal, 'promote', { overrideReason: undefined });
    expect(r.status).toBe(409); expect(r.body.code).toBe('EVAL_OVERRIDE_REQUIRED');
    expect((await rows('select status from agent_version_proposals where id=$1', [q.body.proposal.id]))[0].status).toBe('pending');
    expect((await decide(B, q.body.proposal, 'reject')).status).toBe(200); // clean up: it must not leave a pending duplicate behind
  });

  it('a member deciding is 403', async () => {
    const r = await decide(M, p, 'promote');
    expect(r.status).toBe(403);
    expect((await rows('select status from agent_version_proposals where id=$1', [p.id]))[0].status).toBe('pending');
  });

  it('a tampered sha is 409 PROPOSAL_CHANGED', async () => {
    const r = await decide(B, { ...p, sha: 'f'.repeat(64) }, 'promote');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PROPOSAL_CHANGED');
    expect((await agent()).versionId).toBe(base.versionId);
  });

  it('admin B promotes: a new immutable version with the candidate config, parent = base, active; instances keep theirs', async () => {
    const r = await decide(B, p, 'promote', { note: 'Looks right.' });
    expect(r.status).toBe(200);
    const after = await agent();
    expect(after.versionId).not.toBe(base.versionId);
    expect(after.skills).toEqual([...base.skills, 'Svelte']);
    expect(after.rowVersion).toBe(base.rowVersion + 1); // a stale If-Match edit answers 409, never overwrites the promotion
    const v = (await rows('select * from agent_versions where id=$1', [after.versionId]))[0];
    expect(v.parent_version_id).toBe(base.versionId);
    expect(v.seq).toBe(base.versions.length + 1);
    expect(v.prompt_hash).toBe(p.candidateSha);
    expect(r.body.proposal).toMatchObject({ status: 'promoted', promotedVersionId: after.versionId, promotedVersionLabel: after.versionLabel, decidedBy: bId, decidedByName: 'Bea', note: 'Looks right.' });
    expect(await pinned()).toEqual(before); // running missions stay pinned
    expect(await count(`select count(*)::int n from audit_events where action='agent.version.decide' and subject=$1 and result='ok'`, [p.id])).toBe(1);
    const types = (await rows(`select type, subject_kind, audience from events where subject_id=$1 and type in ('agent.versionPromoted','agent.versionCreated','agent.updated') order by id`, [AG]));
    expect(types).toEqual([
      { type: 'agent.versionPromoted', subject_kind: 'agent', audience: 'all' },
      { type: 'agent.versionCreated', subject_kind: 'agent', audience: 'all' },
      { type: 'agent.updated', subject_kind: 'agent', audience: 'all' },
    ]);
  });

  it('deciding it again is 409 PROPOSAL_NOT_PENDING; nothing is promoted twice', async () => {
    const versions = await count(`select count(*)::int n from agent_versions where agent_id=$1`, [AG]);
    const r = await decide(B, p, 'promote');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PROPOSAL_NOT_PENDING');
    expect(await count(`select count(*)::int n from agent_versions where agent_id=$1`, [AG])).toBe(versions);
  });
});

describe('base and payload checks', () => {
  it('stale base: the agent is PATCHed after the proposal; promoting is 409 AGENT_CHANGED; it can still be rejected', async () => {
    const p = (await propose(A, addSkill('Rust'))).body.proposal;
    const a = await agent();
    expect((await A.req('PATCH', `/agents/${AG}`, { skills: [...a.skills, 'Go'] }, { 'if-match': String(a.rowVersion) })).status).toBe(200);
    const listed = (await B.req('GET', `/agents/${AG}/version-proposals`)).body.proposals.find((x: { id: string }) => x.id === p.id);
    expect(listed.stale).toBe(true);
    const r = await decide(B, p, 'promote');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('AGENT_CHANGED');
    expect((await rows('select status from agent_version_proposals where id=$1', [p.id]))[0].status).toBe('pending');
    const rej = await decide(B, p, 'reject', { note: 'Stale.' });
    expect(rej.status).toBe(200);
    expect(rej.body.proposal.status).toBe('rejected');
    expect(await count(`select count(*)::int n from events where type='agent.versionProposalDecided' and payload->>'proposalId'=$1`, [p.id])).toBe(1);
  });

  it('a stored candidate that no longer matches its sha is 409 PROPOSAL_CHANGED', async () => {
    const p = (await propose(A, addSkill('Elm'))).body.proposal;
    await t.pool.query(`update agent_version_proposals set candidate = jsonb_set(candidate, '{model}', '"other-model"') where id=$1`, [p.id]); // behind the API's back
    const r = await decide(B, p, 'promote');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PROPOSAL_CHANGED');
    expect((await A.req('POST', `/version-proposals/${p.id}/withdraw`)).status).toBe(200);
    const q = (await propose(A, addSkill('Dart'))).body.proposal;
    await t.pool.query(`update agent_version_proposals set candidate = '{"model": 1}' where id=$1`, [q.id]); // not even a config any more
    const r2 = await decide(B, q, 'promote');
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('PROPOSAL_CHANGED');
    expect((await A.req('POST', `/version-proposals/${q.id}/withdraw`)).status).toBe(200);
  });
});

describe('lifecycle', () => {
  it('expired: promoting is 409 PROPOSAL_EXPIRED (base still active) and the status shows expired', async () => {
    const p = (await propose(A, addSkill('Haskell'))).body.proposal;
    await t.pool.query(`update agent_version_proposals set expires_at = now() - interval '1 minute' where id=$1`, [p.id]);
    const r = await decide(B, p, 'promote');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PROPOSAL_EXPIRED');
    expect((await rows('select status from agent_version_proposals where id=$1', [p.id]))[0].status).toBe('expired');
    expect(await count(`select count(*)::int n from audit_events where action='agent.version.expire' and subject=$1`, [p.id])).toBe(1);
    expect(await count(`select count(*)::int n from audit_events where action='agent.version.decide' and subject=$1 and result='denied'`, [p.id])).toBe(1);
  });

  it('expiry also happens on read, and frees the candidate for a new proposal', async () => {
    const p = (await propose(A, addSkill('OCaml'))).body.proposal;
    await t.pool.query(`update agent_version_proposals set expires_at = now() - interval '1 minute' where id=$1`, [p.id]);
    const list = (await M.req('GET', '/version-proposals')).body.proposals;
    expect(list.find((x: { id: string }) => x.id === p.id).status).toBe('expired');
    const again = await propose(A, addSkill('OCaml'));
    expect(again.status).toBe(201);
    await A.req('POST', `/version-proposals/${again.body.proposal.id}/withdraw`);
  });

  it('withdraw works only for the author, and only while pending', async () => {
    const p = (await propose(A, addSkill('Zig'))).body.proposal;
    const other = await B.req('POST', `/version-proposals/${p.id}/withdraw`);
    expect(other.status).toBe(403);
    expect((await M.req('POST', `/version-proposals/${p.id}/withdraw`)).status).toBe(403);
    const r = await A.req('POST', `/version-proposals/${p.id}/withdraw`);
    expect(r.status).toBe(200);
    expect(r.body.proposal.status).toBe('withdrawn');
    const again = await A.req('POST', `/version-proposals/${p.id}/withdraw`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PROPOSAL_NOT_PENDING');
    expect(await count(`select count(*)::int n from audit_events where action='agent.version.withdraw' and subject=$1 and result='ok'`, [p.id])).toBe(1);
    expect(await count(`select count(*)::int n from audit_events where action='agent.version.withdraw' and subject=$1 and result='denied'`, [p.id])).toBe(2);
  });
});

describe('rollback privacy and audit (cycle 27, c05 m6 and m7)', () => {
  const AG2 = 'designer-01';
  const rb = (toVersionId: string, why: string, h: Record<string, string> | undefined = key()) => A.req('POST', `/agents/${AG2}/rollback`, { toVersionId, why }, h);
  it('m7: the reason stays in the audit row; the event everyone can read does not carry it', async () => {
    const a = await agent(AG2);
    expect((await A.req('PATCH', `/agents/${AG2}`, { skills: [...a.skills, 'Rollback-privacy'] }, { 'if-match': String(a.rowVersion) })).status).toBe(200);
    const why = 'Priya reviewed badly, undo it.';
    expect((await rb(a.versionId, why)).status).toBe(200);
    const ev = await rows(`select payload from events where type='agent.rolledBack' and subject_id=$1 order by id desc limit 1`, [AG2]);
    expect(ev.length).toBe(1);
    expect(JSON.stringify(ev[0].payload)).not.toContain('Priya');
    expect(ev[0].payload).not.toHaveProperty('why');
    const au = await rows(`select detail from audit_events where action='agent.rollback' and subject=$1 order by id desc limit 1`, [AG2]);
    expect(au[0].detail.why).toBe(why); // the audit row (administrators only) keeps it
  });
  it('m6: a refused rollback is audited as denied, with the code and without the reason', async () => {
    const cur = await agent(AG2);
    const denied = async () => rows(`select detail from audit_events where action='agent.rollback' and result='denied' and subject=$1 order by id`, [AG2]);
    const n0 = (await denied()).length;
    const r = await rb(cur.versionId, 'secret reason');
    expect(r.status).toBe(422);
    const d = await denied();
    expect(d.length).toBe(n0 + 1);
    expect(d[d.length - 1].detail).toEqual({ code: 'ALREADY_ACTIVE' });
    expect((await rb(cur.versionId, 'x', {})).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED'); // not a refusal of the rollback itself
    expect((await denied()).length).toBe(n0 + 1);
  });
});

describe('rollback', () => {
  it('creates a NEW version equal to the target, parent = the active one; old rows unchanged; audited with the reason', async () => {
    const cur = await agent();
    const target = cur.versions[0]; // the seeded first version
    const snapshot = await rows(`select * from agent_versions where agent_id=$1 order by seq`, [AG]);
    const before = await pinned();
    const r = await A.req('POST', `/agents/${AG}/rollback`, { toVersionId: target.id, why: 'The new skills confused reviews.' }, key());
    expect(r.status).toBe(200);
    const after = await agent();
    expect(after.versionId).not.toBe(target.id); // never reuses an old id
    expect(after.versions.length).toBe(cur.versions.length + 1);
    const t0 = snapshot[0];
    expect({ model: after.model, skills: after.skills, tools: after.tools }).toEqual({ model: t0.model, skills: t0.skills, tools: t0.tools });
    const v = (await rows('select * from agent_versions where id=$1', [after.versionId]))[0];
    expect(v.parent_version_id).toBe(cur.versionId);
    expect(v.prompt_hash).toBe(t0.prompt_hash);
    expect(after.rowVersion).toBe(cur.rowVersion + 1);
    expect(await rows(`select * from agent_versions where agent_id=$1 and seq <= $2 order by seq`, [AG, snapshot.length])).toEqual(snapshot); // append-only
    expect(await pinned()).toEqual(before); // running missions stay pinned through a rollback too
    const au = await rows(`select * from audit_events where action='agent.rollback' and subject=$1`, [AG]);
    expect(au.length).toBe(1);
    expect(au[0].detail).toMatchObject({ why: 'The new skills confused reviews.', fromVersionId: cur.versionId, toVersionId: target.id, newVersionId: after.versionId });
    const types = (await rows(`select type, subject_kind, audience from events where subject_id=$1 and type in ('agent.rolledBack','agent.versionCreated','agent.updated') order by id desc limit 3`, [AG])).reverse();
    expect(types).toEqual([
      { type: 'agent.rolledBack', subject_kind: 'agent', audience: 'all' },
      { type: 'agent.versionCreated', subject_kind: 'agent', audience: 'all' },
      { type: 'agent.updated', subject_kind: 'agent', audience: 'all' },
    ]);
    await expect(t.pool.query(`update agent_versions set model='x' where id=$1`, [target.id])).rejects.toThrow(/agent_versions is append-only/);
    await expect(t.pool.query(`delete from agent_versions where id=$1`, [target.id])).rejects.toThrow(/agent_versions is append-only/);
  });

  it('to the active version is 422; to a version with the active configuration is 422; another agent\'s version is 422', async () => {
    const cur = await agent();
    const r = await A.req('POST', `/agents/${AG}/rollback`, { toVersionId: cur.versionId, why: 'x' }, key());
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ALREADY_ACTIVE');
    const same = await A.req('POST', `/agents/${AG}/rollback`, { toVersionId: cur.versions[0].id, why: 'x' }, key()); // v1 = the active config
    expect(same.status).toBe(422);
    expect(same.body.code).toBe('SAME_CONFIG');
    const other = (await agent('designer-01')).versionId;
    const o = await A.req('POST', `/agents/${AG}/rollback`, { toVersionId: other, why: 'x' }, key());
    expect(o.status).toBe(422);
    expect(o.body.code).toBe('VERSION_NOT_OF_AGENT');
    const u = await A.req('POST', `/agents/${AG}/rollback`, { toVersionId: '00000000-0000-4000-8000-000000000000', why: 'x' }, key());
    expect(u.status).toBe(422);
    expect((await agent()).versionId).toBe(cur.versionId);
  });

  it('a member is 403; a reason and an Idempotency-Key are required; a replay creates nothing new', async () => {
    const cur = await agent();
    const target = cur.versions[1].id;
    expect((await M.req('POST', `/agents/${AG}/rollback`, { toVersionId: target, why: 'x' }, key())).status).toBe(403);
    expect((await A.req('POST', `/agents/${AG}/rollback`, { toVersionId: target, why: '' }, key())).status).toBe(400);
    expect((await A.req('POST', `/agents/${AG}/rollback`, { toVersionId: target, why: 'x' })).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const k = key();
    const r1 = await A.req('POST', `/agents/${AG}/rollback`, { toVersionId: target, why: 'Back to the promoted one.' }, k);
    expect(r1.status).toBe(200);
    const r2 = await A.req('POST', `/agents/${AG}/rollback`, { toVersionId: target, why: 'Back to the promoted one.' }, k);
    expect(r2.status).toBe(200);
    expect(r2.body.agent.versionId).toBe(r1.body.agent.versionId);
    expect((await agent()).versions.length).toBe(cur.versions.length + 1);
  });
});

describe('one lock for every writer of the active version', () => {
  it('a PATCH waiting on the agent lock while a promote commits answers 409 (If-Match) and never overwrites it', async () => {
    const p = (await propose(A, addSkill('Kotlin'))).body.proposal;
    const start = await agent();
    const lockKey = `agent-ver:t-1:${AG}`;
    const waiting = async () => (await rows(`select count(*)::int n from pg_locks where locktype='advisory' and not granted and objsubid=1 and (classid, objid) = (select ((k >> 32) & 4294967295)::oid, (k & 4294967295)::oid from (select ${LOCK_KEY_SQL} as k) z)`, [lockKey]))[0].n as number;
    const X = await t.pool.connect();
    await X.query('begin');
    await X.query(`select pg_advisory_xact_lock(${LOCK_KEY_SQL})`, [lockKey]);
    // 1) the promote queues on the lock, 2) the PATCH (made from the same, still current state) queues behind it
    const promoted = decide(B, p, 'promote');
    expect(await until(async () => (await waiting()) === 1)).toBe(true);
    const patched = A.req('PATCH', `/agents/${AG}`, { skills: [...start.skills, 'Scala'] }, { 'if-match': String(start.rowVersion) });
    expect(await until(async () => (await waiting()) === 2)).toBe(true);
    await X.query('commit');
    X.release();
    const pr = await promoted, pa = await patched;
    expect(pr.status).toBe(200);
    expect(pa.status).toBe(409);
    expect(pa.body.code).toBe('CONFLICT');
    const end = await agent();
    expect(end.versionId).toBe(pr.body.proposal.promotedVersionId);
    expect(end.skills).toEqual([...start.skills, 'Kotlin']);
    expect(end.skills).not.toContain('Scala');
    expect(end.versions.length).toBe(start.versions.length + 1);
  });

  it('a rollback waiting on the lock while a PATCH commits builds on the PATCHed version (parent = it)', async () => {
    const start = await agent();
    const lockKey = `agent-ver:t-1:${AG}`;
    const waiting = async () => (await rows(`select count(*)::int n from pg_locks where locktype='advisory' and not granted and objsubid=1 and (classid, objid) = (select ((k >> 32) & 4294967295)::oid, (k & 4294967295)::oid from (select ${LOCK_KEY_SQL} as k) z)`, [lockKey]))[0].n as number;
    const X = await t.pool.connect();
    await X.query('begin');
    await X.query(`select pg_advisory_xact_lock(${LOCK_KEY_SQL})`, [lockKey]);
    const patched = A.req('PATCH', `/agents/${AG}`, { skills: [...start.skills, 'Lua'] }, { 'if-match': String(start.rowVersion) });
    expect(await until(async () => (await waiting()) === 1)).toBe(true);
    const rolled = A.req('POST', `/agents/${AG}/rollback`, { toVersionId: start.versions[0].id, why: 'race' }, key());
    expect(await until(async () => (await waiting()) === 2)).toBe(true);
    await X.query('commit');
    X.release();
    const pa = await patched, ro = await rolled;
    expect(pa.status).toBe(200);
    expect(ro.status).toBe(200);
    const v = (await rows('select * from agent_versions where id=$1', [ro.body.agent.versionId]))[0];
    expect(v.parent_version_id).toBe(pa.body.agent.versionId);
    // the rollback read the agent AFTER the lock: its audit row names the PATCHed version as the one it rolled away from
    const au = (await rows(`select detail from audit_events where action='agent.rollback' and subject=$1 order by id desc limit 1`, [AG]))[0];
    expect(au.detail.fromVersionId).toBe(pa.body.agent.versionId);
  });
});

describe('tenant', () => {
  it('another tenant\'s proposal and agent are 404 and never listed', async () => {
    await t.pool.query(`insert into tenants(id,name) values ('t-2','Other')`);
    await t.pool.query(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
    await t.pool.query(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('other-01','t-2','Other-01','other','Ops','Other duty','u-x')`);
    const v = (await t.pool.query(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('other-01',1,'v1.0.0','m','h','u-x') returning id`)).rows[0].id;
    await t.pool.query(`update agent_definitions set active_version_id=$1 where id='other-01'`, [v]);
    const pid = 'VP-' + 'A'.repeat(32);
    await t.pool.query(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, hypothesis, created_by)
      values ($1,'t-2','other-01',$2,'h','{"model":"m2","skills":[],"tools":[]}','x','T','H','u-x')`, [pid, v]);
    expect((await B.req('GET', '/version-proposals')).body.proposals.some((x: { id: string }) => x.id === pid)).toBe(false);
    expect((await B.req('GET', '/agents/other-01/version-proposals')).status).toBe(404);
    const d = await decide(B, { id: pid, sha: 'x' }, 'promote');
    expect(d.status).toBe(404);
    expect((await A.req('POST', `/version-proposals/${pid}/withdraw`)).status).toBe(404);
    expect((await A.req('POST', '/agents/other-01/rollback', { toVersionId: v, why: 'x' }, key())).status).toBe(404);
    expect((await A.req('POST', '/agents/other-01/version-proposals', { title: 'x', hypothesis: 'y', candidate: { model: 'm3', skills: [], tools: [] }, baseVersionId: v }, key())).status).toBe(404);
    expect((await rows('select status from agent_version_proposals where id=$1', [pid]))[0].status).toBe('pending');
  });
});

describe('migration 0015', () => {
  it('down to the previous migration and up again on a populated schema (agents, versions, instances, proposals)', async () => {
    const all = listMigrations().map((m) => m.version);
    const prev = Math.max(...all.filter((v) => v < 15));
    const latest = Math.max(...all);
    const counts = async () => ({
      agents: await count('select count(*)::int n from agent_definitions'),
      versions: await count('select count(*)::int n from agent_versions'),
      instances: await count('select count(*)::int n from agent_instances'),
      missions: await count('select count(*)::int n from missions'),
    });
    const before = await counts();
    expect(before.instances).toBeGreaterThan(0);
    expect(await count('select count(*)::int n from agent_version_proposals')).toBeGreaterThan(0);
    const has = async () => (await rows(`select 1 from information_schema.tables where table_schema=$1 and table_name='agent_version_proposals'`, [t.schema])).length === 1;
    expect(await migrate(t.pool, 'down', prev)).toBe(prev);
    expect(await has()).toBe(false);
    expect(await counts()).toEqual(before);
    expect(await migrate(t.pool, 'up')).toBe(latest);
    expect(await has()).toBe(true);
    expect(await counts()).toEqual(before);
    expect((await M.req('GET', '/version-proposals')).body.proposals).toEqual([]);
  });
});
