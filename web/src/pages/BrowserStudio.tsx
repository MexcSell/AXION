import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  Globe, MonitorPlay, ListChecks, GlobeLock, Workflow, History, Plus, Pause, Play, Camera, Hand, ShieldCheck, Power, Eye, Search, FlaskConical, Pencil,
  Rocket, Download, Lock, CheckCircle2, ShieldAlert, Cpu, Activity, KeyRound, Ban, Timer, RotateCcw, MessageSquareQuote, CircleDot, ScanEye,
} from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { TopBoard, FrameBody, BottomBoard } from '@/components/layout/PageFrame';
import { Modal } from '@/components/ui/Modal';
import { IconButton } from '@/components/ui/IconButton';
import { Chip, DemoTag, Dot } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Segmented } from '@/components/ui/Form';
import { RingGauge, Sparkline } from '@/components/viz/Charts';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AGENT_BY_ID } from '@/data/agents';
import { MISSIONS } from '@/data/missions';
import { REPLAY, REPLAY_LEN, RECIPES, STEPS, useBrowser, type BrowserSession, type BrowserStep, type SessionState, type SiteGrant } from '@/data/browser';
import { FakeBrowser, RiskMeter, type ViewState } from '@/dialogs/defs/browser-results';
import { useTab } from '@/hooks/useTab';
import { openDialog, toast } from '@/store/ui';
import { downloadText } from '@/data/results';
import { ago, cx } from '@/lib/format';
import '@/theme/pages/browser-results-knowledge.css';

