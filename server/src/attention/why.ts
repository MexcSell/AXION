import type { AttentionReasonCode } from '../../../shared/contracts/src/index.ts';
import { ATTENTION_SETTINGS } from '../../../shared/contracts/src/index.ts';
import type { Fact } from './types.ts';

/** "5 min", "2 h 10 min", "3 days 4 h". Whole units, two at most. */
export function duration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return 'under a minute';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} days ${h % 24} h` : `${d} days`;
}

const s = (f: Record<string, Fact>, k: string) => String(f[k] ?? '');
const n = (f: Record<string, Fact>, k: string) => Number(f[k] ?? 0);
const exp = (f: Record<string, Fact>) => (f.expiresInSec === null || f.expiresInSec === undefined ? '' : `, and it expires in ${duration(n(f, 'expiresInSec'))}`);

/**
 * The one sentence of a row, from a template over the reason code and stored facts. No model writes it and no free text goes in:
 * only enums, numbers and system ids. `count` is how many items the row stands for.
 */
export function whyOf(reason: AttentionReasonCode, f: Record<string, Fact>, count = 1): string {
  switch (reason) {
    case 'approval_pending':
      return count === 1
        ? `An ${s(f, 'tier')} approval request for "${s(f, 'kind')}" has waited ${duration(n(f, 'ageSec'))}${exp(f)}.`
        : `${count} ${s(f, 'tier')} approval requests on mission ${s(f, 'missionId')} are waiting, the oldest for ${duration(n(f, 'ageSec'))}${f.expiresInSec === null ? '' : `, and the soonest expires in ${duration(n(f, 'expiresInSec'))}`}.`;
    case 'review_stale':
      return count === 1
        ? `The review of task ${s(f, 'taskId')} judged attempt ${n(f, 'reviewedAttempt')}, and attempt ${n(f, 'latestAttempt')} started later.`
        : `${count} reviewed tasks on mission ${s(f, 'missionId')} have a later attempt than the one that was reviewed.`;
    case 'task_waiting_person':
      return count === 1
        ? `Task ${s(f, 'taskId')} has been waiting for a person for ${duration(n(f, 'ageSec'))}, past the expected ${ATTENTION_SETTINGS.waitingHours} h.`
        : `${count} tasks on mission ${s(f, 'missionId')} have waited for a person past the expected ${ATTENTION_SETTINGS.waitingHours} h, the longest for ${duration(n(f, 'ageSec'))}.`;
    case 'failure_no_detection':
      return count === 1
        ? `A confirmed ${s(f, 'modeId')} (${s(f, 'modeName')}) failure has no recorded detection channel.`
        : `${count} confirmed ${s(f, 'modeId')} (${s(f, 'modeName')}) failures have no recorded detection channel.`;
    case 'org_proposal_expiring':
      return `Organisation proposal ${s(f, 'proposalId')} is undecided and expires in ${duration(n(f, 'expiresInSec'))}.`;
    case 'version_proposal_expiring':
      return `Version proposal ${s(f, 'proposalId')} for agent ${s(f, 'agentId')} is undecided and expires in ${duration(n(f, 'expiresInSec'))}.`;
    case 'lesson_awaiting_review':
      return count === 1
        ? `A candidate lesson for agent ${s(f, 'agentId')} has waited ${duration(n(f, 'ageSec'))} for review.`
        : `${count} candidate lessons for agent ${s(f, 'agentId')} are waiting for review, the oldest for ${duration(n(f, 'ageSec'))}.`;
    case 'lesson_system_derived':
      return count === 1
        ? `The system opened a candidate lesson for agent ${s(f, 'agentId')} after ${s(f, 'modeId')} recurred, and it has waited ${duration(n(f, 'ageSec'))} for review.`
        : `The system opened ${count} candidate lessons for agent ${s(f, 'agentId')} after ${s(f, 'modeId')} recurred, the oldest waiting ${duration(n(f, 'ageSec'))}.`;
  }
}
