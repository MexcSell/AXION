import type { HelpEntry } from '../registry';

/** Improvement cycle 6: help for the api-mode Departments facts (each says where the number comes from). */
const entries: Record<string, HelpEntry> = {
  'dept.api': {
    title: 'Departments (recorded)',
    what: 'Each card shows facts the AXION server records for a department: its members, its head, who is staffed on active missions now, the open tasks of its agents and the task outcomes in the chosen window. Every number is a count from missions you can see, with its sample size.',
    how: 'Counted by GET /departments from the agent catalog, the latest org revision, agent instances, tasks, task attempts and task state events. DEMO missions and simulated tasks count only with "include DEMO". The cards re-read live when staffing, tasks, the org chart, agents or missions change.',
    why: 'Agents do not execute work yet, so capacity, skill coverage and KPI trends cannot be measured; the prototype figures stay in demo mode only.',
  },
  'dept.head': {
    title: 'Department head',
    what: 'The member that reports to the GM in the latest organisation revision. In the GM\'s own department the GM is the head. "No head" (amber) means no member reports to the GM.',
    how: 'Read from the newest org revision (highest number). When several members report to the GM, the head is the one with the most members of the department under it (then the lowest id), and the card says how many report to the GM.',
    why: 'A department without a single line to the GM has no one accountable for it.',
  },
  'dept.members': {
    title: 'Members',
    what: 'The active agents whose catalog department is this one. Select an avatar to open the agent.',
    how: 'From each agent\'s department in the agent catalog (retired agents are not members).',
  },
  'dept.staffed': {
    title: 'Staffed agents and active missions',
    what: 'How many members have a live, real instance on a mission that is planning, running, verifying or waiting for approval, and on how many distinct missions. The ring shows staffed members out of all members.',
    how: 'From the server\'s agent instances on missions you can see; an ended instance does not count. Simulated instances and DEMO missions count only with "include DEMO". The same rule as the Overview "Staffed Agents" tile.',
    why: 'Agents do not execute before a later stage, so being staffed is what can be measured today.',
  },
  'dept.openTasks': {
    title: 'Open tasks',
    what: 'Tasks owned by members right now: running (running or verifying), waiting (for an agent or a person) and failed (can be retried).',
    how: 'The current state of each task on missions you can see that are not completed, canceled or archived. Queued tasks that have not started are not counted. The owner is the agent of the task\'s owner instance.',
  },
  'dept.outcomes': {
    title: 'Task outcomes',
    what: 'Task results of this department\'s agents in the window: passed, failed, and how many of them took the same agent more than one attempt. n is passed + failed. Below 5 the card says "too few to rate"; no rate is shown at any size.',
    how: 'Each result counts against the department of the agent that owned the task when it happened. A task failed by one department and reassigned keeps that failure there; the receiving department is judged only on its own attempts after the handover (a pass with no attempt of its own is not counted). A task is in the window when it is passed or failed now and its finish time (the later of its last move into that state, its last attempt and its creation) falls inside it, both ends included. Canceled tasks are not outcomes. Simulated tasks count only with "include DEMO". The same rule as an agent\'s reliability.',
    why: 'A share computed from two or three tasks would look precise and mean nothing.',
  },
  'dept.lastOrgChange': {
    title: 'Last org change',
    what: 'The newest organisation revision that added, removed or moved a reporting line of one of this department\'s agents, and when it was applied.',
    how: 'Each revision is compared with the one before it; a line belongs to the department of the agent that reports along it. The GM reports to nobody, so the GM\'s own line never changes.',
  },
};
export default entries;
