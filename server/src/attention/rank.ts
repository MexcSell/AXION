/**
 * The fixed ranking of the attention queue (c68 item 2). Pure: it reads the list it is given and nothing else, so it has no viewer, no
 * clock, no database and no part in any decision or tier. It is a design choice, not a finding from a source.
 *
 *   1. Tier. An approval's tier counts R4 highest, down to R2. Every other kind has no tier and sits in one fixed band, below R2
 *      and above R1 (R1 and R0 approvals do not occur: the policy denies those kinds before a request exists).
 *      An unknown tier text fails closed and ranks with R4.
 *   2. Expiry. A row that expires comes before one that does not; of two that expire, the soonest first.
 *   3. Age. The longest waiting first.
 *   4. Id, so the same data always gives the same order.
 *
 * A collapsed row ranks by its best member (highest tier, soonest expiry, longest wait), so folding items together can never move
 * an urgent one down.
 */
export interface Rankable { id: string; tier: string | null; expiresInSec: number | null; ageSec: number }

export const TIER_BAND: Readonly<Record<string, number>> = Object.freeze({ R0: 0, R1: 10, R2: 20, R3: 30, R4: 40 });
/** the band of every item that has no tier */
export const NO_TIER_BAND = 15;

export const bandOf = (x: Pick<Rankable, 'tier'>): number => (x.tier === null ? NO_TIER_BAND : (TIER_BAND[x.tier] ?? TIER_BAND.R4));

/** negative when `a` ranks first */
export function compareItems(a: Rankable, b: Rankable): number {
  const band = bandOf(b) - bandOf(a);
  if (band) return band;
  const ae = a.expiresInSec, be = b.expiresInSec;
  if (ae !== be) {
    if (ae === null) return 1;
    if (be === null) return -1;
    if (ae !== be) return ae - be;
  }
  if (a.ageSec !== b.ageSec) return b.ageSec - a.ageSec;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A new array in ranked order. The input is not changed. */
export function rankItems<T extends Rankable>(items: readonly T[]): T[] {
  return [...items].sort(compareItems);
}
