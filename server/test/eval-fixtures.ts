// c47: fixtures for evaluation evidence. These write RECORDS only (datasets, cases, runs, results); nothing here runs an
// evaluation or calls a model. Used by tests (and mirrored in web/scripts/api-c47.mjs for the browser check).
import type pg from 'pg';
import { ATTESTATION_ITEMS, attestDataset } from '../src/evolution/attestation.ts';

/** every attestation item answered yes */
export const allYes = () => Object.fromEntries(ATTESTATION_ITEMS.map((i) => [i.id, { answer: 'yes' as const }]));

export interface DatasetOpts { id: string; tenant?: string; split?: 'dev' | 'holdout'; cases?: number; name?: string; freeze?: boolean; /** cases carry this tag in their input (default: the dataset id, so two datasets share no case); give two datasets the same tag to make them overlap */ inputTag?: string;
  /** c61: who wrote the dataset (the attestor must be someone else); omitted = not recorded */ createdBy?: string;
  /** c61: an administrator who attests the dataset (every item answered yes) before it is frozen; omitted = frozen without an attestation */ attestBy?: string }
/** Inserts a dataset with n cases (c01..cNN) and freezes it through eval_freeze_dataset (the hash is computed in the database). */
export async function makeDataset(pool: pg.Pool, o: DatasetOpts): Promise<string[]> {
  const n = o.cases ?? 12;
  await pool.query(`insert into eval_datasets(id, tenant_id, name, version, split, created_by) values ($1,$2,$3,1,$4,$5)`, [o.id, o.tenant ?? 't-1', o.name ?? 'set-' + o.id, o.split ?? 'holdout', o.createdBy ?? null]);
  const ids = Array.from({ length: n }, (_, i) => 'c' + String(i + 1).padStart(2, '0'));
  for (const [i, c] of ids.entries()) await pool.query(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,$2,$3,$4)`, [o.id, c, JSON.stringify({ q: i, text: 'question ' + i, set: o.inputTag ?? o.id }), JSON.stringify({ a: i * 2 })]);
  if (o.attestBy) {
    const c = await pool.connect();
    try { await attestDataset(c, { tenantId: o.tenant ?? 't-1', datasetId: o.id, attestorId: o.attestBy, answers: allYes() }); } finally { c.release(); }
  }
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
  /** c53: finish a run that is missing results. The guard refuses that, so only a fixture for the loader's partial_coverage refusal may ask (it switches the run guard off for the one UPDATE, as a superuser could) */
  partialFinish?: boolean;
  /** c61: the grader that scored the run (name and version); omitted = a default fixture grader (a run with no grader is `unknown` to the verdict since the c61 fix round); null = not recorded */
  grader?: { name: string; version: string } | null;
  /** c61: case index (0-based, as in `scores`) -> reason code: those cases have NO grade (every attempt ungraded; the score is stored as NULL) */
  ungraded?: Record<number, string>;
}
export async function addRun(pool: pg.Pool, o0: RunOpts) {
  const o: RunOpts = { ...o0, grader: o0.grader === undefined ? { name: 'fixture-grader', version: '1' } : o0.grader };
  const k = o.k ?? 1;
  await pool.query(
    o.grader
      ? `insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, subject_proposal_id, k, judge_model_family, evaluator_id, grader_name, grader_version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
      : `insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, subject_proposal_id, k, judge_model_family, evaluator_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [o.id, o.tenant ?? 't-1', o.datasetId, o.versionId ?? null, o.proposalId ?? null, k, o.judge === undefined ? 'claude-judge' : o.judge, o.evaluator === undefined ? 'evaluator-user' : o.evaluator, ...(o.grader ? [o.grader.name, o.grader.version] : [])]);
  for (const [i, s] of o.scores.entries()) {
    const cid = o.caseIds?.[i] ?? 'c' + String(i + 1).padStart(2, '0');
    const per = Array.isArray(s) ? s : Array.from({ length: k }, () => s);
    const why = o.ungraded?.[i] ?? null;
    for (const [a, sc] of per.entries()) await pool.query(
      why ? `insert into eval_results(run_id, case_id, attempt, score, cost_units, trace, ungraded_reason) values ($1,$2,$3,$4,$5,'{"steps":[]}',$6)`
          : `insert into eval_results(run_id, case_id, attempt, score, cost_units, trace) values ($1,$2,$3,$4,$5,'{"steps":[]}')`,
      [o.id, cid, a + 1, why ? null : sc, o.cost ?? 1, ...(why ? [why] : [])]);
  }
  if (o.finish === false) return;
  if (!o.partialFinish) { await pool.query(`update eval_runs set finished_at = now() where id=$1`, [o.id]); return; }
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('alter table eval_runs disable trigger eval_runs_guard');
    await c.query(`update eval_runs set finished_at = now() where id=$1`, [o.id]);
    await c.query('alter table eval_runs enable trigger eval_runs_guard'); await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
