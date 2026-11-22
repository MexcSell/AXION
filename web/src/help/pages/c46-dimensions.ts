import type { HelpEntry } from '../registry';

const h = (title: string, what: string, why?: string, how?: string, example?: string, permission?: string): HelpEntry => ({ title, what, why, how, example, permission });
const EMPTY = 'A cell says "not enough evidence (n = k)" when fewer rows exist than it needs (3, or 5 for task outcomes). That is a correct answer, not a fault: AXION does not guess.';

/** Improvement cycle 46: the six dimensions of organizational intelligence (spec §16.1). There is no total and no overall number, on purpose. */
const entries: Record<string, HelpEntry> = {
  'dimensions.panel': h('Six dimensions', 'Six separate views of how the company is learning: Cognitive, Capability, Environmental, Collective, Knowledge and Evolutionary. Each one is a short row of small measurements, and each measurement shows its own value, how many rows it rests on (n) and the time window.',
    'The design asks for sample sizes, evidence and trend, never one unexplained "intelligence number". So there is no total, no average and no ranking here, and adding the cells together would mean nothing.',
    'Every figure is counted from rows the server recorded, for missions you can see. Simulated and DEMO rows are never counted. The trend compares the same measurement with the previous equal window, and only appears when both windows have a value.',
    'Capability › "Tasks passed first time": 8 of 10 task outcomes in the last 30 days passed with one attempt. n = 10.', 'Everyone signed in can open it. Cells that depend on administrator-only records (site grants, lessons under review) stay empty for others.'),
  'dimensions.department': h('Department', 'Choose the whole company or one department. A department keeps only the rows that belong to it.',
    'A weak spot can hide in a company-wide figure.', 'Task and review rows follow the agent that owned the task. Delegations follow the agent that received them. Lessons, promotions and rollbacks follow the agent. Mission-level rows (stalls, approvals, site grants) count when a real agent of the department was on the mission. Org revisions count when they changed a reporting line of a member.',
    'Engineering shows only the tasks owned by Engineering agents.'),
  'dimensions.window': h('Window', 'The length of time each measurement looks back: 7, 30 or 90 days, ending now. The previous window of the same length comes right before it, and is used only for the trend arrow.',
    'A short window reacts quickly but holds few rows, so more cells will say "not enough evidence".', 'Windows are inclusive at both ends. Playbook items are a snapshot at the end date; every other cell counts what happened inside the window.'),
  'dimensions.cell': h('Reading a cell', 'The big figure is the value. Below it: n is the number of rows it rests on, then the window. The arrow compares with the previous equal window and appears only when both windows have enough rows. Hover or focus a cell for the exact sentence of evidence.',
    EMPTY),
  'dimensions.cognitive': h('Cognitive', 'How well the company plans, checks and keeps moving.',
    'Verification and stalls are where weak reasoning shows first.',
    'Verified on first attempt: of tasks reviewed in the window that needed one attempt, the share whose latest review is Accepted with evidence by someone other than the producer and the mission owner (source: independent task reviews). Missions with a flagged stall: of missions with a progress ledger entry in the window, the share where the ledger flagged a stall (three entries without progress, or two looping in a row). ' + EMPTY,
    undefined, 'Both read recorded rows only. Missions you cannot see are not counted.'),
  'dimensions.capability': h('Capability', 'What the agents can usefully do, and what they are allowed to reach.',
    'Skills that exist but never pass are not capability.',
    'Playbook items in force: accepted lessons in the latest playbook of each active agent, with the count per role in the evidence (a snapshot at the end date). Tasks passed first time: of finished task outcomes, the share that passed with one attempt and no hand-over (needs 5, like agent reliability). Site grants active: of grants issued in the window, how many are still active; expired and revoked are counted beside it. It is a count, not a score. ' + EMPTY,
    undefined, 'Site grants are visible to administrators only, so other people see "not enough evidence (n = 0)" there.'),
  'dimensions.environmental': h('Environmental', 'How the company copes with changing websites, errors and model availability.',
    'Most failures are not the agent\'s plan: pages change, sessions are lost, models go away.',
    'Tagged failures of environment type: of failed or retried tasks that carry a confirmed failure tag, the share tagged with a context-loss mode (FM-1.4 history lost, FM-2.1 conversation reset). That mapping is a reviewed constant: it is AXION\'s own reading of the failure taxonomy, and untagged failures are not counted. Website navigation and model availability are not measured until Stage 7 (browser execution), so those two cells always say n = 0. ' + EMPTY,
    undefined, 'Failure tags count only after a person confirms them.'),
  'dimensions.collective': h('Collective', 'How well people and agents hand work to each other and decide.',
    'Vague delegation and slow decisions cost more than slow agents.',
    'Delegations with a brief: of delegations in the window, the share where the receiving agent holds a typed delegation brief on that mission. Agent reviews across model families: of reviews in the window, the share written by an agent of a different model family than the producer (the server already refuses same-family agent reviews; reviews written by a person are counted in the evidence). Median approval decision time: from request to the first decision, over decided approvals. ' + EMPTY),
  'dimensions.knowledge': h('Knowledge', 'Whether learnings are proposed, accepted by someone other than their author, and kept.',
    'A lesson that is accepted and then rolled back tells you the review was too easy.',
    'Lessons proposed: how many were filed in the window. Lessons accepted: of lessons decided in the window, the share accepted. Accepted lessons rolled back: of lessons accepted in the window, the share since withdrawn by a playbook rollback (status as recorded now). ' + EMPTY,
    undefined, 'Lessons under review are visible to administrators and their authors only, so other people see "not enough evidence (n = 0)" here.'),
  'dimensions.evolutionary': h('Evolutionary', 'Whether improvements to agents and structure are made carefully and hold up.',
    'Change is only progress if it is proven and can be undone.',
    'Version proposals promoted and agent versions rolled back are counts in the window. Org revisions applied counts revisions after the starting chart (for a department: those that changed a reporting line of a member). Evaluation verdicts (win, inconclusive, loss) are computed on demand and not stored, so that cell says n = 0 until a later cycle records them. ' + EMPTY),
};
export default entries;
