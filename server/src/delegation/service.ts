import type { Tx, Db } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, badRequest, forbidden } from '../errors.ts';
import { evaluate, CURRENT_BASELINE, approverFor, tierRank, type Approver, type RiskTier } from '../policy/index.ts';
import { DelegationBriefIn, MAX_CHAIN_DEPTH, briefSha, scopeViolations, type Capability, type DelegationBriefData } from './brief.ts';

export interface Actor { id: string; role: string; name?: string }
export interface NewBrief {
  tenantId: string; missionId: string; toInstanceId: string; brief: unknown;
  actor: Actor; correlationId: string;
  fromInstanceId?: string | null; taskId?: string | null; supersedes?: string | null; simulated?: boolean;
  /** the simulator: a brief that would pass the depth cap is skipped instead of failing the step */
  skipIfTooDeep?: boolean;
}

const APPROVER_RANK: Record<Approver, number> = { user: 0, admin: 1, owner: 2 };
const canApprove = (role: string, a: Approver) => APPROVER_RANK[a] <= (role === 'admin' ? 2 : 0) // an admin also decides as owner today;

/** What a human delegator may put in a root brief, decided by evaluate() per kind (the human's own gate), and the agent's side (prohibitions). */
function rootViolations(caps: readonly Capability[], actor: Actor, missionId: string): string[] {
  const bad: string[] = [];
  const decide = (kind: string, requesterKind: 'user' | 'agent') => {
    const rule = CURRENT_BASELINE.kinds[kind];
    return evaluate({ kind, missionId, requester: { id: requesterKind === 'user' ? actor.id : 'delegate', kind: requesterKind, role: requesterKind === 'user' ? actor.role : 'agent' }, effect: rule.effect, payload: {} },
      [{ id: 'self', subjectId: requesterKind === 'user' ? actor.id : 'delegate', kinds: [kind], expiresAt: Number.MAX_SAFE_INTEGER }], undefined, 0);
  };
  const note = (s: string) => { if (!bad.includes(s)) bad.push(s); };
  for (const c of caps) {
    const human = decide(c.kind, 'user');
    if (human.outcome === 'deny' || (human.approver && !canApprove(actor.role, human.approver))) note(c.origin ? `${c.kind} @ ${c.origin}` : c.kind);
    else if (decide(c.kind, 'agent').outcome === 'deny') note(c.origin ? `${c.kind} @ ${c.origin}` : c.kind); // e.g. prohibited for agents
    if (c.origin) { // an origin is standing access to a site: the human must be able to approve an origin grant
      const g = decide('origin-grant', 'user');
      if (g.outcome === 'deny' || (g.approver && !canApprove(actor.role, g.approver))) note(`${c.kind} @ ${c.origin}`);
    }
  }
  return bad;
}

interface BriefRow { id: string; depth: number; brief: DelegationBriefData; from_id: string; from_kind: string; parent_brief_id: string | null; mission_id: string; to_instance: string; seq: string }

async function latestFor(c: Tx | Db, missionId: string, toInstance: string): Promise<BriefRow | undefined> {
  return (await c.query(`select * from delegation_briefs where mission_id=$1 and to_instance=$2 order by seq desc limit 1`, [missionId, toInstance])).rows[0];
}

export const PAST = 'The deadline is already in the past.';

/**
 * Records one brief in the caller's transaction. Rules (c42): the capabilities must be a subset of the delegator's effective
 * scope (an agent: its own latest brief, else the mission's root brief; a human: evaluate() per kind); depth is capped; the
 * child's deadline and budget may not exceed the parent's; briefs are immutable (a change supersedes). Returns the row, or null
 * when `skipIfTooDeep` and the chain is already at the cap.
 */
