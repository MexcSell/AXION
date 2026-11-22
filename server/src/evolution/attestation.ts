import type { Tx } from '../db.ts';

/**
 * c61 (R2-3): dataset attestation. ABC-style, after the Agentic Benchmark Checklist (A3, NeurIPS 2025 Datasets and Benchmarks):
 * task validity, outcome validity, reporting. The item wording is ours; we do not claim the paper's item list. A human fills it in
 * (an approved administrator who is NOT the dataset's author) before the dataset is frozen. Records and validation only: nothing here
 * runs an evaluation. The rules live in SQL (migration 0046) so they hold for any writer; these are thin typed wrappers.
 * Deferred: the per-run "disallowed source reachable" flag (it needs execution).
 */
export type AttestationCategory = 'task_validity' | 'outcome_validity' | 'reporting';
export const ATTESTATION_ITEMS: ReadonlyArray<{ id: string; category: AttestationCategory; text: string }> = [
  { id: 'tv_solvable', category: 'task_validity', text: "Each task can be solved with the information and tools the agent is given." },
  { id: 'tv_environment', category: 'task_validity', text: "The task environment (tools, data, accounts) is available, works, and is reset between attempts." },
  { id: 'tv_no_shortcut', category: 'task_validity', text: "A task cannot be passed by a shortcut: a leaked answer, a memorised benchmark, or a search for the answer outside the allowed sources." },
  { id: 'tv_sources_stated', category: 'task_validity', text: "The information sources each case may use are written down." },
  { id: 'ov_reference_checked', category: 'outcome_validity', text: "The reference answers or checks were verified by a person." },
  { id: 'ov_wrong_rejected', category: 'outcome_validity', text: "Wrong and empty answers were tried, and the grader rejects them." },
  { id: 'ov_equivalent_accepted', category: 'outcome_validity', text: "Correct answers in another form are accepted." },
  { id: 'ov_grader_stable', category: 'outcome_validity', text: "The grader gives the same grade to the same output when run again." },
  { id: 'rp_contamination', category: 'reporting', text: "Known overlap with training or tuning data is stated." },
  { id: 'rp_limits', category: 'reporting', text: "Known flaws, and what the dataset cannot show, are written down." },
  { id: 'rp_noise', category: 'reporting', text: "How noisy a grade is (repeat runs, variance) is stated." },
  { id: 'rp_scoring', category: 'reporting', text: "How each grade is computed, including partial credit and ungraded cases, is written down." },
];
export type AttestationAnswer = { answer: 'yes' | 'no' | 'not_applicable'; /** required (10+ characters) for not_applicable */ note?: string };
export type AttestationAnswers = Record<string, AttestationAnswer>;

export type AttestationCode = 'attestor_is_author' | 'attestor_not_admin' | 'author_unknown' | 'dataset_frozen' | 'attestation_incomplete' | 'attestation_unchanged';

/**
 * Attests an UNFROZEN dataset. The content hash and the version are computed by the database. Throws (the database's message starts
 * with the code): attestor_is_author, attestor_not_admin, author_unknown (the author is not recorded, so the rule cannot be
 * checked), dataset_frozen, attestation_incomplete (a missing item, or not_applicable without a reason), attestation_unchanged.
 */
export async function attestDataset(c: Tx, o: { tenantId: string; datasetId: string; attestorId: string; answers: AttestationAnswers }): Promise<{ version: number; contentSha256: string }> {
  const r = (await c.query(
    `insert into eval_attestations(tenant_id, dataset_id, version, content_sha256, attestor_id, answers) values ($1,$2,0,'',$3,$4::jsonb) returning version, content_sha256`,
    [o.tenantId, o.datasetId, o.attestorId, JSON.stringify(o.answers)])).rows[0];
  return { version: r.version, contentSha256: r.content_sha256 };
}

export interface DatasetValidity {
  /** true unless an attestation whose hash matches the frozen content has no "no" answer; the verdict shows this flag */
  unvalidated: boolean;
  status: 'attested' | 'failing' | 'unattested';
  /** the attestation version that matched the content at the freeze */
  version: number | null;
  /** items answered "no" in that version */
  failedItems: string[];
  /** false for a dataset created before its author was recorded: the "not the author" rule cannot be checked, so it can never be attested */
  canBeAttested: boolean;
}
/** What a verdict on this dataset says about its validity. Unattested (and unfrozen, and unknown) datasets are flagged, never refused. */
export async function datasetValidity(c: Tx, datasetId: string): Promise<DatasetValidity> {
  const r = (await c.query(
    `select d.attested_version v, a.answers, d.created_by is not null as author from eval_datasets d left join eval_attestations a on a.dataset_id = d.id and a.version = d.attested_version where d.id = $1 and d.frozen_at is not null`, [datasetId])).rows[0] as { v: number | null; answers: AttestationAnswers | null; author: boolean } | undefined;
  const canBeAttested = !!r?.author;
  if (!r || r.v === null || !r.answers) return { unvalidated: true, status: 'unattested', version: null, failedItems: [], canBeAttested };
  const failed = Object.entries(r.answers).filter(([, a]) => a.answer === 'no').map(([id]) => id).sort();
  return failed.length ? { unvalidated: true, status: 'failing', version: r.v, failedItems: failed, canBeAttested } : { unvalidated: false, status: 'attested', version: r.v, failedItems: [], canBeAttested };
}
