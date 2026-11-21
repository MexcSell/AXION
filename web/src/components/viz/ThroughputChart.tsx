import { memo } from 'react';
import { motion } from 'motion/react';
import type { ThroughputDto } from '@contracts';

/** Cycle 12: weekly missions started (muted) and finished (accent) as paired bars on one shared scale: counts only. */
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const ThroughputChart = memo(function ThroughputChart({ weeks, h = 30 }: { weeks: ThroughputDto['weeks']; h?: number }) {
  const W = 200, gap = 4, bw = (W - gap * (weeks.length - 1)) / weeks.length;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.started, w.finished]));
  const bar = (v: number) => (v === 0 ? 1 : Math.max(2, (v / max) * (h - 2)));
  return (
    <svg viewBox={`0 0 ${W} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" data-throughput={weeks.map((w) => `${w.started}/${w.finished}`).join(',')}
      aria-label={`Missions started and finished per week, last ${weeks.length} weeks: ${weeks.map((w) => `${day(w.from)} ${w.started} started ${w.finished} finished`).join('; ')}`}>
      {weeks.map((w, i) => {
        const x = i * (bw + gap), half = bw / 2 - .5;
        return (
          <g key={w.from}>
            <title>{`${day(w.from)} – ${day(w.to)}: ${w.started} started, ${w.finished} finished`}</title>
            <motion.rect x={x} width={half} rx={1} fill="var(--text-muted)" opacity={.6} initial={{ height: 0, y: h }} animate={{ height: bar(w.started), y: h - bar(w.started) }} transition={{ duration: .6, delay: i * .03 }} />
            <motion.rect x={x + half + 1} width={half} rx={1} fill="var(--accent-2)" initial={{ height: 0, y: h }} animate={{ height: bar(w.finished), y: h - bar(w.finished) }} transition={{ duration: .6, delay: i * .03 }} />
          </g>
        );
      })}
    </svg>
  );
});
