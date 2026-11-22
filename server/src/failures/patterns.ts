import { randomBytes } from 'node:crypto';
import type { Tx, Db } from '../db.ts';
import { audit } from '../audit.ts';
import { advisoryXactLock } from '../locks.ts';
import { proposeLesson } from '../agents/playbooks.ts';
import { failureModeOf, FAILURE_TAXONOMY_VERSION } from './taxonomy.ts';
import { FAILURE_PATTERN_MIN_FAILURES, FAILURE_PATTERN_MIN_DEPARTMENTS, type FailurePatternsDto } from '../../../shared/contracts/src/failures.ts';

/**
 * Improvement cycle 63 (R3-8): the recurrence rule. When one failure mode is confirmed on at least 3 failures in at least 2 departments inside the window,
 * a row opens in c41's `lesson_candidates` with the failures as its sources. That is all this file does: it never writes a playbook (c41's human review does),
 * and it adds no queue.
 *
 * What counts (stated so the numbers can be checked):
 *  - A failure is a failed TASK (a task-attempt tag counts for its task, so a task and its attempt tagged with the same mode are one failure).
 *    Message and mission subjects have no owner agent and so no department: they are not counted.
 *  - Only CONFIRMED tags, on missions that are not DEMO and not deleted, whose creation time is inside the window. The bound is the database's now() in SQL.
 *  - The department of a failure is the catalog department (agent_definitions.dept) of the task's current owner agent (the owner instance's agent, else owner_agent).
 *    A task with no owner agent has no department and is left out. This is the task's CURRENT owner: an earlier owner that handed a failed task on is not charged here
 *    (c6's department facts split ownership at handovers; this rule does not).
 *  - One candidate is open per (tenant, mode, window). While one is `proposed` nothing else opens. After a person decides it, a new one opens only if a tag that
 *    qualifies was confirmed after the previous candidate was made (new evidence), never on the same evidence.
 *  - The candidate belongs to ONE agent, because c41 playbooks are per agent: the one that owned the most of the failures (lowest id on a tie). A pattern across
 *    departments has no single owner, so this is a convention for the reviewer to overrule by rejecting.
 */
export const SYSTEM_PROPOSER = 'failure-pattern-review';
export const PATTERN_WINDOW_DAYS = 30;
type Q = Tx | Db;

interface PatternFailure { task_id: string; agent_id: string; dept: string; tag_id: string; new_evidence: boolean }
/** One row per failed task of the pattern, with its owner agent and department. Newest decided first. */
async function qualifying(c: Q, tenantId: string, modeId: string, taxonomyVersion: string, days: number): Promise<PatternFailure[]> {
  return (await c.query(`
    with conf as (
      select f.id as tag_id, f.created_at, f.decided_at,
        case when f.subject_kind = 'task' then f.subject_id
             when f.subject_id ~ '^[1-9][0-9]{0,17}$' then (select a.task_id from task_attempts a where a.id = f.subject_id::bigint) end as task_id,
        f.decided_at > coalesce((select max(p.created_at) from failure_pattern_candidates p where p.tenant_id = $1 and p.mode_id = $2 and p.window_days = $4), '-infinity'::timestamptz) as new_evidence
      from failure_tags f join missions m on m.id = f.mission_id
      where f.tenant_id = $1 and m.tenant_id = $1 and f.mode_id = $2 and f.taxonomy_version = $3 and f.status = 'confirmed' and f.subject_kind in ('task', 'task_attempt')
        and not m.demo and m.deleted_at is null and f.created_at > now() - make_interval(days => $4::int) and f.created_at <= now())
    select distinct on (t.id) t.id as task_id, d.id as agent_id, d.dept, c.tag_id, c.new_evidence
    from conf c join tasks t on t.id = c.task_id and t.tenant_id = $1
      left join agent_instances i on i.id = t.owner_instance_id
      join agent_definitions d on d.id = coalesce(i.agent_id, t.owner_agent) and d.tenant_id = $1
    order by t.id, c.decided_at desc, c.tag_id`, [tenantId, modeId, taxonomyVersion, days])).rows;
}

