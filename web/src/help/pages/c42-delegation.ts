import type { HelpEntry } from '../registry';

/** c42: typed delegation brief and the scope rule. */
const entries: Record<string, HelpEntry> = {
  'delegation.brief': {
    title: 'Delegation brief',
    what: 'The written hand-off of one delegation: the goal, inputs, how to tell it is done (acceptance), the capabilities the delegate may use (with their risk tier), an optional budget and deadline, and when to ask a human. A brief never changes: a change is a new brief that supersedes the old one. Delegations made before briefs existed show "no brief (legacy)". Since c51 a reassignment always needs a brief (the server refuses one without).',
    how: 'A delegate can only hold a subset of what its delegator effectively holds. The effective scope is worked out on every read as the intersection of the newest brief of every ancestor up to the root, so narrowing a brief higher up narrows everything below it at once ("Effective now", "narrowed by"). A child that omits a deadline or budget inherits the smallest one on its chain. The chain is at most 3 deep. A capability without an origin does not cover any origin: access to a site is its own capability. A request for anything more is refused with the names of the items. A person can only put into the first brief what they could approve themselves, decided by the same policy service as approvals. A child deadline or budget may not exceed its parent\'s. The sha256 is taken over the brief with its keys sorted, so the same brief always has the same hash.',
    why: 'Many multi-agent failures start from an under-specified hand-off, and privilege must not grow along a chain. The source, Intelligent AI Delegation (arXiv 2602.11865), is a conceptual framework with no experiments, so this is a safeguard and not a measured improvement. Agents do not execute work yet, so no result is judged against a brief.',
    example: 'Owner > Planner (read, summarize, fill_draft) > Writer (read, summarize). Writer cannot be given send_message because Planner never held it.',
  },
};
export default entries;
