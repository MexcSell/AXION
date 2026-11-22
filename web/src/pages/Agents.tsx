import { Lineage } from '@/features/agents/Lineage';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, LayoutGrid, List, Plus, Bot, Activity, MapPin, GraduationCap, Dna, Moon, Network, RefreshCcw, Box, Sparkles, Rocket,
  Gauge, ArrowRight, Trophy, Building2, ClipboardList, ScrollText, Lightbulb, GitBranch, Sprout, FlaskConical, CheckCircle2, Layers,
} from 'lucide-react';
import { BottomBoard, type KpiItem } from '@/components/layout/PageFrame';
import { AgentCard } from '@/components/agents/AgentCard';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { AgentStatusChip, InstanceStateChip, RoleChip, DemoTag } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tip } from '@/components/ui/Tip';
import { AGENTS, AGENT_BY_ID, DEV_LEVELS, EVO_PHASES } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { DEPTS } from '@/data/orgdemo';
import type { Agent, InstanceState } from '@/data/types';
import { useTab } from '@/hooks/useTab';
import { useVisibleMissions } from '@/store/data';
import { getMissionControl } from '@/data/missions';
import { useAgentsCatalog, useAgentInstances } from '@/api/agents';
import { useCanEditAgents } from '@/hooks/useCanEditAgents';
import { ProvenanceChip, needsEvidence, NOT_ENOUGH, provenanceOf } from '@/components/agents/Provenance';
import { ReliabilityChip } from '@/components/agents/Reliability';
import { isApi } from '@/api/mode';
import { useMissionControls } from '@/api/missionControl';
import { openDialog } from '@/store/ui';
import { cx } from '@/lib/format';
import { AgentHierarchy } from '@/features/agents/AgentHierarchy';
import { GrowthBadge, LevelPips, EvoTrack, GROWTH } from '@/features/agents/Growth';
import { Departments, Assignments, Policies, Proposals } from '@/features/agents/OrgSections';
import type { ProposalEvaluationDto } from '@contracts';
import { ServerDevelopment, EvaluationView } from '@/features/agents/VersionProposals';
import { PlaybookPanel } from '@/features/agents/Playbooks';
import { useVersionProposals } from '@/api/versionProposals';
import { useMentoringPlans } from '@/api/mentoring';

type Filter = 'all' | 'working' | 'in-mission' | 'idle' | 'learning' | 'evolving';
type View = 'cards' | 'list' | 'hierarchy';
const TAB_ICONS = [Bot, Sprout, GitBranch, Activity, Building2, ClipboardList, ScrollText, Lightbulb];
const TAB_NOTE: Record<string, string> = {
  Directory: 'One agent per role. Switch between cards, list and the zoomable hierarchy.',
  Development: 'Who is learning, who is evolving, and each agent’s development stage.',
  Lineage: 'Derived agents and how their knowledge flows: kept, shared up, inherited.',
  'Live Instances': 'Mission-scoped instances with pinned versions and current tasks.',
  Departments: 'Charter, head, capacity, skill coverage and KPIs.',
  Assignments: 'Agent workload per mission and conflicts.',
  Policies: 'Constitution, autonomy caps and delegation rules.',
  Proposals: 'Reorganizations: simulate, evaluate, approve, apply with rollback.',
};

/** Functions, not constants: in api mode the catalog arrives from the server after sign-in and changes live (Stage 6). */
const staff = () => AGENTS.filter((a) => a.id !== 'gm');
const match = (a: Agent, f: Filter) =>
  f === 'all' ? true : f === 'working' ? a.status === 'active' || a.status === 'in-mission' : f === 'learning' || f === 'evolving' ? a.growth === f : a.status === f;
const counts = (): Record<Filter, number> => { const st = staff(); return Object.fromEntries((['all', 'working', 'in-mission', 'idle', 'learning', 'evolving'] as Filter[]).map((f) => [f, st.filter((a) => match(a, f)).length])) as Record<Filter, number>; };

