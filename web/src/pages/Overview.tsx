import { isAdmin, useMe } from '@/store/auth';
import { ServerHealth } from '@/features/ops/ServerHealth';
import { AnimatePresence, motion } from 'motion/react';
import { useAgentsCatalog } from '@/api/agents';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Briefcase, HeartPulse, Gauge, Plus, Rocket, Dna, ClipboardList, Users, Search, RefreshCw, Layers, CheckCircle2, ArrowRight, ArrowUpDown, GitBranch, ShieldCheck,
  AlertTriangle, BellRing, ChevronLeft, ChevronRight, Zap, Check, X, ClipboardCheck, Landmark } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCompanyKpis, CompanyScorecard } from '@/components/layout/CommandCenter';
import { TopBoard, FrameBody } from '@/components/layout/PageFrame';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Panel } from '@/components/ui/Panel';
import { IconButton } from '@/components/ui/IconButton';
import { Chip, MissionStatusChip } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import type { Approval, Mission, Priority } from '@/data/types';
import { useTab } from '@/hooks/useTab';
import { useFitCount } from '@/hooks/useFit';
import { useData, allApprovals, useVisibleMissions } from '@/store/data';
import { GateNote, useGate } from '@/features/approvals/ApprovalBinding';
import { NeedsYou } from '@/features/attention/NeedsYou';
import { openDialog } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import '@/theme/pages/overview-org-agent.css';
import '@/theme/pages/overview-fit.css';

export default function OverviewPage() {
  const [tab, setTab, tabs] = useTab('overview');
  const ICONS = [Gauge, BellRing, Briefcase, Activity, HeartPulse];
  const kpis = useCompanyKpis();
  const admin = isAdmin(useMe());
  return (
    <div className="page ov-page">
      <TopBoard icon={Landmark} title="Company Command Center" help="overview.tabs" sub="Run, build, verify, evolve, and grow your AI company."
        actions={<button className="btn primary" onClick={() => openDialog('mission-create')}><Plus size={16} />New Mission</button>}
        kpis={kpis} aside={tab === 'Needs you' ? undefined : <CompanyScorecard />}
        tabs={{ tabs, value: tab, onChange: setTab, icons: ICONS, ariaLabel: 'Overview views' }}
        toolbar={<span>{{ Pulse: 'Live agents, mission pipeline and what needs you.', 'Needs you': 'One ranked list of what needs a person now, with the reason for each.', Portfolio: 'Every mission by stage, value and risk.', Activity: 'Company-wide event stream.', Health: 'Services, models and dependencies.' }[tab]}</span>} />
      <FrameBody tab={tab} panel={false} className="col fb-gap ov-body">
        {tab === 'Pulse' && <Pulse />}
        {tab === 'Needs you' && <NeedsYou />}
        {tab === 'Portfolio' && <Portfolio />}
        {tab === 'Activity' && <ActivityStream />}
        {tab === 'Health' && (admin ? <ServerHealth /> : <Panel title="Server health">Administrator access is required to view server health.</Panel>)}
      </FrameBody>
    </div>
  );
}

const PIPE: { key: string; label: string; icon: LucideIcon; hue: number; match: (m: Mission) => boolean }[] = [
  { key: 'plan', label: 'Plan', icon: ClipboardList, hue: 200, match: (m) => m.status === 'planning' || m.status === 'draft' },
  { key: 'execute', label: 'Execute', icon: Rocket, hue: 145, match: (m) => m.status === 'running' },
  { key: 'verify', label: 'Verify', icon: ShieldCheck, hue: 175, match: (m) => m.status === 'verifying' || m.status === 'waiting' },
  { key: 'evolve', label: 'Evolve', icon: Dna, hue: 280, match: (m) => m.status === 'completed' },
  { key: 'sustain', label: 'Sustain', icon: RefreshCw, hue: 255, match: (m) => m.status === 'paused' || m.status === 'archived' },
];

