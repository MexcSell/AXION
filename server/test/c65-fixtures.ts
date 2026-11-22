// c65 test fixtures: rows inserted directly (the tables allow inserts), all times relative to the database clock.
import type pg from 'pg';

export const DAY = 86_400_000;
export interface Fx { pool: pg.Pool; mission: string }

export const addAgent = (f: Fx, id: string, dept: string, tenant = 't-1') =>
  f.pool.query(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ($1,$2,$3,'r',$4,$5,'test')`, [id, tenant, id.toUpperCase(), dept, 'duty of ' + id]);

/** An approval raised `agoMs` ago by `agent`. `state` pending = open unless `expiresInMs` has passed. */
export const addApproval = (f: Fx, id: string, agent: string, agoMs: number, o: { state?: string; expiresInMs?: number; demo?: boolean } = {}) =>
  f.pool.query(
    `insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, digest_version, state, demo, created_at, expires_at)
     values ($1,'t-1',$2,$3,'submit_form','T','R2','x',2,$4,$5, now() - ($6 || ' milliseconds')::interval, now() + ($7 || ' milliseconds')::interval)`,
    [id, f.mission, agent, o.state ?? 'pending', o.demo ?? false, String(agoMs), String(o.expiresInMs ?? 3_600_000)]);

/** A decision row: decided `decidedAgoMs` ago by `by`. `latencyMs` is what c58 stored (it need not equal decided_at - created_at; the model must read it). */
export const addDecision = (f: Fx, approvalId: string, by: string, decidedAgoMs: number, latencyMs: number, queue = 1, decision = 'approved') =>
  f.pool.query(
    `insert into approval_decisions(approval_id, decision, reason, digest, decided_by, decided_at, latency_ms, queue_size, fast_bulk)
     values ($1,$2,'','d',$3, now() - ($4 || ' milliseconds')::interval, $5, $6, false)`, [approvalId, decision, by, String(decidedAgoMs), latencyMs, queue]);

/** A decided approval in one call: raised `agoMs` ago and decided `latencyMs` later. */
export async function decided(f: Fx, id: string, agent: string, agoMs: number, latencyMs: number, by = 'u-a', queue = 1) {
  await addApproval(f, id, agent, agoMs, { state: 'approved' });
  await addDecision(f, id, by, agoMs - latencyMs, latencyMs, queue);
}

export const addTask = (f: Fx, id: string, owner: string | null, status = 'waiting_user') =>
  f.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ($1,'t-1',$2,'T',$3,$4)`, [id, f.mission, status, owner]);

/** A task.stateChanged event `agoMs` ago. */
export const addStateEvent = (f: Fx, taskId: string, from: string, to: string, agoMs: number, actor = 'u-a') =>
  f.pool.query(
    `insert into events(tenant_id, type, mission_id, actor_kind, actor_id, subject_kind, subject_id, payload, occurred_at)
     values ('t-1','task.stateChanged',null,'human',$1,'task',$2,$3, now() - ($4 || ' milliseconds')::interval)`,
    [actor, taskId, JSON.stringify({ taskId, from, to, action: 'x', by: 'x' }), String(agoMs)]);
