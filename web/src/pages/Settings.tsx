import { motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Settings as SettingsIcon, Crosshair, SlidersHorizontal, PanelLeft, UsersRound, Palette, ScanFace, Accessibility, Globe,
  Building2, Languages, Check, Keyboard, Cpu, Eye, RotateCcw } from 'lucide-react';
import { TopBoard, FrameBody } from '@/components/layout/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { Field, Switch, SwitchRow } from '@/components/ui/Form';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Chip } from '@/components/ui/Chips';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AppearanceControls, useEffectiveTheme } from '@/components/settings/AppearanceControls';
import { FaceControls, FacePreview, RoleGallery, SynthNote } from '@/components/settings/FaceEditor';
import { MiniStat, Row, SHORTCUTS } from '@/components/settings/bits';
import { useTab } from '@/hooks/useTab';
import { useSettings, type TextScale } from '@/store/settings';
import { openDialog, toast } from '@/store/ui';
import { ROLES } from '@/data/roles';
import type { RoleKey } from '@/data/types';
import '@/theme/pages/settings-ops-help.css';
import '@/theme/pages/settings-nav.css';
import { NavigationSettings } from '@/features/settings/NavigationSettings';
import { UsersSettings } from '@/features/settings/UsersSettings';
import { MyForecasts } from '@/features/settings/MyForecasts';
import { ChatModelSettings } from '@/features/settings/ChatModelSettings';
import { SiteGrants } from '@/features/settings/SiteGrants';
import { isAdmin, useMe } from '@/store/auth';
import '@/theme/pages/users-settings.css';

const ICONS = [SlidersHorizontal, UsersRound, Crosshair, PanelLeft, Palette, ScanFace, Accessibility, Globe];

export default function SettingsPage() {
  const admin = isAdmin(useMe());
  const [tab, setTab, tabs] = useTab('settings');
  const [dirty, setDirty] = useState<string[]>([]);
  const change = (t: string) => {
    if (dirty.length && t !== tab) {
      openDialog('unsaved-changes', { fields: dirty, onDiscard: () => { setDirty([]); setTab(t); } });
      return;
    }
    setTab(t);
  };
  return (
    <div className="page">
      <TopBoard icon={SettingsIcon} title="Settings" help="settings.general" sub="Configure your workspace, users and devices, navigation, appearance, avatars, accessibility, browser, integrations and security."
        tabs={{ tabs, value: tab, onChange: change, icons: ICONS, ariaLabel: 'Settings sections' }}
        toolbar={dirty.length ? <span className="warn">{dirty.length} unsaved change{dirty.length > 1 ? 's' : ''}</span> : undefined} />
      <FrameBody tab={tab} panel={false}>
        {tab === 'General' && <General setDirty={setDirty} />}
        {tab === 'Users' && <UsersSettings />}
        {tab === 'AI Chat' && <ChatModelSettings admin={admin} />}
        {tab === 'Forecasts' && <MyForecasts />}
        {tab === 'Navigation' && <NavigationSettings />}
        {tab === 'Appearance' && <Appearance />}
        {tab === 'Avatars & Faces' && <Avatars />}
        {tab === 'Accessibility' && <A11y />}
        {tab === 'Browser' && (admin ? <SiteGrants /> : <Panel title="Browser permissions">Administrator access is required to manage site grants.</Panel>)}
      </FrameBody>
    </div>
  );
}

