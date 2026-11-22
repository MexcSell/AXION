import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { tx } from '../src/db.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import type { SourceRef } from '../../shared/contracts/src/index.ts';
import { findConflicts, conflicts, looksLikeCode, proposeLesson } from '../src/agents/playbooks.ts';

// Improvement cycle 41: reviewed playbooks and a skill library (brief web/docs/improve/cycles/c41-brief.md, "Pass threshold").
let t: TestApp;
let A: Browser; // administrator
let B: Browser; // second administrator
let M: Browser; // member
let K: Browser; // another member
let aId = '', bId = '', mId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'pb' + n++ });
const q = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0].n as number;
const SRC: SourceRef[] = [{ kind: 'review', id: 'REV-1', note: 'Reviewer asked for it twice' }];
const propose = (by: Browser, agent: string, text: string, extra: Record<string, unknown> = {}) => by.req('POST', `/agents/${agent}/lessons`, { text, sources: SRC, ...extra }, key());
const book = async (agent: string, by: Browser = A) => (await by.req('GET', `/agents/${agent}/playbook`)).body as { playbook: { version: number; items: any[] }; versions: any[] };
const accept = async (by: Browser, lid: string, agent: string, extra: Record<string, unknown> = {}) =>
  by.req('POST', `/lessons/${lid}/decision`, { decision: 'accept', baseVersion: (await book(agent, by)).playbook.version, ...extra });
const lessonId = async (by: Browser, agent: string, text: string, extra: Record<string, unknown> = {}) => {
  const r = await propose(by, agent, text, extra);
  expect(r.status).toBe(201);
  return r.body.lesson.id as string;
};

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea');
  B = b.b; bId = b.id;
  expect((await A.req('PATCH', `/users/${bId}`, { role: 'admin' })).status).toBe(200);
  const m = await w.member('Mia'); M = m.b; mId = m.id;
  K = (await w.member('Kai')).b;
});
afterAll(async () => { await t.close(); });

describe('pure helpers', () => {
  it('conflicts: same subject with exactly one negation; fixtures both ways', () => {
    const yes: [string, string][] = [
      ['Always run the linter before committing', 'Never run the linter before committing'],
      ['Ask for approval before deploying', "Don't ask for approval before deploying"],
      ['Retry failed uploads automatically', 'Do not retry failed uploads automatically'],
      ['Never guess', 'Guess'],
    ];
    for (const [a, b] of yes) { expect(conflicts(a, b), `${a} / ${b}`).toBe(true); expect(conflicts(b, a)).toBe(true); }
    const no: [string, string][] = [
      ['Never share credentials in chat', 'Always verify the sender'],
      ['Do not deploy on Fridays', 'Deploy on Mondays'],
      ['Prefer short replies', 'Prefer short replies in chat'],
      ['Never run the linter after committing tests', 'Never run the linter before committing'],
    ];
    for (const [a, b] of no) expect(conflicts(a, b), `${a} / ${b}`).toBe(false);
    expect(findConflicts('Never run the linter before committing', [{ lessonId: 'x', text: 'Always run the linter before committing' }, { lessonId: 'y', text: 'Keep replies short' }])).toEqual([{ lessonId: 'x', text: 'Always run the linter before committing' }]);
  });
  it('looksLikeCode catches function, =>, eval and <script', () => {
    for (const s of ['function f() {}', 'x => x', 'eval(x)', '<script>alert(1)</script>', '<  SCRIPT src=x>']) expect(looksLikeCode(s), s).toBe(true);
    expect(looksLikeCode('Open the settings page and check the toggle')).toBe(false);
  });
});

