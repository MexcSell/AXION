// c47: fixtures for evaluation evidence. These write RECORDS only (datasets, cases, runs, results); nothing here runs an
// evaluation or calls a model. Used by tests (and mirrored in web/scripts/api-c47.mjs for the browser check).
import type pg from 'pg';

export interface DatasetOpts { id: string; tenant?: string; split?: 'dev' | 'holdout'; cases?: number; name?: string; freeze?: boolean; /** cases carry this tag in their input (default: the dataset id, so two datasets share no case); give two datasets the same tag to make them overlap */ inputTag?: string }
/** Inserts a dataset with n cases (c01..cNN) and freezes it through eval_freeze_dataset (the hash is computed in the database). */
export async function makeDataset(pool: pg.Pool, o: DatasetOpts): Promise<string[]> {
  const n = o.cases ?? 12;
  await pool.query(`insert into eval_datasets(id, tenant_id, name, version, split) values ($1,$2,$3,1,$4)`, [o.id, o.tenant ?? 't-1', o.name ?? 'set-' + o.id, o.split ?? 'holdout']);
  const ids = Array.from({ length: n }, (_, i) => 'c' + String(i + 1).padStart(2, '0'));
  for (const [i, c] of ids.entries()) await pool.query(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,$2,$3,$4)`, [o.id, c, JSON.stringify({ q: i, text: 'question ' + i, set: o.inputTag ?? o.id }), JSON.stringify({ a: i * 2 })]);
  if (o.freeze !== false) await pool.query(`select eval_freeze_dataset($1)`, [o.id]);
  return ids;
}

export interface RunOpts {
  id: string; tenant?: string; datasetId: string; versionId?: string; proposalId?: string; k?: number;
  /** one entry per case, in case order: a number (all attempts), an array (one score per attempt) or null (a failed attempt) */
  scores: Array<number | null | Array<number | null>>;
  judge?: string | null; evaluator?: string | null; finish?: boolean; cost?: number;
  /** case ids to run; default c01.. in order */
  caseIds?: string[];
}
export async function addRun(pool: pg.Pool, o: RunOpts) {
  const k = o.k ?? 1;
  await pool.query(
    `insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, subject_proposal_id, k, judge_model_family, evaluator_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [o.id, o.tenant ?? 't-1', o.datasetId, o.versionId ?? null, o.proposalId ?? null, k, o.judge === undefined ? 'claude-judge' : o.judge, o.evaluator === undefined ? 'evaluator-user' : o.evaluator]);
  for (const [i, s] of o.scores.entries()) {
    const cid = o.caseIds?.[i] ?? 'c' + String(i + 1).padStart(2, '0');
    const per = Array.isArray(s) ? s : Array.from({ length: k }, () => s);
    for (const [a, sc] of per.entries()) await pool.query(`insert into eval_results(run_id, case_id, attempt, score, cost_units, trace) values ($1,$2,$3,$4,$5,'{"steps":[]}')`, [o.id, cid, a + 1, sc, o.cost ?? 1]);
  }
  if (o.finish !== false) await pool.query(`update eval_runs set finished_at = now() where id=$1`, [o.id]);
}