/** Plain text for c41's lesson rule: letters, digits and common punctuation only. */
const plainText = (s: string) => s.replace(/[^\p{L}\p{M}\p{N} .,;:!?'"()\-_/&%+=@#*[\]]/gu, ' ').replace(/\p{Default_Ignorable_Code_Point}/gu, '').replace(/:\/\/|\bwww\./gi, ' ').replace(/\s+/g, ' ').trim();

export type PatternResult = { opened: false; reason: 'below_threshold' | 'already_open' | 'no_new_evidence' } | { opened: true; candidateId: string; failures: number; departments: string[] };
/**
 * Looks at one mode in one tenant and opens a candidate if the pattern holds and none is open. Call it inside the transaction that confirmed a tag of that mode.
 * Takes a lock named for the pattern first, so two confirmations at once make one candidate.
 */
export async function evaluateFailurePattern(c: Tx, tenantId: string, modeId: string, opts: { taxonomyVersion?: string; days?: number; correlationId?: string } = {}): Promise<PatternResult> {
  const days = opts.days ?? PATTERN_WINDOW_DAYS;
  await advisoryXactLock(c, `failure-pattern:${tenantId}:${modeId}:${days}`);
  const open = (await c.query(`select c.status from failure_pattern_candidates p join lesson_candidates c on c.id = p.candidate_id
    where p.tenant_id = $1 and p.mode_id = $2 and p.window_days = $3 order by p.created_at desc, p.id desc limit 1`, [tenantId, modeId, days])).rows[0] as { status: string } | undefined;
  if (open?.status === 'proposed') return { opened: false, reason: 'already_open' };
  const rows = await qualifying(c, tenantId, modeId, opts.taxonomyVersion ?? FAILURE_TAXONOMY_VERSION, days);
  const departments = [...new Set(rows.map((r) => r.dept))].sort();
  if (rows.length < FAILURE_PATTERN_MIN_FAILURES || departments.length < FAILURE_PATTERN_MIN_DEPARTMENTS) return { opened: false, reason: 'below_threshold' };
  if (open && !rows.some((r) => r.new_evidence)) return { opened: false, reason: 'no_new_evidence' };

  const count = new Map<string, number>();
  for (const r of rows) count.set(r.agent_id, (count.get(r.agent_id) ?? 0) + 1);
  const agentId = [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const mode = failureModeOf(modeId);
  const names = departments.slice(0, 5).map(plainText).join(', ') + (departments.length > 5 ? ` and ${departments.length - 5} more` : '');
  const text = `System-derived from tool records, not written by a person. Failure mode ${modeId} (${plainText(mode?.mode.name ?? modeId)}) was confirmed on ${rows.length} failed tasks in ${departments.length} departments (${names}) in the last ${days} days. Review whether a lesson for this agent would help; rejecting it changes nothing.`;
  const sources = rows.slice(0, 10).map((r) => ({ kind: 'failure_tag' as const, id: r.tag_id })); // c41 allows at most 10 sources; the link row below keeps every tag
  const lessonId = await proposeLesson(c, { tenantId, agentId, proposedBy: SYSTEM_PROPOSER, kind: 'agent', text, sources, correlationId: opts.correlationId ?? '' });
  const id = 'FP-' + randomBytes(16).toString('hex').toUpperCase(); // 128-bit
  await c.query(`insert into failure_pattern_candidates(id, tenant_id, mode_id, window_days, candidate_id, failure_count, department_count, departments, task_ids, tag_ids)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, tenantId, modeId, days, lessonId, rows.length, departments.length, JSON.stringify(departments), JSON.stringify(rows.map((r) => r.task_id)), JSON.stringify(rows.map((r) => r.tag_id))]);
  await audit(c, { tenantId, actor: SYSTEM_PROPOSER, action: 'failure.pattern_candidate', subject: lessonId, result: 'ok', correlationId: opts.correlationId ?? '',
    detail: { patternId: id, modeId, windowDays: days, failures: rows.length, departments, agentId, derivedBy: 'system_failure_pattern' } });
  return { opened: true, candidateId: lessonId, failures: rows.length, departments };
}

/** The patterns that opened candidates, newest first, for an administrator. */
export async function listFailurePatterns(c: Q, tenantId: string): Promise<FailurePatternsDto> {
  const rows = (await c.query(`select p.id, p.mode_id, p.window_days, p.failure_count, p.departments, p.candidate_id, p.origin, p.created_at, l.status
    from failure_pattern_candidates p join lesson_candidates l on l.id = p.candidate_id where p.tenant_id = $1 order by p.created_at desc, p.id limit 200`, [tenantId])).rows;
  return {
    minFailures: FAILURE_PATTERN_MIN_FAILURES, minDepartments: FAILURE_PATTERN_MIN_DEPARTMENTS, windowDays: PATTERN_WINDOW_DAYS,
    patterns: rows.map((r) => ({ id: r.id, modeId: r.mode_id, modeName: failureModeOf(r.mode_id)?.mode.name ?? r.mode_id, windowDays: r.window_days, failures: r.failure_count, departments: r.departments, candidateId: r.candidate_id,
      candidateStatus: r.status, derivedBy: r.origin, createdAt: new Date(r.created_at).toISOString() })),
  };
}