describe('propose', () => {
  it('a candidate without sources is 400 (missing, empty list, or an unknown kind); nothing is stored', async () => {
    const before = await count('select count(*)::int n from lesson_candidates');
    for (const body of [{ text: 'No evidence' }, { text: 'No evidence', sources: [] }, { text: 'x', sources: [{ kind: 'gossip', id: '1' }] }, { text: '   ', sources: SRC }, { text: 'x'.repeat(601), sources: SRC }]) {
      const r = await A.req('POST', '/agents/coder-01/lessons', body, key());
      expect(r.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(r.body.code).toBe('VALIDATION');
    }
    expect((await A.req('POST', '/agents/coder-01/lessons', { text: 'x', sources: SRC })).status).toBe(400); // Idempotency-Key required
    expect(await count('select count(*)::int n from lesson_candidates')).toBe(before);
  });

  it('any signed-in user proposes (stored, hashed, audited, announced with ids only); anonymous is 401; unknown agent is 404', async () => {
    const r = await propose(M, 'coder-01', 'Keep pull requests under 300 lines.', { reviewBy: '2999-01-01' });
    expect(r.status).toBe(201);
    const l = r.body.lesson;
    expect(l).toMatchObject({ status: 'proposed', agentId: 'coder-01', proposedBy: mId, proposedByKind: 'human', reviewBy: '2999-01-01', canDecide: false });
    expect(l.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await count(`select count(*)::int n from audit_events where action='playbook.propose' and subject=$1 and result='ok'`, [l.id])).toBe(1);
    const ev = (await q(`select payload from events where type='playbook.lessonProposed' and subject_id='coder-01'`))[0].payload;
    expect(JSON.stringify(ev)).not.toContain('pull requests'); // ids only: the text stays in the audit row
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/lessons' })).statusCode).toBe(401);
    expect((await propose(A, 'nobody-99', 'x')).status).toBe(404);
  });

  it('a review date in the past is 422 (database clock)', async () => {
    const r = await propose(A, 'coder-01', 'Old news', { reviewBy: '2020-01-01' });
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors.reviewBy).toBeTruthy();
  });

  it('a mission source the proposer cannot see is 404; a shared one is fine (reused mission visibility)', async () => {
    await q(`insert into missions(id,tenant_id,owner_id,shared,status) values ('M-9100','t-1',$1,false,'running'), ('M-9101','t-1',$1,true,'running')`, [aId]);
    await q(`insert into mission_revisions(mission_id,revision,title,kind,priority,text,created_by) values ('M-9100',1,'Private','general','normal','x',$1), ('M-9101',1,'Shared','general','normal','x',$1)`, [aId]);
    const src = (id: string) => [{ kind: 'mission', id }];
    expect((await M.req('POST', '/agents/coder-01/lessons', { text: 'From a private mission', sources: src('M-9100') }, key())).status).toBe(404);
    expect((await M.req('POST', '/agents/coder-01/lessons', { text: 'From a shared mission', sources: src('M-9101') }, key())).status).toBe(201);
    expect((await A.req('POST', '/agents/coder-01/lessons', { text: 'From a private mission, as the owner', sources: src('M-9100') }, key())).status).toBe(201);
    expect((await A.req('POST', '/agents/coder-01/lessons', { text: 'From nowhere', sources: src('M-9999') }, key())).status).toBe(404);
  });
});

describe('who sees which candidate', () => {
  it('members see their own proposals and accepted lessons; another member gets 404 on a proposed one; administrators see all', async () => {
    const id = await lessonId(M, 'tester-01', 'Mia private idea about tests');
    expect((await M.req('GET', `/lessons/${id}`)).status).toBe(200);
    expect((await K.req('GET', `/lessons/${id}`)).status).toBe(404);
    expect((await A.req('GET', `/lessons/${id}`)).status).toBe(200);
    expect((await K.req('GET', '/lessons?agentId=tester-01')).body.lessons.map((x: any) => x.id)).not.toContain(id);
    expect((await M.req('GET', '/lessons?agentId=tester-01')).body.lessons.map((x: any) => x.id)).toContain(id);
    expect((await accept(B, id, 'tester-01')).status).toBe(200);
    expect((await K.req('GET', `/lessons/${id}`)).status).toBe(200); // accepted: reviewed organisational knowledge
  });
});

