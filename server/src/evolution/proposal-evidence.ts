import { createHash } from 'node:crypto';
import type { Tx } from '../db.ts';
import { hashDataset, verdictV2, type Attempt, type CaseRuns } from './verdict-v2.ts';
import { datasetValidities } from './attestation.ts';
import { modelFamily as vendorOf } from '../tasks/review-rules.ts';
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

/**
 * c53: when does a dev dataset "share cases" with the holdout? Count DISTINCT holdout inputs that also appear in a dev dataset the
 * candidate ran on. An input that repeats across cases (in the holdout, or in that dev dataset) is generic (`1`, `{}`, "What is
 * 2+2?" asked twelve times) and is not counted; a short input that is unique to its case IS counted, so a wholesale copy of short
 * prompts is caught. The datasets are linked when at least max(MIN_REUSE_OVERLAP, min(10% of the holdout, REUSE_OVERLAP_CAP))
 * inputs are shared (capped at the holdout's size), so a leak of 9 cases in a 100-case holdout still counts. Case ids are not compared.
 */
/** c70 (E1d): the repeat exemption covers SHORT inputs only (canonical JSON text shorter than this). A long input repeated on either side is a real input, so duplicating long inputs cannot hide a leak. */
export const REPEAT_EXEMPT_MAX_LEN = 20;
export const MIN_REUSE_OVERLAP = 2;
export const REUSE_OVERLAP_SHARE = 0.1;
export const REUSE_OVERLAP_CAP = 5;

export interface EvidenceSubject { id: string; created_by: string; base_version_id: string; candidate: unknown }

interface RunRow { id: string; dataset_id: string; k: number; judge_model_family: string | null; evaluator_id: string | null; grader_name: string | null; grader_version: string | null; split: 'dev' | 'holdout'; content_sha256: string | null; subject_proposal_id: string; finished_at: string | null }

/** What a decision is bound to: the runs, the dataset hash, the outcome and the refusal codes; a fixed value when there is no evaluation. */
export function evaluationSha(e: ProposalEvaluationDto | null): string {
  const body = e ? [e.candidateRunId, e.baseRunId, e.datasetId, e.datasetSha, e.outcome, e.runCount, e.refusals.map((r) => r.code).sort(), e.grading, e.validity] : 'no-evaluation';
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));

/** c70: the plain (not re-graded) results of many runs in one query. */
async function caseRunsMany(c: Tx, runIds: string[]): Promise<Map<string, CaseRuns[]>> {
  const out = new Map<string, CaseRuns[]>();
  const ids = [...new Set(runIds)];
  if (!ids.length) return out;
  const rows = (await c.query(`select run_id, case_id, attempt, score, cost_units, ungraded_reason from eval_results where run_id = any($1) order by run_id, case_id, attempt`, [ids])).rows;
  const by = new Map<string, Map<string, Attempt[]>>();
  for (const id of ids) by.set(id, new Map());
  for (const r of rows) {
    const m = by.get(r.run_id)!;
    const a = m.get(r.case_id) ?? [];
    a.push({ score: num(r.score), costUnits: Number(r.cost_units), ungraded: r.ungraded_reason ?? null });
    m.set(r.case_id, a);
  }
  for (const [id, m] of by) out.set(id, [...m].map(([caseId, attempts]) => ({ caseId, attempts })));
  return out;
}

/** The stored results of a run. With `regradeId`, the grades of that re-grade diff replace the stored ones (cost stays). */
async function caseRuns(c: Tx, runId: string, regradeId: string | null = null): Promise<CaseRuns[]> {
  const rows = (await c.query(
    regradeId
      ? `select r.case_id, r.attempt, case when x.regrade_id is null then r.score else x.new_score end as score, r.cost_units,
                case when x.regrade_id is null then r.ungraded_reason else x.new_ungraded_reason end as ungraded_reason
           from eval_results r left join eval_regrade_cases x on x.regrade_id=$2 and x.case_id=r.case_id and x.attempt=r.attempt where r.run_id=$1 order by r.case_id, r.attempt`
      : `select case_id, attempt, score, cost_units, ungraded_reason from eval_results where run_id=$1 order by case_id, attempt`, regradeId ? [runId, regradeId] : [runId])).rows;
  const by = new Map<string, Attempt[]>();
  for (const r of rows) {
    const a = by.get(r.case_id) ?? [];
    a.push({ score: num(r.score), costUnits: Number(r.cost_units), ungraded: r.ungraded_reason ?? null });
    by.set(r.case_id, a);
  }
  return [...by].map(([caseId, attempts]) => ({ caseId, attempts }));
}

