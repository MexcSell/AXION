import { KpiBoard, type KpiItem } from '@/components/layout/PageFrame';
import '@/theme/pages/evolution-models-usage.css';

export type { KpiItem } from '@/components/layout/PageFrame';

/** Legacy helper: renders the shared KPI tile design (components/layout/PageFrame). */
export function KpiStrip({ items }: { items: KpiItem[] }) {
  return <KpiBoard items={items} />;
}

/** Animated heartbeat / ECG line used on Models > Health. */
export function Heartbeat({ ok = true, w = 220, h = 40 }: { ok?: boolean; w?: number; h?: number }) {
  const c = ok ? 'var(--good)' : 'var(--warn)';
  const d = `M0,${h / 2} L${w * .18},${h / 2} L${w * .24},${h * .12} L${w * .31},${h * .9} L${w * .38},${h * .3} L${w * .44},${h / 2} L${w * .62},${h / 2} L${w * .68},${h * .2} L${w * .74},${h * .8} L${w * .8},${h / 2} L${w},${h / 2}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ overflow: 'visible' }}>
      <path d={d} fill="none" stroke="var(--border)" strokeWidth="1.5" />
      <path className="emu-beat" d={d} fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${c})` }} pathLength={100} />
    </svg>
  );
}
