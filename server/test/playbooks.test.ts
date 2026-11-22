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

describe('lists keep the visibility rule in SQL', () => {
  it("a member's own proposal is still listed when more than 200 other people's proposals are newer", async () => {
    const mine = await lessonId(M, 'release-01', 'Mia early idea about releases');
    await q(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,sha256,created_at)
      select 'LC-BULK-' || g, 't-1', 'release-01', 'release', 'Bulk lesson ' || g, $1::jsonb, $2, repeat('c', 64), now() + (g || ' seconds')::interval from generate_series(1, 210) g`, [JSON.stringify(SRC), aId]);
    const own = (await M.req('GET', '/lessons?agentId=release-01')).body.lessons;
    expect(own.map((x: any) => x.id)).toContain(mine);
    expect(own.every((x: any) => x.proposedBy === mId || x.status === 'accepted')).toBe(true);
    expect((await A.req('GET', '/lessons?agentId=release-01')).body.lessons).toHaveLength(200); // an administrator sees all, capped
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

  it('a rolled-back lesson can be proposed and accepted again; the candidate whose item the rollback removed becomes superseded (once), keeping where it was accepted', async () => {
    expect((await q('select status, accepted_in_version, withdrawn_in_version from lesson_candidates where id=$1', [lessons[2]]))[0]).toEqual({ status: 'superseded', accepted_in_version: 3, withdrawn_in_version: 4 });
    expect((await q('select status from lesson_candidates where id=$1', [lessons[0]]))[0].status).toBe('accepted'); // still in the playbook
    const again = await lessonId(M, agent, 'Approve only with the checks green and a note.');
    expect((await accept(B, again, agent)).body.playbook.version).toBe(5);
  });
});

describe('skills', () => {
  const st = (detail: string, kind = 'note', extra: Record<string, unknown> = {}) => ({ kind, detail, ...extra });
  const body = (over: Record<string, unknown> = {}) => ({ name: 'Triage a failing check', description: 'Find the cause of a red check.', steps: [st('Open the report', 'navigate'), st('Name the failing selector', 'observe'), st('Attach the screenshot', 'note')], preconditions: ['A report exists'], sources: SRC, ...over });
  it.each([['function', 'steps', { steps: [st('function run() { return 1 }')] }], ['arrow', 'steps', { steps: [st('x => x + 1')] }], ['eval', 'description', { description: 'then eval(input)' }], ['script', 'name', { name: '<script>x</script>' }], ['precondition', 'preconditions', { preconditions: ['eval("1")'] }]])
  ('code-like %s is 400 and nothing is stored', async (_l, field, over) => {
    const before = await count('select count(*)::int n from skills');
    const r = await A.req('POST', '/skills', body(over), key());
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.fieldErrors).some((k) => k === field || k.startsWith(field + '.'))).toBe(true);
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
    const v2 = (await B.req('POST', '/skills', body({ name: 'triage a FAILING check', steps: [st('Open the report', 'navigate'), st('Compare with the last green run', 'check')] }), key())).body.skill;
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

describe('skills: a closed structure, quoted data that is never executed', () => {
  const st = (detail: string, kind = 'note', extra: Record<string, unknown> = {}) => ({ kind, detail, ...extra });
  const body = (steps: unknown[], over: Record<string, unknown> = {}) => ({ name: 'Closed ' + n++, description: 'A skill.', steps, preconditions: [], sources: SRC, ...over });
  const post = (b: unknown) => A.req('POST', '/skills', b, key());
  it('a name that differs only by whitespace, case or Unicode form is the next VERSION of the same skill, never a 500', async () => {
    const a = await post(body([st('Open it')], { name: 'Foo Bar' }));
    expect(a.status).toBe(201);
    const b = await post(body([st('Open it again')], { name: 'Foo   Bar ' }));
    expect(b.status).toBe(201);
    expect(b.body.skill).toMatchObject({ name: 'Foo Bar', version: 2 });
    const c = await post(body([st('Once more')], { name: 'foo bar' }));
    expect(c.body.skill.version).toBe(3);
    const nfd = await post(body([st('Accents')], { name: 'Caf\u00e9 check' })), nfd2 = await post(body([st('Accents')], { name: 'Cafe\u0301 check' }));
    expect([nfd.status, nfd2.status, nfd2.body.skill.version]).toEqual([201, 201, 2]);
  });
  it('steps are a closed schema: enumerated kinds, bounded text, no extra keys', async () => {
    expect((await post(body([st('x', 'run_shell')]))).status).toBe(400);
    expect((await post(body([{ kind: 'note', detail: 'x', command: 'ls' }]))).status).toBe(400);
    expect((await post(body(['plain string step']))).status).toBe(400);
    expect((await post(body([st('x'.repeat(301))]))).status).toBe(400);
    expect((await post(body([st('', 'note')]))).status).toBe(400);
    for (const kind of ['navigate', 'observe', 'fill', 'click', 'check', 'ask_human', 'note']) expect((await post(body([st('Do the thing', kind, { target: 'The login button' })]))).status, kind).toBe(201);
  });
  it.each([['backtick', 'use `ls`'], ['less-than', 'a < b'], ['greater-than', 'a > b'], ['open brace', 'a { b'], ['close brace', 'a } b'], ['dollar', 'costs $5'], ['backslash', 'a \\ b'], ['zero-width', 'func\u200Btion'], ['control', 'a\u0007b'], ['bidi', 'a\u202Eb'], ['pipe-less url', 'see https://evil.example/x'], ['javascript scheme', 'javascript://x'], ['data url', 'data://text/html']])
  ('%s in step text is 400 and nothing is stored', async (_l, text) => {
    const before = await count('select count(*)::int n from skills');
    for (const f of [{ detail: text }, { detail: 'ok', target: text }]) {
      const r = await post(body([{ kind: 'note', ...f }]));
      expect(r.status, JSON.stringify(f)).toBe(400);
    }
    expect((await post(body([st('ok')], { description: text }))).status).toBe(400);
    expect((await post(body([st('ok')], { preconditions: [text] }))).status).toBe(400);
    expect((await post(body([st('ok')], { name: text }))).status).toBe(400);
    expect(await count('select count(*)::int n from skills')).toBe(before);
  });
  it('plain punctuation and non-English letters are fine', async () => {
    expect((await post(body([st("Check the \"Save\" button (top-right): it's 50% done, e-mail a/b & c; #1?", 'check', { target: 'Zahlungsübersicht 日本語' })]))).status).toBe(201);
  });
  it('a URL only through the origin field of a navigate step: plain https, ASCII host, no path, no IDN', async () => {
    const nav = (origin: unknown) => post(body([st('Open the dashboard', 'navigate', { origin })]));
    for (const ok of ['https://example.com', 'https://app.example.co.uk', 'https://example.com:8443']) expect((await nav(ok)).status, ok).toBe(201);
    for (const bad of ['http://example.com', 'https://example.com/path', 'https://user@example.com', 'https://b\u00fccher.de', 'https://xn--bcher-kva.de', 'https://EXAMPLE.com', 'https://localhost', 'https://example.com?x=1', 'javascript:alert(1)', 'https://', 'https://exa mple.com', 'https://example..com', 'https://-a.example.com', 'https://127.0.0.1', 5]) expect((await nav(bad)).status, String(bad)).toBe(400);
    expect((await post(body([st('x', 'click', { origin: 'https://example.com' })]))).status).toBe(400); // only navigate takes an origin
    const got = (await nav('https://example.com')).body.skill;
    expect(got.steps[0]).toMatchObject({ kind: 'navigate', origin: 'https://example.com' });
  });
  it('lesson text uses the same charset rule', async () => {
    for (const text of ['Use `rm` carefully', 'a <b> tag', 'costs $5', 'curly {x}', 'back\\slash', 'zero\u200Bwidth', 'see https://evil.example']) expect((await propose(A, 'coder-01', text)).status, text).toBe(400);
    expect((await propose(A, 'coder-01', "Don't skip the review (it's quick): ask early, ask often!")).status).toBe(201);
  });
});

describe('sources: checked where the tree can check them, otherwise shown as unverified', () => {
  it('mission and task sources are verified against what the proposer can see; the other kinds are flagged unverified', async () => {
    await q(`insert into missions(id,tenant_id,owner_id,shared,status) values ('M-9200','t-1',$1,false,'running'), ('M-9201','t-1',$1,true,'running')`, [aId]);
    await q(`insert into mission_revisions(mission_id,revision,title,kind,priority,text,created_by) values ('M-9200',1,'P','general','normal','x',$1), ('M-9201',1,'S','general','normal','x',$1)`, [aId]);
    await q(`insert into tasks(id,tenant_id,mission_id,title) values ('T-9200','t-1','M-9200','private task'), ('T-9201','t-1','M-9201','shared task')`);
    const p = (by: Browser, sources: unknown[]) => by.req('POST', '/agents/coder-01/lessons', { text: 'Source check ' + n++, sources }, key());
    expect((await p(M, [{ kind: 'task', id: 'T-9200' }])).status).toBe(404); // a task of a mission she cannot see
    expect((await p(M, [{ kind: 'task', id: 'T-nope' }])).status).toBe(404);
    const ok = await p(M, [{ kind: 'task', id: 'T-9201' }, { kind: 'mission', id: 'M-9201' }, { kind: 'review', id: 'R-1' }, { kind: 'failure_tag', id: 'flaky' }, { kind: 'note', id: 'n' }]);
    expect(ok.status).toBe(201);
    expect(ok.body.lesson.sources.map((s: any) => [s.kind, s.verified])).toEqual([['task', true], ['mission', true], ['review', false], ['failure_tag', false], ['note', false]]);
  });
});

describe('what members may read: admin-only notes and hidden private sources', () => {
  const agent = 'integrator-01';
  it('rollback notes, override notes and accepted items\' mission/task source ids are admin-only; members get the text and a hidden chip', async () => {
    await q(`insert into missions(id,tenant_id,owner_id,shared,status) values ('M-9300','t-1',$1,true,'running')`, [aId]);
    await q(`insert into mission_revisions(mission_id,revision,title,kind,priority,text,created_by) values ('M-9300',1,'S','general','normal','x',$1)`, [aId]);
    const l1 = await lessonId(A, agent, 'Always pin the dependency versions.', { sources: [{ kind: 'mission', id: 'M-9300', note: 'customer Acme complained' }, { kind: 'review', id: 'REV-9' }] });
    expect((await accept(B, l1, agent)).status).toBe(200);
    const l2 = await lessonId(A, agent, 'Never pin the dependency versions.');
    expect((await accept(B, l2, agent, { overrideNote: 'Customer Acme needs floating versions.' })).status).toBe(200);
    const l3 = await lessonId(A, agent, 'Review the changelog of each upgrade.');
    expect((await accept(B, l3, agent)).status).toBe(200);
    expect((await B.req('POST', `/agents/${agent}/playbook/rollback`, { toVersion: 2, baseVersion: 3, why: 'Acme asked us to undo it' })).status).toBe(200);
    for (const [who, admin] of [[A, true], [B, true], [M, false], [K, false]] as const) {
      const r = (await who.req('GET', `/agents/${agent}/playbook`)).body;
      const first = r.playbook.items[0], second = r.playbook.items[1];
      expect(first.text).toBe('Always pin the dependency versions.');
      expect(second.overrideNote).toBe(admin ? 'Customer Acme needs floating versions.' : null);
      expect(second.contradiction).toBe(true); // the flag itself is not secret
      expect(r.versions[0].note).toBe(admin ? 'Acme asked us to undo it' : null);
      expect(r.playbook.note).toBe(admin ? 'Acme asked us to undo it' : null);
      const mission = first.sources[0];
      if (admin) expect(mission).toMatchObject({ kind: 'mission', id: 'M-9300', note: 'customer Acme complained' });
      else { expect(mission).toMatchObject({ kind: 'mission', hidden: true, id: '' }); expect(mission.note).toBeUndefined(); }
      if (admin) expect(first.sources[1]).toMatchObject({ kind: 'review', id: 'REV-9', verified: false });
      else expect(first.sources[1]).toMatchObject({ kind: 'review', hidden: true, id: '' });
      const d = (await who.req('GET', `/agents/${agent}/playbook/diff?from=0&to=1`)).body.diff;
      expect(JSON.stringify(d).includes('M-9300')).toBe(admin);
      const v = (await who.req('GET', `/agents/${agent}/playbook/versions/1`)).body.playbook;
      expect(JSON.stringify(v).includes('M-9300')).toBe(admin);
      const ls = (await who.req('GET', `/lessons/${l2}`)).body.lesson;
      expect(ls.overrideNote).toBe(admin ? 'Customer Acme needs floating versions.' : null);
      expect(ls.decisionNote).toBeNull();
    }
    // a member's own proposal still shows her own sources
    const mine = await lessonId(M, agent, 'Tag releases with the date.', { sources: [{ kind: 'mission', id: 'M-9300' }] });
    expect((await M.req('GET', `/lessons/${mine}`)).body.lesson.sources[0].id).toBe('M-9300');
    expect((await B.req('GET', `/lessons/${mine}`)).body.lesson.sources[0].id).toBe('M-9300');
  });
});

describe('rollback and the decider rule', () => {
  const agent = 'optimizer-01';
  it('an admin who proposed a lesson cannot re-activate it by rolling back; the other admin can; removed lessons become superseded', async () => {
    const l1 = await lessonId(A, agent, 'Measure before optimising.');
    expect((await accept(B, l1, agent)).status).toBe(200); // v1: proposer A
    const l2 = await lessonId(B, agent, 'Cache only what is read often.');
    expect((await accept(A, l2, agent)).status).toBe(200); // v2: proposer B
    expect((await B.req('POST', `/agents/${agent}/playbook/rollback`, { toVersion: 1, baseVersion: 2, why: 'too early' })).status).toBe(200); // v3 = v1: removes l2 (nothing re-activated)
    expect((await q('select status, withdrawn_in_version from lesson_candidates where id=$1', [l2]))[0]).toEqual({ status: 'superseded', withdrawn_in_version: 3 });
    const own = await B.req('POST', `/agents/${agent}/playbook/rollback`, { toVersion: 2, baseVersion: 3, why: 'bring it back' }); // would re-activate l2, proposed by B
    expect(own.status).toBe(403);
    expect(own.body.code).toBe('SELF_APPROVAL');
    expect(await count(`select count(*)::int n from audit_events where action='playbook.rollback' and subject=$1 and result='denied'`, [agent])).toBe(1);
    expect((await book(agent)).playbook.version).toBe(3);
    const ok = await A.req('POST', `/agents/${agent}/playbook/rollback`, { toVersion: 2, baseVersion: 3, why: 'bring it back' });
    expect(ok.status).toBe(200);
    expect(ok.body.playbook.items.map((i: any) => i.lessonId)).toEqual([l1, l2]);
  });
});

describe('fix round 2: invisible characters, member source view, direct proposals, events', () => {
  const PROBES: [string, string][] = [['U+034F', '͏'], ['U+115F', 'ᅟ'], ['U+1160', 'ᅠ'], ['U+3164', 'ㅤ'], ['U+FFA0', 'ﾠ'], ['U+17B4', '឴'], ['U+17B5', '឵'],
    ['U+180B', '᠋'], ['U+180C', '᠌'], ['U+180D', '᠍'], ['U+180E', '᠎'], ['U+180F', '᠏'], ['U+FE00', '︀'], ['U+FE0F', '️'], ['U+E0100', '\u{E0100}'], ['U+E01EF', '\u{E01EF}'], ['U+2060', '⁠'], ['U+00AD', '­']];
  it.each(PROBES)('%s (default-ignorable) is refused in lesson text, skill name, step text and source note', async (_n, ch) => {
    const text = 'Dep' + ch + 'loy carefully';
    expect((await propose(A, 'coder-01', text)).status).toBe(400);
    const sk = (over: Record<string, unknown>) => A.req('POST', '/skills', { name: 'Hidden ' + n++, description: 'd', steps: [{ kind: 'note', detail: 'x' }], preconditions: [], sources: SRC, ...over }, key());
    expect((await sk({ name: text })).status).toBe(400);
    expect((await sk({ steps: [{ kind: 'note', detail: text }] })).status).toBe(400);
    expect((await A.req('POST', '/agents/coder-01/lessons', { text: 'Fine text', sources: [{ kind: 'review', id: 'R-1', note: text }] }, key())).status).toBe(400);
  });
  it('an ordinary accented letter, a combining accent after a base letter and CJK are still fine', async () => {
    expect((await propose(A, 'coder-01', 'Zahlungsübersicht, café and 日本語 are fine ' + n++)).status).toBe(201);
  });

  it('members see only kind + "hidden" for every source kind and never a note; administrators and the proposer see their data', async () => {
    const agent = 'knowledge-01';
    const kinds = ['mission', 'task', 'review', 'failure_tag', 'note'] as const;
    await q(`insert into missions(id,tenant_id,owner_id,shared,status) values ('M-9400','t-1',$1,true,'running')`, [aId]);
    await q(`insert into mission_revisions(mission_id,revision,title,kind,priority,text,created_by) values ('M-9400',1,'S','general','normal','x',$1)`, [aId]);
    await q(`insert into tasks(id,tenant_id,mission_id,title) values ('T-9400','t-1','M-9400','t')`);
    const ids: Record<string, string> = { mission: 'M-9400', task: 'T-9400', review: 'REV-77', failure_tag: 'flaky-77', note: 'note-77' };
    const sources = kinds.map((k) => ({ kind: k, id: ids[k], note: `secret note about ${k}` }));
    const lid = await lessonId(A, agent, 'Keep a changelog for every release.', { sources });
    expect((await accept(B, lid, agent)).status).toBe(200);
    const sk = await A.req('POST', '/skills', { name: 'Release notes', description: 'd', steps: [{ kind: 'note', detail: 'Write them' }], preconditions: [], sources }, key());
    expect(sk.status).toBe(201);
    expect((await B.req('POST', `/skills/${sk.body.skill.id}/approve`, {})).status).toBe(200);
    const views = async (who: Browser) => {
      const r = (await who.req('GET', `/agents/${agent}/playbook`)).body.playbook.items[0].sources;
      const d = (await who.req('GET', `/agents/${agent}/playbook/diff?from=0&to=1`)).body.diff.added[0].sources;
      const v = (await who.req('GET', `/agents/${agent}/playbook/versions/1`)).body.playbook.items[0].sources;
      const c = (await who.req('GET', `/lessons/${lid}`)).body.lesson.sources;
      const k = (await who.req('GET', `/skills/${sk.body.skill.id}`)).body.skill.sources;
      const l = (await who.req('GET', '/skills')).body.skills.find((x: any) => x.id === sk.body.skill.id).sources;
      return { r, d, v, c, k, l };
    };
    for (const who of [M, K]) {
      const all = await views(who);
      for (const [name, srcs] of Object.entries(all)) {
        expect(srcs.map((x: any) => x.kind), name).toEqual(kinds);
        for (const x of srcs) { expect(x.hidden, name + x.kind).toBe(true); expect(x.id, name + x.kind).toBe(''); expect(x.note, name + x.kind).toBeUndefined(); }
        expect(JSON.stringify(srcs)).not.toMatch(/secret note|REV-77|flaky-77|note-77|M-9400|T-9400/);
      }
    }
    for (const who of [A, B]) {
      const all = await views(who);
      for (const [name, srcs] of Object.entries(all)) for (const x of srcs) { expect(x.hidden, name).toBeUndefined(); expect(x.id).toBe(ids[x.kind]); expect(x.note).toBe(`secret note about ${x.kind}`); expect(x.verified).toBe(x.kind === 'mission' || x.kind === 'task'); }
    }
    // the proposer keeps seeing the row she wrote (candidate and her own skill draft), and only that
    const mine = await lessonId(M, agent, 'Tag the release commit.', { sources: [{ kind: 'review', id: 'REV-M', note: 'my own note' }] });
    expect((await M.req('GET', `/lessons/${mine}`)).body.lesson.sources[0]).toMatchObject({ id: 'REV-M', note: 'my own note' });
    expect((await B.req('GET', `/lessons/${mine}`)).body.lesson.sources[0]).toMatchObject({ id: 'REV-M', note: 'my own note' });
  });

  it('an unknown task and a task of a mission the person cannot see give the identical 404 (same message)', async () => {
    await q(`insert into missions(id,tenant_id,owner_id,shared,status) values ('M-9500','t-1',$1,false,'running')`, [aId]);
    await q(`insert into mission_revisions(mission_id,revision,title,kind,priority,text,created_by) values ('M-9500',1,'P','general','normal','x',$1)`, [aId]);
    await q(`insert into tasks(id,tenant_id,mission_id,title) values ('T-9500','t-1','M-9500','t')`);
    const a = await M.req('POST', '/agents/coder-01/lessons', { text: 'Unknown task ' + n++, sources: [{ kind: 'task', id: 'T-none' }] }, key());
    const b = await M.req('POST', '/agents/coder-01/lessons', { text: 'Hidden task ' + n++, sources: [{ kind: 'task', id: 'T-9500' }] }, key());
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(b.body.message).toBe(a.body.message);
  });

  it('proposeLesson validates NFC and the charset itself (a direct caller cannot bypass the route schema)', async () => {
    const call = (text: string, sources: SourceRef[] = SRC) => tx(t.app.db, (c) => proposeLesson(c, { tenantId: 't-1', agentId: 'coder-01', proposedBy: 'tester-01', kind: 'agent', submittedBy: aId, text, sources, correlationId: 'c41-direct' }));
    for (const bad of ['use `ls`', 'a < b', 'zero​width', 'hiddenㅤfiller', 'link https://evil.example', '']) await expect(call(bad), JSON.stringify(bad)).rejects.toMatchObject({ status: 400 });
    await expect(call('fine', [{ kind: 'note', id: 'n', note: 'bad `note`' }])).rejects.toMatchObject({ status: 400 });
    await expect(call('fine', [{ kind: 'note', id: 'bad id!' }])).rejects.toMatchObject({ status: 400 });
    const id = await call('  Café   direct   proposal ' + n++);
    expect((await q('select text from lesson_candidates where id=$1', [id]))[0].text.startsWith('Café direct proposal')).toBe(true); // squashed and NFC
  });

  it('a lesson restored by a later rollback says so: status stays superseded (once-only trigger), the list reports inPlaybook', async () => {
    const agent = 'designer-01';
    const l1 = await lessonId(A, agent, 'Use the design tokens for colours.');
    expect((await accept(B, l1, agent)).status).toBe(200);
    const l2 = await lessonId(A, agent, 'Name every layer in the file.');
    expect((await accept(B, l2, agent)).status).toBe(200); // v2
    expect((await A.req('POST', `/agents/${agent}/playbook/rollback`, { toVersion: 1, baseVersion: 2, why: 'x' })).status).toBe(200); // v3 removes l2
    const gone = (await A.req('GET', `/lessons/${l2}`)).body.lesson;
    expect([gone.status, gone.withdrawnInVersion, gone.inPlaybook]).toEqual(['superseded', 3, false]);
    expect((await B.req('POST', `/agents/${agent}/playbook/rollback`, { toVersion: 2, baseVersion: 3, why: 'back' })).status).toBe(200); // v4 restores l2 (B did not propose it)
    const back = (await A.req('GET', `/lessons/${l2}`)).body.lesson;
    expect([back.status, back.inPlaybook]).toEqual(['superseded', true]);
    expect((await A.req('GET', `/lessons/${l1}`)).body.lesson.inPlaybook).toBe(true);
  });

  it('lesson and skill proposal events go to administrators and the proposer only (audience user), never to everyone', async () => {
    const l = await lessonId(M, 'writer-01', 'Mia event audience check ' + n++);
    const ev = (await q(`select audience, audience_user from events where type='playbook.lessonProposed' and payload->>'lessonId'=$1`, [l]))[0];
    expect(ev).toEqual({ audience: 'user', audience_user: mId });
    const sk = await M.req('POST', '/skills', { name: 'Event audience ' + n++, description: 'd', steps: [{ kind: 'note', detail: 'x' }], preconditions: [], sources: SRC }, key());
    const e2 = (await q(`select audience, audience_user from events where type='skill.proposed' and payload->>'skillId'=$1`, [sk.body.skill.id]))[0];
    expect(e2).toEqual({ audience: 'user', audience_user: mId });
    const agentL = await tx(t.app.db, (c) => proposeLesson(c, { tenantId: 't-1', agentId: 'writer-01', proposedBy: 'tester-01', kind: 'agent', submittedBy: aId, text: 'Agent event check ' + n++, sources: SRC, correlationId: 'c41-ev' }));
    expect((await q(`select audience, audience_user from events where type='playbook.lessonProposed' and payload->>'lessonId'=$1`, [agentL]))[0]).toEqual({ audience: 'user', audience_user: aId });
  });
});

describe('append-only', () => {
  it('playbooks, lesson candidates and skills refuse update, delete and truncate; the demo purge flag allows only the delete', async () => {
    await expect(t.pool.query(`update playbooks set note='x'`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from playbooks`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`truncate playbooks cascade`)).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`update lesson_candidates set text='rewritten' where status='proposed'`)).rejects.toThrow(/can only be decided/);
    // "never active without a human decision" holds in the database: the system may only close a duplicate, never accept
    await expect(t.pool.query(`update lesson_candidates set status='accepted', decided_by='system', decided_at=now(), accepted_in_version=1 where status='proposed'`)).rejects.toThrow();
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
