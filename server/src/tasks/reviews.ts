import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Tx, Db } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, badRequest, notFound } from '../errors.ts';
import type { ErrorCode } from '../../../shared/contracts/src/index.ts';
import { emit } from '../events/hooks.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { EVIDENCE_KINDS, REVIEW_VERDICTS, RUBRIC_RESULTS, type ReviewActor, type TaskReviewDto, type TaskReviewsDto, type EvidenceRef, type RubricItem } from '../../../shared/contracts/src/index.ts';
import { modelFamily, reviewerAgreement } from './review-rules.ts';

/**
 * Improvement cycle 38: independent task review (spec invariant 5). Identity and model family are derived HERE, never read
 * from the request: the producer is the task's owner (its agent instance, with the model of the version that instance is
 * PINNED to), the principal is the mission owner who commissioned the work, the reviewer is the signed-in person.
 * Nobody may review work they produced or commissioned; two agents may not share a model family.
 */
export const ReviewIn = z.object({
  verdict: z.enum(REVIEW_VERDICTS),
  rubric: z.array(z.object({ criterion: z.string().trim().min(1).max(400), result: z.enum(RUBRIC_RESULTS), note: z.string().trim().max(1000).default('') }).strict()).min(1).max(30),
  evidence: z.array(z.object({ kind: z.enum(EVIDENCE_KINDS), ref: z.string().trim().min(1).max(500) }).strict()).max(20).default([]),
}).strict();
export type ReviewInput = z.infer<typeof ReviewIn>;

export interface ReviewCtx { tenantId: string; user: { id: string; name: string; role: 'admin' | 'member' | string }; correlationId: string }
export type Reviewer = { kind: 'user' | 'agent'; id: string };

/**
 * What may be reviewed (cycle 38 fix round, I2). A review judges finished work: `passed` tasks take any verdict; a `failed`
 * task may only receive `rejected` or `changes_requested` (so a failure can be explained, never accepted); every other status
 * (created, ready, running, waiting, verifying, retry_ready, canceled) is not reviewable. Refusal is 409 TASK_NOT_REVIEWABLE.
 */
export const reviewable = (status: string, verdict?: string): { ok: true } | { ok: false; message: string } =>
  status === 'passed' || (status === 'failed' && verdict !== 'accepted') ? { ok: true }
    : status === 'failed' ? { ok: false, message: 'A failed task cannot be accepted. Record rejected or changes requested.' }
    : { ok: false, message: `A task that is ${status.replace(/_/g, ' ')} is not finished, so it cannot be reviewed yet.` };

const NOT_INDEPENDENT = 'REVIEW_NOT_INDEPENDENT' as const;

