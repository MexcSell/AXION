import type { Tx } from '../db.ts';
import { modelFamily as vendorOf } from '../tasks/review-rules.ts';

/**
 * Judge labels. A judge is named by a model label ('claude-sonnet-4', 'anthropic/claude-3.5', 'us.anthropic.claude-3'). Its family is
 * the VENDOR from the c38 alias table (tasks/review-rules.ts, the trust boundary of the independence rule). A label the table cannot
 * resolve is refused: `judge_label_missing` (empty), `judge_label_unknown` (no table entry matches) or `judge_label_ambiguous` (a
 * vendor prefix contradicts the model, 'anthropic/gpt-4'). There is no default family.
 */
export type JudgeLabelCode = 'judge_label_missing' | 'judge_label_unknown' | 'judge_label_ambiguous';
export class JudgeLabelError extends Error {
  constructor(readonly code: JudgeLabelCode, message: string) { super(message); this.name = 'JudgeLabelError'; }
}
export function judgeFamily(label: unknown): string {
  if (typeof label !== 'string' || !label.trim()) throw new JudgeLabelError('judge_label_missing', 'the judge model label is missing; name the judge model');
  const vendor = vendorOf(label);
  if (vendor) return vendor;
  const tail = label.trim().toLowerCase().split('/').pop() ?? '';
  if (vendorOf(tail) || vendorOf(tail.replace(/^(?:[a-z]{2,4}\.)?[a-z]+\./, ''))) throw new JudgeLabelError('judge_label_ambiguous', `the judge label "${label.trim()}" names one vendor in its prefix and another in its model name; use the plain model name`);
  throw new JudgeLabelError('judge_label_unknown', `the judge label "${label.trim()}" matches no vendor in the model family table; it cannot be used to show independence`);
}

/**
 * c53 (E1c): the service layer any future eval-run writer must call. Records and validation only: nothing here starts a run,
 * executes an evaluation or calls a model, and there is no route for it. The rules live in SQL (migration 0040) so they hold
 * for any writer; these are thin typed wrappers.
 *
 * Run states:
 *   open      not finished and at least one (case, attempt) result is missing (a crashed run is open): resume it
 *   complete  not finished, every case has every attempt 1..k recorded (a failed attempt is a result with a NULL score)
 *   finished  immutable
 */
export const RUN_STATES = ['open', 'complete', 'finished'] as const;
export type RunState = typeof RUN_STATES[number];

export async function runState(c: Tx, runId: string): Promise<RunState | null> {
  return ((await c.query(`select eval_run_state($1) as s`, [runId])).rows[0].s ?? null) as RunState | null;
}
/** What an open run still needs. Throws for an unknown run and for a finished (immutable) one. */
export async function missingResults(c: Tx, runId: string): Promise<Array<{ caseId: string; attempt: number }>> {
  return (await c.query(`select case_id as "caseId", attempt from eval_run_missing($1)`, [runId])).rows;
}
/** Finishes a complete run (once). Throws run_incomplete for an open run, and for an unknown or finished one. */
export async function finishRun(c: Tx, runId: string): Promise<void> {
  await c.query(`select eval_finish_run($1)`, [runId]);
}
/** The run already holding this subject's one slot on a holdout dataset (the one to resume or leave alone), or null. */
export async function existingRun(c: Tx, o: { tenantId: string; datasetId: string; proposalId?: string; versionId?: string }): Promise<{ id: string; state: RunState } | null> {
  if (!!o.proposalId === !!o.versionId) throw new Error('name exactly one subject: a proposal or a version');
  const r = (await c.query(
    o.proposalId
      ? `select r.id from eval_runs r join agent_version_proposals p on p.id = r.subject_proposal_id join agent_version_proposals me on me.id = $3
          where r.tenant_id=$1 and r.dataset_id=$2 and (p.agent_id, eval_canon_config(p.candidate)) = (me.agent_id, eval_canon_config(me.candidate)) and r.holdout_key is not null limit 1`
      : `select r.id from eval_runs r where r.tenant_id=$1 and r.dataset_id=$2 and r.subject_version_id=$3 and r.holdout_key is not null limit 1`,
    [o.tenantId, o.datasetId, o.proposalId ?? o.versionId])).rows[0] as { id: string } | undefined;
  return r ? { id: r.id, state: (await runState(c, r.id))! } : null;
}

export interface StartRunInput { id: string; tenantId: string; datasetId: string; proposalId?: string; versionId?: string; k: number; judgeLabel: string; evaluatorId: string }
/**
 * The writer-side check for a new run record: the judge label must resolve (judgeFamily) and the evaluator must be named. The holdout
 * rules (one run per subject, frozen dataset, tenant) are enforced by the database on the INSERT. Not a route: nothing calls this yet.
 */
export async function startRun(c: Tx, o: StartRunInput): Promise<void> {
  if (!!o.proposalId === !!o.versionId) throw new Error('name exactly one subject: a proposal or a version');
  judgeFamily(o.judgeLabel);
  if (!o.evaluatorId?.trim()) throw new Error('the evaluator is missing; name who evaluates the run');
  try {
    await c.query(
    `insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, subject_proposal_id, k, judge_model_family, evaluator_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [o.id, o.tenantId, o.datasetId, o.versionId ?? null, o.proposalId ?? null, o.k, o.judgeLabel.trim(), o.evaluatorId.trim()]);
  } catch (e) { throw mapRunInsertError(e); }
}
/** The loser of a race for the same holdout slot fails on the unique index (23505) before any trigger can name it: map it to the named refusal. */
export class HoldoutRerunError extends Error {
  readonly code = 'holdout_rerun';
  constructor() { super('holdout_rerun: another run took this subject\'s one slot on the holdout dataset at the same moment; resume that run, or freeze a fresh holdout dataset'); this.name = 'HoldoutRerunError'; }
}
export function mapRunInsertError(e: unknown): unknown {
  const x = e as { code?: string; constraint?: string };
  return x?.code === '23505' && x.constraint === 'eval_runs_holdout_once' ? new HoldoutRerunError() : e;
}
