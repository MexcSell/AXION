import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Target, Plus, Search, Pencil, Trash2, Sparkles, Globe, Package, Users, Cpu, Clock3, CheckCircle2, MoreHorizontal, Play, Pause,
  Square, RotateCcw, Copy, ArrowUpDown, ListChecks, Gavel, FileText, ShieldCheck, ArchiveRestore, Inbox, Crown, LayoutTemplate,
  LayoutDashboard, Network, Workflow, Gauge, Share2, Lock, EyeOff, UserRound, MessagesSquare, History, PanelLeftClose, PanelLeftOpen, Archive, Pin, AlertTriangle, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { Tip } from '@/components/ui/Tip';
import { Menu } from '@/components/ui/Menu';
import { MissionStatusChip, Chip, Dot } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { CountUp } from '@/components/ui/CountUp';
import { useData, allApprovals, useVisibleMissions } from '@/store/data';
import { DemoTag } from '@/components/ui/Chips';
import { useAuth, useMe, isAdmin } from '@/store/auth';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { executorOf } from '@/features/mission/staffing';
import { ActivityTab } from '@/features/mission/ActivityTab';
import { openDialog, toast } from '@/store/ui';
import { useTab } from '@/hooks/useTab';
import { Splitter, usePaneWidth } from '@/components/ui/Splitter';
import { MISSION_FILTERS, slug } from '@/config/nav';
import { missionTotals, fmtTokens, fmtMin } from '@/data/activity';
import { AGENT_BY_ID } from '@/data/agents';
import { getMissionControl } from '@/data/missions';
import { MISSION_STATUS, TONE_VAR } from '@/data/roles';
import type { Mission } from '@/data/types';
import { ago, cx } from '@/lib/format';
import { KindIcon, ProgressRing, KIND_META } from '@/features/mission/MissionBits';
import { HierarchyGraph } from '@/features/mission/HierarchyGraph';
import { Messenger } from '@/features/mission/Messenger';
import { MissionAgents } from '@/features/mission/MissionAgents';
import { TaskFlow } from '@/features/mission/TaskFlow';
import { BrowserMini } from '@/features/mission/BrowserMini';
import { OverviewTab, ResultsTab, ApprovalsTab, ReportsTab, TimelineTab } from '@/features/mission/WorkspaceTabs';
import '@/theme/pages/missions.css';
import '@/theme/pages/mission-control.css';

/*
 * Missions — the mission list and Mission Control merged into one workspace (owner request 2026-11-20):
 *   left   mission list (filters, search, sort) — nothing unfolds below a mission any more (owner 2026-11-20 (c))
 *   main   the selected mission's header, controls and the nine Mission Control tabs (?tab=)
 *          · Conversations = mission agents | partners | thread (agent picked here, ?agent=)
 *          · Hierarchy     = graph | conversation of the selected agent
 *   There is no page-wide conversation pane; every divider between panes is draggable (components/ui/Splitter).
 * URL: /missions/:id?tab=&agent=&filter=   (old /control/:id and /missions?m= links still resolve)
 */

const FILTER_META: Record<string, { test: (m: Mission) => boolean; icon: typeof Target; color: string; label: string }> = {
  All: { test: (m) => m.status !== 'archived', icon: ListChecks, color: '#38bdf8', label: 'All' },
  Active: { test: (m) => ['running', 'planning', 'verifying'].includes(m.status), icon: Play, color: '#2ee98a', label: 'Active' },
  Waiting: { test: (m) => ['waiting', 'paused'].includes(m.status) || m.pendingApprovals > 0, icon: Gavel, color: '#fbbf24', label: 'Waiting' },
  Completed: { test: (m) => m.status === 'completed' || m.status === 'failed', icon: CheckCircle2, color: '#a78bfa', label: 'Done' },
  Archived: { test: (m) => m.status === 'archived', icon: Archive, color: '#94a3b8', label: 'Archived' },
};

