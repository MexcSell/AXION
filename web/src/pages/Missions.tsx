import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Target, Plus, Search, Pencil, Trash2, Sparkles, Radar as RadarIcon, Globe, Package, Users, AlertTriangle, Wallet, Clock3,
  CheckCircle2, Circle, MoreHorizontal, Play, Pause, Square, RotateCcw, Copy, ArrowUpDown, ListChecks, Activity, Gavel,
  FileText, ShieldCheck, ArchiveRestore, Inbox, Crown, LayoutTemplate,
} from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { Tip } from '@/components/ui/Tip';
import { Menu } from '@/components/ui/Menu';
import { MissionStatusChip, Chip, DemoTag, Dot } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { CountUp } from '@/components/ui/CountUp';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { useData, allApprovals } from '@/store/data';
import { openDialog, toast } from '@/store/ui';
import { useTab } from '@/hooks/useTab';
import { AGENT_BY_ID } from '@/data/agents';
import { getMissionControl } from '@/data/missions';
import { MISSION_STATUS, TONE_VAR } from '@/data/roles';
import type { Mission } from '@/data/types';
import { ago, money, cx, clock } from '@/lib/format';
import { KindIcon, PhaseStepper, ProgressRing, KIND_META } from '@/features/mission/MissionBits';
import { EventIcon, ApprovalMini } from '@/features/mission/Shared';
import '@/theme/pages/missions.css';

const TAB_FILTER: Record<string, (m: Mission) => boolean> = {
  All: (m) => m.status !== 'archived',
  Active: (m) => ['running', 'planning', 'verifying'].includes(m.status),
  Waiting: (m) => ['waiting', 'paused'].includes(m.status) || m.pendingApprovals > 0,
  Completed: (m) => m.status === 'completed' || m.status === 'failed',
  Archived: (m) => m.status === 'archived',
};

type Sort = 'recent' | 'priority' | 'progress' | 'due';
const PRIO = { critical: 0, high: 1, normal: 2, low: 3 };

