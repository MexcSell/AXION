import { FAILURE_TAXONOMY, FAILURE_TAXONOMY_VERSION, FAILURE_TAXONOMY_SOURCE } from '@contracts';
import type { HelpEntry } from '../registry';

const h = (title: string, what: string, why?: string, how?: string, example?: string, permission?: string): HelpEntry => ({ title, what, why, how, example, permission });
const SRC = `Taxonomy ${FAILURE_TAXONOMY_VERSION}. Category names, mode ids and mode names are from ${FAILURE_TAXONOMY_SOURCE}. The one-sentence descriptions are AXION's own plain-words summaries; the paper has the full definitions.`;

/** Improvement cycle 33: failure-mode tags (MAST). One entry per category and per mode, generated from the same frozen list the server uses. */
const entries: Record<string, HelpEntry> = {
  'failure.tag': h('Failure tags', 'A tag says why a task, an attempt, a message or a mission failed, using one of 14 failure modes from the MAST taxonomy (three categories). Today a failed task says nothing about why; a shared vocabulary lets failures be counted.',
    'Without common words the company cannot learn from its failures. The labels are judgments, so they are checked: every tag starts as proposed.',
    'Pick a category, then a mode, add a note if you like, and tag. A person then confirms or rejects the tag, once. Only confirmed tags are counted, with their sample size n, how many of n are DEMO, how many were confirmed by the person who tagged them, and the window.',
    'Task T-12501 failed: tag it "Step repetition" (FM-1.3) and confirm. The count for FM-1.3 becomes 1, n=1.',
    'Everyone who can see the mission can tag and decide. Agents will be able to propose tags later; those stay proposed until a person confirms them.'),
  'failure.category': h('Failure category', 'MAST groups its 14 failure modes into three categories: System Design Issues, Inter-Agent Misalignment and Task Verification. Choose the category first; it narrows the list of modes.', undefined, SRC),
  'failure.mode': h('Failure mode', 'One of the 14 named ways a multi-agent system fails. Select a mode to tag it; open the ? beside a mode for a one-sentence description and the source.', 'A mode is a label for a failure that was seen, not a verdict on who is to blame.', SRC),
  'failure.status': h('Proposed, confirmed, rejected', 'Proposed: tagged but not yet checked by a person. Confirmed: a person agreed; it is counted. Rejected: a person disagreed; it is kept in the history and not counted.', 'The research behind MAST notes that these labels are subjective. A decision is made once and never changes; tag again to record another view.', undefined, undefined, 'Any person who can see the mission can decide.'),
  'failure.counts': h('Failure counts', 'Confirmed tags per failure mode and category in the last 7, 30 or 90 days, over the missions you can see. n is the number of confirmed tags. When n is 0 the counts show "—", not 0: nothing has been counted yet.', 'Counts need a sample. A number with no tags behind it would be invented.', 'A tag is placed in the window by the time it was tagged. Proposed tags are shown beside n, not in it. DEMO missions count only for DEMO subjects and are labelled, with the number of DEMO tags inside n. A tag confirmed by the same person who made it is counted and shown as self-confirmed.'),
};
for (const c of FAILURE_TAXONOMY) {
  entries[`failure.cat.${c.id}`] = h(`${c.id}: ${c.name}`, c.definition, undefined, `${c.modes.length} failure modes: ${c.modes.map((m) => `${m.id} ${m.name}`).join('; ')}.`, undefined, SRC);
  for (const m of c.modes) entries[`failure.mode.${m.id}`] = h(`${m.id}: ${m.name}`, m.definition, `Category ${c.id}: ${c.name}.`, SRC);
}
export default entries;
