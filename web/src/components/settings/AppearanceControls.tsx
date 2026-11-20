import { motion } from 'motion/react';
import { Check, Monitor, Moon, RotateCcw, Sparkles, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Segmented, SwitchRow } from '@/components/ui/Form';
import { ACCENTS, useSettings, type Accent, type Density, type MotionPref, type Skin, type ThemeMode } from '@/store/settings';
import { toast } from '@/store/ui';
import { cx } from '@/lib/format';
import '@/theme/pages/settings-ops-help.css';

export function useEffectiveTheme(): 'dark' | 'light' {
  const mode = useSettings((s) => s.themeMode);
  const [sysDark, setSysDark] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia('(prefers-color-scheme: dark)').matches));
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mode === 'system' ? (sysDark ? 'dark' : 'light') : mode;
}

/** Animated sun / moon / system toggle. */
export function ThemeToggle() {
  const mode = useSettings((s) => s.themeMode);
  const set = useSettings((s) => s.set);
  const eff = useEffectiveTheme();
  const pick = (m: ThemeMode) => { set({ themeMode: m }); };
  const dark = eff === 'dark';
  return (
    <div className="theme-toggle-wrap">
      <button type="button" className={cx('sunmoon', dark ? 'is-dark' : 'is-light')} role="switch" aria-checked={dark} aria-label="Toggle light or dark theme"
        onClick={() => pick(dark ? 'light' : 'dark')}>
        <span className="sm-stars" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ ['--i' as string]: i }} />)}</span>
        <span className="sm-clouds" aria-hidden><i /><i /></span>
        <motion.span className="sm-knob" animate={{ x: dark ? 62 : 0, rotate: dark ? 360 : 0 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
          {dark ? <Moon size={22} /> : <Sun size={22} />}
        </motion.span>
      </button>
      <Segmented ariaLabel="Theme mode" value={mode} onChange={pick} options={[
        { key: 'light', label: <><Sun size={14} />Light</> },
        { key: 'dark', label: <><Moon size={14} />Dark</> },
        { key: 'system', label: <><Monitor size={14} />System</> },
      ]} />
    </div>
  );
}

const SKINS: { key: Skin; label: string; desc: string }[] = [
  { key: 'luminous', label: 'Luminous', desc: 'Neon glass command center' },
  { key: 'flat', label: 'Flat', desc: 'Quiet, crisp and efficient' },
  { key: 'pretty', label: 'Pretty', desc: 'Soft rose and violet' },
  { key: 'fancy', label: 'Fancy', desc: 'Editorial deep violet' },
];

/** Mini rendered mock panel using the real design tokens of the given skin. */
export function SkinCard({ skin, selected, onSelect, theme, index = 0 }: { skin: Skin; selected: boolean; onSelect: () => void; theme: 'dark' | 'light'; index?: number }) {
  const meta = SKINS.find((s) => s.key === skin)!;
  return (
    <motion.button type="button" className={cx('skin-card', selected && 'selected')} onClick={onSelect} aria-pressed={selected} aria-label={`${meta.label} skin: ${meta.desc}`}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 * index, duration: .35 }} whileHover={{ y: -3 }} whileTap={{ scale: .98 }}>
      <div className="skin-mock" data-skin={skin} data-theme={theme}>
        <div className="sm-rail"><i /><i /><i className="on" /><i /></div>
        <div className="sm-main">
          <div className="sm-head"><b /><span /></div>
          <div className="sm-grid">
            <div className="sm-panel"><em /><div className="sm-bar"><i style={{ width: '72%' }} /></div><div className="sm-bar"><i style={{ width: '46%' }} /></div></div>
            <div className="sm-panel"><em /><div className="sm-ring" /><span className="sm-chip">OK</span></div>
          </div>
          <div className="sm-foot"><span className="sm-btn">Action</span><span className="sm-line" /></div>
        </div>
      </div>
      <div className="skin-meta">
        <b>{meta.label}</b>
        <span>{meta.desc}</span>
      </div>
      {selected && <motion.span className="skin-check" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}><Check size={13} /></motion.span>}
    </motion.button>
  );
}

