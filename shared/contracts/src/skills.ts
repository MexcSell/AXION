/**
 * Improvement cycle 72 (R3-7, with R3-1 folded in): difficulty-adjusted skill ratings, no leaderboard.
 *
 * The shapes of a rating come from the research notes (C1 task features, C2 an ability vector, C3 pair ratings stored apart); their accuracy
 * claims are from benchmarks and exams and are NOT carried over. What is built is one small, documented estimator, tested on its own model.
 *
 * METHOD (name: "direct standardisation to a fixed difficulty mix, with a Wilson interval on the effective sample size").
 *  - An outcome is a finished task (passed or failed) with a brief that names a task class and a difficulty (1 to 5, set by the delegator).
 *  - Per agent and task class, outcomes are counted per difficulty level. The raw rate is successes over all outcomes (what an agent
 *    handed easy tasks looks good on). The adjusted rate re-weights the per-level rates to a FIXED reference mix (the five levels equally,
 *    REFERENCE_MIX), over the levels the agent has evidence for. The levels used are named on every cell.
 *  - Interval: variance of the weighted rate, from per-level rates smoothed by half an observation (so a level with 0 or all successes
 *    still has spread); effective n = p(1-p)/variance (Kish); then the Wilson score interval at 95% for (rate, effective n).
 *  - Comparing two agents: only on the difficulty levels BOTH have evidence for. The verdict is "distinguishable" when the two 95% intervals
 *    do not overlap, otherwise "indistinguishable". With no shared level, or fewer than 5 outcomes on the shared levels, nothing can be
 *    said, and that is reported as "indistinguishable" with the reason. No direction, no rank, no score order.
 *  - A cell with fewer than SKILL_MIN_N outcomes is null ("not enough evidence").
 * LIMITS (also in the `?` help): the difficulty is set by the delegator and is gameable; levels are ordinal, not equal steps; two agents
 * whose tasks never share a difficulty level cannot be compared by any method that uses only this data; a pair rating (agent with a human)
 * is NOT built, because no record says that a person worked with the agent on a task (see PAIR_RATING_NOTE).
 */
export const TASK_CLASSES = {
  research: 'Finding things out',
  writing: 'Writing and editing',
  coding: 'Writing and fixing code',
  data: 'Working with data',
  browsing: 'Using websites and forms',
  planning: 'Planning and organising',
  review: 'Checking other work',
  communication: 'Talking with people',
} as const;
export type TaskClassId = keyof typeof TASK_CLASSES;
export const TASK_CLASS_IDS = Object.keys(TASK_CLASSES) as [TaskClassId, ...TaskClassId[]];

export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5] as const;
export const DIFFICULTY_LABELS: Record<number, string> = { 1: 'Routine', 2: 'Easy', 3: 'Typical', 4: 'Hard', 5: 'Very hard' };

/** fewer outcomes than this in a cell: the cell is null (the same floor as the reliability) */
export const SKILL_MIN_N = 5;
/** the fixed reference mix: every level counts the same */
export const REFERENCE_MIX: Record<number, number> = { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 };
export const SKILL_METHOD = 'Direct standardisation to a fixed difficulty mix (levels 1 to 5 weighted equally), 95% Wilson interval on the effective sample size';

export const PAIR_RATING_NOTE = 'Pair ratings (an agent working with a person) are not built. Nothing recorded says that a person worked with the agent on a task: a brief names who delegated, which is not who collaborated, and a review comes after the work. Without that, a pair rating would only rename the delegator.';

/** outcomes of one agent in one class at one difficulty level */
export interface LevelCount { d: number; n: number; x: number }
export interface SkillInterval { value: number; lo: number; hi: number }

