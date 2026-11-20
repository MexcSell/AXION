import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Network, Building2, ClipboardList, ScrollText, TrendingUp, Lightbulb, Plus, GitPullRequest, ChevronRight, Users, Target,
  AlertTriangle, CheckCircle2, Undo2, FlaskConical, Scale, Shuffle, ArrowRight, Move, RotateCcw, Layers, Gavel, History, ShieldCheck,
} from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { Segmented, SwitchRow } from '@/components/ui/Form';
import { Chip, DemoTag, AgentStatusChip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { EmptyState } from '@/components/ui/EmptyState';
import { RingGauge, AreaChart, ColumnBars, MeterRow } from '@/components/viz/Charts';
import { CountUp } from '@/components/ui/CountUp';
import { AGENTS, AGENT_BY_ID, seeded } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { DEPTS, DEPT_BY_NAME, CONSTITUTION, DELEGATION_RULES, POLICY_HISTORY, PROPOSALS, assignmentMatrix, type ProposalStage, type Dept } from '@/data/orgdemo';
import { useData } from '@/store/data';
import { useTab } from '@/hooks/useTab';
import { openDialog, toast } from '@/store/ui';
import { cx, money } from '@/lib/format';
import '@/theme/pages/overview-org-agent.css';

export interface OrgMove { agentId: string; from: string; to: string; }

export default function OrganizationPage() {
  const [tab, setTab, tabs] = useTab('organization');
  const ICONS = [Network, Building2, ClipboardList, ScrollText, TrendingUp, Lightbulb];
  const [moves, setMoves] = useState<OrgMove[]>([]);
  return (
    <div className="page">
      <Panel className="oa-org-head" icon={Network} titleSize="lg" title="Organization" help="org.overview" sub="Manage AI agents, teams, structure and permissions." delay={0}
        actions={<div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => openDialog('department-create')}><Plus size={15} />New department</button>
          <button className="btn primary" onClick={() => openDialog('org-reorg-proposal', { moves })}><GitPullRequest size={15} />Propose reorganization{moves.length > 0 && <span className="oa-badge">{moves.length}</span>}</button>
        </div>}>
        <Tabs tabs={tabs.map((t, i) => ({ key: t, label: t, icon: ICONS[i] }))} value={tab} onChange={setTab} ariaLabel="Organization views" />
      </Panel>
      <AnimatePresence mode="wait">
        <motion.div key={tab} className="col" style={{ gap: 'var(--gap)' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab}>
          {tab === 'Org Chart' && <OrgChart moves={moves} setMoves={setMoves} />}
          {tab === 'Departments' && <Departments />}
          {tab === 'Assignments' && <Assignments />}
          {tab === 'Policies' && <Policies />}
          {tab === 'Performance' && <OrgPerformance />}
          {tab === 'Proposals' && <Proposals />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/* ORG CHART                                                           */
/* ================================================================== */
type View = 'tree' | 'graph' | 'matrix';
const W = 1000, H = 540, DT = 190;

function sharedMissions(a: Dept, b: Dept, missions: ReturnType<typeof useData.getState>['missions']) {
  return missions.filter((m) => m.agentIds.some((i) => AGENT_BY_ID[i]?.dept === a.name) && m.agentIds.some((i) => AGENT_BY_ID[i]?.dept === b.name)).length;
}

function OrgChart({ moves, setMoves }: { moves: OrgMove[]; setMoves: (m: OrgMove[]) => void }) {
  const nav = useNavigate();
  const [view, setView] = useState<View>('tree');
  const [sel, setSel] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const missions = useData((s) => s.missions);
  const gm = AGENT_BY_ID.gm;
  const depts = DEPTS.filter((d) => d.name !== 'Executive');
  const moved = (id: string) => moves.find((m) => m.agentId === id);
  const deptAgents = (d: Dept) => AGENTS.filter((a) => a.id !== 'gm' && (moved(a.id)?.to ?? a.dept) === d.name);
  const reps = (d: Dept) => [...deptAgents(d)].sort((a, b) => b.success - a.success).slice(0, 3);
  const box = useRef<HTMLDivElement>(null);
  const totalAgents = AGENTS.length;
  const activeMissions = missions.filter((m) => ['running', 'planning', 'verifying', 'waiting'].includes(m.status)).length;

  const pos = (_d: Dept, i: number) => {
    if (view === 'graph') {
      const ang = (i / depts.length) * Math.PI * 2 - Math.PI / 2;
      return { x: W / 2 + Math.cos(ang) * 360, y: 270 + Math.sin(ang) * 195 };
    }
    return { x: ((i + .5) / depts.length) * W, y: DT + 41 };
  };
  const gmPos = view === 'graph' ? { x: W / 2, y: 270 } : { x: W / 2, y: 62 };

  const onDrop = (agentId: string, pt: { x: number; y: number }) => {
    setDrag(null);
    const el = document.elementsFromPoint(pt.x, pt.y).find((e) => (e as HTMLElement).dataset?.dept) as HTMLElement | undefined;
    const to = el?.dataset.dept;
    const a = AGENT_BY_ID[agentId];
    const from = moved(agentId)?.to ?? a.dept;
    if (!to || to === from) return;
    const orig = moves.find((m) => m.agentId === agentId)?.from ?? a.dept;
    const rest = moves.filter((m) => m.agentId !== agentId);
    setMoves(to === orig ? rest : [...rest, { agentId, from: orig, to }]);
    toast({ tone: 'info', title: `Proposal only: ${a.name} to ${to}`, body: 'Nothing changes until the diff is reviewed and approved. Open "Propose reorganization".' });
  };

  const hl = (k: string) => (hov === k || sel === k);

  return (
    <div className="oa-org-grid">
      <Panel icon={Network} title="Company Structure" help="org.chart" delay={.05} className="oa-chart-panel"
        actions={<div className="row wrap" style={{ gap: 8 }}>
          <Segmented ariaLabel="Chart view" size="sm" value={view} onChange={setView} options={[{ key: 'tree', label: 'Tree' }, { key: 'graph', label: 'Graph' }, { key: 'matrix', label: 'Matrix' }]} />
          <HelpTrigger k="org.views" />
        </div>}>
        {view === 'matrix' ? <DeptMatrix missions={missions} /> : (
          <div className={cx('oa-chart', view)} ref={box} style={{ height: H }}>
            <div className="oa-chart-bg" aria-hidden />
            <svg className="oa-links" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
              <defs>
                <filter id="oa-glow"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              </defs>
              {depts.map((d, i) => {
                const p = pos(d, i);
                const on = hl(d.name);
                const y1 = view === 'graph' ? gmPos.y : gmPos.y + 68;
                const y2 = view === 'graph' ? p.y : DT;
                const path = view === 'graph'
                  ? `M${gmPos.x} ${gmPos.y} Q${(gmPos.x + p.x) / 2 + (i % 2 ? 24 : -24)} ${(gmPos.y + p.y) / 2} ${p.x} ${p.y}`
                  : `M${gmPos.x} ${y1} C${gmPos.x} ${y1 + 40} ${p.x} ${y2 - 40} ${p.x} ${y2}`;
                return (
                  <g key={d.name} style={{ ['--h' as string]: d.hue }}>
                    <motion.path d={path} className={cx('oa-link', on && 'on')} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .9, delay: .1 + i * .06 }} vectorEffect="non-scaling-stroke" />
                    <circle r={on ? 4.5 : 3} className="oa-pulse" style={{ fill: `hsl(${d.hue} 95% 68%)` }} filter="url(#oa-glow)">
                      <animateMotion dur={`${2.6 + (i % 4) * .35}s`} begin={`${i * .4}s`} repeatCount="indefinite" path={path} />
                    </circle>
                    {view === 'tree' && reps(d).length > 0 && <path d={`M${p.x} ${DT + 84} V${DT + 84 + Math.max(1, reps(d).length) * 70 - 14}`} className={cx('oa-link sub', on && 'on')} vectorEffect="non-scaling-stroke" />}
                  </g>
                );
              })}
              {view === 'graph' && depts.map((d, i) => depts.slice(i + 1).filter((e) => sharedMissions(d, e, missions) >= 3).map((e) => {
                const a = pos(d, i), b = pos(e, depts.indexOf(e));
                return <line key={d.name + e.name} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="oa-link dashed" vectorEffect="non-scaling-stroke" />;
              }))}
            </svg>

            <div className="oa-node gm" style={{ left: `${(gmPos.x / W) * 100}%`, top: gmPos.y }}><motion.div initial={{ scale: .5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }}>
              <button className="oa-gm" onClick={() => nav('/agents/gm')} aria-label="Open GM profile">
                <span className="oa-gm-halo" aria-hidden />
                <RobotAvatar role="manager" size={view === 'graph' ? 96 : 66} animated faceMode="face" status="good" />
                <b className="display">{view === 'graph' ? 'AXION Company' : 'GM'}</b>
                <span className="dim" style={{ fontSize: 11.5 }}>{view === 'graph' ? `${totalAgents} agents · ${activeMissions} missions` : `AXION Company · ${gm.version}`}</span>
              </button>
            </motion.div></div>

            {depts.map((d, i) => {
              const p = pos(d, i);
              const R = ROLES[d.role];
              const members = deptAgents(d);
              const proposed = moves.some((m) => m.to === d.name || m.from === d.name);
              return (
                <div key={d.name} data-dept={d.name} className="oa-col" style={{ left: `${(p.x / W) * 100}%`, top: view === 'tree' ? DT : p.y - 46, height: view === 'tree' ? H - DT : 92, ['--h' as string]: d.hue }}
                  onMouseEnter={() => setHov(d.name)} onMouseLeave={() => setHov(null)}>
                  <motion.button data-dept={d.name} className={cx('oa-dept', sel === d.name && 'sel', drag && 'drop', proposed && 'proposed')} onClick={() => setSel(sel === d.name ? null : d.name)}
                    initial={{ opacity: 0, y: -12, scale: .8 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .25 + i * .06, type: 'spring', stiffness: 260, damping: 20 }} aria-pressed={sel === d.name} aria-label={`${d.name}, ${members.length} agents`}>
                    <span className="oa-hex"><R.icon size={20} strokeWidth={1.8} /></span>
                    <b>{d.name}</b>
                    <span className="dim">{members.length} agents</span>
                    {proposed && <span className="oa-prop-dot" title="Has proposed changes" />}
                  </motion.button>
                  {view === 'tree' && (
                    <div className="oa-reps">
                      {reps(d).map((a, k) => (
                        <motion.div key={a.id} drag dragSnapToOrigin dragMomentum={false} whileDrag={{ scale: 1.15, zIndex: 40 }} onDragStart={() => setDrag(a.id)} onDragEnd={(_, info) => onDrop(a.id, info.point)}
                          className={cx('oa-rep', moved(a.id) && 'moved')} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .5 + i * .05 + k * .08 }}>
                          <Tip label={`${a.name} · drag onto a department to propose a move`}>
                            <button className="oa-rep-btn" onDoubleClick={() => nav(`/agents/${a.id}`)} onClick={() => nav(`/agents/${a.id}`)} aria-label={`${a.name}, open profile`}>
                              <RobotAvatar role={a.role} size={48} animated={k === 0 && a.status === 'in-mission'} status={a.status === 'in-mission' ? 'violet' : 'good'} />
                              <span className="ellipsis">{a.name}</span>
                            </button>
                          </Tip>
                          <Move size={11} className="oa-grip" aria-hidden />
                        </motion.div>
                      ))}
                      {members.length > 3 && <span className="oa-more">+{members.length - 3}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {view !== 'matrix' && <div className="oa-footer">
          <div className="oa-legend"><span><i className="solid" />Reports to</span><span><i className="dashed" />Shared missions</span><span><i className="dot" />Live delegation pulse</span></div>
          {view === 'tree' && <div className="oa-dragtip"><Move size={13} />Drag an agent onto another department to propose a move</div>}
        </div>}
        <AnimatePresence>
          {moves.length > 0 && (
            <motion.div className="oa-pending" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <GitPullRequest size={16} className="accent-on" />
              <div className="row wrap" style={{ gap: 6, flex: 1 }}>
                <b style={{ fontSize: 13 }}>Draft proposal ({moves.length})</b>
                {moves.map((m) => <Chip key={m.agentId} hue={DEPT_BY_NAME[m.to].hue}>{AGENT_BY_ID[m.agentId].name}: {m.from} <ArrowRight size={10} /> {m.to}</Chip>)}
              </div>
              <button className="btn sm ghost" onClick={() => setMoves([])}><RotateCcw size={13} />Discard</button>
              <button className="btn sm primary" onClick={() => openDialog('org-reorg-proposal', { moves })}>Review diff</button>
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>

      <div className="col" style={{ gap: 'var(--gap)' }}>
        <Panel icon={ShieldCheck} title="Organization Health" help="org.health" delay={.1}>
          <div className="row" style={{ gap: 16 }}>
            <RingGauge value={98} size={110} label="98%" />
            <div className="col" style={{ gap: 7, flex: 1, fontSize: 13 }}>
              {([['Agent availability', '99.9%'], ['Task execution', '96.8%'], ['Team collaboration', '97.6%'], ['Resource utilization', '87.4%']]).map(([k, v]) => (
                <div key={k} className="row" style={{ gap: 7 }}><CheckCircle2 size={14} className="good" /><span style={{ flex: 1 }}>{k}</span><b className="tnum">{v}</b></div>
              ))}
            </div>
          </div>
        </Panel>
        <Panel icon={Users} title="Teams & Agents" help="org.teams" delay={.15} actions={<button className="btn ghost sm" onClick={() => nav('/organization?tab=departments')}>View all<ArrowRight size={14} /></button>} className="oa-teams">
          <div className="col" style={{ gap: 4 }}>
            {depts.map((d, i) => {
              const R = ROLES[d.role];
              return (
                <motion.button key={d.name} className={cx('oa-team-row', sel === d.name && 'sel')} style={{ ['--h' as string]: d.hue }} onClick={() => setSel(sel === d.name ? null : d.name)} onMouseEnter={() => setHov(d.name)} onMouseLeave={() => setHov(null)}
                  initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .2 + i * .04 }}>
                  <ChevronRight size={14} className="dim" /><R.icon size={16} style={{ color: `hsl(${d.hue} 90% 66%)` }} /><span style={{ flex: 1, textAlign: 'left' }}>{d.name}</span>
                  <span className="dim tnum" style={{ fontSize: 12 }}>{deptAgents(d).length} agents</span>
                </motion.button>
              );
            })}
          </div>
          <AnimatePresence>
            {sel && DEPT_BY_NAME[sel] && (
              <motion.div className="oa-sel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>{DEPT_BY_NAME[sel].charter}</div>
                <div className="row" style={{ gap: 8 }}>
                  <RobotAvatar role={AGENT_BY_ID[DEPT_BY_NAME[sel].managerId].role} size={30} /><span style={{ fontSize: 12.5 }}>Manager <b>{AGENT_BY_ID[DEPT_BY_NAME[sel].managerId].name}</b></span>
                  <span className="spacer" /><button className="btn sm" onClick={() => nav('/organization?tab=departments')}>Open</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Panel>
      </div>

      <div className="oa-org-bottom">
        <Panel icon={Layers} title="Organization Metrics" help="org.metrics" delay={.2}>
          <div className="oa-mini-kpis">
            {[[Building2, DEPTS.length, 'Departments'], [Users, totalAgents, 'Agents'], [Target, activeMissions, 'Active missions'], [CheckCircle2, 96.4, 'Mission success']].map(([I, v, l], i) => {
              const Ic = I as typeof Users;
              return <motion.div key={l as string} className="oa-mini" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .25 + i * .06 }}><Ic size={22} /><b className="display"><CountUp value={v as number} decimals={i === 3 ? 1 : 0} suffix={i === 3 ? '%' : ''} /></b><span>{l as string}</span></motion.div>;
            })}
          </div>
        </Panel>
        <Panel icon={History} title="Recent Organization Activity" help="org.activity" delay={.25} actions={<DemoTag />}>
          <div className="col" style={{ gap: 2 }}>
            {[[CheckCircle2, 'good', 'Security-02 added to M-132 audit team', '10m'], [GitPullRequest, 'info', 'Proposal P-19 (Growth department) awaiting approval', '24m'], [Shuffle, 'warn', 'Tester-03 reassignment proposed to Mentor program', '1h'], [Undo2, 'dim', 'Rollback point r14 created for organization structure', '2h']].map(([I, t, text, ago_], i) => {
              const Ic = I as typeof Users;
              return <motion.div key={i} className="list-row" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .3 + i * .05 }}><Ic size={15} className={t as string} /><span style={{ flex: 1, fontSize: 13 }}>{text as string}</span><span className="dim tnum" style={{ fontSize: 12 }}>{ago_ as string}</span></motion.div>;
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DeptMatrix({ missions }: { missions: ReturnType<typeof useData.getState>['missions'] }) {
  const ds = DEPTS;
  return (
    <div className="oa-matrix-wrap">
      <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>Shared active missions between departments. Darker cells mean tighter collaboration and a higher cost of reorganizing across them.</div>
      <div className="oa-matrix" style={{ gridTemplateColumns: `110px repeat(${ds.length}, minmax(0, 1fr))` }}>
        <span />
        {ds.map((d) => <b key={d.name} className="oa-mx-h">{d.short}</b>)}
        {ds.map((a, i) => (
          <div key={a.name} style={{ display: 'contents' }}>
            <b className="oa-mx-h left">{a.name}</b>
            {ds.map((b, j) => {
              const n = i === j ? 0 : sharedMissions(a, b, missions);
              return (
                <Tip key={b.name} label={i === j ? `${a.name} (self)` : `${a.name} / ${b.name}: ${n} shared missions`}>
                  <motion.button className={cx('oa-cell', i === j && 'self')} style={{ ['--a' as string]: Math.min(1, n / 7) }} initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: (i + j) * .02 }}
                    onClick={() => toast({ tone: 'info', title: i === j ? a.name : `${a.name} / ${b.name}`, body: i === j ? `${a.memberIds.length} agents.` : `${n} shared missions. Reorganizing across this pair affects them.` })}>{i === j ? '' : n}</motion.button>
                </Tip>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/* DEPARTMENTS                                                         */
/* ================================================================== */
function Departments() {
  const nav = useNavigate();
  return (
    <Panel icon={Building2} titleSize="lg" title="Departments" help="org.departments" sub="Charter, manager, capacity, skill coverage and KPIs." delay={.05} actions={<button className="btn primary" onClick={() => openDialog('department-create')}><Plus size={15} />New department</button>}>
      <div className="oa-dept-grid">
        {DEPTS.map((d, i) => {
          const mgr = AGENT_BY_ID[d.managerId];
          const R = ROLES[d.role];
          return (
            <motion.article key={d.name} className="subpanel glass-card hoverable oa-dcard" style={{ ['--h' as string]: d.hue }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="oa-hex lg"><R.icon size={22} /></span>
                <div style={{ minWidth: 0 }}><b className="display" style={{ fontSize: 17 }}>{d.name}</b><div className="dim" style={{ fontSize: 12 }}>{d.memberIds.length} agents · {d.missions} missions</div></div>
                <span className="spacer" />
                <RingGauge value={d.capacity} size={58} stroke={7} label={`${d.capacity}%`} colors={[`hsl(${d.hue} 90% 62%)`, `hsl(${d.hue + 40} 90% 62%)`]} />
              </div>
              <p className="clamp-2 muted" style={{ fontSize: 12.5, margin: '10px 0' }}>{d.charter}</p>
              <button className="oa-mgr" onClick={() => nav(`/agents/${mgr.id}`)}><RobotAvatar role={mgr.role} size={34} /><div style={{ textAlign: 'left' }}><div className="dim" style={{ fontSize: 11 }}>Manager</div><b style={{ fontSize: 13 }}>{mgr.name}</b></div><span className="spacer" /><AgentStatusChip status={mgr.status} size="sm" /></button>
              <div className="section-label" style={{ margin: '10px 0 6px' }}>Skill coverage<HelpTrigger k="org.skillCoverage" /></div>
              <div className="col" style={{ gap: 5 }}>
                {d.skillCoverage.slice(0, 3).map((s) => <MeterRow key={s.skill} label={s.skill} value={s.pct} color={s.pct > 85 ? 'good' : 'warn'} />)}
              </div>
              <div className="oa-kpis3">
                {d.kpis.map((k) => (
                  <div key={k.label}><b className="tnum">{k.value}{k.unit}</b><span>{k.label}</span><em className={k.delta <= 0 === (k.label !== 'Verified success') ? 'good' : 'bad'}>{k.delta > 0 ? '+' : ''}{k.delta}</em></div>
                ))}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <span className="dim" style={{ fontSize: 12 }}>Budget {money(d.spend, 0)} / {money(d.budget, 0)}</span>
                <span className="spacer" />
                <button className="btn sm" onClick={() => openDialog('department-create', { dept: d.name })}>Edit draft</button>
                <button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: `Assign manager for ${d.name} (demo)`, body: 'Manager changes are proposals: they appear in Proposals for review.' })}>Assign manager</button>
              </div>
            </motion.article>
          );
        })}
      </div>
    </Panel>
  );
}

/* ================================================================== */
/* ASSIGNMENTS                                                         */
/* ================================================================== */
function Assignments() {
  const nav = useNavigate();
  const { missions, rows, conflicts } = useMemo(() => assignmentMatrix(), []);
  const [hl, setHl] = useState<{ r: number; c: number } | null>(null);
  return (
    <div className="oa-asg-grid">
      <Panel icon={ClipboardList} titleSize="lg" title="Assignment Matrix" help="org.assignments" sub="Agent workload per mission." delay={.05} actions={<div className="row" style={{ gap: 8 }}><DemoTag /><button className="btn" onClick={() => openDialog('agent-assign')}><Plus size={14} />Assign agent</button></div>}>
        <div className="oa-heat-scroll">
          <div className="oa-heat" style={{ gridTemplateColumns: `150px repeat(${missions.length}, minmax(56px, 1fr)) 64px` }}>
            <span />
            {missions.map((m) => <Tip key={m.id} label={m.title}><button className="oa-mx-h btn-like" onClick={() => nav(`/control/${m.id}`)}>{m.id}</button></Tip>)}
            <b className="oa-mx-h">Load</b>
            {rows.map((r, ri) => {
              const tot = r.cells.reduce((s, v) => s + v, 0);
              const over = tot > 180;
              return (
                <div key={r.a.id} style={{ display: 'contents' }}>
                  <button className="oa-agent-lbl" onClick={() => nav(`/agents/${r.a.id}`)}><RobotAvatar role={r.a.role} size={24} /><span className="ellipsis">{r.a.name}</span></button>
                  {r.cells.map((v, ci) => (
                    <motion.button key={ci} className={cx('oa-hc', v === 0 && 'zero', hl?.r === ri && hl?.c === ci && 'hl', over && v > 0 && 'warn')} style={{ ['--a' as string]: v / 100 }} initial={{ opacity: 0, scale: .5 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: (ri + ci) * .015 }}
                      onMouseEnter={() => setHl({ r: ri, c: ci })} onMouseLeave={() => setHl(null)}
                      onClick={() => v ? nav(`/control/${missions[ci].id}?tab=hierarchy&agent=${r.a.id}`) : toast({ tone: 'info', title: `${r.a.name} is not on ${missions[ci].id}`, body: 'Use "Assign agent" to propose an instance.' })} aria-label={`${r.a.name} on ${missions[ci].id}: ${v}% allocation`}>{v || ''}</motion.button>
                  ))}
                  <b className={cx('tnum', 'oa-total', over && 'bad')}>{tot}{over && <AlertTriangle size={11} />}</b>
                </div>
              );
            })}
          </div>
        </div>
        <div className="row" style={{ gap: 12, marginTop: 10, fontSize: 12 }} aria-hidden>
          <span className="dim">Allocation</span><span className="oa-scale" /><span className="dim">0 to 100%</span><span className="row" style={{ gap: 5 }}><i className="oa-key" style={{ background: 'var(--bad)' }} />Over 180% total</span>
        </div>
      </Panel>
      <div className="col" style={{ gap: 'var(--gap)' }}>
        <Panel icon={AlertTriangle} title="Conflict Warnings" help="org.conflicts" delay={.1} sub={`${conflicts.length} found`}>
          {conflicts.length === 0 ? <EmptyState icon={CheckCircle2} title="No conflicts" body="All agents are within their autonomy caps." /> : (
            <div className="col" style={{ gap: 8 }}>
              {conflicts.map((c, i) => {
                const a = AGENT_BY_ID[c.agentId];
                return (
                  <motion.div key={c.agentId} className="oa-conflict" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .15 + i * .06 }}>
                    <RobotAvatar role={a.role} size={34} />
                    <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13 }}>{a.name}</b><div className="dim" style={{ fontSize: 12 }}>{c.total}% across {c.n} missions (cap 180%)</div></div>
                    <button className="btn sm" onClick={() => openDialog('org-reorg-proposal', { moves: [], rebalance: c.agentId })}>Rebalance</button>
                  </motion.div>
                );
              })}
            </div>
          )}
        </Panel>
        <Panel icon={Users} title="Workload by agent" help="org.workload" delay={.15}>
          <div className="col" style={{ gap: 8 }}>
            {rows.slice(0, 7).map((r) => <MeterRow key={r.a.id} label={r.a.name} value={Math.min(100, Math.round(r.cells.reduce((s, v) => s + v, 0) / 2.2))} color={r.cells.reduce((s, v) => s + v, 0) > 180 ? 'bad' : r.a.load > 80 ? 'warn' : 'good'} />)}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================== */
/* POLICIES                                                            */
/* ================================================================== */
function Policies() {
  const [caps, setCaps] = useState({ cross: true, spawn: false, selfApprove: false, budget: true });
  return (
    <div className="oa-pol-grid">
      <Panel icon={ScrollText} titleSize="lg" title="Company Constitution" help="org.constitution" sub="Rules no agent can change on its own." delay={.05} actions={<button className="btn primary" onClick={() => toast({ tone: 'info', title: 'Policy proposal drafted (demo)', body: 'Policy changes need an authorized approver and create a new revision.' })}><Gavel size={15} />Propose policy</button>}>
        <div className="col" style={{ gap: 8 }}>
          {CONSTITUTION.map((c, i) => (
            <motion.div key={c.id} className="oa-const" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 + i * .06 }}>
              <span className="oa-const-id">{c.id}</span><div><b>{c.title}</b><div className="muted" style={{ fontSize: 13 }}>{c.text}</div></div>
            </motion.div>
          ))}
        </div>
        <div className="section-label" style={{ margin: '14px 0 4px' }}>Autonomy caps<HelpTrigger k="org.autonomy" /></div>
        <SwitchRow label="Allow cross-department delegation" desc="Over $20 budget requires GM review." checked={caps.cross} onChange={(v) => { setCaps({ ...caps, cross: v }); toast({ tone: 'info', title: 'Cap change is a draft (demo)', body: 'It applies after approval.' }); }} />
        <SwitchRow label="Allow agents to spawn sub-agents" desc="Off by default. Needs Owner approval." checked={caps.spawn} onChange={(v) => setCaps({ ...caps, spawn: v })} />
        <SwitchRow label="Allow self-approval of improvements" desc="Locked by constitution C-3." checked={false} onChange={() => toast({ tone: 'warning', title: 'Locked by constitution C-3' })} />
        <SwitchRow label="Enforce per-mission budgets" checked={caps.budget} onChange={(v) => setCaps({ ...caps, budget: v })} />
      </Panel>
      <div className="col" style={{ gap: 'var(--gap)' }}>
        <Panel icon={Scale} title="Delegation & Reporting Rules" help="org.delegation" delay={.1}>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Rule</th><th>Control</th></tr></thead>
            <tbody>{DELEGATION_RULES.map((r) => <tr key={r.rule}><td>{r.rule}</td><td><Chip hue={r.hue} size="sm">{r.cap}</Chip></td></tr>)}</tbody>
          </table></div>
        </Panel>
        <Panel icon={History} title="Revision History" help="org.policyHistory" delay={.15}>
          <div className="oa-timeline">
            {POLICY_HISTORY.map((p, i) => (
              <motion.div key={p.v} className="oa-tl" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .2 + i * .06 }}>
                <span className={cx('oa-tl-dot', p.status === 'active' && 'on')} />
                <div style={{ flex: 1 }}><b className="mono" style={{ fontSize: 12.5 }}>{p.v}</b> <span style={{ fontSize: 13 }}>{p.note}</span><div className="dim" style={{ fontSize: 11.5 }}>{p.by} · {p.agoD}d ago</div></div>
                {p.status === 'active' ? <Chip hue={145} size="sm">Active</Chip> : <button className="btn sm ghost" onClick={() => toast({ tone: 'warning', title: `Rollback to ${p.v} requires approval (demo)` })}><Undo2 size={12} />Roll back</button>}
              </motion.div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ================================================================== */
/* PERFORMANCE                                                         */
/* ================================================================== */
function OrgPerformance() {
  const [range, setRange] = useState('30d');
  const missions = useData((s) => s.missions);
  const n = range === '7d' ? 7 : range === '30d' ? 15 : 24;
  const series = useMemo(() => DEPTS.slice(1, 5).map((d, i) => { const r = seeded(d.name + range); return { label: d.name, color: ['var(--accent-2)', 'var(--accent)', 'var(--good)', 'var(--warn)'][i], data: Array.from({ length: n }, (_, k) => Math.round(84 + i * 2 + k * .3 + r() * 8)) }; }), [range, n]);
  const sorted = [...DEPTS].sort((a, b) => b.kpis[0].value - a.kpis[0].value);
  return (
    <>
      <div className="oa-grid-3">
        <Panel icon={TrendingUp} title="Department Outcomes" help="org.perfDept" delay={.05} actions={<Segmented ariaLabel="Time range" size="sm" value={range} onChange={setRange} options={[{ key: '7d', label: '7d' }, { key: '30d', label: '30d' }, { key: '90d', label: '90d' }]} />}>
          <div className="col" style={{ gap: 9 }}>
            {sorted.map((d, i) => (
              <button key={d.name} className="perf-row" onClick={() => toast({ tone: 'info', title: `${d.name} evidence`, body: `${d.kpis[0].value}% verified success over ${range}, ${d.memberIds.length} agents.` })}>
                <span className="oa-hex sm" style={{ ['--h' as string]: d.hue }}>{(() => { const I = ROLES[d.role].icon; return <I size={14} />; })()}</span>
                <span style={{ width: 100, textAlign: 'left' }} className="ellipsis">{d.name}</span>
                <span className="bar" style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${d.kpis[0].value}%` }} transition={{ duration: .9, delay: i * .05 }} /></span>
                <b className="tnum" style={{ width: 40, textAlign: 'right' }}>{d.kpis[0].value}%</b>
              </button>
            ))}
          </div>
        </Panel>
        <Panel icon={Network} title="Collaboration Quality" help="org.perfCollab" delay={.1} sub="shared missions, verified">
          <ColumnBars h={150} color="var(--accent-2)" data={DEPTS.map((d) => DEPTS.reduce((t, e) => t + (e === d ? 0 : sharedMissions(d, e, missions)), 0))} labels={DEPTS.map((d) => d.short)} />
          <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>Handoff acceptance 97.6% · median handoff delay 4 min</div>
        </Panel>
        <Panel icon={AlertTriangle} title="Bottlenecks & Leadership" help="org.perfBottleneck" delay={.15}>
          <div className="col" style={{ gap: 6 }}>
            {[['QA verification queue', 'Tester-02 at 86% load; 2 missions waiting on visual diff.', 'warn'], ['Browser origin grants', 'Median wait 38 min for approval.', 'warn'], ['Cross-department handoffs', 'Engineering to Operations is fastest (3 min).', 'good'], ['Manager review latency', 'GM answers delegation in 2 min.', 'good']].map(([k, v, t], i) => (
              <motion.div key={k} className="oa-bn" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .2 + i * .06 }}><span className={cx('oa-bn-dot', t)} /><div><b style={{ fontSize: 13 }}>{k}</b><div className="dim" style={{ fontSize: 12 }}>{v}</div></div></motion.div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel icon={TrendingUp} title="Verified success by department" help="org.perfTrend" delay={.2} actions={<DemoTag />}>
        <AreaChart series={series} labels={Array.from({ length: n }, (_, i) => `${i + 1}`)} h={190} min={80} max={100} unit="%" />
        <div className="row wrap" style={{ gap: 14, marginTop: 8, fontSize: 12 }}>{series.map((s) => <span key={s.label} className="row" style={{ gap: 5 }}><i className="oa-key" style={{ background: s.color }} />{s.label}</span>)}</div>
      </Panel>
    </>
  );
}

/* ================================================================== */
/* PROPOSALS                                                           */
/* ================================================================== */
const STAGES: { key: ProposalStage; label: string }[] = [{ key: 'draft', label: 'Draft' }, { key: 'simulate', label: 'Simulate' }, { key: 'evaluate', label: 'Evaluate' }, { key: 'approve', label: 'Approve' }, { key: 'applied', label: 'Applied' }];
const KIND_ICON = { split: Layers, merge: Shuffle, reassign: Move, 'create-role': Plus, retire: Undo2 };

function Proposals() {
  const [stages, setStages] = useState<Record<string, ProposalStage>>(() => Object.fromEntries(PROPOSALS.map((p) => [p.id, p.stage])));
  const [filter, setFilter] = useState<'all' | ProposalStage>('all');
  const list = PROPOSALS.filter((p) => filter === 'all' || stages[p.id] === filter);
  const advance = (id: string) => {
    const i = STAGES.findIndex((s) => s.key === stages[id]);
    if (i >= STAGES.length - 1) return;
    const nx = STAGES[i + 1];
    setStages({ ...stages, [id]: nx.key });
    toast({ tone: 'success', title: nx.key === 'applied' ? 'Applied to new missions (demo)' : `Moved to ${nx.label} (demo)`, body: nx.key === 'applied' ? 'Running missions stay pinned. A rollback point was created.' : nx.key === 'approve' ? 'Independent evaluation completed. Owner approval is next.' : undefined });
  };
  return (
    <Panel icon={Lightbulb} titleSize="lg" title="Organization Proposals" help="org.proposals" sub="Simulate, evaluate, approve, apply with rollback." delay={.05}
      actions={<div className="row wrap" style={{ gap: 8 }}><Segmented ariaLabel="Stage filter" size="sm" value={filter} onChange={setFilter} options={[{ key: 'all', label: 'All' }, ...STAGES.slice(0, 4).map((s) => ({ key: s.key, label: s.label }))]} /><DemoTag /></div>}>
      {list.length === 0 ? <EmptyState icon={Lightbulb} title="No proposals in this stage" action={<button className="btn" onClick={() => setFilter('all')}>Show all</button>} /> : (
        <div className="oa-prop-grid">
          <AnimatePresence>
            {list.map((p, i) => {
              const st = stages[p.id];
              const si = STAGES.findIndex((s) => s.key === st);
              const KI = KIND_ICON[p.kind];
              const nextLabel = ['Run simulation', 'Evaluate', 'Approve', 'Apply', ''][si];
              return (
                <motion.article key={p.id} layout className="subpanel glass-card hoverable oa-pcard" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * .05 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="oa-hex"><KI size={18} /></span>
                    <div style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 14 }}>{p.title}</b><div className="dim" style={{ fontSize: 11.5 }}>{p.id} · by {p.by} · {p.agoD === 0 ? 'today' : `${p.agoD}d ago`} · {p.kind}</div></div>
                  </div>
                  <p className="muted" style={{ fontSize: 12.5, margin: '8px 0' }}>{p.summary}</p>
                  <div className="oa-stepper" role="list" aria-label="Proposal stages">
                    {STAGES.map((s, k) => (
                      <div key={s.key} role="listitem" className={cx('oa-step', k < si && 'done', k === si && 'cur')}>
                        <span className="oa-step-dot">{k < si ? <CheckCircle2 size={13} /> : k + 1}</span><span>{s.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="row wrap" style={{ gap: 6, margin: '10px 0' }}>
                    <Chip hue={p.impact.coverage >= 0 ? 145 : 30} size="sm">coverage {p.impact.coverage >= 0 ? '+' : ''}{p.impact.coverage}%</Chip>
                    <Chip hue={p.impact.latency <= 0 ? 145 : 30} size="sm">latency {p.impact.latency > 0 ? '+' : ''}{p.impact.latency}%</Chip>
                    <Chip hue={p.impact.cost <= 0 ? 145 : 38} size="sm">cost {p.impact.cost > 0 ? '+' : ''}{p.impact.cost}%</Chip>
                    <span className="spacer" />
                    <span className="row" style={{ gap: 0 }}>{p.agentIds.slice(0, 4).map((id) => AGENT_BY_ID[id] && <span key={id} style={{ marginLeft: -8 }}><RobotAvatar role={AGENT_BY_ID[id].role} size={26} /></span>)}</span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {st === 'applied' ? <button className="btn sm" onClick={() => toast({ tone: 'warning', title: 'Rollback prepared (demo)', body: 'Restores the last valid structure; mission history is kept.' })}><Undo2 size={13} />Roll back</button>
                      : <button className="btn sm primary" onClick={() => advance(p.id)}><FlaskConical size={13} />{nextLabel}</button>}
                    <button className="btn sm ghost" onClick={() => openDialog('org-reorg-proposal', { moves: p.agentIds.slice(0, 2).map((id, k) => ({ agentId: id, from: AGENT_BY_ID[id].dept, to: DEPTS[(DEPTS.findIndex((d) => d.name === AGENT_BY_ID[id].dept) + 1 + k) % DEPTS.length].name })), readOnly: true, title: p.title })}>View diff</button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </Panel>
  );
}

