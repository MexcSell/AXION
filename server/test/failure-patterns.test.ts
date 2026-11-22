import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { clearDemo } from '../src/seed/demo.ts';
import { FAILURE_PATTERN_MIN_FAILURES, FAILURE_PATTERN_MIN_DEPARTMENTS, FAILURE_TAXONOMY } from '../../shared/contracts/src/failures.ts';

// Improvement cycle 63 (Phase 2, R3-8), item 2: the recurrence rule. When the same failure mode recurs in at least 3 failures across at least
// 2 departments inside the window, a row opens in c41's lesson_candidates (sources = the failures). It is only ever a candidate: a person
// activates it through c41's review. One open candidate per pattern per window. System-derived from tool records, never a person's or an agent's own entry.
let t: TestApp;
let A: Browser, M: Browser;
let adminId = '';
let n = 0, seq = 0;
const key = () => ({ 'idempotency-key': 'fp' + n++ });
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
const rows = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows;
const candidates = (mode: string) => rows(`select c.* from failure_pattern_candidates p join lesson_candidates c on c.id=p.candidate_id where p.mode_id=$1 order by c.created_at`, [mode]);
const allCandidates = (mode: string) => rows(`select * from failure_pattern_candidates where mode_id=$1 order by created_at`, [mode]);

