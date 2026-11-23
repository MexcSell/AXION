import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Settings as SettingsIcon, Crosshair, SlidersHorizontal, PanelLeft, UsersRound, Palette, ScanFace, Accessibility, Globe, Plug, HardDrive, ShieldCheck, DatabaseBackup,
  Building2, Languages, Check, Keyboard, GitBranch, AppWindow, Mic, Cpu, KeyRound, Lock, Download, Play, Eye, RotateCcw, CircleCheck, Scale, Clock3, History,
} from 'lucide-react';
import { TopBoard, FrameBody } from '@/components/layout/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { Field, Segmented, Switch, SwitchRow } from '@/components/ui/Form';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Chip, DemoTag } from '@/components/ui/Chips';
import { Donut, Legend, MeterRow } from '@/components/viz/Charts';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AppearanceControls, useEffectiveTheme } from '@/components/settings/AppearanceControls';
import { FaceControls, FacePreview, RoleGallery, SynthNote } from '@/components/settings/FaceEditor';
import { MiniStat, Row, SHORTCUTS } from '@/components/settings/bits';
import { useTab } from '@/hooks/useTab';
import { useSettings, type TextScale } from '@/store/settings';
import { openDialog, toast } from '@/store/ui';
import { SNAPSHOTS } from '@/data/operations';
import { ROLES } from '@/data/roles';
import type { RoleKey } from '@/data/types';
import '@/theme/pages/settings-ops-help.css';
import '@/theme/pages/settings-nav.css';
import { NavigationSettings } from '@/features/settings/NavigationSettings';
import { UsersSettings } from '@/features/settings/UsersSettings';
import { MyForecasts } from '@/features/settings/MyForecasts';
import { SiteGrants } from '@/features/settings/SiteGrants';
import { isApi } from '@/api/mode';
import { isAdmin, useMe } from '@/store/auth';
import '@/theme/pages/users-settings.css';

const ICONS = [SlidersHorizontal, UsersRound, Crosshair, PanelLeft, Palette, ScanFace, Accessibility, Globe, Plug, HardDrive, ShieldCheck, DatabaseBackup];

export default function SettingsPage() {
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
        {tab === 'Forecasts' && <MyForecasts />}
        {tab === 'Navigation' && <NavigationSettings />}
        {tab === 'Appearance' && <Appearance />}
        {tab === 'Avatars & Faces' && <Avatars />}
        {tab === 'Accessibility' && <A11y />}
        {tab === 'Browser' && <BrowserTab />}
        {tab === 'Integrations' && <Integrations />}
        {tab === 'Storage' && <StorageTab />}
        {tab === 'Security' && <Security />}
        {tab === 'Backups' && <Backups />}
      </FrameBody>
    </div>
  );
}

