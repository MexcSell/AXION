import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { collapseItems, groupKeyOf, MIN_GROUP } from '../src/attention/collapse.ts';
import type { AttentionItem } from '../src/attention/types.ts';
import { makeWorld, approval, failure, staleReview, type World } from './c68-fixtures.ts';

// c68 item 3: related items fold into one row with a count. The count always equals what is folded in. Nothing else is hidden.
let seq = 0;
function item(o: Partial<AttentionItem> & { kind: AttentionItem['kind'] }): AttentionItem {
  const n = seq++;
  const base: Record<AttentionItem['kind'], Partial<AttentionItem>> = {
    approval: { reason: 'approval_pending', tier: 'R2', facts: { tier: 'R2', kind: 'submit_form', missionId: 'M-1' }, missionId: 'M-1' },
    task_review: { reason: 'review_stale', tier: null, facts: { taskId: 'T' + n, missionId: 'M-1', reviewedAttempt: 1, latestAttempt: 2 }, missionId: 'M-1' },
    task_waiting: { reason: 'task_waiting_person', tier: null, facts: { taskId: 'T' + n, missionId: 'M-1' }, missionId: 'M-1' },
    failure: { reason: 'failure_no_detection', tier: null, facts: { modeId: 'FM-3.2', modeName: 'Incorrect verification', missionId: 'M-1' }, missionId: 'M-1' },
    proposal: { reason: 'org_proposal_expiring', tier: null, facts: { proposalId: 'OP' + n }, missionId: null },
    lesson: { reason: 'lesson_awaiting_review', tier: null, facts: { agentId: 'coder-01' }, missionId: null },
  };
  return { id: `${o.kind}:${n}`, subject: 's' + n, ageSec: 100 + n, expiresInSec: null, demo: false, route: '/x', ...(base[o.kind] as object), ...o } as AttentionItem;
}
const total = (g: { count: number }[]) => g.reduce((s, x) => s + x.count, 0);

