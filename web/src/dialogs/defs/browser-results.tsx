import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe, GlobeLock, ShieldCheck, Hand, Workflow, Pause, FileText, Image as ImageIcon, Table2, FileCode2, FileBarChart, Camera, Film,
  History, Download, Rocket, GitMerge, Undo2, Lock, AlertTriangle, CheckCircle2, PackageOpen, Eye, GitCompare, KeyRound, Clock, MousePointer2, type LucideIcon } from 'lucide-react';
import type { DialogComponentProps } from '@/dialogs/DialogHost';
import { Modal } from '@/components/ui/Modal';
import { Field, Segmented, SwitchRow } from '@/components/ui/Form';
import { Chip } from '@/components/ui/Chips';
import { KpiBoard } from '@/components/layout/PageFrame';
import { toast } from '@/store/ui';
import { getMissionControl } from '@/data/missions';
import { AGENT_BY_ID, seeded } from '@/data/agents';
import { STEPS, useBrowser, type Target, type Risk } from '@/data/browser';
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
/** Legacy helper: renders the shared KPI tile design (components/layout/PageFrame). */
export function KpiStrip({ items }: { items: KpiDef[] }) {
  return <KpiBoard items={items.map((k) => ({ ...k, key: k.label }))} />;
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
  none: null };
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
const missionTitle = (m?: Mission) => (m ? `${m.id} · ${m.title}` : '—');
const nonce = (s: string) => Math.floor(seeded(s)() * 0xffff).toString(16).padStart(4, '0') + Math.floor(seeded(s + 'n')() * 0xffff).toString(16).padStart(4, '0');

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
export const dialogs = {
  'browser-action-approval': ActionApproval,
  'browser-takeover': Takeover,
  'artifact-preview': ArtifactPreview,
  'artifact-versions': VersionPicker,
  'download-bundle': DownloadBundle,
  'artifact-run': ArtifactRun,
  'compare-versions': CompareVersions,
  'merge-proposal': MergeProposal,
  'deploy-approval': DeployApproval,
  'rollback-confirm': RollbackConfirm,
};
