/** Mission contracts (spec §10.6 as amended by u1: no budgets). */
export const MISSION_STATUSES = ['draft', 'queued', 'planning', 'running', 'waiting_approval', 'verifying', 'paused', 'completed', 'failed', 'retry_queued', 'canceled', 'archived'] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

/** The only actions people may ask for. */
export const USER_ACTIONS = ['start', 'pause', 'resume', 'cancel', 'retry', 'archive', 'restore'] as const;
/** Server-only actions (Stage 5: only the staffing simulation uses them). */
export const SYSTEM_ACTIONS = ['submit', 'plan', 'requestApproval', 'approvalDone', 'verify', 'complete', 'fail'] as const;
export type UserAction = (typeof USER_ACTIONS)[number];
export type SystemAction = (typeof SYSTEM_ACTIONS)[number];
export type MissionAction = UserAction | SystemAction;

/** The UI's status vocabulary (web/src/data/types.ts). */
export type UiMissionStatus = 'draft' | 'queued' | 'planning' | 'running' | 'verifying' | 'waiting' | 'paused' | 'completed' | 'failed' | 'canceled' | 'archived';
export function toUiStatus(s: MissionStatus): UiMissionStatus {
  if (s === 'waiting_approval') return 'waiting';
  if (s === 'retry_queued') return 'queued';
  return s;
}

/** Which user action a UI status change means (setMissionStatus in the web store). */
export function actionForUiStatus(from: UiMissionStatus, to: UiMissionStatus): UserAction | null {
  if (to === 'paused') return 'pause';
  if (to === 'canceled') return 'cancel';
  if (to === 'archived') return 'archive';
  if (to === 'running') return from === 'paused' ? 'resume' : from === 'failed' ? 'retry' : 'start';
  if (to === 'queued' && from === 'failed') return 'retry';
  return null;
}

export interface MissionFileDto { id: string; name: string; kind: 'image' | 'audio' | 'video' | 'doc' | 'pdf' | 'txt' | 'file'; size: number; mime: string; url?: string; excerpt?: string }
export interface CreateMissionBody { text: string; files: string[]; shared: boolean }
export interface UpdateMissionBody { title?: string; kind?: string; priority?: 'low' | 'normal' | 'high' | 'critical'; text?: string; criteria?: { text: string; done: boolean }[] }