/** Old /agents links land in System Operations › Agents (owner update u1), keeping ?tab= as ?sub= and ?view=. */
export default function AgentsRedirect() {
  const [sp] = useSearchParams();
  const n = new URLSearchParams(sp);
  const t = n.get('tab'); n.delete('tab'); n.set('tab', 'agents'); if (t) n.set('sub', t);
  return <Navigate to={`/operations?${n.toString()}`} replace />;
}

/** Agents, embedded in System Operations: returns the frame parts (KPIs, actions, sub-tabs, body, bottom boards). */
export function useAgentsSection() {
  const [tab, setTab, tabs] = useTab('agents', 'sub');
  const [sp, setSp] = useSearchParams();
  const view: View = (['cards', 'list', 'hierarchy'] as View[]).find((v) => v === sp.get('view')) ?? 'cards';
  const setView = (v: View) => setSp((p) => { const n = new URLSearchParams(p); n.set('view', v); return n; });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const nav = useNavigate();

  const catalog = useAgentsCatalog();
  const STAFF = useMemo(() => staff(), [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const COUNTS = useMemo(() => counts(), [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = useCanEditAgents();
  // improvement cycle 5: in api mode the Development tab counts pending version proposals (the server's), not fixture growth
  const vp = useVersionProposals();
  const mp = useMentoringPlans();
  // api mode (cycle 19): Learning = agents with an active mentoring plan, Evolving = agents with a pending version proposal (both from the server)
  const learningN = isApi() ? new Set((mp.data ?? []).filter((p) => p.status === 'active').map((p) => p.menteeId)).size : COUNTS.learning;
  const evolvingN = isApi() ? new Set((vp.data ?? []).filter((p) => p.status === 'pending').map((p) => p.agentId)).size : COUNTS.evolving;
  const devCount = isApi() ? (vp.data ?? []).filter((p) => p.status === 'pending').length + (mp.data ?? []).filter((p) => p.status === 'active').length : COUNTS.learning + COUNTS.evolving;
  // api mode: an agent whose numbers are measured but not backed by enough tasks does not count into the average
  const scored = STAFF.filter((a) => !needsEvidence(a));
  const avg = scored.length ? Math.round((scored.reduce((s, a) => s + a.success, 0) / scored.length) * 10) / 10 : 0;
  const successFoot = isApi() ? (scored.some((a) => provenanceOf(a).source === 'demo-fixture') ? <DemoTag title="Includes prototype numbers: measured from Stage 9/10" /> : <span className="demo-tag measured">{scored.reduce((s, a) => s + (provenanceOf(a).sample ?? 0), 0)} tasks / 90 days</span>) : undefined;
  const kpis: KpiItem[] = [
    { key: 'all', icon: Bot, value: AGENTS.length, label: 'Agents', hint: 'one per duty · no duplicates', color: '#22d3ee', help: 'agents.kpi.total', onClick: () => { setTab('Directory'); setFilter('all'); } },
    { key: 'work', icon: Activity, value: COUNTS.working, label: 'Working', hint: `${COUNTS['in-mission']} in missions · ${COUNTS.idle} idle`, color: '#3b82f6', help: 'agents.kpi.working', onClick: () => { setTab('Directory'); setFilter('working'); } },
    { key: 'learn', icon: GraduationCap, value: learningN, label: 'Learning', hint: isApi() ? 'active mentoring plans' : 'mentor exercises running', color: '#38bdf8', help: 'agents.kpi.learning', onClick: () => setTab('Development') },
    { key: 'evo', icon: Dna, value: evolvingN, label: 'Evolving', hint: isApi() ? 'pending version proposals' : 'candidates in the pipeline', color: '#c084fc', help: 'agents.kpi.evolving', onClick: () => setTab('Development') },
    { key: 'succ', icon: Trophy, value: avg, decimals: 1, suffix: '%', label: 'Verified Success', ...(isApi() ? { foot: successFoot } : { delta: '+1.2%' }), color: '#facc15', help: 'agents.kpi.success', onClick: () => { setTab('Directory'); setView('list'); } },
  ];

  const dir = tab === 'Directory';
  const controls = (
    <>
      <div className="input-wrap" style={{ width: 210 }}><Search size={15} /><input className="input" placeholder="Search agents, skills..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agents" /></div>
      <select className="select" style={{ width: 150 }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
        <option value="all">All departments</option>
        {DEPTS.filter((d) => d.memberIds.length && d.name !== 'Executive').map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
      </select>
      <div className="view-switch" role="group" aria-label="Agents view">
        <IconButton icon={LayoutGrid} label="Cards" size="sm" variant={view === 'cards' ? 'active' : 'default'} onClick={() => setView('cards')} aria-pressed={view === 'cards'} />
        <IconButton icon={List} label="List" size="sm" variant={view === 'list' ? 'active' : 'default'} onClick={() => setView('list')} aria-pressed={view === 'list'} />
        <IconButton icon={Network} label="Hierarchy (zoom with the mouse wheel)" size="sm" variant={view === 'hierarchy' ? 'active' : 'default'} onClick={() => setView('hierarchy')} aria-pressed={view === 'hierarchy'} />
      </div>
      <HelpTrigger k="agents.views" />
    </>
  );
  const toolbar = <span>{tab === 'Proposals' && isApi() ? 'Reporting-line changes: proposed by an administrator, checked by the server, approved by another administrator.' : tab === 'Development' && isApi() ? 'Agent version proposals: proposed by an administrator, promoted by another, rolled back in one step.' : tab === 'Departments' && isApi() ? 'Members, head, staffing, open tasks and outcomes: counted by the server.' : TAB_NOTE[tab]}</span>;

  const list = useMemo(() => STAFF.filter((a) => match(a, filter) && (dept === 'all' || a.dept === dept)
    && (!q || (a.name + ' ' + ROLES[a.role].label + ' ' + a.skills.join(' ') + ' ' + a.dept).toLowerCase().includes(q.toLowerCase()))), [STAFF, filter, dept, q]);
  const reset = () => { setFilter('all'); setDept('all'); setQ(''); };

  return {
    kpis,
    actions: <>
      {canEdit && <button className="btn" onClick={() => openDialog('department-create')}><Building2 size={15} />New department</button>}
      {canEdit && <button className="btn primary" onClick={() => openDialog('agent-create')}><Plus size={16} />New Agent</button>}
    </>,
    sub: { tabs, value: tab, onChange: setTab, icons: TAB_ICONS, counts: { Development: devCount } },
    toolbar,
    bodyKey: dir ? `${tab}-${view}` : tab,
    scroll: !(dir && view === 'hierarchy'),
    head: dir ? <><StatusChips value={filter} onChange={setFilter} /><span className="spacer" />{controls}</> : null,
    body: <>
      {dir && (list.length === 0 && view !== 'hierarchy'
        ? <EmptyState icon={Bot} title="No agents match" body="Try another status, department or search term." action={<button className="btn" onClick={reset}>Clear filters</button>} />
        : view === 'cards' ? <Cards list={list} />
        : view === 'list' ? <AgentTable list={list} onOpen={(id) => nav(`/agents/${id}`)} />
        : <AgentHierarchy highlight={(a) => a.id === 'gm' || list.includes(a)} />)}
      {tab === 'Development' && (isApi() ? <ServerDevelopment /> : <Development />)}
      {tab === 'Lineage' && <Lineage />}
      {tab === 'Live Instances' && <LiveInstances />}
      {tab === 'Departments' && <Departments />}
      {tab === 'Assignments' && <Assignments />}
      {tab === 'Policies' && <Policies />}
      {tab === 'Proposals' && <Proposals />}
    </>,
    bottom: <BottomBoard id="agents" title="Agent boards"><Lifecycle /><StageBoard /><TopPerformers /><EvolutionPipeline /></BottomBoard>,
  };
}

function StatusChips({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const chips: { key: Filter; label: string; icon: typeof Bot }[] = [
    { key: 'all', label: 'All', icon: Bot },
    { key: 'working', label: 'Working', icon: RefreshCcw },
    { key: 'in-mission', label: 'In Mission', icon: MapPin },
    { key: 'idle', label: 'Idle', icon: Moon },
    { key: 'learning', label: 'Learning', icon: GraduationCap },
    { key: 'evolving', label: 'Evolving', icon: Dna },
  ];
  return <Tabs tabs={chips.map((c) => ({ key: c.key, label: c.label, icon: c.icon, count: counts()[c.key] }))} value={value} onChange={onChange} ariaLabel="Filter agents by status or development" className="status-chips" />;
}

/* ------------------------------------------------------------------ */
function Cards({ list }: { list: Agent[] }) {
  return (
    <motion.div className="agent-grid" layout>
      <AnimatePresence mode="popLayout">
        {list.map((a, i) => <AgentCard key={a.id} agent={a} index={i} />)}
      </AnimatePresence>
    </motion.div>
  );
}

function AgentTable({ list, onOpen }: { list: Agent[]; onOpen: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="table ag-table">
        <thead><tr><th>Agent</th><th>Role</th><th>Department</th><th>Status</th><th>Development</th><th>Stage</th><th>Evolution</th><th>Version</th><th>Success (n)</th></tr></thead>
        <tbody>
          {list.map((a, i) => (
            <motion.tr key={a.id} onClick={() => onOpen(a.id)} style={{ cursor: 'pointer' }} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .02 }}>
              <td><span className="row"><RobotAvatar role={a.role} size={30} animated={a.growth === 'evolving'} /><b>{a.name}</b><ReliabilityChip agent={a} /></span></td>
              <td><RoleChip role={a.role} size="sm" /></td>
              <td>{a.dept}</td>
              <td><AgentStatusChip status={a.status} size="sm" /></td>
              <td style={{ minWidth: 150 }}>
                <GrowthBadge agent={a} size="sm" />
                {a.growth !== 'stable' && <div className="dim ellipsis" style={{ fontSize: 11, maxWidth: 220, marginTop: 3 }}>{a.growthNote}</div>}
              </td>
              <td><LevelPips level={a.level} xp={a.xp} /></td>
              <td><EvoTrack agent={a} /></td>
              <td className="mono">{a.version}{a.candidate && <span className="dim"> → {a.candidate}</span>}</td>
              <td className="tnum">{needsEvidence(a) ? <span className="dim" title={NOT_ENOUGH}>not enough evidence</span> : <><b>{a.success}%</b> <span className="dim">({a.sample})</span></>} <ProvenanceChip agent={a} /></td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Development: stage ladder + learning / evolving / stable lanes      */
/* ------------------------------------------------------------------ */
/** DEMO sample (labelled "Sample" in the card): what verified evidence looks like. Nothing was measured. */
const DEMO_EVAL: ProposalEvaluationDto = {
  outcome: 'inconclusive', n: 8, wins: 6, losses: 1, ties: 1, k: 1, delta: 9.4, ci: { low: -2.1, high: 20.9 }, baselineMean: 61.2, candidateMean: 70.6,
  passHatK: { baseline: [0.5], candidate: [0.75] }, refusals: [], reasons: ['8 cases scored on both versions; the policy needs 10'], notes: [],
  datasetId: 'holdout-demo', datasetSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9', baseRunId: null, candidateRunId: 'demo', runCount: 1,
};
function Development() {
  const nav = useNavigate();
  const lanes: { key: Agent['growth']; title: string; sub: string }[] = [
    { key: 'learning', title: 'Learning', sub: 'Mentor exercises with before/after evidence' },
    { key: 'evolving', title: 'Evolving', sub: 'Candidate versions moving through the evolution pipeline' },
    { key: 'stable', title: 'Stable', sub: 'Promoted version, no change in progress' },
  ];
  return (
    <div className="col" style={{ gap: 'var(--gap)' }}>
      <Panel icon={Sprout} title="Development stages" help="agents.devStages" sub="Seed → Master, earned with verified work" delay={.02}>
        <div className="dev-ladder">
          {DEV_LEVELS.map((name, i) => {
            const at = AGENTS.filter((a) => a.level === i + 1);
            return (
              <motion.div key={name} className="dev-rung" style={{ ['--i' as string]: i }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 + i * .06 }}>
                <div className="row" style={{ gap: 8 }}><span className="dev-rung-n">{i + 1}</span><b>{name}</b><span className="spacer" /><b className="tnum">{at.length}</b></div>
                <div className="dev-rung-av">
                  {at.map((a) => <Tip key={a.id} label={`${a.name} · ${a.xp}% to next stage`}><button className="dev-av" onClick={() => nav(`/agents/${a.id}?tab=evolution`)} aria-label={a.name}><RobotAvatar role={a.role} size={30} /></button></Tip>)}
                  {at.length === 0 && <span className="dim" style={{ fontSize: 12 }}>nobody yet</span>}
                </div>
              </motion.div>
            );
          })}
        </div>
      </Panel>
      <div className="dev-lanes">
        {lanes.map((l, li) => {
          const g = GROWTH[l.key];
          const items = AGENTS.filter((a) => a.growth === l.key);
          return (
            <motion.section key={l.key} className={cx('dev-lane', l.key)} style={{ ['--gh' as string]: g.hue }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 + li * .06 }} aria-label={l.title}>
              <header className="row" style={{ gap: 8 }}>
                <span className="dev-lane-ico"><g.icon size={17} className={l.key !== 'stable' ? 'gr-spin' : undefined} /></span>
                <div><b>{l.title}</b> <span className="dim tnum">({items.length})</span><div className="dim" style={{ fontSize: 11.5 }}>{l.sub}</div></div>
                <span className="spacer" /><HelpTrigger k={`agents.growth.${l.key}`} />
              </header>
              <div className="col" style={{ gap: 8 }}>
                {items.map((a) => (
                  <div key={a.id} className="dev-item">
                    <button className="dev-item-hit" onClick={() => nav(`/agents/${a.id}?tab=${l.key === 'learning' ? 'mentoring' : 'evolution'}`)} aria-label={`Open ${a.name}`} />
                    <div className="row" style={{ gap: 9 }}>
                      <RobotAvatar role={a.role} size={36} animated={l.key === 'evolving'} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="row" style={{ gap: 6 }}><b style={{ fontSize: 13 }}>{a.name}</b><span className="dim" style={{ fontSize: 11 }}>{ROLES[a.role].label}</span></div>
                        <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{a.growthNote}</div>
                      </div>
                      <LevelPips level={a.level} xp={a.xp} showName={false} />
                    </div>
                    {l.key !== 'stable' && <div className="dev-bar" style={{ marginTop: 7 }}><motion.i initial={{ width: 0 }} animate={{ width: `${a.growthPct}%` }} transition={{ duration: 1 }} /></div>}
                    {l.key === 'evolving' && <div style={{ marginTop: 6 }}><EvoTrack agent={a} /></div>}
                    {l.key === 'evolving' && a.id === items[0]?.id && <div style={{ marginTop: 6 }} data-demo-eval-sample><EvaluationView sample e={DEMO_EVAL} /></div>}
                    {l.key === 'learning' && <div className="row" style={{ marginTop: 6, gap: 6 }}><button className="btn sm" style={{ position: 'relative', zIndex: 1 }} onClick={() => openDialog('mentoring-session', { agentId: a.id })}><GraduationCap size={13} />Next exercise</button></div>}
                  </div>
                ))}
              </div>
            </motion.section>
          );
        })}
      </div>
      <PlaybookPanel />
    </div>
  );
}

function LiveInstances() {
  const missions = useVisibleMissions();
  const nav = useNavigate();
  const live = useMemo(() => missions.filter((m) => !['archived', 'completed', 'draft'].includes(m.status)), [missions]);
  const byMission = useMissionControls(isApi() ? [] : live.map((m) => m.id), ['hierarchy']); // demo mode: each mission's fixture instances
  const srv = useAgentInstances(); // api mode: GET /agent-instances
  interface Row { mid: string; instanceId: string; agentId: string; task: string; state: InstanceState; progress: number; versionLabel?: string; simulated?: boolean }
  const rows: Row[] = useMemo(() => {
    if (isApi()) {
      const liveIds = new Set(live.map((m) => m.id));
      return (srv.data ?? []).filter((i) => liveIds.has(i.missionId) && AGENT_BY_ID[i.agentId]).map((i) => ({ mid: i.missionId, instanceId: i.id, agentId: i.agentId, task: i.task, state: i.state as InstanceState, progress: i.progress, versionLabel: i.versionLabel, simulated: i.simulated }));
    }
    return live.flatMap((m) => getMissionControl(m).nodes.map((n) => ({ mid: m.id, instanceId: n.instanceId, agentId: n.agentId, task: n.task, state: n.state, progress: n.progress, versionLabel: n.versionLabel }))).filter((r) => AGENT_BY_ID[r.agentId]);
  }, [live, byMission, srv.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}><span className="muted" style={{ fontSize: 13 }}>{rows.length} live instances across {new Set(rows.map((r) => r.mid)).size} missions. One agent can run in several missions; each instance has its own memory, grants and pinned version.</span><HelpTrigger k="agent.instance" /><span className="spacer" />{!isApi() && <DemoTag />}</div>
      {isApi() && srv.error && <div className="oa-banner" role="alert"><span>The instance list could not be read: {srv.error}</span><button className="btn sm" onClick={srv.retry}>Retry</button></div>}
      {isApi() && !srv.data && !srv.error ? <LiveStatus className="dim" style={{ fontSize: 13 }} data-state="loading">Loading instances…</LiveStatus> : rows.length === 0 && isApi() ? <EmptyState icon={Box} title="No live instances" body="Instances appear when a mission is staffed. Missions that are archived, completed or drafts are not listed." /> : (
      <div className="table-wrap">
        <table className="table" data-live-instances>
          <thead><tr><th>Instance</th><th>Agent</th><th>Mission</th><th>Current task</th><th>State</th><th>Pinned</th><th>Progress</th><th /></tr></thead>
          <tbody>
            {rows.map((n) => {
              const a = AGENT_BY_ID[n.agentId];
              return (
                <tr key={n.instanceId} data-agent={n.agentId}>
                  <td className="mono dim">{n.instanceId}{n.simulated && <span className="sim-tag" title="Simulated on a DEMO mission. Agents do not execute yet." style={{ marginLeft: 6 }}>Simulated</span>}</td>
                  <td><span className="row"><RobotAvatar role={a.role} size={26} /><b>{a.name}</b></span></td>
                  <td><button className="btn ghost sm" onClick={() => nav(`/missions/${n.mid}?tab=hierarchy&agent=${n.agentId}`)}>{n.mid}</button></td>
                  <td className="ellipsis" style={{ maxWidth: 220 }}>{n.task}</td>
                  <td><InstanceStateChip state={n.state} size="sm" /></td>
                  <td className="mono" data-pinned>{n.versionLabel ?? a.version}</td>
                  <td style={{ width: 120 }}><div className="bar thin"><i style={{ width: `${n.progress}%` }} /></div></td>
                  <td><IconButton icon={ArrowRight} label="Open in Missions" size="sm" onClick={() => nav(`/missions/${n.mid}?tab=hierarchy&agent=${n.agentId}`)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom board                                                         */
/* ------------------------------------------------------------------ */
function Lifecycle() {
  const nav = useNavigate();
  const canEdit = useCanEditAgents();
  const steps = [
    { label: 'Create', icon: Box, hue: 165, n: AGENTS.filter((a) => a.createdAgo <= 14).length, go: () => (canEdit ? openDialog('agent-create') : nav('/agents')) },
    { label: 'Learn', icon: Sparkles, hue: 195, n: counts().learning, go: () => nav('/agents?tab=development') },
    { label: 'Deploy', icon: Rocket, hue: 215, n: counts().working, go: () => nav('/agents?tab=live-instances') },
    { label: 'Evolve', icon: Layers, hue: 285, n: counts().evolving, go: () => nav('/agents?tab=development') },
  ];
  return (
    <Panel icon={RefreshCcw} title="Agent Lifecycle" help="agents.lifecycle" delay={.15} className="bottom-panel">
      <div className="lifecycle">
        {steps.map((s, i) => (
          <div key={s.label} className="row" style={{ gap: 6 }}>
            <motion.button className="life-step" style={{ ['--h' as string]: s.hue }} onClick={s.go} aria-label={`${s.label}: ${s.n} agents`}
              initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: .25 + i * .1, type: 'spring', stiffness: 300, damping: 18 }}>
              <span className="life-ring"><s.icon size={24} strokeWidth={1.7} /><em className="life-n tnum">{s.n}</em></span>
              <span className="life-label">{s.label}</span>
            </motion.button>
            {i < steps.length - 1 && <span className="life-arrow"><ArrowRight size={16} /></span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StageBoard() {
  const max = Math.max(...DEV_LEVELS.map((_, i) => AGENTS.filter((a) => a.level === i + 1).length));
  return (
    <Panel icon={Sprout} title="Development Stage" help="agents.devStages" delay={.2} className="bottom-panel">
      <div className="stage-bars">
        {DEV_LEVELS.map((name, i) => {
          const n = AGENTS.filter((a) => a.level === i + 1).length;
          return (
            <Tip key={name} label={`${name}: ${n} agents`}>
              <div className="stage-col" tabIndex={0} style={{ ['--i' as string]: i }}>
                <b className="tnum">{n}</b>
                <span className="stage-bar"><motion.i initial={{ height: 0 }} animate={{ height: `${max ? (n / max) * 100 : 0}%` }} transition={{ duration: .8, delay: .3 + i * .07 }} /></span>
                <span className="stage-name">{name}</span>
              </div>
            </Tip>
          );
        })}
      </div>
    </Panel>
  );
}

function TopPerformers() {
  const nav = useNavigate();
  const list = staff().filter((a) => !needsEvidence(a)).sort((a, b) => b.success - a.success || b.sample - a.sample).slice(0, 5);
  return (
    <Panel icon={Gauge} title={<>Agent Performance <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>(Top 5)</span></>} help="agents.performance" delay={.25} className="bottom-panel">
      <div className="col" style={{ gap: 7 }}>
        {list.map((a, i) => (
          <button key={a.id} className="perf-row" onClick={() => nav(`/agents/${a.id}?tab=performance`)} aria-label={`${a.name} ${a.success}% success`}>
            <span className="perf-ico">{(() => { const I = ROLES[a.role].icon; return <I size={16} />; })()}</span>
            <span className="ellipsis" style={{ width: 100, textAlign: 'left' }}>{a.name}</span>
            <span className="bar" style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${a.success}%` }} transition={{ duration: 1, delay: .3 + i * .08 }} /></span>
            <b className="tnum" style={{ width: 38, textAlign: 'right' }}>{a.success}%</b>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function EvolutionPipeline() {
  const nav = useNavigate();
  const icons = [Lightbulb, FlaskConical, Gauge, CheckCircle2];
  return (
    <Panel icon={Dna} title="Agent Evolution Pipeline" help="agents.evolution" delay={.3} className="bottom-panel">
      <div className="evo-pipe2">
        {EVO_PHASES.map((p, i) => {
          const at = AGENTS.filter((a) => a.evoPhase === p.key);
          const I = icons[i];
          return (
            <div key={p.key} className="row" style={{ gap: 2, flex: 1, minWidth: 0 }}>
              <motion.button className={cx('evo-ph-node', at.length > 0 && 'on')} onClick={() => nav('/agents?tab=development')}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .3 + i * .1 }} aria-label={`${p.label}: ${at.map((a) => a.name).join(', ') || 'none'}`}>
                <span className="evo-ph-ico"><I size={17} /></span>
                <b>{p.label}</b>
                <span className="evo-ph-av">{at.length ? at.map((a) => <RobotAvatar key={a.id} role={a.role} size={30} animated />) : <span className="dim" style={{ fontSize: 11 }}>—</span>}</span>
                <span className="dim ellipsis" style={{ fontSize: 10.5, maxWidth: '100%' }}>{at.map((a) => a.name).join(', ')}</span>
              </motion.button>
              {i < EVO_PHASES.length - 1 && <ArrowRight size={14} className="muted" style={{ flex: 'none' }} />}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