const TAB_ICONS: Record<string, typeof Target> = {
  Overview: LayoutDashboard, Activity: Gauge, Hierarchy: Network, 'Task Flow': Workflow, Browser: Globe, Conversations: MessagesSquare,
  Results: Package, Approvals: Gavel, Reports: FileText, Timeline: History,
};

type Sort = 'recent' | 'priority' | 'progress' | 'due';
type Scope = 'all' | 'mine' | 'shared';
const PRIO = { critical: 0, high: 1, normal: 2, low: 3 };
const LIST_KEY = 'axion.missions.listCollapsed';

function readCollapsed() { try { return localStorage.getItem(LIST_KEY) === '1'; } catch { return false; } }
function writeCollapsed(v: boolean) { try { localStorage.setItem(LIST_KEY, v ? '1' : '0'); } catch { /* storage blocked: per-viewer convenience only */ } }

export default function MissionsPage() {
  const params = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const missions = useVisibleMissions();
  const decisions = useData((s) => s.approvalDecisions);
  const [tab, setTab, tabs] = useTab('missions');

  // list state ------------------------------------------------------------
  const legacyTab = sp.get('tab'); // old /missions?tab=active links meant the list filter
  const fslug = sp.get('filter') ?? (MISSION_FILTERS.some((f) => slug(f) === legacyTab) ? legacyTab : null);
  const filter = MISSION_FILTERS.find((f) => slug(f) === fslug) ?? 'All';
  const setFilter = (f: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('filter', slug(f)); if (MISSION_FILTERS.some((x) => slug(x) === n.get('tab'))) n.delete('tab'); return n; }, { replace: true });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [kind, setKind] = useState<Mission['kind'] | 'all'>('all');
  const me = useMe();
  const [scope, setScope] = useState<Scope>('all');
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const setCollapsed = (v: boolean) => { setCollapsedState(v); writeCollapsed(v); };

  const list = useMemo(() => {
    const f = FILTER_META[filter].test;
    const s = q.trim().toLowerCase();
    const inScope = (m: Mission) => scope === 'all' || (scope === 'mine' ? m.ownerId === me?.id : m.shared);
    const arr = missions.filter(f).filter(inScope).filter((m) => (kind === 'all' || m.kind === kind) && (!s || (m.title + m.id + m.summary + m.owner + m.content.text).toLowerCase().includes(s)));
    const sorter: Record<Sort, (a: Mission, b: Mission) => number> = {
      recent: (a, b) => a.lastEventAgoMin - b.lastEventAgoMin,
      priority: (a, b) => PRIO[a.priority] - PRIO[b.priority],
      progress: (a, b) => b.progress - a.progress,
      due: (a, b) => a.dueInDays - b.dueInDays,
    };
    return [...arr].sort(sorter[sort]);
  }, [missions, filter, q, sort, kind, scope, me?.id]);

  // selection -------------------------------------------------------------
  const wantedId = params.id ?? sp.get('m');
  const m = wantedId ? missions.find((x) => x.id === wantedId) : list[0];
  const hiddenFromMe = useData((s) => !!wantedId && !m && s.missions.some((x) => x.id === wantedId));
  const select = (id: string) => {
    const n = new URLSearchParams(sp); n.delete('agent'); n.delete('m');
    if (MISSION_FILTERS.some((x) => slug(x) === n.get('tab'))) n.delete('tab');
    const qs = n.toString();
    nav(`/missions/${id}${qs ? `?${qs}` : ''}`);
  };

  // Stage 5 (Review Focus #2): the open mission was made private or deleted by someone else → leave it with a toast
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id !== wantedId) return;
      toast({ tone: 'warning', title: `${id} is no longer available`, body: 'Its owner made it private, or it was deleted.' });
      nav('/missions', { replace: true });
    };
    window.addEventListener('axion:mission-gone', on);
    return () => window.removeEventListener('axion:mission-gone', on);
  }, [wantedId, nav]);

  const mc = m ? getMissionControl(m) : null;
  const agentParam = sp.get('agent');
  const agentId = m && mc ? (agentParam && mc.nodes.some((n) => n.agentId === agentParam) ? agentParam : m.leadId) : '';
  // pick an agent in place (Hierarchy / Conversations show its conversation beside them)
  const selectAgent = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('agent', id); return n; }, { replace: true });
  // elsewhere (Overview team dots, graph 💬): jump to Conversations with that agent
  const openChat = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('agent', id); n.set('tab', 'conversations'); return n; });
  const [listW, setListW, resetListW] = usePaneWidth('missions.list', 318);
  const [agentsW, setAgentsW, resetAgentsW] = usePaneWidth('conv.agents', 250);
  const [hierConvW, setHierConvW, resetHierConvW] = usePaneWidth('hier.conversation', 380);
  const pending = m ? allApprovals([m], decisions).filter((a) => a.status === 'pending').length : 0;

  return (
    <div className="page missions-page">
      <div className={cx('mw-grid', collapsed && 'list-collapsed')} style={{ ['--mw-list-w' as string]: `${listW}px` }}>
        <MissionList
          missions={missions} list={list} selected={m} onSelect={select}
          filter={filter} setFilter={setFilter} q={q} setQ={setQ} sort={sort} setSort={setSort} kind={kind} setKind={setKind} scope={scope} setScope={setScope}
          collapsed={collapsed} setCollapsed={setCollapsed}
        />
        {!collapsed && <Splitter pane="prev" width={listW} onChange={setListW} onReset={resetListW} min={260} maxFrac={.45} label="Resize mission list" className="mw-split" />}
        <div className="mw-main">
          {m ? (
            <>
              <MissionHeader key={m.id} m={m} />
              <div className="mc-tabs-row">
                <Tabs collapse tabs={tabs.map((t) => ({ key: t, label: t, icon: TAB_ICONS[t], count: t === 'Approvals' && pending ? pending : undefined }))} value={tab} onChange={setTab} ariaLabel="Mission workspace tabs" />
                <MissionControls key={m.id} m={m} />
              </div>
              <section className="panel mc-center">
                <AnimatePresence mode="wait">
                  <motion.div key={m.id + tab} className="fit-scroll" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab} style={{ height: '100%' }}>
                    {tab === 'Overview' && <OverviewTab m={m} onSelectAgent={openChat} />}
                    {tab === 'Activity' && <ActivityTab m={m} onOpenChat={openChat} />}
                    {tab === 'Hierarchy' && (
                      <div className="pane-split hier-split">
                        <div className="hier-graph-pane"><HierarchyGraph mission={m} selected={agentId} onSelect={selectAgent} onOpenChat={openChat} /></div>
                        <Splitter pane="next" width={hierConvW} onChange={setHierConvW} onReset={resetHierConvW} min={280} maxFrac={.5} label="Resize conversation pane" />
                        <aside className="hier-conv" style={{ ['--pane-w' as string]: `${hierConvW}px` }} aria-label="Conversation of the selected agent">
                          <AnimatePresence mode="wait">
                            <motion.div key={agentId} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: .2 }} style={{ height: '100%' }}>
                              <Messenger mission={m} agentId={agentId} layout="narrow" />
                            </motion.div>
                          </AnimatePresence>
                        </aside>
                      </div>
                    )}
                    {tab === 'Task Flow' && <TaskFlow mission={m} />}
                    {tab === 'Browser' && <BrowserMini mission={m} />}
                    {tab === 'Conversations' && (
                      <div className="pane-split conv-split">
                        <aside className="conv-agents" style={{ ['--pane-w' as string]: `${agentsW}px` }} aria-label="Mission agents">
                          <MissionAgents m={m} agentId={agentId} onSelectAgent={selectAgent} onOpenGraph={() => setTab('Hierarchy')} />
                        </aside>
                        <Splitter pane="prev" width={agentsW} onChange={setAgentsW} onReset={resetAgentsW} min={180} maxFrac={.32} label="Resize mission agents" />
                        <div className="conv-main"><Messenger mission={m} agentId={agentId} layout="wide" /></div>
                      </div>
                    )}
                    {tab === 'Results' && <ResultsTab m={m} />}
                    {tab === 'Approvals' && <ApprovalsTab m={m} />}
                    {tab === 'Reports' && <ReportsTab m={m} />}
                    {tab === 'Timeline' && <TimelineTab m={m} />}
                  </motion.div>
                </AnimatePresence>
              </section>
            </>
          ) : (
            <Panel className="mw-empty">
              {wantedId
                ? hiddenFromMe ? <EmptyState icon={EyeOff} title={`Mission ${wantedId} is not shared with you`} body="Missions are visible to the user who added them and to administrators. Ask the owner to share it." action={<button className="btn primary" onClick={() => nav('/missions')}>Show my missions</button>} />
                : <EmptyState icon={Target} title={`Mission ${wantedId} not found`} body="It may have been purged, or the link is wrong." action={<button className="btn primary" onClick={() => nav('/missions')}>Show all missions</button>} />
                : <EmptyState icon={Target} title="No mission selected" body="Add a mission: write what you want and attach files. The General Manager staffs it." action={<button className="btn primary" onClick={() => openDialog('mission-create')}><Plus size={15} />Add Mission</button>} />}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Left column: mission list, the selected mission unfolds its team     */
/* ------------------------------------------------------------------ */
function MissionList({ missions, list, selected, onSelect, filter, setFilter, q, setQ, sort, setSort, kind, setKind, scope, setScope, collapsed, setCollapsed }: {
  scope: Scope; setScope: (s: Scope) => void;
  missions: Mission[]; list: Mission[]; selected?: Mission; onSelect: (id: string) => void;
  filter: string; setFilter: (f: string) => void; q: string; setQ: (v: string) => void; sort: Sort; setSort: (s: Sort) => void;
  kind: Mission['kind'] | 'all'; setKind: (k: Mission['kind'] | 'all') => void; collapsed: boolean; setCollapsed: (v: boolean) => void;
}) {
  const pinned = selected && !list.some((x) => x.id === selected.id) ? selected : undefined;
  const rows = pinned ? [pinned, ...list] : list;
  const counts = Object.fromEntries(MISSION_FILTERS.map((f) => [f, missions.filter(FILTER_META[f].test).length]));
  const me = useMe();

  // keep the selected mission (and its unfolded team) in view
  useEffect(() => {
    if (!selected) return;
    const t = window.setTimeout(() => document.querySelector(`.mw-list [data-mission="${selected.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 350);
    return () => window.clearTimeout(t);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (collapsed) {
    return (
      <motion.aside className="panel mw-list collapsed" aria-label="Missions" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
        <IconButton icon={PanelLeftOpen} label="Expand mission list" variant="bordered" onClick={() => setCollapsed(false)} />
        <IconButton icon={Plus} label="Add mission" variant="active" onClick={() => openDialog('mission-create')} />
        <div className="divider" style={{ width: '100%' }} />
        <div className="mw-rail" role="listbox" aria-label="Missions">
          {rows.map((m, i) => {
            const sel = m.id === selected?.id;
            const st = MISSION_STATUS[m.status];
            return (
              <div key={m.id} className="col" style={{ alignItems: 'center', gap: 4 }}>
                <Tip label={`${m.id} · ${m.title} — ${st.label}, ${m.progress}%`} side="right">
                  <motion.button role="option" aria-selected={sel} aria-label={`${m.id} ${m.title}`} data-mission={m.id} className={cx('mw-rail-item', sel && 'selected')} style={{ ['--tone' as string]: TONE_VAR[st.tone] }}
                    onClick={() => onSelect(m.id)} initial={{ opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i, 12) * .025 }}>
                    {sel && <motion.span layoutId="mw-rail-sel" className="mission-sel" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
                    <KindIcon kind={m.kind} size={36} />
                    <span className="mw-rail-dot" />
                    {m.pendingApprovals > 0 && <span className="badge mw-rail-badge">{m.pendingApprovals}</span>}
                  </motion.button>
                </Tip>
              </div>
            );
          })}
        </div>
      </motion.aside>
    );
  }

  return (
    <motion.aside className="panel mw-list" aria-label="Missions" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
      <div className="mw-list-head">
        <span className="page-header-icon mw-head-icon"><Target size={20} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 6 }}><h1 className="mw-title">Missions</h1><HelpTrigger k="missions.list" /></div>
          <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{counts.All} open · <span className="warn">96.4%</span> success rate</div>
        </div>
        <IconButton icon={LayoutTemplate} label="Mission templates" variant="bordered" size="sm" onClick={() => openDialog('mission-templates')} />
        <IconButton icon={Plus} label="Add mission" variant="active" size="sm" onClick={() => openDialog('mission-create')} />
        <IconButton icon={PanelLeftClose} label="Collapse mission list" size="sm" onClick={() => setCollapsed(true)} />
      </div>

      <div className="mw-filters" role="tablist" aria-label="Mission status filter">
        {MISSION_FILTERS.map((f, i) => {
          const meta = FILTER_META[f];
          const sel = f === filter;
          return (
            <Tip key={f} label={`${f} missions`}>
              <motion.button role="tab" aria-selected={sel} className={cx('mw-filter', sel && 'selected')} style={{ ['--kc' as string]: meta.color }} onClick={() => setFilter(f)}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }} whileTap={{ scale: .94 }}>
                {sel && <motion.span layoutId="mw-filter-sel" className="mw-filter-sel" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />}
                <meta.icon size={14} />
                <b className="tnum"><CountUp value={counts[f]} /></b>
                <span>{meta.label}</span>
              </motion.button>
            </Tip>
          );
        })}
      </div>

      <div className="row" style={{ gap: 6 }}>
        <div className="input-wrap grow"><Search size={15} /><input className="input" placeholder="Search missions…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search missions" /></div>
        <select className="select" style={{ width: 96 }} value={kind} onChange={(e) => setKind(e.target.value as Mission['kind'] | 'all')} aria-label="Filter by mission type">
          <option value="all">All types</option>
          {Object.entries(KIND_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <Menu
          trigger={<button className="icon-btn bordered sm" aria-label={`Sort: ${sort}`} title="Sort"><ArrowUpDown size={15} /></button>}
          items={(['recent', 'priority', 'progress', 'due'] as Sort[]).map((s) => ({ label: `Sort by ${s}${s === sort ? ' ✓' : ''}`, onSelect: () => setSort(s) }))}
        />
      </div>

      <div className="mw-scope" role="radiogroup" aria-label="Whose missions">
        {([['all', 'All', Target], ['mine', 'Mine', UserRound], ['shared', 'Shared', Share2]] as const).map(([k, l, I]) => (
          <button key={k} role="radio" aria-checked={scope === k} className={cx('mw-scope-btn', scope === k && 'on')} onClick={() => setScope(k)}>
            {scope === k && <motion.span layoutId="mw-scope-sel" className="mw-scope-sel" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />}
            <I size={13} /><span>{l}</span><b className="tnum">{k === 'all' ? missions.length : k === 'mine' ? missions.filter((x) => x.ownerId === me?.id).length : missions.filter((x) => x.shared).length}</b>
          </button>
        ))}
        <HelpTrigger k="mission.visibility" />
      </div>

      <div className="mission-list" role="listbox" aria-label="Missions">
        <LayoutGroup>
          <AnimatePresence initial={false}>
            {rows.map((m, i) => (
              <MissionRow key={m.id} m={m} index={i} selected={m.id === selected?.id} pinned={m === pinned} onSelect={() => onSelect(m.id)} />
            ))}
          </AnimatePresence>
        </LayoutGroup>
        {list.length === 0 && (
          <EmptyState icon={Inbox} title={q ? 'No missions match' : `No ${filter.toLowerCase()} missions`}
            body={filter === 'Archived' ? 'Archived missions appear here with their retention date.' : scope === 'shared' ? 'Nobody has shared a mission in this filter yet.' : 'Write what you want done and attach files. The General Manager staffs it.'}
            action={<button className="btn primary" onClick={() => openDialog('mission-create')}><Plus size={15} />Add Mission</button>} />
        )}
      </div>
    </motion.aside>
  );
}

/* ------------------------------------------------------------------ */
function MissionRow({ m, selected, pinned, onSelect, index }: {
  m: Mission; selected: boolean; pinned?: boolean; onSelect: () => void; index: number;
}) {
  const st = MISSION_STATUS[m.status];
  return (
    <motion.div layout className="mw-row-wrap" initial={{ opacity: 0, height: 0, y: -6 }} animate={{ opacity: 1, height: 'auto', y: 0 }}
      exit={{ opacity: 0, height: 0, x: -30, transition: { duration: .25 } }}
      transition={{ duration: .3, delay: Math.min(index, 10) * .03, layout: { type: 'spring', stiffness: 420, damping: 38 } }}>
      <div
        role="option"
        aria-selected={selected}
        tabIndex={0}
        className={cx('mission-row', selected && 'selected')}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
        style={{ ['--tone' as string]: TONE_VAR[st.tone] }}
        data-mission={m.id}
      >
        {selected && <motion.span layoutId="mission-sel" className="mission-sel" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
        <div className="mission-row-main">
          <KindIcon kind={m.kind} size={32} />
          <div className="mission-row-body">
            <div className="mission-title-line">
              <span className="mission-title ellipsis" title={m.title}>{m.title}</span>
              {m.demo && <DemoTag title="Sample mission from the prototype (DEMO). npm run demo:clear removes them." />}
              <Tip label="Edit mission">
                <button className="icon-btn xs edit-btn" aria-label={`Edit ${m.title}`} onClick={(e) => { e.stopPropagation(); openDialog('mission-edit', { missionId: m.id }); }}><Pencil size={13} /></button>
              </Tip>
              <span className="spacer" />
              {pinned && <Tip label="Shown because it is open — outside the current filter"><span className="dim mw-pin"><Pin size={12} /></span></Tip>}
              <Tip label={m.status === 'archived' ? 'Delete permanently' : 'Archive / delete mission'}>
                <button className="icon-btn xs danger del-btn" aria-label={`Delete ${m.title}`} onClick={(e) => { e.stopPropagation(); openDialog('mission-delete', { missionId: m.id }); }}><Trash2 size={13} /></button>
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
              <OwnerBadge m={m} />
              <span className="mono dim" style={{ fontSize: 11 }}>{m.id}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Who added the mission, and whether it is shared (owner update u1). */
function OwnerBadge({ m, size = 18 }: { m: Mission; size?: number }) {
  const owner = useAuth((s) => s.accounts.find((a) => a.id === m.ownerId));
  return (
    <Tip label={`Added by ${owner?.name ?? m.owner} · ${m.shared ? 'shared with all users' : 'private: owner and administrators'}`}>
      <span className="mw-owner">{owner ? <UserAvatar account={owner} size={size} /> : <UserRound size={12} />}{m.shared ? <Share2 size={11} className="info" /> : <Lock size={11} className="dim" />}</span>
    </Tip>
  );
}

/* lifecycle toolbar — sits at the right end of the tab row */
function MissionControls({ m }: { m: Mission }) {
  const setStatus = useData((s) => s.setMissionStatus);
  const running = ['running', 'planning', 'verifying'].includes(m.status);
  const closed = ['completed', 'archived', 'canceled'].includes(m.status);
  return (
    <div className="mc-controls mw-controls" role="toolbar" aria-label="Mission controls">
      <IconButton icon={Play} label={m.status === 'draft' ? 'Start' : 'Resume'} variant="bordered" disabled={running || closed} onClick={() => openDialog('mission-start', { missionId: m.id })} />
      <IconButton icon={Pause} label="Pause" variant="bordered" disabled={!running} onClick={() => openDialog('mission-pause', { missionId: m.id })} />
      <IconButton icon={RotateCcw} label="Retry from checkpoint" variant="bordered" disabled={closed} onClick={() => openDialog('mission-retry', { missionId: m.id })} />
      <IconButton icon={Square} label="Stop at safe boundary" variant="danger" className="bordered" disabled={closed} onClick={() => openDialog('mission-stop', { missionId: m.id })} />
      <Menu
        trigger={<button className="icon-btn bordered" aria-label="More mission actions"><MoreHorizontal size={17} /></button>}
        items={[
          { label: 'All conversations (thread picker)', icon: MessagesSquare, onSelect: () => openDialog('thread-picker', { missionId: m.id }) },
          { label: 'Edit mission', icon: Pencil, onSelect: () => openDialog('mission-edit', { missionId: m.id }) },
          { label: 'Clone as new draft', icon: Copy, onSelect: () => openDialog('mission-create', { cloneFrom: m.id }) },
          ...(m.status === 'archived'
            ? [{ label: 'Restore from archive', icon: ArchiveRestore, sep: true, onSelect: () => { setStatus(m.id, 'paused'); toast({ tone: 'success', title: `${m.id} restored`, body: 'Restored as paused. Nothing restarted automatically.' }); } }]
            : []),
          { label: m.status === 'archived' ? 'Delete permanently' : 'Archive / delete', icon: Trash2, danger: true, sep: m.status !== 'archived', onSelect: () => openDialog('mission-delete', { missionId: m.id }) },
        ]}
      />
      <HelpTrigger k="mission.controls" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Centre header: identity, agent activity, verified progress           */
/* ------------------------------------------------------------------ */
const HEAD_KEY = 'axion.missions.headerMin';
function readHeadMin() { try { return localStorage.getItem(HEAD_KEY) === '1'; } catch { return false; } }
function writeHeadMin(v: boolean) { try { localStorage.setItem(HEAD_KEY, v ? '1' : '0'); } catch { /* per-viewer convenience only */ } }

/** Mission header; folds to one compact row (owner 2026-11-20 (e): "the top must be able to minimize"). */
function MissionHeader({ m }: { m: Mission }) {
  const lead = AGENT_BY_ID[m.leadId];
  const exec = AGENT_BY_ID[executorOf(m) ?? ''];
  const me = useMe();
  const owner = useAuth((s) => s.accounts.find((a) => a.id === m.ownerId));
  const update = useData((s) => s.updateMission);
  const canShare = !!me && (me.id === m.ownerId || isAdmin(me));
  const toggleShare = () => { update(m.id, { shared: !m.shared, lastEvent: `${m.shared ? 'Unshared' : 'Shared with all users'} by ${me?.name}`, lastEventAgoMin: 0 }); toast({ tone: 'success', title: m.shared ? `${m.id} is private again` : `${m.id} is shared with all users`, body: m.shared ? 'Only the owner and administrators see it now.' : 'Every user can now see and follow it.' }); };
  const staffing = m.staffing && m.staffing.stage !== 'working' ? m.staffing : undefined;
  const shareBtn = <Tip label={canShare ? (m.shared ? 'Shared with all users — click to make it private' : 'Private — click to share with all users') : (m.shared ? 'Shared with all users' : 'Private: owner and administrators')}><button className={cx('mw-share', m.shared && 'on')} disabled={!canShare} onClick={toggleShare} aria-pressed={m.shared} aria-label={m.shared ? 'Shared with all users' : 'Private mission'}>{m.shared ? <Share2 size={13} /> : <Lock size={13} />}<span>{m.shared ? 'Shared' : 'Private'}</span></button></Tip>;
  const [min, setMinState] = useState(readHeadMin);
  const setMin = (v: boolean) => { setMinState(v); writeHeadMin(v); };
  const tone = m.status === 'failed' ? 'var(--bad)' : 'var(--accent-2)';
  const tot = missionTotals(m);
  const fold = <IconButton size="sm" icon={min ? ChevronsUpDown : ChevronsDownUp} label={min ? 'Expand mission header' : 'Minimize mission header'} onClick={() => setMin(!min)} aria-expanded={!min} className="mw-header-fold" />;
  if (min) return (
    <motion.section layout className="panel mc-header mw-header min" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} aria-label={`Mission ${m.id}`}>
      <KindIcon kind={m.kind} size={28} />
      <h2 className="mp-title ellipsis" title={m.title}>{m.title}</h2>
      <MissionStatusChip status={m.status} />
      <span className="mono dim nowrap mw-min-id">{m.id}</span>
      {staffing && <Chip hue={38} size="sm">staffing {staffing.joined}/{staffing.plan.length}</Chip>}
      <span className="spacer" />
      {shareBtn}
      <Tip label={`${fmtTokens(tot.tokens)} tokens · ${m.agentIds.length} agents · avg CPU ${tot.cpu}%`}>
        <span className="row nowrap mw-min-budget muted" style={{ gap: 4 }}><Cpu size={13} /><b className="tnum">{fmtTokens(tot.tokens)}</b></span>
      </Tip>
      <Tip label={`${m.progress}% verified progress`}><span><ProgressRing value={m.progress} size={30} stroke={3.5} tone={tone} /></span></Tip>
      {fold}
    </motion.section>
  );
  return (
    <motion.section layout className="panel mc-header mw-header" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} aria-label={`Mission ${m.id}`}>
      <KindIcon kind={m.kind} size={46} />
      <div className="mw-header-id">
        <div className="row wrap" style={{ gap: 8 }}>
          <h2 className="mp-title clamp-2" title={m.title}>{m.title}</h2>
          <MissionStatusChip status={m.status} />
          <Chip hue={m.priority === 'critical' ? 350 : m.priority === 'high' ? 30 : 220} size="sm">{m.priority}</Chip>
        </div>
        <div className="row wrap mw-header-meta">
          <span className="mono dim">{m.id} · rev {m.revision} · {m.version}</span>
          <Tip label="The General Manager appoints the mission's general executor"><span className="row" style={{ gap: 4 }}><Crown size={13} className="warn" /><b style={{ color: 'var(--text)' }}>{lead?.name}</b>{exec && exec.id !== lead?.id ? <><span className="dim">→</span><b style={{ color: 'var(--text)' }}>{exec.name}</b><span className="dim">executor</span></> : <span className="mono dim">{lead?.version}</span>}</span></Tip>
          <span className="row" style={{ gap: 5 }}>{owner && <UserAvatar account={owner} size={16} />}by {owner?.name ?? m.owner}</span>
          {shareBtn}
          {staffing && <span className="row warn" style={{ gap: 4, fontWeight: 700 }}><Sparkles size={13} />staffing {staffing.joined}/{staffing.plan.length}</span>}
          <span className="row" style={{ gap: 4 }}><Clock3 size={13} />{m.elapsedH} h · due {m.dueInDays >= 0 ? `in ${m.dueInDays} d` : `${-m.dueInDays} d ago`}</span>
          {m.blocked > 0 && <span className="row bad" style={{ gap: 4, fontWeight: 700 }}><AlertTriangle size={13} />{m.blocked} blocked</span>}
          <Tip label="Policy: prepare + gated execute — consequential actions need your approval"><span className="row good" style={{ gap: 4 }}><ShieldCheck size={13} />gated</span></Tip>
        </div>
      </div>
      <div className="mc-budget">
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}><span className="row muted nowrap" style={{ gap: 5 }}><Cpu size={13} />Activity<HelpTrigger k="mission.activity" /></span><b className="tnum">{fmtTokens(tot.tokens)} tok</b></div>
        <div className="bar info" style={{ marginTop: 6 }}><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, tot.cpu)}%` }} transition={{ duration: 1 }} /></div>
        <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{m.agentIds.length} agents · {fmtMin(tot.activeMin)} active · CPU {tot.cpu}%</div>
      </div>
      <div className="col" style={{ alignItems: 'center', gap: 2 }}>
        <ProgressRing value={m.progress} size={56} stroke={6} tone={tone} />
        <span className="row dim" style={{ gap: 3, fontSize: 10.5 }}>verified<HelpTrigger k="mission.progress.verified" /></span>
      </div>
      {fold}
    </motion.section>
  );
}

