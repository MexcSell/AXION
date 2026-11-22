import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { activeCapOf } from '../src/agents/playbooks.ts';
import type { SourceRef } from '../../shared/contracts/src/index.ts';

// Improvement cycle 59, item 3 (R2-5): a cap on active items per role. Playbooks are keyed by agent (c41 ruling) and one active agent holds a role,
// so the cap is per playbook. Activating past it is refused with ACTIVE_CAP_REACHED, and the refusal is audited.
const CAP = 3;
let t: TestApp;
let A: Browser, B: Browser, M: Browser;
let n = 0;
const key = () => ({ 'idempotency-key': 'c59cap' + n++ });
const q = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const SRC: SourceRef[] = [{ kind: 'review', id: 'REV-5' }];
const topics = ['linters', 'screenshots', 'retries', 'timeouts', 'selectors', 'headings', 'captions', 'branches'];
const propose = async (agent: string, i: number) => (await M.req('POST', `/agents/${agent}/lessons`, { text: `Always check ${topics[i]} number ${n++} first`, sources: SRC }, key())).body.lesson.id as string;
const book = async (agent: string) => (await A.req('GET', `/agents/${agent}/playbook`)).body.playbook as { version: number; items: unknown[]; activeCap: number };
const accept = async (by: Browser, id: string, agent: string) => by.req('POST', `/lessons/${id}/decision`, { decision: 'accept', baseVersion: (await book(agent)).version });

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, playbookActiveCap: CAP, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } } as any);
  const w = await withAdmin(t.app);
  A = w.admin;
  const b = await w.member('Bea'); B = b.b;
  expect((await A.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b;
});
afterAll(async () => { await t.close(); });

describe('activeCapOf', () => {
  it('defaults to 25 and ignores a value that is not a whole number from 1 to 200', () => {
    expect(activeCapOf({})).toBe(25);
    for (const bad of [0, -1, 2.5, 201, NaN, undefined]) expect(activeCapOf({ playbookActiveCap: bad as number })).toBe(25);
    expect(activeCapOf({ playbookActiveCap: 3 })).toBe(3);
  });
});

describe('the cap', () => {
  it('accepting up to the cap works and the playbook reports it; the next accept is 409 ACTIVE_CAP_REACHED, stays proposed, makes no version and no log line, and is audited', async () => {
    for (let i = 0; i < CAP; i++) expect((await accept(B, await propose('coder-01', i), 'coder-01')).status).toBe(200);
    const pb = await book('coder-01');
    expect(pb).toMatchObject({ version: CAP, activeCap: CAP });
    expect(pb.items).toHaveLength(CAP);
    const over = await propose('coder-01', CAP);
    const r = await accept(B, over, 'coder-01');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ACTIVE_CAP_REACHED');
    expect(r.body.message).toMatch(/3/);
    expect((await q('select status from lesson_candidates where id=$1', [over]))[0].status).toBe('proposed');
    expect((await book('coder-01')).version).toBe(CAP);
    expect((await q(`select count(*)::int n from record_contributions where record_id=$1 and action='accepted'`, [over]))[0].n).toBe(0);
    const a = (await q(`select result, detail from audit_events where action='playbook.decide' and subject=$1 order by seq desc limit 1`, [over]))[0];
    expect(a).toMatchObject({ result: 'denied', detail: { code: 'ACTIVE_CAP_REACHED' } });
    // proposing and rejecting are not limited: the cap is on what is ACTIVE
    expect((await B.req('POST', `/lessons/${over}/decision`, { decision: 'reject', note: 'Full.' })).status).toBe(200);
  });

  it('another role is not affected: writer-01 has its own cap', async () => {
    for (let i = 0; i < CAP; i++) expect((await accept(B, await propose('writer-01', i), 'writer-01')).status).toBe(200);
    expect((await accept(B, await propose('writer-01', 5), 'writer-01')).body.code).toBe('ACTIVE_CAP_REACHED');
  });

  it('a rollback that would activate more items than the cap is refused too; one that does not is fine; rolling back to fewer items always works', async () => {
    expect((await A.req('POST', '/agents/coder-01/playbook/rollback', { toVersion: 1, baseVersion: CAP, why: 'Trim.' })).status).toBe(200); // v4: 1 item
    t.app.cfg.playbookActiveCap = 2; // an operator lowers the cap: version 3 (3 items) is now over it
    const r = await A.req('POST', '/agents/coder-01/playbook/rollback', { toVersion: 3, baseVersion: CAP + 1, why: 'Restore all.' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ACTIVE_CAP_REACHED');
    expect((await book('coder-01')).version).toBe(CAP + 1);
    expect((await A.req('POST', '/agents/coder-01/playbook/rollback', { toVersion: 2, baseVersion: CAP + 1, why: 'Two is the cap.' })).status).toBe(200);
    t.app.cfg.playbookActiveCap = CAP;
  });

  it('concurrent accepts never pass the cap: of 6 racing on one agent exactly 3 succeed and the others get the cap code', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await propose('tester-01', i));
    const results = await Promise.all(ids.map(async (id) => {
      for (let tries = 0; tries < 30; tries++) {
        const r = await accept(B, id, 'tester-01');
        if (r.status === 200) return 'ok';
        if (r.body.code === 'ACTIVE_CAP_REACHED') return 'cap';
        if (r.body.code !== 'CONFLICT') return 'other ' + r.status + ' ' + r.body.code;
      }
      return 'gave up';
    }));
    expect(results.filter((x) => x === 'ok')).toHaveLength(CAP);
    expect(results.filter((x) => x === 'cap')).toHaveLength(6 - CAP);
    const pb = await book('tester-01');
    expect(pb.items).toHaveLength(CAP);
    expect((await q('select max(jsonb_array_length(items))::int m from playbooks where agent_id=$1', ['tester-01']))[0].m).toBe(CAP);
  });
});
