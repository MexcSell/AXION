import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Briefcase, HeartPulse, Gauge, Plus, Rocket, Dna, FileBarChart, ClipboardList, Users, Search, Pause, Play, RefreshCw,
  Server, Database, Cpu, Globe, Brain, Radio, Layers, CheckCircle2, ArrowRight, ArrowUpDown, GitBranch, MessageSquare, FileText, ShieldCheck,
  AlertTriangle, Sparkles, Zap, Check, X, Stethoscope, Lock, ClipboardCheck, Flag, Eye,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CommandCenter } from '@/components/layout/CommandCenter';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { Chip, MissionStatusChip, DemoTag, Dot } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tip } from '@/components/ui/Tip';
import { Segmented } from '@/components/ui/Form';
import { AreaChart, ColumnBars, Sparkline } from '@/components/viz/Charts';
import { AGENTS, AGENT_BY_ID, seeded } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { getMissionControl } from '@/data/missions';
import type { Mission, Priority, TimelineEvent } from '@/data/types';
import { useTab } from '@/hooks/useTab';
import { useData, allApprovals } from '@/store/data';
import { openDialog, toast } from '@/store/ui';
import { ago, cx, money } from '@/lib/format';
import '@/theme/pages/overview-org-agent.css';

export default function OverviewPage() {
  const [tab, setTab, tabs] = useTab('overview');
  const ICONS = [Gauge, Briefcase, Activity, HeartPulse];
  return (
    <div className="page">
      <CommandCenter />
      <motion.div className="oa-tabbar panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 }}>
        <Tabs tabs={tabs.map((t, i) => ({ key: t, label: t, icon: ICONS[i] }))} value={tab} onChange={setTab} ariaLabel="Overview views" />
        <HelpTrigger k="overview.tabs" />
        <span className="spacer" />
        <span className="dim oa-hide-sm" style={{ fontSize: 12 }}>Period</span>
        <PeriodSelect />
        <button className="btn primary" onClick={() => openDialog('mission-create')}><Plus size={16} />New Mission</button>
      </motion.div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} className="col" style={{ gap: 'var(--gap)' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab}>
          {tab === 'Pulse' && <Pulse />}
          {tab === 'Portfolio' && <Portfolio />}
          {tab === 'Activity' && <ActivityStream />}
          {tab === 'Health' && <Health />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function PeriodSelect() {
  const [p, setP] = useState('7d');
  return (
    <select className="select" style={{ width: 120 }} value={p} aria-label="Reporting period" onChange={(e) => { setP(e.target.value); toast({ tone: 'info', title: `Period set to ${e.target.value} (demo)`, body: 'KPIs keep the same demo figures.' }); }}>
      <option value="24h">Last 24h</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
    </select>
  );
}

/* ================================================================== */
/* PULSE                                                               */
/* ================================================================== */
const PIPE: { key: string; label: string; icon: LucideIcon; hue: number; match: (m: Mission) => boolean }[] = [
  { key: 'plan', label: 'Plan', icon: ClipboardList, hue: 200, match: (m) => m.status === 'planning' || m.status === 'draft' },
  { key: 'execute', label: 'Execute', icon: Rocket, hue: 145, match: (m) => m.status === 'running' },
  { key: 'verify', label: 'Verify', icon: ShieldCheck, hue: 175, match: (m) => m.status === 'verifying' || m.status === 'waiting' },
  { key: 'evolve', label: 'Evolve', icon: Dna, hue: 280, match: (m) => m.status === 'completed' },
  { key: 'sustain', label: 'Sustain', icon: RefreshCw, hue: 255, match: (m) => m.status === 'paused' || m.status === 'archived' },
];

function Pulse() {
  const nav = useNavigate();
  const missions = useData((s) => s.missions);
  const decisions = useData((s) => s.approvalDecisions);
  const decide = useData((s) => s.decideApproval);
  const approvals = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending'), [missions, decisions]);
  const strip = useMemo(() => AGENTS.filter((a) => a.id !== 'gm' && (a.status === 'active' || a.status === 'in-mission' || a.status === 'evolving')).slice(0, 12), []);
  const labels = useMemo(() => Array.from({ length: 14 }, (_, i) => `D-${13 - i}`), []);
  const comp = useMemo(() => { const r = seeded('ov-comp'); return Array.from({ length: 14 }, (_, i) => Math.round(18 + i * 1.6 + r() * 8)); }, []);
  const fail = useMemo(() => { const r = seeded('ov-fail'); return Array.from({ length: 14 }, () => Math.round(2 + r() * 4)); }, []);
  const outcomes = useMemo(() => {
    const ev: (TimelineEvent & { m: Mission })[] = missions.flatMap((m) => getMissionControl(m).timeline.filter((e) => e.type === 'verify').map((e) => ({ ...e, m })));
    return ev.sort((a, b) => a.agoMin - b.agoMin).slice(0, 5);
  }, [missions]);
  const total = missions.filter((m) => m.status !== 'archived').length;

  return (
    <>
      <div className="oa-grid-2">
        <Panel icon={Users} title={<>Active Agents <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>({AGENTS.filter((a) => a.status !== 'idle').length})</span></>} help="overview.activeAgents" delay={.05}
          actions={<button className="btn ghost sm" onClick={() => nav('/agents')}>View all<ArrowRight size={14} /></button>}>
          <div className="oa-strip">
            {strip.map((a, i) => {
              const R = ROLES[a.role];
              return (
                <motion.button key={a.id} className="oa-agent glass-card hoverable" style={{ ['--h' as string]: R.hue }} onClick={() => nav(`/agents/${a.id}`)}
                  initial={{ opacity: 0, y: 12, scale: .94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .08 + i * .04, type: 'spring', stiffness: 300, damping: 24 }} aria-label={`${a.name}, ${a.status}`}>
                  <RobotAvatar role={a.role} size={62} animated={a.status === 'in-mission'} status={a.status === 'in-mission' ? 'violet' : 'good'} />
                  <b className="ellipsis">{a.name}</b>
                  <span className="dim ellipsis">{R.label}</span>
                  <span className="oa-agent-state"><Dot tone={a.status === 'in-mission' ? 'violet' : a.status === 'evolving' ? 'warn' : 'good'} pulse />{a.status === 'in-mission' ? 'In mission' : a.status === 'evolving' ? 'Evolving' : 'Active'}</span>
                </motion.button>
              );
            })}
          </div>
        </Panel>
        <Panel icon={GitBranch} title="Mission Pipeline" help="overview.pipeline" delay={.1} actions={<DemoTag />}>
          <div className="oa-pipe">
            {PIPE.map((p, i) => {
              const n = missions.filter(p.match).length;
              return (
                <div key={p.key} className="row" style={{ gap: 4 }}>
                  <motion.button className="oa-pipe-node" style={{ ['--h' as string]: p.hue }} onClick={() => nav(`/missions?tab=${p.key === 'plan' ? 'planning' : p.key === 'execute' ? 'active' : p.key === 'verify' ? 'active' : 'all'}`)}
                    initial={{ opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .15 + i * .08, type: 'spring', stiffness: 320, damping: 20 }} aria-label={`${p.label}: ${n} missions`}>
                    <span className="oa-pipe-ico"><p.icon size={22} strokeWidth={1.8} /></span>
                    <b>{p.label}</b><span className="tnum">({n})</span>
                  </motion.button>
                  {i < PIPE.length - 1 && <span className="oa-pipe-arrow"><ArrowRight size={16} /><i /></span>}
                </div>
              );
            })}
          </div>
          <div className="oa-pipe-bar" aria-hidden>
            {PIPE.map((p) => <motion.i key={p.key} style={{ ['--h' as string]: p.hue }} initial={{ flexGrow: 0 }} animate={{ flexGrow: missions.filter(p.match).length || .2 }} transition={{ duration: 1 }} />)}
          </div>
          <div className="dim" style={{ fontSize: 12, margin: '6px 0 10px' }}>{total} missions across the company loop. Click a stage to filter Missions.</div>
          <div className="section-label" style={{ marginBottom: 4 }}>Needs attention</div>
          <div className="col" style={{ gap: 2 }}>
            {missions.filter((m) => m.pendingApprovals > 0 || m.blocked > 0).slice(0, 3).map((m) => (
              <button key={m.id} className="list-row oa-outcome" onClick={() => nav(`/control/${m.id}`)}>
                <AlertTriangle size={15} className="warn" style={{ flex: 'none' }} />
                <span className="ellipsis" style={{ flex: 1, textAlign: 'left', fontSize: 13 }}>{m.title}</span>
                <span className="dim tnum" style={{ fontSize: 11.5 }}>{m.pendingApprovals} approvals · {m.blocked} blocked</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="oa-grid-4">
        <Panel icon={FileBarChart} title="Verified Completions" help="overview.completions" delay={.12} sub="14 days" actions={<DemoTag />}>
          <AreaChart h={168} labels={labels} series={[{ label: 'Verified', data: comp, color: 'var(--good)' }, { label: 'Rejected', data: fail, color: 'var(--warn)' }]} />
          <div className="row" style={{ gap: 14, marginTop: 6, fontSize: 12 }}>
            <span className="row" style={{ gap: 5 }}><i className="oa-key" style={{ background: 'var(--good)' }} />Verified <b>{comp.reduce((s, v) => s + v, 0)}</b></span>
            <span className="row" style={{ gap: 5 }}><i className="oa-key" style={{ background: 'var(--warn)' }} />Rejected <b>{fail.reduce((s, v) => s + v, 0)}</b></span>
          </div>
        </Panel>

        <Panel icon={ClipboardCheck} title="Approval Queue" help="overview.approvals" delay={.16} sub={`${approvals.length} pending`}
          actions={<button className="btn ghost sm" onClick={() => nav('/governance?tab=approvals')}>Open<ArrowRight size={14} /></button>}>
          {approvals.length === 0 ? <EmptyState icon={CheckCircle2} title="Nothing waiting" body="Approvals appear here when an agent needs your decision." /> : (
            <div className="col" style={{ gap: 8 }}>
              <AnimatePresence initial={false}>
                {approvals.slice(0, 4).map((a) => (
                  <motion.div key={a.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30, height: 0 }} className="oa-appr">
                    <span className={cx('oa-risk', a.risk)} title={`${a.risk} risk`} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="ellipsis" style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                      <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{AGENT_BY_ID[a.agentId]?.name} · {a.missionId} · {ago(a.agoMin)}</div>
                    </div>
                    <IconButton icon={Check} label={`Approve: ${a.title}`} size="xs" variant="active" onClick={() => { decide(a.id, 'approved'); toast({ tone: 'success', title: 'Approved (demo)', body: a.title }); }} />
                    <IconButton icon={X} label={`Deny: ${a.title}`} size="xs" variant="danger" onClick={() => { decide(a.id, 'denied'); toast({ tone: 'warning', title: 'Denied (demo)', body: a.title }); }} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {approvals.length > 4 && <span className="dim" style={{ fontSize: 12 }}>+{approvals.length - 4} more in Governance</span>}
            </div>
          )}
        </Panel>

        <Panel icon={ShieldCheck} title="Recent Verified Outcomes" help="overview.outcomes" delay={.2}>
          <div className="col" style={{ gap: 2 }}>
            {outcomes.map((e, i) => (
              <motion.button key={e.id} className="list-row oa-outcome" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .25 + i * .05 }} onClick={() => nav(`/control/${e.missionId}?tab=timeline`)}>
                <CheckCircle2 size={16} className="good" style={{ flex: 'none' }} />
                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <div className="ellipsis" style={{ fontSize: 13 }}>{e.text}</div>
                  <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{e.m.id} · {e.m.title}</div>
                </div>
                <span className="dim tnum" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{ago(e.agoMin)}</span>
              </motion.button>
            ))}
          </div>
        </Panel>

        <Panel icon={Zap} title="Quick Actions" help="overview.quick" delay={.24}>
          <div className="oa-quick">
            {([
              [Plus, 'New Mission', () => openDialog('mission-create'), 268],
              [Rocket, 'Deploy Agent', () => openDialog('agent-create'), 200],
              [Dna, 'Evolve', () => nav('/evolution'), 290],
              [FileBarChart, 'Report', () => toast({ tone: 'info', title: 'Executive report queued (demo)', body: 'A PDF with this week’s verified outcomes is prepared in Results.' }), 215],
              [Users, 'Org Chart', () => nav('/organization'), 172],
              [Layers, 'Knowledge', () => nav('/knowledge'), 38],
            ] as [LucideIcon, string, () => void, number][]).map(([I, l, fn, h], i) => (
              <motion.button key={l} className="oa-quick-btn glass-card hoverable" style={{ ['--h' as string]: h }} onClick={fn} initial={{ opacity: 0, scale: .85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .3 + i * .04 }}>
                <I size={22} strokeWidth={1.8} /><span>{l}</span>
              </motion.button>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ================================================================== */
/* PORTFOLIO                                                           */
/* ================================================================== */
type SortKey = 'id' | 'title' | 'status' | 'owner' | 'priority' | 'progress' | 'due';
const PRIO: Record<Priority, number> = { critical: 4, high: 3, normal: 2, low: 1 };
const PRIO_HUE: Record<Priority, number> = { critical: 350, high: 30, normal: 205, low: 225 };

function nextDecision(m: Mission): { text: string; tone: 'warn' | 'good' | 'info' | 'dim' } {
  if (m.pendingApprovals > 0) return { text: `Approve ${m.pendingApprovals} request${m.pendingApprovals > 1 ? 's' : ''}`, tone: 'warn' };
  if (m.status === 'waiting') return { text: 'Owner decision needed', tone: 'warn' };
  if (m.status === 'verifying') return { text: 'Await QA verdict', tone: 'info' };
  if (m.status === 'planning') return { text: 'Review plan', tone: 'info' };
  if (m.status === 'completed') return { text: 'Promote learnings', tone: 'good' };
  if (m.status === 'paused') return { text: 'Resume or archive', tone: 'dim' };
  if (m.status === 'draft') return { text: 'Start mission', tone: 'dim' };
  return { text: `Next checkpoint in ${Math.max(1, m.dueInDays)}d`, tone: 'dim' };
}

function Portfolio() {
  const nav = useNavigate();
  const missions = useData((s) => s.missions);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [prio, setPrio] = useState('all');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'priority', dir: -1 });
  const [saved, setSaved] = useState<string[]>([]);
  const rows = useMemo(() => {
    const val = (m: Mission): number | string => ({ id: m.id, title: m.title, status: m.status, owner: m.owner, priority: PRIO[m.priority], progress: m.progress, due: m.dueInDays }[sort.k]);
    return missions.filter((m) => m.status !== 'archived' || status === 'archived')
      .filter((m) => (status === 'all' || m.status === status) && (prio === 'all' || m.priority === prio) && (!q || (m.title + m.id + m.owner).toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [missions, q, status, prio, sort]);
  const th = (k: SortKey, label: string) => (
    <th><button className="oa-th" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))} aria-label={`Sort by ${label}`}>{label}<ArrowUpDown size={11} className={sort.k === k ? 'accent-on' : 'dim'} /></button></th>
  );
  return (
    <Panel icon={Briefcase} titleSize="lg" title="Mission Portfolio" help="overview.portfolio" sub="Every mission, its owner, priority and the next decision it needs." delay={.05}
      actions={
        <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <div className="input-wrap" style={{ width: 220 }}><Search size={15} /><input className="input" placeholder="Search missions..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search missions" /></div>
          <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {['planning', 'running', 'verifying', 'waiting', 'paused', 'completed', 'failed', 'draft'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="select" style={{ width: 130 }} value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Filter by priority">
            <option value="all">Any priority</option>{(['critical', 'high', 'normal', 'low'] as Priority[]).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="btn sm" onClick={() => { const n = `View ${saved.length + 1}: ${status}/${prio}${q ? `/"${q}"` : ''}`; setSaved([...saved, n]); toast({ tone: 'success', title: 'Filter saved (demo)', body: n }); }}><Flag size={14} />Save filter</button>
          <button className="btn primary" onClick={() => openDialog('mission-create')}><Plus size={16} />Start new</button>
        </div>
      }>
      {saved.length > 0 && <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>{saved.map((s) => <Chip key={s} hue={268} pill>{s}</Chip>)}</div>}
      {rows.length === 0 ? <EmptyState icon={Briefcase} title="No missions match" body="Clear a filter or start a new mission." action={<button className="btn" onClick={() => { setQ(''); setStatus('all'); setPrio('all'); }}>Clear filters</button>} /> : (
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table className="table oa-table">
            <thead><tr>{th('id', 'ID')}{th('title', 'Mission')}{th('status', 'Status')}{th('owner', 'Owner')}{th('priority', 'Priority')}<th>Lead &amp; team</th><th>Next decision</th>{th('progress', 'Verified progress')}{th('due', 'Due')}<th /></tr></thead>
            <tbody>
              {rows.map((m, i) => {
                const nd = nextDecision(m);
                const lead = AGENT_BY_ID[m.leadId];
                return (
                  <motion.tr key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * .025 }} onClick={() => nav(`/control/${m.id}`)} style={{ cursor: 'pointer' }} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') nav(`/control/${m.id}`); }}>
                    <td className="mono dim">{m.id}</td>
                    <td style={{ maxWidth: 280 }}><div className="ellipsis" style={{ fontWeight: 600 }}>{m.title}</div><div className="dim ellipsis" style={{ fontSize: 11.5 }}>{m.lastEvent}</div></td>
                    <td><MissionStatusChip status={m.status} size="sm" /></td>
                    <td>{m.owner}</td>
                    <td><Chip hue={PRIO_HUE[m.priority]} size="sm">{m.priority}</Chip></td>
                    <td><span className="row" style={{ gap: 0 }}>{lead && <RobotAvatar role={lead.role} size={26} />}<span className="dim" style={{ fontSize: 11.5, marginLeft: 6 }}>+{m.agentIds.length - 1}</span></span></td>
                    <td><span className={cx('oa-next', nd.tone)}>{nd.tone === 'warn' && <AlertTriangle size={12} />}{nd.text}</span></td>
                    <td style={{ width: 150 }}><div className="row" style={{ gap: 6 }}><div className={cx('bar thin', m.status === 'failed' ? 'bad' : m.status === 'waiting' ? 'warn' : 'good')} style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${m.progress}%` }} transition={{ duration: .8, delay: .1 }} /></div><b className="tnum" style={{ fontSize: 12 }}>{m.progress}%</b></div></td>
                    <td className="tnum dim">{m.dueInDays < 0 ? 'done' : `${m.dueInDays}d`}</td>
                    <td><IconButton icon={ArrowRight} label={`Inspect ${m.id}`} size="xs" onClick={(e) => { e.stopPropagation(); nav(`/control/${m.id}`); }} /></td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{rows.length} missions · total spend {money(rows.reduce((s, m) => s + m.cost, 0), 0)} of {money(rows.reduce((s, m) => s + m.budget, 0), 0)} budget</div>
    </Panel>
  );
}

/* ================================================================== */
/* ACTIVITY                                                            */
/* ================================================================== */
const EV_META: Record<TimelineEvent['type'], { icon: LucideIcon; hue: number; label: string }> = {
  create: { icon: Sparkles, hue: 268, label: 'Create' }, delegate: { icon: GitBranch, hue: 205, label: 'Delegation' }, browser: { icon: Globe, hue: 186, label: 'Browser' },
  model: { icon: Brain, hue: 290, label: 'Model' }, message: { icon: MessageSquare, hue: 215, label: 'Message' }, artifact: { icon: FileText, hue: 38, label: 'Artifact' },
  approval: { icon: ClipboardCheck, hue: 30, label: 'Approval' }, error: { icon: AlertTriangle, hue: 350, label: 'Error' }, release: { icon: Rocket, hue: 12, label: 'Release' },
  verify: { icon: ShieldCheck, hue: 145, label: 'Verify' }, report: { icon: FileBarChart, hue: 172, label: 'Report' },
};
type LiveEv = TimelineEvent & { live?: boolean };
const WINDOWS: Record<string, number> = { '1h': 60, '6h': 360, '24h': 1440, all: 1e9 };

function ActivityStream() {
  const nav = useNavigate();
  const missions = useData((s) => s.missions);
  const [paused, setPaused] = useState(false);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [win, setWin] = useState('24h');
  const [live, setLive] = useState<LiveEv[]>([]);
  const base = useMemo<LiveEv[]>(() => missions.flatMap((m) => getMissionControl(m).timeline).sort((a, b) => a.agoMin - b.agoMin), [missions]);

  useEffect(() => {
    if (paused) return;
    let n = 0;
    const kinds: TimelineEvent['type'][] = ['delegate', 'verify', 'message', 'browser', 'artifact', 'model', 'report'];
    const t = window.setInterval(() => {
      n++;
      const r = seeded('live' + n + live.length);
      const m = missions.filter((x) => ['running', 'verifying'].includes(x.status));
      if (!m.length) return;
      const mm = m[Math.floor(r() * m.length)];
      const actor = mm.agentIds[Math.floor(r() * mm.agentIds.length)];
      const type = kinds[Math.floor(r() * kinds.length)];
      const nm = AGENT_BY_ID[actor]?.name ?? actor;
      const text = { delegate: `${nm} accepted a delegated task`, verify: `${nm} verification passed (evidence x2)`, message: `${nm} sent a progress report upward`, browser: `${nm} captured a screenshot (granted origin)`, artifact: `${nm} uploaded artifact version`, model: `${nm} model call, 1.8k tokens`, report: `${nm} submitted a checkpoint report` }[type as 'delegate'] ?? nm;
      setLive((l) => [{ id: `live-${Date.now()}-${n}`, agoMin: 0, actor, type, text, missionId: mm.id, trace: `tr_live_${n}`, live: true }, ...l].slice(0, 30));
    }, 3500);
    return () => window.clearInterval(t);
  }, [paused, missions, live.length]);

  const all = useMemo(() => [...live, ...base], [live, base]);
  const list = all.filter((e) => (types.size === 0 || types.has(e.type)) && e.agoMin <= WINDOWS[win]).slice(0, 60);
  const counts = useMemo(() => { const c: Record<string, number> = {}; all.forEach((e) => { c[e.type] = (c[e.type] ?? 0) + 1; }); return c; }, [all]);
  const toggle = (k: string) => setTypes((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="oa-grid-act">
      <Panel icon={Radio} titleSize="lg" title="Live Activity" help="overview.activity" delay={.05}
        sub={<span className="row" style={{ gap: 6 }}><Dot tone={paused ? 'muted' : 'good'} pulse={!paused} />{paused ? 'Paused' : 'Streaming'}</span>}
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
            <Segmented ariaLabel="Time window" size="sm" value={win} onChange={setWin} options={[{ key: '1h', label: '1h' }, { key: '6h', label: '6h' }, { key: '24h', label: '24h' }, { key: 'all', label: 'All' }]} />
            <button className={cx('btn', paused ? 'primary' : '')} onClick={() => { setPaused(!paused); toast({ tone: 'info', title: paused ? 'Live feed resumed' : 'Live feed paused', body: paused ? undefined : 'New events are held until you resume.' }); }} aria-pressed={paused}>
              {paused ? <><Play size={15} />Resume</> : <><Pause size={15} />Pause live</>}
            </button>
            <DemoTag />
          </div>
        }>
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          <button className={cx('oa-filter', types.size === 0 && 'on')} onClick={() => setTypes(new Set())}>All <b>{all.length}</b></button>
          {Object.entries(EV_META).map(([k, v]) => (
            <button key={k} className={cx('oa-filter', types.has(k) && 'on')} style={{ ['--h' as string]: v.hue }} onClick={() => toggle(k)} aria-pressed={types.has(k)}><v.icon size={12} />{v.label}<b>{counts[k] ?? 0}</b></button>
          ))}
        </div>
        {list.length === 0 ? <EmptyState icon={Activity} title="No events in this window" body="Widen the time window or clear the type filters." action={<button className="btn" onClick={() => { setTypes(new Set()); setWin('all'); }}>Reset</button>} /> : (
          <div className="oa-stream">
            <AnimatePresence initial={false}>
              {list.map((e) => {
                const M = EV_META[e.type];
                const a = AGENT_BY_ID[e.actor];
                return (
                  <motion.div key={e.id} layout="position" initial={{ opacity: 0, x: -16, backgroundColor: 'rgba(var(--accent-2-rgb), .22)' }} animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(0,0,0,0)' }} exit={{ opacity: 0 }} transition={{ duration: .5 }} className="oa-ev" style={{ ['--h' as string]: M.hue }}>
                    <span className="oa-ev-ico"><M.icon size={15} /></span>
                    {a ? <RobotAvatar role={a.role} size={28} /> : <span className="oa-ev-sys"><Lock size={13} /></span>}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="ellipsis" style={{ fontSize: 13 }}>{e.text}{e.live && <Chip hue={145} size="sm" className="oa-live-chip">live</Chip>}</div>
                      <div className="dim mono ellipsis" style={{ fontSize: 11 }}>{e.missionId} · {e.trace}</div>
                    </div>
                    <Chip hue={M.hue} size="sm">{M.label}</Chip>
                    <span className="dim tnum" style={{ width: 62, textAlign: 'right', fontSize: 11.5 }}>{e.agoMin < 1 ? 'just now' : ago(e.agoMin)}</span>
                    <Tip label="Jump to source trace"><IconButton icon={Eye} label="Jump to source trace" size="xs" onClick={() => nav(`/control/${e.missionId}?tab=timeline`)} /></Tip>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </Panel>
      <div className="col" style={{ gap: 'var(--gap)' }}>
        <Panel icon={Activity} title="Events by type" help="overview.eventMix" delay={.1}>
          <ColumnBars data={Object.keys(EV_META).map((k) => counts[k] ?? 0)} labels={Object.keys(EV_META).map((k) => EV_META[k as TimelineEvent['type']].label.slice(0, 3))} h={120} color="var(--accent-2)" />
        </Panel>
        <Panel icon={Users} title="Most active agents" help="overview.topActors" delay={.14}>
          <div className="col" style={{ gap: 8 }}>
            {Object.entries(all.reduce<Record<string, number>>((c, e) => { if (AGENT_BY_ID[e.actor]) c[e.actor] = (c[e.actor] ?? 0) + 1; return c; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n], i, arr) => {
              const a = AGENT_BY_ID[id];
              return <button key={id} className="perf-row" onClick={() => nav(`/agents/${id}`)}><RobotAvatar role={a.role} size={26} /><span className="ellipsis" style={{ width: 96, textAlign: 'left' }}>{a.name}</span><span className="bar" style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${(n / arr[0][1]) * 100}%` }} transition={{ duration: .8, delay: i * .05 }} /></span><b className="tnum" style={{ width: 28, textAlign: 'right' }}>{n}</b></button>;
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================== */
/* HEALTH                                                              */
/* ================================================================== */
interface Svc { key: string; name: string; icon: LucideIcon; detail: string; base: number; unit: string; state: 'good' | 'warn' | 'bad'; uptime: string; admin?: boolean; }
const SERVICES: Svc[] = [
  { key: 'api', name: 'API gateway', icon: Server, detail: 'REST + event stream', base: 42, unit: 'ms', state: 'good', uptime: '99.98%' },
  { key: 'db', name: 'Database', icon: Database, detail: 'Primary + 1 replica', base: 8, unit: 'ms', state: 'good', uptime: '99.99%' },
  { key: 'workers', name: 'Job workers', icon: Cpu, detail: '12 of 12 online', base: 31, unit: 'ms', state: 'good', uptime: '99.9%' },
  { key: 'browser', name: 'Browser hosts', icon: Globe, detail: '3 of 4 healthy, 1 draining', base: 210, unit: 'ms', state: 'warn', uptime: '99.2%' },
  { key: 'models', name: 'Model gateway', icon: Brain, detail: '5 routes, 0 rate limited', base: 640, unit: 'ms', state: 'good', uptime: '99.7%' },
  { key: 'events', name: 'Event bus', icon: Radio, detail: 'Fan-out to 38 agents', base: 12, unit: 'ms', state: 'good', uptime: '99.99%' },
];

function Health() {
  const nav = useNavigate();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const refresh = () => { setBusy(true); window.setTimeout(() => { setTick((t) => t + 1); setBusy(false); toast({ tone: 'success', title: 'Health refreshed (demo)', body: 'Numbers are re-sampled from fixtures.' }); }, 700); };
  const data = useMemo(() => SERVICES.map((s) => { const r = seeded(s.key + tick); return { s, spark: Array.from({ length: 20 }, () => Math.round(s.base * (0.75 + r() * 0.5))), now: Math.round(s.base * (0.9 + r() * 0.2)) }; }), [tick]);
  const queues = useMemo(() => ['Missions', 'Browser', 'Models', 'Verify', 'Reports', 'Evolve'].map((k) => ({ k, v: Math.round(seeded(k + tick)() * 14) + 1 })), [tick]);
  const fresh = useMemo(() => ([['Mission events', 3], ['Agent heartbeats', 5], ['Browser snapshots', 28], ['Model usage', 48], ['Knowledge sync', 190]] as [string, number][]).map(([k, v]) => [k, Math.max(1, Math.round(v * (0.8 + seeded(k + tick)() * 0.4)))] as [string, number]), [tick]);
  return (
    <>
      <Panel icon={HeartPulse} titleSize="lg" title="System Health" help="overview.health" sub="Connectivity, freshness and queues for every service the company runs on." delay={.05}
        actions={<div className="row" style={{ gap: 8 }}><DemoTag />
          <button className="btn" onClick={() => toast({ tone: 'info', title: 'Diagnostics started (demo)', body: 'A full probe would run API, DB, worker, browser and model checks and attach a report.' })}><Stethoscope size={15} />Run diagnostics</button>
          <button className="btn primary" onClick={refresh} disabled={busy}><motion.span animate={{ rotate: busy ? 360 : 0 }} transition={{ repeat: busy ? Infinity : 0, duration: .8, ease: 'linear' }} style={{ display: 'inline-flex' }}><RefreshCw size={15} /></motion.span>{busy ? 'Refreshing' : 'Refresh'}</button></div>}>
        <div className="oa-svc-grid">
          {data.map(({ s, spark, now }, i) => (
            <motion.div key={s.key} className="subpanel glass-card hoverable oa-svc" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 + i * .05 }} style={{ ['--sc' as string]: `var(--${s.state})` }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="oa-svc-ico"><s.icon size={20} /></span>
                <div style={{ minWidth: 0 }}><b>{s.name}</b><div className="dim ellipsis" style={{ fontSize: 12 }}>{s.detail}</div></div>
                <span className="spacer" />
                <Chip hue={s.state === 'good' ? 145 : 38} solid size="sm">{s.state === 'good' ? 'Healthy' : 'Degraded'}</Chip>
              </div>
              <div className="row" style={{ marginTop: 10, justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div><div className="display tnum" style={{ fontSize: 24, fontWeight: 700 }}>{now}<span className="dim" style={{ fontSize: 13 }}> {s.unit}</span></div><div className="dim" style={{ fontSize: 11.5 }}>p50 latency · uptime {s.uptime}</div></div>
                <Sparkline data={spark} w={120} h={38} color={s.state === 'good' ? 'var(--good)' : 'var(--warn)'} />
              </div>
              <div className="row" style={{ marginTop: 10, gap: 6 }}>
                <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: `${s.name}: no incidents in 7 days (demo)` })}>History</button>
                <button className="btn sm ghost" onClick={() => toast({ tone: 'warning', title: 'Admin only', body: 'The raw service inspector needs the Admin role.' })}><Lock size={12} />Inspector</button>
              </div>
            </motion.div>
          ))}
        </div>
      </Panel>
      <div className="oa-grid-3">
        <Panel icon={Radio} title="Event Freshness" help="overview.freshness" delay={.12} sub="age of latest event">
          <div className="col" style={{ gap: 12 }}>
            {fresh.map(([k, v], i) => (
              <div key={k} className="row" style={{ gap: 10 }}>
                <Dot tone={v < 30 ? 'good' : v < 120 ? 'warn' : 'bad'} pulse={v < 30} />
                <span style={{ width: 130, fontSize: 13 }}>{k}</span>
                <div className={cx('bar thin', v < 30 ? 'good' : 'warn')} style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, 100 - Math.min(90, v / 2.2))}%` }} transition={{ duration: .9, delay: i * .06 }} /></div>
                <b className="tnum" style={{ width: 54, textAlign: 'right', fontSize: 12.5 }}>{v < 60 ? `${v}s` : `${Math.round(v / 60)}m`} ago</b>
              </div>
            ))}
          </div>
        </Panel>
        <Panel icon={Layers} title="Queue Depth" help="overview.queues" delay={.16} sub="jobs waiting">
          <ColumnBars data={queues.map((q) => q.v)} labels={queues.map((q) => q.k.slice(0, 4))} h={130} color="var(--accent)" />
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Total {queues.reduce((s, q) => s + q.v, 0)} jobs queued, oldest 14s. Browser queue is draining on one host.</div>
        </Panel>
        <Panel icon={ShieldCheck} title="Connectivity Checks" help="overview.connectivity" delay={.2}>
          <div className="col" style={{ gap: 4 }}>
            {[['Secure browser session', 'Linked', 'good'], ['Approved model provider', 'Connected', 'good'], ['GitHub integration', 'Token expires in 12d', 'warn'], ['Event stream (SSE)', 'Connected', 'good'], ['Backups', 'Last run 02:00 UTC', 'good']].map(([k, v, t]) => (
              <div key={k} className="list-row"><span style={{ flex: 1, fontSize: 13 }}>{k}</span><span className={t === 'good' ? 'good' : 'warn'} style={{ fontSize: 12, fontWeight: 600 }}>{v}</span></div>
            ))}
          </div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => nav('/operations')}>Open System Operations<ArrowRight size={14} /></button>
        </Panel>
      </div>
    </>
  );
}
