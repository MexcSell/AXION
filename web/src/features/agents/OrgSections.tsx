import { useCanEditAgents } from '@/hooks/useCanEditAgents';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ClipboardList, ScrollText, Lightbulb, Plus, Users,
  AlertTriangle, CheckCircle2, Undo2, FlaskConical, Scale, Shuffle, Move, Layers, Gavel, History,
} from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Panel } from '@/components/ui/Panel';
import { Segmented, SwitchRow } from '@/components/ui/Form';
import { isApi } from '@/api/mode';
import { ServerProposals } from './ServerProposals';
import { ServerDepartments } from './ServerDepartments';
import { CoverageCard } from './OrgCoverage';
import { Chip, DemoTag, AgentStatusChip } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { Tip } from '@/components/ui/Tip';
import { EmptyState } from '@/components/ui/EmptyState';
import { RingGauge, MeterRow } from '@/components/viz/Charts';
import { AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { DEPTS, CONSTITUTION, DELEGATION_RULES, POLICY_HISTORY, PROPOSALS, assignmentMatrix, type ProposalStage } from '@/data/orgdemo';
import { openDialog, toast } from '@/store/ui';
import { cx } from '@/lib/format';
import '@/theme/pages/overview-org-agent.css';

/* Former Organization page sections — now tabs of the merged Agents page. */
export interface OrgMove { agentId: string; from: string; to: string; }

/* ================================================================== */
/* DEPARTMENTS                                                         */
/* ================================================================== */
/** api mode: the server's department facts (improvement cycle 6); demo mode keeps the prototype below unchanged. */
export function Departments() { return isApi() ? <ServerDepartments /> : <DemoDepartments />; }

function DemoDepartments() {
  const nav = useNavigate();
  const canEdit = useCanEditAgents();
  return (
    <Panel icon={Building2} titleSize="lg" title="Departments" help="org.departments" sub="Charter, manager, capacity, skill coverage and KPIs." delay={.05} actions={<div className="row" style={{ gap: 8 }}>{isApi() && <DemoTag title="Capacity, coverage and KPIs are prototype numbers until agents are measured" />}{canEdit && <button className="btn primary" onClick={() => openDialog('department-create')}><Plus size={15} />New department</button>}</div>}>
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
                <span className="dim" style={{ fontSize: 12 }}>{d.memberIds.length} agents · {d.missions} missions</span>
                <span className="spacer" />
                {canEdit && <button className="btn sm" onClick={() => openDialog('department-create', { dept: d.name })}>Edit draft</button>}
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
export function Assignments() {
  const nav = useNavigate();
  const { missions, rows, conflicts } = useMemo(() => assignmentMatrix(), []);
  const [hl, setHl] = useState<{ r: number; c: number } | null>(null);
  return (
    <div className="oa-asg-grid">
      <Panel icon={ClipboardList} titleSize="lg" title="Assignment Matrix" help="org.assignments" sub="Agent workload per mission." delay={.05} actions={<div className="row" style={{ gap: 8 }}><DemoTag /><button className="btn" onClick={() => openDialog('agent-assign')}><Plus size={14} />Assign agent</button></div>}>
        <div className="oa-heat-scroll">
          <div className="oa-heat" style={{ gridTemplateColumns: `150px repeat(${missions.length}, minmax(56px, 1fr)) 64px` }}>
            <span />
            {missions.map((m) => <Tip key={m.id} label={m.title}><button className="oa-mx-h btn-like" onClick={() => nav(`/missions/${m.id}`)}>{m.id}</button></Tip>)}
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
                      onClick={() => v ? nav(`/missions/${missions[ci].id}?tab=hierarchy&agent=${r.a.id}`) : toast({ tone: 'info', title: `${r.a.name} is not on ${missions[ci].id}`, body: 'Use "Assign agent" to propose an instance.' })} aria-label={`${r.a.name} on ${missions[ci].id}: ${v}% allocation`}>{v || ''}</motion.button>
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
export function Policies() {
  const [caps, setCaps] = useState({ cross: true, spawn: false, selfApprove: false, merge: true });
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
        <SwitchRow label="Allow cross-department delegation" desc="High-risk tasks require GM review." checked={caps.cross} onChange={(v) => { setCaps({ ...caps, cross: v }); toast({ tone: 'info', title: 'Cap change is a draft (demo)', body: 'It applies after approval.' }); }} />
        <SwitchRow label="Allow agents to spawn sub-agents" desc="Off by default. Needs Owner approval." checked={caps.spawn} onChange={(v) => setCaps({ ...caps, spawn: v })} />
        <SwitchRow label="Allow self-approval of improvements" desc="Locked by constitution C-3." checked={false} onChange={() => toast({ tone: 'warning', title: 'Locked by constitution C-3' })} />
        <SwitchRow label="Merge mission experience into the original agent" desc="Each instance merges what it learned at a fixed interval." checked={caps.merge} onChange={(v) => setCaps({ ...caps, merge: v })} />
      </Panel>
      <div className="col" style={{ gap: 'var(--gap)' }}>
        {isApi() && <CoverageCard />}
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
/* PROPOSALS                                                           */
/* ================================================================== */
const STAGES: { key: ProposalStage; label: string }[] = [{ key: 'draft', label: 'Draft' }, { key: 'simulate', label: 'Simulate' }, { key: 'evaluate', label: 'Evaluate' }, { key: 'approve', label: 'Approve' }, { key: 'applied', label: 'Applied' }];
const KIND_ICON = { split: Layers, merge: Shuffle, reassign: Move, 'create-role': Plus, retire: Undo2 };

/** api mode: the server's proposals (improvement cycle 1); demo mode keeps the prototype below unchanged. */
export function Proposals() { return isApi() ? <ServerProposals /> : <DemoProposals />; }

function DemoProposals() {
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
                    <Chip hue={p.impact.cost <= 0 ? 145 : 38} size="sm">tokens {p.impact.cost > 0 ? '+' : ''}{p.impact.cost}%</Chip>
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

