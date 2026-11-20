import { createHash, randomBytes } from 'node:crypto';
import type { Tx } from '../db.ts';
import { emit } from '../events/hooks.ts';

export type RiskTier = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
export const RISK_UI: Record<RiskTier, 'low' | 'medium' | 'high' | 'critical'> = { R0: 'low', R1: 'low', R2: 'medium', R3: 'high', R4: 'critical' };
export const TIER_OF: Record<string, RiskTier> = { low: 'R1', medium: 'R2', high: 'R3', critical: 'R4' };

/** Canonical JSON: keys sorted at every level, so the digest doesn't depend on key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
export const digestOf = (missionId: string, kind: string, payload: unknown) => createHash('sha256').update(canonical({ missionId, kind, payload })).digest('hex');

export interface ApprovalInput { tenantId: string; missionId: string; agentId: string; kind: string; title: string; detail: string; risk: RiskTier; payload: Record<string, unknown>; expiresInMin: number; id?: string; demo?: boolean; createdAgoMin?: number }

/** Server-side producer (Stage 5: only the demo seed; real agents arrive in Stage 7). */
export async function requestApproval(c: Tx, a: ApprovalInput) {
  const id = a.id ?? 'APR-' + randomBytes(5).toString('hex');
  const digest = digestOf(a.missionId, a.kind, a.payload);
  await c.query(
    `insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, detail, risk, payload, action_digest, demo, created_at, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() - make_interval(mins => $12), now() + make_interval(mins => $13))`,
    [id, a.tenantId, a.missionId, a.agentId, a.kind, a.title, a.detail, a.risk, JSON.stringify(a.payload), digest, a.demo ?? false, a.createdAgoMin ?? 0, a.expiresInMin]);
  await emit(c, { tenantId: a.tenantId, type: 'approval.requested', subject: a.missionId, missionId: a.missionId, actor: a.agentId, actorKind: 'agent', payload: { approvalId: id, kind: a.kind, risk: a.risk } });
  return { id, digest };
}

export function approvalDto(r: any, now = Date.now()) {
  const expired = r.state === 'pending' && new Date(r.expires_at).getTime() < now;
  const state = expired ? 'expired' : r.state;
  return {
    id: r.id, missionId: r.mission_id, agentId: r.agent_id, title: r.title, detail: r.detail, kind: r.kind,
    risk: RISK_UI[r.risk as RiskTier], riskTier: r.risk, digest: r.action_digest, demo: r.demo,
    status: state === 'approved' || state === 'denied' ? state : 'pending', state,
    expiresMin: Math.max(0, Math.round((new Date(r.expires_at).getTime() - now) / 60000)),
    agoMin: Math.max(0, Math.round((now - new Date(r.created_at).getTime()) / 60000)),
    expiresAt: new Date(r.expires_at).getTime(),
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
