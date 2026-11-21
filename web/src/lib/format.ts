export function ago(min: number): string {
  if (min < 0.5) return 'just now';
  if (min < 1) return `${Math.round(min * 60)}s ago`;
  if (min < 60) return `${Math.round(min)} min ago`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} d ago`;
  return `${Math.round(d / 30)} mo ago`;
}

/** Clock label for a timestamp N minutes before page load. */
const LOAD = Date.now();
// improvement cycle 22: one formatter each, made once. toLocale*String builds a new Intl formatter on every call, which
// was the top app cost while a long thread re-rendered; the output is identical (same locale, same options).
const CLOCK = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
export function clock(minAgo: number, ts?: number): string {
  return CLOCK.format(new Date(ts ?? LOAD - minAgo * 60_000));
}
export function dateLabel(minAgo: number, ts?: number): string {
  return DAY.format(new Date(ts ?? LOAD - minAgo * 60_000));
}
export function agoFromTs(ts: number): string { return ago((Date.now() - ts) / 60_000); }

export const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;
export const compact = (n: number) => Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function cx(...parts: (string | false | null | undefined)[]) { return parts.filter(Boolean).join(' '); }
