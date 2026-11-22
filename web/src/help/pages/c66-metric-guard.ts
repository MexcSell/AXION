import { AUDIT_BAR, AUDIT_MIN_N } from '@contracts';
import type { HelpEntry } from '../registry';

/** Improvement cycle 66 (R3-4): the Goodhart guard on scorecard rows, KPI tiles and dimension cells. Display only. */
const entries: Record<string, HelpEntry> = {
  'guard.gameable': {
    title: 'Gameable',
    what: 'A row is "gameable" when an agent identity can write one of the stored fields the number is counted from. The agent being measured could then move its own number, on purpose or by accident.',
    why: 'A number that its own subject can write stops being evidence (Goodhart\'s law: when a measure becomes a target, it stops being a good measure). Every row also names a counter-metric that would rise if the number were gamed, and the quality it does not cover, so nobody reads it as more than it is.',
    how: `The flag is derived by the server from an inventory of who can write each stored field (people through a route, agents through a service function, the system). A test checks that inventory against every write route and every database write, so a new writer cannot appear unnoticed. A periodic human audit can compare the metric with what a person found; when they disagree above ${AUDIT_BAR}% on at least ${AUDIT_MIN_N} samples, the row is flagged too.`,
    example: '"Tasks verified by review" reads reviews. The review service accepts an agent as reviewer, so the row is gameable, although rules stop a producer or the mission owner from reviewing their own work.',
    permission: 'Display only. Nothing here changes a score, a tier, an approval or a promotion. Whether a gameable row may ever feed a promotion decision waits for the owner (R3-3, question Q13). Today no agent executes, so no agent writes anything yet: the flag says what the code permits. Not covered: the sample-number tiles shown in demo mode and the department facts, which are counts rather than scorecard or dimension rows.',
  },
};
export default entries;
