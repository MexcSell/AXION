import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { DETECTION_CHANNELS, FAILURE_MECHANISMS, FAILURE_CONTROLS, HUMAN_ONLY_MIN_N } from '../../shared/contracts/src/failures.ts';

// Improvement cycle 63 (Phase 2, R3-8), item 1: optional detection fields on failure tags (how a failure was noticed, how long after it
// happened, what part failed, which control should have caught it and which did). All optional; the missing share is reported, never hidden.
// D2 (silent failures, mostly caught by humans) is one author on one runtime: it motivates the field and gives no rate.
let t: TestApp;
let A: Browser, M: Browser;
let adminId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'fd' + n++ });
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
const rows = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows;
const tag = (b: Browser, subjectKind: string, subjectId: string, modeId: string, extra: Record<string, unknown> = {}) => b.req('POST', '/failure-tags', { subjectKind, subjectId, modeId, ...extra }, key());
const confirm = (id: string) => A.req('POST', `/failure-tags/${id}/decision`, { decision: 'confirm' });
const modes = async (w = '30d') => (await A.req('GET', `/company/failure-modes?window=${w}`)).body;

async function mission(id: string, owner: string) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,'t-1',$2,true,'running',false)`, [id, owner]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
}
const task = (id: string, mid: string, status: string) => q(`insert into tasks(id, tenant_id, mission_id, title, status) values ($1,'t-1',$2,'A task',$3)`, [id, mid, status]);
const attempt = async (taskId: string, no: number, result: string | null, ago: string | null) =>
  String((await q(`insert into task_attempts(task_id, attempt_no, result, started_at, finished_at) values ($1,$2,$3, now() - $4::interval - interval '1 minute', case when $4::text is null then null else now() - $4::interval end) returning id`, [taskId, no, result, ago])).rows[0].id);
let attId = '';

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  M = (await w.member('Mina')).b;
  await mission('M-D1', adminId);
  await task('T-A', 'M-D1', 'failed'); attId = await attempt('T-A', 1, 'failed', '2 hours');
  await task('T-B', 'M-D1', 'failed');            // no attempts: occurrence time unknown
  await task('T-C', 'M-D1', 'failed'); await attempt('T-C', 1, 'failed', '3 days');
});
afterAll(async () => { await t?.close(); });

describe('detection fields on a tag', () => {
  it('stores channel, mechanism and both controls, and computes detected-after in the database from the stored failure time', async () => {
    const r = await tag(M, 'task', 'T-A', 'FM-1.1', { detectionChannel: 'human_review', mechanism: 'instructions', controlExpected: 'test', controlCaught: 'review' });
    expect(r.status).toBe(201);
    expect(r.body.tag).toMatchObject({ detectionChannel: 'human_review', mechanism: 'instructions', controlExpected: 'test', controlCaught: 'review', detectionNote: null });
    // the attempt finished 2 hours before the database now(): the value is a database difference, not an app clock reading
    expect(r.body.tag.detectedAfterSeconds).toBeGreaterThanOrEqual(7200);
    expect(r.body.tag.detectedAfterSeconds).toBeLessThan(7200 + 120);
    const stored = (await rows(`select extract(epoch from now() - (select finished_at from task_attempts where id=$1::bigint))::int as secs, detected_after_seconds from failure_tags where id=$2`, [attId, r.body.tag.id]))[0];
    expect(Math.abs(stored.detected_after_seconds - stored.secs)).toBeLessThan(120);
  });

  it('a tag with none of the fields keeps every one null (they are optional)', async () => {
    const r = await tag(M, 'task', 'T-A', 'FM-2.6');
    expect(r.status).toBe(201);
    expect(r.body.tag).toMatchObject({ detectionChannel: null, detectedAfterSeconds: null, mechanism: null, controlExpected: null, controlCaught: null, detectionNote: null });
  });

  it('detected-after is null where no failure time is stored (a task with no attempt), and is never accepted from the caller', async () => {
    const r = await tag(M, 'task', 'T-B', 'FM-1.1', { detectionChannel: 'audit' });
    expect(r.status).toBe(201);
    expect(r.body.tag.detectionChannel).toBe('audit');
    expect(r.body.tag.detectedAfterSeconds).toBeNull();
    const forged = await tag(M, 'task', 'T-C', 'FM-1.1', { detectionChannel: 'test', detectedAfterSeconds: 5 });
    expect(forged.status).toBe(400);
    expect((await rows(`select count(*)::int n from failure_tags where subject_id='T-C'`))[0].n).toBe(0);
  });

  it('detected-after is only worked out when a channel is given, and is never negative', async () => {
    const none = await tag(M, 'task', 'T-C', 'FM-3.1');
    expect(none.body.tag.detectedAfterSeconds).toBeNull();
    await q(`insert into task_attempts(task_id, attempt_no, result, started_at, finished_at) values ('T-C', 2, 'failed', now() + interval '1 day', now() + interval '1 day')`);
    const fut = await tag(M, 'task', 'T-C', 'FM-3.2', { detectionChannel: 'other_agent' });
    expect(fut.body.tag.detectedAfterSeconds).toBe(0); // a failure time after the database now() is clamped, never negative
  });

  it('every enum is closed: an unknown value is 400 and nothing is stored', async () => {
    const before = (await rows(`select count(*)::int n from failure_tags`))[0].n;
    for (const body of [{ detectionChannel: 'psychic' }, { mechanism: 'gremlins' }, { controlExpected: 'luck' }, { controlCaught: 'prayer' }, { detectionChannel: '' }, { detectionChannel: 5 }]) {
      const r = await tag(M, 'task', 'T-C', 'FM-1.2', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await rows(`select count(*)::int n from failure_tags`))[0].n).toBe(before);
  });

  it('"other" needs a note; with a note it is stored, and the note is trimmed and bounded', async () => {
    expect((await tag(M, 'task', 'T-C', 'FM-1.2', { mechanism: 'other' })).status).toBe(400);
    expect((await tag(M, 'task', 'T-C', 'FM-1.2', { controlCaught: 'other', detectionNote: '   ' })).status).toBe(400);
    expect((await tag(M, 'task', 'T-C', 'FM-1.2', { mechanism: 'other', detectionNote: 'x'.repeat(301) })).status).toBe(400);
    const ok = await tag(M, 'task', 'T-C', 'FM-1.2', { mechanism: 'other', detectionNote: '  A flaky vendor API  ' });
    expect(ok.status).toBe(201);
    expect(ok.body.tag).toMatchObject({ mechanism: 'other', detectionNote: 'A flaky vendor API' });
  });

  it('the enum lists are frozen and the database refuses anything else (raw insert, negative time, time without a channel, other without note)', async () => {
    expect(DETECTION_CHANNELS.map((c) => c.id)).toEqual(['test', 'audit', 'human_review', 'other_agent', 'reported_later']);
    expect(FAILURE_MECHANISMS.at(-1)!.id).toBe('other');
    expect(FAILURE_CONTROLS.map((c) => c.id)).toContain('none');
    for (const e of [...DETECTION_CHANNELS, ...FAILURE_MECHANISMS, ...FAILURE_CONTROLS]) { expect(e.label.length).toBeGreaterThan(2); expect(e.help.length).toBeGreaterThan(10); }
    const base = `insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, `;
    const vals = `'t-1','M-D1','mission','M-D1','v','FM-1.1','u','user'`;
    await expect(q(`${base}detection_channel) values ('FT-R1',${vals},'psychic')`)).rejects.toThrow();
    await expect(q(`${base}detection_channel, detected_after_seconds) values ('FT-R2',${vals},'test',-1)`)).rejects.toThrow();
    await expect(q(`${base}detected_after_seconds) values ('FT-R3',${vals},10)`)).rejects.toThrow();
    await expect(q(`${base}mechanism) values ('FT-R4',${vals},'other')`)).rejects.toThrow();
  });

  it('the new columns are as append-only as the rest: a decision cannot change them, and neither can a raw update', async () => {
    const tg = (await tag(M, 'task', 'T-A', 'FM-1.5', { detectionChannel: 'test', mechanism: 'tool' })).body.tag;
    await expect(q(`update failure_tags set detection_channel='audit' where id=$1`, [tg.id])).rejects.toThrow();
    await expect(q(`update failure_tags set status='confirmed', decided_by=$2, decided_at=now(), mechanism='context' where id=$1`, [tg.id, adminId])).rejects.toThrow(/can only be decided/);
    await expect(q(`update failure_tags set status='confirmed', decided_by=$2, decided_at=now(), detected_after_seconds=1 where id=$1`, [tg.id, adminId])).rejects.toThrow(/can only be decided/);
    expect((await confirm(tg.id)).status).toBe(200);
    expect((await rows(`select detection_channel, mechanism from failure_tags where id=$1`, [tg.id]))[0]).toEqual({ detection_channel: 'test', mechanism: 'tool' });
  });

  it('GET /failure-tags returns the fields too, and a repeated idempotent request stores one tag', async () => {
    const k = { 'idempotency-key': 'fd-repeat' };
    const body = { subjectKind: 'task', subjectId: 'T-C', modeId: 'FM-2.4', detectionChannel: 'reported_later', controlCaught: 'none' };
    const a = await M.req('POST', '/failure-tags', body, k), b = await M.req('POST', '/failure-tags', body, k);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    const got = (await A.req('GET', '/failure-tags?subjectKind=task&subjectId=T-C')).body.tags.filter((x: any) => x.modeId === 'FM-2.4');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ detectionChannel: 'reported_later', controlCaught: 'none', mechanism: null });
  });
});

describe('the counts view reports the missing share and the "found only by a person" share', () => {
  it('shows how many confirmed tags lack each field, as a count and a share, and nothing is hidden', async () => {
    const plain = await tag(M, 'task', 'T-A', 'FM-3.1'); // confirmed with no detection field at all
    expect((await confirm(plain.body.tag.id)).status).toBe(200);
    const m0 = await modes();
    expect(m0.detection).toBeTruthy();
    expect(m0.detection.n).toBe(m0.n);
    for (const f of ['channel', 'detectedAfter', 'mechanism', 'controlExpected', 'controlCaught']) {
      const x = m0.detection.fields[f];
      expect(x.have + x.missing, f).toBe(m0.n);
      expect(x.missingShare, f).toBe(m0.n > 0 ? x.missing / m0.n : null);
    }
    expect(m0.detection.fields.channel.have).toBeGreaterThan(0);
    expect(m0.detection.fields.channel.missing).toBeGreaterThan(0);
  });

  it('"detected only by a human" is null below 5 failures with a channel, with n and window, and a share at 5', async () => {
    // a clean slate of confirmed tags: tasks F1..F6 with channels
    await mission('M-H1', adminId);
    const ids: string[] = [];
    for (let i = 1; i <= 6; i++) { await task(`T-H${i}`, 'M-H1', 'failed'); await attempt(`T-H${i}`, 1, 'failed', '1 hour'); }
    const ch = ['human_review', 'test', 'human_review', 'audit', 'human_review', 'other_agent'];
    const before = (await modes()).detection.humanOnly;
    expect(before.minN).toBe(HUMAN_ONLY_MIN_N);
    expect(HUMAN_ONLY_MIN_N).toBe(5);
    for (let i = 0; i < 4; i++) ids.push((await tag(M, 'task', `T-H${i + 1}`, 'FM-3.3', { detectionChannel: ch[i] })).body.tag.id);
    for (const id of ids) await confirm(id);
    const four = (await modes()).detection;
    expect(four.humanOnly.withChannel - before.withChannel).toBe(4);
    const lessThan5 = four.humanOnly.withChannel < 5;
    if (lessThan5) expect(four.humanOnly.share).toBeNull(); // null below 5, never a number
    for (let i = 4; i < 6; i++) ids.push((await tag(M, 'task', `T-H${i + 1}`, 'FM-3.3', { detectionChannel: ch[i] })).body.tag.id);
    for (const id of ids.slice(4)) await confirm(id);
    const six = (await modes()).detection.humanOnly;
    expect(six.withChannel).toBeGreaterThanOrEqual(5);
    expect(six.share).toBeCloseTo(six.humanReview / six.withChannel, 10);
    expect(six.window).toBe('30d');
    expect(six.missing).toBe((await modes()).n - six.withChannel); // tags without a channel are counted separately, not folded in
    expect(six.humanReview).toBeGreaterThanOrEqual(3);
  });

  it('with fewer than 5 tags that have a channel the share is null even when many tags are confirmed without one', async () => {
    const T = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
    try {
      const w = await withAdmin(T.app);
      const tq = (s: string, p: unknown[] = []) => T.pool.query(s, p);
      await tq(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ('M-N','t-1',$1,true,'running',false)`, [w.adminId]);
      await tq(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ('M-N',1,'M-N','data','normal','x',$1)`, [w.adminId]);
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) {
        await tq(`insert into tasks(id, tenant_id, mission_id, title, status) values ($1,'t-1','M-N','x','failed')`, ['T-N' + i]);
        const body: any = { subjectKind: 'task', subjectId: 'T-N' + i, modeId: 'FM-1.1' };
        if (i < 4) body.detectionChannel = 'human_review';
        ids.push((await w.admin.req('POST', '/failure-tags', body, { 'idempotency-key': 'n' + i })).body.tag.id);
      }
      for (const id of ids) await w.admin.req('POST', `/failure-tags/${id}/decision`, { decision: 'confirm' });
      const d = (await w.admin.req('GET', '/company/failure-modes?window=30d')).body.detection;
      expect(d.humanOnly).toMatchObject({ withChannel: 4, humanReview: 4, missing: 3, share: null, minN: 5, window: '30d' });
      expect(d.fields.channel).toMatchObject({ have: 4, missing: 3 });
      expect(d.fields.channel.missingShare).toBeCloseTo(3 / 7, 10);
      // the missing detected-after is split: tags with a channel but no stored failure time (here all 4: the tasks have no attempt) are counted apart from tags with no channel
      expect(d.noFailureTime).toBe(4);
      expect(d.fields.detectedAfter).toMatchObject({ have: 0, missing: 7 });
    } finally { await T.close(); }
  });
});
