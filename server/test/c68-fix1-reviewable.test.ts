import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ATTENTION_REASONS } from '../../shared/contracts/src/index.ts';
import { evidenceOf } from '../src/attention/evidence.ts';
import { digestV2 } from '../src/approvals/service.ts';
import { proposeLesson } from '../src/agents/playbooks.ts';
import { tx } from '../src/db.ts';
import { makeWorld, staleReview, failure, task, waitingTask, q, uid, type World } from './c68-fixtures.ts';

// c68 fix round, item 1 (review F1): a stale review is listed only for a reviewable task.
let w: World;
const rows = async (who = w.admin) => (await who.req('GET', '/attention')).body.rows as any[];
const members = (r: any[]) => r.flatMap((x) => x.members);
const fact = (ev: any, l: string) => ev.facts.find((f: any) => f.label === l)?.value;
beforeAll(async () => { w = await makeWorld(); }, 60_000);
afterAll(async () => { await w.t.close(); });

describe('F1: a stale review is listed only for a task that can be reviewed', () => {
  it.each(['running', 'retry_ready', 'verifying', 'waiting_agent', 'ready'])('a task that is %s is not listed', async (status) => {
    const id = await staleReview(w, w.mShared);
    await q(w, `update tasks set status=$2 where id=$1`, [id, status]);
    expect(JSON.stringify(await rows())).not.toContain(id);
  });
  it('a passed task and a failed task are listed', async () => {
    const a = await staleReview(w, w.mShared), b = await staleReview(w, w.mShared);
    await q(w, `update tasks set status='failed' where id=$1`, [b]);
    const t = JSON.stringify(await rows());
    expect(t).toContain(a); expect(t).toContain(b);
  });
});

