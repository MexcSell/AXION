import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { CountUp } from '@/components/ui/CountUp';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import '@/theme/pages/evolution-models-usage.css';

export interface KpiItem { key: string; icon: LucideIcon; value: number; label: string; color: string; prefix?: string; suffix?: string; decimals?: number; delta?: string; down?: boolean; foot?: React.ReactNode; help: string; onClick?: () => void }

/** Glowing KPI strip in the 40-x style (reuses the shared .kpi class). */
export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="emu-kpis" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((k, i) => (
        <motion.div key={k.key} className="kpi" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); k.onClick?.(); } }} style={{ ['--kc' as string]: k.color, cursor: 'pointer' }} onClick={k.onClick}
          initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .06 + i * .05, duration: .35 }}
          aria-label={`${k.label}: ${k.prefix ?? ''}${k.value}${k.suffix ?? ''}`}>
          <k.icon size={32} strokeWidth={1.6} className="kpi-ico" aria-hidden />
          <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
            <div className="kpi-label row" style={{ gap: 4 }}>{k.label}<span onClick={(e) => e.stopPropagation()}><HelpTrigger k={k.help} /></span></div>
            <div className="kpi-val"><CountUp value={k.value} decimals={k.decimals} prefix={k.prefix} suffix={k.suffix} /></div>
            {k.delta && <div className="kpi-delta" style={k.down ? { color: 'var(--good)' } : undefined}>{k.down ? <ArrowDown size={13} strokeWidth={3} /> : <ArrowUp size={13} strokeWidth={3} />}{k.delta}</div>}
            {k.foot}
          </div>
        </motion.div>
      ))}
    </div>
  );
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