/* ------------------------------ General ------------------------------ */
function General({ setDirty }: { setDirty: (f: string[]) => void }) {
  const s = useSettings();
  const [name, setName] = useState(s.companyName);
  const [tz, setTz] = useState(s.timezone);
  const dirty = name !== s.companyName || tz !== s.timezone;
  const mark = (n: string, t: string) => { setName(n); setTz(t); const f: string[] = []; if (n !== s.companyName) f.push('Company name'); if (t !== s.timezone) f.push('Time zone'); setDirty(f); };
  const save = () => {
    if (!name.trim()) { toast({ tone: 'error', title: 'Company name is required' }); return; }
    s.set({ companyName: name.trim(), timezone: tz }); setDirty([]);
    toast({ tone: 'success', title: 'Settings saved', body: 'Your preferences were saved in this browser.' });
  };
  return (
    <div className="grid g-3 set-grid">
      <Panel icon={Building2} title="Workspace" help="settings.general" delay={.05} >
        <div className="col" style={{ gap: 12 }}>
          <Field label="Company name" hint="Your workspace display name.">
            <input className="input" value={name} onChange={(e) => mark(e.target.value, tz)} aria-label="Company name" data-autofocus />
          </Field>
          <Field label="Time zone">
            <select className="select" value={tz} onChange={(e) => mark(name, e.target.value)} aria-label="Time zone">
              {['UTC', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'].map((z) => <option key={z}>{z}</option>)}
            </select>
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={save} disabled={!dirty}><Check size={15} />Save changes</button>
            <button className="btn ghost" disabled={!dirty} onClick={() => { mark(s.companyName, s.timezone); setDirty([]); }}>Revert</button>
            {dirty && <Chip hue={40} size="sm">unsaved</Chip>}
          </div>
        </div>
      </Panel>
      <Panel icon={Languages} title="Language" help="settings.language" delay={.1}>
        <div className="col" style={{ gap: 10 }}>
          {([['en', 'English', 'Complete', 148], ['ja', '日本語 (Japanese)', 'Planned', 262]] as const).map(([k, label, st, hue]) => (
            <motion.button key={k} className={'lang-card glass-card hoverable' + (s.language === k ? ' selected' : '')} whileHover={{ y: -2 }} whileTap={{ scale: .98 }}
              onClick={() => { s.set({ language: k }); if (k === 'ja') toast({ tone: 'info', title: '日本語 saved as your preference', body: 'The translation pack is planned. The interface stays in English until it ships.' }); else toast({ tone: 'success', title: 'Language set to English' }); }}
              aria-pressed={s.language === k}>
              <span className="lang-code">{k.toUpperCase()}</span>
              <span style={{ textAlign: 'left', flex: 1 }}><b>{label}</b><div className="dim" style={{ fontSize: 12 }}>Interface and help text</div></span>
              <Chip hue={hue} size="sm">{st}</Chip>
              {s.language === k && <Check size={16} className="good" />}
            </motion.button>
          ))}
        </div>
      </Panel>
      <Panel icon={SlidersHorizontal} title="Defaults" help="settings.general" delay={.15}>
        <div className="col" style={{ gap: 4 }}>
          <Row label="Collapse side rail" desc="Ctrl + B toggles it anywhere"><Switch label="Collapse side rail" checked={s.railCollapsed} onChange={(v) => s.set({ railCollapsed: v })} /></Row>
          <div className="divider" />
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={() => openDialog('appearance')}><Palette size={14} />Appearance Studio</button>
            <button className="btn danger" onClick={() => { s.reset(); toast({ tone: 'info', title: 'All preferences reset' }); }}><RotateCcw size={14} />Reset all preferences</button>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Preferences are stored in this browser.</div>
        </div>
      </Panel>
    </div>
  );
}

/* ----------------------------- Appearance ----------------------------- */
function Appearance() {
  return (
    <div className="grid set-grid-2">
      <Panel icon={Palette} titleSize="lg" title="Appearance" help="settings.appearance" sub="Live preview, instantly reversible" delay={.05}>
        <AppearanceControls />
      </Panel>
      <LiveSample />
    </div>
  );
}

function LiveSample() {
  const s = useSettings();
  const eff = useEffectiveTheme();
  return (
    <Panel icon={Eye} title="Live sample" help="settings.appearance" delay={.12} sub={`${s.skin} · ${eff} · ${s.density}`}>
      <div className="col" style={{ gap: 12 }}>
        <div className="grid g-2" style={{ gap: 10 }}>
          <MiniStat label="Verified progress" value="76%" tone="good" sub="13 of 17 tasks" />
          <MiniStat label="Pending approvals" value="3" tone="warn" sub="2 browser, 1 release" />
        </div>
        <div className="subpanel">
          <div className="row" style={{ marginBottom: 8 }}><b>Checkout migration</b><span className="spacer" /><Chip hue={148} size="sm">Running</Chip></div>
          <div className="bar thick"><motion.i key={s.accent + s.skin} initial={{ width: 0 }} animate={{ width: '76%' }} transition={{ duration: .9 }} /></div>
          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            <button className="btn primary sm">Primary</button><button className="btn sm">Default</button><button className="btn ghost sm">Ghost</button><button className="btn good sm">Approve</button><button className="btn danger sm">Reject</button>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {[148, 205, 268, 38, 330].map((h) => <Chip key={h} hue={h}>{['Healthy', 'Info', 'Violet', 'Warning', 'Design'][[148, 205, 268, 38, 330].indexOf(h)]}</Chip>)}
          <span className="kbd">Ctrl</span><span className="kbd">K</span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {(['dev', 'qa', 'manager', 'design'] as RoleKey[]).map((r) => <RobotAvatar key={r} role={r} size={52} animated />)}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------ Avatars ------------------------------ */
function Avatars() {
  const [role, setRole] = useState<RoleKey>('dev');
  const a = useSettings((s) => s.avatar);
  return (
    <div className="col" style={{ gap: 'var(--gap)' }}>
      <SynthNote />
      <div className="grid set-grid-2">
        <Panel icon={ScanFace} titleSize="lg" title="Live face editor" help="settings.avatarPreview" delay={.05} sub="Changes every avatar in the app">
          <div className="face-editor">
            <FacePreview role={role} />
            <FaceControls />
          </div>
        </Panel>
        <div className="col" style={{ gap: 'var(--gap)' }}>
          <Panel icon={Cpu} title="Role gallery" help="settings.avatarPreview" delay={.12} sub={`${Object.keys(ROLES).length} roles · click to preview`}>
            <RoleGallery value={role} onPick={setRole} />
          </Panel>
          <Panel icon={Accessibility} title="Accessible names" help="settings.altText" delay={.18}>
            <div className="col" style={{ gap: 8, fontSize: 13 }}>
              <div className="subpanel row" style={{ gap: 10 }}><RobotAvatar role={role} size={40} /><div><span className="dim" style={{ fontSize: 11.5 }}>Alt text (screen readers)</span><div className="mono">{ROLES[role].label} agent avatar</div></div></div>
              <div className="dim" style={{ fontSize: 12 }}>Current style: {a.faceMode === 'face' ? `${a.expression} face, ${a.eyes} eyes` : 'role emblem'}, glow {Math.round(a.glow * 100)}%, {a.outline ? 'outlined' : 'no outline'}, {a.antenna ? 'with' : 'without'} antenna.</div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Accessibility ---------------------------- */
function A11y() {
  const s = useSettings();
  const scales: { k: TextScale; label: string; px: number }[] = [{ k: 'md', label: 'Medium', px: 16 }, { k: 'lg', label: 'Large', px: 19 }, { k: 'xl', label: 'Extra large', px: 22 }];
  return (
    <div className="grid g-3 set-grid">
      <Panel icon={Accessibility} title="Text size" help="settings.textScale" delay={.05}>
        <div className="grid g-3" style={{ gap: 8 }}>
          {scales.map((x) => (
            <motion.button key={x.k} className={'scale-card glass-card hoverable' + (s.textScale === x.k ? ' selected' : '')} whileHover={{ y: -2 }} onClick={() => s.set({ textScale: x.k })} aria-pressed={s.textScale === x.k}>
              <span style={{ fontSize: x.px + 8, fontWeight: 700, fontFamily: 'var(--font-display)' }}>Aa</span>
              <span style={{ fontSize: 12 }}>{x.label}</span>
            </motion.button>
          ))}
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>Applies to the whole interface immediately.</p>
        <div className="divider" />
        <div className="ctl-label">Reduced-motion preview<HelpTrigger k="settings.motion" /></div>
        <div className="motion-demo" aria-hidden>
          <motion.span className="motion-orb" animate={s.motion === 'reduced' ? { opacity: [1, .5, 1] } : { x: [0, 150, 0], scale: [1, 1.2, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>{s.motion === 'reduced' ? 'Reduced: the orb only fades.' : 'Full: the orb travels and pulses. Turn on Reduce motion to compare.'}</p>
      </Panel>
      <Panel icon={Eye} title="Vision and motion" help="settings.accessibility" delay={.1}>
        <div className="col" style={{ gap: 2 }}>
          <SwitchRow label="High contrast" help="settings.contrast" desc="Stronger borders and text" checked={s.highContrast} onChange={(v) => s.set({ highContrast: v })} />
          <SwitchRow label="Reduce motion" help="settings.motion" desc="Fades only, no movement" checked={s.motion === 'reduced'} onChange={(v) => s.set({ motion: v ? 'reduced' : 'full' })} />
          <div className="divider" />
          <div className="row" style={{ marginTop: 8 }}><button className="btn" onClick={() => openDialog('accessibility-prefs')}><Accessibility size={14} />Open preferences dialog</button></div>
        </div>
      </Panel>
      <Panel icon={Keyboard} title="Keyboard shortcuts" help="settings.shortcuts" delay={.15}>
        <div className="col" style={{ gap: 6 }}>
          {SHORTCUTS.slice(0, 6).map(([k, d], i) => (
            <motion.div key={d} className="kbd-row" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .15 + i * .04 }}>
              <span className="row" style={{ gap: 4 }}>{k.map((x) => <span key={x} className="kbd">{x}</span>)}</span><span>{d}</span>
            </motion.div>
          ))}
          <Link className="btn ghost sm" to="/help?tab=shortcuts" style={{ alignSelf: 'flex-start', marginTop: 4 }}>All shortcuts</Link>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------- Browser ------------------------------- */
