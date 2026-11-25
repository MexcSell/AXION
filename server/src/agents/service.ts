import { createHash } from 'node:crypto';
import type { Tx, Db } from '../db.ts';
import type { AgentStoredDto, AgentVersionDto, Provenance } from '../../../shared/contracts/src/index.ts';
import { activeRevision, edgesOf } from './org.ts';
import { advisoryXactLock } from '../locks.ts';

export const promptHash = (model: string, skills: unknown[], tools: unknown[]) =>
  createHash('sha256').update(JSON.stringify({ model, skills, tools })).digest('hex');

/** v2.4.0 → v2.5.0; anything else → v<seq>.0.0 */
export function nextLabel(prev: string, seq: number) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(prev);
  return m ? `v${m[1]}.${Number(m[2]) + 1}.0` : `v${seq}.0.0`;
}

export const versionDto = (v: any): AgentVersionDto => ({
  id: v.id, seq: v.seq, label: v.label, parentVersionId: v.parent_version_id, model: v.model, skills: v.skills, tools: v.tools,
  promptHash: v.prompt_hash, createdBy: v.created_by, createdAt: new Date(v.created_at).toISOString(),
});

const SELECT = `select d.*, v.id as v_id, v.label as v_label, v.model as v_model, v.skills as v_skills, v.tools as v_tools
  from agent_definitions d join agent_versions v on v.id = d.active_version_id`;

/** The stored agent; routes add the viewer-scoped `reliability` (attachReliability). */
export type AgentBase = AgentStoredDto;

function dto(r: any, manager: string | undefined): AgentBase {
  const profile = (r.profile?.provenance?.source === 'demo-fixture' ? {} : r.profile ?? {}) as Record<string, unknown>;
  const provenance: Provenance = (profile.provenance as Provenance | undefined) ?? { source: 'measured', sample: 0, window: '90d' };
  return {
    ...profile,
    id: r.id, name: r.name, role: r.role, dept: r.dept, duty: r.duty, description: r.description,
    ...(r.parent_id ? { parentId: r.parent_id } : {}), ...(manager ? { managerId: manager } : {}), ...(r.site ? { site: r.site } : {}),
    avatar: r.avatar, status: (profile.status as string) ?? 'idle', lifecycle: r.status,
    model: r.v_model, skills: r.v_skills, tools: r.v_tools,
    version: r.v_label, versionId: r.v_id, versionLabel: r.v_label,
    rowVersion: r.row_version, provenance, createdAt: new Date(r.created_at).toISOString(),
  };
}

async function managers(c: Tx | Db, tenantId: string) {
  const rev = await activeRevision(c, tenantId);
  return new Map((rev ? await edgesOf(c, rev.id) : []).map((e) => [e.subordinateId, e.supervisorId]));
}

export async function listAgents(c: Tx | Db, tenantId: string): Promise<AgentBase[]> {
  const mg = await managers(c, tenantId);
  const rows = (await c.query(`${SELECT} where d.tenant_id=$1 order by d.created_at, d.id`, [tenantId])).rows;
  return rows.map((r) => dto(r, mg.get(r.id)));
}

export async function getAgent(c: Tx | Db, tenantId: string, id: string, withVersions = true, lock = false): Promise<AgentBase | null> {
  const r = (await c.query(`${SELECT} where d.tenant_id=$1 and d.id=$2${lock ? ' for update of d' : ''}`, [tenantId, id])).rows[0];
  if (!r) return null;
  const out = dto(r, (await managers(c, tenantId)).get(id));
  if (withVersions) out.versions = (await c.query('select * from agent_versions where agent_id=$1 order by seq', [id])).rows.map(versionDto);
  return out;
}

/**
 * Improvement cycle 5: the one lock every writer of an agent's active version takes (PATCH /agents/:id, promote,
 * rollback; proposals take it to read the base). Take it FIRST, as its own statement, and read the agent after it:
 * a read made before (or in the statement that waits) can miss a version another writer committed meanwhile.
 */
export const lockAgent = (c: Tx, tenantId: string, agentId: string) => advisoryXactLock(c, `agent-ver:${tenantId}:${agentId}`);

/** Lock the agent, then read it (row-locked). The only way promote and rollback read the agent they change. */
export async function lockAndReadAgent(c: Tx, tenantId: string, agentId: string) {
  await lockAgent(c, tenantId, agentId);
  return getAgent(c, tenantId, agentId, false, true);
}

/**
 * Promote and rollback: a new immutable version (through addVersion, the Stage 6 path) that becomes active, and the
 * definition's row_version moves on, so an edit opened before (If-Match) answers 409 instead of overwriting it.
 * The caller holds lockAgent.
 */
export async function switchVersion(c: Tx, a: { agentId: string; model: string; skills: string[]; tools: string[]; createdBy: string }) {
  const v = await addVersion(c, a);
  await c.query('update agent_definitions set row_version=row_version+1 where id=$1', [a.agentId]);
  return v;
}

/** Insert a version and make it the agent's active one. The caller holds lockAgent (or, for a new agent, the create lock). */
export async function addVersion(c: Tx, a: { agentId: string; model: string; skills: string[]; tools: string[]; createdBy: string; label?: string }) {
  const prev = (await c.query('select id, seq, label from agent_versions where agent_id=$1 order by seq desc limit 1', [a.agentId])).rows[0];
  const seq = prev ? prev.seq + 1 : 1;
  const label = a.label ?? (prev ? nextLabel(prev.label, seq) : 'v1.0.0');
  const v = (await c.query(
    `insert into agent_versions(agent_id, seq, label, parent_version_id, model, skills, tools, prompt_hash, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [a.agentId, seq, label, prev?.id ?? null, a.model, JSON.stringify(a.skills), JSON.stringify(a.tools), promptHash(a.model, a.skills, a.tools), a.createdBy])).rows[0];
  await c.query('update agent_definitions set active_version_id=$2 where id=$1', [a.agentId, v.id]);
  return versionDto(v);
}
