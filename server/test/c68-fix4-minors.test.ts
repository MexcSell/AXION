import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ATTENTION_REASONS } from '../../shared/contracts/src/index.ts';
import { evidenceOf } from '../src/attention/evidence.ts';
import { digestV2 } from '../src/approvals/service.ts';
import { proposeLesson } from '../src/agents/playbooks.ts';
import { tx } from '../src/db.ts';
import { makeWorld, staleReview, failure, task, waitingTask, q, uid, type World } from './c68-fixtures.ts';

// c68 fix round, item 4 (review F4, F6, F7, F11): minors.
let w: World;
const rows = async (who = w.admin) => (await who.req('GET', '/attention')).body.rows as any[];
const members = (r: any[]) => r.flatMap((x) => x.members);
const fact = (ev: any, l: string) => ev.facts.find((f: any) => f.label === l)?.value;
beforeAll(async () => { w = await makeWorld(); }, 60_000);
afterAll(async () => { await w.t.close(); });

describe('F6: a waiting time that falls back to task creation is flagged', () => {
  it('with a state-change event there is no note; without one the item says the time counts from creation', async () => {
    const withEv = await waitingTask(w, w.mShared, 30);
    const without = await task(w, w.mShared, 'waiting_user', { created: '10 days' });
    const ms = members(await rows());
    expect(ms.find((m) => m.id === `waiting:${withEv}`).ageNote).toBeNull();
    expect(ms.find((m) => m.id === `waiting:${without}`).ageNote).toMatch(/created/i);
  });
});

describe('F7 and F4: wording and free text', () => {
  it('an R2 approval is not "decided by user"', () => {
    const f = { tier: 'R2', kind: 'submit_form', boundDigest: 'a', recomputedDigest: 'a', approver: 'user' };
    expect(JSON.stringify(evidenceOf('approval_pending', f))).not.toMatch(/decided by user/);
  });
  it('origin and target are labelled as stated by the agent and capped, and markup stays a value', async () => {
    const id = uid('APR-c68-o');
    const exp = new Date(Date.now() + 3 * 3600_000), hostile = '<img src=x onerror=alert(1)>'.repeat(120);
    const digest = digestV2({ tenantId: 't-1', missionId: w.mShared, kind: 'submit_form', origin: hostile, target: hostile, payload: {}, tier: 'R2', requestedBy: 'release-01', expiresAt: exp.toISOString() });
    await q(w, `insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, digest_version, requested_by, origin, target, expires_at) values ($1,'t-1',$2,'release-01','submit_form','t','R2',$3,2,'release-01',$4,$4,$5)`, [id, w.mShared, digest, hostile, exp]);
    const m = members(await rows()).find((x) => x.id === `approval:${id}`);
    const labels = m.evidence.facts.map((f: any) => f.label);
    expect(labels).toContain('Origin (as the agent stated it)');
    expect(fact(m.evidence, 'Origin (as the agent stated it)').length).toBeLessThanOrEqual(200);
    expect(m.evidence.check).not.toContain('onerror');
  });
});

describe('F11: privacy gaps found by mutation', () => {
  it('a lesson an agent proposed and a member filed is visible to that member (the submitted_by branch), and to nobody else but administrators', async () => {
    const id = await tx(w.t.app.db, (c) => proposeLesson(c, { tenantId: 't-1', agentId: 'coder-01', proposedBy: 'tester-01', kind: 'agent', submittedBy: w.miaId, text: 'Filed by Mia ' + uid(''), sources: [{ kind: 'review', id: 'REV-1', note: 'x' }], correlationId: 'c68' }));
    expect(JSON.stringify(await rows(w.mia))).toContain(id);
    expect(JSON.stringify(await rows(w.ben))).not.toContain(id);
    expect(JSON.stringify(await rows(w.admin))).toContain(id);
  });
  it('the owner of a mission cannot review its stale tasks (canAct false with the reason); another member can', async () => {
    const t = await staleReview(w, w.mShared); // the mission is Mia's
    const find = (r: any[]) => members(r).find((m) => m.id === `review:${t}`);
    const mia = find(await rows(w.mia)), ben = find(await rows(w.ben));
    expect(mia.canAct).toBe(false); expect(mia.note).toMatch(/commissioned/);
    expect(ben.canAct).toBe(true); expect(ben.note).toBeNull();
  });
});