type GraderRow = { grader_name: string | null; grader_version: string | null };
const graderOf = (r: GraderRow | undefined | null) => (r?.grader_name && r.grader_version ? { name: r.grader_name, version: r.grader_version } : null);
/** c61: a re-grade diff of `run` from its own grader to `to` that covers every stored result of the run (the diff that links it to a run graded by `to`). */
async function linkingRegrade(c: Tx, runId: string, from: { name: string; version: string }, to: { name: string; version: string }, proposalAuthor: string): Promise<{ id: string; by: string; byName: string } | null> {
  // covers every GRADED result of the run (an ungraded result need not be covered and stays ungraded); not by the proposal's author
  const r = (await c.query(
    `select g.id, g.created_by as by, u.name as "byName" from eval_regrades g join users u on u.id = g.created_by
      where g.run_id=$1 and (g.from_grader_name, g.from_grader_version) = ($2,$3) and (g.to_grader_name, g.to_grader_version) = ($4,$5) and g.created_by <> $6
        and (select count(*) from eval_regrade_cases x join eval_results e on e.run_id = g.run_id and e.case_id = x.case_id and e.attempt = x.attempt and e.ungraded_reason is null where x.regrade_id = g.id)
          = (select count(*) from eval_results where run_id = $1 and ungraded_reason is null)
      order by g.created_at, g.id limit 1`, [runId, from.name, from.version, to.name, to.version, proposalAuthor])).rows[0];
  return r ? { id: r.id, by: r.by, byName: r.byName } : null;
}