export default function MissionsPage() {
  const missions = useData((s) => s.missions);
  const [tab, setTab, tabs] = useTab('missions');
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [kind, setKind] = useState<Mission['kind'] | 'all'>('all');

  const list = useMemo(() => {
    const f = TAB_FILTER[tab] ?? TAB_FILTER.All;
    const s = q.trim().toLowerCase();
    const arr = missions.filter(f).filter((m) => (kind === 'all' || m.kind === kind) && (!s || (m.title + m.id + m.summary + m.owner).toLowerCase().includes(s)));
    const sorter: Record<Sort, (a: Mission, b: Mission) => number> = {
      recent: (a, b) => a.lastEventAgoMin - b.lastEventAgoMin,
      priority: (a, b) => PRIO[a.priority] - PRIO[b.priority],
      progress: (a, b) => b.progress - a.progress,
      due: (a, b) => a.dueInDays - b.dueInDays,
    };
    return [...arr].sort(sorter[sort]);
  }, [missions, tab, q, sort, kind]);

  const selId = sp.get('m') ?? list[0]?.id;
  const selected = missions.find((m) => m.id === selId) ?? list[0];
  const select = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('m', id); return n; });

  // keep a valid selection when filters change
  useEffect(() => { if (!sp.get('m') && list[0]) select(list[0].id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  const counts = Object.fromEntries(tabs.map((t) => [t, missions.filter(TAB_FILTER[t]).length]));
  const kpi = {
    total: missions.filter((m) => m.status !== 'archived').length,
    running: missions.filter(TAB_FILTER.Active).length,
    waiting: missions.filter((m) => m.status === 'waiting').length,
    done: missions.filter((m) => m.status === 'completed').length,
  };

  return (
    <div className="page missions-page">
      <motion.section className="panel missions-hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="row-3 wrap" style={{ rowGap: 10 }}>
          <span className="page-header-icon"><Target size={26} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="row"><h1 className="page-title">Missions</h1><HelpTrigger k="missions.list" /></div>
            <p className="page-sub">Define, run, and complete multi-agent missions to grow your AI company.</p>
          </div>
          <span className="spacer" />
          <div className="mini-kpis">
            {[
              { l: 'Total', v: kpi.total, i: ListChecks, c: '#38bdf8' },
              { l: 'In Progress', v: kpi.running, i: Play, c: '#2ee98a' },
              { l: 'Needs Decision', v: kpi.waiting, i: Gavel, c: '#fbbf24' },
              { l: 'Completed', v: kpi.done, i: CheckCircle2, c: '#a78bfa' },
              { l: 'Success Rate', v: 96.4, i: Sparkles, c: '#facc15', d: 1, s: '%' },
            ].map((k, i) => (
              <motion.div key={k.l} className="kpi mini" style={{ ['--kc' as string]: k.c }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 * i }}>
                <k.i size={22} className="kpi-ico" />
                <div><div className="kpi-val" style={{ fontSize: 20 }}><CountUp value={k.v} decimals={k.d} suffix={k.s} /></div><div className="kpi-label" style={{ fontSize: 12 }}>{k.l}</div></div>
              </motion.div>
            ))}
          </div>
          <button className="btn lg" onClick={() => openDialog('mission-templates')}><LayoutTemplate size={17} />Templates</button>
          <button className="btn primary lg" onClick={() => openDialog('mission-create')}><Plus size={18} />Add Mission</button>
        </div>
      </motion.section>

      <div className="missions-split">
        {/* ---------------- LEFT: mission list ---------------- */}
        <Panel className="mission-list-panel" icon={ListChecks} title={`Mission List (${list.length})`} help="missions.list" delay={.05}
          actions={<IconButton icon={Plus} label="Add mission" variant="bordered" size="sm" onClick={() => openDialog('mission-create')} />}>
          <Tabs tabs={tabs.map((t) => ({ key: t, label: t, count: counts[t] }))} value={tab} onChange={setTab} size="sm" ariaLabel="Mission status filter" />
          <div className="row" style={{ gap: 6, margin: '10px 0' }}>
            <div className="input-wrap grow"><Search size={15} /><input className="input" placeholder="Search missions…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search missions" /></div>
            <select className="select" style={{ width: 118 }} value={kind} onChange={(e) => setKind(e.target.value as Mission['kind'] | 'all')} aria-label="Filter by mission type">
              <option value="all">All types</option>
              {Object.entries(KIND_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <Menu
              trigger={<button className="icon-btn bordered sm" aria-label={`Sort: ${sort}`} title="Sort"><ArrowUpDown size={15} /></button>}
              items={(['recent', 'priority', 'progress', 'due'] as Sort[]).map((s) => ({ label: `Sort by ${s}${s === sort ? ' ✓' : ''}`, onSelect: () => setSort(s) }))}
            />
          </div>
          <div className="mission-list" role="listbox" aria-label="Missions">
            <LayoutGroup>
              <AnimatePresence initial={false}>
                {list.map((m, i) => <MissionRow key={m.id} m={m} index={i} selected={m.id === selected?.id} onSelect={() => select(m.id)} />)}
              </AnimatePresence>
            </LayoutGroup>
            {list.length === 0 && (
              <EmptyState icon={Inbox} title={q ? 'No missions match' : `No ${tab.toLowerCase()} missions`}
                body={tab === 'Archived' ? 'Archived missions appear here with their retention date.' : 'Create a mission with a clear outcome and success criteria.'}
                action={<button className="btn primary" onClick={() => openDialog('mission-create')}><Plus size={15} />Add Mission</button>} />
            )}
          </div>
        </Panel>

        {/* ---------------- RIGHT: selected mission progress ---------------- */}
        <AnimatePresence mode="wait">
          {selected ? <MissionProgress key={selected.id} m={selected} /> : (
            <Panel key="none"><EmptyState icon={Target} title="Select a mission" body="Its live progress, team and decisions appear here." /></Panel>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function MissionRow({ m, selected, onSelect, index }: { m: Mission; selected: boolean; onSelect: () => void; index: number }) {
  const st = MISSION_STATUS[m.status];
  return (
    <motion.div
      layout
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={cx('mission-row', selected && 'selected')}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      initial={{ opacity: 0, height: 0, y: -6 }}
      animate={{ opacity: 1, height: 'auto', y: 0 }}
      exit={{ opacity: 0, height: 0, x: -30, transition: { duration: .25 } }}
      transition={{ duration: .3, delay: Math.min(index, 10) * .03, layout: { type: 'spring', stiffness: 420, damping: 38 } }}
      style={{ ['--tone' as string]: TONE_VAR[st.tone] }}
      data-mission={m.id}
    >
      {selected && <motion.span layoutId="mission-sel" className="mission-sel" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
      <div className="mission-row-main">
        <KindIcon kind={m.kind} />
        <div className="mission-row-body">
          <div className="mission-title-line">
            <span className="mission-title ellipsis">{m.title}</span>
            <Tip label="Edit mission">
              <button className="icon-btn xs edit-btn" aria-label={`Edit ${m.title}`} onClick={(e) => { e.stopPropagation(); openDialog('mission-edit', { missionId: m.id }); }}>
                <Pencil size={13} />
              </button>
            </Tip>
            <span className="spacer" />
            <Tip label={m.status === 'archived' ? 'Delete permanently' : 'Archive / delete mission'}>
              <button className="icon-btn xs danger del-btn" aria-label={`Delete ${m.title}`} onClick={(e) => { e.stopPropagation(); openDialog('mission-delete', { missionId: m.id }); }}>
                <Trash2 size={13} />
              </button>
            </Tip>
          </div>
          <div className="mission-status-line">
            <span className="status-pill" style={{ color: TONE_VAR[st.tone] }}><Dot tone={st.tone === 'neutral' ? 'muted' : st.tone} pulse={m.status === 'running'} />{st.label}</span>
            <span className="dim">·</span>
            <span className="ellipsis muted" title={m.lastEvent}>{m.lastEvent}</span>
            <span className="dim nowrap" style={{ marginLeft: 'auto' }}>{ago(m.lastEventAgoMin)}</span>
          </div>
          <div className="mission-summary">
            <Sparkles size={12} className="violet" style={{ flex: 'none', marginTop: 3 }} />
            <span className="clamp-2">{m.summary}</span>
          </div>
          <div className="mission-meta">
            <div className={'bar thin ' + (m.status === 'failed' ? 'bad' : m.status === 'waiting' ? 'warn' : m.status === 'completed' ? 'good' : '')} style={{ flex: 1 }}>
              <motion.i initial={{ width: 0 }} animate={{ width: `${m.progress}%` }} transition={{ duration: .9, delay: .1 }} />
            </div>
            <span className="tnum" style={{ fontWeight: 700, fontSize: 12 }}>{m.progress}%</span>
            <span className="row dim" style={{ gap: 3, fontSize: 11.5 }}><Users size={12} />{m.agentIds.length}</span>
            {m.pendingApprovals > 0 && <span className="row warn" style={{ gap: 3, fontSize: 11.5, fontWeight: 700 }}><Gavel size={12} />{m.pendingApprovals}</span>}
            <span className="mono dim" style={{ fontSize: 11 }}>{m.id}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
function MissionProgress({ m }: { m: Mission }) {
  const nav = useNavigate();
  const [tab, setTab] = useState<'Progress' | 'Summary' | 'Recent Activity' | 'Decisions'>('Progress');
  const mc = getMissionControl(m);
  const decisions = useData((s) => s.approvalDecisions);
  const setStatus = useData((s) => s.setMissionStatus);
  const approvals = allApprovals([m], decisions);
  const lead = AGENT_BY_ID[m.leadId];
  const running = ['running', 'planning', 'verifying'].includes(m.status);
  const lastTs = useData((s) => s.lastEventAt);

  return (
    <motion.section className="panel mission-progress" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10, transition: { duration: .12 } }} transition={{ duration: .3 }}
      aria-label={`Progress of ${m.title}`}>
      <header className="mp-head">
        <KindIcon kind={m.kind} size={46} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <h2 className="mp-title">{m.title}</h2>
            <MissionStatusChip status={m.status} />
            <Chip hue={m.priority === 'critical' ? 350 : m.priority === 'high' ? 30 : 220} size="sm">{m.priority}</Chip>
            <span className="mono dim" style={{ fontSize: 12 }}>{m.id} · rev {m.revision} · {m.version}</span>
          </div>
          <div className="row" style={{ gap: 12, fontSize: 12.5, marginTop: 3 }}>
            <span className="muted row" style={{ gap: 5 }}><Crown size={13} className="warn" />Lead {lead?.name}</span>
            <span className="muted">Owner {m.owner}</span>
            <span className="muted">Due {m.dueInDays >= 0 ? `in ${m.dueInDays} d` : `${-m.dueInDays} d ago`}</span>
          </div>
        </div>
        <ProgressRing value={m.progress} size={58} tone={m.status === 'failed' ? 'var(--bad)' : 'var(--accent-2)'} />
        <HelpTrigger k="mission.progress.verified" />
        <div className="row" style={{ gap: 2 }}>
          {running
            ? <IconButton icon={Pause} label="Pause mission" variant="bordered" onClick={() => openDialog('mission-pause', { missionId: m.id })} />
            : m.status !== 'completed' && m.status !== 'archived' && <IconButton icon={Play} label={m.status === 'draft' ? 'Start mission' : 'Resume mission'} variant="bordered" onClick={() => openDialog('mission-start', { missionId: m.id })} />}
          <Menu
            trigger={<button className="icon-btn bordered" aria-label="More mission actions"><MoreHorizontal size={17} /></button>}
            items={[
              { label: 'Open Mission Control', icon: RadarIcon, onSelect: () => nav(`/control/${m.id}`) },
              { label: 'Edit mission', icon: Pencil, onSelect: () => openDialog('mission-edit', { missionId: m.id }) },
              { label: 'Retry from checkpoint', icon: RotateCcw, onSelect: () => openDialog('mission-retry', { missionId: m.id }) },
              { label: 'Clone as new draft', icon: Copy, onSelect: () => openDialog('mission-create', { cloneFrom: m.id }) },
              ...(m.status === 'archived'
                ? [{ label: 'Restore from archive', icon: ArchiveRestore, onSelect: () => { setStatus(m.id, 'paused'); toast({ tone: 'success', title: `${m.id} restored`, body: 'Restored as paused. Nothing restarted automatically.' }); } }]
                : [{ label: 'Stop at safe boundary', icon: Square, danger: true, sep: true, onSelect: () => openDialog('mission-stop', { missionId: m.id }) }]),
              { label: 'Archive / delete', icon: Trash2, danger: true, onSelect: () => openDialog('mission-delete', { missionId: m.id }) },
            ]}
          />
        </div>
      </header>

      <div className="mp-objective">
        <Target size={15} className="info" style={{ flex: 'none', marginTop: 2 }} />
        <div><b>Outcome:</b> <span className="muted">{m.objective}</span></div>
      </div>

      <div className="mp-stats">
        <Stat icon={CheckCircle2} label="Verified tasks" value={`${m.tasksVerified} / ${m.tasksTotal}`} tone="good" help="mission.progress.verified" />
        <Stat icon={AlertTriangle} label="Blocked" value={String(m.blocked)} tone={m.blocked ? 'bad' : 'muted'} />
        <Stat icon={Wallet} label="Cost / budget" value={`${money(m.cost)} / ${money(m.budget, 0)}`} tone="info" bar={m.cost / m.budget} />
        <Stat icon={Clock3} label="Elapsed" value={`${m.elapsedH} h`} tone="violet" />
      </div>

      <PhaseStepper phases={m.phases} />

      <Tabs tabs={(['Progress', 'Summary', 'Recent Activity', 'Decisions'] as const).map((t) => ({ key: t, label: t, count: t === 'Decisions' ? approvals.filter((a) => a.status === 'pending').length || undefined : undefined }))}
        value={tab} onChange={setTab} variant="underline" ariaLabel="Mission detail tabs" />

      <div className="mp-body">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} role="tabpanel" aria-label={tab}>
            {tab === 'Progress' && (
              <div className="mp-grid">
                <div className="subpanel">
                  <div className="section-label" style={{ marginBottom: 8 }}>Success criteria</div>
                  <div className="col" style={{ gap: 7 }}>
                    {m.criteria.length === 0 && <span className="dim">No criteria yet — add at least one before starting.</span>}
                    {m.criteria.map((c, i) => (
                      <motion.div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 13 }} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .05 }}>
                        {c.done ? <CheckCircle2 size={16} className="good" style={{ flex: 'none' }} /> : <Circle size={16} className="dim" style={{ flex: 'none' }} />}
                        <span style={{ color: c.done ? 'var(--text)' : 'var(--text-muted)' }}>{c.text}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
                <div className="subpanel">
                  <div className="row" style={{ marginBottom: 8 }}><span className="section-label">Delegation</span><span className="spacer" /><span className="dim" style={{ fontSize: 11.5 }}>{mc.nodes.length} instances</span></div>
                  <div className="team-strip">
                    {mc.nodes.map((n, i) => {
                      const a = AGENT_BY_ID[n.agentId];
                      return (
                        <Tip key={n.instanceId} label={`${a.name} — ${n.task}`}>
                          <motion.button className="team-dot" onClick={() => nav(`/control/${m.id}?tab=hierarchy&agent=${a.id}`)} initial={{ scale: .5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: .05 * i, type: 'spring', stiffness: 300, damping: 18 }}
                            aria-label={`${a.name}: ${n.task}`}>
                            <RobotAvatar role={a.role} size={40} status={n.state === 'working' ? 'good' : n.state === 'waiting' ? 'warn' : n.state === 'blocked' ? 'bad' : n.state === 'done' ? 'violet' : 'info'} />
                            <span className="ellipsis">{a.name}</span>
                          </motion.button>
                        </Tip>
                      );
                    })}
                  </div>
                </div>
                <div className="subpanel" style={{ gridColumn: '1 / -1' }}>
                  <div className="row" style={{ marginBottom: 6 }}>
                    <span className="section-label">Live events</span>
                    {running && <span className="row good" style={{ gap: 5, fontSize: 11.5, fontWeight: 700 }}><Dot tone="good" pulse />Live · last event {clock(0, lastTs)}</span>}
                    <span className="spacer" /><DemoTag />
                  </div>
                  <div className="col" style={{ gap: 2 }}>
                    {mc.timeline.slice(0, 5).map((e, i) => (
                      <motion.div key={e.id} className="event-row" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .04 }}>
                        <span className="mono dim" style={{ width: 44 }}>{clock(e.agoMin)}</span>
                        <EventIcon type={e.type} />
                        <span className="ellipsis grow">{e.text}</span>
                        <span className="mono dim" style={{ fontSize: 10.5 }}>{e.trace}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {tab === 'Summary' && (
              <div className="col" style={{ gap: 12 }}>
                <div className="ai-summary">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <Sparkles size={15} className="violet" /><b>AI summary</b><span className="dim" style={{ fontSize: 12 }}>· Updated {ago(m.summaryAgoMin)} · from {mc.timeline.length} recorded events</span>
                    <HelpTrigger k="mission.aiSummary" /><span className="spacer" />
                    <button className="btn sm ghost" onClick={() => openDialog('ai-summary', { missionId: m.id })}>Sources</button>
                  </div>
                  <p style={{ fontSize: 14.5, lineHeight: 1.6 }}>{m.summary}</p>
                </div>
                <div className="grid g-3">
                  {[['Plan', `${m.tasksTotal} tasks across ${m.phases.length} phases, staffed with ${m.agentIds.length} agents.`], ['Now', m.lastEvent + '.'], ['Next', m.pendingApprovals ? 'Waiting for your decision in Decisions.' : 'Continue current phase; QA verifies each task before it counts.']].map(([k, v]) => (
                    <div key={k} className="subpanel"><div className="section-label" style={{ marginBottom: 4 }}>{k}</div><div style={{ fontSize: 13 }}>{v}</div></div>
                  ))}
                </div>
              </div>
            )}
            {tab === 'Recent Activity' && (
              <div className="col" style={{ gap: 2 }}>
                {mc.timeline.map((e, i) => (
                  <motion.div key={e.id} className="event-row" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .025 }}>
                    <span className="mono dim" style={{ width: 44 }}>{clock(e.agoMin)}</span>
                    <EventIcon type={e.type} />
                    <span className="ellipsis grow">{e.text}</span>
                    <span className="dim nowrap" style={{ fontSize: 11.5 }}>{ago(e.agoMin)}</span>
                  </motion.div>
                ))}
              </div>
            )}
            {tab === 'Decisions' && (
              <div className="col" style={{ gap: 10 }}>
                {approvals.length === 0 && <EmptyState icon={ShieldCheck} title="No decisions needed" body="Agents will ask here before any consequential action." />}
                {approvals.map((a) => <ApprovalMini key={a.id} id={a.id} />)}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="mp-actions">
        <button className="btn primary" onClick={() => nav(`/control/${m.id}`)}><RadarIcon size={16} />Open Control</button>
        <button className="btn" onClick={() => nav(`/control/${m.id}?tab=browser`)}><Globe size={16} />Browser</button>
        <button className="btn" onClick={() => nav(`/control/${m.id}?tab=results`)}><Package size={16} />Results</button>
        <button className="btn" onClick={() => nav(`/control/${m.id}?tab=conversations`)}><Activity size={16} />Conversations</button>
        <button className="btn" onClick={() => nav(`/control/${m.id}?tab=reports`)}><FileText size={16} />Reports</button>
      </footer>
    </motion.section>
  );
}

function Stat({ icon: Icon, label, value, tone, bar, help }: { icon: typeof Target; label: string; value: string; tone: 'good' | 'bad' | 'info' | 'violet' | 'muted'; bar?: number; help?: string }) {
  return (
    <div className="mp-stat">
      <Icon size={18} style={{ color: tone === 'muted' ? 'var(--text-dim)' : `var(--${tone})` }} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 4 }}><span className="dim" style={{ fontSize: 11.5 }}>{label}</span>{help && <HelpTrigger k={help} />}</div>
        <div className="tnum" style={{ fontWeight: 800, fontSize: 15 }}>{value}</div>
        {bar != null && <div className="bar thin" style={{ marginTop: 3 }}><i style={{ width: `${Math.min(100, bar * 100)}%` }} /></div>}
      </div>
    </div>
  );
}

