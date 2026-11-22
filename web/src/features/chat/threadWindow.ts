import type { Message } from '@/data/types';
import { clock, dateLabel } from '@/lib/format';

/*
 * Improvement cycle 26: the geometry model of a virtualised thread. Only the rows near the viewport are in the DOM; every
 * other row is counted by its measured height (cached per message) or, until it was measured once, by an estimate. The
 * same model places the rendered window, the spacers around it and every minimap block, so the minimap still shows every
 * message.
 */

/** Messages never change in place (the stores copy a message to change it), so labels can be cached per object. */
const days = new WeakMap<Message, string>();
const clocks = new WeakMap<Message, string>();
export const dayOf = (m: Message) => { let d = days.get(m); if (d === undefined) { d = dateLabel(m.agoMin, m.ts); days.set(m, d); } return d; };
export const clockOf = (m: Message) => { let c = clocks.get(m); if (c === undefined) { c = clock(m.agoMin, m.ts); clocks.set(m, c); } return c; };

/** A measured row: wrapper height, the bubble row's offset inside it (a day separator above it), the bubble row's height
 *  and the bubble's width as a share of the thread width. */
export interface RowGeo { h: number; off: number; bh: number; w: number }
/** The same message is taller with a day separator above it, and in the compact view: each variant is measured apart. */
export const geoKey = (id: string, sep: boolean, compact: boolean) => `${compact ? 'c|' : ''}${id}${sep ? '|d' : ''}`;

/**
 * Estimates for rows not measured yet (fix round I1): the mean of the measured rows, per message kind (a report is taller
 * and wider than an acknowledgement), falling back to all measured rows, then to a first guess. Each mean is learned from
 * the first EST_SAMPLES measurements and then held, so the spacers and the minimap do not churn; a change of the thread's
 * width (text re-wraps) starts them again from the rows on screen.
 */
export const EST_SAMPLES = 30;
interface Stat { n: number; sum: number }
export interface Estimate { row: number; sep: number; nRow: number; sumRow: number; nSep: number; sumSep: number; w: Stat; kinds: Record<string, { h: Stat; w: Stat }> }
export const newEstimate = (): Estimate => ({ row: 74, sep: 27, nRow: 0, sumRow: 0, nSep: 0, sumSep: 0, w: { n: 0, sum: 0 }, kinds: {} });
const mean = (x: Stat | undefined) => (x && x.n ? x.sum / x.n : undefined);
const add = (x: Stat, v: number) => { if (x.n < EST_SAMPLES) { x.n++; x.sum += v; } };
/** a first measurement of a row (bubble-row height `bh`, separator offset `off`, width share `w`) teaches the estimates */
export function learn(est: Estimate, kind: string, g: RowGeo) {
  if (est.nRow < EST_SAMPLES) { est.nRow++; est.sumRow += g.bh; est.row = est.sumRow / est.nRow; }
  if (g.off > 0 && est.nSep < EST_SAMPLES) { est.nSep++; est.sumSep += g.off; est.sep = est.sumSep / est.nSep; }
  const k = (est.kinds[kind] ??= { h: { n: 0, sum: 0 }, w: { n: 0, sum: 0 } });
  add(k.h, g.bh); add(k.w, g.w); add(est.w, g.w);
}
/** the thread's width changed: start the estimates again (the caller re-measures the rows on screen right after) */
export function relearn(est: Estimate) { Object.assign(est, { ...newEstimate(), row: est.row, sep: est.sep }); }
export const estRow = (est: Estimate, m: Message) => mean(est.kinds[m.kind]?.h) ?? est.row;
export const estWidth = (est: Estimate, m: Message) => mean(est.kinds[m.kind]?.w) ?? mean(est.w) ?? Math.min(.85, .22 + m.text.length / 420);
export interface ThreadLayout {
  n: number;
  gap: number;
  /** tops[i]: offset of row i from the first row's top; tops[n] = total + gap */
  tops: Float64Array;
  /** day label shown above row i, or null */
  seps: (string | null)[];
  keys: string[];
  /** from the first row's top to the last row's bottom */
  total: number;
}

export function layoutRows(msgs: Message[], geo: Map<string, RowGeo>, est: Estimate, gap: number, compact: boolean): ThreadLayout {
  const n = msgs.length;
  const tops = new Float64Array(n + 1);
  const seps: (string | null)[] = new Array(n);
  const keys: string[] = new Array(n);
  let last = '';
  for (let i = 0; i < n; i++) {
    const d = dayOf(msgs[i]);
    const sep = d !== last ? (last = d) : null;
    seps[i] = sep;
    const k = (keys[i] = geoKey(msgs[i].id, !!sep, compact));
    const g = geo.get(k);
    tops[i + 1] = tops[i] + (g ? g.h : estRow(est, msgs[i]) + (sep ? est.sep : 0)) + gap;
  }
  return { n, gap, tops, seps, keys, total: n ? tops[n] - gap : 0 };
}

/** Rows [s, e) that intersect the band [from, to] (offsets from the first row's top). */
export function rangeFor(l: ThreadLayout, from: number, to: number): [number, number] {
  const { n, tops, gap } = l;
  if (!n) return [0, 0];
  // first row whose bottom is below `from`
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid + 1] - gap > from) hi = mid; else lo = mid + 1; }
  const s = Math.min(lo, n - 1);
  // first row whose top is at or below `to`
  lo = s; hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid] >= to) hi = mid; else lo = mid + 1; }
  return [s, Math.max(lo, s + 1)];
}

/** Minimap geometry per message (content px from the scroller's top, padding included): measured, or estimated. */
export interface MapRow { top: number; h: number; w: number }
export function mapRows(msgs: Message[], l: ThreadLayout, geo: Map<string, RowGeo>, est: Estimate, pad: number): MapRow[] {
  const out: MapRow[] = new Array(l.n);
  for (let i = 0; i < l.n; i++) {
    const g = geo.get(l.keys[i]);
    const top = pad + l.tops[i];
    out[i] = g ? { top: top + g.off, h: g.bh, w: g.w }
      : { top: top + (l.seps[i] ? est.sep : 0), h: estRow(est, msgs[i]), w: estWidth(est, msgs[i]) };
  }
  return out;
}