interface TaskRow { id: string; status: string; tenant_id: string; mission_id: string; owner_id: string; owner_instance_id: string | null; owner_agent: string | null }
async function visibleTaskRow(c: Tx | Db, ctx: ReviewCtx, id: string, lock = false): Promise<TaskRow> {
  const r = (await c.query(
    `select t.id, t.status, t.tenant_id, t.mission_id, t.owner_instance_id, t.owner_agent, m.owner_id from tasks t join missions m on m.id = t.mission_id
      where t.id=$1 and m.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')} ${lock ? 'for update of t' : ''}`,
    [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
  if (!r) throw notFound('No such task, or its mission is not shared with you.');
  return r;
}

/**
 * Agents that owned the task before (c51, O3a). Read from task_owner_history, which a trigger on tasks writes on every owner
 * change (raw SQL included) and which is append-only. The older sources (delegations, reassign audit rows) are still unioned in,
 * but they can only ADD names: they are no longer what the rule depends on. `rows` = 0 means the history is missing: fail closed.
 */
async function ownerHistory(c: Tx | Db, t: TaskRow): Promise<{ rows: number; current: boolean; actors: Set<string> }> {
  const h = (await c.query('select agent_id, owner_agent, owner_instance_id from task_owner_history where task_id=$1 order by seq', [t.id])).rows;
  const last = h[h.length - 1];
  // c51 fix: the newest row must be the task's CURRENT owner, otherwise an owner change went unrecorded (fail closed)
  const current = !!last && (last.owner_agent ?? null) === (t.owner_agent ?? null) && (last.owner_instance_id ?? null) === (t.owner_instance_id ?? null);
  const rs = (await c.query(
    `select i.agent_id from mission_delegations d join agent_instances i on i.id = d.to_instance where d.task_id = $1
     union select a.detail->>'fromAgent' from audit_events a where a.action = 'task.reassign' and a.subject = $1 and a.tenant_id = $2 and a.detail->>'fromAgent' is not null
     union select i.agent_id from audit_events a join agent_instances i on i.id = a.detail->>'fromInstanceId' where a.action = 'task.reassign' and a.subject = $1 and a.tenant_id = $2`, [t.id, t.tenant_id])).rows;
  return { rows: h.length, current, actors: new Set([...h, ...rs].map((r) => r.agent_id as string).filter(Boolean)) };
}

/**
 * The review stays valid only for the attempt it judged (c51). A review is STALE (before attempt N) when the task has a later
 * attempt than the one it was written against, or when the latest attempt started (database time) after the review was created.
 * Evaluated in SQL so only the database clock is compared. `r` is the alias of task_reviews.
 */
export const STALE_BEFORE_SQL = (r = 'r') => `(select la.attempt_no from task_attempts la where la.task_id = ${r}.task_id
    and la.attempt_no = (select max(x.attempt_no) from task_attempts x where x.task_id = ${r}.task_id)
    and (coalesce((select ra.attempt_no from task_attempts ra where ra.id = ${r}.attempt_id), 0) < la.attempt_no or (la.started_at is not null and ${r}.created_at < la.started_at)))`;

/** The producing agent of a task, with the model family of the version its instance is pinned to (the active version only when the task has no instance). */
async function producerOf(c: Tx | Db, t: TaskRow): Promise<ReviewActor | null> {
  const r = (await c.query(
    `select d.id, d.name, coalesce(pv.model, av.model) as model
       from agent_definitions d
       left join agent_instances i on i.id = $2 and i.agent_id = d.id
       left join agent_versions pv on pv.id = i.agent_version_id
       left join agent_versions av on av.id = d.active_version_id
      where d.id = coalesce((select agent_id from agent_instances where id = $2), $3) and d.tenant_id = $1`, [t.tenant_id, t.owner_instance_id, t.owner_agent])).rows[0];
  return r ? { id: r.id, kind: 'agent', name: r.name, modelFamily: modelFamily(r.model) } : null;
}

async function reviewerOf(c: Tx | Db, ctx: ReviewCtx, who: Reviewer): Promise<ReviewActor> {
  if (who.kind === 'user') return { id: who.id, kind: 'user', name: ctx.user.name, modelFamily: null };
  const r = (await c.query(`select d.id, d.name, v.model from agent_definitions d left join agent_versions v on v.id = d.active_version_id where d.id=$1 and d.tenant_id=$2`, [who.id, ctx.tenantId])).rows[0];
  if (!r) throw new ApiError('REVIEWER_UNKNOWN', 422, 'That reviewer is not an agent of this company.');
  return { id: r.id, kind: 'agent', name: r.name, modelFamily: modelFamily(r.model) };
}

/** null when `reviewer` may review; otherwise the refusal. One rule for the route, the GET `canReview` and the recording. */
export function independence(reviewer: ReviewActor, producer: ReviewActor, principalId: string, history: { rows: number; current: boolean; actors: ReadonlySet<string> }): { code: ErrorCode; message: string } | null {
  const prior = history.actors;
  if (history.rows === 0 || !history.current) return { code: NOT_INDEPENDENT, message: 'The owner history of this task is missing or does not end at its current owner, so it cannot be shown that the reviewer did not work on it. No review is accepted until the history exists.' };
  if (reviewer.kind === 'agent' && prior.has(reviewer.id)) return { code: NOT_INDEPENDENT, message: 'This agent worked on an earlier attempt of the task, so it cannot review it.' };
  if (reviewer.id === producer.id) return { code: NOT_INDEPENDENT, message: 'The one who produced the work cannot review it.' };
  if (reviewer.kind === 'user' && reviewer.id === principalId) return { code: NOT_INDEPENDENT, message: 'You commissioned this mission, so you cannot be the independent reviewer of its work. Ask someone else to review it.' };
  if (reviewer.kind === 'agent' && producer.kind === 'agent') {
    if (!reviewer.modelFamily || !producer.modelFamily) return { code: 'REVIEW_SAME_MODEL_FAMILY', message: 'The model family of the reviewer or the producer is unknown, so independence cannot be shown.' };
    if (reviewer.modelFamily === producer.modelFamily) return { code: 'REVIEW_SAME_MODEL_FAMILY', message: `Both agents run a ${producer.modelFamily} model. A model tends to favour its own family's output, so the review must come from another family.` };
  }
  return null;
}

async function missionPapers(c: Tx | Db, missionId: string) {
  const r = (await c.query('select criteria, files from mission_revisions where mission_id=$1 order by revision desc limit 1', [missionId])).rows[0];
  const criteria = (Array.isArray(r?.criteria) ? r.criteria : []).map((x: { text?: unknown }) => String(x?.text ?? '').trim()).filter(Boolean) as string[];
  const files = (Array.isArray(r?.files) ? r.files : []) as { id: string; name: string }[];
  return { criteria, files };
}

/** Every cited item must exist in THIS mission (a file attached to it, a message of one of its threads) or be an http(s) link. */
async function checkEvidence(c: Tx | Db, missionId: string, taskId: string, ev: EvidenceRef[]) {
  const { files } = await missionPapers(c, missionId);
  const bad: string[] = [];
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const e of ev) {
    const k = `${e.kind}:${e.ref}`;
    if (seen.has(k)) continue;
    seen.add(k);
    let ok = false;
    if (e.kind === 'url') { try { const u = new URL(e.ref); ok = u.protocol === 'https:' || u.protocol === 'http:'; } catch { ok = false; } }
    else if (e.kind === 'file') ok = files.some((f) => f.id === e.ref);
    else if (/^\d{1,15}$/.test(e.ref)) ok = !!(await c.query(`select 1 from messages m join conversation_threads th on th.id=m.thread_id where th.mission_id=$1 and m.id=$2::bigint`, [missionId, e.ref])).rowCount;
    if (!ok) bad.push(k);
    else out.push({ kind: e.kind, ref: e.ref });
  }
  if (bad.length) throw badRequest('Some evidence does not belong to this mission, or is not a web link.', { evidence: `not usable here: ${bad.join(', ')}` });
  return out;
}

/** Semantic rules the shape check cannot express (the database repeats the evidence rule as a CHECK). */
function checkVerdict(b: ReviewInput) {
  if (b.verdict === 'accepted' && b.evidence.length === 0) throw badRequest('An accepted review needs at least one piece of evidence.', { evidence: 'required to accept' });
  if (b.verdict === 'accepted' && b.rubric.some((r) => r.result === 'fail')) throw badRequest('A task with a failed criterion cannot be accepted.', { verdict: 'a criterion failed' });
}

const rid = () => 'TR-' + randomBytes(12).toString('hex');

/** Record one review (inside the caller's transaction). `reviewer` defaults to the signed-in person; no route lets a client name an agent. */
export async function recordReview(c: Tx, ctx: ReviewCtx, taskId: string, input: ReviewInput, reviewer: Reviewer = { kind: 'user', id: ctx.user.id }): Promise<{ review: TaskReviewDto }> {
  const t = await visibleTaskRow(c, ctx, taskId, true);
  const producer = await producerOf(c, t);
  if (!producer) throw new ApiError('TASK_NO_PRODUCER', 422, 'This task has no owner yet, so there is no recorded producer to review.');
  const st = reviewable(t.status, input.verdict);
  if (!st.ok) throw new ApiError('TASK_NOT_REVIEWABLE', 409, st.message);
  const who = await reviewerOf(c, ctx, reviewer);
  const refusal = independence(who, producer, t.owner_id, await ownerHistory(c, t));
  if (refusal) throw new ApiError(refusal.code, 403, refusal.message);
  checkVerdict(input);
  const evidence = await checkEvidence(c, t.mission_id, taskId, input.evidence);
  const attempt = (await c.query('select id from task_attempts where task_id=$1 order by attempt_no desc limit 1', [taskId])).rows[0];
  const id = rid();
  const rubric: RubricItem[] = input.rubric.map((r) => ({ criterion: r.criterion, result: r.result, note: r.note }));
  const row = (await c.query(
    `insert into task_reviews(id, tenant_id, mission_id, task_id, attempt_id, reviewer_id, reviewer_kind, reviewer_model_family, producer_id, producer_kind, producer_model_family, principal_id, rubric, verdict, evidence)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning seq, created_at`,
    [id, t.tenant_id, t.mission_id, taskId, attempt?.id ?? null, who.id, who.kind, who.modelFamily, producer.id, producer.kind, producer.modelFamily, t.owner_id, JSON.stringify(rubric), input.verdict, JSON.stringify(evidence)])).rows[0];
  await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'task.review', subject: taskId, result: 'ok', correlationId: ctx.correlationId,
    detail: { missionId: t.mission_id, reviewId: id, verdict: input.verdict, reviewerId: who.id, reviewerKind: who.kind, producerId: producer.id, evidence: evidence.length } });
  await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, actorKind: who.kind === 'agent' ? 'agent' : 'human', correlationId: ctx.correlationId, subjectKind: 'task', subject: taskId, missionId: t.mission_id,
    type: 'task.reviewed', payload: { taskId, reviewId: id, verdict: input.verdict, reviewerId: who.id, reviewerKind: who.kind, by: ctx.user.name } });
  return { review: { id, taskId, missionId: t.mission_id, reviewer: who, producer, verdict: input.verdict, rubric, evidence, createdAt: new Date(row.created_at).toISOString(), stale: null,
    reviewerAgreement: { agreed: 0, n: 0, rate: null, state: 'none' } } };
}

