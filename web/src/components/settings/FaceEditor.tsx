import { motion } from 'motion/react';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Segmented, SwitchRow } from '@/components/ui/Form';
import { ROLES } from '@/data/roles';
import type { RoleKey } from '@/data/types';
import { useSettings, type AvatarPrefs } from '@/store/settings';
import { toast } from '@/store/ui';
import '@/theme/pages/settings-ops-help.css';

export const SYNTH_NOTE = 'These settings change how generated robot avatars look. They are not identity, biometric data or face recognition, and they never imitate real people.';

export function SynthNote() {
  return (
    <div className="synth-note" role="note">
      <ShieldCheck size={18} />
      <div><b>Synthetic avatar styling only.</b> {SYNTH_NOTE}</div>
      <HelpTrigger k="settings.faces" />
    </div>
  );
}

const DEFAULT_AVATAR: AvatarPrefs = { faceMode: 'emblem', eyes: 'round', expression: 'happy', antenna: true, outline: true, glow: 0.8, hueShift: 0 };

function Lbl({ children, help }: { children: React.ReactNode; help: string }) {
  return <div className="ctl-label">{children}<HelpTrigger k={help} /></div>;
}

export function FaceControls() {
  const a = useSettings((s) => s.avatar);
  const set = useSettings((s) => s.setAvatar);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div><Lbl help="settings.faceMode">Face mode</Lbl>
        <Segmented ariaLabel="Face mode" value={a.faceMode} onChange={(v) => set({ faceMode: v })} options={[{ key: 'emblem', label: 'Role emblem' }, { key: 'face', label: 'Expressive face' }]} /></div>
      <div><Lbl help="settings.eyes">Eyes</Lbl>
        <Segmented ariaLabel="Eye style" value={a.eyes} onChange={(v) => set({ eyes: v, faceMode: 'face' })} options={[{ key: 'round', label: 'Round' }, { key: 'visor', label: 'Visor' }, { key: 'arc', label: 'Arc' }, { key: 'pixel', label: 'Pixel' }]} /></div>
      <div><Lbl help="settings.expression">Expression</Lbl>
        <Segmented ariaLabel="Expression" value={a.expression} onChange={(v) => set({ expression: v, faceMode: 'face' })} options={[{ key: 'neutral', label: 'Neutral' }, { key: 'happy', label: 'Happy' }, { key: 'focused', label: 'Focused' }]} /></div>
      <div className="grid g-2" style={{ gap: 16 }}>
        <div><Lbl help="settings.hue">Hue shift <b className="tnum" style={{ marginLeft: 6 }}>{a.hueShift > 0 ? '+' : ''}{a.hueShift}°</b></Lbl>
          <input type="range" className="range" min={-60} max={60} step={5} value={a.hueShift} onChange={(e) => set({ hueShift: +e.target.value })} aria-label="Hue shift" /></div>
        <div><Lbl help="settings.glow">Glow <b className="tnum" style={{ marginLeft: 6 }}>{Math.round(a.glow * 100)}%</b></Lbl>
          <input type="range" className="range" min={0} max={100} step={5} value={Math.round(a.glow * 100)} onChange={(e) => set({ glow: +e.target.value / 100 })} aria-label="Glow" /></div>
      </div>
      <div className="grid g-2" style={{ gap: 16 }}>
        <div className="subpanel" style={{ padding: '4px 12px' }}><SwitchRow label="Outline" help="settings.outline" checked={a.outline} onChange={(v) => set({ outline: v })} /></div>
        <div className="subpanel" style={{ padding: '4px 12px' }}><SwitchRow label="Antenna" help="settings.antenna" checked={a.antenna} onChange={(v) => set({ antenna: v })} /></div>
      </div>
      <div className="row"><button className="btn ghost" onClick={() => { set(DEFAULT_AVATAR); toast({ tone: 'info', title: 'Avatar style reset' }); }}><RotateCcw size={14} />Reset avatar style</button></div>
    </div>
  );
}

export function FacePreview({ role = 'dev', size = 220 }: { role?: RoleKey; size?: number }) {
  return (
    <div className="face-stage">
      <div className="face-halo" aria-hidden />
      <div className="face-ring" aria-hidden />
      <motion.div className="face-robot" key={role} initial={{ scale: .8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 16 }}>
        <RobotAvatar role={role} size={size} animated />
      </motion.div>
      <div className="face-cap">{ROLES[role].label}</div>
    </div>
  );
}

export function RoleGallery({ value, onPick, size = 62 }: { value?: RoleKey; onPick?: (r: RoleKey) => void; size?: number }) {
  const roles = Object.values(ROLES);
  return (
    <div className="role-gallery">
      {roles.map((r, i) => (
        <motion.button key={r.key} type="button" className={'role-tile' + (value === r.key ? ' on' : '')} onClick={() => onPick?.(r.key)} aria-label={`Preview ${r.label}`} aria-pressed={value === r.key}
          initial={{ opacity: 0, scale: .85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * .02 }} whileHover={{ y: -3 }}>
          <RobotAvatar role={r.key} size={size} />
          <span>{r.short}</span>
        </motion.button>
      ))}
    </div>
  );
}