async function agent(id: string, dept: string) {
  await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ($1,'t-1',$1,'worker',$2,$1,'u-x') on conflict do nothing`, [id, dept]);
}
async function mission(id: string, demo = false) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,'t-1',$2,true,'running',$3)`, [id, adminId, demo]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, adminId]);
}
/** A failed task owned by `owner` (an agent id, or null for none) */
async function failed(mid: string, owner: string | null) {
  const id = 'T-P' + seq++;
  await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ($1,'t-1',$2,'x','failed',$3)`, [id, mid, owner]);
  return id;
}
const propose = async (taskId: string, mode: string) => (await M.req('POST', '/failure-tags', { subjectKind: 'task', subjectId: taskId, modeId: mode }, key())).body.tag.id as string;
const confirm = async (id: string) => (await A.req('POST', `/failure-tags/${id}/decision`, { decision: 'confirm' }));
/** tag + confirm on a failed task of the given owner */
const fail = async (mid: string, owner: string | null, mode: string) => { const task = await failed(mid, owner); const tag = await propose(task, mode); const r = await confirm(tag); expect(r.status).toBe(200); return { task, tag }; };

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  M = (await w.member('Mina')).b;
  for (const [id, d] of [['ag-eng1', 'Engineering'], ['ag-eng2', 'Engineering'], ['ag-ops1', 'Operations'], ['ag-ops2', 'Operations'], ['ag-fin1', 'Finance']]) await agent(id, d);
  await mission('M-P1'); await mission('M-P2'); await mission('M-DEMO', true);
});
afterAll(async () => { await t?.close(); });

describe('the rule fires at exactly 3 failures in 2 departments', () => {
  it('constants: at least 3 failures and at least 2 departments', () => { expect(FAILURE_PATTERN_MIN_FAILURES).toBe(3); expect(FAILURE_PATTERN_MIN_DEPARTMENTS).toBe(2); });

  it('2 failures in 2 departments: nothing opens', async () => {
    await fail('M-P1', 'ag-eng1', 'FM-1.1'); await fail('M-P1', 'ag-ops1', 'FM-1.1');
    expect(await allCandidates('FM-1.1')).toHaveLength(0);
  });
  it('3 failures in 1 department: nothing opens', async () => {
    await fail('M-P1', 'ag-eng1', 'FM-1.2'); await fail('M-P1', 'ag-eng2', 'FM-1.2'); await fail('M-P1', 'ag-eng1', 'FM-1.2');
    expect(await allCandidates('FM-1.2')).toHaveLength(0);
  });
  it('3 failures in 2 departments: exactly one candidate opens, on the third confirmation and not before', async () => {
    await fail('M-P1', 'ag-eng1', 'FM-1.3'); await fail('M-P1', 'ag-eng1', 'FM-1.3');
    expect(await allCandidates('FM-1.3')).toHaveLength(0);       // 2 failures, 1 department
    await fail('M-P2', 'ag-ops1', 'FM-1.3');
    const open = await candidates('FM-1.3');
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe('proposed');
    const link = (await allCandidates('FM-1.3'))[0];
    expect(link).toMatchObject({ window_days: 30, failure_count: 3, department_count: 2, origin: 'system_failure_pattern' });
    expect(link.departments).toEqual(['Engineering', 'Operations']);
    expect(link.tag_ids).toHaveLength(3);
  });
  it('only confirmed tags count: a proposed tag is not a failure of the pattern', async () => {
    await fail('M-P1', 'ag-eng1', 'FM-1.4'); await fail('M-P1', 'ag-ops1', 'FM-1.4');
    await propose(await failed('M-P1', 'ag-fin1'), 'FM-1.4'); // third, still proposed
    expect(await allCandidates('FM-1.4')).toHaveLength(0);
    const rej = await propose(await failed('M-P1', 'ag-fin1'), 'FM-1.4');
    expect((await A.req('POST', `/failure-tags/${rej}/decision`, { decision: 'reject' })).status).toBe(200);
    expect(await allCandidates('FM-1.4')).toHaveLength(0);
  });
  it('a failure counts once: a task and its attempt tagged with the same mode are one failure', async () => {
    await fail('M-P1', 'ag-eng1', 'FM-1.5');
    const t2 = await failed('M-P1', 'ag-ops1'); await q(`insert into task_attempts(task_id, attempt_no, result) values ($1,1,'failed')`, [t2]);
    const attId = String((await rows(`select id from task_attempts where task_id=$1`, [t2]))[0].id);
    await confirm(await propose(t2, 'FM-1.5'));
    expect((await M.req('POST', '/failure-tags', { subjectKind: 'task_attempt', subjectId: attId, modeId: 'FM-1.5' }, key())).status).toBe(201);
    const aTag = (await rows(`select id from failure_tags where subject_kind='task_attempt' and subject_id=$1`, [attId]))[0].id;
    await confirm(aTag);
    expect(await allCandidates('FM-1.5')).toHaveLength(0);       // 3 confirmed tags, but 2 failures
    await fail('M-P1', 'ag-fin1', 'FM-1.5');
    expect(await allCandidates('FM-1.5')).toHaveLength(1);
  });
  it('a failure with no known department (no owner agent) is not a department: 3 failures where one has none do not fire', async () => {
    await fail('M-P1', 'ag-eng1', 'FM-2.1'); await fail('M-P1', 'ag-ops1', 'FM-2.1'); await fail('M-P1', null, 'FM-2.1');
    expect(await allCandidates('FM-2.1')).toHaveLength(0);
    await fail('M-P1', 'ag-fin1', 'FM-2.1');
    expect(await allCandidates('FM-2.1')).toHaveLength(1);       // now 3 failures with a department, in 3 departments
    expect((await allCandidates('FM-2.1'))[0].failure_count).toBe(3); // the one without a department is not in it
  });
  it('DEMO missions never count, and a failure older than the window does not count', async () => {
    await fail('M-P1', 'ag-eng1', 'FM-2.2'); await fail('M-P1', 'ag-ops1', 'FM-2.2');
    await fail('M-DEMO', 'ag-fin1', 'FM-2.2');
    expect(await allCandidates('FM-2.2')).toHaveLength(0);
    // a confirmed tag from 40 days ago (raw insert: tags are append-only, so the age is set at insert)
    const old = await failed('M-P1', 'ag-fin1');
    await q(`insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, created_at, decided_by, decided_at)
      values ('FT-OLD1','t-1','M-P1','task',$1,'mast-arxiv-2503.13657v3','FM-2.2','u','user','confirmed', now() - interval '40 days', $2, now() - interval '39 days')`, [old, adminId]);
    await fail('M-P1', 'ag-eng2', 'FM-2.2');                    // confirms a 3rd in-window failure, but both departments are Engineering/Operations... 3 in window across 2 depts
    expect((await allCandidates('FM-2.2')).length).toBe(1);
    expect((await allCandidates('FM-2.2'))[0].failure_count).toBe(3); // the 40-day-old tag and the DEMO one are not in it
    expect((await allCandidates('FM-2.2'))[0].departments).toEqual(['Engineering', 'Operations']);
  });
});

describe('one open candidate per pattern per window', () => {
  it('more failures of the same mode do not open a second one while the first is open, even two confirmations at once', async () => {
    await fail('M-P1', 'ag-eng1', 'FM-3.1'); await fail('M-P1', 'ag-eng1', 'FM-3.1');
    const a = await propose(await failed('M-P1', 'ag-ops1'), 'FM-3.1');
    const b = await propose(await failed('M-P1', 'ag-ops2'), 'FM-3.1');
    const c = await propose(await failed('M-P1', 'ag-fin1'), 'FM-3.1');
    await Promise.all([confirm(a), confirm(b), confirm(c)]);
    expect(await allCandidates('FM-3.1')).toHaveLength(1);
    await fail('M-P1', 'ag-fin1', 'FM-3.1'); await fail('M-P1', 'ag-ops1', 'FM-3.1');
    expect(await allCandidates('FM-3.1')).toHaveLength(1);
  });
  it('after a person rejects the candidate, the same evidence does not reopen it; a new confirmed failure does', async () => {
    const first = (await candidates('FM-3.1'))[0];
    await A.req('POST', `/lessons/${first.id}/decision`, { decision: 'reject' });
    expect((await rows(`select status from lesson_candidates where id=$1`, [first.id]))[0].status).toBe('rejected');
    await confirm(await propose(await failed('M-P1', 'ag-eng2'), 'FM-3.1'));  // new evidence
    const all = await allCandidates('FM-3.1');
    expect(all).toHaveLength(2);
    expect((await candidates('FM-3.1')).map((c: any) => c.status)).toEqual(['rejected', 'proposed']);
    await confirm(await propose(await failed('M-P1', 'ag-eng2'), 'FM-3.1'));  // the second is open again: no third
    expect(await allCandidates('FM-3.1')).toHaveLength(2);
  });
  it('a different mode is a different pattern', async () => {
    await fail('M-P2', 'ag-eng1', 'FM-3.2'); await fail('M-P2', 'ag-ops1', 'FM-3.2'); await fail('M-P2', 'ag-fin1', 'FM-3.2');
    await fail('M-P2', 'ag-eng1', 'FM-3.3'); await fail('M-P2', 'ag-ops1', 'FM-3.3');
    expect(await allCandidates('FM-3.2')).toHaveLength(1);
    expect(await allCandidates('FM-3.3')).toHaveLength(0);
  });
});

describe('the candidate is a record for a person to review, never an active playbook', () => {
  it('is a c41 lesson candidate marked as derived by the system from records, with the failures as sources, for the agent that owned most of them', async () => {
    const c = (await candidates('FM-3.2'))[0];
    expect(c).toMatchObject({ status: 'proposed', proposed_by: 'failure-pattern-review', proposed_by_kind: 'agent', submitted_by: null, decided_by: null });
    expect(c.text).toMatch(/^System-derived from tool records, not written by a person\./);
    expect(c.text).toContain('FM-3.2');
    expect(c.sources.length).toBe(3);
    for (const s of c.sources) { expect(s.kind).toBe('failure_tag'); expect(s.id).toMatch(/^FT-[0-9A-F]{32}$/); }
    expect(['ag-eng1', 'ag-ops1', 'ag-fin1']).toContain(c.agent_id);
    const link = (await allCandidates('FM-3.2'))[0];
    expect(link.tag_ids.slice().sort()).toEqual(c.sources.map((s: any) => s.id).sort());
    expect((await rows(`select actor, result, detail from audit_events where action='failure.pattern_candidate' and subject=$1`, [c.id]))[0]).toMatchObject({ actor: 'failure-pattern-review', result: 'ok' });
  });
  it('the dominant agent is the one that owned the most failures (lowest id on a tie)', async () => {
    for (const o of ['ag-ops2', 'ag-ops2', 'ag-eng1']) await fail('M-P2', o, 'FM-2.3');
    expect((await candidates('FM-2.3'))[0].agent_id).toBe('ag-ops2');
  });
  it('the text passes c41\'s plain-text rule for a mode name with a curly apostrophe (FM-2.5) and for the others', async () => {
    for (const m of FAILURE_TAXONOMY.flatMap((c) => c.modes).filter((x) => ['FM-2.5', 'FM-2.6', 'FM-1.4'].includes(x.id))) {
      for (const o of ['ag-eng1', 'ag-ops1', 'ag-fin1']) await fail('M-P2', o, m.id);
      expect((await candidates(m.id)).length, m.id).toBe(1);
    }
  });
  it('no path creates an active playbook: none exists for any agent after all of the above, and accepting stays a person\'s decision through c41', async () => {
    expect((await rows(`select count(*)::int n from playbooks`))[0].n).toBe(0);
    const src = readFileSync(new URL('../src/failures/patterns.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/insert\s+into\s+playbooks|update\s+lesson_candidates|playbooks\s*\(/i);
    // the system cannot decide: the table refuses a system decider, and the c41 route needs an administrator who is not the proposer
    const c = (await candidates('FM-2.3'))[0];
    await expect(q(`update lesson_candidates set status='accepted', decided_by='system', decided_at=now(), accepted_in_version=1 where id=$1`, [c.id])).rejects.toThrow();
    expect((await M.req('POST', `/lessons/${c.id}/decision`, { decision: 'accept', baseVersion: 0 })).status).toBe(403);
    expect((await rows(`select count(*)::int n from playbooks`))[0].n).toBe(0);
    const ok = await A.req('POST', `/lessons/${c.id}/decision`, { decision: 'accept', baseVersion: 0 });
    expect(ok.status).toBe(200);                                        // a person accepted it
    expect((await rows(`select count(*)::int n from playbooks where lesson_id=$1`, [c.id]))[0].n).toBe(1);
  });
});

describe('the link table and the admin list', () => {
  it('is append-only (update, delete, truncate refused) and a demo purge still works with rows in it', async () => {
    const id = (await rows(`select id from failure_pattern_candidates limit 1`))[0].id as string;
    await expect(q(`update failure_pattern_candidates set failure_count=9 where id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(q(`delete from failure_pattern_candidates where id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(q(`truncate failure_pattern_candidates`)).rejects.toThrow(/append-only/);
    await expect(q(`insert into failure_pattern_candidates(id, tenant_id, mode_id, window_days, candidate_id, failure_count, department_count, departments, task_ids, tag_ids) values ('FP-X','t-1','FM-1.1',30,'LC-X',2,2,'[]','[]','[]')`)).rejects.toThrow();
    await expect(q(`insert into failure_pattern_candidates(id, tenant_id, mode_id, window_days, candidate_id, failure_count, department_count, departments, task_ids, tag_ids) values ('FP-Y','t-1','FM-1.1',30,'LC-Y',3,1,'[]','[]','[]')`)).rejects.toThrow();
    await clearDemo(t.app.db, 't-1');
    expect((await rows(`select count(*)::int n from failure_pattern_candidates`))[0].n).toBeGreaterThan(0);
  });
  it('GET /company/failure-patterns lists them for an administrator only, newest first, with the candidate status', async () => {
    expect((await M.req('GET', '/company/failure-patterns')).status).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/company/failure-patterns' })).statusCode).toBe(401);
    const r = await A.req('GET', '/company/failure-patterns');
    expect(r.status).toBe(200);
    const p = r.body.patterns.find((x: any) => x.modeId === 'FM-3.1' && x.candidateStatus === 'proposed');
    expect(p).toMatchObject({ modeId: 'FM-3.1', windowDays: 30, derivedBy: 'system_failure_pattern', departments: expect.any(Array) });
    expect(p.candidateId).toMatch(/^LC-/);
    expect(r.body.minFailures).toBe(3); expect(r.body.minDepartments).toBe(2);
    expect(r.body.patterns.length).toBeGreaterThanOrEqual(6);
  });
});