/** Wilson score interval for x successes in n (n may be fractional: an effective sample size). Fractions 0..1. */
export function wilson(p: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (!(n > 0)) return { lo: 0, hi: 1 };
  const z2 = z * z, den = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / den, h = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

export interface Standardised { value: number; lo: number; hi: number; n: number; x: number; nEff: number; levels: number[] }
/** The raw rate with its Wilson interval, over every outcome (no adjustment). */
export function rawRate(levels: readonly LevelCount[]): (Standardised) | null {
  const n = levels.reduce((s, l) => s + l.n, 0), x = levels.reduce((s, l) => s + l.x, 0);
  if (n === 0) return null;
  const w = wilson(x / n, n);
  return { value: x / n, ...w, n, x, nEff: n, levels: levels.filter((l) => l.n > 0).map((l) => l.d) };
}
/** The adjusted rate over `use` (default: every level with evidence). Null when there is no evidence on those levels. */
export function standardise(levels: readonly LevelCount[], use?: readonly number[]): Standardised | null {
  const have = levels.filter((l) => l.n > 0 && (!use || use.includes(l.d)) && REFERENCE_MIX[l.d] !== undefined);
  if (have.length === 0) return null;
  const wsum = have.reduce((s, l) => s + REFERENCE_MIX[l.d], 0);
  let p = 0, ps = 0, v = 0, n = 0, x = 0;
  for (const l of have) {
    const w = REFERENCE_MIX[l.d] / wsum, pt = (l.x + 0.5) / (l.n + 1);
    p += w * (l.x / l.n); ps += w * pt; v += w * w * pt * (1 - pt) / l.n; n += l.n; x += l.x;
  }
  const nEff = ps * (1 - ps) / v;
  return { value: p, ...wilson(p, nEff), n, x, nEff, levels: have.map((l) => l.d) };
}

export type SkillVerdict = 'distinguishable' | 'indistinguishable';
/** Two agents in one class, on the difficulty levels both have evidence for. Said as "distinguishable" or "indistinguishable" only. */
export function compareSkill(a: readonly LevelCount[], b: readonly LevelCount[]): { verdict: SkillVerdict; reason: string; sharedLevels: number[] } {
  const hasB = new Set(b.filter((l) => l.n > 0).map((l) => l.d));
  const shared = a.filter((l) => l.n > 0 && hasB.has(l.d)).map((l) => l.d).sort((p, q) => p - q);
  if (shared.length === 0) return { verdict: 'indistinguishable', reason: 'The two agents have no difficulty level in common, so no fair comparison exists.', sharedLevels: [] };
  const sa = standardise(a, shared)!, sb = standardise(b, shared)!;
  if (sa.n < SKILL_MIN_N || sb.n < SKILL_MIN_N) return { verdict: 'indistinguishable', reason: `Fewer than ${SKILL_MIN_N} outcomes each on the levels they share.`, sharedLevels: shared };
  const apart = sa.hi < sb.lo || sb.hi < sa.lo;
  return { verdict: apart ? 'distinguishable' : 'indistinguishable', reason: apart ? 'The 95% intervals on the shared levels do not overlap.' : 'The 95% intervals on the shared levels overlap.', sharedLevels: shared };
}
/** The same rule on the raw rates (what a table of raw counts invites). Used only to show the difference in the simulation. */
export function compareRaw(a: readonly LevelCount[], b: readonly LevelCount[]): { verdict: SkillVerdict; aHigher: boolean } {
  const ra = rawRate(a), rb = rawRate(b);
  if (!ra || !rb) return { verdict: 'indistinguishable', aHigher: false };
  return { verdict: ra.hi < rb.lo || rb.hi < ra.lo ? 'distinguishable' : 'indistinguishable', aHigher: ra.value > rb.value };
}

const pct = (v: number) => Math.round(v * 100);
export const toInterval = (s: Standardised | null): SkillInterval | null => (s ? { value: pct(s.value), lo: pct(s.lo), hi: pct(s.hi) } : null);

export interface SkillCellDto {
  classId: TaskClassId; label: string;
  /** outcomes with both a class and a difficulty */
  n: number; successes: number;
  state: 'ok' | 'not_enough_evidence';
  /** null below SKILL_MIN_N */
  raw: SkillInterval | null;
  adjusted: SkillInterval | null;
  /** the difficulty levels the adjusted rate is built from */
  levels: { difficulty: number; label: string; n: number; successes: number }[];
  evidence: string;
}
export interface AgentSkillsDto {
  agentId: string;
  method: string;
  minN: number;
  /** one cell per task class, always in the fixed class order (never ordered by a rating) */
  classes: SkillCellDto[];
  /** finished tasks of this agent whose brief names a class but no difficulty, or the reverse: left out of every cell */
  unrated: number;
  includesSimulated: boolean;
  pairRatings: { built: false; why: string };
  dependsOn: { gameable: boolean; text: string };
}
export interface SkillCompareDto {
  agentId: string; withId: string; method: string;
  /** one row per class both agents have a cell for, in the fixed class order */
  classes: { classId: TaskClassId; label: string; verdict: SkillVerdict; reason: string; sharedLevels: number[] }[];
}