describe('decide: the human rule', () => {
  it('the proposer deciding is 403 (and audited); a member deciding is 403; the other administrator accepts', async () => {
    const id = await lessonId(A, 'coder-01', 'Write the failing test first.');
    const own = await A.req('POST', `/lessons/${id}/decision`, { decision: 'accept', baseVersion: 0 });
    expect(own.status).toBe(403);
    expect(own.body.code).toBe('SELF_APPROVAL');
    expect((await A.req('POST', `/lessons/${id}/decision`, { decision: 'reject' })).status).toBe(403);
    expect((await M.req('POST', `/lessons/${id}/decision`, { decision: 'accept', baseVersion: 0 })).status).toBe(403);
    expect(await count(`select count(*)::int n from audit_events where action='playbook.decide' and subject=$1 and result='denied'`, [id])).toBe(2); // the accept and the reject of the proposer
    expect((await q('select status from lesson_candidates where id=$1', [id]))[0].status).toBe('proposed');
    const cand = (await A.req('GET', `/lessons/${id}`)).body.lesson;
    expect(cand).toMatchObject({ canDecide: false });
    expect(cand.cannotDecideWhy).toMatch(/Another administrator/);
    expect((await B.req('GET', `/lessons/${id}`)).body.lesson.canDecide).toBe(true);
  });

  it('an agent can propose (service function) but never decide: neither the agent nor the person who filed it can; a third administrator can', async () => {
    const id = await tx(t.app.db, (c) => proposeLesson(c, { tenantId: 't-1', agentId: 'coder-01', proposedBy: 'tester-01', kind: 'agent', submittedBy: aId, text: 'Tester-01 saw flaky selectors; prefer role locators.', sources: SRC, correlationId: 'c41-agent' }));
    const cand = (await A.req('GET', `/lessons/${id}`)).body.lesson;
    expect(cand).toMatchObject({ proposedByKind: 'agent', proposedBy: 'tester-01', proposedByName: expect.any(String), submittedBy: aId });
    expect((await A.req('POST', `/lessons/${id}/decision`, { decision: 'accept', baseVersion: 0 })).status).toBe(403); // the person who filed it
    // the database refuses it too, whatever the route does
    await expect(t.pool.query(`update lesson_candidates set status='accepted', decided_by='tester-01', decided_at=now(), accepted_in_version=9 where id=$1`, [id])).rejects.toThrow();
    await expect(t.pool.query(`update lesson_candidates set status='accepted', decided_by=$2, decided_at=now(), accepted_in_version=9 where id=$1`, [id, aId])).rejects.toThrow();
    const r = await accept(B, id, 'coder-01');
    expect(r.status).toBe(200);
  });

  it('reject records the decider and a note; a decided candidate cannot be decided again (409)', async () => {
    const id = await lessonId(A, 'coder-01', 'Rewrite everything in Rust.');
    const r = await B.req('POST', `/lessons/${id}/decision`, { decision: 'reject', note: 'No evidence of benefit.' });
    expect(r.status).toBe(200);
    expect(r.body.lesson).toMatchObject({ status: 'rejected', decidedBy: bId, decisionNote: 'No evidence of benefit.' });
    expect((await B.req('POST', `/lessons/${id}/decision`, { decision: 'accept', baseVersion: 0 })).status).toBe(409);
  });
});

