import { MIN_AGREEMENT_N, type ReviewerAgreement, type ReviewVerdict } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 38: the pure rules of independent task review.
 *
 * Model family: the lower-cased leading letters of the model name ('claude-opus-5-5' -> 'claude', 'gpt-4o' -> 'gpt').
 * It is the vendor lineage, not the size tier: a model prefers output of its own lineage (2404.13076), so a claude-haiku
 * reviewer is not independent of a claude-opus producer. null when the name has no letters to go on (unknown: never independent).
 */
export function modelFamily(model: string | null | undefined): string | null {
  const m = /^[a-z]+/.exec(String(model ?? '').trim().toLowerCase());
  return m ? m[0] : null;
}

export interface ReviewRef { taskId: string; reviewerKey: string; verdict: ReviewVerdict; seq: number }

/**
 * Reviewer agreement. For each review R of a task, the "later review" is the first review of the SAME task with a higher seq
 * by a DIFFERENT reviewer. R is comparable only when one exists, and it agrees when both verdicts are equal. A reviewer's
 * own later reviews are ignored (changing your mind is not a second opinion). rate = agreed / n (null when n is 0); the
 * state is 'ok' only from MIN_AGREEMENT_N comparable reviews, below it the number is not shown ("not enough evidence").
 */
export function reviewerAgreement(reviews: ReviewRef[]): Map<string, ReviewerAgreement> {
  const byTask = new Map<string, ReviewRef[]>();
  for (const r of reviews) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r]);
  const tally = new Map<string, { agreed: number; n: number }>();
  for (const r of reviews) if (!tally.has(r.reviewerKey)) tally.set(r.reviewerKey, { agreed: 0, n: 0 });
  for (const list of byTask.values()) {
    const ordered = [...list].sort((a, b) => a.seq - b.seq);
    ordered.forEach((r, i) => {
      const later = ordered.slice(i + 1).find((x) => x.reviewerKey !== r.reviewerKey);
      if (!later) return;
      const t = tally.get(r.reviewerKey)!;
      t.n++;
      if (later.verdict === r.verdict) t.agreed++;
    });
  }
  return new Map([...tally].map(([k, t]) => [k, { agreed: t.agreed, n: t.n, rate: t.n ? Math.round((t.agreed / t.n) * 1000) / 1000 : null, state: t.n >= MIN_AGREEMENT_N ? 'ok' : 'none' } as ReviewerAgreement]));
}
