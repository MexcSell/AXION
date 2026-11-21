/** Task contracts (spec §10.6 Task). */
export const TASK_STATUSES = ['created', 'ready', 'running', 'waiting_agent', 'waiting_user', 'verifying', 'passed', 'failed', 'retry_ready', 'canceled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The only task actions people may ask for. */
export const USER_TASK_ACTIONS = ['retry', 'reassign', 'cancel'] as const;
/** Server-only task actions (the execution engine of a later stage). */
export const SYSTEM_TASK_ACTIONS = ['ready', 'start', 'verify', 'pass', 'fail', 'waitAgent', 'waitUser', 'resume', 'requeue'] as const;
export type UserTaskAction = (typeof USER_TASK_ACTIONS)[number];
export type SystemTaskAction = (typeof SYSTEM_TASK_ACTIONS)[number];
export type TaskAction = UserTaskAction | SystemTaskAction;

export interface ReassignTaskBody { toInstanceId: string; reason?: string }
