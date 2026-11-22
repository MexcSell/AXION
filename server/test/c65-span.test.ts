import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { reviewCapacity, SPAN_NOTE } from '../src/capacity/model.ts';
import { addAgent, addApproval, type Fx } from './c65-fixtures.ts';

let t: TestApp; let f: Fx;
const HOUR = 3_600_000;
/** A new org revision with exactly these reporting lines added on top of nothing else (the latest revision is the one that counts). */
async function revision(edges: [string, string][]) {
  const seq = Number((await t.pool.query(`select coalesce(max(seq),0)+1 as n from org_revisions where tenant_id='t-1'`)).rows[0].n);
  const id = (await t.pool.query(`insert into org_revisions(tenant_id, seq, note, created_by) values ('t-1',$1,'c65','test') returning id`, [seq])).rows[0].id;
  for (const [sup, sub] of edges) await t.pool.query(`insert into org_edges(revision_id, supervisor_id, subordinate_id) values ($1,$2,$3)`, [id, sup, sub]);
}
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  const A = await withAdmin(t.app);
  f = { pool: t.pool, mission: (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'c65s' + Date.now() })).body.mission.id as string };
  for (const a of ['c65-sup', 'c65-a', 'c65-b', 'c65-c', 'c65-old', 'c65-x']) await addAgent(f, a, 'Operations');
  await t.pool.query(`update agent_definitions set status='retired' where id='c65-old'`);
});
afterEach(async () => { await t.close(); });
const row = async (admin = true) => (await reviewCapacity(t.app.db, 't-1', 30, admin)).span.rows.find((r) => r.supervisorId === 'c65-sup');

describe('c65 item 4: observed span (a measure only)', () => {
  it('counts the active agents that report to a supervisor in the LATEST org revision, and the open items they raised', async () => {
    await revision([['c65-sup', 'c65-a'], ['c65-sup', 'c65-b'], ['c65-sup', 'c65-c'], ['c65-sup', 'c65-old']]);
    await addApproval(f, 'o1', 'c65-a', HOUR); await addApproval(f, 'o2', 'c65-a', HOUR); await addApproval(f, 'o3', 'c65-b', HOUR);
    await addApproval(f, 'closed', 'c65-c', HOUR, { state: 'approved' }); // not open
    await addApproval(f, 'other', 'c65-x', HOUR); // reports to nobody here
    const r = (await row())!;
    expect(r.agents).toBe(3); // the retired report is not counted
    expect(r.openItems).toBe(3);
  });
  it('an older revision is history: a line removed in the latest revision no longer counts', async () => {
    await revision([['c65-sup', 'c65-a'], ['c65-sup', 'c65-b']]);
    await revision([['c65-sup', 'c65-a']]);
    expect((await row())!.agents).toBe(1);
  });
  it('the span carries NO recommended number: no field, and the note says so in words', async () => {
    await revision([['c65-sup', 'c65-a']]);
    const r = await reviewCapacity(t.app.db, 't-1', 30, true);
    const keys = JSON.stringify(Object.keys(r.span)) + JSON.stringify(r.span.rows.flatMap((x) => Object.keys(x)));
    expect(keys).not.toMatch(/recommend|limit|target|max|safe|ideal|threshold|status|rank|score/i);
    expect(SPAN_NOTE).toMatch(/measure only/i); expect(SPAN_NOTE).toMatch(/no recommended number/i);
    expect(r.span.note).toBe(SPAN_NOTE);
  });
  it('rows are in a fixed alphabetical order, never by load, and members see the rows too (they describe agents, not people), with open items only above the floor', async () => {
    await revision([['c65-sup', 'c65-a'], ['c65-a', 'c65-b']]);
    for (let i = 0; i < 6; i++) await addApproval(f, 'q' + i, 'c65-b', HOUR);
    for (const admin of [true, false]) {
      const rows = (await reviewCapacity(t.app.db, 't-1', 30, admin)).span.rows;
      expect(rows.map((x) => x.name)).toEqual([...rows.map((x) => x.name)].sort((a, b) => a.localeCompare(b)));
      // F3 (fix round): the open items sit under the same floor as the cells; 6 items with no deciders do not clear 3 people for a member
      expect(rows.find((x) => x.supervisorId === 'c65-a')!.openItems).toBe(admin ? 6 : null);
    }
  });
});
