import type { Tx } from '../db.ts';

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
          where r.tenant_id=$1 and r.dataset_id=$2 and (p.agent_id, p.candidate_sha) = (me.agent_id, me.candidate_sha) and r.holdout_key is not null limit 1`
      : `select r.id from eval_runs r where r.tenant_id=$1 and r.dataset_id=$2 and r.subject_version_id=$3 and r.holdout_key is not null limit 1`,
    [o.tenantId, o.datasetId, o.proposalId ?? o.versionId])).rows[0] as { id: string } | undefined;
  return r ? { id: r.id, state: (await runState(c, r.id))! } : null;
}
