import { ApiError, badRequest } from '../errors.ts';
import { MISSION_STATUSES, USER_ACTIONS, SYSTEM_ACTIONS, toUiStatus, type MissionStatus, type MissionAction } from '../../../shared/contracts/src/index.ts';

export { MISSION_STATUSES, USER_ACTIONS, SYSTEM_ACTIONS, toUiStatus };
export type { MissionStatus, MissionAction };

/** Spec §10.6. Pause is allowed from every active state; resume goes back to running. */
const EDGES: Record<MissionStatus, Partial<Record<MissionAction, MissionStatus>>> = {
  draft: { submit: 'queued', cancel: 'canceled' },
  queued: { plan: 'planning', cancel: 'canceled' },
  planning: { start: 'running', pause: 'paused', cancel: 'canceled', fail: 'failed' },
  running: { verify: 'verifying', requestApproval: 'waiting_approval', pause: 'paused', cancel: 'canceled', fail: 'failed' },
  waiting_approval: { approvalDone: 'running', pause: 'paused', cancel: 'canceled', fail: 'failed' },
  verifying: { complete: 'completed', pause: 'paused', cancel: 'canceled', fail: 'failed' },
  paused: { resume: 'running', cancel: 'canceled' },
  failed: { retry: 'retry_queued', archive: 'archived' },
  retry_queued: { start: 'running', cancel: 'canceled' },
  completed: { archive: 'archived' },
  canceled: { archive: 'archived' },
  archived: {},
};
const ARCHIVABLE: MissionStatus[] = ['completed', 'canceled', 'failed'];

export function transition(from: MissionStatus, action: MissionAction, ctx: { preArchive?: MissionStatus } = {}): MissionStatus {
  if (from === 'archived' && action === 'restore') {
    if (ctx.preArchive && ARCHIVABLE.includes(ctx.preArchive)) return ctx.preArchive;
    throw new ApiError('ILLEGAL_TRANSITION', 409, 'This mission has no state to restore to.');
  }
  const to = EDGES[from]?.[action];
  if (!to) throw new ApiError('ILLEGAL_TRANSITION', 409, `A ${toUiStatus(from)} mission can't ${action}.`);
  return to;
}

/** Dependencies are [task, dependsOn]; a cycle (or self-dependency) is rejected before insert. */
export function assertAcyclic(edges: [string, string][]) {
  const g = new Map<string, string[]>();
  for (const [a, b] of edges) { if (a === b) throw badRequest('A task cannot depend on itself.'); g.set(a, [...(g.get(a) ?? []), b]); }
  const state = new Map<string, 1 | 2>();
  const visit = (n: string) => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) throw badRequest('Task dependencies form a cycle.');
    state.set(n, 1);
    for (const m of g.get(n) ?? []) visit(m);
    state.set(n, 2);
  };
  for (const n of g.keys()) visit(n);
}
