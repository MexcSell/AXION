import { createHash, randomBytes } from 'node:crypto';
import type { Tx } from '../db.ts';
import { emit } from '../events/hooks.ts';
import { ApiError, notFound } from '../errors.ts';
import { evaluate } from '../policy/evaluate.ts';
import { CURRENT_BASELINE, approverFor } from '../policy/baseline.ts';
import { isTier, tierRank, type RiskTier } from '../policy/types.ts';

export type { RiskTier };
export const RISK_UI: Record<RiskTier, 'low' | 'medium' | 'high' | 'critical'> = { R0: 'low', R1: 'low', R2: 'medium', R3: 'high', R4: 'critical' };

/** Canonical JSON: keys sorted at every level, so the digest doesn't depend on key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
export const digestOf = (missionId: string, kind: string, payload: unknown) => createHash('sha256').update(canonical({ missionId, kind, payload })).digest('hex');

/**
 * The one action an approval authorises (binding v2, spec invariant 7). Every field is part of the digest, so changing any
 * of them is a different action. Optional fields count as null when absent (an empty string is normalised to absent when the request is made).
 */
export interface BoundAction { tenantId: string; missionId: string; taskId?: string; kind: string; origin?: string; target?: string; payload: Record<string, unknown>; tier: RiskTier; requestedBy: string; expiresAt: string }
export const digestV2 = (a: BoundAction) => createHash('sha256').update(canonical({
  v: 2, tenantId: a.tenantId, missionId: a.missionId, taskId: a.taskId ?? null, kind: a.kind, origin: a.origin ?? null, target: a.target ?? null,
  payload: JSON.parse(JSON.stringify(a.payload)), tier: a.tier, requestedBy: a.requestedBy, expiresAt: a.expiresAt,
})).digest('hex');

/** The bound action as stored. Executors build theirs from what they are about to run; this is for tests and display. */
export function boundActionOf(r: any): BoundAction {
  return { tenantId: r.tenant_id, missionId: r.mission_id, ...(r.task_id ? { taskId: r.task_id } : {}), kind: r.kind, ...(r.origin ? { origin: r.origin } : {}), ...(r.target ? { target: r.target } : {}), payload: r.payload, tier: r.risk, requestedBy: r.requested_by ?? r.agent_id, expiresAt: new Date(r.expires_at).toISOString() };
}
/** Always recomputed here from the stored row, by the row's own digest version. A digest from a client is never an input. */
export const rowDigest = (r: any): string => (r.digest_version ?? 1) === 2 ? digestV2(boundActionOf(r)) : digestOf(r.mission_id, r.kind, r.payload);
export async function loadBoundAction(c: Tx, tenantId: string, approvalId: string): Promise<BoundAction> {
  const r = (await c.query('select * from approval_requests where id=$1 and tenant_id=$2', [approvalId, tenantId])).rows[0];
  if (!r) throw notFound('No such approval.');
  return boundActionOf(r);
}

export interface ApprovalInput { tenantId: string; missionId: string; agentId: string; kind: string; title: string; detail: string; payload: Record<string, unknown>; expiresInMin: number; id?: string; demo?: boolean; createdAgoMin?: number; taskId?: string; origin?: string; target?: string; requestedBy?: string }

/**
 * Server-side producer (Stage 5: only the demo seed; real agents arrive in Stage 7).
 * The risk tier is decided by the policy service from the request's kind; no caller supplies one (invariant 10).
 */
export async function requestApproval(c: Tx, a: ApprovalInput) {
  const requestedBy = a.requestedBy ?? a.agentId;
  // what is hashed is exactly what is stored: the JSON round-trip of the payload; '' means absent
  const payload = JSON.parse(JSON.stringify(a.payload)) as Record<string, unknown>;
  const taskId = a.taskId || undefined, origin = a.origin || undefined, target = a.target || undefined;
  a = { ...a, payload, taskId, origin, target };
  const d = evaluate({ kind: a.kind, requester: { id: requestedBy, kind: requestedBy === a.agentId ? 'agent' : 'user', role: requestedBy === a.agentId ? 'agent' : 'member' }, effect: 'read', payload: a.payload, missionId: a.missionId, target: a.target, origin: a.origin }, [], {}, Date.now());
  if (d.outcome === 'deny') throw new ApiError('POLICY_DENIED', 403, `Policy denies this action (${d.reasons.join(', ')}).`);
  const risk = d.tier;
  const id = a.id ?? 'APR-' + randomBytes(5).toString('hex');
  // timestamps are fixed here (millisecond precision) so the expiry the digest binds is exactly the stored one
  const createdAt = new Date(Date.now() - (a.createdAgoMin ?? 0) * 60_000);
  const expiresAt = new Date(Date.now() + a.expiresInMin * 60_000);
  const digest = digestV2({ tenantId: a.tenantId, missionId: a.missionId, taskId: a.taskId, kind: a.kind, origin: a.origin, target: a.target, payload: a.payload, tier: risk, requestedBy, expiresAt: expiresAt.toISOString() });
  await c.query(
    `insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, detail, risk, payload, action_digest, digest_version, task_id, origin, target, requested_by, demo, created_at, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2,$11,$12,$13,$14,$15,$16,$17)`,
    [id, a.tenantId, a.missionId, a.agentId, a.kind, a.title, a.detail, risk, JSON.stringify(a.payload), digest, a.taskId ?? null, a.origin ?? null, a.target ?? null, requestedBy, a.demo ?? false, createdAt, expiresAt]);
  await emit(c, { tenantId: a.tenantId, type: 'approval.requested', subject: a.missionId, missionId: a.missionId, actor: a.agentId, actorKind: 'agent', payload: { approvalId: id, kind: a.kind, risk, policyVersion: d.policyVersion, reasons: d.reasons } });
  return { id, digest };
}

