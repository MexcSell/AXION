// Little's-law consistency check (c65). Standard queueing mathematics, not taken from the research papers: in a stable system,
// the average number of items in the system (L) equals the arrival rate (lambda) times the mean time an item spends in the system (W).
// It is used here as a DATA-QUALITY test: if the stored arrival and close records disagree with each other, an item has lost its
// close event (or an arrival), and the percentiles and backlog that come from the same rows cannot be trusted.
import type { LittleLawDto } from '../../../shared/contracts/src/index.ts';

/**
 * Tolerance, stated in code and in the report. A finite window has boundary effects: items that arrived before the window and are
 * still in it add to L but not to lambda, and items still open at the end are cut off at "now" so their W is short. Both errors are
 * about (mean time in system) / (window length), so the tolerance is relative with a small absolute floor for near-empty systems.
 * The check passes when |L - lambda*W| <= max(LITTLE_ABS_TOL items, LITTLE_REL_TOL * max(L, lambda*W)).
 */
export const LITTLE_REL_TOL = 0.15;
export const LITTLE_ABS_TOL = 0.25;

export interface LittleInput {
  /** items that arrived in the window */ arrivals: number;
  /** sum over those items of (close or now) - arrival, ms */ sumTisMs: number;
  /** sum over all items of the part of their time in system that lies inside the window, ms */ sumOverlapMs: number;
  windowMs: number;
  /** items with no close record although they are not open (all time) */ missingClose: number;
  /** open now (reported, not compared: the law is about the average) */ openNow: number;
}

export class LittleLawError extends Error {
  constructor(public result: LittleLawDto) { super(`Little's-law check failed: ${result.reason}${result.missingClose ? ` (${result.missingClose} item(s) with no close record)` : ''}`); this.name = 'LittleLawError'; }
}

/** Pure. The "open items" side is the time-averaged number in the system over the window, which is what the law is about. */
export function littlesLaw(i: LittleInput): LittleLawDto {
  const base = { relTol: LITTLE_REL_TOL, absTol: LITTLE_ABS_TOL, missingClose: i.missingClose, openNow: i.openNow };
  const avgOpen = i.sumOverlapMs / i.windowMs, lw = i.sumTisMs / i.windowMs; // lambda * W = (arrivals/T) * (sumTis/arrivals)
  if (i.missingClose > 0) return { ...base, status: 'fail', reason: 'missing_close', avgOpen, lambdaTimesW: lw, relError: null };
  if (i.arrivals === 0) return { ...base, status: 'insufficient', reason: 'no_arrivals', avgOpen: null, lambdaTimesW: null, relError: null };
  const diff = Math.abs(avgOpen - lw), scale = Math.max(avgOpen, lw);
  const ok = diff <= Math.max(LITTLE_ABS_TOL, LITTLE_REL_TOL * scale);
  return { ...base, status: ok ? 'pass' : 'fail', reason: ok ? 'ok' : 'mismatch', avgOpen, lambdaTimesW: lw, relError: scale > 0 ? diff / scale : 0 };
}

/** Throws LittleLawError unless the check passed or had nothing to compare. */
export function assertLittle(r: LittleLawDto): LittleLawDto {
  if (r.status === 'fail') throw new LittleLawError(r);
  return r;
}
