import { MIN_AGREEMENT_N, type ReviewerAgreement, type ReviewVerdict } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 38: the pure rules of independent task review.
 *
 * Model family = the VENDOR LINEAGE of a model name (a model prefers output of its own lineage, 2404.13076).
 * THIS TABLE IS THE TRUST BOUNDARY of the independence rule. It is explicit, frozen and versioned; it is extended only by a
 * code change (bump MODEL_FAMILY_TABLE_VERSION and add a test). A name that matches no entry has NO family (null), and null
 * fails closed: an agent with an unknown family cannot review an agent, and cannot be reviewed by one.
 * Normalising: lower-case, trim, drop any `xxx/` router prefix (`openai/`, `bedrock/`, `azure/`, ...) and a leading cloud-region
 * and provider part (`us.anthropic.`). The lineage must then START the name (`my-claude-proxy` is unknown, not anthropic).
 */
export const MODEL_FAMILY_TABLE_VERSION = 1;
export const MODEL_FAMILY_TABLE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  openai: ['gpt', 'chatgpt', 'o1', 'o3', 'o4', 'text-davinci', 'davinci', 'whisper', 'dall-e', 'codex'],
  anthropic: ['claude'],
  google: ['gemini', 'gemma', 'palm', 'text-bison', 'bison'],
  meta: ['llama'],
  mistral: ['mistral', 'mixtral', 'codestral', 'ministral', 'pixtral'],
  cohere: ['command', 'aya'],
  amazon: ['titan', 'nova'],
  microsoft: ['phi'],
  alibaba: ['qwen'],
  deepseek: ['deepseek'],
  xai: ['grok'],
});
const PROVIDER = '(?:anthropic|openai|meta|google|mistral|cohere|amazon|microsoft|deepseek|xai)';
const PREFIX = new RegExp(`^(?:[a-z]{2,4}\\.)?${PROVIDER}\\.`);
const lineages = Object.entries(MODEL_FAMILY_TABLE).flatMap(([vendor, ls]) => ls.map((l) => [vendor, new RegExp('^' + l.replace(/[-.]/g, '\\$&') + '(?![a-z])')] as const));
export function modelFamily(model: string | null | undefined): string | null {
  let m = String(model ?? '').trim().toLowerCase();
  m = m.slice(m.lastIndexOf('/') + 1).trim().replace(PREFIX, '');
  for (const [vendor, re] of lineages) if (re.test(m)) return vendor;
  return null;
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
