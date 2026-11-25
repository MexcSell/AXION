import type { Agent, RoleKey } from './types';

const DEPT_META: Record<string, { role: RoleKey; hue: number }> = {
  Executive: { role: 'manager', hue: 268 },
  'R&D': { role: 'research', hue: 280 },
  Engineering: { role: 'dev', hue: 215 },
  Operations: { role: 'ops', hue: 192 },
  Governance: { role: 'security', hue: 148 },
  Knowledge: { role: 'knowledge', hue: 212 },
  QA: { role: 'qa', hue: 172 },
};

const orderedNames = Object.keys(DEPT_META);
export function departmentOrder(name: string) {
  const i = orderedNames.indexOf(name);
  return i < 0 ? orderedNames.length : i;
}

export const departmentStyle = (name: string) => DEPT_META[name] ?? { role: 'manager' as const, hue: 210 };

export function catalogDepartments(agents: Pick<Agent, 'id' | 'name' | 'dept' | 'managerId'>[]) {
  const names = [...new Set(agents.map(a => a.dept))]
    .sort((a, b) => departmentOrder(a) - departmentOrder(b) || a.localeCompare(b));
  return names.map(name => {
    const members = agents.filter(a => a.dept === name).sort((a, b) => a.name.localeCompare(b.name));
    const ids = new Set(members.map(a => a.id));
    const head = members.find(a => a.managerId && !ids.has(a.managerId)) ?? members.find(a => a.managerId === a.id);
    return { name, ...departmentStyle(name), managerId: head?.id };
  });
}
