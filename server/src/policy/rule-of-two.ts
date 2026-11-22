// Rule-of-Two configuration profile (c58, research R2-6). Pure derivation of three flags from what a configuration holds.
//
// The rule is a HEURISTIC from a vendor blog (Meta's "Agents Rule of Two", C1), written as a stopgap until prompt injection can be
// detected. It is not a proof of safety. It says: an agent that, in one configuration, (a) reads untrusted input, (b) reaches
// sensitive data or systems and (c) can change state or communicate externally should not act without a human.
//
// The flags are DERIVED here from trusted server-side facts and are never read from a brief, a payload or any requester text:
// the profile has no free-text field, and the three flags are not in it. A self-declared flag would defeat the control.
import type { Db, Tx } from '../db.ts';
import { CURRENT_BASELINE } from './baseline.ts';
import { effectiveFrom, type ChainRow, type Capability } from '../delegation/brief.ts';

export type ContentOrigin = 'upload' | 'internal';
/** Everything the mapping looks at. Built by loadConfigProfile() from the database, or by a test; never from requester text. */
export interface ConfigProfile {
  /** effective capabilities of the agent (delegation briefs, c42): kinds and optional origins */
  capabilities: readonly Capability[];
  /** live site grants of the mission (c36) */
  siteGrants: readonly { origin: string; capabilities: readonly string[] }[];
  /** where the content the agent reads came from: 'upload' is untrusted, 'internal' is company records */
  contentOrigins: readonly ContentOrigin[];
  /** the P1 action being decided now, if any */
  action?: { kind: string; origin?: string };
}

export interface RuleOfTwoFlags { untrustedInput: boolean; sensitiveAccess: boolean; canChangeState: boolean }
export interface DerivedFlags extends RuleOfTwoFlags { because: { untrustedInput: string[]; sensitiveAccess: string[]; canChangeState: string[] } }

/**
 * THE MAPPING (one table; the report and the UI help repeat it).
 *  untrustedInput  (a): a capability or action with an origin (it reads a web page), a live site grant, or a mission with uploaded files
 *                       in any revision or any chat attachment.
 *  sensitiveAccess (b): a capability or action kind whose baseline effect is infra or critical (live systems, credentials, permissions,
 *                       releases, production), or a kind the baseline does not know (fails closed). Today NO kind reads another mission's or the
 *                       tenant's data or secrets except through those kinds, so (b) does not model "can read private company data" (review F1);
 *                       when such a capability exists, it must set (b) here. SENSITIVE_KINDS is pinned by a test so a new kind forces that decision.
 *  canChangeState  (c): a capability or action kind whose baseline effect is external, infra or critical, or an unknown kind (fails closed).
 * Effects come from the c30 baseline table, so a kind that moves tier there moves its flags here: there is no second table of kinds.
 */
export const FLAG_SOURCES = Object.freeze({
  untrustedInput: 'a capability or action with an origin, a live site grant, or uploaded files',
  sensitiveAccess: 'a capability or action kind that reaches live systems, credentials, permissions or production (effect infra or critical), or an unknown kind. It does not cover reading company data: no kind reads outside its mission today',
  canChangeState: 'a capability or action kind with effect external, infra or critical (or an unknown kind)',
});
const SENSITIVE_EFFECTS: readonly string[] = ['infra', 'critical'];
const CHANGING_EFFECTS: readonly string[] = ['external', 'infra', 'critical'];

/** The baseline kinds that set (b) today. Pinned in test/c58-sensitive.test.ts. */
export const SENSITIVE_KINDS: readonly string[] = Object.entries(CURRENT_BASELINE.kinds).filter(([, r]) => SENSITIVE_EFFECTS.includes(r.effect)).map(([k]) => k);

const ruleOf = (kind: string) => (typeof kind === 'string' && Object.prototype.hasOwnProperty.call(CURRENT_BASELINE.kinds, kind) ? CURRENT_BASELINE.kinds[kind] : undefined);