describe('accept creates a playbook version', () => {
  it('accept appends version N+1 with the lesson as a reviewed item with its sources and hash; the stale base is 409; baseVersion is required', async () => {
    const agent = 'security-01';
    const id = await lessonId(A, agent, 'Attach a screenshot to every failed check.', { reviewBy: '2999-06-30' });
    expect((await B.req('POST', `/lessons/${id}/decision`, { decision: 'accept' })).status).toBe(400);
    const stale = await B.req('POST', `/lessons/${id}/decision`, { decision: 'accept', baseVersion: 5 });
    expect(stale.status).toBe(409);
    expect((await book(agent)).playbook.version).toBe(0);
    const r = await B.req('POST', `/lessons/${id}/decision`, { decision: 'accept', baseVersion: 0 });
    expect(r.status).toBe(200);
    expect(r.body.playbook.version).toBe(1);
    expect(r.body.lesson).toMatchObject({ status: 'accepted', acceptedInVersion: 1, decidedBy: bId });
    const pb = (await book(agent)).playbook;
    expect(pb.items).toHaveLength(1);
    expect(pb.items[0]).toMatchObject({ lessonId: id, trust: 'reviewed', addedInVersion: 1, text: 'Attach a screenshot to every failed check.', sources: SRC, reviewBy: '2999-06-30', contradiction: false, needsReReview: false });
    expect(pb.items[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await count(`select count(*)::int n from audit_events where action='playbook.decide' and subject=$1 and result='ok'`, [id])).toBe(1);
    expect(await count(`select count(*)::int n from events where type='playbook.versionCreated' and subject_id=$1`, [agent])).toBe(1);
  });

  it('an identical proposal is closed by the system as superseded when its twin is accepted; a duplicate of a playbook item is 409', async () => {
    const agent = 'security-01';
    const a = await lessonId(A, agent, 'Name the failing selector in the report.');
    const b = await lessonId(M, agent, '  Name the failing   selector in the report. ');
    expect((await accept(B, a, agent)).status).toBe(200);
    expect((await q('select status, decided_by from lesson_candidates where id=$1', [b]))[0]).toEqual({ status: 'superseded', decided_by: 'system' });
    const c = await lessonId(A, agent, 'Name the failing selector in the report.');
    const r = await accept(B, c, agent);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DUPLICATE_PROPOSAL');
  });

  it('10 concurrent accepts: exactly one wins per base (CAS), the others get 409 and stay proposed; versions stay gap-free', async () => {
    const agent = 'gm';
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await lessonId(A, agent, `Concurrent lesson number ${i} about topic${i}.`));
    const rs = await Promise.all(ids.map((id) => B.req('POST', `/lessons/${id}/decision`, { decision: 'accept', baseVersion: 0 })));
    const won = rs.filter((r) => r.status === 200), lost = rs.filter((r) => r.status === 409);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(9);
    expect((await q(`select version from playbooks where agent_id=$1 order by version`, [agent])).map((r) => r.version)).toEqual([1]);
    expect(await count(`select count(*)::int n from lesson_candidates where agent_id=$1 and status='proposed'`, [agent])).toBe(9);
  });

  it('10 concurrent accepts that retry on 409: versions 1..10 with no gap, every lesson in the tip once', async () => {
    const agent = 'mentor-01';
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await lessonId(A, agent, `Retrying lesson ${i} concerning subject${i}.`));
    const rs = await Promise.all(ids.map(async (id) => {
      for (let tries = 0; tries < 40; tries++) {
        const r = await accept(B, id, agent);
        if (r.status !== 409) return r;
      }
      return { status: 0 } as any;
    }));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect((await q(`select version, base_version from playbooks where agent_id=$1 order by version`, [agent])).map((r) => [r.version, r.base_version]))
      .toEqual(Array.from({ length: 10 }, (_, i) => [i + 1, i]));
    const tip = (await book(agent)).playbook;
    expect(tip.version).toBe(10);
    expect(tip.items.map((i: any) => i.lessonId).sort()).toEqual([...ids].sort());
    expect(new Set(tip.items.map((i: any) => i.addedInVersion)).size).toBe(10);
  });
});

