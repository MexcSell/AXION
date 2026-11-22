// Site grants: the source of truth that feeds P1's evaluate(). Absent, expired and revoked grants deny (spec §11 site_grants).
import { randomBytes } from 'node:crypto';
import type { Db, Tx } from '../db.ts';
import { ApiError } from '../errors.ts';
import { evaluate, CURRENT_BASELINE, tierRank, type Action, type Decision, type Grant } from '../policy/index.ts';
import { normaliseOrigin, REFUSAL_TEXT, type OriginResult } from './origin.ts';

export const MAX_GRANT_MS = 30 * 24 * 3600 * 1000;
/** Only low-risk kinds can be pre-granted for a site. R2 and above are decided per action, never by a standing grant. */
export const GRANTABLE = ['read', 'screenshot', 'summarize', 'fill_draft'] as const;
export type Grantable = (typeof GRANTABLE)[number];
export const isGrantable = (k: unknown): k is Grantable => typeof k === 'string' && (GRANTABLE as readonly string[]).includes(k);
// the allowed list must stay inside R0/R1 of the baseline; checked at load so a baseline edit cannot silently widen it
for (const k of GRANTABLE) if (!CURRENT_BASELINE.kinds[k] || tierRank(CURRENT_BASELINE.kinds[k].tier) > 1) throw new Error(`site grant capability ${k} must be an R0/R1 kind`);

export interface IssueInput { tenantId: string; missionId: string; origin: string; capabilities: readonly string[]; expiresAt: Date; issuedBy: string; now?: Date }
export interface IssueRequester { id: string; role: string }

/** The service stores only normalised origins: the normaliser is the one gate, and this is the second check below it. */
export function assertNormal(origin: string): string {
  const r = normaliseOrigin(origin);
  if (!r.ok || r.origin !== origin) throw new ApiError('VALIDATION', 422, 'The origin is not in its exact normal form.', { fieldErrors: { origin: r.ok ? `Use ${r.origin}` : REFUSAL_TEXT[r.reason] } });
  return origin;
}

export const checkOrigin = (input: unknown): { ok: boolean; origin?: string; reason?: string; message?: string } => {
  const r: OriginResult = normaliseOrigin(input);
  return r.ok ? { ok: true, origin: r.origin } : { ok: false, reason: r.reason, message: REFUSAL_TEXT[r.reason] };
};

/** A grant is an R3 action: it goes through evaluate() with kind origin-grant. Returns the decision; the caller refuses a deny. */
export function decideGrant(origin: string, missionId: string, requester: { id: string; role: string }, now: number): Decision {
  const action: Action = { kind: 'origin-grant', origin, missionId, requester: { id: requester.id, kind: 'user', role: requester.role }, effect: 'infra', payload: { origin } };
  return evaluate(action, [], {}, now);
}

export const newGrantId = () => 'SG-' + randomBytes(16).toString('hex').toUpperCase();

/**
 * Real grants for evaluate(). Rows of this tenant and mission only. Revoked rows are never loaded (a revoked grant denies as
 * no_grant, whatever the app clock says: revocation is read as a fact, not compared with a time). Expired rows are kept so
 * evaluate() reports grant_expired. The grant covers any agent STAFFED on the mission: if the subject has no live instance on
 * this mission, or the mission is deleted, nothing is returned.
 */
export async function loadGrants(db: Db | Tx, tenantId: string, missionId: string, _now: number, subjectId: string): Promise<Grant[]> {
  const rows = (await db.query(
    `select g.id, g.exact_origin, g.capabilities, g.expires_at from site_grants g
      join missions m on m.id = g.mission_id and m.deleted_at is null
     where g.tenant_id=$1 and g.mission_id=$2 and g.revoked_at is null
       and exists (select 1 from agent_instances i where i.tenant_id=$1 and i.mission_id=$2 and i.agent_id=$3 and i.ended_at is null)`,
    [tenantId, missionId, subjectId])).rows;
  return rows.map((r) => ({ id: r.id, subjectId, kinds: [...r.capabilities], target: r.exact_origin, missionId, expiresAt: new Date(r.expires_at).getTime() }));
}

/**
 * Decide one action on a raw origin string using the stored grants. The origin is normalised first; one that cannot be
 * normalised is denied (nothing can be granted for it) and the refusal reason is returned for the caller to show.
 */
export async function decideOnOrigin(db: Db | Tx, a: { tenantId: string; missionId: string; kind: string; effect: Action['effect']; rawOrigin: unknown; requester: Action['requester']; payload?: Record<string, unknown> }, now: number): Promise<{ decision: Decision; refusal?: string }> {
  const n = normaliseOrigin(a.rawOrigin);
  if (!n.ok) return { decision: { outcome: 'deny', tier: 'R4', approver: null, reasons: ['no_grant'], policyVersion: CURRENT_BASELINE.version }, refusal: n.reason };
  const grants = await loadGrants(db, a.tenantId, a.missionId, now, a.requester.id);
  const decision = evaluate({ kind: a.kind, origin: n.origin, missionId: a.missionId, requester: a.requester, effect: a.effect, payload: a.payload ?? {} }, grants, {}, now);
  return { decision };
}
