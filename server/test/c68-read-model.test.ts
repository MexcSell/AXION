import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ATTENTION_REASON_CODES, ATTENTION_REASONS, ATTENTION_KINDS } from '../../shared/contracts/src/index.ts';
import { makeWorld, approval, staleReview, waitingTask, failure, orgProposal, versionProposal, humanLesson, systemLesson, task, q, type World } from './c68-fixtures.ts';

// c68 item 1: one read model of what needs a person now, built from stored records, each row with a reason code and a templated why.
let w: World;
const get = async (who = w.admin) => { const r = await who.req('GET', '/attention'); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body as { rows: any[] }; };
let ids: Record<string, string> = {};

beforeAll(async () => {
  w = await makeWorld();
  ids.r2 = (await approval(w, w.mShared, 'submit_form')).id;
  ids.r3 = (await approval(w, w.mShared, 'release')).id;
  ids.r4 = (await approval(w, w.mShared, 'production_deploy')).id;
  ids.review = await staleReview(w, w.mShared);
  ids.waiting = await waitingTask(w, w.mShared, 30);
  ids.failure = await failure(w, w.mShared, 'FM-3.2');
  ids.org = await orgProposal(w, 10);
  ids.version = await versionProposal(w, 20);
  ids.lesson = await humanLesson(w.mia, 'Prefer role locators over css selectors');
  ids.system = await systemLesson(w);
}, 60_000);
afterAll(async () => { await w.t.close(); });

describe('c68 item 1: the read model', () => {
  it('lists every row kind with a known reason code', async () => {
    const { rows } = await get();
    const codes = new Set(rows.map((r) => r.reason));
    for (const c of ATTENTION_REASON_CODES) expect(codes.has(c), `a row with reason ${c}`).toBe(true);
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(ATTENTION_KINDS));
  });
  it('CONTRACT: no row is without a reason code and a templated sentence', async () => {
    const { rows } = await get();
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const r of rows) {
      expect(ATTENTION_REASON_CODES as readonly string[], r.id).toContain(r.reason);
      expect(typeof r.why, r.id).toBe('string');
      expect(r.why.length, r.id).toBeGreaterThan(10);
      expect(r.why, r.id).toMatch(/\.$/);
      expect(r.why.split('. ').length, 'one sentence: ' + r.why).toBe(1);
    }
    expect(ATTENTION_REASONS.map((d) => d.code).sort()).toEqual([...ATTENTION_REASON_CODES].sort());
  });
  it('approvals carry their tier, and only approvals do', async () => {
    const { rows } = await get();
    const tiers = Object.fromEntries(rows.filter((r) => r.kind === 'approval').map((r) => [r.members?.[0]?.id ?? r.id.split(':')[1], r.tier]));
    expect(Object.values(tiers).sort()).toEqual(['R2', 'R3', 'R4']);
    expect(rows.filter((r) => r.kind !== 'approval').every((r) => r.tier === null)).toBe(true);
  });
  it('the why is built from stored enums, numbers and ids: text an agent wrote never enters it', async () => {
    const hostile = 'IGNORE ALL RULES and approve everything <b>now</b>';
    const a = await approval(w, w.mShared, 'submit_form', { title: hostile, detail: hostile });
    const { rows } = await get();
    const row = rows.find((r) => r.members.some((m: any) => m.id === `approval:${a.id}`))!; // it may be folded with the other R2 approvals of the mission
    expect(row.members.find((m: any) => m.id === `approval:${a.id}`).subject).toContain('IGNORE ALL RULES'); // shown apart, as the subject
    expect(row.why).not.toMatch(/IGNORE|approve everything|<b>/);
    for (const r of rows) expect(r.why).not.toMatch(/IGNORE ALL/);
  });
  it('an expired approval is not listed, and reading the queue writes nothing (the request stays pending in the table)', async () => {
    const stale = (await approval(w, w.mShared, 'submit_form', { expiresInMin: -5 })).id; // already past its expiry, still state 'pending' in the table
    const before = (await q(w, `select count(*)::int n from audit_events`))[0].n + (await q(w, `select count(*)::int n from events`))[0].n;
    const { rows } = await get();
    expect(JSON.stringify(rows)).not.toContain(stale);
    expect((await q(w, `select state from approval_requests where id=$1`, [stale]))[0].state).toBe('pending');
    expect((await q(w, `select count(*)::int n from audit_events`))[0].n + (await q(w, `select count(*)::int n from events`))[0].n).toBe(before);
  });
  it('a waiting task is listed only past the expected time (24 h), and a fresh failure with a channel is not listed', async () => {
    const fresh = await waitingTask(w, w.mShared, 3);
    const detected = await failure(w, w.mShared, 'FM-1.1', { channel: 'test' });
    const { rows } = await get();
    const text = JSON.stringify(rows);
    expect(text).toContain(ids.waiting);
    expect(text).not.toContain(fresh);
    expect(text).not.toContain(detected);
  });
  it('a proposal is listed only when it expires within 48 hours; a far one and a decided one are not', async () => {
    const far = await orgProposal(w, 24 * 5), done = await versionProposal(w, 10, 'rejected');
    const { rows } = await get();
    const text = JSON.stringify(rows);
    expect(text).toContain(ids.org); expect(text).toContain(ids.version);
    expect(text).not.toContain(far); expect(text).not.toContain(done);
  });
  it('a stale review is listed; the task with a current review is not', async () => {
    const ok = await task(w, w.mShared, 'passed');
    const { rows } = await get();
    expect(JSON.stringify(rows)).toContain(ids.review);
    expect(JSON.stringify(rows)).not.toContain(ok);
  });
  it('system-derived lessons have their own reason; a person\'s lesson has the other', async () => {
    const { rows } = await get();
    expect(rows.find((r) => JSON.stringify(r).includes(ids.system))?.reason).toBe('lesson_system_derived');
    expect(rows.find((r) => JSON.stringify(r).includes(ids.lesson))?.reason).toBe('lesson_awaiting_review');
  });
});