/* ------------------------------ General ------------------------------ */
function General({ setDirty }: { setDirty: (f: string[]) => void }) {
  const s = useSettings();
  const [name, setName] = useState(s.companyName);
  const [tz, setTz] = useState(s.timezone);
  const [scope, setScope] = useState<'personal' | 'org'>('org');
  const [datefmt, setDatefmt] = useState('YYYY-MM-DD');
  const [start, setStart] = useState('overview');
  const dirty = name !== s.companyName || tz !== s.timezone;
  const mark = (n: string, t: string) => { setName(n); setTz(t); const f: string[] = []; if (n !== s.companyName) f.push('Company name'); if (t !== s.timezone) f.push('Time zone'); setDirty(f); };
  const save = () => {
    if (!name.trim()) { toast({ tone: 'error', title: 'Company name is required' }); return; }
    s.set({ companyName: name.trim(), timezone: tz }); setDirty([]);
    toast({ tone: 'success', title: 'Settings saved', body: scope === 'org' ? 'Organization scope saved (stored in this browser in the demo).' : 'Personal scope saved.' });
  };
  return (
    <div className="grid g-3 set-grid">
      <Panel icon={Building2} title="Workspace" help="settings.general" delay={.05} actions={<DemoTag />}>
        <div className="col" style={{ gap: 12 }}>
          <Segmented ariaLabel="Save scope" value={scope} onChange={setScope} options={[{ key: 'org', label: 'Organization' }, { key: 'personal', label: 'Personal' }]} />
          <Field label="Company name" hint="Shown in the header and in reports.">
            <input className="input" value={name} onChange={(e) => mark(e.target.value, tz)} aria-label="Company name" data-autofocus />
          </Field>
          <Field label="Time zone">
            <select className="select" value={tz} onChange={(e) => mark(name, e.target.value)} aria-label="Time zone">
              {['UTC', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney'].map((z) => <option key={z}>{z}</option>)}
            </select>
          </Field>
          <Field label="Date format">
            <select className="select" value={datefmt} onChange={(e) => setDatefmt(e.target.value)} aria-label="Date format">
              {['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'].map((z) => <option key={z}>{z}</option>)}
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
          <Row label="Number format" help="settings.language"><select className="select" defaultValue="1,234.56" aria-label="Number format"><option>1,234.56</option><option>1.234,56</option></select></Row>
        </div>
      </Panel>
      <Panel icon={SlidersHorizontal} title="Defaults" help="settings.general" delay={.15}>
        <div className="col" style={{ gap: 4 }}>
          <Row label="Start page" desc="Where you land after sign-in"><select className="select" value={start} onChange={(e) => { setStart(e.target.value); toast({ tone: 'success', title: 'Start page saved (demo)' }); }} aria-label="Start page"><option value="overview">Overview</option><option value="missions">Missions</option><option value="agents">Agents</option></select></Row>
          <Row label="Collapse side rail" desc="Ctrl + B toggles it anywhere"><Switch label="Collapse side rail" checked={s.railCollapsed} onChange={(v) => s.set({ railCollapsed: v })} /></Row>
          <Row label="Autosave drafts" desc="Mission and message drafts"><Switch label="Autosave drafts" checked onChange={() => toast({ tone: 'info', title: 'Autosave is always on in the demo' })} /></Row>
          <div className="divider" />
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={() => openDialog('appearance')}><Palette size={14} />Appearance Studio</button>
            <button className="btn danger" onClick={() => { s.reset(); toast({ tone: 'info', title: 'All preferences reset' }); }}><RotateCcw size={14} />Reset all preferences</button>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>AXION v3.2.0 · prototype build · settings stored locally</div>
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
  const [sr, setSr] = useState<'brief' | 'detailed'>('brief');
  const [focus, setFocus] = useState(true);
  const [audio, setAudio] = useState(false);
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
          <SwitchRow label="Visible focus ring" desc="Always show keyboard focus" checked={focus} onChange={(v) => { setFocus(v); toast({ tone: 'info', title: 'Focus ring is always on (demo)' }); setFocus(true); }} />
          <SwitchRow label="Audio alerts" desc="Soft tone for approvals" checked={audio} onChange={(v) => { setAudio(v); toast({ tone: 'info', title: v ? 'Audio alerts on (demo, no sound)' : 'Audio alerts off' }); }} />
          <div className="divider" />
          <Row label="Screen reader detail"><Segmented size="sm" ariaLabel="Screen reader verbosity" value={sr} onChange={setSr} options={[{ key: 'brief', label: 'Brief' }, { key: 'detailed', label: 'Detailed' }]} /></Row>
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
function BrowserTab() {
  const [size, setSize] = useState('1440x900');
  const [timeout, setTimeoutS] = useState(45);
  const [dl, setDl] = useState(false);
  const [grant, setGrant] = useState('1h');
  const [testing, setTesting] = useState(0);
  const grantsUi = isApi() && isAdmin(useMe()); // c36: real site grants, administrators, api mode
  const run = () => {
    setTesting(1);
    let p = 1;
    const id = window.setInterval(() => { p += 11; if (p >= 100) { window.clearInterval(id); setTesting(0); toast({ tone: 'success', title: 'Safe fixture passed (demo)', body: 'Loaded the local test page, took a screenshot and closed the session.' }); } else setTesting(p); }, 140);
  };
  const policy: [string, string, string][] = [
    ['Viewport', size, 'Default'], ['Action timeout', `${timeout} s`, 'Default'], ['Downloads', dl ? 'Ask each time' : 'Blocked', 'Default'],
    ['Grant duration', grant, 'Default'], ['Proxy', 'None (no authorized policy)', 'Policy'], ['New origins', 'Need separate approval', 'Policy'],
  ];
  return (
    <div className="grid set-grid-2">
      <Panel icon={Globe} titleSize="lg" title="Browser defaults" help="settings.browser" delay={.05} sub="Missions can only be stricter">
        <div className="col" style={{ gap: 4 }}>
          <Row label="Session size" desc="Viewport used by browser agents"><Segmented size="sm" ariaLabel="Session size" value={size} onChange={setSize} options={[{ key: '1280x720', label: '1280×720' }, { key: '1440x900', label: '1440×900' }, { key: '1920x1080', label: '1920×1080' }]} /></Row>
          <Row label="Action timeout" desc={`${timeout} seconds per action`}><input type="range" className="range" style={{ width: 180 }} min={10} max={120} step={5} value={timeout} onChange={(e) => setTimeoutS(+e.target.value)} aria-label="Action timeout" /></Row>
          <Row label="Allow downloads" desc="Files are scanned before use"><Switch label="Allow downloads" checked={dl} onChange={setDl} /></Row>
          <Row label="Default grant length" desc="New website grants expire"><select className="select" value={grant} onChange={(e) => setGrant(e.target.value)} aria-label="Default grant length"><option>15m</option><option>1h</option><option>1d</option></select></Row>
          <Row label="Proxy" desc="Only with an authorized network policy"><Chip hue={30} size="sm"><Lock size={11} />Locked</Chip></Row>
          <div className="divider" />
          <div className="row" style={{ gap: 10 }}>
            <button className="btn primary" onClick={run} disabled={testing > 0}><Play size={14} />{testing ? 'Testing…' : 'Test safe fixture'}</button>
            {testing > 0 && <div className="bar grow"><i style={{ width: `${testing}%` }} /></div>}
          </div>
        </div>
      </Panel>
      <div className="col" style={{ gap: 'var(--gap)' }}>
        {grantsUi && <SiteGrants />}
        <Panel icon={ShieldCheck} title="Effective policy" help="settings.browser" delay={.12} actions={<DemoTag />}>
          <div className="table-wrap"><table className="table"><thead><tr><th>Setting</th><th>Value</th><th>Source</th></tr></thead>
            <tbody>{policy.map(([a, b, c]) => <tr key={a}><td>{a}</td><td className="mono">{b}</td><td><Chip hue={c === 'Policy' ? 268 : 205} size="sm">{c}</Chip></td></tr>)}</tbody></table></div>
        </Panel>
      </div>
    </div>
  );
}

/* ----------------------------- Integrations ----------------------------- */
function Integrations() {
  const init = [
    { k: 'models', icon: Cpu, name: 'Model providers', desc: '3 approved providers, models picked by the Model Loader', on: true, hue: 262 },
    { k: 'github', icon: GitBranch, name: 'GitHub project', desc: 'axion-company/web, read and PR comments', on: true, hue: 215 },
    { k: 'chrome', icon: AppWindow, name: 'Chrome extension', desc: 'Optional page picker for grants', on: false, hue: 38 },
    { k: 'stt', icon: Mic, name: 'Speech to text', desc: 'Voice commands in the composer', on: false, hue: 190 },
    { k: 'tts', icon: Mic, name: 'Text to speech', desc: 'Read summaries aloud', on: false, hue: 330 },
  ];
  const [items, setItems] = useState(init);
  const toggle = (k: string) => setItems((x) => x.map((i) => i.k === k ? { ...i, on: !i.on } : i));
  return (
    <Panel icon={Plug} titleSize="lg" title="Integrations" help="settings.integrations" delay={.05} sub="Scoped credentials, never displayed" actions={<DemoTag />}>
      <div className="grid g-3">
        {items.map((i, n) => (
          <motion.div key={i.k} className="subpanel glass-card hoverable int-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: n * .05 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="int-ico" style={{ ['--h' as string]: i.hue }}><i.icon size={20} /></span>
              <div style={{ minWidth: 0 }}><b>{i.name}</b><div className="dim" style={{ fontSize: 12 }}>{i.desc}</div></div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <Chip hue={i.on ? 148 : 240} size="sm"><span className="dot sm" />{i.on ? 'Connected' : 'Not connected'}</Chip>
              <span className="spacer" />
              <button className={'btn sm' + (i.on ? '' : ' primary')} onClick={() => { toggle(i.k); toast({ tone: i.on ? 'warning' : 'success', title: `${i.name} ${i.on ? 'disconnected' : 'connected'} (demo)`, body: 'A real connection needs Admin approval and a scoped credential.' }); }}>{i.on ? 'Disconnect' : 'Connect'}</button>
            </div>
          </motion.div>
        ))}
        <div className="subpanel row" style={{ gap: 10, borderStyle: 'dashed' }}><KeyRound size={18} className="info" /><span className="dim" style={{ fontSize: 12.5 }}>Credentials are stored server-side and masked here as <span className="mono">••••••••</span>.</span></div>
      </div>
    </Panel>
  );
}

/* ------------------------------- Storage ------------------------------- */
function StorageTab() {
  const [retention, setRetention] = useState('90');
  const [quota, setQuota] = useState(20);
  const [hold, setHold] = useState(false);
  const data = [{ label: 'Artifacts', value: 212, color: 'var(--accent-2)' }, { label: 'Database', value: 38, color: 'var(--violet)' }, { label: 'Backups', value: 96, color: 'var(--good)' }, { label: 'Logs', value: 18, color: 'var(--warn)' }];
  return (
    <div className="grid set-grid-2">
      <Panel icon={HardDrive} titleSize="lg" title="Storage policy" help="settings.storage" delay={.05}>
        <div className="col" style={{ gap: 4 }}>
          <Row label="Retention" desc="Mission media and logs"><select className="select" value={retention} onChange={(e) => setRetention(e.target.value)} aria-label="Retention days"><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></Row>
          <Row label="Media quota per mission" desc={`${quota} GB`}><input className="range" type="range" style={{ width: 180 }} min={5} max={100} step={5} value={quota} onChange={(e) => setQuota(+e.target.value)} aria-label="Media quota" /></Row>
          <Row label="Encryption at rest" desc="AES-256, managed by the host"><Chip hue={148} size="sm"><Lock size={11} />On, locked</Chip></Row>
          <Row label="Legal hold" desc="Blocks all deletion"><Switch label="Legal hold" checked={hold} onChange={(v) => { setHold(v); toast({ tone: v ? 'warning' : 'info', title: v ? 'Legal hold on (demo)' : 'Legal hold off' }); }} /></Row>
          <div className="divider" />
          <div className="subpanel" style={{ fontSize: 12.5 }}>
            <b>Removal preview</b>
            <div className="dim">Shortening retention to {retention === '30' ? '30 days' : retention === '90' ? '90 days' : '1 year'} would remove about <b className="warn">{retention === '30' ? '84 GB' : retention === '90' ? '0 GB' : '0 GB'}</b> of artifacts. Nothing is deleted until you confirm.</div>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => toast({ tone: 'info', title: 'Export started (demo)', body: 'A sanitized archive would be prepared for Owner download.' })}><Download size={14} />Export data</button>
            <button className="btn danger" disabled={hold} onClick={() => toast({ tone: 'warning', title: 'Purge needs Owner approval (demo)' })}>Request purge</button>
          </div>
        </div>
      </Panel>
      <Panel icon={HardDrive} title="Usage" help="settings.storage" delay={.12} actions={<DemoTag />}>
        <div className="row" style={{ gap: 20, alignItems: 'center' }}>
          <Donut segs={data} size={150} center="364 GB" sub="of 980 GB" />
          <div className="col grow" style={{ gap: 10 }}>
            <Legend segs={data} />
            <MeterRow label="Total capacity" value={37} />
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------- Security ------------------------------- */
function Security() {
  const [authed, setAuthed] = useState(false);
  const [tfa, setTfa] = useState(true);
  const [sess, setSess] = useState('30');
  const [audit] = useState(true);
  const need = () => toast({ tone: 'warning', title: 'Re-authenticate first', body: 'Security changes need a fresh sign-in.' });
  return (
    <div className="grid set-grid-2">
      <Panel icon={ShieldCheck} titleSize="lg" title="Security" help="settings.security" delay={.05}
        actions={authed ? <Chip hue={148}><CircleCheck size={12} />Re-authenticated</Chip> : <button className="btn primary sm" onClick={() => { setAuthed(true); toast({ tone: 'success', title: 'Re-authenticated for 5 minutes (demo)' }); }}><Lock size={13} />Re-authenticate</button>}>
        <div className="col" style={{ gap: 4 }}>
          <Row label="Two-factor sign-in" desc="Authenticator app or passkey"><Switch label="Two-factor sign-in" checked={tfa} onChange={(v) => authed ? setTfa(v) : need()} /></Row>
          <Row label="Session timeout" desc="Idle sign-out"><select className="select" value={sess} onChange={(e) => authed ? setSess(e.target.value) : need()} aria-label="Session timeout"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="120">2 hours</option></select></Row>
          <Row label="Audit trail" desc="Every approval and grant is recorded"><Chip hue={148} size="sm">{audit ? 'Always on' : 'Off'}</Chip></Row>
          <Row label="Allowed sign-in" desc="Single sign-on and passkey"><span className="row wrap" style={{ gap: 4 }}><Chip hue={205} size="sm">SSO</Chip><Chip hue={268} size="sm">Passkey</Chip></span></Row>
          <Row label="Privacy rules" desc="Personal data is redacted from logs and exports"><Chip hue={148} size="sm">Enforced</Chip></Row>
          <Row label="API token" desc="Never shown after creation"><span className="mono dim">axn_••••••••••••9f2c</span></Row>
        </div>
      </Panel>
      <Panel icon={History} title="Recent security events" help="settings.security" delay={.12} actions={<DemoTag />}>
        <div className="col" style={{ gap: 8 }}>
          {[['Sign-in from new device (approved)', '2h ago', 'info'], ['Browser grant docs.example.com created', '5h ago', 'good'], ['Failed sign-in attempt blocked', '1d ago', 'warn'], ['Session timeout changed to 30 min', '3d ago', 'info']].map(([t, w, tone], i) => (
            <motion.div key={t} className="list-row" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .1 + i * .05 }}>
              <span className="dot" style={{ color: `var(--${tone})` }} /><span className="grow">{t}</span><span className="dim" style={{ fontSize: 12 }}>{w}</span>
            </motion.div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------- Backups ------------------------------- */
function Backups() {
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const verify = (id: string) => { setVerifying(id); window.setTimeout(() => { setVerifying(null); setVerified((v) => ({ ...v, [id]: true })); toast({ tone: 'success', title: `${id} integrity verified`, body: 'Checksums match (demo).' }); }, 1300); };
  const next = useMemo(() => '03:00 UTC tomorrow', []);
  return (
    <div className="col" style={{ gap: 'var(--gap)' }}>
      <div className="grid g-4">
        <MiniStat label="Last backup" value="7h ago" tone="good" sub="snap-1120-0300" help="settings.backups" />
        <MiniStat label="Integrity" value="Verified" tone="good" sub="all 14 snapshots" />
        <MiniStat label="Retention" value="14 days" tone="info" sub="daily + weekly" />
        <MiniStat label="Next backup" value={next.split(' ')[0]} tone="violet" sub="UTC, tomorrow" />
      </div>
      <Panel icon={DatabaseBackup} titleSize="lg" title="Snapshots" help="settings.backups" delay={.08} actions={<><DemoTag /><button className="btn" onClick={() => toast({ tone: 'info', title: 'Backup requested (demo)', body: 'It runs at the next safe checkpoint.' })}>Run backup now</button></>}>
        <div className="table-wrap"><table className="table"><thead><tr><th>Snapshot</th><th>Created</th><th>Size</th><th>Hash</th><th>Compatibility</th><th>Integrity</th><th /></tr></thead>
          <tbody>{SNAPSHOTS.map((sn) => (
            <tr key={sn.id}>
              <td className="mono">{sn.id}</td><td>{sn.date}</td><td className="tnum">{sn.size}</td><td className="mono dim">{sn.hash}</td>
              <td><Chip hue={sn.compat.startsWith('Compat') ? 148 : 38} size="sm">{sn.compat}</Chip></td>
              <td>{verified[sn.id] || sn.verified ? <span className="good row" style={{ gap: 4 }}><CircleCheck size={14} />Verified</span> : '-'}</td>
              <td><span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <button className="btn sm" disabled={verifying === sn.id} onClick={() => verify(sn.id)}>{verifying === sn.id ? 'Verifying…' : 'Verify'}</button>
                <button className="btn sm primary" onClick={() => openDialog('backup-restore', { snapshot: sn.id })}>Request restore</button></span></td>
            </tr>))}</tbody></table></div>
        <div className="row dim" style={{ gap: 8, marginTop: 10, fontSize: 12 }}><Scale size={14} /><Clock3 size={14} />Restores are never direct. An Owner approves a request after a dry-run.</div>
      </Panel>
    </div>
  );
}
