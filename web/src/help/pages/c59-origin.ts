import type { HelpEntry } from '../registry';

const h = (title: string, what: string, why?: string, how?: string, example?: string, permission?: string): HelpEntry => ({ title, what, why, how, example, permission });

/** Improvement cycle 59: origin-bound memory and skill records. Records only: nothing executes and no agent reads them yet. */
const entries: Record<string, HelpEntry> = {
  'playbook.origin': h('Origin', 'Where a lesson or skill came from: a person (human), an agent, or a tool. The server records the write channel and derives the class from it, from lowest to highest: tool, agent, human. A record built from other records (a summary or merge) is never above its weakest source.',
    'A reviewed summary of tainted text is still tainted. Keeping the origin on the record lets a reviewer weigh it, and stops an agent-side route from ever claiming a person wrote something.',
    'Review does not change it: accepting, approving or rolling back leave the origin as written. Human means entered by a signed-in person through the app. The rule follows recorded links to lessons and skills only: text an agent wrote that a person typed in by hand cannot be detected, and sources such as a mission, a review or a note carry no class. This rule is our own design and our own tests; no published success rate is claimed.',
    'A person merges one agent lesson and one human lesson into a summary: the summary is class agent.', 'Everyone reads it. It is set by the server and cannot be edited.'),
  'playbook.cap': h('Active cap', 'The most active items one agent playbook keeps (the cap is per agent playbook). Accepting a lesson (or rolling back to a longer version) past the cap is refused with ACTIVE_CAP_REACHED, and the refusal is audited.',
    'A library that only grows decays: stale and overlapping advice crowds out the good items.', 'Retire something first by rolling back to a shorter version, then accept the new lesson. Rejecting and proposing are never limited.',
    'Cap 25: the 26th accept is refused.', 'The cap is an operator setting, not something an administrator can change here. Skills do not belong to an agent playbook, so they are not capped.'),
  'playbook.log': h('Contribution log', 'An append-only list for one record: who or what changed it (a person, an agent or the system), when, which version it touched, and the sources it rested on.',
    'It answers "who put this here and on what evidence" long after the fact. Nothing in it can be edited or deleted.', 'Open Log on a lesson, a playbook item or a skill. Administrators also see the notes.', undefined,
    'You see the log of a record you can open. Source ids stay hidden unless you proposed it or you are an administrator.'),
  'skills.retirement': h('Retirement proposals', 'A skill is proposed for retirement when its latest outcome score is below the floor (0.4) with at least 5 observations. A person then retires it or keeps it. Nothing retires by itself.',
    'Skills that stop working should leave the library, but only a person should decide that.', 'Retire uses the normal retire step. Keep records your decision in the skill\'s contribution log for that score; a new, lower score proposes it again.',
    undefined, 'Fixture only: no agent uses a skill yet, so the only scores are test fixtures. Until real use exists this strip reads "no outcome data yet". Administrators only.'),
};
export default entries;
