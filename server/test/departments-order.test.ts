import { describe, it, expect } from 'vitest';
import { departmentFacts, type DeptRows } from '../src/company/departments.ts';
import { windowOf } from '../src/company/scorecard.ts';

// Improvement cycle 81 (T1 item 4): memberIds has a defined order, the agent id in code-point order (the order the department cards show: the first three become the avatars).
const NOW = new Date('2026-11-21T12:00:00Z');
const W = { ...windowOf('30d', NOW), includeDemo: false };
const ids = ['eng-c', 'eng-a', 'eng-b', 'eng-B', 'eng-10', 'eng-9'];
const rows = (order: string[]): DeptRows => ({ agents: [{ id: 'gm', dept: 'Executive', active: true }, ...order.map((id) => ({ id, dept: 'Engineering', active: true }))], edges: [], instances: [], tasks: [], orgChanges: [] });
describe('memberIds order', () => {
  it('is the same whatever order the rows arrive in (insert in reverse and shuffled order)', () => {
    const get = (o: string[]) => departmentFacts(rows(o), W).departments.find((d) => d.name === 'Engineering')!.memberIds;
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(get(ids)).toEqual(sorted);
    expect(get([...ids].reverse())).toEqual(sorted);
    expect(get([ids[3], ids[0], ids[5], ids[1], ids[4], ids[2]])).toEqual(sorted);
  });
});
