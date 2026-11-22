/** A duration in plain words: seconds, minutes or hours. */
export function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 90) return `${Math.max(0, Math.round(s))} s`;
  const m = s / 60;
  if (m < 90) return `${Math.round(m)} min`;
  const h = m / 60;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}