export function AccentSwatches() {
  const accent = useSettings((s) => s.accent);
  const set = useSettings((s) => s.set);
  const items: { key: Accent; label: string; color: string }[] = [
    { key: 'default', label: 'Skin default', color: 'linear-gradient(135deg, var(--accent), var(--accent-2))' },
    ...(Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]).map((k) => ({ key: k as Accent, label: k[0].toUpperCase() + k.slice(1), color: ACCENTS[k].grad })),
  ];
  return (
    <div className="swatches" role="radiogroup" aria-label="Accent color">
      {items.map((a) => (
        <motion.button key={a.key} type="button" role="radio" aria-checked={accent === a.key} aria-label={a.label} title={a.label} className={cx('swatch', accent === a.key && 'on')}
          style={{ background: a.color }} onClick={() => set({ accent: a.key })} whileHover={{ scale: 1.14 }} whileTap={{ scale: .92 }}>
          {accent === a.key && <Check size={14} />}
        </motion.button>
      ))}
    </div>
  );
}

export function ResetAppearance({ onReset }: { onReset?: () => void }) {
  const reset = useSettings((s) => s.reset);
  return <button className="btn ghost" onClick={() => { reset(); toast({ tone: 'info', title: 'Appearance reset', body: 'All preferences returned to the defaults.' }); onReset?.(); }}><RotateCcw size={14} />Reset to defaults</button>;
}

function Lbl({ children, help }: { children: React.ReactNode; help: string }) {
  return <div className="ctl-label">{children}<HelpTrigger k={help} /></div>;
}

/** Full set of appearance controls: used by Settings > Appearance and the Appearance Studio dialog. */
export function AppearanceControls({ compact }: { compact?: boolean }) {
  const s = useSettings();
  const eff = useEffectiveTheme();
  return (
    <div className="col" style={{ gap: compact ? 14 : 18 }}>
      <div>
        <Lbl help="settings.theme">Theme</Lbl>
        <ThemeToggle />
      </div>
      <div>
        <Lbl help="settings.skin">Skin</Lbl>
        <div className={cx('grid', compact ? 'g-4' : 'g-4', 'skin-grid')}>
          {SKINS.map((k, i) => <SkinCard key={k.key} skin={k.key} theme={eff} selected={s.skin === k.key} index={i} onSelect={() => s.set({ skin: k.key })} />)}
        </div>
      </div>
      <div className={compact ? 'col' : 'grid g-2'} style={{ gap: compact ? 14 : 18, alignItems: 'start' }}>
        <div><Lbl help="settings.accent">Accent color</Lbl><AccentSwatches /></div>
        <div><Lbl help="settings.density">Density</Lbl>
          <Segmented ariaLabel="Density" value={s.density} onChange={(v: Density) => s.set({ density: v })} options={[{ key: 'compact', label: 'Compact' }, { key: 'comfortable', label: 'Comfortable' }, { key: 'spacious', label: 'Spacious' }]} />
        </div>
        <div><Lbl help="settings.motion">Motion</Lbl>
          <Segmented ariaLabel="Motion" value={s.motion} onChange={(v: MotionPref) => s.set({ motion: v })} options={[{ key: 'full', label: 'Full' }, { key: 'subtle', label: 'Subtle' }, { key: 'reduced', label: 'Reduced' }, { key: 'system', label: 'System' }]} />
        </div>
        <div className="subpanel" style={{ padding: '4px 12px' }}>
          <SwitchRow label="Particles" help="settings.particles" desc="Ambient particle field that reacts to real events" checked={s.particles} onChange={(v) => s.set({ particles: v })} />
          <SwitchRow label="Header banner" help="settings.headerBanner" desc="Top strip with logo, skyline art, Plan → Sustain loop and quick actions" checked={s.headerBanner}
            onChange={(v) => { s.set({ headerBanner: v }); toast({ tone: 'info', title: v ? 'Header banner shown' : 'Header banner hidden', body: v ? undefined : 'Restore it from the tab at the top, Ctrl K, or here.' }); }} />
        </div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <ResetAppearance />
        <span className="dim row" style={{ fontSize: 12, gap: 6 }}><Sparkles size={13} />Changes apply instantly and are saved in this browser.</span>
      </div>
    </div>
  );
}
