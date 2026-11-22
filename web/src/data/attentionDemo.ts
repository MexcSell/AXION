import { ATTENTION_REASONS, ATTENTION_SETTINGS, ATTENTION_RANKING_TEXT, type AttentionDto, type AttentionEvidence, type AttentionMemberDto, type AttentionReasonCode, type AttentionRowDto } from '@contracts';

/**
 * DEMO sample for the "Needs you" queue (demo mode only): fixed numbers, in the ranked and collapsed order the server would give.
 * Invented for the prototype; the screen labels it DEMO. Fourteen rows (twenty-six items) so the one-screen fit can be checked with a full list.
 */
const D = '9f3a1c07d2b84e5a6c01b7e9d4f2a83c5e60b1d7a94c2f38e5d1b0a76c93e4f2';
const D2 = '9f3a1c07d2b84e5a6c01b7e9d4f2a83c5e60b1d7a94c2f38e5d1b0a76c93e4f2';

const ev = (check: string, facts: [string, string][]): AttentionEvidence => ({ check, facts: facts.map(([label, value]) => ({ label, value })) });
const approvalEv = (tier: string, kind: string, who: string, fired = 'no'): AttentionEvidence => ev(
  `Compare the bound digest with the digest the server recomputes from the stored action: they match. Then read the three Rule of Two flags, and confirm the tier ${tier} fits what "${kind}" does.`,
  [['Bound digest', D], ['Recomputed digest', D2], ['Digest version', '2'], ['Tier', `${tier}, decided by an administrator`], ['Action', kind], ['Origin', 'not recorded'], ['Target', 'not recorded'], ['Requested by', who],
    ['Reads untrusted input', fired === 'yes' ? 'yes' : 'no'], ['Reaches live systems or credentials', tier === 'R2' ? 'no' : 'yes'], ['Can change state or communicate externally', 'yes'], ['Rule of Two fired', fired]]);

let n = 0;
const member = (id: string, subject: string, ageSec: number, expiresInSec: number | null, tier: string | null, evidence: AttentionEvidence, canAct = true, route = '/notifications?tab=pending'): AttentionMemberDto =>
  ({ id: `${id}:demo-${++n}`, subject, ageSec, expiresInSec, route, tier, canAct, note: canAct ? null : 'Locked in this sample.', demo: true, evidence });
const row = (reason: AttentionReasonCode, why: string, members: AttentionMemberDto[], o: { tier?: string | null; groupedBy?: string | null; label?: string; note?: string | null } = {}): AttentionRowDto => {
  const def = ATTENTION_REASONS.find((r) => r.code === reason)!;
  if (!members[0].canAct) members[0].note = o.note ?? 'Only administrators decide.';
  const lead = members[0];
  const exp = members.map((m) => m.expiresInSec).filter((e): e is number => e !== null);
  return {
    id: members.length > 1 ? `group:${lead.id}` : lead.id, reason, kind: def.kind, icon: def.icon, tier: o.tier ?? null, why, subject: lead.subject,
    ageSec: Math.max(...members.map((m) => m.ageSec)), expiresInSec: exp.length ? Math.min(...exp) : null, count: members.length, members,
    action: { label: o.label ?? 'Open', route: lead.route, canAct: lead.canAct, note: lead.note },
    evidence: lead.evidence, groupedBy: o.groupedBy ?? null, missionId: 'M-126',
  };
};
const MIN = 60, H = 3600;
const fail = (mode: string, name: string) => ev(`Ask how this ${mode} failure was found. No detection channel is recorded, so it is unknown whether a test, an audit or a person caught it. Tag the task again with the channel.`,
  [['Failure mode', `${mode} ${name}`], ['Detection channel', 'not recorded'], ['Mechanism', 'not recorded'], ['Control expected', 'not recorded'], ['Control caught', 'not recorded'], ['Confirmed by the tagger', 'no'], ['Subject', 'task T-12501']]);
const stale = (a: number, b: number, age: string) => ev(`Open the task and check which attempt the review judged: it judged attempt ${a}, and attempt ${b} started later, so the old review does not count for the new attempt.`,
  [['Attempt that was reviewed', String(a)], ['Latest attempt', String(b)], ['Verdict of that review', 'accepted'], ['Stale for', age], ['Freshness rule', 'A review counts only for the attempt it judged, and only if it was written after that attempt started.']]);
