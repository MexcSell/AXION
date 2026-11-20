import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Radar, Play, Pause, Square, RotateCcw, Crown, Clock3, Wallet, LayoutDashboard, Network, Workflow, Globe, MessagesSquare,
  Package, Gavel, FileText, History, Target, CheckCircle2, Circle, Sparkles, Eye, Download, PlayCircle, GitCompare, Layers,
  FileJson, FileDown, ShieldCheck, AlertTriangle, Filter, ChevronRight, BadgeCheck,
} from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { Chip, MissionStatusChip, InstanceStateChip, DemoTag, Dot } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tip } from '@/components/ui/Tip';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useTab, useMediaQuery } from '@/hooks/useTab';
import { useData, allApprovals } from '@/store/data';
import { openDialog, toast } from '@/store/ui';
import { AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { getMissionControl } from '@/data/missions';
import type { Artifact, Mission, TimelineEvent } from '@/data/types';
import { ago, clock, cx, money } from '@/lib/format';
import { KindIcon, PhaseStepper, ProgressRing } from '@/features/mission/MissionBits';
import { HierarchyGraph } from '@/features/mission/HierarchyGraph';
import { Messenger, EvidenceThumb } from '@/features/mission/Messenger';
import { TaskFlow } from '@/features/mission/TaskFlow';
import { BrowserMini } from '@/features/mission/BrowserMini';
import { ApprovalMini, EventIcon } from '@/features/mission/Shared';
import { useLive } from '@/features/mission/live';
import '@/theme/pages/missions.css';
import '@/theme/pages/mission-control.css';

const TAB_ICONS: Record<string, typeof Radar> = {
  Overview: LayoutDashboard, Hierarchy: Network, 'Task Flow': Workflow, Browser: Globe, Conversations: MessagesSquare,
  Results: Package, Approvals: Gavel, Reports: FileText, Timeline: History,
};

export default function MissionControlPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const missions = useData((s) => s.missions);
  const m = missions.find((x) => x.id === id);
  const [tab, setTab, tabs] = useTab('control');
  const [sp, setSp] = useSearchParams();
  const decisions = useData((s) => s.approvalDecisions);
  const wide = useMediaQuery('(min-width: 1281px)');

  if (!m) {
    return (
      <div className="page"><Panel><EmptyState icon={Radar} title={`Mission ${id} not found`} body="It may have been purged, or the link is wrong."
        action={<button className="btn primary" onClick={() => nav('/missions')}>Back to missions</button>} /></Panel></div>
    );
  }
  const mc = getMissionControl(m);
  const agentParam = sp.get('agent');
  const selected = agentParam && mc.nodes.some((n) => n.agentId === agentParam) ? agentParam : m.leadId;
  const select = (agentId: string) => {
    setSp((p) => { const n = new URLSearchParams(p); n.set('agent', agentId); return n; }, { replace: true });
    // no inspector pane on narrow screens: open the conversation drawer instead (DL-15)
    if (!wide && tab !== 'Conversations') openDialog('conversation-thread', { missionId: m!.id, agentId });
  };
  const openChat = (agentId: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('agent', agentId); n.set('tab', 'conversations'); return n; });
  const pending = allApprovals([m], decisions).filter((a) => a.status === 'pending').length;
  const showInspector = wide && tab !== 'Conversations';

  return (
    <div className="page mc-page">
      <MissionHeader m={m} missions={missions} />
      <div className="mc-tabs-row">
        <Tabs tabs={tabs.map((t) => ({ key: t, label: t, icon: TAB_ICONS[t], count: t === 'Approvals' && pending ? pending : undefined }))} value={tab} onChange={setTab} ariaLabel="Mission Control tabs" />
      </div>
      <div className={cx('mc-grid', !showInspector && 'no-inspector')}>
        <TeamColumn m={m} selected={selected} onSelect={select} />
        <motion.section className="panel mc-center" layout="position">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab} style={{ height: '100%' }}>
              {tab === 'Overview' && <OverviewTab m={m} />}
              {tab === 'Hierarchy' && <HierarchyGraph mission={m} selected={selected} onSelect={select} onOpenChat={openChat} />}
              {tab === 'Task Flow' && <TaskFlow mission={m} />}
              {tab === 'Browser' && <BrowserMini mission={m} />}
              {tab === 'Conversations' && <Messenger mission={m} agentId={selected} layout="wide" />}
              {tab === 'Results' && <ResultsTab m={m} />}
              {tab === 'Approvals' && <ApprovalsTab m={m} />}
              {tab === 'Reports' && <ReportsTab m={m} />}
              {tab === 'Timeline' && <TimelineTab m={m} />}
            </motion.div>
          </AnimatePresence>
        </motion.section>
        {showInspector && (
          <motion.aside className="panel mc-inspector" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .3 }} aria-label="Agent conversation inspector">
            <AnimatePresence mode="wait">
              <motion.div key={selected} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: .22 }} style={{ height: '100%' }}>
                <Messenger mission={m} agentId={selected} layout="narrow" />
              </motion.div>
            </AnimatePresence>
          </motion.aside>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function MissionHeader({ m, missions }: { m: Mission; missions: Mission[] }) {
  const nav = useNavigate();
  const lead = AGENT_BY_ID[m.leadId];
  const running = ['running', 'planning', 'verifying'].includes(m.status);
  const closed = ['completed', 'archived'].includes(m.status);
  return (
    <motion.section className="panel mc-header" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
      <KindIcon kind={m.kind} size={50} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="section-label" style={{ color: 'var(--accent-2)' }}>Mission Control</span>
          <select className="select mc-switch" value={m.id} onChange={(e) => nav(`/control/${e.target.value}${location.search}`)} aria-label="Switch mission">
            {missions.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.title}</option>)}
          </select>
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 2 }}>
          <h1 className="mp-title">{m.title}</h1>
          <MissionStatusChip status={m.status} />
          <span className="mono dim" style={{ fontSize: 12 }}>rev {m.revision} · {m.version}</span>
        </div>
        <div className="row wrap" style={{ gap: 14, fontSize: 12.5, marginTop: 4 }}>
          <span className="row muted" style={{ gap: 5 }}><Crown size={13} className="warn" />Lead <b style={{ color: 'var(--text)' }}>{lead?.name}</b> <span className="mono dim">{lead?.version}</span></span>
          <span className="row muted" style={{ gap: 5 }}><Clock3 size={13} />Elapsed {m.elapsedH} h</span>
          <span className="row muted" style={{ gap: 5 }}><Target size={13} />Target: {m.criteria.length} criteria</span>
          <span className="row muted" style={{ gap: 5 }}><ShieldCheck size={13} className="good" />Policy: prepare + gated execute</span>
        </div>
      </div>
      <div className="mc-budget">
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}><span className="row muted nowrap" style={{ gap: 5 }}><Wallet size={13} />Budget</span><b className="tnum">{money(m.cost)} / {money(m.budget, 0)}</b></div>
        <div className={'bar ' + (m.cost / m.budget > .85 ? 'warn' : 'good')} style={{ marginTop: 6 }}><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, (m.cost / m.budget) * 100)}%` }} transition={{ duration: 1 }} /></div>
        <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{Math.round((m.cost / m.budget) * 100)}% used · hard cap pauses mission</div>
      </div>
      <div className="col" style={{ alignItems: 'center', gap: 2 }}>
        <ProgressRing value={m.progress} size={64} stroke={6} tone={m.status === 'failed' ? 'var(--bad)' : 'var(--accent-2)'} />
        <span className="row dim" style={{ gap: 3, fontSize: 10.5 }}>verified<HelpTrigger k="mission.progress.verified" /></span>
      </div>
      <div className="mc-controls" role="toolbar" aria-label="Mission controls">
        <IconButton icon={Play} label={m.status === 'draft' ? 'Start' : 'Resume'} variant="bordered" disabled={running || closed} onClick={() => openDialog('mission-start', { missionId: m.id })} />
        <IconButton icon={Pause} label="Pause" variant="bordered" disabled={!running} onClick={() => openDialog('mission-pause', { missionId: m.id })} />
        <IconButton icon={RotateCcw} label="Retry from checkpoint" variant="bordered" disabled={closed} onClick={() => openDialog('mission-retry', { missionId: m.id })} />
        <IconButton icon={Square} label="Stop at safe boundary" variant="danger" className="bordered" disabled={closed} onClick={() => openDialog('mission-stop', { missionId: m.id })} />
        <IconButton icon={MessagesSquare} label="All conversations (thread picker)" variant="bordered" onClick={() => openDialog('thread-picker', { missionId: m.id })} />
        <HelpTrigger k="mission.controls" />
      </div>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
function TeamColumn({ m, selected, onSelect }: { m: Mission; selected: string; onSelect: (id: string) => void }) {
  const mc = getMissionControl(m);
  const depth = (inst: string): number => { const n = mc.nodes.find((x) => x.instanceId === inst); return n?.parent ? depth(n.parent) + 1 : 0; };
  const ordered = useMemo(() => {
    const out: typeof mc.nodes = [];
    const walk = (inst?: string) => mc.nodes.filter((n) => n.parent === inst).forEach((n) => { out.push(n); walk(n.instanceId); });
    walk(undefined);
    return out;
  }, [mc.nodes]);
  return (
    <aside className="panel mc-team" aria-label="Mission team and milestones">
      <div className="row" style={{ marginBottom: 8 }}><Network size={16} className="info" /><b>Mission team</b><span className="dim" style={{ fontSize: 12 }}>({mc.nodes.length})</span><HelpTrigger k="agent.instance" /></div>
      <div className="col" style={{ gap: 3 }} role="listbox" aria-label="Agents in this mission">
        {ordered.map((n, i) => {
          const a = AGENT_BY_ID[n.agentId];
          const d = depth(n.instanceId);
          const sel = n.agentId === selected;
          return (
            <motion.button key={n.instanceId} role="option" aria-selected={sel} className={cx('team-row', sel && 'selected')} style={{ paddingLeft: 6 + d * 14 }} onClick={() => onSelect(a.id)}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .03 }}>
              {sel && <motion.span layoutId={`team-sel-${m.id}`} className="team-sel" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
              {d > 0 && <ChevronRight size={11} className="dim" style={{ position: 'relative' }} />}
              <span style={{ position: 'relative' }}><RobotAvatar role={a.role} size={30} status={n.state === 'working' ? 'good' : n.state === 'waiting' ? 'warn' : n.state === 'blocked' ? 'bad' : n.state === 'done' ? 'violet' : 'info'} /></span>
              <div style={{ minWidth: 0, flex: 1, position: 'relative', textAlign: 'left' }}>
                <div className="row" style={{ gap: 4 }}><b className="ellipsis" style={{ fontSize: 12.5 }}>{a.name}</b>{n.pending > 0 && <span className="badge">{n.pending}</span>}</div>
                <div className="dim ellipsis" style={{ fontSize: 11 }}>{n.task}</div>
              </div>
            </motion.button>
          );
        })}
      </div>
      <div className="divider" />
      <div className="section-label" style={{ marginBottom: 8 }}>Milestones</div>
      <div className="milestones">
        {m.phases.map((p, i) => (
          <motion.div key={p.key} className={cx('ms', p.state)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .2 + i * .05 }}>
            <span className="ms-dot">{p.state === 'done' ? <CheckCircle2 size={14} /> : p.state === 'blocked' ? <AlertTriangle size={13} /> : <Circle size={12} />}</span>
            <span className="grow">{p.label}</span>
            <span className="dim" style={{ fontSize: 11 }}>{p.state === 'active' ? 'now' : p.date}</span>
          </motion.div>
        ))}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
function OverviewTab({ m }: { m: Mission }) {
  const mc = getMissionControl(m);
  const nav = useNavigate();
  const [, setTab] = useTab('control');
  const decisions = useData((s) => s.approvalDecisions);
  const pend = allApprovals([m], decisions).filter((a) => a.status === 'pending');
  const blockers = mc.nodes.filter((n) => n.state === 'blocked' || n.state === 'waiting');
  const lines = useLive((s) => s.lines).filter((l) => l.missionId === m.id).slice(0, 4);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="ov-grid">
        {[
          { l: 'Verified progress', v: `${m.progress}%`, s: `${m.tasksVerified}/${m.tasksTotal} tasks`, c: '#22d3ee', i: BadgeCheck },
          { l: 'Active blockers', v: String(blockers.length), s: blockers.length ? blockers.map((b) => AGENT_BY_ID[b.agentId]?.name).join(', ') : 'none', c: blockers.length ? '#fbbf24' : '#2ee98a', i: AlertTriangle },
          { l: 'Pending decisions', v: String(pend.length), s: pend[0]?.title ?? 'nothing waiting', c: '#a78bfa', i: Gavel },
          { l: 'Artifacts', v: String(mc.artifacts.length), s: `${mc.artifacts.reduce((s, a) => s + a.versions.length, 0)} immutable versions`, c: '#60a5fa', i: Package },
        ].map((k, i) => (
          <motion.div key={k.l} className="kpi" style={{ ['--kc' as string]: k.c }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
            <k.i size={26} className="kpi-ico" />
            <div style={{ minWidth: 0 }}><div className="kpi-val" style={{ fontSize: 21 }}>{k.v}</div><div className="kpi-label">{k.l}</div><div className="dim ellipsis" style={{ fontSize: 11 }}>{k.s}</div></div>
          </motion.div>
        ))}
      </div>
      <PhaseStepper phases={m.phases} />
      {pend.length > 0 && (
        <motion.div className="next-action" initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }}>
          <Gavel size={20} />
          <div className="grow"><b>Next action is yours:</b> {pend[0].title}<div className="dim" style={{ fontSize: 12 }}>{pend[0].detail}</div></div>
          <button className="btn primary" onClick={() => setTab('Approvals')}>Review decision</button>
        </motion.div>
      )}
      <div className="grid g-2">
        <div className="subpanel">
          <div className="row" style={{ marginBottom: 6 }}><Target size={15} className="info" /><b>Mission definition</b><span className="spacer" /><button className="btn sm ghost" onClick={() => openDialog('attach-files', { onAttach: (a: unknown[]) => toast({ tone: 'success', title: `${a.length} resource(s) added to ${m.id}`, body: 'Stored with checksum; agents see them in the next planning step.' }) })}>Add resource</button><button className="btn sm ghost" onClick={() => openDialog('mission-edit', { missionId: m.id })}>Edit</button></div>
          <p className="muted" style={{ fontSize: 13 }}>{m.objective}</p>
          <div className="col" style={{ gap: 5, marginTop: 8 }}>
            {m.criteria.map((c) => <div key={c.text} className="row" style={{ gap: 7, fontSize: 12.5 }}>{c.done ? <CheckCircle2 size={14} className="good" /> : <Circle size={14} className="dim" />}{c.text}</div>)}
          </div>
        </div>
        <div className="ai-summary">
          <div className="row" style={{ marginBottom: 6 }}><Sparkles size={15} className="violet" /><b>AI progress summary</b><HelpTrigger k="mission.aiSummary" /><span className="spacer" /><span className="dim" style={{ fontSize: 11.5 }}>{ago(m.summaryAgoMin)}</span></div>
          <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>{m.summary}</p>
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => openDialog('ai-summary', { missionId: m.id })}>Review provenance</button>
        </div>
      </div>
      <div className="grid g-2">
        <div className="subpanel">
          <div className="row" style={{ marginBottom: 8 }}><Package size={15} className="info" /><b>Recent artifacts</b><span className="spacer" /><button className="btn sm ghost" onClick={() => setTab('Results')}>All results</button></div>
          {mc.artifacts.slice(0, 3).map((a) => (
            <div key={a.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => openDialog('artifact-preview', { missionId: m.id, artifactId: a.id })}>
              <ArtifactIcon a={a} /><span className="ellipsis grow">{a.name}</span><Chip hue={a.versions[0].verified ? 145 : 38} size="sm">{a.versions[0].v}</Chip>
            </div>
          ))}
        </div>
        <div className="subpanel">
          <div className="row" style={{ marginBottom: 8 }}><History size={15} className="info" /><b>Live activity</b><span className="spacer" /><DemoTag /></div>
          <AnimatePresence initial={false}>
            {lines.map((l) => (
              <motion.div key={l.id} className="event-row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                <span className="mono dim">{clock(0, l.at)}</span><Dot tone="info" /><span className="ellipsis">{l.text}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {mc.timeline.slice(0, Math.max(0, 4 - lines.length)).map((e) => <div key={e.id} className="event-row"><span className="mono dim">{clock(e.agoMin)}</span><EventIcon type={e.type} /><span className="ellipsis">{e.text}</span></div>)}
          <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => nav(`/control/${m.id}?tab=timeline`)}>Open timeline</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const ART_ICON: Record<Artifact['type'], typeof Package> = { website: Globe, document: FileText, image: Eye, dataset: Layers, code: FileJson, report: FileText, recipe: Workflow, screenshot: Eye, video: PlayCircle };
function ArtifactIcon({ a }: { a: Artifact }) {
  const I = ART_ICON[a.type];
  return <span className="ev-ico" style={{ width: 30, height: 30, color: 'var(--accent-2)' }}><I size={15} /></span>;
}

export function downloadBlob(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ResultsTab({ m }: { m: Mission }) {
  const mc = getMissionControl(m);
  const [ver, setVer] = useState<Record<string, string>>({});
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}><Package size={16} className="info" /><b>Mission results</b><span className="dim" style={{ fontSize: 12 }}>Every version is immutable; old versions stay downloadable.</span><HelpTrigger k="release.version" /><span className="spacer" />
        <button className="btn sm" onClick={() => openDialog('download-bundle', { missionId: m.id })}><Download size={14} />Bundle</button></div>
      <div className="grid g-2">
        {mc.artifacts.map((a, i) => {
          const v = a.versions.find((x) => x.v === ver[a.id]) ?? a.versions[0];
          return (
            <motion.div key={a.id} className="glass-card hoverable result-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
              <div className="row" style={{ gap: 10 }}>
                {a.type === 'website' || a.type === 'screenshot' || a.type === 'image' ? <EvidenceThumb seed={a.name} w={74} h={48} /> : <ArtifactIcon a={a} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b className="ellipsis" style={{ display: 'block' }}>{a.name}</b>
                  <div className="row" style={{ gap: 6, fontSize: 11.5 }}>
                    <span className="dim" style={{ textTransform: 'capitalize' }}>{a.type}</span>
                    {v.verified ? <Chip hue={145} size="sm" icon={BadgeCheck}>verified</Chip> : <Chip hue={38} size="sm">pending QA</Chip>}
                  </div>
                </div>
                <select className="select" style={{ width: 92, height: 30 }} value={v.v} onChange={(e) => setVer({ ...ver, [a.id]: e.target.value })} aria-label={`Version of ${a.name}`}>
                  {a.versions.map((x, k) => <option key={x.v} value={x.v}>{x.v}{k === 0 ? ' (latest)' : ''}</option>)}
                </select>
              </div>
              <div className="mono dim ellipsis" style={{ fontSize: 10.5, margin: '8px 0 4px' }}>{v.hash} · {v.size} · {ago(v.agoMin)} by {AGENT_BY_ID[v.by]?.name}</div>
              <div className="dim" style={{ fontSize: 12 }}>{v.notes}</div>
              <div className="row" style={{ gap: 4, marginTop: 8 }}>
                <IconButton icon={Eye} label="Preview" size="sm" onClick={() => openDialog('artifact-preview', { missionId: m.id, artifactId: a.id, version: v.v })} />
                <IconButton icon={History} label="All versions" size="sm" onClick={() => openDialog('artifact-versions', { missionId: m.id, artifactId: a.id })} />
                <IconButton icon={GitCompare} label="Compare versions" size="sm" disabled={a.versions.length < 2} onClick={() => openDialog('compare-versions', { missionId: m.id, artifactId: a.id })} />
                {a.runnable && <IconButton icon={PlayCircle} label="Run in safe preview" size="sm" onClick={() => openDialog('artifact-run', { missionId: m.id, artifactId: a.id, version: v.v })} />}
                <HelpTrigger k="artifact.execute" />
                <span className="spacer" />
                <button className="btn sm" onClick={() => { downloadBlob(`${a.name.replace(/[^\w.-]+/g, '_')}-${v.v}.manifest.json`, JSON.stringify({ artifact: a.id, name: a.name, version: v.v, sha256: v.hash, size: v.size, mission: m.id, createdBy: v.by, verified: v.verified, note: 'DEMO manifest — artifact bytes are produced by the backend in Stage 8' }, null, 2)); toast({ tone: 'success', title: `Downloaded ${a.name} ${v.v}`, body: 'Manifest with checksum (demo bytes).' }); }}>
                  <Download size={14} />{v.v}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function ApprovalsTab({ m }: { m: Mission }) {
  const decisions = useData((s) => s.approvalDecisions);
  const list = allApprovals([m], decisions);
  const pend = list.filter((a) => a.status === 'pending');
  const done = list.filter((a) => a.status !== 'pending');
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}><Gavel size={16} className="warn" /><b>Pending ({pend.length})</b><span className="dim" style={{ fontSize: 12 }}>Sorted by risk and deadline. Each decision is bound to one exact action.</span></div>
      {pend.length === 0 && <EmptyState icon={ShieldCheck} title="Nothing waiting for you" body="Agents ask here before consequential actions such as publishing, submitting forms or new website origins." />}
      <AnimatePresence>{pend.map((a) => <motion.div key={a.id} layout exit={{ opacity: 0, x: 40 }}><ApprovalMini id={a.id} /></motion.div>)}</AnimatePresence>
      {done.length > 0 && <><div className="section-label" style={{ marginTop: 6 }}>Resolved</div>{done.map((a) => <ApprovalMini key={a.id} id={a.id} />)}</>}
    </div>
  );
}

function ReportsTab({ m }: { m: Mission }) {
  const mc = getMissionControl(m);
  const lead = AGENT_BY_ID[m.leadId];
  const [rev, setRev] = useState('r3');
  const claims = [
    { t: `${m.tasksVerified} of ${m.tasksTotal} tasks are independently verified.`, ev: mc.tasks.filter((t) => t.state === 'passed').slice(0, 2).map((t) => t.id) },
    { t: m.criteria.filter((c) => c.done).map((c) => c.text).join('; ') || 'No criteria met yet.', ev: ['T-evidence'] },
    { t: m.summary, ev: mc.timeline.slice(0, 2).map((e) => e.trace) },
  ];
  const md = `# ${m.title} — report ${rev}\n\nLead: ${lead?.name}\nVerified progress: ${m.progress}%\n\n${claims.map((c, i) => `${i + 1}. ${c.t} [evidence: ${c.ev.join(', ')}]`).join('\n')}\n\nQA verdict: ${m.status === 'completed' ? 'PASS' : 'PENDING'}\n`;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <FileText size={16} className="info" /><b>Lead synthesized report</b>
        <select className="select" style={{ width: 150, height: 30 }} value={rev} onChange={(e) => setRev(e.target.value)} aria-label="Report revision"><option value="r3">Revision 3 (latest)</option><option value="r2">Revision 2</option><option value="r1">Revision 1</option></select>
        <span className="spacer" />
        <button className="btn sm" onClick={() => downloadBlob(`${m.id}-report-${rev}.md`, md, 'text/markdown')}><FileDown size={14} />Markdown</button>
        <button className="btn sm" onClick={() => downloadBlob(`${m.id}-report-${rev}.json`, JSON.stringify({ mission: m.id, revision: rev, claims }, null, 2))}><FileJson size={14} />JSON</button>
        <button className="btn sm" onClick={() => { toast({ tone: 'info', title: 'Print to PDF', body: 'Use the browser print dialog → Save as PDF.' }); window.setTimeout(() => window.print(), 300); }}><FileDown size={14} />PDF</button>
      </div>
      <div className="report-doc">
        <div className="row" style={{ gap: 10 }}><RobotAvatar role={lead?.role ?? 'manager'} size={40} faceMode="face" /><div><b>{lead?.name}</b> → Luca (Owner)<div className="dim" style={{ fontSize: 12 }}>Executive result · {rev} · {ago(m.summaryAgoMin)}</div></div>
          <span className="spacer" /><div className={cx('qa-verdict', m.status === 'completed' ? 'pass' : m.status === 'failed' ? 'fail' : 'pending')}><ShieldCheck size={16} />QA {m.status === 'completed' ? 'PASS' : m.status === 'failed' ? 'FAIL' : 'PENDING'}</div></div>
        <div className="divider" />
        <ol className="claims">
          {claims.map((c, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .08 }}>
              <span>{c.t}</span>
              <span className="row wrap" style={{ gap: 4, marginTop: 4 }}>{c.ev.map((e) => <Tip key={e} label="Trace this claim to its evidence"><button className="chip sm" style={{ ['--h' as string]: 190, cursor: 'pointer' }} onClick={() => toast({ tone: 'info', title: `Evidence ${e}`, body: 'Linked event/task opened in Timeline (demo).' })}>⛓ {e}</button></Tip>)}</span>
            </motion.li>
          ))}
        </ol>
        <div className="divider" />
        <div className="section-label" style={{ marginBottom: 6 }}>Agent → manager deliveries</div>
        {mc.nodes.filter((n) => n.parent).map((n) => (
          <div key={n.instanceId} className="list-row">
            <RobotAvatar role={AGENT_BY_ID[n.agentId].role} size={26} /><span className="ellipsis grow" style={{ fontSize: 12.5 }}><b>{AGENT_BY_ID[n.agentId].name}</b> → {AGENT_BY_ID[mc.nodes.find((x) => x.instanceId === n.parent)!.agentId].name}: “{n.task}”</span>
            <InstanceStateChip state={n.state} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineTab({ m }: { m: Mission }) {
  const mc = getMissionControl(m);
  const [type, setType] = useState<TimelineEvent['type'] | 'all'>('all');
  const [actor, setActor] = useState('all');
  const evs = mc.timeline.filter((e) => (type === 'all' || e.type === type) && (actor === 'all' || e.actor === actor));
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <History size={16} className="info" /><b>Immutable timeline</b><span className="dim" style={{ fontSize: 12 }}>{evs.length} events</span>
        <span className="spacer" /><Filter size={14} className="dim" />
        <select className="select" style={{ width: 130, height: 30 }} value={type} onChange={(e) => setType(e.target.value as TimelineEvent['type'] | 'all')} aria-label="Filter by type">
          <option value="all">All types</option>{['create', 'delegate', 'browser', 'model', 'message', 'artifact', 'verify', 'report', 'approval'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="select" style={{ width: 150, height: 30 }} value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Filter by actor">
          <option value="all">All actors</option>{Array.from(new Set(mc.timeline.map((e) => e.actor))).map((a) => <option key={a} value={a}>{AGENT_BY_ID[a]?.name ?? 'Luca (Owner)'}</option>)}
        </select>
        <button className="btn sm" onClick={() => downloadBlob(`${m.id}-timeline.json`, JSON.stringify(evs, null, 2))}><Download size={14} />Export</button>
      </div>
      <div className="timeline">
        {evs.length === 0 && <EmptyState icon={Filter} title="No events match" body="Clear the filters to see the full log." />}
        {evs.map((e, i) => (
          <motion.div key={e.id} className="tl-item" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 15) * .025 }}>
            <span className="tl-time mono">{clock(e.agoMin)}</span>
            <span className="tl-node"><EventIcon type={e.type} /></span>
            <div className="tl-body">
              <div className="row" style={{ gap: 6 }}>{AGENT_BY_ID[e.actor] ? <RobotAvatar role={AGENT_BY_ID[e.actor].role} size={20} /> : <span className="human-av" style={{ width: 20, height: 20, fontSize: 8 }}>LU</span>}<span>{e.text}</span></div>
              <div className="row dim" style={{ gap: 10, fontSize: 11 }}><span>{ago(e.agoMin)}</span><span className="mono">{e.trace}</span><span style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{e.type}</span></div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

void ROLES;