describe('c68 item 3: what collapses', () => {
  it('R2 approvals of one mission and tier collapse; another mission or a lone one does not', () => {
    const a = [1, 2, 3].map(() => item({ kind: 'approval' }));
    const other = item({ kind: 'approval', missionId: 'M-2', facts: { tier: 'R2', kind: 'submit_form', missionId: 'M-2' } });
    const g = collapseItems([...a, other]);
    expect(g.map((x) => x.count).sort()).toEqual([1, 3]);
    expect(g.find((x) => x.count === 3)!.groupedBy).toMatch(/mission/);
    expect(g.find((x) => x.count === 1)!.groupedBy).toBeNull();
  });
  it('R3 and R4 approvals are never collapsed, however many share a mission', () => {
    const l = [...Array(6)].map(() => item({ kind: 'approval', tier: 'R3', facts: { tier: 'R3', kind: 'release', missionId: 'M-1' } }))
      .concat([...Array(4)].map(() => item({ kind: 'approval', tier: 'R4', facts: { tier: 'R4', kind: 'production_deploy', missionId: 'M-1' } })));
    const g = collapseItems(l);
    expect(g.length).toBe(10);
    expect(g.every((x) => x.count === 1 && x.groupedBy === null)).toBe(true);
    expect(groupKeyOf(item({ kind: 'approval', tier: 'R9', facts: { tier: 'R9', missionId: 'M-1' } }))).toBeNull(); // an unknown tier is never folded
  });
  it('approvals of different tiers in one mission are separate rows', () => {
    const g = collapseItems([item({ kind: 'approval' }), item({ kind: 'approval' }), item({ kind: 'approval', tier: 'R3', facts: { tier: 'R3', missionId: 'M-1' } })]);
    expect(g.length).toBe(2);
  });
  it('failures group by mode across missions; stale reviews and waiting tasks by mission; lessons by agent and reason; proposals never', () => {
    const f = [item({ kind: 'failure' }), item({ kind: 'failure', missionId: 'M-9', facts: { modeId: 'FM-3.2', modeName: 'x', missionId: 'M-9' } }), item({ kind: 'failure', facts: { modeId: 'FM-1.1', modeName: 'y', missionId: 'M-1' } })];
    expect(collapseItems(f).map((x) => x.count).sort()).toEqual([1, 2]);
    expect(collapseItems([item({ kind: 'task_review' }), item({ kind: 'task_review' }), item({ kind: 'task_waiting' }), item({ kind: 'task_waiting' })]).map((x) => x.count)).toEqual([2, 2]);
    expect(collapseItems([item({ kind: 'lesson' }), item({ kind: 'lesson' }), item({ kind: 'lesson', reason: 'lesson_system_derived' })]).map((x) => x.count).sort()).toEqual([1, 2]);
    expect(collapseItems([item({ kind: 'proposal' }), item({ kind: 'proposal' })]).length).toBe(2);
  });
  it('never groups by a person: no key is built from a user id or name', () => {
    const src = readFileSync(new URL('../src/attention/collapse.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/user|owner|created_by|requested|proposedBy|decidedBy/i);
  });
  it('a group needs at least two items', () => { expect(MIN_GROUP).toBe(2); });
});

describe('c68 item 3: the count always equals the hidden total', () => {
  it('every row count equals its members, every item is in exactly one row, and the counts add up to the input', () => {
    const l = [...Array(7)].map(() => item({ kind: 'failure' })).concat([...Array(4)].map(() => item({ kind: 'approval' })), [item({ kind: 'proposal' })]);
    const g = collapseItems(l);
    for (const x of g) expect(x.count).toBe(x.members.length);
    expect(total(g)).toBe(l.length);
    const seen = g.flatMap((x) => x.members.map((m) => m.id));
    expect(new Set(seen).size).toBe(l.length);
    expect(seen.sort()).toEqual(l.map((m) => m.id).sort());
  });
  it('a row stands for its best member: the lead is the highest-ranked, its age is the oldest and its expiry the soonest', () => {
    const g = collapseItems([item({ kind: 'approval', ageSec: 10, expiresInSec: 5000 }), item({ kind: 'approval', ageSec: 900, expiresInSec: 9000 }), item({ kind: 'approval', ageSec: 50, expiresInSec: 300 })]);
    expect(g.length).toBe(1);
    expect(g[0].expiresInSec).toBe(300); expect(g[0].ageSec).toBe(900);
    expect(g[0].lead.expiresInSec).toBe(300);
  });
  it('collapsing never moves an urgent item down: the R3 row stays above a big folded group', () => {
    const l = [...Array(30)].map(() => item({ kind: 'failure', ageSec: 9_999_999 })).concat([item({ kind: 'approval', tier: 'R3', facts: { tier: 'R3', missionId: 'M-1' }, ageSec: 1 })]);
    expect(collapseItems(l)[0].lead.tier).toBe('R3');
  });
});

describe('c68 item 3: a fixture of 200 related events', () => {
  const events = (): AttentionItem[] => [
    ...['FM-1.1', 'FM-2.2', 'FM-3.1', 'FM-3.2'].flatMap((m) => [...Array(30)].map(() => item({ kind: 'failure', facts: { modeId: m, modeName: m, missionId: 'M-1' } }))), // 120 failures of 4 modes
    ...['M-1', 'M-2'].flatMap((m) => [...Array(20)].map(() => item({ kind: 'approval', missionId: m, facts: { tier: 'R2', kind: 'submit_form', missionId: m } }))), // 40 R2 approvals of 2 missions
    ...[...Array(20)].map(() => item({ kind: 'approval', tier: 'R3', facts: { tier: 'R3', kind: 'release', missionId: 'M-1' } })), // 20 R3 approvals, never folded
    ...['M-1', 'M-2'].flatMap((m) => [...Array(5)].map(() => item({ kind: 'task_review', missionId: m, facts: { taskId: 't', missionId: m } }))), // 10 stale reviews of 2 missions
    ...[...Array(10)].map(() => item({ kind: 'proposal' })), // 10 proposals, never folded
  ];
  it('turns 200 items into 38 rows (a 5.26 to 1 reduction), loses none, and keeps all 20 R3 approvals visible', () => {
    const l = events();
    expect(l.length).toBe(200);
    const g = collapseItems(l);
    expect(g.length).toBe(4 + 2 + 20 + 2 + 10);
    expect(total(g)).toBe(200);
    const hidden = l.length - g.length;
    expect(hidden).toBe(162); // folded into other rows, each still listed under its row
    expect(g.reduce((s, x) => s + (x.count - 1), 0)).toBe(hidden);
    expect(+(l.length / g.length).toFixed(2)).toBe(5.26);
    expect(g.filter((x) => x.lead.tier === 'R3').length).toBe(20);
    expect(g.filter((x) => x.lead.tier === 'R3').every((x) => x.count === 1)).toBe(true);
  });
});

describe('c68 item 3: the route', () => {
  it('folds 12 failures of one mode and 5 approvals of one mission; lists every R3 apart; and nothing is dropped by a limit', async () => {
    const w: World = await makeWorld();
    try {
      for (let i = 0; i < 12; i++) await failure(w, w.mShared, 'FM-3.2');
      for (let i = 0; i < 5; i++) await approval(w, w.mShared, 'submit_form');
      for (let i = 0; i < 3; i++) await approval(w, w.mShared, 'release');
      await staleReview(w, w.mShared);
      // more than 200 of one mode: the source routes cap at 200, this queue must not
      await w.t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status) select 'T-bulk-' || g, 't-1', $1, 'Bulk', 'failed' from generate_series(1, 210) g`, [w.mShared]);
      await w.t.pool.query(`insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, decided_by, decided_at)
        select 'FT-bulk-' || g, 't-1', $1, 'task', 'T-bulk-' || g, 'mast-arxiv-2503.13657v3', 'FM-2.1', $2, 'user', 'confirmed', $3, now() - interval '1 day' from generate_series(1, 210) g`, [w.mShared, w.miaId, w.benId]);
      const b = (await w.admin.req('GET', '/attention')).body as { rows: any[]; totals: { items: number; rows: number; collapsed: number } };
      const f12 = b.rows.find((r) => r.kind === 'failure' && r.members.length === 12)!;
      expect(f12.count).toBe(12);
      const f210 = b.rows.find((r) => r.kind === 'failure' && r.members.length === 210)!;
      expect(f210.count).toBe(210);
      expect(b.rows.find((r) => r.kind === 'approval' && r.tier === 'R2')!.count).toBe(5);
      expect(b.rows.filter((r) => r.tier === 'R3').map((r) => r.count)).toEqual([1, 1, 1]);
      for (const r of b.rows) expect(r.count).toBe(r.members.length);
      expect(b.totals.items).toBe(b.rows.reduce((s, r) => s + r.count, 0));
      expect(b.totals.rows).toBe(b.rows.length);
      expect(b.totals.collapsed).toBe(b.totals.items - b.totals.rows);
      expect(b.totals.items).toBe(12 + 210 + 5 + 3 + 1);
    } finally { await w.t.close(); }
  }, 90_000);
});
