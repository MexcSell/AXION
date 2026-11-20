import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe, GlobeLock, ShieldCheck, Hand, Power, Workflow, Play, Pause, FileText, Image as ImageIcon, Table2, FileCode2, FileBarChart, Camera, Film,
  History, Download, Rocket, GitMerge, Undo2, BookPlus, BrainCircuit, Lock, AlertTriangle, CheckCircle2, ArrowUp, ArrowDown, Trash2, Plus, FlaskConical,
  PackageOpen, Eye, GitCompare, ScanSearch, KeyRound, Clock, MousePointer2, type LucideIcon,
} from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented, SwitchRow } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { CountUp } from '@/components/ui/CountUp';
import { toast } from '@/store/ui';
import { useData } from '@/store/data';
import { getMissionControl } from '@/data/missions';
import { AGENT_BY_ID, seeded } from '@/data/agents';
import { GRANTS, REPLAY, REPLAY_LEN, STEPS, nextSessionId, useBrowser, type Target, type Risk } from '@/data/browser';
import { RECIPES } from '@/data/browser';
import { LEARNING, useKnowledge } from '@/data/knowledge';
import { buildManifest, contentLines, diffLines, downloadText, EXT, findArtifact, pickVersion, sha256Hex, TYPE_HUE, useResults, type DiffRow } from '@/data/results';
import type { Artifact, ArtifactType, ArtifactVersion, Mission } from '@/data/types';
import { cx, ago } from '@/lib/format';
import '@/theme/pages/browser-results-knowledge.css';

/* ================================================================== */
/* Shared building blocks (also imported by the three pages)            */
/* ================================================================== */
export const TYPE_ICON: Record<ArtifactType, LucideIcon> = { website: Globe, document: FileText, image: ImageIcon, dataset: Table2, code: FileCode2, report: FileBarChart, recipe: Workflow, screenshot: Camera, video: Film };

export function TypeIcon({ type, size = 18 }: { type: ArtifactType; size?: number }) {
  const I = TYPE_ICON[type];
  return <I size={size} aria-hidden />;
}

export function VerifyBadge({ verified, compact }: { verified: boolean; compact?: boolean }) {
  return verified
    ? <span className="rv-verify good" title="Independent verification passed"><ShieldCheck size={13} />{!compact && 'Verified'}</span>
    : <span className="rv-verify warn" title="Verification pending: evidence not yet complete"><Clock size={13} />{!compact && 'Pending'}</span>;
}