/** Evaluations for the given proposals (those without a finished candidate run are absent from the map). */
export async function loadEvaluations(c: Tx, tenantId: string, proposals: EvidenceSubject[]): Promise<Map<string, ProposalEvaluationDto>> {
  const out = new Map<string, ProposalEvaluationDto>();
  if (!proposals.length) return out;
  const runs = (await c.query(
    `select r.id, r.dataset_id, r.k, r.judge_model_family, r.evaluator_id, r.grader_name, r.grader_version, r.subject_proposal_id, r.finished_at, d.split, d.content_sha256
       from eval_runs r join eval_datasets d on d.id = r.dataset_id
      where r.tenant_id=$1 and r.subject_proposal_id = any($2)
      order by r.started_at desc, r.id desc`, [tenantId, proposals.map((p) => p.id)])).rows as RunRow[];
  // c70: everything every proposal needs from its candidate dataset and runs is read ONCE for all proposals (the query count no longer grows with the number of proposals)
  const pick = (p: EvidenceSubject) => {
    const mine = runs.filter((r) => r.subject_proposal_id === p.id && r.finished_at);
    // a holdout run is the evidence; a dev run is only used (and refused) when there is no holdout run
    return { mine, cand: mine.find((r) => r.split === 'holdout') ?? mine[0] };
  };
  const live = proposals.map((p) => ({ p, ...pick(p) })).filter((x) => x.mine.length);
  if (!live.length) return out;
  const pids = live.map((x) => x.p.id), dsIds = live.map((x) => x.cand.dataset_id);
  const runCounts = new Map((await c.query(
    `select u.pid, count(r.id)::int n
       from unnest($2::text[], $3::text[]) as u(pid, ds)
       join agent_version_proposals me on me.id = u.pid
       join agent_version_proposals q on q.agent_id = me.agent_id and eval_canon_config(q.candidate) = eval_canon_config(me.candidate)
       join eval_datasets d1 on d1.id = u.ds
       join eval_datasets d2 on d2.tenant_id = d1.tenant_id and d2.split = d1.split and d2.content_sha256 = d1.content_sha256
       join eval_runs r on r.subject_proposal_id = q.id and r.dataset_id = d2.id and r.tenant_id = $1
      group by u.pid`, [tenantId, pids, dsIds])).rows.map((r) => [r.pid as string, Number(r.n)] as const));
  const bases = new Map((await c.query(
    `select distinct on (u.pid) u.pid, r.id, r.k, r.judge_model_family, r.evaluator_id, r.grader_name, r.grader_version
       from unnest($2::text[], $3::text[], $4::text[]) as u(pid, bv, ds)
       join eval_runs r on r.tenant_id = $1 and r.subject_version_id::text = u.bv and r.dataset_id = u.ds and r.finished_at is not null
      order by u.pid, r.started_at desc, r.id desc`, [tenantId, pids, live.map((x) => x.p.base_version_id), dsIds])).rows.map((r) => [r.pid as string, r as { id: string; k: number; judge_model_family: string | null; evaluator_id: string | null; grader_name: string | null; grader_version: string | null }] as const));
  const caseRows = (await c.query(`select dataset_id, case_id as "caseId", input, expected from eval_cases where dataset_id = any($1)`, [[...new Set(dsIds)]])).rows as Array<{ dataset_id: string; caseId: string; input: unknown; expected: unknown }>;
  const casesBy = new Map<string, Array<{ caseId: string; input: unknown; expected: unknown }>>();
  for (const r of caseRows) { const a = casesBy.get(r.dataset_id) ?? []; a.push({ caseId: r.caseId, input: r.input, expected: r.expected }); casesBy.set(r.dataset_id, a); }
  const validities = await datasetValidities(c, dsIds);
  const plainRuns = await caseRunsMany(c, [...live.map((x) => x.cand.id), ...[...bases.values()].map((b) => b.id)]);
  for (const { p, mine, cand } of live) {
    const devIds = [...new Set(mine.filter((r) => r.split === 'dev').map((r) => r.dataset_id))];
    const tuned = [...devIds];
    // a dev dataset the candidate ran on that shares cases with the holdout means the holdout leaks into tuning (c53: real overlap only)
    if (cand.split === 'holdout' && devIds.length) {
      const o = (await c.query(
        `with h as (select input, count(*) n from eval_cases where dataset_id=$1 group by input),
              d as (select input, max(n) n from (select input, count(*) n from eval_cases where dataset_id = any($2) group by dataset_id, input) x group by input)
         select (select count(*) from h join d using (input) where (h.n = 1 and d.n = 1) or length(input::text) >= ${REPEAT_EXEMPT_MAX_LEN})::int as shared, (select count(*) from eval_cases where dataset_id=$1)::int as total`,
        [cand.dataset_id, devIds])).rows[0] as { shared: number; total: number };
      if (o.total && o.shared >= Math.min(o.total, Math.max(MIN_REUSE_OVERLAP, Math.min(REUSE_OVERLAP_CAP, Math.ceil(o.total * REUSE_OVERLAP_SHARE))))) tuned.push(cand.dataset_id);
    }
    // c53/c70: runs of ANY proposal with the same agent and candidate config on this dataset count (withdraw and re-propose buys nothing)
    const runCount = runCounts.get(p.id) ?? 0;
    const holdoutSets = new Set(mine.filter((r) => r.split === 'holdout').map((r) => r.dataset_id));
    const base = bases.get(p.id);
    const cases = casesBy.get(cand.dataset_id) ?? [];
    // c61: graders must match, or a re-grade diff links the two; a linked comparison uses the NEW grades of the re-graded run
    const gBase = graderOf(base), gCand = graderOf(cand);
    let regradeBase: { id: string; by: string; byName: string } | null = null, regradeCand: { id: string; by: string; byName: string } | null = null;
    if (base && gBase && gCand && (gBase.name !== gCand.name || gBase.version !== gCand.version)) {
      regradeBase = await linkingRegrade(c, base.id, gBase, gCand, p.created_by);
      if (!regradeBase) regradeCand = await linkingRegrade(c, cand.id, gCand, gBase, p.created_by);
    }
    const linked = !!(regradeBase || regradeCand);
    const baseline = base ? (regradeBase ? await caseRuns(c, base.id, regradeBase.id) : plainRuns.get(base.id) ?? []) : [];
    const candidate = regradeCand ? await caseRuns(c, cand.id, regradeCand.id) : plainRuns.get(cand.id) ?? [];
    const model = typeof (p.candidate as { model?: unknown })?.model === 'string' ? (p.candidate as { model: string }).model : '';
    // c53: families are the c38 vendors; an unresolved label (judge or candidate model) is refused, never defaulted
    const candVendor = vendorOf(model);
    const judgeVendor = cand.judge_model_family ? vendorOf(cand.judge_model_family) : null;
    const candFamily = candVendor ?? modelFamily(model);

    const v = verdictV2({
      baseline, candidate,
      holdout: { datasetId: cand.dataset_id, split: cand.split, frozenSha256: cand.content_sha256, observedSha256: hashDataset(cases) },
      tunedOnDatasetIds: tuned,
      authorId: p.created_by, evaluatorId: cand.evaluator_id ?? '',
      candidateModelFamily: candFamily, judgeModelFamily: cand.judge_model_family ? (judgeVendor ?? modelFamily(cand.judge_model_family)) : '',
      ...(base ? { graders: { baseline: gBase, candidate: gCand, linked } } : {}),
    });

    // checks that need the dataset itself: it has cases, and both runs cover all of them with every attempt
    const extra: EvalRefusalDto[] = [];
    const ids = new Set(cases.map((x) => x.caseId));
    if (!ids.size) extra.push({ code: 'empty_dataset', detail: `dataset ${cand.dataset_id} has no cases` });
    else {
      const gaps = (rows: CaseRuns[], k: number) => [...ids].filter((id) => rows.find((r) => r.caseId === id)?.attempts.length !== k).length;
      const gb = base ? gaps(baseline, base.k) : 0;
      const gc = gaps(candidate, cand.k);
      if (gb || gc) extra.push({ code: 'partial_coverage', detail: `a run does not cover every case of the dataset with all its attempts (base: ${gb} short, candidate: ${gc} short)` });
    }

    if (cand.judge_model_family?.trim() && !judgeVendor) extra.push({ code: 'judge_label_unknown', detail: `the judge label "${cand.judge_model_family.trim()}" does not resolve to a vendor in the model family table, so independence cannot be shown` });
    if (!candVendor) extra.push({ code: 'candidate_family_unknown', detail: `the candidate model "${model || 'none'}" does not resolve to a vendor in the model family table, so independence from the judge cannot be shown` });
    // the base run is held to the same rules as the candidate's: an independent evaluator and a judge of another family
    if (base) {
      if (!base.evaluator_id?.trim() || base.evaluator_id.trim().toLowerCase() === p.created_by.trim().toLowerCase()) extra.push({ code: 'base_evaluator_is_author', detail: 'the base version run was evaluated by the author of the candidate (or has no evaluator); someone else must evaluate it' });
      if (!base.judge_model_family?.trim() || !vendorOf(base.judge_model_family) || vendorOf(base.judge_model_family) === candVendor) extra.push({ code: 'base_self_judging', detail: `the base version run was judged by ${base.judge_model_family || 'no recorded judge'}, the candidate's own model family; a different family must judge it` });
    }
    // a holdout is used once: more runs on it, or runs on several holdouts, let the best result be picked
    if (runCount > 1 || holdoutSets.size > 1) extra.push({ code: 'holdout_rerun', detail: runCount > 1 ? `this candidate has ${runCount} runs on holdout ${cand.dataset_id}; a holdout counts once, so freeze a fresh holdout dataset and evaluate once on it` : `this candidate was evaluated on ${holdoutSets.size} holdout datasets; evaluate once on one fresh holdout dataset` });

    const refusals = [...v.refusals, ...extra];
    let outcome: ProposalEvaluationDto['outcome'] = 'inconclusive';
    if (!refusals.length) {
      if (v.outcome === 'verified_better') outcome = 'verified_better';
      else if (v.worse) outcome = 'worse'; // significantly worse, a lower mean, or the whole 95% interval below 0, and it survives the worst case for ungraded cases
    }
    out.set(p.id, {
      outcome, n: v.cases, wins: v.signTest.wins, losses: v.signTest.losses, ties: v.signTest.ties, k: v.k, delta: v.delta,
      ci: { low: v.ci.low, high: v.ci.high }, baselineMean: v.baselineMean, candidateMean: v.candidateMean,
      passHatK: v.passHatK, refusals, reasons: [...v.reasons, ...extra.map((e) => e.detail)], notes: v.notes,
      grading: {
        baseline: base ? { ...v.grading.baseline, graderName: regradeBase ? gCand!.name : gBase?.name ?? null, graderVersion: regradeBase ? gCand!.version : gBase?.version ?? null } : null,
        candidate: { ...v.grading.candidate, graderName: regradeCand ? gBase!.name : gCand?.name ?? null, graderVersion: regradeCand ? gBase!.version : gCand?.version ?? null },
        excludedCases: v.grading.excludedCases, sufficient: v.grading.sufficient, minFraction: v.grading.minFraction, retained: v.grading.retained, robust: v.grading.robust, regrade: regradeBase ?? regradeCand,
      },
      validity: validities.get(cand.dataset_id)!,
      datasetId: cand.dataset_id, datasetSha: cand.content_sha256, baseRunId: base?.id ?? null, candidateRunId: cand.id, runCount,
    });
  }
  return out;
}