export function deriveFlags(p: ConfigProfile): DerivedFlags {
  const because = { untrustedInput: [] as string[], sensitiveAccess: [] as string[], canChangeState: [] as string[] };
  const note = (k: keyof typeof because, s: string) => { if (!because[k].includes(s)) because[k].push(s); };
  const kinds: { kind: string; label: string }[] = [
    ...p.capabilities.map((c) => ({ kind: c.kind, label: `capability ${c.kind}` })),
    ...(p.action ? [{ kind: p.action.kind, label: `action ${p.action.kind}` }] : []),
  ];
  for (const c of p.capabilities) if (c.origin) note('untrustedInput', `capability ${c.kind} at ${c.origin}`);
  for (const g of p.siteGrants) note('untrustedInput', `site grant for ${g.origin}`);
  if (p.contentOrigins.includes('upload')) note('untrustedInput', 'uploaded files');
  if (p.action?.origin) note('untrustedInput', `action on ${p.action.origin}`);
  for (const { kind, label } of kinds) {
    const r = ruleOf(kind);
    if (!r) { note('sensitiveAccess', `${label} (unknown kind, treated as sensitive)`); note('canChangeState', `${label} (unknown kind, treated as changing state)`); continue; }
    if (SENSITIVE_EFFECTS.includes(r.effect)) note('sensitiveAccess', `${label} (${r.effect})`);
    if (CHANGING_EFFECTS.includes(r.effect)) note('canChangeState', `${label} (${r.effect})`);
  }
  return { untrustedInput: because.untrustedInput.length > 0, sensitiveAccess: because.sensitiveAccess.length > 0, canChangeState: because.canChangeState.length > 0, because };
}

export const allThree = (f: RuleOfTwoFlags) => f.untrustedInput && f.sensitiveAccess && f.canChangeState;

/**
 * Loads the profile of one agent on one mission from trusted tables. Liveness and expiry are judged by the database clock, in SQL.
 * Capabilities: the union, over the agent's live instances, of each instance's newest brief intersected with its ancestors (c42).
 */
export async function loadConfigProfile(db: Db | Tx, a: { tenantId: string; missionId: string; agentId: string; action?: { kind: string; origin?: string } }): Promise<ConfigProfile> {
  const briefs = (await db.query(`select id, seq, to_instance, to_agent, parent_brief_id, brief from delegation_briefs where mission_id=$1 and tenant_id=$2 order by seq`, [a.missionId, a.tenantId])).rows as ChainRow[];
  const live = new Set((await db.query(`select id from agent_instances where mission_id=$1 and tenant_id=$2 and agent_id=$3 and ended_at is null`, [a.missionId, a.tenantId, a.agentId])).rows.map((r) => r.id as string));
  const caps: Capability[] = [];
  for (const inst of live) {
    const mine = briefs.filter((b) => b.to_instance === inst);
    const newest = mine.reduce<ChainRow | undefined>((m, b) => (!m || Number(b.seq) > Number(m.seq) ? b : m), undefined);
    if (!newest) continue;
    for (const c of effectiveFrom(briefs, newest).capabilities) if (!caps.some((x) => x.kind === c.kind && x.origin === c.origin)) caps.push(c);
  }
  const grants = (await db.query(
    `select g.exact_origin, g.capabilities from site_grants g join missions m on m.id=g.mission_id and m.deleted_at is null
      where g.tenant_id=$1 and g.mission_id=$2 and g.revoked_at is null and g.expires_at > now()
        and exists (select 1 from agent_instances i where i.tenant_id=$1 and i.mission_id=$2 and i.agent_id=$3 and i.ended_at is null)`,
    [a.tenantId, a.missionId, a.agentId])).rows.map((r) => ({ origin: r.exact_origin as string, capabilities: [...r.capabilities] as string[] }));
  // every revision ever made and every chat attachment of the mission: a later revision without files cannot clear the flag
  const up = (await db.query(
    `select (exists (select 1 from mission_revisions r where r.mission_id=$1 and coalesce(jsonb_array_length(r.files), 0) > 0)
          or exists (select 1 from message_attachments a join messages m on m.id=a.message_id join conversation_threads t on t.id=m.thread_id where t.mission_id=$1)) as has`, [a.missionId])).rows[0];
  const contentOrigins: ContentOrigin[] = up?.has ? ['upload'] : ['internal'];
  return { capabilities: caps, siteGrants: grants, contentOrigins, ...(a.action ? { action: a.action } : {}) };
}

