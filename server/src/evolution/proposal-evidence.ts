import type { Tx } from '../db.ts';
import { hashDataset, verdictV2, type Attempt, type CaseRuns } from './verdict-v2.ts';
import type { EvalRefusalDto, ProposalEvaluationDto } from '../../../shared/contracts/src/index.ts';

/**
 * c47 (E1b): evaluation evidence for an agent version proposal, computed ONLY from stored rows.
 *  - the candidate's runs name the proposal (eval_runs.subject_proposal_id); the base's runs name the base version;
 *  - both are read on the same frozen dataset, the latest finished run of each subject;
 *  - the dataset hash is recomputed here from the stored cases (hashDataset), never taken from a request;
 *  - judge family and evaluator come from the candidate's run row, the author from the proposal row;
 *  - everything goes to verdictV2. Nothing runs an evaluation and nothing here promotes anything.
 * No run for the proposal (finished) -> no evaluation (null).
 */

/** The leading alphabetic run of the model id after any provider prefix: 'anthropic/claude-3' and 'claude-sonnet' are both 'claude'. */
export function modelFamily(model: string): string {
  const last = String(model ?? '').trim().toLowerCase().split('/').pop() ?? '';
  return /^[a-z]+/.exec(last)?.[0] ?? last;
}

export interface EvidenceSubject { id: string; created_by: string; base_version_id: string; candidate: unknown }

interface RunRow { id: string; dataset_id: string; k: number; judge_model_family: string | null; evaluator_id: string | null; split: 'dev' | 'holdout'; content_sha256: string | null; subject_proposal_id: string }

const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));

async function caseRuns(c: Tx, runId: string): Promise<CaseRuns[]> {
  const rows = (await c.query(`select case_id, attempt, score, cost_units from eval_results where run_id=$1 order by case_id, attempt`, [runId])).rows;
  const by = new Map<string, Attempt[]>();
  for (const r of rows) {
    const a = by.get(r.case_id) ?? [];
    a.push({ score: num(r.score), costUnits: Number(r.cost_units) });
    by.set(r.case_id, a);
  }
  return [...by].map(([caseId, attempts]) => ({ caseId, attempts }));
}

/** Evaluations for the given proposals (those without a finished candidate run are absent from the map). */
export async function loadEvaluations(c: Tx, tenantId: string, proposals: EvidenceSubject[]): Promise<Map<string, ProposalEvaluationDto>> {
  const out = new Map<string, ProposalEvaluationDto>();
  if (!proposals.length) return out;
  const runs = (await c.query(
    `select r.id, r.dataset_id, r.k, r.judge_model_family, r.evaluator_id, r.subject_proposal_id, d.split, d.content_sha256
       from eval_runs r join eval_datasets d on d.id = r.dataset_id
      where r.tenant_id=$1 and r.subject_proposal_id = any($2) and r.finished_at is not null
      order by r.started_at desc, r.id desc`, [tenantId, proposals.map((p) => p.id)])).rows as RunRow[];
  for (const p of proposals) {
    const mine = runs.filter((r) => r.subject_proposal_id === p.id);
    if (!mine.length) continue;
    // a holdout run is the evidence; a dev run is only used (and refused) when there is no holdout run
    const cand = mine.find((r) => r.split === 'holdout') ?? mine[0];
    const tuned = [...new Set(mine.filter((r) => r.split === 'dev').map((r) => r.dataset_id))];
    const base = (await c.query(
      `select id from eval_runs where tenant_id=$1 and subject_version_id=$2 and dataset_id=$3 and finished_at is not null order by started_at desc, id desc limit 1`,
      [tenantId, p.base_version_id, cand.dataset_id])).rows[0] as { id: string } | undefined;
    const cases = (await c.query(`select case_id as "caseId", input, expected from eval_cases where dataset_id=$1`, [cand.dataset_id])).rows as Array<{ caseId: string; input: unknown; expected: unknown }>;
    const baseline = base ? await caseRuns(c, base.id) : [];
    const candidate = await caseRuns(c, cand.id);
    const model = typeof (p.candidate as { model?: unknown })?.model === 'string' ? (p.candidate as { model: string }).model : '';

    const v = verdictV2({
      baseline, candidate,
      holdout: { datasetId: cand.dataset_id, split: cand.split, frozenSha256: cand.content_sha256, observedSha256: hashDataset(cases) },
      tunedOnDatasetIds: tuned,
      authorId: p.created_by, evaluatorId: cand.evaluator_id ?? '',
      candidateModelFamily: modelFamily(model), judgeModelFamily: cand.judge_model_family ? modelFamily(cand.judge_model_family) : '',
    });

    // checks that need the dataset itself: it has cases, and both runs cover all of them with every attempt
    const extra: EvalRefusalDto[] = [];
    const ids = new Set(cases.map((x) => x.caseId));
    if (!ids.size) extra.push({ code: 'empty_dataset', detail: `dataset ${cand.dataset_id} has no cases` });
    else {
      const gaps = (rows: CaseRuns[], k: number) => [...ids].filter((id) => rows.find((r) => r.caseId === id)?.attempts.length !== k).length;
      const gb = base ? gaps(baseline, (await c.query('select k from eval_runs where id=$1', [base.id])).rows[0].k) : 0;
      const gc = gaps(candidate, cand.k);
      if (gb || gc) extra.push({ code: 'partial_coverage', detail: `a run does not cover every case of the dataset with all its attempts (base: ${gb} short, candidate: ${gc} short)` });
    }

    const refusals = [...v.refusals, ...extra];
    let outcome: ProposalEvaluationDto['outcome'] = 'inconclusive';
    if (!refusals.length) {
      if (v.outcome === 'verified_better') outcome = 'verified_better';
      else if (v.outcome === 'not_better' && v.signTest.losses > v.signTest.wins) outcome = 'worse'; // significantly worse
    }
    out.set(p.id, {
      outcome, n: v.cases, wins: v.signTest.wins, losses: v.signTest.losses, ties: v.signTest.ties, k: v.k, delta: v.delta,
      ci: { low: v.ci.low, high: v.ci.high }, baselineMean: v.baselineMean, candidateMean: v.candidateMean,
      passHatK: v.passHatK, refusals, reasons: [...v.reasons, ...extra.map((e) => e.detail)], notes: v.notes,
      datasetId: cand.dataset_id, datasetSha: cand.content_sha256, baseRunId: base?.id ?? null, candidateRunId: cand.id,
    });
  }
  return out;
}
