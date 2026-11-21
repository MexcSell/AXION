import { ApiError } from '../errors.ts';
import { TASK_STATUSES, USER_TASK_ACTIONS, SYSTEM_TASK_ACTIONS, type TaskStatus, type TaskAction } from '../../../shared/contracts/src/index.ts';

export { TASK_STATUSES, USER_TASK_ACTIONS, SYSTEM_TASK_ACTIONS };
export type { TaskStatus, TaskAction };

/**
 * Spec §10.6 Task: created → ready → running → verifying → passed; running ↔ waiting_agent / waiting_user;
 * running → failed → retry_ready → ready; every non-terminal state → canceled.
 * `reassign` keeps the state: it is refused while running (the owner is working) and on a finished task.
 */
const EDGES: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus>>> = {
  created: { ready: 'ready', reassign: 'created', cancel: 'canceled' },
  ready: { start: 'running', reassign: 'ready', cancel: 'canceled' },
  running: { verify: 'verifying', fail: 'failed', waitAgent: 'waiting_agent', waitUser: 'waiting_user', cancel: 'canceled' },
  waiting_agent: { resume: 'running', reassign: 'waiting_agent', cancel: 'canceled' },
  waiting_user: { resume: 'running', reassign: 'waiting_user', cancel: 'canceled' },
  verifying: { pass: 'passed', reassign: 'verifying', cancel: 'canceled' },
  failed: { retry: 'retry_ready', reassign: 'failed', cancel: 'canceled' },
  retry_ready: { requeue: 'ready', reassign: 'retry_ready', cancel: 'canceled' },
  passed: {},
  canceled: {},
};

const UI: Record<TaskStatus, string> = {
  created: 'queued', ready: 'ready', running: 'running', waiting_agent: 'waiting for an agent', waiting_user: 'waiting for you',
  verifying: 'verifying', passed: 'passed', failed: 'failed', retry_ready: 'queued for retry', canceled: 'canceled',
};

export function transitionTask(from: TaskStatus, action: TaskAction): TaskStatus {
  const to = EDGES[from]?.[action];
  if (!to) {
    const why = from === 'running' && (action === 'retry' || action === 'reassign') ? ` Wait until it stops, or cancel it first.` : '';
    throw new ApiError('ILLEGAL_TRANSITION', 409, `A task that is ${UI[from]} can't ${action}.${why}`);
  }
  return to;
}
