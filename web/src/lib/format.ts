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
export function clock(minAgo: number, ts?: number): string {
  const d = new Date(ts ?? LOAD - minAgo * 60_000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
export function dateLabel(minAgo: number, ts?: number): string {
  const d = new Date(ts ?? LOAD - minAgo * 60_000);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export function agoFromTs(ts: number): string { return ago((Date.now() - ts) / 60_000); }

export const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;
export const compact = (n: number) => Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function cx(...parts: (string | false | null | undefined)[]) { return parts.filter(Boolean).join(' '); }
