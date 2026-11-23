import { describe, it, expect } from 'vitest';
import { DEPTS } from '../../web/src/data/orgdemo.ts';
import { AGENT_BY_ID, AGENTS } from '../../web/src/data/agents.ts';

/** c72 re-review: a demo department's head comes from the structure (who reports to someone outside the department), never from performance. */
describe('demo department heads', () => {
  it('the head reports to someone outside the department (or the department has none), and is the first such member by name', () => {
    for (const d of DEPTS) {
      const members = AGENTS.filter((a) => a.dept === d.name);
      const inside = new Set(members.map((a) => a.id));
      const outside = members.filter((a) => a.managerId && !inside.has(a.managerId)).sort((a, b) => a.name.localeCompare(b.name));
      const head = AGENT_BY_ID[d.managerId];
      expect(head, d.name).toBeTruthy();
      if (outside.length) { expect(d.managerId, d.name).toBe(outside[0].id); expect(inside.has(head.managerId!), d.name).toBe(false); }
    }
  });
  it('is not the best performer of the department where another member reports outside it', () => {
    const eng = DEPTS.find((d) => d.name === 'Engineering')!;
    const outside = AGENTS.filter((a) => a.dept === 'Engineering' && a.managerId === 'gm').sort((a, b) => a.name.localeCompare(b.name));
    expect(outside.length).toBeGreaterThan(1);
    expect(eng.managerId).toBe(outside[0].id);
  });
});