export interface KpiDef { icon: LucideIcon; value: number; label: string; color: string; delta?: string; decimals?: number; suffix?: string; prefix?: string }
export function KpiStrip({ items }: { items: KpiDef[] }) {
  return (
    <div className="brk-kpis">
      {items.map((k, i) => (
        <motion.div key={k.label} className="kpi" style={{ ['--kc' as string]: k.color }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 + i * .06 }}>
          <k.icon size={32} strokeWidth={1.6} className="kpi-ico" aria-hidden />
          <div style={{ minWidth: 0 }}>
            <div className="kpi-val"><CountUp value={k.value} decimals={k.decimals} suffix={k.suffix} prefix={k.prefix} /></div>
            <div className="kpi-label">{k.label}</div>
            {k.delta && <div className="kpi-delta"><ArrowUp size={13} strokeWidth={3} />{k.delta}</div>}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function RiskMeter({ risk }: { risk: Risk }) {
  const n = { low: 1, medium: 2, high: 3, critical: 4 }[risk];
  const c = { low: 'var(--good)', medium: 'var(--warn)', high: '#fb923c', critical: 'var(--bad)' }[risk];
  return <span className="row" style={{ gap: 8 }}><span className="brk-risk" style={{ ['--c' as string]: c }} aria-hidden>{[1, 2, 3, 4].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</span><span style={{ fontSize: 12, fontWeight: 700, textTransform: 'capitalize', color: c }}>{risk}</span></span>;
}

export function DiffView({ rows, animate = true }: { rows: DiffRow[]; animate?: boolean }) {
  return (
    <div className="diff" role="table" aria-label="Line diff">
      {rows.map((r, i) => (
        <div key={i} className={cx('diff-row', r.kind, animate && r.kind !== 'same' && 'new')} style={animate ? { animationDelay: `${Math.min(i, 30) * 16}ms` } : undefined} role="row">
          <span className="n">{r.a ?? ''}</span><span className="n">{r.b ?? ''}</span><span className="m">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</span><span className="t">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- fake browser viewport ---------------- */
const TARGET_RECT: Record<Target, { x: number; y: number; w: number; h: number; label: string } | null> = {
  nav: { x: 0, y: 0, w: 100, h: 9, label: 'navigate' },
  read: { x: 64, y: 26, w: 31, h: 44, label: 'read · table' },
  postal: { x: 7, y: 50, w: 50, h: 9, label: 'getByLabel("Postal code")' },
  continue: { x: 7, y: 77, w: 22, h: 10, label: 'getByRole("button")' },
  place: { x: 66, y: 77, w: 29, h: 10, label: 'Place order' },
  none: null,
};
export const TARGET_FOR_STEP = (verb: string, target: string): Target => verb === 'navigate' ? 'nav' : target.includes('Place') ? 'place' : target.includes('Postal') ? 'postal' : verb === 'read' ? 'read' : verb === 'click' ? 'continue' : 'none';

export type ViewState = 'active' | 'paused' | 'gate' | 'takeover' | 'blocked' | 'idle';
export function FakeBrowser({ origin, path, target = 'none', cursor, state = 'active', tsLabel = 'just now', small, tabs = 2, tickKey = 0, sandbox, title = 'Checkout' }: {
  origin: string; path: string; target?: Target; cursor?: { x: number; y: number }; state?: ViewState; tsLabel?: string; small?: boolean; tabs?: number; tickKey?: number; sandbox?: boolean; title?: string;
}) {
  const rect = TARGET_RECT[target];
  const cur = cursor ?? (rect ? { x: rect.x + rect.w * .6, y: rect.y + rect.h * .55 } : { x: 50, y: 50 });
  const host = origin.replace(/^https?:\/\//, '');
  return (
    <div className={cx('fb', small && 'sm')} aria-label={`Redacted browser viewport at ${origin}`}>
      <div className="fb-chrome">
        <span className="fb-dots"><i /><i /><i /></span>
        <span className="fb-nav" aria-hidden>‹ › ↻</span>
        <span className="fb-url"><GlobeLock size={12} className="fb-lock" /><b>https://</b>{host}{path}</span>
        {!small && <Chip hue={200} size="sm">{tabs} tabs</Chip>}
      </div>
      <motion.div key={tickKey} className="fb-progress" initial={{ width: '0%', opacity: 1 }} animate={{ width: '100%', opacity: 0 }} transition={{ duration: 1.1, ease: 'easeOut' }} />
      <div className="fb-body">
        <motion.div key={'p' + tickKey} style={{ position: 'absolute', inset: 0 }} initial={{ opacity: .35 }} animate={{ opacity: 1 }} transition={{ duration: .7 }}>
          <div className="fp fp-nav"><span className="fp-logo" />{[0, 1, 2, 3].map((i) => <span key={i} className="fp-link" />)}<span style={{ flex: 1 }} /><span className="fp-redact" style={{ width: '9%', height: '55%' }} /></div>
          <div className="fp fp-h1" />
          <div className="fp fp-card" style={{ left: '5%', top: '22%', width: '55%', height: '70%' }}>
            <div className="fp fp-lbl" style={{ left: '4%', top: '5%' }} />
            <div className="fp fp-redact" style={{ left: '4%', right: '4%', top: '12%' }}><Lock size={9} />NAME REDACTED</div>
            <div className="fp fp-lbl" style={{ left: '4%', top: '25%' }} />
            <div className="fp fp-redact" style={{ left: '4%', right: '4%', top: '32%' }}><Lock size={9} />EMAIL REDACTED</div>
            <div className="fp fp-lbl" style={{ left: '4%', top: '45%', width: '18%' }} />
            <div className="fp fp-input" style={{ left: '4%', right: '4%', top: '52%' }}>{state === 'takeover' ? '75001|' : '75001'}</div>
            <div className="fp fp-redact" style={{ left: '4%', right: '4%', top: '65%' }}><Lock size={9} />CARD NUMBER REDACTED</div>
            <div className="fp fp-btn" style={{ left: '4%', width: '36%', top: '82%' }}>Continue</div>
          </div>
          <div className="fp fp-card" style={{ left: '64%', top: '22%', width: '31%', height: '70%', padding: '3%' }}>
            <div className="fp-line" style={{ width: '50%', marginBottom: '6%', background: '#232a55' }} />
            {[70, 55, 62].map((w, i) => <div key={i} className="fp-row" style={{ marginBottom: '5%' }}><div className="fp-line" style={{ width: `${w}%` }} /><div className="fp-line" style={{ width: '18%' }} /></div>)}
            <div className="fp-line" style={{ width: '100%', height: '1px', margin: '6% 0' }} />
            <div className="fp-row"><div className="fp-line" style={{ width: '30%', background: '#232a55' }} /><div className="fp-line" style={{ width: '24%', background: '#232a55' }} /></div>
            <div className="fp fp-btn" style={{ left: '7%', right: '7%', top: '76%', height: '14%', background: state === 'gate' ? 'linear-gradient(90deg,#f59e0b,#f97316)' : undefined }}>Place order</div>
          </div>
        </motion.div>
        <div className="fb-scan" />
        {rect && state !== 'blocked' && (
          <motion.div key={target + tickKey} className={cx('fb-hl', state === 'gate' && 'warn')} initial={{ opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1, left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }} transition={{ type: 'spring', stiffness: 220, damping: 22 }}>
            {!small && <em>{rect.label}</em>}
          </motion.div>
        )}
        <motion.div className="fb-cursor" animate={{ left: `${cur.x}%`, top: `${cur.y}%` }} transition={{ type: 'spring', stiffness: 90, damping: 18 }}>
          <MousePointer2 size={small ? 16 : 22} fill="#fff" color="#111a44" strokeWidth={1.6} />
        </motion.div>
        <motion.span key={'r' + target + tickKey} className="fb-ripple" style={{ left: `${cur.x}%`, top: `${cur.y}%` }} initial={{ scale: .4, opacity: .9 }} animate={{ scale: 3.2, opacity: 0 }} transition={{ duration: 1.2, delay: .5 }} />
        {state === 'takeover' && <div className="fb-takeover-ring" />}
        {sandbox && <span className="rv-sandbox-tag"><ShieldCheck size={11} />SANDBOX PREVIEW</span>}
        <span className="fb-ts"><i />{title} · {tsLabel}</span>
        <AnimatePresence>
          {state === 'paused' && <motion.div className="fb-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="fb-ov-card"><Pause size={22} /><b>Session paused</b><span style={{ fontSize: 11 }}>Agent input is frozen. Resume to continue.</span></div></motion.div>}
          {state === 'idle' && <motion.div className="fb-overlay info" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="fb-ov-card"><Rocket size={24} style={{ color: 'var(--info)' }} /><b>Sandbox stopped</b><span style={{ fontSize: 11 }}>Launch a safe preview to render this version.</span></div></motion.div>}
          {state === 'blocked' && <motion.div className="fb-overlay warn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="fb-ov-card"><GlobeLock size={24} style={{ color: 'var(--warn)' }} /><b>New origin blocked</b><span style={{ fontSize: 11 }}>Navigation paused until an origin grant is approved.</span></div></motion.div>}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================================================================== */
/* small helpers                                                        */
/* ================================================================== */
function useMissions() {
  const m = useData((s) => s.missions);
  return useMemo(() => m.filter((x) => x.status !== 'archived'), [m]);
}
const missionTitle = (m?: Mission) => (m ? `${m.id} · ${m.title}` : '—');
const nonce = (s: string) => Math.floor(seeded(s)() * 0xffff).toString(16).padStart(4, '0') + Math.floor(seeded(s + 'n')() * 0xffff).toString(16).padStart(4, '0');
const VALID_ORIGIN = /^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?$/i;

function Notice({ tone = 'warn', icon: Icon = AlertTriangle, children }: { tone?: 'warn' | 'bad' | 'info' | 'good'; icon?: LucideIcon; children: React.ReactNode }) {
  const c = { warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--info)', good: 'var(--good)' }[tone];
  return <div className={cx('brk-warnbox', tone)}><Icon size={16} style={{ color: c }} /><div>{children}</div></div>;
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="kv" style={{ margin: 0 }}>{rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

/** Resolve artifact + version for artifact dialogs. */
function useArt(props: { missionId?: string; artifactId?: string; version?: string }) {
  const ref = useMemo(() => findArtifact(props.missionId, props.artifactId), [props.missionId, props.artifactId]);
  const [v, setV] = useState(() => (ref ? pickVersion(ref.artifact, props.version).v : ''));
  const version = ref ? pickVersion(ref.artifact, v) : undefined;
  return { ref, v, setV, version };
}

export function downloadVersion(a: Artifact, ver: ArtifactVersion) {
  const manifest = buildManifest([{ artifact: a, version: ver }]);
  downloadText(`${a.id}-${ver.v}.manifest.json`, JSON.stringify(manifest, null, 2));
  toast({ tone: 'success', title: `Downloaded ${a.name} ${ver.v}`, body: 'DEMO: manifest JSON with checksum generated in your browser.' });
}

function VersionSelect({ a, value, onChange, label = 'Version' }: { a: Artifact; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label} help="results.versions">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {a.versions.map((x) => <option key={x.v} value={x.v}>{x.v} · {x.verified ? 'verified' : 'pending'} · {x.size}</option>)}
      </select>
    </Field>
  );
}

function ArtifactBanner({ a, m, ver }: { a: Artifact; m: Mission; ver?: ArtifactVersion }) {
  return (
    <div className="subpanel row" style={{ gap: 12 }}>
      <span className="rv-thumb" style={{ width: 54, height: 54, ['--h' as string]: TYPE_HUE[a.type] }}><TypeIcon type={a.type} size={24} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <b className="ellipsis" style={{ display: 'block' }}>{a.name}</b>
        <div className="dim" style={{ fontSize: 12 }}>{a.id} · {missionTitle(m)}</div>
      </div>
      {ver && <div style={{ textAlign: 'right' }}><Chip hue={TYPE_HUE[a.type]} size="sm">{ver.v}</Chip><div style={{ marginTop: 4 }}><VerifyBadge verified={ver.verified} /></div></div>}
    </div>
  );
}

const NoArtifact = ({ close, id }: { close: () => void; id: string }) => (
  <Modal title="Artifact not found" icon={PackageOpen} onClose={close} dialogId={id} footer={<button className="btn" data-autofocus onClick={close}>Close</button>}>
    <p className="muted">No artifact matches the supplied mission or artifact id.</p>
  </Modal>
);

/* ================================================================== */
/* DL-19 Browser Session Creator                                        */
/* ================================================================== */
function SessionCreate({ close, props }: DialogComponentProps<{ missionId?: string }>) {
  const missions = useMissions();
  const grants = useBrowser((s) => s.grants);
  const addSession = useBrowser((s) => s.addSession);
  const [mid, setMid] = useState(props.missionId ?? missions.find((m) => m.kind === 'automation')?.id ?? missions[0]?.id ?? '');
  const avail = grants.filter((g) => g.status === 'active' || g.status === 'expiring');
  const [origins, setOrigins] = useState<string[]>([]);
  const [profile, setProfile] = useState('ephemeral');
  const [viewport, setViewport] = useState('1440x900');
  const [ttl, setTtl] = useState(60);
  const [retain, setRetain] = useState('7d');
  const [err, setErr] = useState('');
  const submit = () => {
    if (!mid) { setErr('Choose a mission.'); return; }
    if (!origins.length) { setErr('Select at least one granted origin. New origins need a grant first.'); return; }
    const m = missions.find((x) => x.id === mid)!;
    const o = origins[0];
    addSession({ id: nextSessionId(), missionId: mid, agentId: m.agentIds.find((a) => a.startsWith('browser')) ?? m.agentIds[0], origin: o, path: '/', state: 'active', tabs: 1, durationMin: 0, ttlMin: ttl, memMb: 120, memCap: 1024, profile, viewport, steps: 0, screenshotAgoSec: 1 });
    toast({ tone: 'success', title: 'Browser session created (demo)', body: `${origins.length} origin(s) · ${ttl} min TTL · profile ${profile}.` });
    close();
  };
  return (
    <Modal title="New browser session" icon={Globe} help="browser.sessions" dialogId="DL-19" size="lg" sub="A managed Playwright Chromium context on the VPS, scoped to one mission." onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={submit}>Create session</button></>}>
      <div className="brk-dlg-grid">
        <Field label="Mission" required help="browser.mission"><select className="select" data-autofocus value={mid} onChange={(e) => setMid(e.target.value)} aria-label="Mission">{missions.map((m) => <option key={m.id} value={m.id}>{missionTitle(m)}</option>)}</select></Field>
        <Field label="Browser profile" help="browser.profile"><select className="select" value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Browser profile"><option value="ephemeral">Ephemeral (wiped on close)</option><option value="staging-readonly">Staging read-only</option><option value="training-fixture">Training fixture</option></select></Field>
        <div className="full"><Field label="Approved origins" required help="browser.originGrant" hint="Only origins with an active grant can be attached. A newly discovered origin pauses for authorization.">
          <div className="col" style={{ gap: 6 }}>{avail.map((g) => (
            <label key={g.id} className="brk-check"><input type="checkbox" checked={origins.includes(g.origin)} onChange={(e) => setOrigins((o) => e.target.checked ? [...o, g.origin] : o.filter((x) => x !== g.origin))} /><span className="grow mono" style={{ fontSize: 12 }}>{g.origin}</span><RiskMeter risk={g.risk} /></label>
          ))}</div></Field></div>
        <Field label="Viewport"><Segmented ariaLabel="Viewport" size="sm" value={viewport} onChange={setViewport} options={[{ key: '1280x800', label: '1280×800' }, { key: '1440x900', label: '1440×900' }, { key: '390x844', label: 'Mobile' }]} /></Field>
        <Field label="Screenshot retention" help="browser.retention"><Segmented ariaLabel="Retention" size="sm" value={retain} onChange={setRetain} options={[{ key: '24h', label: '24 h' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }]} /></Field>
        <div className="full"><Field label={`Session time limit: ${ttl} min`} help="browser.limits"><input type="range" min={15} max={240} step={15} value={ttl} onChange={(e) => setTtl(+e.target.value)} aria-label="Time limit" style={{ width: '100%', accentColor: 'var(--accent)' }} /></Field></div>
      </div>
      {err && <div className="field-error" role="alert">{err}</div>}
      <Notice tone="info" icon={ShieldCheck}>Credentials, cookies, OTP and payment fields are always redacted in screenshots. CAPTCHA is never bypassed.</Notice>
    </Modal>
  );
}

/* ================================================================== */
/* DL-20 Site Permission Request                                        */
/* ================================================================== */
function SitePermission({ close, props }: DialogComponentProps<{ origin?: string; missionId?: string; grantId?: string }>) {
  const missions = useMissions();
  const addGrant = useBrowser((s) => s.addGrant);
  const approveGrant = useBrowser((s) => s.approveGrant);
  const g0 = GRANTS.find((g) => g.id === props.grantId);
  const [origin, setOrigin] = useState(props.origin ?? g0?.origin ?? 'https://status.example.com');
  const [mid, setMid] = useState(props.missionId ?? g0?.missionId ?? 'M-132');
  const [action, setAction] = useState('read');
  const [reason, setReason] = useState('');
  const [dur, setDur] = useState('2h');
  const [touched, setTouched] = useState(false);
  const originErr = !VALID_ORIGIN.test(origin) ? 'Use an exact https origin, e.g. https://status.example.com (no path, no wildcard).' : '';
  const reasonErr = reason.trim().length < 8 ? 'Give a short reason (at least 8 characters).' : '';
  const risk: Risk = action === 'submit' ? 'critical' : action === 'type' ? 'high' : action === 'click' ? 'medium' : 'low';
  const minutes = { '30m': 30, '2h': 120, '8h': 480 }[dur] ?? 120;
  const approve = () => {
    setTouched(true);
    if (originErr || reasonErr) return;
    if (props.grantId) approveGrant(props.grantId);
    else addGrant({ origin, missionId: mid, actions: action === 'read' ? ['navigate', 'read'] : ['navigate', 'read', action], cred: 'none', expiresMin: minutes, risk, status: 'active', by: 'Luca' });
    toast({ tone: 'success', title: 'Origin approved (demo)', body: `${origin} for ${dur}, ${mid} only. Revalidated before every action.` });
    close();
  };
  return (
    <Modal title="Site permission request" icon={GlobeLock} help="browser.originGrant" dialogId="DL-20" size="md" tone="warn" sub="The agent tried to navigate to an origin outside its grant." onClose={close}
      footer={<><button className="btn danger" onClick={() => { toast({ tone: 'info', title: 'Origin denied (demo)', body: 'The session stays blocked and the agent is told to re-plan.' }); close(); }}>Deny</button><button className="btn primary" onClick={approve}>Approve origin</button></>}>
      <Field label="Exact origin" required error={touched ? originErr : ''} help="browser.origin"><input className="input mono" data-autofocus value={origin} onChange={(e) => setOrigin(e.target.value.trim())} aria-label="Origin" /></Field>
      <div className="brk-dlg-grid">
        <Field label="Intended action" help="browser.actions"><select className="select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Intended action"><option value="read">Read only</option><option value="click">Read + click</option><option value="type">Read + type</option><option value="submit">Submit forms (consequential)</option></select></Field>
        <Field label="Scope"><select className="select" value={mid} onChange={(e) => setMid(e.target.value)} aria-label="Mission scope">{missions.map((m) => <option key={m.id} value={m.id}>{missionTitle(m)}</option>)}</select></Field>
      </div>
      <Field label="Duration" help="browser.grantDuration"><Segmented ariaLabel="Duration" size="sm" value={dur} onChange={setDur} options={[{ key: '30m', label: '30 min' }, { key: '2h', label: '2 hours' }, { key: '8h', label: '8 hours' }]} /></Field>
      <Field label="Reason" required error={touched ? reasonErr : ''}><textarea className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does the mission need this site?" aria-label="Reason" /></Field>
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted" style={{ fontSize: 12.5 }}>Computed risk tier</span><RiskMeter risk={risk} /></div>
    </Modal>
  );
}

/* ================================================================== */
/* DL-21 Browser Action Approval                                        */
/* ================================================================== */
function ActionApproval({ close, props }: DialogComponentProps<{ sessionId?: string; stepId?: string }>) {
  const resolve = useBrowser((s) => s.resolveStep);
  const step = STEPS.find((s) => s.id === props.stepId) ?? STEPS.find((s) => s.consequential) ?? STEPS[3];
  const [ack, setAck] = useState(false);
  const nn = nonce(step.id);
  return (
    <Modal title="Approve browser action" icon={ShieldCheck} help="browser.actionApproval" dialogId="DL-21" size="lg" tone="warn" sub="One-time approval bound to this exact step and nonce." onClose={close}
      footer={<><button className="btn danger" data-autofocus onClick={() => { resolve(step.id, 'denied'); toast({ tone: 'info', title: 'Action denied (demo)', body: 'Agent receives the denial and must propose an alternative.' }); close(); }}>Deny</button><button className="btn good" disabled={!ack} onClick={() => { resolve(step.id, 'approved'); toast({ tone: 'success', title: 'Approved once (demo)', body: `Nonce ${nn} consumed after execution.` }); close(); }}>Approve once</button></>}>
      <div className="brk-dlg-grid">
        <div><div className="section-label" style={{ marginBottom: 6 }}>Before</div><FakeBrowser small origin="https://portal.example.com" path="/checkout/payment" target="place" state="gate" tsLabel="before" /></div>
        <div><div className="section-label" style={{ marginBottom: 6 }}>Expected after</div><FakeBrowser small origin="https://portal.example.com" path="/checkout/confirmation" target="none" title="Order placed" tsLabel="predicted" cursor={{ x: 80, y: 83 }} /></div>
      </div>
      <KV rows={[['Target URL', <span className="mono">https://portal.example.com/checkout/payment</span>], ['Action', <b>{step.verb} · {step.target}</b>], ['Locator', <span className="mono">{step.locator}</span>], ['Policy', step.policy], ['Consequence', <span className="warn">Sends an order to the (staging) payment provider. External effect.</span>], ['Nonce', <span className="mono">{nn}</span>]]} />
      <label className="brk-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I reviewed the target element and understand this action cannot be undone from the dashboard.</label>
    </Modal>
  );
}

/* ================================================================== */
/* DL-22 Human Takeover                                                 */
/* ================================================================== */
function Takeover({ close, props }: DialogComponentProps<{ sessionId?: string }>) {
  const start = useBrowser((s) => s.startTakeover);
  const sid = props.sessionId ?? 'BS-2038';
  const [min, setMin] = useState('15');
  const [kbd, setKbd] = useState(true); const [mouse, setMouse] = useState(true); const [upload, setUpload] = useState(false);
  const [ack, setAck] = useState(false);
  return (
    <Modal title="Take control of browser" icon={Hand} help="browser.humanTakeover" dialogId="DL-22" size="md" sub={`Session ${sid} · time-boxed and audited`} onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!ack} data-autofocus={ack || undefined} onClick={() => { start(sid, +min); toast({ tone: 'success', title: 'Takeover granted (demo)', body: `You control ${sid} for ${min} minutes. All input is recorded.` }); close(); }}>Take control</button></>}>
      <Field label="Time box" help="browser.takeoverScope"><Segmented ariaLabel="Time box" size="sm" value={min} onChange={setMin} options={[{ key: '5', label: '5 min' }, { key: '15', label: '15 min' }, { key: '30', label: '30 min' }]} /></Field>
      <div className="subpanel">
        <div className="section-label">Permitted input</div>
        <SwitchRow label="Mouse clicks and scrolling" checked={mouse} onChange={setMouse} />
        <SwitchRow label="Keyboard typing (non-secret fields)" desc="Password and card fields stay blocked and redacted." checked={kbd} onChange={setKbd} />
        <SwitchRow label="File upload" desc="Disabled by policy for this site." checked={upload} onChange={setUpload} />
      </div>
      <Notice tone="info" icon={Eye}>The session is recorded for audit. Origin grants and the redaction mask stay enforced. Control returns to the agent when the timer ends.</Notice>
      <label className="brk-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand my input is recorded and limited to the granted origin.</label>
    </Modal>
  );
}

/* ================================================================== */
/* DL-23 Close session                                                  */
/* ================================================================== */
function SessionClose({ close, props }: DialogComponentProps<{ sessionId?: string }>) {
  const sessions = useBrowser((s) => s.sessions);
  const setSession = useBrowser((s) => s.setSession);
  const s = sessions.find((x) => x.id === props.sessionId) ?? sessions[0];
  const [clear, setClear] = useState(false);
  const [typed, setTyped] = useState('');
  const ok = !clear || typed === s.id;
  return (
    <Modal title={`Close session ${s.id}`} icon={Power} tone="danger" help="browser.close" dialogId="DL-23" size="sm" onClose={close}
      footer={<><button className="btn" data-autofocus onClick={close}>Cancel</button><button className="btn danger" disabled={!ok} onClick={() => { setSession(s.id, { state: 'expired', tabs: 0, ttlMin: 0, memMb: 0 }); toast({ tone: 'warning', title: `Session ${s.id} closed (demo)`, body: clear ? 'Profile data cleared.' : 'Profile retained for audit.' }); close(); }}>Close session</button></>}>
      <KV rows={[['Open tabs', <b>{s.tabs}</b>], ['Origin', <span className="mono">{s.origin}</span>], ['Running for', `${s.durationMin} min`], ['Downloads', 'Quarantined files stay scanned']]} />
      <Notice tone="warn">Closing stops the agent mid-step. In-flight actions are aborted and recorded in the replay.</Notice>
      <SwitchRow label="Also clear the saved profile" desc="Deletes cookies and local storage for this context." checked={clear} onChange={setClear} />
      {clear && <Field label={`Type ${s.id} to confirm`}><input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirm session id" /></Field>}
    </Modal>
  );
}

/* ================================================================== */
/* DL-24 Recipe Editor                                                  */
/* ================================================================== */
function RecipeEditor({ close, props }: DialogComponentProps<{ recipeId?: string }>) {
  const r0 = RECIPES.find((r) => r.id === props.recipeId) ?? RECIPES[0];
  const [name, setName] = useState(r0.name);
  const [steps, setSteps] = useState<string[]>(['navigate to {origin}/checkout', "click getByRole('button', {name:'Accept'})", "type getByLabel('Postal code') = {input.postal}", "click getByRole('button', {name:'Continue'})", 'screenshot (redacted)']);
  const [draft, setDraft] = useState('');
  const [tests, setTests] = useState<number | null>(null);
  const move = (i: number, d: number) => setSteps((s) => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n; });
  useEffect(() => { if (tests === null || tests >= steps.length) return; const t = window.setTimeout(() => setTests((x) => (x ?? 0) + 1), 380); return () => window.clearTimeout(t); }, [tests, steps.length]);
  const bump = r0.version.replace(/(\d+)$/, (m) => String(+m + 1));
  return (
    <Modal title="Recipe editor" icon={Workflow} help="browser.recipes" dialogId="DL-24" size="lg" sub={`${r0.id} · editing a candidate of ${r0.version}`} onClose={close}
      footer={<><button className="btn ghost" onClick={close}>Discard</button><button className="btn primary" disabled={!name.trim() || !steps.length} onClick={() => { toast({ tone: 'success', title: `Candidate ${bump} saved (demo)`, body: 'Publishing requires fixture tests and a review.' }); close(); }}>Save candidate</button></>}>
      <div className="brk-dlg-grid">
        <Field label="Name" required><input className="input" data-autofocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Recipe name" /></Field>
        <Field label="Origin grant" help="browser.originGrant"><input className="input mono" readOnly value={r0.origin} aria-label="Origin grant" /></Field>
      </div>
      <div>
        <div className="row" style={{ marginBottom: 6 }}><span className="section-label">Steps ({steps.length})</span><span className="spacer" /><Chip hue={165} size="sm">locators: role + label first</Chip></div>
        <div className="col" style={{ gap: 6, maxHeight: 220, overflow: 'auto' }}>
          <AnimatePresence initial={false}>
            {steps.map((s, i) => (
              <motion.div key={s} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="subpanel row" style={{ padding: '6px 8px', gap: 8 }}>
                <span className="mono dim" style={{ width: 20 }}>{i + 1}</span>
                <span className="mono grow ellipsis" style={{ fontSize: 12 }}>{s}</span>
                {tests !== null && <span style={{ opacity: tests > i ? 1 : 0 }}><CheckCircle2 size={15} className="good" /></span>}
                <button className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                <button className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                <button className="icon-btn" aria-label="Delete step" onClick={() => setSteps((x) => x.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input mono" placeholder="Add step, e.g. click getByRole('link', {name:'Pricing'})" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { setSteps((s) => [...s, draft.trim()]); setDraft(''); } }} aria-label="New step" />
          <button className="btn" disabled={!draft.trim()} onClick={() => { setSteps((s) => [...s, draft.trim()]); setDraft(''); }}><Plus size={14} />Add</button>
          <button className="btn" onClick={() => setTests(0)}><FlaskConical size={14} />Test on fixture</button>
        </div>
        {tests !== null && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{tests >= steps.length ? <span className="good">Fixture passed: {steps.length}/{steps.length} steps resolved to a unique target.</span> : `Running fixture… ${tests}/${steps.length}`}</div>}
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* DL-25 Replay                                                         */
/* ================================================================== */
function ReplayDialog({ close, props }: DialogComponentProps<{ sessionId?: string }>) {
  const nav = useNavigate();
  const [speed, setSpeed] = useState('1');
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => { if (!playing) return; const t = window.setInterval(() => setI((x) => (x + 1) % REPLAY.length), 1400 / +speed); return () => window.clearInterval(t); }, [playing, speed]);
  const f = REPLAY[i];
  return (
    <Modal title="Browser replay" icon={Play} help="browser.replay" dialogId="DL-25" size="lg" sub={`Session ${props.sessionId ?? 'BS-2038'} · sanitized trace`} onClose={close}
      footer={<><button className="btn" onClick={close}>Close</button><button className="btn primary" data-autofocus onClick={() => { close(); nav('/browser?tab=replay'); }}>Play in Replay Viewer</button></>}>
      <div className="brk-split">
        <FakeBrowser small origin="https://portal.example.com" path="/checkout" target={f.tgt} state={f.kind === 'gate' ? 'gate' : 'active'} tsLabel={`t+${f.t}s`} tickKey={i} />
        <div className="col" style={{ gap: 8 }}>
          <div className="row"><button className="btn sm" onClick={() => setPlaying((p) => !p)}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause' : 'Play'}</button><Segmented ariaLabel="Replay speed" size="sm" value={speed} onChange={setSpeed} options={[{ key: '0.5', label: '0.5×' }, { key: '1', label: '1×' }, { key: '2', label: '2×' }]} /></div>
          <div className="col" style={{ gap: 5, maxHeight: 230, overflow: 'auto' }}>
            {REPLAY.map((x, k) => <button key={k} className={cx('rv-select-row', k === i && 'on')} onClick={() => { setI(k); setPlaying(false); }}><span className="mono dim">{String(x.t).padStart(2, '0')}s</span><span className="grow ellipsis" style={{ fontSize: 12.5 }}>{x.label}</span>{x.kind === 'gate' && <Chip hue={40} size="sm">gate</Chip>}</button>)}
          </div>
          <div className="dim" style={{ fontSize: 11.5 }}>{REPLAY_LEN}s trace · {REPLAY.filter((x) => x.kind === 'gate').length} policy gate</div>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* DL-26 Artifact Preview                                               */
/* ================================================================== */
type AProps = { missionId?: string; artifactId?: string; version?: string };
function ArtifactPreview({ close, props }: DialogComponentProps<AProps>) {
  const { ref, v, setV, version } = useArt(props);
  const nav = useNavigate();
  if (!ref || !version) return <NoArtifact close={close} id="DL-26" />;
  const { artifact: a, mission: m } = ref;
  const lines = contentLines(a, version.v);
  return (
    <Modal title="Artifact preview" icon={Eye} help="results.preview" dialogId="DL-26" size="lg" sub="Rendered in a safe, static viewer. Nothing is executed." onClose={close}
      footer={<><button className="btn" onClick={close}>Close</button>{a.runnable && <button className="btn" onClick={() => { close(); nav(`/results?tab=previews`); }}><Rocket size={14} />Open in Previews</button>}<button className="btn primary" data-autofocus onClick={() => downloadVersion(a, version)}><Download size={14} />Download</button></>}>
      <ArtifactBanner a={a} m={m} ver={version} />
      <div className="brk-split">
        <div>
          {a.type === 'website' ? <FakeBrowser small sandbox origin="https://preview.sandbox.axion.local" path={`/${a.id.toLowerCase()}`} title="Preview" tsLabel={version.v} state="active" target="none" />
            : a.type === 'image' || a.type === 'screenshot' ? <div className="rv-thumb" style={{ height: 230, ['--h' as string]: TYPE_HUE[a.type] }}><TypeIcon type={a.type} size={54} /><div className="lines">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ width: `${40 + ((i * 37) % 55)}%` }} />)}</div></div>
              : a.type === 'dataset' ? <div className="table-wrap" style={{ maxHeight: 230 }}><table className="table"><thead><tr><th>id</th><th>sku</th><th>price</th><th>stock</th></tr></thead><tbody>{Array.from({ length: 7 }, (_, i) => <tr key={i}><td className="mono">{1000 + i}</td><td className="mono">SKU-{(i * 4721) % 9000}</td><td className="tnum">{(9 + i * 3.4).toFixed(2)}</td><td className="tnum">{(i * 17) % 90}</td></tr>)}</tbody></table></div>
                : <DiffView animate={false} rows={lines.map((t, i) => ({ kind: 'same', text: t, a: i + 1, b: i + 1 }))} />}
        </div>
        <div className="col" style={{ gap: 10 }}>
          <VersionSelect a={a} value={v} onChange={setV} />
          <KV rows={[['Type', `${a.type} · .${EXT[a.type]}`], ['Size', version.size], ['Origin', <span className="mono">sandbox://axion/{a.id}</span>], ['Revision', `${m.version} · rev ${m.revision}`], ['Approval', version.verified ? <span className="good">Verified, releasable</span> : <span className="warn">Awaiting review</span>]]} />
          <div className="rv-hash dim" title="Checksum">{version.hash}</div>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* DL-27 Version Picker                                                 */
/* ================================================================== */
function VersionPicker({ close, props }: DialogComponentProps<AProps>) {
  const { ref, v, setV } = useArt(props);
  const pin = useResults((s) => s.pin);
  if (!ref) return <NoArtifact close={close} id="DL-27" />;
  const { artifact: a, mission: m } = ref;
  return (
    <Modal title="Select a version" icon={History} help="results.versions" dialogId="DL-27" size="md" sub="Versions are immutable: a newer version never overwrites old bytes or hashes." onClose={close}
      footer={<><button className="btn" onClick={close}>Close</button><button className="btn primary" onClick={() => { pin(a.id, v); toast({ tone: 'success', title: `${a.name} ${v} selected`, body: 'Used as the default for downloads and comparisons (demo).' }); close(); }}>Select version</button></>}>
      <ArtifactBanner a={a} m={m} />
      <div className="col" style={{ gap: 6 }} role="radiogroup" aria-label="Versions">
        {a.versions.map((x, i) => (
          <motion.button key={x.v} role="radio" aria-checked={v === x.v} className={cx('rv-select-row', v === x.v && 'on')} onClick={() => setV(x.v)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .04 }} data-autofocus={v === x.v || undefined}>
            <b style={{ width: 40 }}>{x.v}</b>
            <span className="grow" style={{ minWidth: 0 }}><span className="ellipsis" style={{ display: 'block', fontSize: 12.5 }}>{x.notes}</span><span className="dim" style={{ fontSize: 11 }}>{ago(x.agoMin)} · {AGENT_BY_ID[x.by]?.name} · {x.size}</span></span>
            <VerifyBadge verified={x.verified} compact />{i === 0 && <Chip hue={165} size="sm">latest</Chip>}
          </motion.button>
        ))}
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* DL-28 Download Bundle                                                */
/* ================================================================== */
function DownloadBundle({ close, props }: DialogComponentProps<AProps>) {
  const ref = useMemo(() => findArtifact(props.missionId, props.artifactId), [props.missionId, props.artifactId]);
  const arts = useMemo(() => (ref ? getMissionControl(ref.mission).artifacts : []), [ref]);
  const first = ref ? `${ref.artifact.id}@${pickVersion(ref.artifact, props.version).v}` : '';
  const [sel, setSel] = useState<string[]>(first ? [first] : []);
  const [hash, setHash] = useState('');
  const chosen = arts.flatMap((a) => a.versions.filter((x) => sel.includes(`${a.id}@${x.v}`)).map((x) => ({ artifact: a, version: x })));
  const manifest = useMemo(() => JSON.stringify(buildManifest(chosen), null, 2), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { sha256Hex(manifest).then(setHash).catch(() => setHash('unavailable')); }, [manifest]);
  if (!ref) return <NoArtifact close={close} id="DL-28" />;
  const toggle = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <Modal title="Download bundle" icon={Download} help="results.downloads" dialogId="DL-28" size="lg" sub={`${missionTitle(ref.mission)} · pick any retained version`} onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!chosen.length} data-autofocus onClick={() => { downloadText(`axion-bundle-${ref.mission.id}-${chosen.length}.manifest.json`, manifest); toast({ tone: 'success', title: 'Bundle manifest downloaded', body: `${chosen.length} file(s). DEMO: the manifest is real, bytes are not included.` }); close(); }}><Download size={14} />Generate &amp; download</button></>}>
      <div className="brk-split">
        <div className="col" style={{ gap: 6, maxHeight: 300, overflow: 'auto' }}>
          {arts.map((a) => <div key={a.id}><div className="section-label" style={{ margin: '4px 0' }}>{a.name}</div>{a.versions.map((x) => { const k = `${a.id}@${x.v}`; const on = sel.includes(k); return (
            <label key={k} className={cx('rv-select-row', on && 'on')} style={{ marginBottom: 4 }}><input type="checkbox" checked={on} onChange={() => toggle(k)} style={{ accentColor: 'var(--accent)' }} aria-label={`${a.name} ${x.v}`} /><b style={{ width: 36 }}>{x.v}</b><span className="rv-hash dim grow ellipsis">{x.hash}</span><span className="dim" style={{ fontSize: 11 }}>{x.size}</span></label>); })}</div>)}
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div className="section-label">Manifest preview</div>
          <pre className="mono subpanel" style={{ margin: 0, fontSize: 10.5, maxHeight: 190, overflow: 'auto' }}>{manifest}</pre>
          <div className="dim" style={{ fontSize: 11.5 }}>Manifest SHA-256 (computed live)</div>
          <div className="rv-hash">{hash || '…'}</div>
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* DL-29 Run / safe preview                                             */
/* ================================================================== */
function ArtifactRun({ close, props }: DialogComponentProps<AProps>) {
  const { ref, v, setV, version } = useArt(props);
  const nav = useNavigate();
  const [mode, setMode] = useState<'preview' | 'exec'>('preview');
  const [ttl, setTtl] = useState('30');
  const [launching, setLaunching] = useState(false);
  if (!ref || !version) return <NoArtifact close={close} id="DL-29" />;
  const { artifact: a, mission: m } = ref;
  const go = () => {
    if (mode === 'exec') { toast({ tone: 'info', title: 'Execution request submitted (demo)', body: 'Needs approval; source execution stays disabled until isolation is approved.' }); close(); return; }
    setLaunching(true);
    window.setTimeout(() => { toast({ tone: 'success', title: 'Safe preview launched (demo)', body: `Sandbox for ${a.name} ${version.v} expires in ${ttl} min.` }); close(); nav('/results?tab=previews'); }, 900);
  };
  return (
    <Modal title="Run result" icon={Rocket} help="results.run" dialogId="DL-29" size="md" sub="Creates an isolated preview request: never a host shell command or deployment." onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" data-autofocus disabled={launching} onClick={go}>{launching ? 'Launching…' : mode === 'preview' ? 'Launch safe preview' : 'Request execution'}</button></>}>
      <ArtifactBanner a={a} m={m} ver={version} />
      <Segmented ariaLabel="Run mode" value={mode} onChange={setMode} options={[{ key: 'preview', label: <><Eye size={13} />Safe preview</> }, { key: 'exec', label: <><KeyRound size={13} />Request execution</> }]} />
      <div className="brk-dlg-grid">
        <VersionSelect a={a} value={v} onChange={setV} />
        <Field label="Expires after"><Segmented ariaLabel="Expiry" size="sm" value={ttl} onChange={setTtl} options={[{ key: '15', label: '15 min' }, { key: '30', label: '30 min' }, { key: '120', label: '2 h' }]} /></Field>
      </div>
      <KV rows={[['Sandbox target', <span className="mono">sandbox://preview.axion.local/{a.id}</span>], ['Expected side effects', mode === 'preview' ? 'None: network egress blocked, read-only filesystem' : <span className="warn">May write temp files in an isolated workspace</span>], ['Bound permissions', 'view · no credentials · no outbound origins'], ['Checks', version.verified ? <span className="good">Verified build</span> : <span className="warn">Unverified build: preview only</span>]]} />
      {mode === 'exec' && !version.verified && <Notice tone="bad">Execution of an unverified version is blocked. Choose a verified version or use Safe preview.</Notice>}
    </Modal>
  );
}

/* ================================================================== */
/* DL-30 Compare                                                        */
/* ================================================================== */
function CompareVersions({ close, props }: DialogComponentProps<AProps & { base?: string }>) {
  const ref = useMemo(() => findArtifact(props.missionId, props.artifactId), [props.missionId, props.artifactId]);
  const nav = useNavigate();
  const vs = ref?.artifact.versions ?? [];
  const [head, setHead] = useState(props.version ?? vs[0]?.v);
  const [base, setBase] = useState(props.base ?? vs[1]?.v ?? vs[0]?.v);
  const rows = useMemo(() => (ref ? diffLines(contentLines(ref.artifact, base), contentLines(ref.artifact, head)) : []), [ref, base, head]);
  if (!ref) return <NoArtifact close={close} id="DL-30" />;
  const adds = rows.filter((r) => r.kind === 'add').length, dels = rows.filter((r) => r.kind === 'del').length;
  return (
    <Modal title="Compare versions" icon={GitCompare} help="results.compare" dialogId="DL-30" size="lg" onClose={close}
      footer={<><button className="btn" onClick={close}>Close</button><button className="btn primary" data-autofocus onClick={() => { close(); nav('/results?tab=comparisons'); }}>Open comparison</button></>}>
      <div className="brk-dlg-grid">
        <Field label="Base"><select className="select" value={base} onChange={(e) => setBase(e.target.value)} aria-label="Base version">{vs.map((x) => <option key={x.v} value={x.v}>{x.v}</option>)}</select></Field>
        <Field label="Head"><select className="select" value={head} onChange={(e) => setHead(e.target.value)} aria-label="Head version">{vs.map((x) => <option key={x.v} value={x.v}>{x.v}</option>)}</select></Field>
      </div>
      <div className="row"><Chip hue={150} size="sm">+{adds}</Chip><Chip hue={350} size="sm">−{dels}</Chip><span className="spacer" /><span className="good" style={{ fontSize: 12 }}><CheckCircle2 size={13} style={{ display: 'inline' }} /> {head !== base ? 'Checks passed on head' : 'Same revision'}</span></div>
      <div style={{ maxHeight: 280, overflow: 'auto' }}><DiffView rows={rows} /></div>
    </Modal>
  );
}

/* ================================================================== */
/* DL-31 Merge proposal                                                 */
/* ================================================================== */
function MergeProposal({ close, props }: DialogComponentProps<AProps>) {
  const { ref, version } = useArt(props);
  const propose = useResults((s) => s.propose);
  const [rollback, setRollback] = useState('Revert merge commit and restore last-known-good v1.0');
  const [ack, setAck] = useState(false);
  if (!ref || !version) return <NoArtifact close={close} id="DL-31" />;
  const { artifact: a, mission: m } = ref;
  const src = `mission/${m.id.toLowerCase()}-${a.id.slice(-2).toLowerCase()}`;
  return (
    <Modal title="Merge proposal" icon={GitMerge} help="results.branch" dialogId="DL-31" size="md" sub="Protected main: merges need passing checks and review." onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!ack || !rollback.trim()} data-autofocus={!ack || undefined} onClick={() => { propose(src, 'main'); toast({ tone: 'success', title: 'Submitted for review (demo)', body: `${src} into main. Checks can never be bypassed.` }); close(); }}>Submit for review</button></>}>
      <ArtifactBanner a={a} m={m} ver={version} />
      <KV rows={[['Source', <span className="mono">{src}</span>], ['Target', <span className="mono">main (protected)</span>], ['Head hash', <span className="rv-hash">{version.hash}</span>], ['Tests', <span className="good">12 passed · 1 pending</span>], ['Conflicts', <span className="good">None detected</span>], ['Impact', `${a.type} artifact, ${version.size}`]]} />
      <Field label="Rollback plan" required><textarea className="textarea" rows={2} value={rollback} onChange={(e) => setRollback(e.target.value)} aria-label="Rollback plan" /></Field>
      <label className="brk-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand this opens a review and does not merge immediately.</label>
    </Modal>
  );
}

/* ================================================================== */
/* DL-32 Deploy approval                                                */
/* ================================================================== */
function DeployApproval({ close, props }: DialogComponentProps<AProps>) {
  const { ref, version } = useArt(props);
  const setStage = useResults((s) => s.setStage);
  const [canary, setCanary] = useState('10');
  const [ack, setAck] = useState(false);
  if (!ref || !version) return <NoArtifact close={close} id="DL-32" />;
  const { artifact: a, mission: m } = ref;
  return (
    <Modal title="Approve deployment" icon={Rocket} tone="warn" help="results.release" dialogId="DL-32" size="md" sub="Owner approval is bound to this exact revision and hash." onClose={close}
      footer={<><button className="btn danger" onClick={() => { toast({ tone: 'info', title: 'Deployment denied (demo)' }); close(); }}>Deny</button><button className="btn good" disabled={!ack} data-autofocus={!ack || undefined} onClick={() => { setStage(a.id, 'deployed'); toast({ tone: 'success', title: `${a.name} ${version.v} deployed (demo)`, body: `Canary ${canary}% for 30 min, auto-rollback armed.` }); close(); }}>Owner approve deployment</button></>}>
      <ArtifactBanner a={a} m={m} ver={version} />
      <KV rows={[['Exact revision', <span className="mono">{m.version} · rev {m.revision}</span>], ['Hash', <span className="rv-hash">{version.hash}</span>], ['Production impact', 'Customer-facing pages for 100% of traffic after canary'], ['Rollback plan', 'Automatic when error rate exceeds 1%; last-known-good retained']]} />
      <Field label="Canary share" help="results.canary"><Segmented ariaLabel="Canary" size="sm" value={canary} onChange={setCanary} options={[{ key: '5', label: '5%' }, { key: '10', label: '10%' }, { key: '25', label: '25%' }]} /></Field>
      {!version.verified && <Notice tone="bad">This version is not verified. Approval will be recorded as an exception.</Notice>}
      <label className="brk-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I reviewed the evidence and authorize this deployment.</label>
    </Modal>
  );
}

/* ================================================================== */
/* DL-33 Rollback                                                       */
/* ================================================================== */
function RollbackConfirm({ close, props }: DialogComponentProps<AProps>) {
  const { ref, version } = useArt(props);
  const setStage = useResults((s) => s.setStage);
  const [typed, setTyped] = useState('');
  if (!ref || !version) return <NoArtifact close={close} id="DL-33" />;
  const { artifact: a } = ref;
  const good = a.versions.find((x) => x.verified && x.v !== version.v) ?? a.versions[a.versions.length - 1];
  return (
    <Modal title={`Roll back ${a.name}`} icon={Undo2} tone="danger" help="results.rollback" dialogId="DL-33" size="md" onClose={close}
      footer={<><button className="btn" data-autofocus onClick={close}>Cancel</button><button className="btn danger" disabled={typed !== 'ROLLBACK'} onClick={() => { setStage(a.id, 'rolled back'); toast({ tone: 'warning', title: `Rolled back to ${good.v} (demo)`, body: 'Health checks queued. The failed version stays retained.' }); close(); }}>Owner authorize rollback</button></>}>
      <KV rows={[['Current', <b>{version.v}</b>], ['Target last-good', <b className="good">{good.v}</b>], ['Hash', <span className="rv-hash">{good.hash}</span>], ['Data risk', 'No schema change between these versions'], ['Health checks', 'HTTP 200 · error rate · visual smoke']]} />
      <Notice tone="warn">Users briefly see the older build. Versions are immutable, so nothing is deleted.</Notice>
      <Field label="Type ROLLBACK to confirm"><input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirm rollback" /></Field>
    </Modal>
  );
}

/* ================================================================== */
/* DL-52 Knowledge ingest                                               */
/* ================================================================== */
function KnowledgeIngest({ close, props }: DialogComponentProps<{ kind?: 'domain' | 'repo' | 'file' }>) {
  const addSource = useKnowledge((s) => s.addSource);
  const [kind, setKind] = useState<'domain' | 'repo' | 'file'>(props.kind ?? 'domain');
  const [src, setSrc] = useState('');
  const [ret, setRet] = useState('90d');
  const [scope, setScope] = useState('team');
  const [trust, setTrust] = useState<'reviewed' | 'untrusted'>('untrusted');
  const [scan, setScan] = useState(0);
  const [touched, setTouched] = useState(false);
  const err = !src.trim() ? 'Enter a source.' : kind === 'domain' && !/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(src.trim()) ? 'Enter a valid domain or URL.' : '';
  useEffect(() => { if (scan <= 0 || scan >= 4) return; const t = window.setTimeout(() => setScan((x) => x + 1), 520); return () => window.clearTimeout(t); }, [scan]);
  const steps = ['Fetch metadata', 'Malware & secret scan', 'Prompt-injection screen', 'Deduplicate'];
  const queue = () => { setTouched(true); if (err) return; if (scan === 0) { setScan(1); return; } if (scan < 4) return;
    addSource({ id: `S-${20 + Math.floor(seeded(src)() * 70)}`, label: src.trim().replace(/^https?:\/\//, ''), kind, trust, relevance: 60, docs: 0, scanMin: 0 });
    toast({ tone: 'success', title: 'Queued for review (demo)', body: 'Untrusted website content stays evidence, never instructions.' }); close(); };
  return (
    <Modal title="Ingest knowledge source" icon={BookPlus} help="knowledge.ingest" dialogId="DL-52" size="md" onClose={close}
      footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={queue}>{scan === 0 ? 'Scan & queue' : scan < 4 ? 'Scanning…' : 'Queue for review'}</button></>}>
      <Segmented ariaLabel="Source kind" value={kind} onChange={setKind} options={[{ key: 'domain', label: 'Domain / URL' }, { key: 'repo', label: 'Repository' }, { key: 'file', label: 'File' }]} />
      <Field label="Source" required error={touched ? err : ''} help="knowledge.sources"><input className="input mono" data-autofocus value={src} onChange={(e) => { setSrc(e.target.value); setScan(0); }} placeholder={kind === 'repo' ? 'github.com/org/repo' : kind === 'file' ? 'handbook.pdf' : 'docs.example.com'} aria-label="Source" /></Field>
      <div className="brk-dlg-grid">
        <Field label="Retention"><select className="select" value={ret} onChange={(e) => setRet(e.target.value)} aria-label="Retention"><option value="30d">30 days</option><option value="90d">90 days</option><option value="365d">1 year</option></select></Field>
        <Field label="Access"><select className="select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Access scope"><option value="team">Mission team</option><option value="dept">Department</option><option value="all">All agents</option></select></Field>
      </div>
      <Field label="Trust label" help="knowledge.trust"><Segmented ariaLabel="Trust" size="sm" value={trust} onChange={setTrust} options={[{ key: 'untrusted', label: 'Untrusted' }, { key: 'reviewed', label: 'Reviewed' }]} /></Field>
      {scan > 0 && <div className="col" style={{ gap: 6 }}>{steps.map((s, i) => <motion.div key={s} className="row" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .05 }} style={{ fontSize: 12.5 }}>{scan > i ? <CheckCircle2 size={15} className="good" /> : <ScanSearch size={15} className="info" />}<span className={scan > i ? '' : 'muted'}>{s}</span></motion.div>)}</div>}
    </Modal>
  );
}

/* ================================================================== */
/* DL-53 Experience promotion                                           */
/* ================================================================== */
function ExperiencePromotion({ close, props }: DialogComponentProps<{ itemId?: string }>) {
  const queue = useKnowledge((s) => s.queue);
  const decide = useKnowledge((s) => s.decide);
  const it = queue.find((q) => q.id === props.itemId) ?? queue[0] ?? LEARNING[0];
  const [apply, setApply] = useState({ team: true, browser: true, all: false });
  const [txt, setTxt] = useState(it.lesson);
  return (
    <Modal title="Promote experience" icon={BrainCircuit} help="knowledge.queue" dialogId="DL-53" size="md" sub={`${it.id} · from ${it.missionId}`} onClose={close}
      footer={<><button className="btn danger" onClick={() => { decide(it.id, 'rejected'); toast({ tone: 'info', title: 'Lesson rejected (demo)' }); close(); }}>Reject</button><button className="btn good" data-autofocus onClick={() => { decide(it.id, 'accepted', txt); toast({ tone: 'success', title: 'Verified learning accepted (demo)', body: 'Added to the knowledge library with provenance.' }); close(); }}>Accept verified learning</button></>}>
      <Field label="Lesson (editable)" required><textarea className="textarea" rows={3} value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Lesson" /></Field>
      <KV rows={[['Evidence', `${it.evidence} verified runs`], ['Confidence', <b>{it.confidence}%</b>], ['Source agent', AGENT_BY_ID[it.agentId]?.name ?? it.agentId]]} />
      {it.conflict && <Notice tone="warn">Possible contradiction: {it.conflict}</Notice>}
      {it.dup && <Notice tone="info">Similar entry exists: {it.dup}. Accepting merges them.</Notice>}
      <div className="subpanel"><div className="section-label">Allowed applicability</div>
        <SwitchRow label="This mission team" checked={apply.team} onChange={(v) => setApply({ ...apply, team: v })} />
        <SwitchRow label="All Browser agents" checked={apply.browser} onChange={(v) => setApply({ ...apply, browser: v })} />
        <SwitchRow label="Company-wide" desc="Requires a second reviewer." checked={apply.all} onChange={(v) => setApply({ ...apply, all: v })} /></div>
    </Modal>
  );
}

export const dialogs = {
  'browser-session-create': SessionCreate,
  'site-permission': SitePermission,
  'browser-action-approval': ActionApproval,
  'browser-takeover': Takeover,
  'browser-session-close': SessionClose,
  'recipe-editor': RecipeEditor,
  'browser-replay': ReplayDialog,
  'artifact-preview': ArtifactPreview,
  'artifact-versions': VersionPicker,
  'download-bundle': DownloadBundle,
  'artifact-run': ArtifactRun,
  'compare-versions': CompareVersions,
  'merge-proposal': MergeProposal,
  'deploy-approval': DeployApproval,
  'rollback-confirm': RollbackConfirm,
  'knowledge-ingest': KnowledgeIngest,
  'experience-promotion': ExperiencePromotion,
};