const wait = (age: string) => ev(`Open the task and look for what it is waiting on. It has had no change of state for ${age}; ask whether the person it needs knows.`,
  [['Waiting for', age], ['Waiting measured from', 'the last change of state'], ['Expected time', `${ATTENTION_SETTINGS.waitingHours} h`], ['Task', 'T-12507']]);

const unranked: AttentionRowDto[] = [
  row('approval_pending', 'An R4 approval request for "production_deploy" has waited 12 min, and it expires in 1 h 48 min.', [member('approval', 'Deploy checkout v2.4 to production', 12 * MIN, 108 * MIN, 'R4', approvalEv('R4', 'production_deploy', 'an agent', 'yes'), true)], { tier: 'R4', label: 'Review and decide' }),
  row('approval_pending', 'An R3 approval request for "release" has waited 41 min, and it expires in 3 h 19 min.', [member('approval', 'Publish release notes to the status page', 41 * MIN, 199 * MIN, 'R3', approvalEv('R3', 'release', 'an agent'), true)], { tier: 'R3', label: 'Review and decide' }),
  row('approval_pending', 'An R3 approval request for "change_external_setting" has waited 2 h 5 min, and it expires in 5 h.', [member('approval', 'Change the payment webhook URL', 125 * MIN, 300 * MIN, 'R3', approvalEv('R3', 'change_external_setting', 'an agent'), false)], { tier: 'R3', label: 'Review and decide', note: 'You made this request. Someone else must decide it.' }),
  row('approval_pending', '5 R2 approval requests on mission M-126 are waiting, the oldest for 3 h 10 min, and the soonest expires in 4 h 20 min.',
    [member('approval', 'Submit the vendor form', 190 * MIN, 260 * MIN, 'R2', approvalEv('R2', 'submit_form', 'an agent')), member('approval', 'Submit the tax form', 150 * MIN, 300 * MIN, 'R2', approvalEv('R2', 'submit_form', 'an agent')),
      member('approval', 'Submit the contact form', 90 * MIN, 420 * MIN, 'R2', approvalEv('R2', 'submit_form', 'an agent')), member('approval', 'Submit the survey', 60 * MIN, 480 * MIN, 'R2', approvalEv('R2', 'submit_form', 'an agent')), member('approval', 'Submit the quote request', 20 * MIN, 540 * MIN, 'R2', approvalEv('R2', 'submit_form', 'an agent'))],
    { tier: 'R2', groupedBy: 'mission:M-126 tier:R2', label: 'Review and decide' }),
  row('org_proposal_expiring', 'Organisation proposal OP-41c9 is undecided and expires in 5 h 30 min.', [member('org', 'Move QA under Engineering', 18 * H, 330 * MIN, null, ev('Compare the revision this proposal was made on (7) with the active revision (7): they match, so it can still be applied. Open the proposal and read the dry-run report.', [['Made on revision', '7'], ['Active revision', '7'], ['Expires in', '5 h 30 min'], ['Proposal', 'OP-41c9']]), true, '/agents?tab=proposals')], { label: 'Open the proposal' }),
  row('version_proposal_expiring', 'Version proposal VP-b210 for agent coder-01 is undecided and expires in 9 h.', [member('version', 'Try a newer model for Coder-01', 30 * H, 9 * H, null, ev('Check that the version this proposal was made against is still the active version of coder-01: it is not, so it can only be rejected or withdrawn. Open the proposal and read the evaluation evidence before promoting it.', [['Made against the active version', 'no'], ['Expires in', '9 h'], ['Agent', 'coder-01'], ['Proposal', 'VP-b210']]), false, '/agents?tab=proposals')], { label: 'Open the proposal', note: 'You made this proposal. Another administrator must decide it; you can withdraw it.' }),
  row('review_stale', '4 reviewed tasks on mission M-126 have a later attempt than the one that was reviewed.',
    [member('review', 'Migrate the header', 7 * H, null, null, stale(1, 2, '7 h'), true, '/missions/M-126?tab=task-flow'), member('review', 'Migrate the footer', 5 * H, null, null, stale(1, 2, '5 h'), true, '/missions/M-126?tab=task-flow'),
      member('review', 'Migrate the cart', 3 * H, null, null, stale(2, 3, '3 h'), true, '/missions/M-126?tab=task-flow'), member('review', 'Migrate the search', 1 * H, null, null, stale(1, 2, '1 h'), true, '/missions/M-126?tab=task-flow')],
    { groupedBy: 'mission:M-126', label: 'Review the latest attempt' }),
  row('task_waiting_person', 'Task T-12507 has been waiting for a person for 31 h, past the expected 24 h.', [member('waiting', 'Confirm the brand colour', 31 * H, null, null, wait('31 h'), true, '/missions/M-129?tab=task-flow')], { label: 'Open the task' }),
  row('failure_no_detection', '12 confirmed FM-3.2 (No or incomplete verification) failures have no recorded detection channel.',
    [...Array(12)].map((_, i) => member('failure', 'No or incomplete verification', (26 - i) * H, null, null, fail('FM-3.2', 'No or incomplete verification'), true, '/missions/M-126?tab=task-flow')),
    { groupedBy: 'mode:FM-3.2', label: 'Add the detection channel' }),
  row('failure_no_detection', 'A confirmed FM-1.3 (Step repetition) failure has no recorded detection channel.', [member('failure', 'Step repetition', 20 * H, null, null, fail('FM-1.3', 'Step repetition'), true, '/missions/M-129?tab=task-flow')], { label: 'Add the detection channel' }),
  row('lesson_system_derived', 'The system opened 1 candidate lesson for agent tester-01 after FM-3.2 recurred, and it has waited 6 h for review.',
    [member('lesson', 'System-derived from tool records: FM-3.2 on 6 failed tasks in 3 departments', 6 * H, null, null, ev('Open the failures behind this candidate and check that they share a cause; the system opened it from stored tags, so no person has yet judged it. Read the cited sources before accepting.', [['Written by', 'the system, from tool records (failure pattern)'], ['Pattern', '6 failures of FM-3.2 in 3 departments'], ['Sources cited', '6'], ['Agent', 'tester-01'], ['Waiting for', '6 h']]), true, '/agents/tester-01?tab=memory')], { label: 'Review the lesson' }),
  row('lesson_awaiting_review', 'A candidate lesson for agent coder-01 has waited 2 days 4 h for review.', [member('lesson', 'Prefer role locators over css selectors', 52 * H, null, null, ev('Read the 2 cited sources, not only the lesson text, and look for a conflict with the agent\'s current playbook before accepting.', [['Sources cited', '2'], ['Written by', 'human (human_entry)'], ['Agent', 'coder-01'], ['Waiting for', '2 days 4 h']]), true, '/agents/coder-01?tab=memory')], { label: 'Review the lesson' }),
  row('org_proposal_expiring', 'Organisation proposal OP-5e07 is undecided and expires in 41 h.', [member('org', 'Add a Security lead', 6 * H, 41 * H, null, ev('Compare the revision this proposal was made on (6) with the active revision (7): they differ, so it can no longer be applied and can only be rejected or withdrawn. Open the proposal and read the dry-run report.', [['Made on revision', '6'], ['Active revision', '7'], ['Expires in', '41 h'], ['Proposal', 'OP-5e07']]), true, '/agents?tab=proposals')], { label: 'Open the proposal' }),
  row('review_stale', 'The review of task T-12544 judged attempt 1, and attempt 2 started later.', [member('review', 'Write the release summary', 40 * MIN, null, null, stale(1, 2, '40 min'), true, '/missions/M-129?tab=task-flow')], { label: 'Review the latest attempt' }),
];

/** the fixed order (tier, soonest expiry, longest wait, id), the same rule the server applies */
const band = (t: string | null) => (t === null ? 15 : ({ R2: 20, R3: 30, R4: 40 } as Record<string, number>)[t] ?? 40);
const rows = [...unranked].sort((a, b) => band(b.tier) - band(a.tier) || (a.expiresInSec ?? 1e12) - (b.expiresInSec ?? 1e12) || b.ageSec - a.ageSec || (a.id < b.id ? -1 : 1));

export const ATTENTION_DEMO: AttentionDto = {
  rows,
  totals: { items: rows.reduce((s, r) => s + r.count, 0), rows: rows.length, collapsed: rows.reduce((s, r) => s + r.count, 0) - rows.length },
  settings: { ...ATTENTION_SETTINGS }, ranking: ATTENTION_RANKING_TEXT, checkedAt: '2026-11-22T12:00:00.000Z',
};