export async function createBrief(c: Tx, a: NewBrief) {
  const parsed = DelegationBriefIn.safeParse(a.brief);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join('.') || '_'] = i.message;
    throw badRequest('The brief is not valid: ' + Object.entries(fieldErrors).map(([k, v]) => `${k} ${v}`).join('; ') + '.', fieldErrors);
  }
  const brief = parsed.data;
  const unknown = brief.capabilities.filter((x) => !Object.prototype.hasOwnProperty.call(CURRENT_BASELINE.kinds, x.kind)).map((x) => x.kind);
  if (unknown.length) throw badRequest(`Unknown capability kind: ${unknown.join(', ')}.`, { capabilities: `unknown kind: ${unknown.join(', ')}` });

  await c.query(`select pg_advisory_xact_lock(hashtext($1))`, ['brief:' + a.missionId]);
  const to = (await c.query(`select id, agent_id from agent_instances where id=$1 and mission_id=$2 and tenant_id=$3`, [a.toInstanceId, a.missionId, a.tenantId])).rows[0];
  if (!to) throw new ApiError('TASK_TARGET_INVALID', 422, 'Choose an agent that is part of this mission.', { fieldErrors: { toInstanceId: 'not in this mission' } });
  if (a.taskId) {
    const tk = (await c.query(`select 1 from tasks where id=$1 and mission_id=$2`, [a.taskId, a.missionId])).rowCount;
    if (!tk) throw new ApiError('TASK_TARGET_INVALID', 422, 'That task is not part of this mission.', { fieldErrors: { taskId: 'not in this mission' } });
  }

  // who delegates, and which brief is the parent
  let fromId = a.actor.id, fromKind: 'user' | 'agent' = 'user', parent: BriefRow | undefined, supersedes: string | null = null;
  if (a.supersedes) {
    const old = (await c.query(`select * from delegation_briefs where id::text=$1 and mission_id=$2 and to_instance=$3`, [a.supersedes, a.missionId, a.toInstanceId])).rows[0] as BriefRow | undefined;
    if (!old) throw new ApiError('CONFLICT', 422, 'There is no earlier brief to supersede for this agent.', { fieldErrors: { supersedes: 'no such brief' } });
    supersedes = old.id; fromId = old.from_id; fromKind = old.from_kind as 'user' | 'agent';
    if (old.parent_brief_id) { // the parent's scope is its delegate's latest brief (itself superseded, maybe)
      const first = (await c.query(`select * from delegation_briefs where id=$1`, [old.parent_brief_id])).rows[0] as BriefRow;
      parent = (await latestFor(c, a.missionId, first.to_instance)) ?? first;
    }
  } else if (a.fromInstanceId) {
    const f = (await c.query(`select id from agent_instances where id=$1 and mission_id=$2`, [a.fromInstanceId, a.missionId])).rows[0];
    if (!f) throw new ApiError('TASK_TARGET_INVALID', 422, 'The delegating agent is not part of this mission.', { fieldErrors: { fromInstanceId: 'not in this mission' } });
    fromId = f.id; fromKind = 'agent';
    parent = await latestFor(c, a.missionId, f.id);
    if (!parent) parent = (await c.query(`select * from delegation_briefs where mission_id=$1 and parent_brief_id is null order by seq desc limit 1`, [a.missionId])).rows[0];
    if (!parent) throw forbidden('This agent holds no brief and the mission has no root brief, so there is no scope to delegate from.');
  }
  const depth = parent ? parent.depth + 1 : 1;
  if (depth > MAX_CHAIN_DEPTH) {
    if (a.skipIfTooDeep) return null;
    throw badRequest(`The delegation chain would reach depth ${depth}; the depth limit is ${MAX_CHAIN_DEPTH}.`, { depth: `limit is ${MAX_CHAIN_DEPTH}` });
  }

  // scope
  const over = parent ? scopeViolations(parent.brief.capabilities, brief.capabilities) : rootViolations(brief.capabilities, a.actor, a.missionId);
  if (over.length) {
    throw new ApiError('FORBIDDEN', 403, parent
      ? `Outside the delegator's scope: ${over.join(', ')}. A delegate may only hold what its delegator holds.`
      : `You may not delegate: ${over.join(', ')}. A brief may not include what you could not approve yourself.`, { fieldErrors: { capabilities: over.join(', ') } });
  }
  // time and budget
  if (brief.deadline) {
    const past = (await c.query(`select $1::timestamptz <= now() as past`, [brief.deadline])).rows[0].past as boolean;
    if (past) throw badRequest(PAST, { deadline: 'in the past' });
    if (parent?.brief.deadline && (await c.query(`select $1::timestamptz > $2::timestamptz as late`, [brief.deadline, parent.brief.deadline])).rows[0].late) throw badRequest('The deadline is after the delegator\'s own deadline.', { deadline: 'after the parent deadline' });
  }
  if (parent?.brief.budget !== undefined && brief.budget !== undefined && brief.budget > parent.brief.budget) throw badRequest('The budget is above the delegator\'s own budget.', { budget: 'above the parent budget' });

  const sha = briefSha(brief);
  const r = (await c.query(
    `insert into delegation_briefs(tenant_id, mission_id, task_id, from_id, from_kind, to_instance, to_agent, brief, sha256, parent_brief_id, supersedes_id, depth, simulated, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [a.tenantId, a.missionId, a.taskId ?? null, fromId, fromKind, to.id, to.agent_id, JSON.stringify(brief), sha, parent?.id ?? null, supersedes, depth, a.simulated ?? false, a.actor.id])).rows[0];
  await audit(c, { tenantId: a.tenantId, actor: a.actor.id, action: 'delegation.brief', subject: r.id, result: 'ok', correlationId: a.correlationId,
    detail: { missionId: a.missionId, to: to.id, depth, sha256: sha, capabilities: brief.capabilities.length, supersedes } });
  return r as BriefRow & Record<string, unknown>;
}

const ISO = (d: Date) => new Date(d).toISOString();
const tierOf = (kind: string): RiskTier | null => CURRENT_BASELINE.kinds[kind]?.tier ?? null;
export const briefDto = (r: any) => ({
  id: r.id as string, missionId: r.mission_id as string, taskId: (r.task_id ?? null) as string | null, fromId: r.from_id as string, fromKind: r.from_kind as 'user' | 'agent',
  toInstanceId: r.to_instance as string, toAgentId: r.to_agent as string, brief: r.brief as DelegationBriefData, sha256: r.sha256 as string,
  parentBriefId: (r.parent_brief_id ?? null) as string | null, supersedesId: (r.supersedes_id ?? null) as string | null, depth: r.depth as number, simulated: r.simulated as boolean,
  createdAt: ISO(r.created_at),
  tiers: Object.fromEntries((r.brief as DelegationBriefData).capabilities.map((x) => [x.kind, tierOf(x.kind)])) as Record<string, RiskTier | null>,
});

export async function listBriefs(c: Tx | Db, missionId: string) {
  return (await c.query(`select * from delegation_briefs where mission_id=$1 order by seq`, [missionId])).rows.map(briefDto);
}

/** The kinds a caller could put into a root brief (for the UI picker): same decision as rootViolations. */
export function delegableKinds(actor: Actor, missionId: string) {
  return Object.entries(CURRENT_BASELINE.kinds).map(([kind, k]) => ({ kind, tier: k.tier, effect: k.effect, approver: approverFor(k.tier), allowed: rootViolations([{ kind }], actor, missionId).length === 0, why: k.why }))
    .sort((x, y) => tierRank(x.tier) - tierRank(y.tier));
}

/** Simulator and system steps: attach a simple valid brief to a delegation. The root is the system acting as an administrator. */
const SIM_ROOT_CAPS: Capability[] = [{ kind: 'read' }, { kind: 'summarize' }, { kind: 'screenshot' }, { kind: 'render_local' }, { kind: 'fill_draft' }];
const SIM_CHILD_CAPS: Capability[] = [{ kind: 'read' }, { kind: 'summarize' }];
export async function attachSimBrief(c: Tx, a: { tenantId: string; missionId: string; fromInstanceId: string; toInstanceId: string; goal: string; simulated: boolean }) {
  const goal = (a.goal ?? '').trim().slice(0, 500);
  const system: Actor = { id: 'system', role: 'admin', name: 'System' };
  const common = { tenantId: a.tenantId, missionId: a.missionId, actor: system, correlationId: 'sim-' + a.missionId, simulated: a.simulated, skipIfTooDeep: true };
  if (!(await latestFor(c, a.missionId, a.fromInstanceId))) {
    const root = await createBrief(c, { ...common, toInstanceId: a.fromInstanceId, brief: { goal: 'Run this mission and staff it', acceptance: ['Every task has an owner', 'Evidence is attached before a task counts as done'], capabilities: SIM_ROOT_CAPS, escalation: 'Ask the mission owner before anything that leaves the company' } });
    if (!root) return null;
  }
  return createBrief(c, { ...common, fromInstanceId: a.fromInstanceId, toInstanceId: a.toInstanceId,
    brief: { goal: goal.length >= 3 ? goal : 'Contribute to this mission within your role', acceptance: ['The work is reported back to the delegator', 'Evidence is attached'], capabilities: SIM_CHILD_CAPS, escalation: 'Ask your delegator when scope is unclear' } });
}

