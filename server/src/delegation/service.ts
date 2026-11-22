import type { Tx, Db } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, badRequest, forbidden } from '../errors.ts';
import { evaluate, CURRENT_BASELINE, approverFor, tierRank, type Approver, type RiskTier } from '../policy/index.ts';
import { DelegationBriefIn, MAX_CHAIN_DEPTH, briefSha, scopeViolations, effectiveFrom, intersectCaps, latestOf, type Capability, type DelegationBriefData, type EffectiveScope } from './brief.ts';
import { advisoryXactLock } from '../locks.ts';

export interface Actor { id: string; role: string; name?: string }
export interface NewBrief {
  tenantId: string; missionId: string; toInstanceId: string; brief: unknown;
  actor: Actor; correlationId: string;
  fromInstanceId?: string | null; taskId?: string | null; supersedes?: string | null; simulated?: boolean;
  /** the simulator: a brief that would pass the depth cap is skipped instead of failing the step */
  skipIfTooDeep?: boolean;
}

const APPROVER_RANK: Record<Approver, number> = { user: 0, admin: 1, owner: 2 };
const canApprove = (role: string, a: Approver) => APPROVER_RANK[a] <= (role === 'admin' ? 2 : 0); // an admin also decides as owner today

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

interface BriefRow {
  id: string; seq: string; depth: number; brief: DelegationBriefData; from_id: string; from_kind: string; parent_brief_id: string | null; mission_id: string;
  to_instance: string; to_agent: string; created_by: string; created_at: Date; task_id: string | null; sha256: string; supersedes_id: string | null; simulated: boolean;
}

const missionRows = async (c: Tx | Db, missionId: string) => (await c.query(`select * from delegation_briefs where mission_id=$1 order by seq`, [missionId])).rows as BriefRow[];