/** GET /tasks/:id/reviews: the reviews (oldest first), what the viewer may do, and what a review dialog needs. */
export async function listReviews(c: Tx | Db, ctx: ReviewCtx, taskId: string): Promise<TaskReviewsDto> {
  const t = await visibleTaskRow(c, ctx, taskId);
  const producer = await producerOf(c, t);
  const me: ReviewActor = { id: ctx.user.id, kind: 'user', name: ctx.user.name, modelFamily: null };
  const st = reviewable(t.status);
  const refusal: { code: ErrorCode; message: string } | null = !producer ? { code: 'TASK_NO_PRODUCER', message: 'This task has no owner yet, so there is no recorded producer to review.' }
    : !st.ok ? { code: 'TASK_NOT_REVIEWABLE', message: st.message } : independence(me, producer, t.owner_id, await ownerHistory(c, t));
  const rs = (await c.query(`select r.*, ${STALE_BEFORE_SQL('r')} as stale_before, u.name as user_name, d.name as agent_name from task_reviews r
      left join users u on r.reviewer_kind='user' and u.id=r.reviewer_id left join agent_definitions d on r.reviewer_kind='agent' and d.id=r.reviewer_id
     where r.task_id=$1 order by r.seq`, [taskId])).rows;
  // agreement: over every review, by the same reviewers, in the missions the viewer can see
  const keys = [...new Set(rs.map((r) => r.reviewer_id as string))];
  const pool = keys.length ? (await c.query(
    `select r.task_id, r.reviewer_kind, r.reviewer_id, r.verdict, r.seq from task_reviews r join missions m on m.id = r.mission_id
      where r.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and r.task_id in (select task_id from task_reviews where reviewer_id = any($4::text[]))`,
    [ctx.tenantId, ctx.user.role === 'admin', ctx.user.id, keys])).rows : [];
  const agree = reviewerAgreement(pool.map((r) => ({ taskId: r.task_id, reviewerKey: `${r.reviewer_kind}:${r.reviewer_id}`, verdict: r.verdict, seq: Number(r.seq) })));
  const { criteria, files } = await missionPapers(c, t.mission_id);
  const msgs = (await c.query(`select m.id, m.kind, left(m.body, 60) as body from messages m join conversation_threads th on th.id=m.thread_id
      where th.mission_id=$1 and m.task_id=$2 order by m.id desc limit 20`, [t.mission_id, taskId])).rows;
  return {
    taskId, missionId: t.mission_id, producer, taskStatus: t.status, canAccept: t.status === 'passed',
    // verified = the LATEST review accepts it with evidence, is not stale, and its writer is neither the stored producer nor the stored principal; the task is still passed
    verified: (() => { const l = rs[rs.length - 1]; return !!l && t.status === 'passed' && l.verdict === 'accepted' && l.stale_before == null && Array.isArray(l.evidence) && l.evidence.length >= 1 && l.reviewer_id !== l.producer_id && l.reviewer_id !== l.principal_id; })(),
    canReview: refusal ? { allowed: false, code: refusal.code, reason: refusal.message } : { allowed: true, code: null, reason: null },
    criteria,
    evidenceOptions: [
      ...files.map((f) => ({ kind: 'file' as const, ref: f.id, label: f.name })),
      ...msgs.map((m) => ({ kind: 'message' as const, ref: String(m.id), label: `${m.kind}: ${String(m.body).replace(/\s+/g, ' ')}` })),
    ],
    reviews: rs.map((r) => ({
      id: r.id, taskId: r.task_id, missionId: r.mission_id,
      reviewer: { id: r.reviewer_id, kind: r.reviewer_kind, name: r.user_name ?? r.agent_name ?? r.reviewer_id, modelFamily: r.reviewer_model_family },
      producer: { id: r.producer_id, kind: r.producer_kind, name: producer && producer.id === r.producer_id ? producer.name : r.producer_id, modelFamily: r.producer_model_family },
      verdict: r.verdict, rubric: r.rubric, evidence: r.evidence, createdAt: new Date(r.created_at).toISOString(), stale: r.stale_before == null ? null : { beforeAttempt: Number(r.stale_before) },
      reviewerAgreement: agree.get(`${r.reviewer_kind}:${r.reviewer_id}`) ?? { agreed: 0, n: 0, rate: null, state: 'none' },
    })),
  };
}
