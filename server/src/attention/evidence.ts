import type { AttentionAction, AttentionEvidence, AttentionFact, AttentionReasonCode } from '../../../shared/contracts/src/index.ts';
import { ATTENTION_SETTINGS } from '../../../shared/contracts/src/index.ts';
import { duration } from './why.ts';
import type { Fact } from './types.ts';

/**
 * The third level of a row: the check that would expose a defect in the item, and the stored facts to run it against.
 * It is not a summary and it never says the item is fine. Templated over enums, numbers, ids and digests; no model text, and no
 * agent- or person-written text (a title, a detail, a note) goes in, with one exception: an approval's `origin` and `target` are free text the
 * requesting agent supplied. GET /approvals already returns both to the same viewers, so they leak nothing; here they are labelled "as the agent
 * stated it", cut to 200 characters, shown only as fact values (never in a sentence or a check) and rendered as plain text.
 */
const s = (f: Record<string, Fact>, k: string) => String(f[k] ?? '');
const n = (f: Record<string, Fact>, k: string) => Number(f[k] ?? 0);
const rec = (v: Fact) => (v === null || v === undefined || v === '' ? 'not recorded' : String(v));
/** free text is cut to 200 characters; the full text is in the approval itself */
const cap = (v: string) => (v.length > 200 ? v.slice(0, 199) + '…' : v);
const fact = (label: string, value: Fact | undefined): AttentionFact => ({ label, value: value === null || value === undefined ? '' : String(value) });

export function evidenceOf(reason: AttentionReasonCode, f: Record<string, Fact>): AttentionEvidence {
  switch (reason) {
    case 'approval_pending': {
      const same = s(f, 'boundDigest') === s(f, 'recomputedDigest');
      return {
        check: `Compare the bound digest with the digest the server recomputes from the stored action: they ${same ? 'match' : 'DIFFER, so do not approve'}. Then read the three Rule of Two flags, and confirm the tier ${s(f, 'tier')} fits what "${s(f, 'kind')}" does.`,
        facts: [fact('Bound digest', f.boundDigest), fact('Recomputed digest', f.recomputedDigest), fact('Digest version', f.digestVersion), fact('Tier', `${s(f, 'tier')}, decided by ${s(f, 'approver') === 'user' ? 'any person except the requester' : 'an administrator'}`),
          fact('Action', f.kind), fact('Origin (as the agent stated it)', cap(rec(f.origin))), fact('Target (as the agent stated it)', cap(rec(f.target))), fact('Requested by', f.requestedByKind),
          fact('Reads untrusted input', f.flagUntrusted), fact('Reaches live systems or credentials', f.flagSensitive), fact('Can change state or communicate externally', f.flagChange), fact('Rule of Two fired', f.ruleFired)],
      };
    }
    case 'review_stale':
      return {
        check: `Open the task and check which attempt the review judged: it judged attempt ${n(f, 'reviewedAttempt')}, and attempt ${n(f, 'latestAttempt')} started later, so the old review does not count for the new attempt.`,
        facts: [fact('Attempt that was reviewed', f.reviewedAttempt), fact('Latest attempt', f.latestAttempt), fact('Verdict of that review', f.verdict), fact('Stale for', duration(n(f, 'ageSec'))),
          fact('Freshness rule', 'A review counts only for the attempt it judged, and only if it was written after that attempt started.')],
      };
    case 'task_waiting_person':
      return {
        check: `Open the task and look for what it is waiting on. It has had no change of state for ${duration(n(f, 'ageSec'))}; ask whether the person it needs knows.`,
        facts: [fact('Waiting for', duration(n(f, 'ageSec'))), fact('Waiting measured from', s(f, 'since') === 'state change' ? 'the last change of state' : 'the task\'s creation (no state-change event is stored)'),
          fact('Expected time', `${ATTENTION_SETTINGS.waitingHours} h`), fact('Task', f.taskId)],
      };
    case 'failure_no_detection':
      return {
        check: `Ask how this ${s(f, 'modeId')} failure was found. No detection channel is recorded, so it is unknown whether a test, an audit or a person caught it. A decided tag cannot be changed, so record the channel when you tag failures like it from now on.`,
        facts: [fact('Failure mode', `${s(f, 'modeId')} ${s(f, 'modeName')}`), fact('Detection channel', 'not recorded'), fact('Mechanism', rec(f.mechanism)), fact('Control expected', rec(f.controlExpected)), fact('Control caught', rec(f.controlCaught)),
          fact('Confirmed by the tagger', f.selfConfirmed), fact('Subject', `${s(f, 'subjectKind')} ${s(f, 'subjectId')}`)],
      };
    case 'org_proposal_expiring': {
      const stale = f.activeRevision !== null && f.activeRevision !== undefined && Number(f.activeRevision) !== Number(f.baseRevision);
      return {
        check: `Compare the revision this proposal was made on (${s(f, 'baseRevision')}) with the active revision (${rec(f.activeRevision)}): ${stale ? 'they differ, so it can no longer be applied and can only be rejected or withdrawn' : 'they match, so it can still be applied'}. Open the proposal and read the dry-run report.`,
        facts: [fact('Made on revision', f.baseRevision), fact('Active revision', rec(f.activeRevision)), fact('Expires in', duration(n(f, 'expiresInSec'))), fact('Proposal', f.proposalId)],
      };
    }
    case 'version_proposal_expiring':
      return {
        check: `Check that the version this proposal was made against is still the active version of ${s(f, 'agentId')}: ${s(f, 'baseIsActive') === 'yes' ? 'it is' : 'it is not, so it can only be rejected or withdrawn'}. Open the proposal and read the evaluation evidence before promoting it.`,
        facts: [fact('Made against the active version', f.baseIsActive), fact('Expires in', duration(n(f, 'expiresInSec'))), fact('Agent', f.agentId), fact('Proposal', f.proposalId)],
      };
    case 'lesson_awaiting_review':
      return {
        check: `Read the ${n(f, 'sources')} cited source${n(f, 'sources') === 1 ? '' : 's'}, not only the lesson text, and look for a conflict with the agent's current playbook before accepting.`,
        facts: [fact('Sources cited', f.sources), fact('Written by', `${s(f, 'originClass')} (${s(f, 'originChannel')})`), fact('Agent', f.agentId), fact('Waiting for', duration(n(f, 'ageSec')))],
      };
    case 'lesson_system_derived':
      return {
        check: `Open the failures behind this candidate and check that they share a cause; the system opened it from stored tags, so no person has yet judged it. Read the cited sources before accepting.`,
        facts: [fact('Written by', 'the system, from tool records (failure pattern)'), fact('Pattern', `${n(f, 'failures')} failures of ${s(f, 'modeId')} in ${n(f, 'departments')} departments`), fact('Sources cited', f.sources), fact('Agent', f.agentId), fact('Waiting for', duration(n(f, 'ageSec')))],
      };
  }
}

const LABELS: Record<AttentionReasonCode, string> = {
  approval_pending: 'Review and decide', review_stale: 'Review the latest attempt', task_waiting_person: 'Open the task', failure_no_detection: 'Open the task',
  org_proposal_expiring: 'Open the proposal', version_proposal_expiring: 'Open the proposal', lesson_awaiting_review: 'Review the lesson', lesson_system_derived: 'Review the lesson',
};
export const actionOf = (reason: AttentionReasonCode, o: { canAct: boolean; note: string | null; route: string }): AttentionAction => ({ label: LABELS[reason], route: o.route, canAct: o.canAct, note: o.canAct ? null : o.note });
