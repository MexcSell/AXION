/**
 * c90 (R5-4): peek-safe (anytime-valid) confidence sequence for p_after - p_before. Pure arithmetic: no database, no
 * clock, no model call, and nothing calls it yet. Method note: web/docs/improve/cycles/c90-method.md (committed first).
 *
 * Source: Howard, Ramdas, McAuliffe, Sekhon (2021), "Time-uniform, nonparametric, nonasymptotic confidence sequences",
 * Annals of Statistics: normal-mixture boundary (Robbins 1970 mixture). A Bernoulli is 1/4-sub-Gaussian, so per arm
 *   P(exists t: |S_t| >= sqrt((v+rho) * (log((v+rho)/rho) + 2 log(1/a)))) <= a,   v = t/4, S_t = sum(x_i - p).
 * NOTE (fix round): the 2 log(1/a) form is Howard et al.'s ONE-sided bound at level a; used on |S_t| it is two-sided at
 * 2a. So each arm gets a = ALPHA/4 (two-sided ALPHA/2 per arm), and the difference interval
 * [lo_after - hi_before, hi_after - lo_before] holds at every look at once with probability >= 1 - ALPHA (union bound).
 * Tuning rule (fixed before any simulation): rho minimises the boundary at N_STAR = 50 per arm (closed form below).
 *
 * Running bounds ARE intersected (running max of lower, running min of upper, per arm), so the bounds are monotone:
 * the interval never widens. Valid because every arm sequence holds for all t simultaneously.
 *
 * No automatic stopping and no verdict wording: `zeroExcluded` is a fact about the interval. Below MIN_PER_ARM
 * observations in either arm the status is "not_enough_evidence" and there are no bounds. INTERVALS ARE WIDE at small n:
 * at 100 per arm the full width is about 0.55 to 0.66 with no effect, and above 1 at 20 per arm (see c90-report.md).
 */
export const ALPHA = 0.05;
export const ARM_ALPHA = ALPHA / 4;
export const N_STAR = 50;
export const MIN_PER_ARM = 10;
const L = Math.log(1 / ARM_ALPHA);
export const RHO = (N_STAR / 4) / (2 * L + Math.log(1 + 2 * L));

export type Arm = 'before' | 'after';
export type Observation = { arm: Arm; outcome: 0 | 1 };
export type SequentialStatus = 'not_enough_evidence' | 'ok';
export type SequentialStep = {
  status: SequentialStatus;
  nBefore: number;
  nAfter: number;
  /** null while status is not_enough_evidence */
  lower: number | null;
  upper: number | null;
  /** plain fact about the interval, never a verdict; false while there is not enough evidence */
  zeroExcluded: boolean;
};
type ArmState = { n: number; sum: number; lo: number; hi: number };
export type SequentialState = { before: ArmState; after: ArmState };

/** Half-width of the mean interval after n observations (boundary / n). */
export function armHalfWidth(n: number): number {
  if (n <= 0) return Infinity;
  const v = n / 4;
  return Math.sqrt((v + RHO) * (Math.log((v + RHO) / RHO) + 2 * L)) / n;
}

export function initialState(): SequentialState {
  return { before: { n: 0, sum: 0, lo: 0, hi: 1 }, after: { n: 0, sum: 0, lo: 0, hi: 1 } };
}

/** Pure: returns the next state; does not mutate the input. */
export function update(state: SequentialState, obs: Observation): SequentialState {
  if (obs.arm !== 'before' && obs.arm !== 'after') throw new Error('arm must be before or after');
  if (obs.outcome !== 0 && obs.outcome !== 1) throw new Error('outcome must be 0 or 1');
  const a = state[obs.arm];
  const n = a.n + 1, sum = a.sum + obs.outcome, m = sum / n, h = armHalfWidth(n);
  const next: ArmState = { n, sum, lo: Math.max(a.lo, m - h, 0), hi: Math.min(a.hi, m + h, 1) };
  return { ...state, [obs.arm]: next } as SequentialState;
}

export function readout(state: SequentialState): SequentialStep {
  const { before: b, after: a } = state;
  if (b.n < MIN_PER_ARM || a.n < MIN_PER_ARM) {
    return { status: 'not_enough_evidence', nBefore: b.n, nAfter: a.n, lower: null, upper: null, zeroExcluded: false };
  }
  const lower = a.lo - b.hi, upper = a.hi - b.lo;
  return { status: 'ok', nBefore: b.n, nAfter: a.n, lower, upper, zeroExcluded: lower > 0 || upper < 0 };
}

/** One readout per observation, in order. */
export function sequence(stream: Iterable<Observation>): SequentialStep[] {
  const out: SequentialStep[] = [];
  let s = initialState();
  for (const o of stream) { s = update(s, o); out.push(readout(s)); }
  return out;
}
