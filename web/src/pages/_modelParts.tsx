import { motion } from 'motion/react';
import { useId } from 'react';
import { Brain, Eye, Binary, Mic, Volume2, Languages, Cloud, Cpu, FileBox, AudioLines, HardDrive, MemoryStick } from 'lucide-react';
import { usageBand, type ModelDef, type ModelRuntime } from '@/data/models';
import '@/theme/pages/models.css';

export const KIND_ICON = { LLM: Brain, Vision: Eye, Embeddings: Binary, STT: Mic, TTS: Volume2, Translation: Languages } as const;
export const RUNTIME: Record<ModelRuntime, { label: string; icon: typeof Cloud; hue: number }> = {
  api: { label: 'API', icon: Cloud, hue: 215 },
  ollama: { label: 'Ollama', icon: Cpu, hue: 150 },
  gguf: { label: 'GGUF', icon: FileBox, hue: 28 },
  speech: { label: 'Speech runtime', icon: AudioLines, hue: 330 },
};
export const runtimeOf = (m: ModelDef): ModelRuntime => m.runtime ?? (m.local ? 'ollama' : 'api');
const BAND_VAR = { ok: 'var(--accent-2)', warn: 'var(--warn)', bad: 'var(--bad)' } as const;

/** Circular "how much is used" ring. Colour = status band (high use warns), always paired with a text label. */
export function UseRing({ used, total, unit, size = 74, stroke = 7, caption, icon: Icon, ghost, share }: {
  used: number; total: number; unit: string; size?: number; stroke?: number; caption?: string; icon?: typeof Cloud;
  /** not in use right now: draw the share it WOULD take as a dashed, muted arc */
  ghost?: boolean;
  /** share-of-company mode: neutral colour, no limit bands (owner u1: no limits) */
  share?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const band = ghost ? { tone: 'idle' as const, label: 'not loaded' } : share ? { tone: 'ok' as const, label: 'company share' } : usageBand(pct);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const col = band.tone === 'idle' ? 'var(--text-muted)' : BAND_VAR[band.tone];
  return (
    <div className={'mm-ring tone-' + band.tone} style={{ width: size }} role="img"
      aria-label={`${caption ?? 'Used'}: ${ghost ? 'needs ' : ''}${fmt(used)} of ${fmt(total)} ${unit}, ${Math.round(pct)}%, ${band.label}`}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
          <defs><filter id={`mg-${id}`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={stroke} />
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeDasharray={ghost ? undefined : c} filter={ghost ? undefined : `url(#mg-${id})`} opacity={ghost ? .7 : 1}
            style={ghost ? { strokeDasharray: `3 4` } : undefined}
            initial={ghost ? { pathLength: 0 } : { strokeDashoffset: c }} animate={ghost ? { pathLength: pct / 100 } : { strokeDashoffset: c * (1 - pct / 100) }} transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }} />
        </svg>
        <div className="mm-ring-c">
          {Icon && <Icon size={11} className="dim" aria-hidden />}
          <b className="tnum">{Math.round(pct)}%</b>
        </div>
      </div>
      <div className="mm-ring-cap">
        <span className="tnum">{ghost ? 'needs ' : ''}{share ? `${fmt(used)} ${unit}` : `${fmt(used)}/${fmt(total)} ${unit}`}</span>
        <span className={'mm-band ' + band.tone}>{caption ? `${caption} · ` : ''}{band.label}</span>
      </div>
    </div>
  );
}
const fmt = (n: number) => (n >= 100 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1));

/** Four characteristic bars (0-100). */
export function TraitBars({ m, compact }: { m: ModelDef; compact?: boolean }) {
  if (!m.traits) return <p className="dim" style={{ fontSize: 12 }}>No benchmark profile yet.</p>;
  const rows = [['Quality', m.traits.quality], ['Speed', m.traits.speed], ['Token eff.', m.traits.tokenEff], ['Context', m.traits.context]] as const;
  return (
    <div className={'mm-traits' + (compact ? ' compact' : '')}>
      {rows.map(([k, v], i) => (
        <div key={k} className="mm-trait">
          <span className="dim">{k}</span>
          <span className="mm-trait-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: .9, delay: .15 + i * .07 }} /></span>
          <b className="tnum">{v}</b>
        </div>
      ))}
    </div>
  );
}

/** Disk + memory footprint of local weights against the host. */
export function CapacityLine({ m, hostVram, hostRam, hostDisk, loaded }: { m: ModelDef; hostVram: number; hostRam: number; hostDisk: number; loaded: boolean }) {
  const w = m.weights; if (!w) return null;
  const memTotal = w.memKind === 'VRAM' ? hostVram : hostRam;
  return (
    <div className="mm-cap">
      <div className="mm-cap-row" title={`Weights file ${w.file}`}>
        <HardDrive size={12} aria-hidden /><span className="dim">Disk</span>
        <span className="mm-cap-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.max(2, (w.sizeGB / hostDisk) * 100)}%` }} transition={{ duration: .9 }} /></span>
        <b className="tnum">{w.sizeGB} GB</b>
      </div>
      <div className="mm-cap-row">
        <MemoryStick size={12} aria-hidden /><span className="dim">{w.memKind}</span>
        <span className={'mm-cap-bar mem' + (loaded ? '' : ' idle')}><motion.i initial={{ width: 0 }} animate={{ width: `${Math.max(2, (w.memGB / memTotal) * 100)}%` }} transition={{ duration: .9, delay: .1 }} /></span>
        <b className="tnum">{w.memGB} GB</b>
      </div>
    </div>
  );
}
