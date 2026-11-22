import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ATTENTION_REASONS } from '../../shared/contracts/src/index.ts';
import { evidenceOf } from '../src/attention/evidence.ts';
import { digestV2 } from '../src/approvals/service.ts';
import { proposeLesson } from '../src/agents/playbooks.ts';
import { tx } from '../src/db.ts';
import { makeWorld, staleReview, failure, task, waitingTask, q, uid, type World } from './c68-fixtures.ts';

// c68 fix round, item 3 (review F3): failure rows.
let w: World;
const rows = async (who = w.admin) => (await who.req('GET', '/attention')).body.rows as any[];
const members = (r: any[]) => r.flatMap((x) => x.members);
const fact = (ev: any, l: string) => ev.facts.find((f: any) => f.label === l)?.value;
beforeAll(async () => { w = await makeWorld(); }, 60_000);
afterAll(async () => { await w.t.close(); });

describe('F3: failure rows', () => {
  it('a failure with no channel stays listed when another mode on the same subject has one (the exclusion is per mode)', async () => {
    const subject = await failure(w, w.mShared, 'FM-1.4');
    await failure(w, w.mShared, 'FM-2.1', { subject, channel: 'test' });
    const ms = members(await rows()).filter((m) => m.id.startsWith('failure:') && fact(m.evidence, 'Subject')?.endsWith(subject));
    expect(ms.length).toBe(1);
    expect(fact(ms[0].evidence, 'Failure mode')).toContain('FM-1.4');
  });
  it('the action text names a path that exists: a decided tag cannot be edited, so it never says to tag the same task again', () => {
    const d = ATTENTION_REASONS.find((r) => r.code === 'failure_no_detection')!;
    expect(d.action).not.toMatch(/same task again/i);
    expect(d.action).toMatch(/cannot be (changed|edited)/i);
    const ev = evidenceOf('failure_no_detection', { modeId: 'FM-3.2', modeName: 'x', subjectKind: 'task', subjectId: 'T' });
    expect(ev.check).not.toMatch(/tag the task again/i);
  });
});

