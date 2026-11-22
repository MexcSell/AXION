// Little's-law consistency check (c65). Standard queueing mathematics, not taken from the research papers: in a stable system,
// the average number of items in the system (L) equals the arrival rate (lambda) times the mean time an item spends in the system (W).
// It is used here as a DATA-QUALITY test: if the stored arrival and close records disagree with each other, an item has lost its
// close event (or an arrival), and the percentiles and backlog that come from the same rows cannot be trusted.
import type { LittleLawDto } from '../../../shared/contracts/src/index.ts';

/**
 * Design (fix round, review F1): there is NO tolerance and no mismatch alert. On a finite window the exact relation is
 * avgOpen = lambda*W + carryIn/T, where carryIn is the time items that arrived BEFORE the window spend inside it (and items still open
 * are cut at "now" on both sides). Both sides are built from the same stored rows, so they cannot disagree about a lost arrival, a wrong
 * timestamp or a duplicate: comparing them would only measure the carry-in, i.e. raise a false alarm on healthy data whenever an item is
 * older than the window. The two numbers are therefore shown as information. The data-quality flags that CAN catch a real fault are the
 * record checks: an item closed in its state with no close record (missing_close), and a task waiting for a person with no record of
 * when it started waiting (missing_open).
 */
export interface LittleInput {
  /** items that arrived in the window */ arrivals: number;
  /** sum over those items of (close or now) - arrival, ms */ sumTisMs: number;
  /** sum over all items of the part of their time in system that lies inside the window, ms */ sumOverlapMs: number;
  windowMs: number;
  /** items with no close record although they are not open (all time) */ missingClose: number;
  /** tasks waiting for a person now with no event that put them there (all time) */ missingOpen: number;
  /** open now (reported, not compared: the law is about the average) */ openNow: number;
}

export class LittleLawError extends Error {
  constructor(public result: LittleLawDto) { super(`Little's-law check failed: ${result.reason}${result.missingClose ? ` (${result.missingClose} item(s) with no close record)` : ''}${result.missingOpen ? ` (${result.missingOpen} task(s) waiting with no start record)` : ''}`); this.name = 'LittleLawError'; }
}

/** Pure. Fails only on a lost record. avgOpen (time-averaged number open in the window) and lambda x W are reported, never compared. */
export function littlesLaw(i: LittleInput): LittleLawDto {
  const base = { missingClose: i.missingClose, missingOpen: i.missingOpen, openNow: i.openNow };
  const avgOpen = i.sumOverlapMs / i.windowMs, lw = i.sumTisMs / i.windowMs; // lambda * W = (arrivals/T) * (sumTis/arrivals)
  if (i.missingClose > 0) return { ...base, status: 'fail', reason: 'missing_close', avgOpen, lambdaTimesW: lw };
  if (i.missingOpen > 0) return { ...base, status: 'fail', reason: 'missing_open', avgOpen, lambdaTimesW: lw };
  if (i.arrivals === 0) return { ...base, status: 'insufficient', reason: 'no_arrivals', avgOpen: null, lambdaTimesW: null };
  return { ...base, status: 'pass', reason: 'ok', avgOpen, lambdaTimesW: lw };
}

/** Throws LittleLawError unless the check passed or had nothing to compare. */
export function assertLittle(r: LittleLawDto): LittleLawDto {
  if (r.status === 'fail') throw new LittleLawError(r);
  return r;
}
