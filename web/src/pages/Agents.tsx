import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layers, Search, LayoutGrid, List, Plus, Bot, Activity, MapPin, GraduationCap, Dna, Moon, Network, RefreshCcw,
  Box, Sparkles, Rocket, CheckCircle2, Gauge, ArrowRight, Users2, TrendingUp, Workflow, Crown,
} from 'lucide-react';
import { CommandCenter } from '@/components/layout/CommandCenter';
import { AgentCard } from '@/components/agents/AgentCard';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { IconButton } from '@/components/ui/IconButton';
import { AgentStatusChip, Chip, InstanceStateChip, RoleChip, DemoTag } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tip } from '@/components/ui/Tip';
import { Sparkline } from '@/components/viz/Charts';
import { AGENTS, AGENT_BY_ID, seeded } from '@/data/agents';
import { ROLES } from '@/data/roles';
import type { AgentStatus, RoleKey } from '@/data/types';
import { useTab } from '@/hooks/useTab';
import { useData } from '@/store/data';
import { getMissionControl } from '@/data/missions';
import { openDialog } from '@/store/ui';

type Filter = 'all' | 'active' | 'in-mission' | 'training' | 'evolving' | 'idle';

export default function AgentsPage() {
  const [tab, setTab, tabs] = useTab('agents');
  const TAB_ICONS = [Bot, Activity, Users2, GraduationCap];
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<RoleKey | 'all'>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const dir = tab === 'Directory';
  return (
    <div className="page">
      <CommandCenter />
      <Panel
        className="agents-panel"
        icon={Layers}
        titleSize="lg"
        title="Agents"
        help="agents.directory"
        sub="Manage, monitor, and evolve your AI agents."
        delay={.1}
        actions={
          <div className="row wrap" style={{ gap: 10, justifyContent: 'flex-end' }}>
            {dir && <>
              <div className="input-wrap" style={{ width: 236 }}>
                <Search size={15} />
                <input className="input" placeholder="Search agents..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agents" />
              </div>
              <select className="select" style={{ width: 160 }} value={role} onChange={(e) => setRole(e.target.value as RoleKey | 'all')} aria-label="Filter by role">
                <option value="all">All Roles</option>
                {Object.values(ROLES).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <div className="row" style={{ gap: 2, padding: 2, borderRadius: 10, border: '1px solid var(--border-soft)', background: 'var(--panel-2)' }}>
                <IconButton icon={LayoutGrid} label="Grid view" size="sm" variant={view === 'grid' ? 'active' : 'default'} onClick={() => setView('grid')} aria-pressed={view === 'grid'} />
                <IconButton icon={List} label="List view" size="sm" variant={view === 'list' ? 'active' : 'default'} onClick={() => setView('list')} aria-pressed={view === 'list'} />
              </div>
            </>}
            <button className="btn primary" onClick={() => openDialog('agent-create')}><Plus size={16} />New Agent</button>
          </div>
        }
      >
        <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
          {dir ? <StatusChips value={filter} onChange={setFilter} /> : <span className="muted" style={{ fontSize: 13 }}>{tab === 'Live Instances' ? 'Every mission-scoped agent instance, with its pinned version and current task.' : tab === 'Teams' ? 'Mission teams, role coverage and gaps.' : 'Mentor assignments and verified skill growth.'}</span>}
          <span className="spacer" />
          <Tabs size="sm" variant="underline" tabs={tabs.map((t, i) => ({ key: t, label: t, icon: TAB_ICONS[i] }))} value={tab} onChange={setTab} ariaLabel="Agents views" />
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab}>
            {tab === 'Directory' && <Directory filter={filter} q={q} role={role} view={view} reset={() => { setFilter('all'); setRole('all'); setQ(''); }} />}
            {tab === 'Live Instances' && <LiveInstances />}
            {tab === 'Teams' && <Teams />}
            {tab === 'Coaching' && <Coaching />}
          </motion.div>
        </AnimatePresence>
      </Panel>
      <div className="agents-bottom">
        <OrgMini />
        <Lifecycle />
        <TopPerformers />
        <EvolutionPipeline />
      </div>
    </div>
  );
}

const COUNTS = {
  all: AGENTS.length,
  active: AGENTS.filter((a) => a.status === 'active' || a.status === 'in-mission').length,
  'in-mission': AGENTS.filter((a) => a.status === 'in-mission').length,
  training: AGENTS.filter((a) => a.status === 'training').length,
  evolving: AGENTS.filter((a) => a.status === 'evolving').length,
  idle: AGENTS.filter((a) => a.status === 'idle').length,
};

