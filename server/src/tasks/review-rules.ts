import { MIN_AGREEMENT_N, type ReviewerAgreement, type ReviewVerdict } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 38: the pure rules of independent task review.
 *
 * Model family = the VENDOR LINEAGE of a model name (a model prefers output of its own lineage, 2404.13076).
 * THIS TABLE IS THE TRUST BOUNDARY of the independence rule. It is explicit, frozen and versioned; it is extended only by a
 * code change (bump MODEL_FAMILY_TABLE_VERSION and add a test). A name that matches no entry has NO family (null), and null
 * fails closed: an agent with an unknown family cannot review an agent, and cannot be reviewed by one.
 * Normalising: lower-case, trim, drop any `xxx/` router prefix (`openrouter/`, `bedrock/`, `azure/`, ...) and a leading cloud-region
 * and provider part (`us.anthropic.`). The lineage must then START the name (`my-claude-proxy` is unknown, not anthropic).
 * c51: a prefix that names a VENDOR must agree with the model (`anthropic/gpt-4` is unknown, not openai), and the o-series is
 * `o1`/`o3`/`o4` followed by `-`, `_`, `:` or the end only (`o10x`, `bo1` and `o3mini` are unknown).
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
const PREFIX = new RegExp(`^(?:[a-z]{2,4}\\.)?(${PROVIDER})\\.`);
/** A path prefix that names a VENDOR (not a router like openrouter/azure/bedrock): its vendor. A prefix that is not here is a router and is ignored. */
const VENDOR_ALIAS: Readonly<Record<string, string>> = Object.freeze({
  openai: 'openai', anthropic: 'anthropic', google: 'google', meta: 'meta', 'meta-llama': 'meta', mistral: 'mistral', mistralai: 'mistral', cohere: 'cohere',
  amazon: 'amazon', microsoft: 'microsoft', alibaba: 'alibaba', qwen: 'alibaba', deepseek: 'deepseek', 'deepseek-ai': 'deepseek', xai: 'xai', 'x-ai': 'xai',
});
// The o-series is `o1`..`o4` followed by a separator or the end (c51): `o10x`, `o1x`, `o3mini` and `bo1` are not o-series. Other lineages keep the letter lookahead.
const O_SERIES = new Set(['o1', 'o3', 'o4']);
const lineages = Object.entries(MODEL_FAMILY_TABLE).flatMap(([vendor, ls]) => ls.map((l) => [vendor, new RegExp('^' + l.replace(/[-.]/g, '\\$&') + (O_SERIES.has(l) ? '(?:$|[-_:])' : '(?![a-z])'))] as const));
export function modelFamily(model: string | null | undefined): string | null {
  const full = String(model ?? '').trim().toLowerCase();
  const cut = full.lastIndexOf('/');
  const named = new Set<string>(); // vendors the name itself claims through a path prefix (`anthropic/…`) or a provider part (`anthropic.…`)
  for (const seg of full.slice(0, cut + 1).split('/')) { const v = VENDOR_ALIAS[seg.trim()]; if (v) named.add(v); }
  let m = full.slice(cut + 1).trim();
  const dotted = PREFIX.exec(m);
  if (dotted) { named.add(dotted[1]); m = m.replace(PREFIX, ''); }
  let family: string | null = null;
  for (const [vendor, re] of lineages) if (re.test(m)) { family = vendor; break; }
  // a router prefix that names a DIFFERENT vendor than the model (`anthropic/gpt-4`) is a contradiction: unknown, so not eligible as "a different family"
  if (family && [...named].some((v) => v !== family)) return null;
  return family;
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