describe('contradictions', () => {
  it('a conflicting lesson is flagged, accepting needs an override note, and the item keeps the flag and the note', async () => {
    const agent = 'planner-01';
    const first = await lessonId(A, agent, 'Always run the linter before committing.');
    expect((await accept(B, first, agent)).status).toBe(200);
    const bad = await lessonId(A, agent, 'Never run the linter before committing.');
    const flagged = (await B.req('GET', `/lessons/${bad}`)).body.lesson;
    expect(flagged.conflicts).toEqual([{ lessonId: first, text: 'Always run the linter before committing.' }]);
    const r = await accept(B, bad, agent);
    expect(r.status).toBe(409);
    expect(r.body.fieldErrors.overrideNote).toBeTruthy();
    expect((await q('select status from lesson_candidates where id=$1', [bad]))[0].status).toBe('proposed');
    expect((await book(agent)).playbook.version).toBe(1);
    const ok = await accept(B, bad, agent, { overrideNote: 'Lint is slow on the monorepo; CI lints instead.' });
    expect(ok.status).toBe(200);
    const item = ok.body.playbook.items.find((i: any) => i.lessonId === bad);
    expect(item).toMatchObject({ contradiction: true, contradicts: [first], overrideNote: 'Lint is slow on the monorepo; CI lints instead.' });
    expect(ok.body.playbook.items.find((i: any) => i.lessonId === first).contradiction).toBe(false);
    expect((await q('select override_note from lesson_candidates where id=$1', [bad]))[0].override_note).toMatch(/Lint is slow/);
    // an unrelated lesson needs no override
    const fine = await lessonId(A, agent, 'Keep the plan under ten steps.');
    expect((await accept(B, fine, agent)).status).toBe(200);
  });
});