const kindRule = (k: string) => (CURRENT_BASELINE.kinds as Record<string, { effect: string; why: string }>)[k];

export type DecideBlockedReason = 'tier_requires_admin' | 'requester_cannot_decide' | 'already_decided' | 'expired';
export interface Decider { id: string; role: string }
/**
 * The one place that decides whether this user may decide this request. The decision route throws from it and the DTO
 * reports it (canDecide), so the UI can never disagree with the server. Order matters and is the route's order:
 * policy tier, self-approval, already decided, expired. (A stale digest depends on what the client saw, so it is not here.)
 */
export function decideRefusal(r: any, user: Decider, now = Date.now()): { reason: DecideBlockedReason; code: 'POLICY_DENIED' | 'SELF_APPROVAL' | 'APPROVAL_ALREADY_DECIDED' | 'APPROVAL_STALE'; status: number; message: string } | null {
  const need = isTier(r.risk) ? approverFor(r.risk) : 'owner'; // an unreadable tier fails closed
  if ((need === 'admin' || need === 'owner') && user.role !== 'admin') return { reason: 'tier_requires_admin', code: 'POLICY_DENIED', status: 403, message: `Policy: a ${r.risk} request can only be decided by an administrator.` };
  if (r.requested_by && r.requested_by === user.id && isTier(r.risk) && tierRank(r.risk) >= tierRank('R2')) return { reason: 'requester_cannot_decide', code: 'SELF_APPROVAL', status: 403, message: 'You made this request. Someone else must decide it.' };
  if (r.state === 'approved' || r.state === 'denied') return { reason: 'already_decided', code: 'APPROVAL_ALREADY_DECIDED', status: 409, message: 'Someone already decided this request.' };
  if (r.state !== 'pending' || new Date(r.expires_at).getTime() < now) return { reason: 'expired', code: 'APPROVAL_STALE', status: 409, message: 'This request expired. The agent must ask again.' };
  return null;
}

export function approvalDto(r: any, now = Date.now(), viewer?: Decider) {
  const refusal = viewer ? decideRefusal(r, viewer, now) : null;
  const expired = r.state === 'pending' && new Date(r.expires_at).getTime() < now;
  const state = expired ? 'expired' : r.state;
  return {
    id: r.id, missionId: r.mission_id, agentId: r.agent_id, title: r.title, detail: r.detail, kind: r.kind,
    risk: RISK_UI[r.risk as RiskTier], riskTier: r.risk, digest: r.action_digest, digestVersion: r.digest_version ?? 1, demo: r.demo,
    taskId: r.task_id ?? null, origin: r.origin ?? null, target: r.target ?? null, requestedBy: r.requested_by ?? null,
    effect: kindRule(r.kind)?.effect ?? null, effectWhy: kindRule(r.kind)?.why ?? null, approver: isTier(r.risk) ? approverFor(r.risk) : 'owner',
    consumed: !!r.consumed_at, consumedAt: r.consumed_at ? new Date(r.consumed_at).getTime() : null,
    status: state === 'approved' || state === 'denied' ? state : 'pending', state,
    expiresMin: Math.max(0, Math.round((new Date(r.expires_at).getTime() - now) / 60000)),
    agoMin: Math.max(0, Math.round((now - new Date(r.created_at).getTime()) / 60000)),
    expiresAt: new Date(r.expires_at).getTime(),
    canDecide: !!viewer && !refusal, decideBlockedReason: viewer ? (refusal?.reason ?? null) : 'tier_requires_admin',
    decidedByName: (state === 'approved' || state === 'denied') ? (r.decided_by_name ?? null) : null,
  };
}

