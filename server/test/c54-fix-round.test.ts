import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { makeTestApp, withAdmin, type Browser, type TestApp } from './helpers.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { failureModeCounts } from '../src/failures/service.ts';
import { dbWindow } from '../src/company/clock.ts';
import { tx } from '../src/db.ts';
import { FAILURE_TAXONOMY_VERSION } from '../../shared/contracts/src/index.ts';

// c54 fix round: closed-window bound in failure-modes, approval list tiebreaker, one snapshot for scorecard/throughput/departments.
let t: TestApp;
let A: Browser;
let adminId: string;
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ('M-fix','t-1',$1,true,'running',false)`, [adminId]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ('M-fix',1,'M-fix','data','normal','x',$1)`, [adminId]);
});
afterAll(async () => { await t?.close(); });

describe('failure-modes lower bound is the closed millisecond edge', () => {
  it('a tag created exactly at the millisecond start of the window is inside it', async () => {
    const out = await tx(t.app.db, async (c) => {
      const viewer = { tenantId: 't-1', user: { id: adminId, role: 'admin' } } as any;
      const w = await dbWindow(c, '7d');
      const before = (await failureModeCounts(c, viewer, w, false)).n;
      // exactly to - 7 d on the millisecond grid: the closed interval [to-N, to] contains it
      await c.query(`insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, decided_by, decided_at, created_at)
        values ('FT-edge','t-1','M-fix','task','T-none',$1,'FM-1.1','u1','user','confirmed','u2', now(), date_trunc('milliseconds', now()) - interval '7 days')`, [FAILURE_TAXONOMY_VERSION]);
      const after = (await failureModeCounts(c, viewer, w, false)).n;
      throw Object.assign(new Error('rollback'), { result: { before, after } }); // failure_tags is append-only: the transaction is rolled back
    }).catch((e) => e.result ?? Promise.reject(e));
    expect(out.after - out.before).toBe(1);
  });
});

describe('approval list order is total', () => {
  it('approvals created in one transaction tie on created_at and are listed by id, newest first, then id descending', async () => {
    await tx(t.app.db, async (c) => {
      for (const id of ['APR-fix-b', 'APR-fix-a', 'APR-fix-c']) {
        await requestApproval(c, { id, tenantId: 't-1', missionId: 'M-fix', agentId: 'release-01', kind: 'submit_form', title: id, detail: 'd', payload: { id }, expiresInMin: 60 } as any);
      }
    });
    const r = await A.req('GET', '/approvals');
    const ids = (r.body.approvals as any[]).map((a) => a.id).filter((id) => id.startsWith('APR-fix-'));
    expect(ids).toEqual(['APR-fix-c', 'APR-fix-b', 'APR-fix-a']);
  });
});

describe('scorecard, throughput and departments read one snapshot', () => {
  it('each route runs under REPEATABLE READ', async () => {
    const seen: string[] = [];
    const orig = t.app.db.connect.bind(t.app.db) as any;
    const wrap = (c: any) => { const oq = c.query.bind(c); c.query = (...a: any[]) => { if (typeof a[0] === 'string') seen.push(a[0]); return oq(...a); }; return c; };
    const spy = vi.spyOn(t.app.db as any, 'connect').mockImplementation(((cb?: any) => {
      if (typeof cb === 'function') return orig((err: any, c: any, done: any) => cb(err, c && wrap(c), done)); // pool.query goes through the callback form
      return orig().then(wrap);
    }) as any);
    try {
      for (const url of ['/company/scorecard?window=7d', '/company/throughput?weeks=2', '/departments?window=7d']) {
        seen.length = 0;
        const r = await A.req('GET', url);
        expect(r.status, url).toBe(200);
        expect(seen.some((s) => /isolation level repeatable read/i.test(s)), url).toBe(true);
      }
    } finally { spy.mockRestore(); }
  });
});