/** The effective scope of one brief, recomputed now: its capabilities intersected with the latest brief of each ancestor (I1), minimal deadline and budget (I3). */
export async function effectiveScope(c: Tx | Db, briefId: string): Promise<EffectiveScope> {
  const row = (await c.query(`select mission_id from delegation_briefs where id::text=$1`, [briefId])).rows[0];
  if (!row) throw new ApiError('NOT_FOUND', 404, 'No such brief.');
  const all = await missionRows(c, row.mission_id);
  return effectiveFrom(all, all.find((r) => r.id === briefId)!);
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
  const brief: DelegationBriefData = { ...parsed.data };
  const unknown = brief.capabilities.filter((x) => !Object.prototype.hasOwnProperty.call(CURRENT_BASELINE.kinds, x.kind)).map((x) => x.kind);
  if (unknown.length) throw badRequest(`Unknown capability kind: ${unknown.join(', ')}.`, { capabilities: `unknown kind: ${unknown.join(', ')}` });

  await advisoryXactLock(c, 'brief:' + a.missionId); // schema-scoped key (src/locks.ts)
  const to = (await c.query(`select id, agent_id from agent_instances where id=$1 and mission_id=$2 and tenant_id=$3`, [a.toInstanceId, a.missionId, a.tenantId])).rows[0];
  if (!to) throw new ApiError('TASK_TARGET_INVALID', 422, 'Choose an agent that is part of this mission.', { fieldErrors: { toInstanceId: 'not in this mission' } });
  if (a.taskId) {
    const tk = (await c.query(`select 1 from tasks where id=$1 and mission_id=$2`, [a.taskId, a.missionId])).rowCount;
    if (!tk) throw new ApiError('TASK_TARGET_INVALID', 422, 'That task is not part of this mission.', { fieldErrors: { taskId: 'not in this mission' } });
  }

  const all = await missionRows(c, a.missionId);
  const mission = (await c.query(`select owner_id from missions where id=$1`, [a.missionId])).rows[0];
  const isAdmin = a.actor.role === 'admin', isOwner = mission?.owner_id === a.actor.id;

  // who delegates, and which brief is the parent
  let fromId = a.actor.id, fromKind: 'user' | 'agent' = 'user', parent: BriefRow | undefined, supersedes: string | null = null, original: BriefRow | undefined;
  if (a.supersedes) {
    const old = all.find((r) => r.id === a.supersedes && r.to_instance === a.toInstanceId);
    if (!old) throw new ApiError('CONFLICT', 422, 'There is no earlier brief to supersede for this agent.', { fieldErrors: { supersedes: 'no such brief' } });
    if (!isAdmin && old.created_by !== a.actor.id) throw forbidden('Only the author of a brief or an administrator may replace it.');
    original = old; supersedes = old.id; fromId = old.from_id; fromKind = old.from_kind as 'user' | 'agent';
    if (old.parent_brief_id) { // the parent's scope is its delegate's latest brief (itself superseded, maybe)
      const first = all.find((r) => r.id === old.parent_brief_id)!;
      parent = latestOf(all, first.to_instance) as BriefRow ?? first;
    }
  } else if (a.fromInstanceId) {
    if (!isAdmin && !isOwner) throw forbidden('Only an administrator or the mission owner can delegate on behalf of an agent.');
    const f = (await c.query(`select id from agent_instances where id=$1 and mission_id=$2`, [a.fromInstanceId, a.missionId])).rows[0];
    if (!f) throw new ApiError('TASK_TARGET_INVALID', 422, 'The delegating agent is not part of this mission.', { fieldErrors: { fromInstanceId: 'not in this mission' } });
    fromId = f.id; fromKind = 'agent';
    parent = latestOf(all, f.id) as BriefRow | undefined; // only the agent's own brief: a root brief written for another agent is not its scope (M1)
    if (!parent) throw forbidden('This agent holds no brief, so there is no scope to delegate from. Give it a brief first.');
  } else if (!isAdmin && !isOwner) {
    throw forbidden('Only an administrator or the mission owner can write a root brief.');
  }
  const depth = parent ? parent.depth + 1 : 1;
  if (depth > MAX_CHAIN_DEPTH) {
    if (a.skipIfTooDeep) return null;
    throw badRequest(`The delegation chain would reach depth ${depth}; the depth limit is ${MAX_CHAIN_DEPTH}.`, { depth: `limit is ${MAX_CHAIN_DEPTH}` });
  }

  // scope: against the delegator's effective scope (the whole chain), recomputed now
  const eff = parent ? effectiveFrom(all, parent) : undefined;
  let over: string[];
  if (eff) over = scopeViolations(eff.capabilities, brief.capabilities);
  else {
    over = rootViolations(brief.capabilities, a.actor, a.missionId);
    if (original && original.created_by !== a.actor.id) { // a replaced root is also held to its original author's authority: the narrower wins
      const role = original.created_by === 'system' ? 'admin' : ((await c.query(`select role from users where id=$1`, [original.created_by])).rows[0]?.role as string | undefined) ?? 'member';
      for (const x of rootViolations(brief.capabilities, { id: original.created_by, role }, a.missionId)) if (!over.includes(x)) over.push(x);
    }
  }
  if (over.length) {
    throw new ApiError('FORBIDDEN', 403, parent
      ? `Outside the delegator's scope: ${over.join(', ')}. A delegate may only hold what its delegator holds.`
      : `You may not delegate: ${over.join(', ')}. A brief may not include what you could not approve yourself.`, { fieldErrors: { capabilities: over.join(', ') } });
  }
  // time and budget: a missing value inherits the delegator's effective bound (I3)
  if (eff?.deadline && !brief.deadline) brief.deadline = eff.deadline;
  if (eff?.budget !== undefined && brief.budget === undefined) brief.budget = eff.budget;
  if (brief.deadline) {
    const past = (await c.query(`select $1::timestamptz <= now() as past`, [brief.deadline])).rows[0].past as boolean;
    if (past) throw badRequest(PAST, { deadline: 'in the past' });
    if (eff?.deadline && (await c.query(`select $1::timestamptz > $2::timestamptz as late`, [brief.deadline, eff.deadline])).rows[0].late) throw badRequest('The deadline is after the delegator\'s own deadline.', { deadline: 'after the parent deadline' });
  }
  if (eff?.budget !== undefined && brief.budget !== undefined && brief.budget > eff.budget) throw badRequest('The budget is above the delegator\'s own budget.', { budget: 'above the parent budget' });

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
export const briefDto = (r: any, effective?: EffectiveScope) => ({
  id: r.id as string, missionId: r.mission_id as string, taskId: (r.task_id ?? null) as string | null, fromId: r.from_id as string, fromKind: r.from_kind as 'user' | 'agent',
  toInstanceId: r.to_instance as string, toAgentId: r.to_agent as string, brief: r.brief as DelegationBriefData, sha256: r.sha256 as string,
  parentBriefId: (r.parent_brief_id ?? null) as string | null, supersedesId: (r.supersedes_id ?? null) as string | null, depth: r.depth as number, simulated: r.simulated as boolean,
  createdAt: ISO(r.created_at),
  effective: effective ? { capabilities: effective.capabilities, deadline: effective.deadline ?? null, budget: effective.budget ?? null, narrowedBy: effective.narrowedBy } : undefined,
  tiers: Object.fromEntries((r.brief as DelegationBriefData).capabilities.map((x) => [x.kind, tierOf(x.kind)])) as Record<string, RiskTier | null>,
});

export async function listBriefs(c: Tx | Db, missionId: string) {
  const all = await missionRows(c, missionId);
  return all.map((r) => briefDto(r, effectiveFrom(all, r)));
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
  // The simulator must never wedge staffing (c42 fix round, I2): it asks for no more than its parent holds, and a refused brief is skipped and audited.
  await c.query('savepoint sim_brief');
  try {
    let all = await missionRows(c, a.missionId);
    if (!latestOf(all, a.fromInstanceId)) {
      const root = await createBrief(c, { ...common, toInstanceId: a.fromInstanceId, brief: { goal: 'Run this mission and staff it', acceptance: ['Every task has an owner', 'Evidence is attached before a task counts as done'], capabilities: SIM_ROOT_CAPS, escalation: 'Ask the mission owner before anything that leaves the company' } });
      if (!root) { await c.query('release savepoint sim_brief'); return null; }
      all = await missionRows(c, a.missionId);
    }
    const mine = latestOf(all, a.fromInstanceId) as BriefRow;
    const caps = intersectCaps(SIM_CHILD_CAPS, effectiveFrom(all, mine).capabilities);
    const r = await createBrief(c, { ...common, fromInstanceId: a.fromInstanceId, toInstanceId: a.toInstanceId,
      brief: { goal: goal.length >= 3 ? goal : 'Contribute to this mission within your role', acceptance: ['The work is reported back to the delegator', 'Evidence is attached'], capabilities: caps, escalation: 'Ask your delegator when scope is unclear' } });
    await c.query('release savepoint sim_brief');
    return r;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e; // a database error is a real fault; a refused brief is not
    await c.query('rollback to savepoint sim_brief');
    await c.query('release savepoint sim_brief');
    await audit(c, { tenantId: a.tenantId, actor: 'system', action: 'delegation.brief_skipped', subject: a.toInstanceId, result: 'denied', correlationId: 'sim-' + a.missionId,
      detail: { missionId: a.missionId, from: a.fromInstanceId, to: a.toInstanceId, reason: e.message } });
    return null;
  }
}
