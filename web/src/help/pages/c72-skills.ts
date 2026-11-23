import type { HelpEntry } from '../registry';

/** c72: difficulty-adjusted skill ratings (R3-7, with R3-1 folded in), no leaderboard. */
const entries: Record<string, HelpEntry> = {
  'agent.skillVector': {
    title: 'Skills by task class',
    what: 'For each kind of task, how often this agent\'s finished tasks passed, with a nominal 95% range and the number of tasks behind it. The class and the difficulty (1 to 5) come from the delegation brief that handed the task over. A class with fewer than 5 such tasks shows "not enough evidence" and no rate.',
    how: 'The nominal 95% range was checked by simulation and is not exactly 95% everywhere: on a fixed test grid some cases covered only about 86 to 94%, mostly when a level has few tasks or the pass rate is very high or low. A difficulty level with fewer than 5 tasks is left out of the rate. The rate is shown as a number only when it is built from at least 3 levels; otherwise only as a muted range. The unadjusted pass rate and any levels left out are behind the ? on each row, and the footer shows how many finished tasks carry a usable label (a low share can hide failures). The adjusted rate re-weights the pass rate at each difficulty level to a fixed mix (every level counts the same), so an agent that was only given easy tasks is not credited for them. It is worked out only over the levels the agent has tasks for, and those levels are shown on every row. Two agents\' adjusted rates are therefore comparable only when their levels match. The comparison picker does this for you: it looks only at levels both agents have, and says "distinguishable" (the 95% intervals do not overlap) or "indistinguishable". It never says who is better, and nothing in AXION lists agents by this rating.',
    why: 'Counting raw passes rewards whoever was handed easy work. But the difficulty is set by the person or agent that delegates, so it can be gamed: read a rating as "given the difficulty that was stated". Pair ratings (an agent with a person) are not built, because nothing records that a person worked with the agent. Agents do not run tasks yet, so real rows stay empty until they do; the DEMO rows only show the arithmetic.',
    example: 'A passed 18 of 20 easy tasks (90%), B passed 6 of 20 hard ones (30%). On their own levels they share nothing, so the comparison says "indistinguishable: no difficulty level in common". It does not say A is better.',
  },
  'delegation.taskClass': {
    title: 'Task class and difficulty',
    what: 'Two optional fields of a hand-off brief. The task class is the kind of work (a fixed list in plain words). The difficulty is your own 1 to 5 judgement of how hard it is (1 routine, 5 very hard). They feed the agent\'s skill ratings once the task finishes.',
    how: 'The label that counts is the one on the first brief the agent got for the task. A later brief does not relabel an outcome that is already known. Leave both empty if you are unsure: the task then counts toward no rating.',
    why: 'You set the difficulty, so it can be used to make results look better or worse. That is why a rating always says it depends on the stated difficulty, and why nothing is decided from a rating.',
  },
};
export default entries;