/** The two quick icons of an Approval Queue row; they follow the server's canDecide flag and never offer a refused decision. */
function QueueDecide({ a, decide }: { a: Approval; decide: (id: string, d: 'approved' | 'denied') => void }) {
  const gate = useGate(a);
  return (
    <>
      {gate.blocked && <GateNote id={gate.id} text={gate.text} compact />}
      <IconButton icon={Check} label={gate.blocked ? `Approve: ${a.title} (${gate.text})` : `Approve: ${a.title}`} size="xs" variant="active" {...gate.bind(() => { decide(a.id, 'approved'); })} />
      <IconButton icon={X} label={gate.blocked ? `Deny: ${a.title} (${gate.text})` : `Deny: ${a.title}`} size="xs" variant="danger" {...gate.bind(() => { decide(a.id, 'denied'); })} />
    </>
  );
}

function Pulse() {
  const nav = useNavigate();
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const decide = useData((s) => s.decideApproval);
  const approvals = useMemo(() => allApprovals(missions, decisions).filter((a) => a.status === 'pending'), [missions, decisions]);
  const catalog = useAgentsCatalog();
  const strip = useMemo(() => AGENTS.slice(0, 12), [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = missions.filter((m) => m.status !== 'archived').length;
  const needs = useMemo(() => missions.filter((m) => m.pendingApprovals > 0 || m.blocked > 0), [missions]);
  const [stripRef, nStrip] = useFitCount(strip.length);
  const [needRef, nNeed] = useFitCount(needs.length);
  const [apprRef, nAppr] = useFitCount(approvals.length);

  return (
    <>
      <div className="oa-grid-2 ov-row r-big">
        <Panel icon={Users} title={<>Agent directory <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>({AGENTS.length})</span></>} help="overview.activeAgents" delay={.05}
          actions={<><button className="btn ghost sm" onClick={() => nav('/agents')}>View all<ArrowRight size={14} /></button></>}>
          <div className="ov-fill ov-strip-box"><div className="oa-strip" ref={stripRef}>
            {strip.slice(0, nStrip).map((a, i) => {
              const R = ROLES[a.role];
              return (
                <motion.button key={a.id} className="oa-agent glass-card hoverable" style={{ ['--h' as string]: R.hue }} onClick={() => nav(`/agents/${a.id}`)}
                  initial={{ opacity: 0, y: 12, scale: .94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .08 + i * .04, type: 'spring', stiffness: 300, damping: 24 }} aria-label={a.name}>
                  <RobotAvatar role={a.role} size={62} />
                  <b className="ellipsis">{a.name}</b>
                  <span className="dim ellipsis">{R.label}</span>
                </motion.button>
              );
            })}
          </div></div>
        </Panel>
        <Panel icon={GitBranch} title="Mission Pipeline" help="overview.pipeline" delay={.1} >
          <div className="oa-pipe">
            {PIPE.map((p, i) => {
              const n = missions.filter(p.match).length;
              return (
                <div key={p.key} className="row" style={{ gap: 4 }}>
                  <motion.button className="oa-pipe-node" style={{ ['--h' as string]: p.hue }} onClick={() => nav(`/missions?filter=${p.key === 'execute' || p.key === 'verify' ? 'active' : p.key === 'sustain' ? 'waiting' : 'all'}`)}
                    initial={{ opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .15 + i * .08, type: 'spring', stiffness: 320, damping: 20 }} aria-label={`${p.label}: ${n} missions`}>
                    <span className="oa-pipe-ico"><p.icon size={22} strokeWidth={1.8} /></span>
                    <b>{p.label}</b><span className="tnum">({n})</span>
                  </motion.button>
                  {i < PIPE.length - 1 && <span className="oa-pipe-arrow"><ArrowRight size={16} /><i /></span>}
                </div>
              );
            })}
          </div>
          <div className="oa-pipe-bar" aria-hidden title={`${total} missions across the company loop`}>
            {PIPE.map((p) => <motion.i key={p.key} style={{ ['--h' as string]: p.hue }} initial={{ flexGrow: 0 }} animate={{ flexGrow: missions.filter(p.match).length || .2 }} transition={{ duration: 1 }} />)}
          </div>
          <div className="dim ov-pipe-cap" style={{ fontSize: 12, margin: '6px 0 10px' }}>{total} missions across the company loop. Click a stage to filter Missions.</div>
          <div className="section-label row" style={{ marginBottom: 4, marginTop: 8 }}>Needs attention{needs.length > nNeed && <button className="oa-link-btn" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => nav('/missions?filter=waiting')}>+{needs.length - nNeed} more</button>}</div>
          <div className="col ov-fill" style={{ gap: 2 }} ref={needRef}>
            {needs.slice(0, nNeed).map((m) => (
              <button key={m.id} className="list-row oa-outcome" onClick={() => nav(`/missions/${m.id}`)}>
                <AlertTriangle size={15} className="warn" style={{ flex: 'none' }} />
                <span className="ellipsis" style={{ flex: 1, textAlign: 'left', fontSize: 13 }}>{m.title}</span>
                <span className="dim tnum" style={{ fontSize: 11.5 }}>{m.pendingApprovals} approvals · {m.blocked} blocked</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="oa-grid-2 ov-row">
        <Panel icon={ClipboardCheck} title="Approval Queue" help="overview.approvals" delay={.16} sub={`${approvals.length} pending${approvals.length > nAppr ? ` · ${nAppr} shown` : ''}`}
          actions={<button className="btn ghost sm" onClick={() => nav('/notifications?tab=pending')}>Open<ArrowRight size={14} /></button>}>
          {approvals.length === 0 ? <div className="ov-fill"><EmptyState icon={CheckCircle2} title="Nothing waiting" body="Approvals appear here when an agent needs your decision." /></div> : (
            <div className="col ov-fill" style={{ gap: 8 }} ref={apprRef}>
              <AnimatePresence initial={false}>
                {approvals.slice(0, nAppr).map((a) => (
                  <motion.div key={a.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30, height: 0 }} className="oa-appr">
                    <span className={cx('oa-risk', a.risk)} title={`${a.risk} risk`} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="ellipsis" style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                      <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{AGENT_BY_ID[a.agentId]?.name} · {a.missionId} · {ago(a.agoMin)}</div>
                    </div>
                    <QueueDecide a={a} decide={decide} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </Panel>

        <Panel icon={Zap} title="Quick Actions" help="overview.quick" delay={.24}>
          <div className="oa-quick ov-fill">
            {([
              [Plus, 'New Mission', () => openDialog('mission-create'), 268],
              [Rocket, 'Deploy Agent', () => openDialog('agent-create'), 200],
              [Dna, 'Evolve', () => nav('/agents?tab=development'), 290],
              [Users, 'Org Chart', () => nav('/agents?view=hierarchy'), 172],
              [Layers, 'Lineage', () => nav('/agents?tab=development'), 38],
            ] as [LucideIcon, string, () => void, number][]).map(([I, l, fn, h], i) => (
              <motion.button key={l} className="oa-quick-btn glass-card hoverable" style={{ ['--h' as string]: h }} onClick={fn} title={l} aria-label={l} initial={{ opacity: 0, scale: .85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .3 + i * .04 }}>
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
  const missions = useVisibleMissions();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [prio, setPrio] = useState('all');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'priority', dir: -1 });
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const val = (m: Mission): number | string => ({ id: m.id, title: m.title, status: m.status, owner: m.owner, priority: PRIO[m.priority], progress: m.progress, due: m.dueInDays }[sort.k]);
    return missions.filter((m) => m.status !== 'archived' || status === 'archived')
      .filter((m) => (status === 'all' || m.status === status) && (prio === 'all' || m.priority === prio) && (!q || (m.title + m.id + m.owner).toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [missions, q, status, prio, sort]);
  const [tableRef, per] = useFitCount(rows.length, { item: 'tbody tr', reserve: 'thead' });
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const pg = Math.min(page, pages - 1);
  useEffect(() => { setPage(0); }, [q, status, prio, sort]);
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
          <button className="btn primary" onClick={() => openDialog('mission-create')}><Plus size={16} />Start new</button>
        </div>
      }>
      {rows.length === 0 ? <EmptyState icon={Briefcase} title="No missions match" body="Clear a filter or start a new mission." action={<button className="btn" onClick={() => { setQ(''); setStatus('all'); setPrio('all'); }}>Clear filters</button>} /> : (
        <div className="table-wrap ov-fill ov-table-wrap" ref={tableRef}>
          <table className="table oa-table">
            <thead><tr>{th('id', 'ID')}{th('title', 'Mission')}{th('status', 'Status')}{th('owner', 'Owner')}{th('priority', 'Priority')}<th>Lead &amp; agents</th><th>Next decision</th>{th('progress', 'Verified progress')}{th('due', 'Due')}<th /></tr></thead>
            <tbody>
              {rows.slice(pg * per, pg * per + per).map((m, i) => {
                const nd = nextDecision(m);
                const lead = AGENT_BY_ID[m.leadId];
                return (
                  <motion.tr key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * .025 }} onClick={() => nav(`/missions/${m.id}`)} style={{ cursor: 'pointer' }} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') nav(`/missions/${m.id}`); }}>
                    <td className="mono dim">{m.id}</td>
                    <td style={{ maxWidth: 280 }}><div className="ellipsis" style={{ fontWeight: 600 }}>{m.title}</div><div className="dim ellipsis" style={{ fontSize: 11.5 }}>{m.lastEvent}</div></td>
                    <td><MissionStatusChip status={m.status} size="sm" /></td>
                    <td>{m.owner}</td>
                    <td><Chip hue={PRIO_HUE[m.priority]} size="sm">{m.priority}</Chip></td>
                    <td><span className="row" style={{ gap: 0 }}>{lead && <RobotAvatar role={lead.role} size={26} />}<span className="dim" style={{ fontSize: 11.5, marginLeft: 6 }}>+{m.agentIds.length - 1}</span></span></td>
                    <td><span className={cx('oa-next', nd.tone)}>{nd.tone === 'warn' && <AlertTriangle size={12} />}{nd.text}</span></td>
                    <td style={{ width: 150 }}><div className="row" style={{ gap: 6 }}><div className={cx('bar thin', m.status === 'failed' ? 'bad' : m.status === 'waiting' ? 'warn' : 'good')} style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${m.progress}%` }} transition={{ duration: .8, delay: .1 }} /></div><b className="tnum" style={{ fontSize: 12 }}>{m.progress}%</b></div></td>
                    <td className="tnum dim">{m.dueInDays < 0 ? 'done' : `${m.dueInDays}d`}</td>
                    <td><IconButton icon={ArrowRight} label={`Inspect ${m.id}`} size="xs" onClick={(e) => { e.stopPropagation(); nav(`/missions/${m.id}`); }} /></td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="ov-pager dim">
        <span>{rows.length} missions</span>
        <span className="spacer" />
        {pages > 1 && <>
          <span className="tnum">{pg * per + 1}–{Math.min(rows.length, pg * per + per)} of {rows.length}</span>
          <IconButton icon={ChevronLeft} label="Previous page" size="xs" disabled={pg === 0} onClick={() => setPage(pg - 1)} />
          <IconButton icon={ChevronRight} label="Next page" size="xs" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} />
        </>}
      </div>
    </Panel>
  );
}

/* ================================================================== */
/* ACTIVITY                                                            */
/* ================================================================== */
function ActivityStream() {
  const missions = useVisibleMissions();
  const nav = useNavigate();
  const rows = [...missions].filter(m => m.lastEvent).sort((a, b) => a.lastEventAgoMin - b.lastEventAgoMin);
  return <Panel icon={Activity} title="Latest mission activity" help="overview.activity">
    {rows.length === 0 ? <p>No mission activity has been recorded.</p> : rows.map(m => (
      <button className="list-row" key={m.id} onClick={() => nav('/missions/' + m.id + '?tab=timeline')}>
        <b>{m.title}</b><span>{m.lastEvent}</span><small>{ago(m.lastEventAgoMin)}</small>
      </button>
    ))}
  </Panel>;
}
