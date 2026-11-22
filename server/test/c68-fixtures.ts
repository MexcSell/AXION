import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { tx } from '../src/db.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { proposeLesson } from '../src/agents/playbooks.ts';
import { randomBytes } from 'node:crypto';

/** Shared fixtures for the c68 attention-queue tests: one tenant, an administrator, two members, and a mission each of the three visibility kinds. */
export interface World {
  t: TestApp; admin: Browser; adminId: string; mia: Browser; miaId: string; ben: Browser; benId: string;
  /** shared with everyone */ mShared: string;
  /** owned by the administrator, not shared: members cannot see it */ mPrivate: string;
  /** owned by Ben, not shared: Mia cannot see it */ mBen: string;
}
let n = 0;
export const key = () => ({ 'idempotency-key': 'c68-' + Date.now() + '-' + n++ });
export const uid = (p: string) => p + randomBytes(5).toString('hex');

export async function makeWorld(): Promise<World> {
  const t = await makeTestApp({ staffingStepMs: 600_000 });
  const w = await withAdmin(t.app);
  const mia = await w.member('Mia'), ben = await w.member('Ben');
  const mk = async (b: Browser, shared: boolean) => (await b.req('POST', '/missions', { text: 'A mission for the attention queue.', files: [], shared }, key())).body.mission.id as string;
  return { t, admin: w.admin, adminId: w.adminId, mia: mia.b, miaId: mia.id, ben: ben.b, benId: ben.id, mShared: await mk(mia.b, true), mPrivate: await mk(w.admin, false), mBen: await mk(ben.b, false) };
}

export const q = (w: World, sql: string, p: unknown[] = []) => w.t.pool.query(sql, p).then((r) => r.rows);

/** A pending approval. `kind` fixes the tier through the policy table: submit_form is R2, release is R3, production_deploy is R4. */
export const approval = (w: World, mission: string, kind = 'submit_form', extra: Record<string, unknown> = {}) =>
  tx(w.t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: mission, agentId: 'release-01', kind, title: 'Approval ' + uid(''), detail: 'd', payload: { x: uid('') }, expiresInMin: 600, ...extra } as never));

/** A task, optionally with attempts. */
export async function task(w: World, mission: string, status: string, o: { title?: string; created?: string } = {}) {
  const id = uid('T-c68-');
  await w.t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, created_at) values ($1,'t-1',$2,$3,$4,'coder-01', now() - $5::interval)`, [id, mission, o.title ?? 'Write the report', status, o.created ?? '0 seconds']);
  return id;
}
/** A task whose latest review predates a later attempt: the review is stale (c51). */
export async function staleReview(w: World, mission: string, o: { ageHours?: number } = {}) {
  const id = await task(w, mission, 'passed');
  const a1 = (await w.t.pool.query(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,1, now() - interval '3 days', now() - interval '2 days','passed') returning id`, [id])).rows[0].id;
  await w.t.pool.query(`insert into task_reviews(id, tenant_id, mission_id, task_id, attempt_id, reviewer_id, reviewer_kind, producer_id, producer_kind, principal_id, rubric, verdict, evidence, created_at)
    values ($1,'t-1',$2,$3,$4,$5,'user','coder-01','agent','u-owner','[{"criterion":"x","result":"pass","note":""}]','accepted','[{"kind":"url","ref":"https://example.com/r"}]', now() - interval '2 days')`, [uid('TR-'), mission, id, a1, w.benId]);
  await w.t.pool.query(`insert into task_attempts(task_id, attempt_no, started_at) values ($1,2, now() - ($2 || ' hours')::interval)`, [id, String(o.ageHours ?? 5)]);
  return id;
}
/** A confirmed failure tag with no detection channel (a failed task and its tag). `channel` fills the channel when given. */
export async function failure(w: World, mission: string, mode = 'FM-3.2', o: { channel?: string; subject?: string; daysAgo?: number } = {}) {
  const task_ = o.subject ?? (await task(w, mission, 'failed'));
  await w.t.pool.query(`insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, decided_by, decided_at, detection_channel, created_at)
    values ($1,'t-1',$2,'task',$3,'mast-arxiv-2503.13657v3',$4,$5,'user','confirmed',$6, now() - ($7 || ' days')::interval, $8, now() - ($7 || ' days')::interval)`, [uid('FT-'), mission, task_, mode, w.miaId, w.benId, String(o.daysAgo ?? 1), o.channel ?? null]);
  return task_;
}
export async function waitingTask(w: World, mission: string, hoursAgo: number) {
  const id = await task(w, mission, 'waiting_user', { created: `${hoursAgo + 2} hours` });
  await w.t.pool.query(`insert into events(tenant_id, type, mission_id, subject_kind, subject_id, payload, occurred_at) values ('t-1','task.stateChanged',$1,'task',$2,$3, now() - ($4 || ' hours')::interval)`, [mission, id, JSON.stringify({ taskId: id, from: 'running', to: 'waiting_user' }), String(hoursAgo)]);
  return id;
}
export async function orgProposal(w: World, expiresInHours: number, status = 'pending') {
  const id = uid('OP-');
  await w.t.pool.query(`insert into org_proposals(id, tenant_id, title, why, base_revision, edges, payload_sha, created_by, status, expires_at, decided_at) values ($1,'t-1','Move the QA team','because',1,'[]',$2,$3,$4, now() + ($5 || ' hours')::interval, $6)`,
    [id, uid('sha'), w.adminId, status, String(expiresInHours), status === 'pending' ? null : new Date()]);
  return id;
}
export async function versionProposal(w: World, expiresInHours: number, status = 'pending') {
  const id = uid('VP-');
  const v = (await w.t.pool.query(`select active_version_id as v, id from agent_definitions where id='coder-01'`)).rows[0];
  await w.t.pool.query(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by, status, expires_at, decided_at)
    values ($1,'t-1','coder-01',$2,'sha','{"model":"m","skills":[],"tools":[]}',$3,'Try a newer model',$4,$5, now() + ($6 || ' hours')::interval, $7)`, [id, v.v, uid('c'), w.adminId, status, String(expiresInHours), status === 'pending' ? null : new Date()]);
  return id;
}
export const humanLesson = async (by: Browser, text: string, agent = 'coder-01') => (await by.req('POST', `/agents/${agent}/lessons`, { text, sources: [{ kind: 'review', id: 'REV-1', note: 'seen twice' }] }, key())).body.lesson.id as string;
/** A candidate the system opened (c63): a proposal by the failure-pattern reviewer plus the pattern record that names it. */
export async function systemLesson(w: World, mode = 'FM-3.2') {
  const id = await tx(w.t.app.db, (c) => proposeLesson(c, { tenantId: 't-1', agentId: 'coder-01', proposedBy: 'failure-pattern-review', kind: 'agent', channel: 'tool_output', text: 'System-derived from tool records, not written by a person. ' + uid(''), sources: [{ kind: 'failure_tag', id: 'FT-x' }], correlationId: 'c68' }));
  await w.t.pool.query(`insert into failure_pattern_candidates(id, tenant_id, mode_id, window_days, candidate_id, failure_count, department_count, departments, task_ids, tag_ids)
    values ($1,'t-1',$2,30,$3,3,2,'["A","B"]','[]','[]')`, [uid('FP-'), mode, id]);
  return id;
}