/**
 * Keep a mission's pending count current; the last decided or expired approval releases a waiting mission
 * (system action approvalDone). Returns true when the mission moved to running.
 */
export async function settleMission(c: Tx, tenantId: string, missionId: string, correlationId = ''): Promise<boolean> {
  const m = (await c.query('select status from missions where id=$1 and tenant_id=$2 for update', [missionId, tenantId])).rows[0];
  if (!m) return false;
  const left = Number((await c.query(`select count(*) from approval_requests where mission_id=$1 and state='pending' and expires_at > now()`, [missionId])).rows[0].count);
  await c.query(`update missions set presentation = presentation || jsonb_build_object('pendingApprovals', $2::int), row_version=row_version+1, updated_at=now() where id=$1`, [missionId, left]);
  if (left === 0 && m.status === 'waiting_approval') {
    const s = await c.query(`update missions set status='running' where id=$1 and status='waiting_approval' returning id`, [missionId]);
    if (s.rowCount) {
      await emit(c, { tenantId, correlationId, type: 'mission.stateChanged', subject: missionId, missionId, payload: { from: 'waiting_approval', to: 'running', action: 'approvalDone', by: 'system' } });
      return true;
    }
  }
  return false;
}

/** Review I4: pending approvals past their expiry become 'expired' and their missions are settled. */
export async function sweepExpired(c: Tx, tenantId?: string): Promise<string[]> {
  const rows = (await c.query(
    `update approval_requests set state='expired' where state='pending' and expires_at <= now() ${tenantId ? 'and tenant_id=$1' : ''} returning id, mission_id, tenant_id`,
    tenantId ? [tenantId] : [])).rows;
  const released: string[] = [];
  for (const mid of [...new Set(rows.map((r) => `${r.tenant_id}|${r.mission_id}`))]) {
    const [t, m] = mid.split('|');
    if (await settleMission(c, t, m, 'expiry')) released.push(m);
  }
  for (const r of rows) await emit(c, { tenantId: r.tenant_id, type: 'approval.decided', subject: r.mission_id, missionId: r.mission_id, payload: { approvalId: r.id, decision: 'expired', by: 'system' } });
  return released;
}


export interface ConsumeInput { approvalId: string; action: BoundAction; /** who is executing (an agent or service id) */ by: string; /** test clock; without it expiry is judged by the database clock, the same as the sweep */ now?: number }

/**
 * Spend an approval: it authorises exactly one execution of exactly this action. Nothing here executes anything; a future
 * executor calls it right before it acts and acts only when it returns. The row is locked, the digest is recomputed from
 * the presented action (never taken from a caller), and consumed_at/consumed_by are written once (the trigger enforces it).
 */
export async function consumeApproval(c: Tx, i: ConsumeInput): Promise<{ approvalId: string; consumedAt: number }> {
  const r = (await c.query('select *, (expires_at <= now()) as db_expired from approval_requests where id=$1 and tenant_id=$2 for update', [i.approvalId, i.action.tenantId])).rows[0];
  if (!r) throw notFound('No such approval.');
  if (r.consumed_at) throw new ApiError('APPROVAL_ALREADY_CONSUMED', 409, 'This approval was already used. The agent must ask again.');
  if (r.state !== 'approved') throw new ApiError('APPROVAL_NOT_APPROVED', 409, 'This request is not approved.');
  if (i.now !== undefined ? new Date(r.expires_at).getTime() <= i.now : r.db_expired) throw new ApiError('APPROVAL_EXPIRED', 409, 'This approval expired. The agent must ask again.');
  const presented = (r.digest_version ?? 1) === 2 ? digestV2(i.action) : digestOf(i.action.missionId, i.action.kind, i.action.payload);
  if (presented !== rowDigest(r) || presented !== r.action_digest) throw new ApiError('APPROVAL_DIGEST_MISMATCH', 409, 'The action differs from the one that was approved.');
  const u = await c.query(`update approval_requests set consumed_at=now(), consumed_by=$2 where id=$1 and consumed_at is null and state='approved' returning consumed_at`, [i.approvalId, i.by]);
  if (!u.rowCount) throw new ApiError('APPROVAL_ALREADY_CONSUMED', 409, 'This approval was already used. The agent must ask again.');
  await emit(c, { tenantId: r.tenant_id, type: 'approval.consumed', subject: r.mission_id, missionId: r.mission_id, actor: i.by, actorKind: 'agent', payload: { approvalId: r.id, kind: r.kind, tier: r.risk, by: i.by } });
  return { approvalId: r.id, consumedAt: new Date(u.rows[0].consumed_at).getTime() };
}
