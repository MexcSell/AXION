import { motion } from 'motion/react';
import { Globe, GraduationCap, Network, RefreshCcw, Microscope, Database, Bot, Check, AlertTriangle, type LucideIcon } from 'lucide-react';
import type { Mission, MissionPhase } from '@/data/types';
import { MISSION_STATUS, TONE_VAR } from '@/data/roles';
import { cx } from '@/lib/format';

export const KIND_META: Record<Mission['kind'], { icon: LucideIcon; label: string; hue: number }> = {
  website: { icon: Globe, label: 'Website update', hue: 200 },
  training: { icon: GraduationCap, label: 'Agent training', hue: 45 },
  structure: { icon: Network, label: 'Structure change', hue: 280 },
  'self-update': { icon: RefreshCcw, label: 'Self-update', hue: 320 },
  research: { icon: Microscope, label: 'Research', hue: 265 },
  data: { icon: Database, label: 'Data', hue: 175 },
  automation: { icon: Bot, label: 'Automation', hue: 150 },
};

export function KindIcon({ kind, size = 34 }: { kind: Mission['kind']; size?: number }) {
  const k = KIND_META[kind];
  return (
    <span className="kind-icon" style={{ ['--h' as string]: k.hue, width: size, height: size }} aria-label={k.label} role="img">
      <k.icon size={size * 0.52} strokeWidth={1.9} />
    </span>
  );
}

export function statusTone(m: Mission) { return TONE_VAR[MISSION_STATUS[m.status].tone]; }

/** Plan → Design → Build → Verify → Deliver → Learn stepper with animated connector fill. */
export function PhaseStepper({ phases, compact }: { phases: MissionPhase[]; compact?: boolean }) {
  const activeIdx = phases.findIndex((p) => p.state === 'active' || p.state === 'blocked');
  const doneCount = phases.filter((p) => p.state === 'done').length;
  const fill = Math.max(0, Math.min(1, (activeIdx >= 0 ? activeIdx : doneCount - 1) / (phases.length - 1)));
  return (
    <div className={cx('stepper', compact && 'compact')} role="list" aria-label="Mission phases">
      <div className="stepper-track"><motion.i initial={{ width: 0 }} animate={{ width: `${fill * 100}%` }} transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }} /></div>
      {phases.map((p, i) => (
        <motion.div key={p.key} role="listitem" className={cx('step', p.state)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}
          aria-label={`${p.label}: ${p.state}`}>
          <span className="step-dot">
            {p.state === 'done' ? <Check size={14} strokeWidth={3} /> : p.state === 'blocked' ? <AlertTriangle size={13} /> : <span className="step-num">{i + 1}</span>}
            {p.state === 'active' && <span className="step-pulse" />}
          </span>
          <span className="step-label">{p.label}</span>
          {!compact && <span className="step-date">{p.state === 'done' ? `✓ ${p.date}` : p.state === 'active' ? 'In progress' : p.state === 'blocked' ? 'Blocked' : p.date}</span>}
        </motion.div>
      ))}
    </div>
  );
}

export function ProgressRing({ value, size = 52, stroke = 5, tone = 'var(--accent-2)' }: { value: number; size?: number; stroke?: number; tone?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }} role="img" aria-label={`${value}% verified`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }} style={{ filter: `drop-shadow(0 0 4px ${tone})` }} />
      </svg>
      <span className="center tnum" style={{ position: 'absolute', inset: 0, fontWeight: 800, fontSize: size * 0.26 }}>{value}%</span>
    </div>
  );
}