const STATE_META: Record<SessionState, { label: string; hue: number }> = {
  active: { label: 'Active', hue: 150 }, paused: { label: 'Paused', hue: 45 }, 'awaiting-grant': { label: 'Awaiting grant', hue: 28 }, takeover: { label: 'Human takeover', hue: 205 }, expired: { label: 'Expired', hue: 260 },
};
const viewState = (s: SessionState): ViewState => (s === 'paused' || s === 'expired' ? 'paused' : s === 'awaiting-grant' ? 'blocked' : s === 'takeover' ? 'takeover' : 'active');
const secLabel = (s: number) => (s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`);
const host = (o: string) => o.replace(/^https?:\/\//, '');

export default function BrowserStudioPage() {
  const [tab, setTab, tabs] = useTab('browser');
  const ICONS = [Globe, MonitorPlay, ListChecks, GlobeLock, Workflow, History];
  const sessions = useBrowser((s) => s.sessions);
  const grants = useBrowser((s) => s.grants);
  const resolved = useBrowser((s) => s.resolved);
  const [sid, setSid] = useState('BS-2038');
  const live = sessions.filter((s) => s.state === 'active' || s.state === 'takeover').length;
  const pendingGates = STEPS.filter((s) => s.consequential && !resolved[s.id]).length + grants.filter((g) => g.status === 'pending').length;
  const kpis = [
    { key: 'live', icon: Globe, value: live, label: 'Live Sessions', color: '#22d3ee', delta: '+1', help: 'browser.kpi.live', onClick: () => setTab('Sessions') },
    { key: 'grants', icon: GlobeLock, value: grants.filter((g) => g.status === 'active' || g.status === 'expiring').length, label: 'Active Origin Grants', color: '#3b82f6', help: 'browser.kpi.grants', onClick: () => setTab('Site Grants') },
    { key: 'gates', icon: ShieldAlert, value: pendingGates, label: 'Pending Gates', color: '#fbbf24', help: 'browser.kpi.gates', onClick: () => setTab('Actions') },
    { key: 'recipes', icon: Workflow, value: RECIPES.filter((r) => r.status === 'published').length, label: 'Published Recipes', color: '#a78bfa', help: 'browser.kpi.recipes', onClick: () => setTab('Recipes') },
    { key: 'redact', icon: ScanEye, value: 99.2, decimals: 1, suffix: '%', label: 'Redaction Coverage', color: '#2ee98a', delta: '+0.3%', help: 'browser.kpi.redaction', onClick: () => setTab('Replay') },
  ];
  const inspect = (id: string) => { setSid(id); setTab('Live View'); };
  return (
    <div className="page">
      <TopBoard icon={Globe} title="Browser Studio" help="browser.sessions" sub="Playwright-managed Chromium on your VPS: scoped, redacted, human-gated."
        actions={<><DemoTag /><button className="btn primary" onClick={() => openDialog('browser-session-create')}><Plus size={16} />New Session</button></>}
        kpis={kpis}
        tabs={{ tabs, value: tab, onChange: setTab, icons: ICONS, ariaLabel: 'Browser Studio views', counts: { Sessions: sessions.length, 'Site Grants': grants.length, Recipes: RECIPES.length } }}
        toolbar={<span>{{ Sessions: 'Allocated managed browser contexts, scoped per mission.', 'Live View': 'Redacted frames from the isolated VPS browser.', Actions: 'Every step passes proposal, policy, execution, observation.', 'Site Grants': 'Origin allowlist with expiry and risk tier.', Recipes: 'Vetted, versioned site workflows.', Replay: 'Deterministic trace with policy decisions.' }[tab]}</span>} />
      <FrameBody tab={tab}>
        {tab === 'Sessions' && <Sessions onInspect={inspect} />}
        {tab === 'Live View' && <LiveView sid={sid} setSid={setSid} />}
        {tab === 'Actions' && <Actions />}
        {tab === 'Site Grants' && <Grants />}
        {tab === 'Recipes' && <Recipes />}
        {tab === 'Replay' && <Replay />}
      </FrameBody>
      <BottomBoard id="browser" title="Browser boards" cols="repeat(3, minmax(0, 1fr))">
        <Boundary />
        <GatesPanel />
        <Resources />
      </BottomBoard>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Sessions({ onInspect }: { onInspect: (id: string) => void }) {
  const sessions = useBrowser((s) => s.sessions);
  const setSession = useBrowser((s) => s.setSession);
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'live' | 'blocked'>('all');
  const list = sessions.filter((s) => (f === 'all' || (f === 'live' ? s.state === 'active' || s.state === 'takeover' : s.state === 'awaiting-grant' || s.state === 'paused')) && (s.id + s.origin + s.missionId).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="input-wrap" style={{ width: 240 }}><Search size={15} /><input className="input" placeholder="Search session, origin, mission" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sessions" /></div>
        <Segmented ariaLabel="Session filter" size="sm" value={f} onChange={setF} options={[{ key: 'all', label: 'All' }, { key: 'live', label: 'Live' }, { key: 'blocked', label: 'Needs attention' }]} />
        <span className="spacer" /><HelpTrigger k="browser.sessions" />
      </div>
      {list.length === 0 ? <EmptyState icon={Globe} title="No sessions match" body="Clear the filter or create a scoped session." action={<button className="btn primary" onClick={() => openDialog('browser-session-create')}>New session</button>} /> : (
        <div className="grid g-3">
          <AnimatePresence mode="popLayout">
            {list.map((s, i) => <SessionCard key={s.id} s={s} i={i} onInspect={onInspect} setSession={setSession} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function SessionCard({ s, i, onInspect, setSession }: { s: BrowserSession; i: number; onInspect: (id: string) => void; setSession: (id: string, p: Partial<BrowserSession>) => void }) {
  const m = STATE_META[s.state];
  const a = AGENT_BY_ID[s.agentId];
  const mission = MISSIONS.find((x) => x.id === s.missionId);
  return (
    <motion.div layout className="subpanel glass-card hoverable brk-session" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }} transition={{ delay: i * .05 }} onClick={() => onInspect(s.id)}>
      <div className="row" style={{ gap: 8 }}>
        {a && <RobotAvatar role={a.role} size={32} />}
        <div style={{ minWidth: 0 }}><b>{s.id}</b><div className="dim ellipsis" style={{ fontSize: 11.5 }}>{a?.name} · {s.missionId}</div></div>
        <span className="spacer" /><Chip hue={m.hue} size="sm" pill>{s.state === 'active' && <Dot tone="good" pulse />}{m.label}</Chip>
      </div>
      <div className="brk-mini" aria-hidden>
        <i style={{ left: '6%', top: '14%', width: '88%', height: 8, background: '#fff' }} /><i style={{ left: '8%', top: '38%', width: '40%', height: 22 }} /><i style={{ left: '54%', top: '38%', width: '38%', height: 22 }} />
        {s.state !== 'expired' && <motion.i style={{ top: '40%', width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} animate={{ left: ['12%', '60%', '30%', '12%'] }} transition={{ duration: 6 + i, repeat: Infinity, ease: 'easeInOut' }} />}
      </div>
      <div className="mono ellipsis" style={{ fontSize: 12 }}><Lock size={11} className="good" style={{ display: 'inline', marginRight: 4 }} />{host(s.origin)}{s.path}</div>
      <div className="row" style={{ gap: 12, fontSize: 11.5 }}>
        <span className="muted">{s.tabs} tabs</span><span className="muted">{s.durationMin}m running</span><span className={s.ttlMin < 20 ? 'warn' : 'muted'}><Timer size={11} style={{ display: 'inline' }} /> {s.ttlMin}m left</span><span className="spacer" /><span className="dim">{s.viewport}</span>
      </div>
      <div><div className="row dim" style={{ fontSize: 10.5, justifyContent: 'space-between', marginBottom: 3 }}><span>Memory</span><span>{s.memMb} / {s.memCap} MB</span></div><div className="brk-memory"><motion.i initial={{ width: 0 }} animate={{ width: `${(s.memMb / s.memCap) * 100}%` }} transition={{ duration: .9, delay: .2 + i * .05 }} /></div></div>
      <div className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <button className="btn sm" onClick={() => onInspect(s.id)}><Eye size={13} />Inspect</button>
        {s.state === 'paused' ? <button className="btn sm" onClick={() => { setSession(s.id, { state: 'active' }); toast({ tone: 'success', title: `${s.id} resumed (demo)` }); }}><Play size={13} />Resume</button>
          : s.state === 'awaiting-grant' ? <button className="btn sm primary" onClick={() => openDialog('site-permission', { origin: s.origin, missionId: s.missionId })}><KeyRound size={13} />Review grant</button>
            : s.state !== 'expired' && <button className="btn sm" onClick={() => { setSession(s.id, { state: 'paused' }); toast({ tone: 'info', title: `${s.id} paused (demo)`, body: 'Agent input frozen; browser state retained.' }); }}><Pause size={13} />Pause</button>}
        <span className="spacer" />
        {s.state !== 'expired' && <IconButton icon={Power} label="End session" size="sm" variant="danger" onClick={() => openDialog('browser-session-close', { sessionId: s.id })} />}
      </div>
      {mission && <div className="dim ellipsis" style={{ fontSize: 11 }}>{mission.title}</div>}
    </motion.div>
  );
}

/* ---------------------------------------------------------------- */
function LiveView({ sid, setSid }: { sid: string; setSid: (s: string) => void }) {
  const sessions = useBrowser((s) => s.sessions);
  const setSession = useBrowser((s) => s.setSession);
  const endTakeover = useBrowser((s) => s.endTakeover);
  const takeover = useBrowser((s) => s.takeover);
  const resolved = useBrowser((s) => s.resolved);
  const s = sessions.find((x) => x.id === sid) ?? sessions[0];
  const [fi, setFi] = useState(0);
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState(0);
  const [log, setLog] = useState<{ id: number; t: string }[]>([{ id: 3, t: 'Session attached' }, { id: 2, t: 'Origin revalidated' }, { id: 1, t: 'Redaction mask applied (2 regions)' }]);
  const running = s.state === 'active' || s.state === 'takeover';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => { setFi((x) => (x + 1) % REPLAY.length); setTick((x) => x + 1); }, 3200);
    return () => window.clearInterval(t);
  }, [running]);
  useEffect(() => { setLog((l) => [{ id: (l[0]?.id ?? 0) + 1, t: REPLAY[fi].label }, ...l].slice(0, 6)); }, [fi]);
  const f = REPLAY[fi];
  const gate = STEPS.find((x) => x.consequential && !resolved[x.id]);
  const vs: ViewState = viewState(s.state) === 'active' && f.kind === 'gate' && gate ? 'gate' : viewState(s.state);
  const left = takeover[s.id] ? Math.max(0, Math.round((takeover[s.id] - Date.now()) / 60000)) : 0;
  return (
    <div className="brk-split" style={{ gridTemplateColumns: 'minmax(0, 1.9fr) minmax(300px, 1fr)' }}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {sessions.filter((x) => x.state !== 'expired').map((x) => <button key={x.id} className={cx('chip pill', x.id === s.id && 'solid')} style={{ ['--h' as string]: STATE_META[x.state].hue, cursor: 'pointer', height: 26 }} onClick={() => setSid(x.id)}>{x.id} · {host(x.origin)}</button>)}
        </div>
        <div style={{ position: 'relative' }}>
          <FakeBrowser origin={s.origin} path={s.path === '/' ? '/checkout' : s.path.startsWith('/inc') ? '/checkout' : s.path} target={f.tgt} cursor={{ x: f.x, y: f.y }} state={vs} tsLabel={flash ? 'captured now' : secLabel(s.screenshotAgoSec + (tick * 3) % 9)} tickKey={tick + flash} tabs={s.tabs} />
          <AnimatePresence>{flash > 0 && <motion.div key={flash} initial={{ opacity: .8 }} animate={{ opacity: 0 }} transition={{ duration: .5 }} style={{ position: 'absolute', inset: 0, background: '#fff', borderRadius: 14, pointerEvents: 'none', zIndex: 20 }} />}</AnimatePresence>
        </div>
        <div className="brk-toolbar" role="toolbar" aria-label="Session controls">
          <button className="btn sm" onClick={() => { if (s.state === 'paused') { setSession(s.id, { state: 'active' }); toast({ tone: 'success', title: 'Resumed (demo)' }); } else { setSession(s.id, { state: 'paused' }); toast({ tone: 'info', title: 'Paused (demo)', body: 'Agent input frozen.' }); } }}>{s.state === 'paused' ? <><Play size={14} />Resume</> : <><Pause size={14} />Pause</>}</button>
          <button className="btn sm" onClick={() => { setFlash((x) => x + 1); toast({ tone: 'success', title: 'Screenshot captured (demo)', body: 'Stored with redaction mask and sha256 evidence.' }); }}><Camera size={14} />Screenshot</button>
          {s.state === 'takeover' ? <button className="btn sm" onClick={() => { endTakeover(s.id); toast({ tone: 'info', title: 'Control returned to agent (demo)' }); }}><RotateCcw size={14} />Return control{left ? ` (${left}m)` : ''}</button> : <button className="btn sm" onClick={() => openDialog('browser-takeover', { sessionId: s.id })}><Hand size={14} />Request takeover</button>}
          <span className="sep" />
          <button className="btn sm good" disabled={!gate} onClick={() => openDialog('browser-action-approval', { sessionId: s.id, stepId: gate?.id })}><ShieldCheck size={14} />{gate ? 'Approve pending action' : 'No pending action'}</button>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => openDialog('browser-replay', { sessionId: s.id })}><History size={14} />Replay</button>
          <IconButton icon={Power} label="End session" size="sm" variant="danger" onClick={() => openDialog('browser-session-close', { sessionId: s.id })} />
        </div>
        <div className="brk-crumbs"><Lock size={12} className="good" /><b>{host(s.origin)}</b> › Cart › <b>Checkout</b> › Payment <span className="spacer" /><span className="mono">{s.viewport}</span></div>
      </div>
      <div className="col" style={{ gap: 10 }}>
        <div className="subpanel col" style={{ gap: 8 }}>
          <div className="row"><b>Current step</b><HelpTrigger k="browser.locator" /><span className="spacer" /><Chip hue={f.kind === 'gate' ? 40 : 190} size="sm">{f.kind}</Chip></div>
          <AnimatePresence mode="wait"><motion.div key={fi} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</motion.div></AnimatePresence>
          <div className="row" style={{ gap: 12 }}>
            <RingGauge value={Math.round(STEPS[fi % STEPS.length].confidence * 100)} size={74} stroke={8} label="Locator confidence" colors={['#22d3ee', '#a78bfa']} />
            <div className="col" style={{ gap: 3, minWidth: 0 }}><span className="dim" style={{ fontSize: 11.5 }}>Locator confidence</span><span className="mono ellipsis" style={{ fontSize: 11 }}>{STEPS[fi % STEPS.length].locator}</span>{f.policy && <span className="warn" style={{ fontSize: 11.5 }}>{f.policy}</span>}</div>
          </div>
        </div>
        <div className="subpanel">
          <KV2 rows={[['Session', s.id], ['Mission', s.missionId], ['Agent', AGENT_BY_ID[s.agentId]?.name ?? s.agentId], ['Profile', s.profile], ['Screenshot', secLabel(s.screenshotAgoSec)], ['Redaction', <Chip key="r" hue={150} size="sm">2 regions masked</Chip>]]} />
        </div>
        <div className="subpanel">
          <div className="row" style={{ marginBottom: 6 }}><Activity size={14} className="info" /><b style={{ fontSize: 13 }}>Event feed</b><span className="spacer" /><Dot tone="good" pulse /></div>
          <div className="col" style={{ gap: 4 }}>
            <AnimatePresence initial={false}>{log.map((l, i) => <motion.div key={l.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1 - i * .12, x: 0 }} exit={{ opacity: 0 }} className="mono" style={{ fontSize: 11.5 }}><CircleDot size={9} className="info" style={{ display: 'inline', marginRight: 6 }} />{l.t}</motion.div>)}</AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
function KV2({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="kv" style={{ margin: 0 }}>{rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

/* ---------------------------------------------------------------- */
const PHASES = ['proposal', 'policy', 'execution', 'observation'] as const;
function Actions() {
  const resolved = useBrowser((s) => s.resolved);
  const [sel, setSel] = useState(STEPS[3].id);
  const [f, setF] = useState<'all' | 'gated' | 'issues'>('all');
  const list = STEPS.filter((s) => f === 'all' || (f === 'gated' ? s.status === 'gated' : s.status === 'retry' || s.status === 'error'));
  const step = STEPS.find((s) => s.id === sel) ?? STEPS[0];
  const dec = resolved[step.id];
  return (
    <div className="brk-split">
      <div className="col" style={{ gap: 10 }}>
        <div className="row"><Segmented ariaLabel="Step filter" size="sm" value={f} onChange={setF} options={[{ key: 'all', label: `All ${STEPS.length}` }, { key: 'gated', label: 'Gated' }, { key: 'issues', label: 'Retries & errors' }]} /><HelpTrigger k="browser.actions" /><span className="spacer" /><span className="dim" style={{ fontSize: 12 }}>Session BS-2038</span></div>
        <div className="brk-steps brk-scroll">
          <AnimatePresence initial={false}>
            {list.map((s, i) => <StepRow key={s.id} s={s} i={i} on={s.id === sel} dec={resolved[s.id]} onSel={() => setSel(s.id)} />)}
          </AnimatePresence>
          {list.length === 0 && <EmptyState icon={CheckCircle2} title="Nothing here" body="No steps match this filter." />}
        </div>
      </div>
      <motion.div key={step.id} className="subpanel col" style={{ gap: 10 }} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
        <div className="row"><b>{step.id}</b><Chip hue={step.status === 'ok' ? 150 : step.status === 'gated' ? 40 : step.status === 'error' ? 350 : 205} size="sm">{dec ?? step.status}</Chip><span className="spacer" /><span className="dim mono" style={{ fontSize: 11.5 }}>{step.ms} ms</span></div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{step.verb} · {step.target}</div>
        <div className="row" style={{ gap: 14 }}>
          <RingGauge value={Math.round(step.confidence * 100)} size={96} stroke={9} label="Confidence" colors={step.confidence < .8 ? ['#fbbf24', '#fb923c'] : ['#22d3ee', '#2ee98a']} />
          <div className="col" style={{ gap: 4, minWidth: 0 }}><span className="section-label">Locator <HelpTrigger k="browser.locator" /></span><span className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>{step.locator}</span><span className="dim" style={{ fontSize: 11.5 }}>{step.confidence < .8 ? 'Low confidence: retry with stricter role locator.' : 'Unique target resolved.'}</span></div>
        </div>
        <div className="brk-phases">
          {PHASES.map((p, i) => <div key={p} className={cx('brk-phase', PHASES.indexOf(step.phase) >= i || step.status === 'ok' || step.status === 'gated' ? 'on' : '')}><b>{i + 1}. {p}</b><span className="ellipsis" style={{ display: 'block' }}>{p === 'proposal' ? 'Structured action' : p === 'policy' ? (step.status === 'gated' ? 'Needs approval' : step.status === 'error' ? 'Blocked' : 'Allowed') : p === 'execution' ? `${step.ms} ms` : 'Redacted frame'}</span></div>)}
        </div>
        <KV2 rows={[['Policy', step.policy], ['Observation', step.observation]]} />
        <div className="row wrap" style={{ gap: 6 }}>
          {step.status === 'gated' && !dec && <button className="btn sm good" onClick={() => openDialog('browser-action-approval', { sessionId: step.sessionId, stepId: step.id })}><ShieldCheck size={14} />Review approval</button>}
          <button className="btn sm" onClick={() => toast({ tone: 'info', title: 'Replay fixture queued (demo)', body: `Step ${step.id} will replay against the offline fixture.` })}><FlaskConical size={14} />Replay fixture</button>
          <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: 'Clarification requested (demo)', body: 'Agent will explain target choice.' })}><MessageSquareQuote size={14} />Ask clarification</button>
        </div>
      </motion.div>
    </div>
  );
}
function StepRow({ s, i, on, dec, onSel }: { s: BrowserStep; i: number; on: boolean; dec?: string; onSel: () => void }) {
  return (
    <motion.div layout className="brk-step" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * .03 }}>
      <span className={cx('brk-step-dot', dec ? 'ok' : s.status)}>{s.status === 'gated' && !dec ? <ShieldAlert size={14} /> : s.status === 'error' ? <Ban size={14} /> : s.n}</span>
      <button className={cx('subpanel glass-card hoverable brk-step-card', on && 'selected')} style={{ textAlign: 'left', color: 'var(--text)', borderColor: on ? 'var(--accent-2)' : undefined }} onClick={onSel}>
        <div className="row" style={{ gap: 8 }}><Chip hue={s.verb === 'click' ? 280 : s.verb === 'navigate' ? 200 : s.verb === 'type' ? 170 : 220} size="sm">{s.verb}</Chip><span className="ellipsis grow" style={{ fontSize: 13 }}>{s.target}</span>
          <span className="brk-conf"><span className="bar thin"><i style={{ width: `${s.confidence * 100}%` }} /></span><b className="tnum">{Math.round(s.confidence * 100)}%</b></span></div>
        <div className="dim ellipsis" style={{ fontSize: 11.5, marginTop: 3 }}>{dec ? `Owner ${dec} once` : s.observation}</div>
      </button>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- */
function Grants() {
  const grants = useBrowser((s) => s.grants);
  const [revoke, setRevoke] = useState<SiteGrant | null>(null);
  const revokeG = useBrowser((s) => s.revokeGrant);
  const exp = (m: number) => (m <= 0 ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8 }}><span className="muted" style={{ fontSize: 13 }}>A grant authorizes only the listed origin, actions and mission for a limited time.</span><HelpTrigger k="browser.originGrant" /><span className="spacer" /><button className="btn primary" onClick={() => openDialog('site-permission')}><Plus size={15} />Request origin</button></div>
      <div className="table-wrap brk-scroll">
        <table className="table">
          <thead><tr><th>Origin</th><th>Mission</th><th>Actions</th><th>Credential source</th><th>Expires</th><th>Risk</th><th>Status</th><th /></tr></thead>
          <tbody>
            <AnimatePresence initial={false}>
              {grants.map((g, i) => (
                <motion.tr key={g.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: g.status === 'revoked' ? .55 : 1, y: 0 }} transition={{ delay: i * .03 }}>
                  <td><span className="row" style={{ gap: 6 }}><Globe size={14} className="info" /><span className="mono" style={{ fontSize: 12 }}>{host(g.origin)}</span></span></td>
                  <td className="mono dim">{g.missionId}</td>
                  <td><span className="brk-pillrow">{g.actions.map((a) => <Chip key={a} hue={a === 'submit' ? 350 : a === 'type' ? 38 : 205} size="sm">{a}</Chip>)}</span></td>
                  <td className="dim" style={{ fontSize: 12 }}>{g.cred}</td>
                  <td style={{ minWidth: 110 }}><div className="tnum" style={{ fontSize: 12 }}>{exp(g.expiresMin)}</div><div className={cx('bar thin', g.expiresMin < 45 && 'warn')}><i style={{ width: `${Math.min(100, g.expiresMin / 3.6)}%` }} /></div></td>
                  <td><RiskMeter risk={g.risk} /></td>
                  <td><Chip hue={g.status === 'active' ? 150 : g.status === 'pending' ? 40 : g.status === 'expiring' ? 28 : 260} size="sm">{g.status}</Chip></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {g.status === 'pending' && <button className="btn sm primary" onClick={() => openDialog('site-permission', { grantId: g.id, origin: g.origin, missionId: g.missionId })}>Review</button>}
                    {(g.status === 'active' || g.status === 'expiring') && <button className="btn sm danger" onClick={() => setRevoke(g)}>Revoke</button>}
                    {g.status === 'revoked' && <button className="btn sm ghost" onClick={() => openDialog('site-permission', { origin: g.origin, missionId: g.missionId })}>Re-request</button>}
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      <AnimatePresence>
        {revoke && (
          <Modal title={`Revoke ${host(revoke.origin)}`} icon={Ban} tone="danger" help="browser.originGrant" size="sm" dialogId="DL-20" onClose={() => setRevoke(null)}
            footer={<><button className="btn" data-autofocus onClick={() => setRevoke(null)}>Cancel</button><button className="btn danger" onClick={() => { revokeG(revoke.id); toast({ tone: 'warning', title: 'Grant revoked (demo)', body: 'Sessions on this origin pause immediately.' }); setRevoke(null); }}>Revoke grant</button></>}>
            <p className="muted" style={{ margin: 0 }}>Live sessions using <b className="mono">{host(revoke.origin)}</b> pause at the next action. Past evidence stays retained.</p>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Recipes() {
  const [pub, setPub] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<string | null>(null);
  useEffect(() => { if (!testing) return; const t = window.setTimeout(() => { toast({ tone: 'success', title: 'Fixture passed (demo)', body: `${testing}: all steps resolved to unique targets.` }); setTesting(null); }, 1400); return () => window.clearTimeout(t); }, [testing]);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row"><span className="muted" style={{ fontSize: 13 }}>Reusable, reviewed workflows. Stability = share of recent runs that finished without human help.</span><HelpTrigger k="browser.recipes" /><span className="spacer" /><button className="btn" onClick={() => openDialog('recipe-editor')}><Plus size={14} />New recipe</button></div>
      <div className="grid g-3">
        {RECIPES.map((r, i) => {
          const status = pub[r.id] ? 'published' : r.status;
          return (
            <motion.div key={r.id} className="subpanel glass-card hoverable brk-recipe" style={{ ['--h' as string]: r.hue }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
              <div className="row" style={{ gap: 12 }}>
                <div className="brk-stab"><RingGauge value={r.stability} size={56} stroke={6} colors={[`hsl(${r.hue} 90% 60%)`, `hsl(${r.hue + 60} 90% 65%)`]} /></div>
                <div style={{ minWidth: 0, flex: 1 }}><b className="ellipsis" style={{ display: 'block' }}>{r.name}</b><span className="mono dim" style={{ fontSize: 11.5 }}>{r.id} · {r.version}</span></div>
                <Chip hue={status === 'published' ? 150 : status === 'candidate' ? 270 : 40} size="sm">{status}</Chip>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="col" style={{ gap: 2, fontSize: 11.5 }}><span className="muted">{r.steps} steps · {r.runs} runs</span><span className="dim ellipsis" style={{ maxWidth: 170 }}>{r.origin}</span><span className="dim">{r.owner} · {ago(r.updatedMin)}</span></div>
                <div style={{ textAlign: 'right' }}><Sparkline data={r.trend} w={96} h={34} color={`hsl(${r.hue} 90% 62%)`} /><div className="dim" style={{ fontSize: 10.5 }}>stability {r.stability}%</div></div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => openDialog('recipe-editor', { recipeId: r.id })}><Pencil size={13} />Edit</button>
                <button className="btn sm" disabled={testing === r.id} onClick={() => setTesting(r.id)}><FlaskConical size={13} />{testing === r.id ? 'Testing…' : 'Test'}</button>
                {status !== 'published' && <button className="btn sm primary" disabled={r.stability < 80} title={r.stability < 80 ? 'Stability must reach 80% before review' : undefined} onClick={() => { setPub((p) => ({ ...p, [r.id]: true })); toast({ tone: 'success', title: `${r.name} sent for review, then published (demo)` }); }}><Rocket size={13} />Publish</button>}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Replay() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState('1');
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setT((x) => { const n = x + .25 * +speed; return n >= REPLAY_LEN ? 0 : n; }), 250);
    return () => window.clearInterval(id);
  }, [playing, speed]);
  const idx = REPLAY.reduce((a, f, i) => (f.t <= t ? i : a), 0);
  const f = REPLAY[idx];
  const seek = (e: React.MouseEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); setT(Math.max(0, Math.min(REPLAY_LEN, ((e.clientX - r.left) / r.width) * REPLAY_LEN))); };
  const exportTrace = () => { downloadText('sanitized-trace-BS-2038.json', JSON.stringify({ session: 'BS-2038', sanitized: true, note: 'DEMO trace: secrets, cookies and OTP removed', frames: REPLAY }, null, 2)); toast({ tone: 'success', title: 'Sanitized trace exported', body: 'Real JSON file generated in your browser.' }); };
  return (
    <div className="brk-split">
      <div className="col" style={{ gap: 8 }}>
        <FakeBrowser origin="https://portal.example.com" path="/checkout" target={f.tgt} cursor={{ x: f.x, y: f.y }} state={f.kind === 'gate' ? 'gate' : 'active'} tsLabel={`replay t+${Math.floor(t)}s`} tickKey={idx} />
        <div className="brk-toolbar">
          <button className="btn sm primary" onClick={() => setPlaying((p) => !p)}>{playing ? <><Pause size={14} />Pause</> : <><Play size={14} />Play</>}</button>
          <button className="btn sm" onClick={() => { setT(0); setPlaying(true); }}><RotateCcw size={14} />Restart</button>
          <Segmented ariaLabel="Playback speed" size="sm" value={speed} onChange={setSpeed} options={[{ key: '0.5', label: '0.5×' }, { key: '1', label: '1×' }, { key: '2', label: '2×' }, { key: '4', label: '4×' }]} />
          <span className="spacer" /><span className="mono dim" style={{ fontSize: 12 }}>{Math.floor(t).toString().padStart(2, '0')}s / {REPLAY_LEN}s</span>
        </div>
        <div className="brk-scrub" aria-label="Replay scrubber">
          <div className="brk-scrub-track" onClick={seek} role="slider" aria-valuemin={0} aria-valuemax={REPLAY_LEN} aria-valuenow={Math.floor(t)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowRight') setT((x) => Math.min(REPLAY_LEN, x + 2)); if (e.key === 'ArrowLeft') setT((x) => Math.max(0, x - 2)); }}>
            <div className="brk-scrub-fill" style={{ width: `${(t / REPLAY_LEN) * 100}%` }} /><div className="brk-scrub-head" style={{ left: `${(t / REPLAY_LEN) * 100}%` }} />
          </div>
          {REPLAY.map((x, i) => <button key={i} className={cx('brk-frame', x.kind === 'gate' && 'gate', i === idx && 'on')} style={{ left: `${(x.t / REPLAY_LEN) * 100}%`, top: 36 }} onClick={() => { setT(x.t); }} aria-label={x.label}><span>{x.kind === 'gate' ? <ShieldAlert size={12} /> : i + 1}</span></button>)}
        </div>
      </div>
      <div className="col" style={{ gap: 10 }}>
        <div className="subpanel col" style={{ gap: 6 }}>
          <div className="row"><b>Trace · BS-2038</b><HelpTrigger k="browser.replay" /><span className="spacer" /><Chip hue={150} size="sm">deterministic</Chip></div>
          <div className="col" style={{ gap: 5, maxHeight: 250, overflow: 'auto' }}>
            {REPLAY.map((x, i) => <button key={i} className={cx('rv-select-row', i === idx && 'on')} onClick={() => setT(x.t)}><span className="mono dim" style={{ width: 28 }}>{String(x.t).padStart(2, '0')}s</span><span className="grow ellipsis" style={{ fontSize: 12.5 }}>{x.label}</span>{x.policy && <Chip hue={40} size="sm" title={x.policy}>policy</Chip>}</button>)}
          </div>
        </div>
        <div className="subpanel col" style={{ gap: 6 }}>
          <span className="section-label">Policy decisions</span>
          {REPLAY.filter((x) => x.policy).map((x) => <div key={x.t} className="row" style={{ fontSize: 12.5, gap: 8 }}><ShieldCheck size={14} className="warn" /><span><b>{x.label}</b><br /><span className="muted">{x.policy}</span></span></div>)}
        </div>
        <div className="row"><button className="btn" onClick={exportTrace}><Download size={14} />Export sanitized trace</button><button className="btn ghost" onClick={() => toast({ tone: 'info', title: 'Diff run queued (demo)', body: 'Compares this trace to the previous recipe version.' })}>Diff run</button></div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function Boundary() {
  const rules = [['Isolated Chromium contexts on the VPS', ShieldCheck], ['Secrets, cookies and OTP always redacted', Lock], ['New origins pause for authorization', GlobeLock], ['CAPTCHA and site rules never bypassed', Ban], ['Takeover is explicit, timed and audited', Hand]] as const;
  return (
    <Panel icon={ShieldCheck} title="Browser Boundary" help="browser.boundary" delay={.2} className="bottom-panel">
      <div className="col" style={{ gap: 9 }}>{rules.map(([t, I], i) => <motion.div key={t} className="row" style={{ gap: 9, fontSize: 12.5 }} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .3 + i * .07 }}><CheckCircle2 size={15} className="good" /><I size={14} className="muted" />{t}</motion.div>)}</div>
    </Panel>
  );
}
function GatesPanel() {
  const grants = useBrowser((s) => s.grants);
  const resolved = useBrowser((s) => s.resolved);
  const steps = STEPS.filter((s) => s.consequential && !resolved[s.id]);
  const pend = grants.filter((g) => g.status === 'pending');
  return (
    <Panel icon={ShieldAlert} title="Pending Gates" help="browser.gates" delay={.25} className="bottom-panel">
      <div className="col" style={{ gap: 8 }}>
        {steps.map((s) => <div key={s.id} className="subpanel row" style={{ padding: 8, gap: 8 }}><ShieldAlert size={16} className="warn" /><span className="grow ellipsis" style={{ fontSize: 12.5 }}>{s.verb}: {s.target}</span><button className="btn sm good" onClick={() => openDialog('browser-action-approval', { stepId: s.id })}>Review</button></div>)}
        {pend.map((g) => <div key={g.id} className="subpanel row" style={{ padding: 8, gap: 8 }}><GlobeLock size={16} className="warn" /><span className="grow ellipsis mono" style={{ fontSize: 12 }}>{host(g.origin)}</span><button className="btn sm primary" onClick={() => openDialog('site-permission', { grantId: g.id, origin: g.origin, missionId: g.missionId })}>Review</button></div>)}
        {!steps.length && !pend.length && <EmptyState icon={CheckCircle2} title="All clear" body="No actions or origins are waiting." />}
      </div>
    </Panel>
  );
}
function Resources() {
  const sessions = useBrowser((s) => s.sessions);
  return (
    <Panel icon={Cpu} title="Host Resources" help="browser.resources" delay={.3} className="bottom-panel">
      <div className="col" style={{ gap: 10 }}>
        {sessions.filter((s) => s.memMb > 0).map((s, i) => <div key={s.id} className="row" style={{ gap: 10, fontSize: 12.5 }}><span className="mono" style={{ width: 62 }}>{s.id}</span><span className="bar grow"><motion.i initial={{ width: 0 }} animate={{ width: `${(s.memMb / s.memCap) * 100}%` }} transition={{ duration: .9, delay: .3 + i * .08 }} /></span><b className="tnum" style={{ width: 54, textAlign: 'right' }}>{s.memMb} MB</b></div>)}
        <div className="dim" style={{ fontSize: 11.5 }}>Per-context caps enforced by systemd. Orphan contexts are cleaned only after verification.</div>
      </div>
    </Panel>
  );
}
