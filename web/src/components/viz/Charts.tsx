import { motion } from 'motion/react';
import { memo, useId, useMemo, useState } from 'react';
import { CountUp } from '@/components/ui/CountUp';

/* ------------------------------------------------------------------ */
/* RingGauge — the "98%" company-health ring (gradient arc, draws in)  */
/* ------------------------------------------------------------------ */
export const RingGauge = memo(function RingGauge({ value, size = 120, stroke = 11, label, sub, colors = ['#22d3ee', '#2ee98a'], decimals = 0 }: {
  value: number; size?: number; stroke?: number; label?: string; sub?: string; colors?: [string, string]; decimals?: number;
}) {
  const id = useId().replace(/:/g, '');
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }} role="img" aria-label={`${label ?? 'Value'} ${value}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={`rg-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={colors[0]} /><stop offset="1" stopColor={colors[1]} />
          </linearGradient>
          <filter id={`rgf-${id}`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r + stroke / 2 + 3} fill="none" stroke="var(--border-soft)" strokeWidth="1" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={stroke} />
        {/* tick marks */}
        {Array.from({ length: 40 }, (_, i) => {
          const a = (i / 40) * Math.PI * 2 - Math.PI / 2;
          const r1 = r - stroke / 2 - 4, r2 = r1 - 3;
          return <line key={i} x1={size / 2 + Math.cos(a) * r1} y1={size / 2 + Math.sin(a) * r1} x2={size / 2 + Math.cos(a) * r2} y2={size / 2 + Math.sin(a) * r2} stroke="var(--border)" strokeWidth="1" />;
        })}
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#rg-${id})`} strokeWidth={stroke} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1.4, ease: [0.2, 0.8, 0.2, 1] }}
          filter={`url(#rgf-${id})`}
        />
      </svg>
      <div className="center" style={{ position: 'absolute', inset: 0, textAlign: 'center' }}>
        <div>
          <div className="display" style={{ fontSize: size * 0.22, fontWeight: 800, lineHeight: 1 }}><CountUp value={value} decimals={decimals} suffix="%" /></div>
          {sub && <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Donut with legend segments                                          */
/* ------------------------------------------------------------------ */
export interface Seg { label: string; value: number; color: string; }
export const Donut = memo(function Donut({ segs, size = 120, stroke = 14, center, sub }: { segs: Seg[]; size?: number; stroke?: number; center?: string; sub?: string }) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }} role="img" aria-label={segs.map((s) => `${s.label} ${s.value}`).join(', ')}>
      <svg width={size} height={size} style={{ overflow: 'visible' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={stroke} />
        {segs.map((s, i) => {
          const len = (s.value / total) * c;
          const off = acc; acc += len;
          return (
            <motion.circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={hover === i ? stroke + 4 : stroke}
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
              initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: -off }} transition={{ duration: 1, delay: i * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ filter: `drop-shadow(0 0 4px ${s.color})`, cursor: 'pointer', transition: 'stroke-width .2s' }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      <div className="center" style={{ position: 'absolute', inset: 0, textAlign: 'center', pointerEvents: 'none' }}>
        <div>
          <div className="display" style={{ fontSize: size * 0.2, fontWeight: 800, lineHeight: 1 }}>{hover != null ? `${Math.round((segs[hover].value / total) * 100)}%` : center}</div>
          <div className="dim" style={{ fontSize: 10.5, marginTop: 2 }}>{hover != null ? segs[hover].label : sub}</div>
        </div>
      </div>
    </div>
  );
});

export function Legend({ segs, total }: { segs: Seg[]; total?: number }) {
  const t = total ?? segs.reduce((s, x) => s + x.value, 0);
  return (
    <div className="col" style={{ gap: 6, fontSize: 12.5, minWidth: 0 }}>
      {segs.map((s) => (
        <div key={s.label} className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
          <span className="row" style={{ gap: 7, minWidth: 0 }}><span className="dot sm" style={{ color: s.color }} /><span className="ellipsis">{s.label}</span></span>
          <span className="tnum muted">{Math.round((s.value / t) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline & Area chart                                              */
/* ------------------------------------------------------------------ */
function pathFor(data: number[], w: number, h: number, pad = 2, min?: number, max?: number) {
  const lo = min ?? Math.min(...data), hi = max ?? Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => [pad + (i / (data.length - 1)) * (w - pad * 2), h - pad - ((v - lo) / span) * (h - pad * 2)] as const);
  // smooth (catmull-rom → bezier)
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return { d, pts };
}

export const Sparkline = memo(function Sparkline({ data, w = 120, h = 32, color = 'var(--accent-2)', fill = true }: { data: number[]; w?: number; h?: number; color?: string; fill?: boolean }) {
  const id = useId().replace(/:/g, '');
  const { d, pts } = useMemo(() => pathFor(data, w, h), [data, w, h]);
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }} aria-hidden>
      <defs><linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {fill && <path d={`${d} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h}Z`} fill={`url(#sp-${id})`} />}
      <motion.path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2 }} style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
    </svg>
  );
});

export interface Series { label: string; data: number[]; color: string; }
export const AreaChart = memo(function AreaChart({ series, labels, h = 180, min, max, unit = '' }: { series: Series[]; labels: string[]; h?: number; min?: number; max?: number; unit?: string }) {
  const id = useId().replace(/:/g, '');
  const W = 600;
  const all = series.flatMap((s) => s.data);
  const lo = min ?? Math.floor(Math.min(...all) * 0.95), hi = max ?? Math.ceil(Math.max(...all) * 1.02);
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const ticks = 4;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ overflow: 'visible' }}
        onMouseMove={(e) => { const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setHover(Math.round(((e.clientX - b.left) / b.width) * (n - 1))); }}
        onMouseLeave={() => setHover(null)} role="img" aria-label={series.map((s) => `${s.label}: latest ${s.data[s.data.length - 1]}${unit}`).join('; ')}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`ar-${id}-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity=".32" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>
          ))}
          <clipPath id={`clip-${id}`}><motion.rect x="0" y="-10" height={h + 20} initial={{ width: 0 }} animate={{ width: W }} transition={{ duration: 1.3, ease: [0.2, 0.8, 0.2, 1] }} /></clipPath>
        </defs>
        <g clipPath={`url(#clip-${id})`}>
        {Array.from({ length: ticks + 1 }, (_, i) => <line key={i} x1="0" x2={W} y1={2 + (i / ticks) * (h - 4)} y2={2 + (i / ticks) * (h - 4)} stroke="var(--border-soft)" strokeDasharray="3 5" />)}
        {series.map((s, i) => {
          const { d, pts } = pathFor(s.data, W, h, 2, lo, hi);
          return (
            <g key={i}>
              <path d={`${d} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h}Z`} fill={`url(#ar-${id}-${i})`} />
              <path d={d} fill="none" stroke={s.color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 4px ${s.color})` }} />
            </g>
          );
        })}
        </g>
        {hover != null && <line x1={(hover / (n - 1)) * W} x2={(hover / (n - 1)) * W} y1="0" y2={h} stroke="var(--border-strong)" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-dim)', marginTop: 4 }}>
        {labels.filter((_, i) => i % Math.ceil(n / 7) === 0 || i === n - 1).map((l, i) => <span key={i}>{l}</span>)}
      </div>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${(hover / (n - 1)) * 100}%` }}>
          <div className="dim" style={{ fontSize: 11 }}>{labels[hover]}</div>
          {series.map((s) => <div key={s.label} className="row" style={{ gap: 6 }}><span className="dot sm" style={{ color: s.color }} />{s.label}<b className="tnum" style={{ marginLeft: 'auto' }}>{s.data[hover]}{unit}</b></div>)}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Bars                                                                */
/* ------------------------------------------------------------------ */
export const ColumnBars = memo(function ColumnBars({ data, h = 120, color = 'var(--accent)', labels }: { data: number[]; h?: number; color?: string; labels?: string[] }) {
  const max = Math.max(...data) || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: h }} role="img" aria-label={`Bar chart, max ${max}`}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }} title={`${labels?.[i] ?? i}: ${v}`}>
          <motion.div initial={{ height: 0 }} animate={{ height: `${(v / max) * 100}%` }} transition={{ duration: .8, delay: i * .025, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ width: '100%', minHeight: 2, borderRadius: '4px 4px 1px 1px', background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 25%, transparent))`, boxShadow: `0 0 8px color-mix(in srgb, ${color} 50%, transparent)` }} />
          {labels && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
});

export function MeterRow({ label, value, max = 100, color, suffix = '%', icon, right }: { label: React.ReactNode; value: number; max?: number; color?: 'good' | 'warn' | 'bad' | 'accent'; suffix?: string; icon?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      {icon}
      <span className="ellipsis" style={{ width: 110, flex: 'none', fontSize: 13 }}>{label}</span>
      <div className={'bar ' + (color && color !== 'accent' ? color : '')} style={{ flex: 1 }}>
        <motion.i initial={{ width: 0 }} animate={{ width: `${(value / max) * 100}%` }} transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }} />
      </div>
      <span className="tnum" style={{ width: 44, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{right ?? `${value}${suffix}`}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Radar (AgentMetricRadar)                                            */
/* ------------------------------------------------------------------ */
export const Radar = memo(function Radar({ axes, values, compare, size = 220, color = 'var(--accent-2)' }: { axes: string[]; values: number[]; compare?: number[]; size?: number; color?: string }) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 30;
  const pt = (i: number, v: number) => {
    const a = (i / axes.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * R * (v / 100), cy + Math.sin(a) * R * (v / 100)];
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(',')).join(' ');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }} role="img" aria-label={axes.map((a, i) => `${a} ${values[i]}`).join(', ')}>
      {[25, 50, 75, 100].map((l) => <polygon key={l} points={poly(axes.map(() => l))} fill="none" stroke="var(--border-soft)" />)}
      {axes.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border-soft)" />; })}
      {compare && <polygon points={poly(compare)} fill="var(--text-dim)" fillOpacity=".1" stroke="var(--text-dim)" strokeDasharray="4 4" />}
      <motion.polygon points={poly(values)} fill={color} fillOpacity=".22" stroke={color} strokeWidth="2"
        initial={{ scale: .2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: .9, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ transformOrigin: `${cx}px ${cy}px`, filter: `drop-shadow(0 0 6px ${color})` }} />
      {values.map((v, i) => { const [x, y] = pt(i, v); return <circle key={i} cx={x} cy={y} r="3.2" fill={color} />; })}
      {axes.map((a, i) => {
        const [x, y] = pt(i, 122);
        return <text key={a} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="10.5" fill="var(--text-muted)" fontWeight="600">{a}</text>;
      })}
    </svg>
  );
});