describe('expiry', () => {
  it('past review_by an item says needsReReview (database clock); a future date does not', async () => {
    const agent = 'ops-01';
    const mk = (lid: string, reviewBy: string | null) => ({ lessonId: lid, text: 'Item ' + lid, trust: 'reviewed', addedInVersion: 1, sources: SRC, sha256: 'a'.repeat(64), reviewBy, contradiction: false, contradicts: [], overrideNote: null });
    await q(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,sha256,status,decided_by,decided_at,accepted_in_version) values ('LC-OLD','t-1',$1,'x','Item LC-OLD','[]'::jsonb,$2,$3,'accepted',$4,now(),1)`.replace("'[]'::jsonb", `'${JSON.stringify(SRC)}'::jsonb`), [agent, mId, 'a'.repeat(64), bId]);
    await q(`insert into playbooks(id,tenant_id,agent_id,role,version,base_version,items,kind,lesson_id,created_by) values ('PB-OLD','t-1',$1,'x',1,0,$2,'accept','LC-OLD',$3)`, [agent, JSON.stringify([mk('LC-OLD', '2020-01-01'), mk('LC-NEW', '2999-01-01'), mk('LC-NONE', null)]), bId]);
    const items = (await book(agent)).playbook.items;
    expect(items.map((i: any) => [i.lessonId, i.needsReReview])).toEqual([['LC-OLD', true], ['LC-NEW', false], ['LC-NONE', false]]);
  });
});

describe('versions, diff and rollback', () => {
  const agent = 'writer-01';
  const lessons: string[] = [];
  it('three accepts give versions 1..3; the diff shows what was added; history lists them newest first', async () => {
    for (const text of ['Review the tests before the code.', 'Leave one actionable comment per concern.', 'Approve only with the checks green.']) {
      const id = await lessonId(A, agent, text);
      lessons.push(id);
      expect((await accept(B, id, agent)).status).toBe(200);
    }
    const h = await book(agent);
    expect(h.playbook.version).toBe(3);
    expect(h.versions.map((v) => [v.version, v.kind, v.items])).toEqual([[3, 'accept', 3], [2, 'accept', 2], [1, 'accept', 1]]);
    const d = (await M.req('GET', `/agents/${agent}/playbook/diff?from=1&to=3`)).body.diff;
    expect(d.added.map((i: any) => i.lessonId)).toEqual(lessons.slice(1));
    expect(d.removed).toEqual([]);
    expect(d.kept).toBe(1);
    expect((await M.req('GET', `/agents/${agent}/playbook/diff?from=1&to=9`)).status).toBe(404);
    expect((await M.req('GET', `/agents/${agent}/playbook/versions/2`)).body.playbook.items).toHaveLength(2);
    expect((await M.req('GET', `/agents/${agent}/playbook/versions/7`)).status).toBe(404);
  });

  it('rollback creates a NEW version equal to the target items; nothing is deleted; the diff shows the removals', async () => {
    const before = await q(`select version, items from playbooks where agent_id=$1 order by version`, [agent]);
    const r = await B.req('POST', `/agents/${agent}/playbook/rollback`, { toVersion: 1, baseVersion: 3, why: 'Too strict for now.' });
    expect(r.status).toBe(200);
    expect(r.body.playbook).toMatchObject({ version: 4, kind: 'rollback', rollbackTo: 1, note: 'Too strict for now.' });
    const rows = await q(`select version, items, kind, rollback_to from playbooks where agent_id=$1 order by version`, [agent]);
    expect(rows).toHaveLength(4);
    expect(rows[3].items).toEqual(rows[0].items); // equal to version 1, stored items verbatim
    expect(rows.slice(0, 3)).toEqual(before.map((b) => ({ ...b, kind: 'accept', rollback_to: null })));
    const d = (await A.req('GET', `/agents/${agent}/playbook/diff?from=3&to=4`)).body.diff;
    expect(d.removed.map((i: any) => i.lessonId)).toEqual(lessons.slice(1));
    expect(await count(`select count(*)::int n from audit_events where action='playbook.rollback' and subject=$1 and result='ok'`, [agent])).toBe(1);
    expect((await book(agent)).playbook.items.map((i: any) => i.lessonId)).toEqual([lessons[0]]);
  });

  it('rollback refusals: stale base 409, current version 422, unknown version 404, same items 422, no playbook 422, member 403', async () => {
    const post = (b: Record<string, unknown>, by = B, a = agent) => by.req('POST', `/agents/${a}/playbook/rollback`, { why: 'x', ...b });
    expect((await post({ toVersion: 1, baseVersion: 3 })).status).toBe(409);
    expect((await post({ toVersion: 4, baseVersion: 4 })).body.code).toBe('ALREADY_ACTIVE');
    expect((await post({ toVersion: 9, baseVersion: 4 })).status).toBe(404);
    expect((await post({ toVersion: 1, baseVersion: 4 })).body.code).toBe('SAME_CONFIG'); // v4 already equals v1
    expect((await post({ toVersion: 1, baseVersion: 0 }, B, 'nobody-77')).status).toBe(404);
    expect((await post({ toVersion: 1, baseVersion: 0 }, B, 'comms-01')).body.code).toBe('NOTHING_TO_ROLL_BACK');
    expect((await post({ toVersion: 1, baseVersion: 4 }, M)).status).toBe(403);
    expect((await post({ toVersion: 1, baseVersion: 4, why: '' })).status).toBe(400);
  });

  it('a rolled-back lesson can be proposed and accepted again; the candidate that created it stays accepted in history', async () => {
    expect((await q('select status, accepted_in_version from lesson_candidates where id=$1', [lessons[2]]))[0]).toEqual({ status: 'accepted', accepted_in_version: 3 });
    const again = await lessonId(M, agent, 'Approve only with the checks green and a note.');
    expect((await accept(B, again, agent)).body.playbook.version).toBe(5);
  });
});

describe('skills', () => {
  const body = (over: Record<string, unknown> = {}) => ({ name: 'Triage a failing check', description: 'Find the cause of a red check.', steps: ['Open the report', 'Name the failing selector', 'Attach the screenshot'], preconditions: ['A report exists'], sources: SRC, ...over });
  it.each([['function', 'steps', { steps: ['function run() { return 1 }'] }], ['arrow', 'steps', { steps: ['x => x + 1'] }], ['eval', 'description', { description: 'then eval(input)' }], ['script', 'name', { name: '<script>x</script>' }], ['precondition', 'preconditions', { preconditions: ['eval("1")'] }]])
  ('code-like %s is 400 and nothing is stored', async (_l, field, over) => {
    const before = await count('select count(*)::int n from skills');
    const r = await A.req('POST', '/skills', body(over), key());
    expect(r.status).toBe(400);
    expect(r.body.fieldErrors[field as string]).toBeTruthy();
    expect(await count('select count(*)::int n from skills')).toBe(before);
  });
  it('a skill without sources or steps is 400', async () => {
    expect((await A.req('POST', '/skills', body({ sources: [] }), key())).status).toBe(400);
    expect((await A.req('POST', '/skills', body({ steps: [] }), key())).status).toBe(400);
  });
  it('propose, self-approval 403, other administrator approves; a new version of the same name replaces the approved one', async () => {
    const r = await M.req('POST', '/skills', body(), key());
    expect(r.status).toBe(201);
    const v1 = r.body.skill;
    expect(v1).toMatchObject({ version: 1, status: 'draft', proposedBy: mId });
    expect((await K.req('GET', `/skills/${v1.id}`)).status).toBe(404); // another member: a draft is invisible
    expect((await M.req('GET', `/skills/${v1.id}`)).status).toBe(200);
    expect((await M.req('POST', `/skills/${v1.id}/approve`, {})).status).toBe(403);
    const own = await A.req('POST', '/skills', body({ name: 'Own skill' }), key());
    expect((await A.req('POST', `/skills/${own.body.skill.id}/approve`, {})).body.code).toBe('SELF_APPROVAL');
    const ok = await A.req('POST', `/skills/${v1.id}/approve`, {});
    expect(ok.status).toBe(200);
    expect(ok.body.skill).toMatchObject({ status: 'approved', approvedBy: aId });
    expect((await K.req('GET', `/skills/${v1.id}`)).status).toBe(200); // approved: visible to all
    expect((await A.req('POST', `/skills/${v1.id}/approve`, {})).status).toBe(409);
    const v2 = (await B.req('POST', '/skills', body({ name: 'triage a FAILING check', steps: ['Open the report', 'Compare with the last green run'] }), key())).body.skill;
    expect(v2.version).toBe(2);
    expect((await A.req('POST', `/skills/${v2.id}/approve`, {})).status).toBe(200);
    expect((await q(`select version, status from skills where lower(name)='triage a failing check' order by version`)).map((r) => [r.version, r.status])).toEqual([[1, 'retired'], [2, 'approved']]);
    expect((await A.req('POST', `/skills/${v2.id}/retire`, { note: 'Superseded by the new runbook' })).body.skill).toMatchObject({ status: 'retired', retireNote: 'Superseded by the new runbook' });
    expect((await A.req('POST', `/skills/${v2.id}/retire`, {})).status).toBe(409);
    expect((await M.req('POST', `/skills/${v2.id}/retire`, {})).status).toBe(403);
    const list = (await K.req('GET', '/skills')).body.skills as any[];
    expect(list.every((s) => s.status !== 'draft' || s.proposedBy === 'k')).toBe(true);
    expect(list.map((s) => s.id)).toContain(v1.id);
    expect(await count(`select count(*)::int n from audit_events where action like 'skill.%'`)).toBeGreaterThanOrEqual(6);
  });
});

describe('append-only', () => {
  it('playbooks, lesson candidates and skills refuse update, delete and truncate; the demo purge flag allows only the delete', async () => {
    await expect(t.pool.query(`update playbooks set note='x'`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from playbooks`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate playbooks cascade`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`update lesson_candidates set text='rewritten' where status='proposed'`)).rejects.toThrow(/can only be decided/);
    await expect(t.pool.query(`update lesson_candidates set status='rejected', decided_by='nobody', decided_at=now() where status='accepted'`)).rejects.toThrow(/never changes/);
    await expect(t.pool.query(`delete from lesson_candidates`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate lesson_candidates cascade`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`update skills set steps='["x"]'::jsonb where status='approved' or status='draft'`)).rejects.toThrow();
    await expect(t.pool.query(`update skills set status='approved', approved_by=proposed_by, approved_at=now() where status='draft'`)).rejects.toThrow();
    await expect(t.pool.query(`update skills set approved_by='someone' where status='retired'`)).rejects.toThrow(/never changes/);
    await expect(t.pool.query(`delete from skills`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate skills cascade`)).rejects.toThrow(/append-only/);
    // a version must follow its base, so a gap cannot be inserted by hand either
    await expect(t.pool.query(`insert into playbooks(id,tenant_id,agent_id,role,version,base_version,items,kind,rollback_to,created_by) values ('PB-GAP','t-1','coder-01','x',99,3,'[]','rollback',1,'u')`)).rejects.toThrow();
    // the purge flag lets a demo purge delete (rolled back here so the rest stays), and nothing else
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query(`set local axion.purge_demo = 'on'`);
      expect((await c.query('delete from playbooks')).rowCount).toBeGreaterThan(0);
      expect((await c.query('delete from skills')).rowCount).toBeGreaterThan(0);
      expect((await c.query('delete from lesson_candidates')).rowCount).toBeGreaterThan(0);
      await expect(c.query('truncate playbooks')).rejects.toThrow(/append-only/);
      await c.query('rollback');
    } finally { c.release(); }
  });

  it('clearDemo still works with playbooks, candidates and skills present, and leaves them alone', async () => {
    await seedDemo(t.app.db, 't-1', aId);
    const before = [await count('select count(*)::int n from playbooks'), await count('select count(*)::int n from lesson_candidates'), await count('select count(*)::int n from skills')];
    await expect(clearDemo(t.app.db, 't-1')).resolves.toBeTruthy();
    expect([await count('select count(*)::int n from playbooks'), await count('select count(*)::int n from lesson_candidates'), await count('select count(*)::int n from skills')]).toEqual(before);
  });
});

describe('tenant isolation', () => {
  it("another tenant's lesson, playbook and skill are 404 for administrators and members; its agent has no playbook here", async () => {
    await q(`insert into tenants(id,name) values ('t-2','Other')`);
    await q(`insert into agent_definitions(id,tenant_id,name,role,dept,duty,created_by) values ('x-agent','t-2','X','xrole','d','xduty','u-x')`);
    await q(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,sha256) values ('LC-T2','t-2','x-agent','xrole','Secret lesson',$1,'u-x',$2)`, [JSON.stringify(SRC), 'b'.repeat(64)]);
    await q(`insert into skills(id,tenant_id,name,version,description,steps,sources,proposed_by,status,approved_by,approved_at) values ('SK-T2','t-2','Secret',1,'d','["s"]'::jsonb,$1,'u-x','approved','u-y',now())`, [JSON.stringify(SRC)]);
    for (const who of [A, B, M]) {
      expect((await who.req('GET', '/lessons/LC-T2')).status).toBe(404);
      expect((await who.req('GET', '/skills/SK-T2')).status).toBe(404);
      expect((await who.req('GET', '/agents/x-agent/playbook')).status).toBe(404);
      expect((await who.req('GET', '/agents/x-agent/playbook/diff?from=0&to=1')).status).toBe(404);
      expect((await propose(who, 'x-agent', 'Cross-tenant')).status).toBe(404);
    }
    for (const who of [A, B]) {
      expect((await who.req('POST', '/lessons/LC-T2/decision', { decision: 'reject' })).status).toBe(404);
      expect((await who.req('POST', '/skills/SK-T2/approve', {})).status).toBe(404);
      expect((await who.req('POST', '/skills/SK-T2/retire', {})).status).toBe(404);
      expect((await who.req('POST', '/agents/x-agent/playbook/rollback', { toVersion: 1, baseVersion: 1, why: 'x' })).status).toBe(404);
    }
    expect((await A.req('GET', '/lessons')).body.lessons.map((l: any) => l.id)).not.toContain('LC-T2');
    expect((await A.req('GET', '/skills')).body.skills.map((l: any) => l.id)).not.toContain('SK-T2');
    expect((await q(`select status from lesson_candidates where id='LC-T2'`))[0].status).toBe('proposed');
  });
});