function StatusChips({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const chips: { key: Filter; label: string; icon: typeof Bot }[] = [
    { key: 'all', label: 'All Agents', icon: Bot },
    { key: 'active', label: 'Active', icon: RefreshCcw },
    { key: 'in-mission', label: 'In Mission', icon: MapPin },
    { key: 'training', label: 'Training', icon: GraduationCap },
    { key: 'evolving', label: 'Evolving', icon: Dna },
    { key: 'idle', label: 'Idle', icon: Moon },
  ];
  return <Tabs tabs={chips.map((c) => ({ key: c.key, label: c.label, icon: c.icon, count: COUNTS[c.key] }))} value={value} onChange={onChange} ariaLabel="Filter agents by status" className="status-chips" />;
}

/* ------------------------------------------------------------------ */
function Directory({ filter, q, role, view, reset }: { filter: Filter; q: string; role: RoleKey | 'all'; view: 'grid' | 'list'; reset: () => void }) {
  const nav = useNavigate();
  const list = useMemo(() => AGENTS.filter((a) => a.id !== 'gm').filter((a) => {
    if (filter === 'active' && !(a.status === 'active' || a.status === 'in-mission')) return false;
    if (filter !== 'all' && filter !== 'active' && a.status !== (filter as AgentStatus)) return false;
    if (role !== 'all' && a.role !== role) return false;
    if (q && !(a.name + ' ' + ROLES[a.role].label + ' ' + a.skills.join(' ')).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [filter, role, q]);

  return (
    <>
      {list.length === 0 ? (
        <EmptyState icon={Bot} title="No agents match" body="Try another status, role or search term." action={<button className="btn" onClick={reset}>Clear filters</button>} />
      ) : view === 'grid' ? (
        <motion.div className="agent-grid agent-grid-scroll" layout>
          <AnimatePresence mode="popLayout">
            {list.map((a, i) => <AgentCard key={a.id} agent={a} index={i} />)}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table className="table">
            <thead><tr><th>Agent</th><th>Role</th><th>Status</th><th>Version</th><th>Department</th><th>Model</th><th>Load</th><th>Missions</th><th>Success (n)</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} onClick={() => nav(`/agents/${a.id}`)} style={{ cursor: 'pointer' }}>
                  <td><span className="row"><RobotAvatar role={a.role} size={30} /><b>{a.name}</b></span></td>
                  <td><RoleChip role={a.role} size="sm" /></td>
                  <td><AgentStatusChip status={a.status} size="sm" /></td>
                  <td className="mono">{a.version}</td>
                  <td>{a.dept}</td>
                  <td className="mono dim">{a.model}</td>
                  <td style={{ width: 110 }}><div className="bar thin"><i style={{ width: `${a.load}%` }} /></div></td>
                  <td className="tnum">{a.missions}</td>
                  <td className="tnum"><b>{a.success}%</b> <span className="dim">({a.sample})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function LiveInstances() {
  const missions = useData((s) => s.missions);
  const nav = useNavigate();
  const rows = useMemo(() => missions.filter((m) => !['archived', 'completed', 'draft'].includes(m.status)).flatMap((m) => getMissionControl(m).nodes.map((n) => ({ m, n }))), [missions]);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}><span className="muted" style={{ fontSize: 13 }}>{rows.length} live instances across {new Set(rows.map((r) => r.m.id)).size} missions. Each instance has its own memory, grants and pinned version.</span><HelpTrigger k="agent.instance" /><span className="spacer" /><DemoTag /></div>
      <div className="table-wrap" style={{ maxHeight: 440 }}>
        <table className="table">
          <thead><tr><th>Instance</th><th>Agent</th><th>Mission</th><th>Current task</th><th>State</th><th>Pinned</th><th>Progress</th><th /></tr></thead>
          <tbody>
            {rows.map(({ m, n }) => {
              const a = AGENT_BY_ID[n.agentId];
              return (
                <tr key={n.instanceId}>
                  <td className="mono dim">{n.instanceId}</td>
                  <td><span className="row"><RobotAvatar role={a.role} size={26} /><b>{a.name}</b></span></td>
                  <td><button className="btn ghost sm" onClick={() => nav(`/control/${m.id}?tab=hierarchy&agent=${n.agentId}`)}>{m.id}</button></td>
                  <td className="ellipsis" style={{ maxWidth: 220 }}>{n.task}</td>
                  <td><InstanceStateChip state={n.state} size="sm" /></td>
                  <td className="mono">{a.version}</td>
                  <td style={{ width: 120 }}><div className="bar thin"><i style={{ width: `${n.progress}%` }} /></div></td>
                  <td><IconButton icon={ArrowRight} label="Open in Mission Control" size="sm" onClick={() => nav(`/control/${m.id}?tab=hierarchy&agent=${n.agentId}`)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Teams() {
  const missions = useData((s) => s.missions);
  const nav = useNavigate();
  const teams = missions.filter((m) => m.status !== 'archived').slice(0, 9);
  return (
    <div className="grid g-3">
      {teams.map((m, i) => {
        const lead = AGENT_BY_ID[m.leadId];
        const coverage = Array.from(new Set(m.agentIds.map((a) => AGENT_BY_ID[a]?.role)));
        const gaps = (['qa', 'security'] as RoleKey[]).filter((r) => !coverage.includes(r));
        return (
          <motion.div key={m.id} className="subpanel glass-card hoverable" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }} style={{ padding: 14 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <Workflow size={16} className="info" /><b className="ellipsis">{m.title}</b><span className="spacer" /><span className="mono dim" style={{ fontSize: 11 }}>{m.id}</span>
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              <Crown size={14} className="warn" /><span style={{ fontSize: 12.5 }}>Lead: <b>{lead?.name}</b></span>
            </div>
            <div className="row wrap" style={{ gap: 4, marginBottom: 10 }}>
              {m.agentIds.map((id) => { const a = AGENT_BY_ID[id]; return a ? <Tip key={id} label={`${a.name} · ${ROLES[a.role].label}`}><span tabIndex={0}><RobotAvatar role={a.role} size={34} /></span></Tip> : null; })}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {coverage.slice(0, 4).map((r) => r && <Chip key={r} hue={ROLES[r].hue} size="sm">{ROLES[r].short}</Chip>)}
              {gaps.map((g) => <Chip key={g} hue={30} size="sm" title="Role not covered in this team">gap: {ROLES[g].short}</Chip>)}
            </div>
            <div className="row" style={{ marginTop: 12, gap: 6 }}>
              <button className="btn sm" onClick={() => nav(`/control/${m.id}?tab=hierarchy`)}>Open hierarchy</button>
              <button className="btn sm ghost" onClick={() => openDialog('task-reassign', { missionId: m.id })}>Propose change</button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function Coaching() {
  const learners = AGENTS.filter((a) => a.status === 'training' || a.success < 95).slice(0, 6);
  return (
    <div className="grid g-3">
      {learners.map((a, i) => {
        const r = seeded(a.id + 'coach');
        const trend = Array.from({ length: 12 }, (_, k) => Math.round(a.success - 9 + k * 0.8 + r() * 3));
        return (
          <motion.div key={a.id} className="subpanel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
            <div className="row" style={{ gap: 10 }}>
              <RobotAvatar role={a.role} size={44} faceMode="face" />
              <div style={{ minWidth: 0 }}>
                <b>{a.name}</b>
                <div className="dim" style={{ fontSize: 12 }}>Mentor: Mentor-01 · plan "{ROLES[a.role].label} fundamentals"</div>
              </div>
              <span className="spacer" />
              <AgentStatusChip status={a.status} size="sm" />
            </div>
            <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <div>
                <div className="dim" style={{ fontSize: 11.5 }}>Verified success (last 12 evals)</div>
                <div className="row" style={{ gap: 6 }}><b className="display" style={{ fontSize: 20 }}>{trend[trend.length - 1]}%</b><span className="good" style={{ fontSize: 12, fontWeight: 700 }}><TrendingUp size={12} style={{ display: 'inline' }} /> +{trend[trend.length - 1] - trend[0]}pp</span></div>
              </div>
              <Sparkline data={trend} w={120} h={36} color="var(--good)" />
            </div>
            <div className="row" style={{ marginTop: 10, gap: 6 }}>
              <button className="btn sm" onClick={() => openDialog('mentoring-session', { agentId: a.id })}><GraduationCap size={14} />Assign exercise</button>
              <button className="btn sm ghost" onClick={() => openDialog('agent-evidence', { agentId: a.id, metric: 'success' })}>Evidence</button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom row panels                                                    */
/* ------------------------------------------------------------------ */
function OrgMini() {
  const nav = useNavigate();
  const depts: { key: string; label: string; role: RoleKey; dept: string }[] = [
    { key: 'rd', label: 'R&D', role: 'research', dept: 'R&D' },
    { key: 'dev', label: 'DEV', role: 'dev', dept: 'Engineering' },
    { key: 'ops', label: 'OPS', role: 'ops', dept: 'Operations' },
    { key: 'qa', label: 'QA', role: 'security', dept: 'QA' },
    { key: 'knw', label: 'KNW', role: 'knowledge', dept: 'Knowledge' },
    { key: 'fin', label: 'FIN', role: 'finance', dept: 'Finance' },
  ];
  return (
    <Panel icon={Network} title="Agent Organization" help="agents.organization" delay={.15} className="bottom-panel">
      <div className="org-mini">
        <button className="org-gm" onClick={() => nav('/organization')} aria-label="Open organization chart">
          <RobotAvatar role="manager" size={56} faceMode="face" animated />
          <div style={{ textAlign: 'left' }}><b>GM</b><div className="dim" style={{ fontSize: 11.5 }}>(v3.2.0)</div></div>
        </button>
        <svg className="org-lines" viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden>
          <path d="M300 0 V22 M50 22 H550" stroke="var(--border-strong)" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />
          {depts.map((_, i) => <path key={i} d={`M${50 + i * 100} 22 V60`} stroke="var(--border-strong)" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />)}
          <circle r="4" fill="var(--accent-2)" style={{ filter: 'drop-shadow(0 0 4px var(--accent-2))' }}>
            <animateMotion dur="3.2s" repeatCount="indefinite" path="M300 0 V22 H550 V60" />
          </circle>
        </svg>
        <div className="org-depts">
          {depts.map((d, i) => {
            const n = AGENTS.filter((a) => a.dept === d.dept).length;
            const R = ROLES[d.role];
            return (
              <Tip key={d.key} label={`${d.dept}: ${n} agents`}>
                <motion.button className="org-dept" style={{ ['--h' as string]: R.hue }} onClick={() => nav('/organization?tab=departments')}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .25 + i * .05 }}>
                  <R.icon size={22} strokeWidth={1.8} />
                  <b>{d.label}</b>
                  <span>({n})</span>
                </motion.button>
              </Tip>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function Lifecycle() {
  const steps = [
    { label: 'Create', icon: Box, hue: 165 },
    { label: 'Train', icon: Sparkles, hue: 268 },
    { label: 'Deploy', icon: Rocket, hue: 205 },
    { label: 'Evolve', icon: Layers, hue: 275 },
  ];
  const nav = useNavigate();
  return (
    <Panel icon={RefreshCcw} title="Agent Lifecycle" help="agents.lifecycle" delay={.2} className="bottom-panel">
      <div className="lifecycle">
        {steps.map((s, i) => (
          <div key={s.label} className="row" style={{ gap: 6 }}>
            <motion.button className="life-step" style={{ ['--h' as string]: s.hue }} onClick={() => nav(i === 3 ? '/evolution' : i === 1 ? '/agents?tab=coaching' : '/agents')}
              initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: .25 + i * .1, type: 'spring', stiffness: 300, damping: 18 }}>
              <span className="life-ring"><s.icon size={26} strokeWidth={1.7} /></span>
              <span className="life-label">{s.label}</span>
            </motion.button>
            {i < steps.length - 1 && <motion.span className="life-arrow" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .4 + i * .1 }}><ArrowRight size={18} /></motion.span>}
          </div>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 12, marginTop: 14, fontSize: 11.5, justifyContent: 'center' }}>
        {['Auto-evolution enabled', 'Experience accumulation', 'Versioned & traceable'].map((t) => (
          <span key={t} className="row" style={{ gap: 5 }}><CheckCircle2 size={14} className="good" />{t}</span>
        ))}
      </div>
    </Panel>
  );
}

function TopPerformers() {
  const nav = useNavigate();
  const top = [...AGENTS].filter((a) => a.sample >= 30 || a.id === 'gm').sort((a, b) => b.success - a.success || b.sample - a.sample).filter((a) => a.id !== 'gm').slice(0, 5);
  const pick = ['security-01', 'ops-01', 'finance-01', 'researcher-01', 'integrator-01'].map((id) => AGENT_BY_ID[id]);
  const list = pick.every(Boolean) ? pick : top;
  return (
    <Panel icon={Gauge} title={<>Agent Performance <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>(Top 5)</span></>} help="agents.performance" delay={.25} className="bottom-panel">
      <div className="col" style={{ gap: 10 }}>
        {list.map((a, i) => (
          <button key={a.id} className="perf-row" onClick={() => nav(`/agents/${a.id}?tab=performance`)} aria-label={`${a.name} ${a.success}% success`}>
            <span className="perf-ico">{(() => { const I = ROLES[a.role].icon; return <I size={17} />; })()}</span>
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
  const vs = [
    { v: 'v2.3.0', label: '(Current)', hue: 200 },
    { v: 'v2.4.0', label: '(Candidate)', hue: 290 },
    { v: 'v2.5.0', label: '(Next)', hue: 215 },
  ];
  return (
    <Panel icon={Dna} title="Agent Evolution Pipeline" help="agents.evolution" delay={.3} className="bottom-panel">
      <div className="evo-pipe">
        {vs.map((x, i) => (
          <div key={x.v} className="row" style={{ gap: 4 }}>
            <motion.button className="evo-node" onClick={() => nav('/evolution?tab=promotions')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .3 + i * .12 }}
              aria-label={`Version ${x.v} ${x.label}`}>
              <RobotAvatar role="optimize" hue={x.hue} size={62} faceMode="face" animated={i === 1} />
              <b>{x.v}</b>
              <span className="dim">{x.label}</span>
            </motion.button>
            {i < vs.length - 1 && <ArrowRight size={18} className="muted" />}
          </div>
        ))}
      </div>
    </Panel>
  );
}
