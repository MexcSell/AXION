import type { HelpEntry } from '../registry';

const h = (title: string, what: string, why?: string, how?: string, example?: string, permission?: string): HelpEntry => ({ title, what, why, how, example, permission });
const PAPER = 'Fourney et al., "Magentic-One", arXiv 2411.04468 (https://arxiv.org/abs/2411.04468)';

/** Improvement cycle 39: mission ledgers. The structure follows the Orchestrator of Magentic-One; the wording is AXION's own. */
const entries: Record<string, HelpEntry> = {
  'ledger.overview': h('Mission ledger', 'One place for what the team believes about this mission and whether the work is moving. It has two ledgers: the task ledger (facts and plan) and the progress ledger (a check-in on how it is going).',
    'Today this is spread over tasks, messages and events. A ledger is explicit, versioned and never rewritten, so you can see what changed and when, and a stuck mission shows up as a stall instead of a feeling.',
    'Each save makes a new version; old versions stay. History compares any two.',
    `Structure after the Orchestrator in ${PAPER}. The field wording here is AXION's own.`,
    'Everyone who can see the mission reads its ledgers. Its owner and administrators edit. Agents do not write ledgers yet.'),
  'ledger.task': h('Task ledger', 'What is known and what is planned. Facts are sorted by how sure we are: given, still to look up, still to derive, and guesses. Below them, the plan: steps with an owner and a status.',
    'Separating a fact from a guess keeps a guess from being treated as a fact later.', 'Edit saves a new version made from the one you loaded. If someone saved first you are asked how to continue.', 'Given: "Budget is 5k". Guess: "Vendor A is cheaper".'),
  'ledger.progress': h('Progress ledger', 'A check-in: is the request satisfied, is the team repeating itself, is it making progress, who acts next and with what instruction. Each check-in is a new version.',
    'The run of check-ins shows whether work is moving, with no guessing.', 'Check in saves a new version. The stall counter is worked out by the server from the history, you do not type it.'),
  'ledger.satisfied': h('Request satisfied', 'Yes when the mission request has been fully met. A satisfied check-in ends any stall.'),
  'ledger.looping': h('Looping', 'Yes when the team is repeating the same steps or messages without getting anywhere.', 'Two looping check-ins in a row count as a stall.'),
  'ledger.progressing': h('Making progress', 'Yes when forward progress was made since the last check-in.', 'A check-in with no progress, or a looping one, adds to the stall counter.'),
  'ledger.stall': h('Stall', 'Shows how many check-ins in a row had no progress, and flags the mission as stalled at 3, or when two check-ins in a row were looping.',
    'It is the signal that the plan needs another look. The limits are fixed: 3 check-ins without progress, or 2 looping in a row.', `Counting follows the stall counter of the Magentic-One Orchestrator, which re-plans when it passes its threshold (${PAPER}). Here a stall only flags the mission; a person decides what to do.`),
  'ledger.history': h('Version history', 'Every saved version of a ledger with who saved it and when. Pick From and To to see what was added, removed or changed between two versions.', 'Nothing is overwritten, so the record of what the team believed stays.'),
  'ledger.edit': h('Edit a ledger', 'Saves a new version of the ledger, made from the version you loaded.', 'If someone saved a newer version first, the save is refused (409). You can then load their version (dropping your edit), or save yours as the next version. Theirs stays in History but is not merged into yours.', 'Facts: one per line; add a source after " | ". Steps: text, optional owner, status.', undefined, 'The mission owner and administrators.'),
  'ledger.fact.given': h('Given facts', 'Facts that were stated in the mission or have been verified. Add where they came from after " | ".'),
  'ledger.fact.to_look_up': h('Facts to look up', 'Things the team needs to find out, for example by searching or by asking someone.'),
  'ledger.fact.to_derive': h('Facts to derive', 'Things that can be worked out from what is already known, by calculation or by reasoning.'),
  'ledger.fact.guesses': h('Guesses', 'Educated guesses the team may fall back on when it is stuck. They are hedged: not facts until verified.'),
  'ledger.next': h('Next speaker and instruction', 'Which team member should act next and what they should be asked to do. Both are optional.'),
};
export default entries;
