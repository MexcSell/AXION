import { AnimatePresence, motion } from 'motion/react';
import { useAgentsCatalog, useAgentInstances, useAgentVersions } from '@/api/agents';
import { useCanEditAgents } from '@/hooks/useCanEditAgents';
import { ProvenanceChip, ProvTag, needsEvidence, NOT_ENOUGH } from '@/components/agents/Provenance';
import { ReliabilityStat } from '@/components/agents/Reliability';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Bot, Radar as RadarIcon, Wrench, Boxes, MessagesSquare, MessageCircle, Brain, Gauge, GraduationCap, Dna, ScrollText, ArrowLeft, Target, PencilLine,
  Crown, Sparkles, Lock, CheckCircle2, XCircle, ArrowRight, Clock, ShieldCheck, FlaskConical, MoreHorizontal, KeyRound, Check, X, TrendingUp, Fingerprint, UserRound, GitBranchPlus, RotateCcw,
} from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { Chip, AgentStatusChip, RoleChip, InstanceStateChip, DemoTag } from '@/components/ui/Chips';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { EmptyState } from '@/components/ui/EmptyState';
import { GrowthBadge, LevelPips, EvoTrack } from '@/features/agents/Growth';
import { Menu } from '@/components/ui/Menu';
import { Segmented } from '@/components/ui/Form';
import { CountUp } from '@/components/ui/CountUp';
import { IconButton } from '@/components/ui/IconButton';
import { Radar, AreaChart, Sparkline, RingGauge } from '@/components/viz/Charts';
import { activityFor, fmtTokens } from '@/data/activity';
import { ChannelChat } from '@/features/chat/ChannelChat';
import { VersionProposalList } from '@/features/agents/VersionProposals';
import { ServerMentoring } from '@/features/agents/Mentoring';
import { channelId } from '@/store/chat';
import { useMe } from '@/store/auth';
import { AGENTS, AGENT_BY_ID } from '@/data/agents';
import { ROLES } from '@/data/roles';
import { getMissionControl } from '@/data/missions';
import { useMissionControls } from '@/api/missionControl';
import { hasDemoActivity, isApi } from '@/api/mode';
import { METRIC_KEYS, METRIC_LABELS, DEPT_BY_NAME, metricSample, toolsFor, memoryFor, auditFor, evolutionFor, mentoringFor, perfSeries } from '@/data/orgdemo';
import type { Agent } from '@/data/types';
import { useTab } from '@/hooks/useTab';
import { useVisibleMissions } from '@/store/data';
import { openDialog, toast } from '@/store/ui';
import { ago, cx } from '@/lib/format';
import '@/theme/pages/overview-org-agent.css';

export default function AgentProfilePage() {
  useAgentsCatalog(); // a renamed or upgraded agent shows at once (agent.* events)
  const { id } = useParams();
  const agent = id ? AGENT_BY_ID[id] : undefined;
  if (!agent) {
    return (
      <div className="page">
        <Panel className="oa-notfound">
          <EmptyState icon={Bot} title="Agent not found" body={`There is no agent with the id "${id ?? ''}". It may have been retired or the link is wrong.`} action={<Link to="/agents" className="btn primary"><ArrowLeft size={15} />Back to Agents</Link>} />
        </Panel>
      </div>
    );
  }
  return <Profile key={agent.id} agent={agent} />;
}

const grade = (g: Agent['grade']) => ({ S: { hue: 46, label: 'S' }, A: { hue: 190, label: 'A' }, B: { hue: 268, label: 'B' }, C: { hue: 225, label: 'C' } }[g]);

function Profile({ agent }: { agent: Agent }) {
  const nav = useNavigate();
  const [tab, setTab, tabs] = useTab('agentProfile');
  const ICONS = [Bot, RadarIcon, Wrench, Boxes, MessagesSquare, Brain, Gauge, GraduationCap, Dna, ScrollText];
  const R = ROLES[agent.role];
  const G = grade(agent.grade);
  const canEdit = useCanEditAgents();
  const noEv = needsEvidence(agent); // api mode: measured, but fewer than 5 evaluated tasks
  const overall = Math.round(Object.values(agent.metrics).reduce((s, v) => s + v, 0) / 8);
  const top = METRIC_KEYS.slice().sort((a, b) => agent.metrics[b] - agent.metrics[a]).slice(0, 6);
  const mgr = agent.managerId ? AGENT_BY_ID[agent.managerId] : undefined;
  return (
    <div className="page">
      <motion.section className="panel oa-hero" style={{ ['--h' as string]: R.hue, ['--h2' as string]: R.hue2 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45 }}>
        <div className="oa-hero-bg" aria-hidden><i /><i /><i /></div>
        <div className="oa-hero-top">
          <button className="btn ghost sm" onClick={() => nav('/agents')}><ArrowLeft size={14} />Agents</button>
          <span className="dim" style={{ fontSize: 12 }}>/ {agent.name}</span>
        </div>
        <div className="oa-hero-body">
          <div className="oa-card-art">
            <div className="oa-ring" aria-hidden />
            <div className="oa-ring r2" aria-hidden />
            <motion.div animate={{ y: [0, -7, 0] }} transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}>
              <RobotAvatar role={agent.role} size={196} faceMode="face" animated status={agent.status === 'idle' ? 'muted' : 'good'} />
            </motion.div>
            <motion.div className="oa-grade" style={{ ['--gh' as string]: G.hue }} initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: .3 }} title={`Grade ${agent.grade}, based on verified success over ${agent.sample} tasks`}>
              <b>{noEv ? '–' : G.label}</b><span>GRADE</span>
            </motion.div>
            <div className="oa-overall"><b className="display">{noEv ? '–' : <CountUp value={overall} />}</b><span>OVR</span></div>
          </div>
          <div className="oa-hero-main">
            <div className="row wrap" style={{ gap: 10 }}>
              <h1 className="display oa-name">{agent.name}</h1>
              <HelpTrigger k="agent.grade" />
            </div>
            <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
              <RoleChip role={agent.role} /><AgentStatusChip status={agent.status} /><Chip hue={225} className="mono">{agent.version}</Chip><Chip hue={R.hue2}>{agent.dept}</Chip>
              <span className="dim" style={{ fontSize: 12.5 }}>{agent.model}</span>
            </div>
            <div className="oa-dev row wrap" style={{ gap: 12, marginTop: 10 }}>
              <GrowthBadge agent={agent} />
              <LevelPips level={agent.level} xp={agent.xp} />
              <EvoTrack agent={agent} />
              {agent.growth !== 'stable' && <span className="dim ellipsis" style={{ fontSize: 12, maxWidth: 360 }}>{agent.growthNote}</span>}
              <HelpTrigger k="agents.devStages" />
            </div>
            <p className="muted" style={{ maxWidth: 560, margin: '10px 0 14px', fontSize: 13.5 }}>{agent.description}</p>
            {isApi() && <div className="row wrap" style={{ gap: 8, margin: '-4px 0 8px' }}><ProvenanceChip agent={agent} />{noEv && <span className="dim" style={{ fontSize: 12.5 }} data-evidence="none">{NOT_ENOUGH}</span>}</div>}
            {!noEv && <div className="oa-stats">
              {top.map((k, i) => (
                <motion.button key={k} className="oa-stat" onClick={() => openDialog('agent-evidence', { agentId: agent.id, metric: k })} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .25 + i * .05 }} aria-label={`${METRIC_LABELS[k]} ${agent.metrics[k]}, open evidence`}>
                  <b className="display"><CountUp value={agent.metrics[k]} /></b><span>{METRIC_LABELS[k]}</span>
                  <i className="oa-stat-bar"><motion.em initial={{ width: 0 }} animate={{ width: `${agent.metrics[k]}%` }} transition={{ duration: 1, delay: .4 + i * .05 }} /></i>
                </motion.button>
              ))}
            </div>}
          </div>
          <div className="oa-hero-side">
            <ReliabilityStat agent={agent} />
            <div className="oa-kv-big"><div><b className="display tnum">{noEv ? '–' : <CountUp value={agent.success} suffix="%" />}</b><span>Verified success</span></div><div><b className="display tnum">{agent.sample}</b><span>Tasks evaluated</span></div><div><b className="display tnum">{agent.missions}</b><span>Missions</span></div><div><b className="display tnum">{agent.load}%</b><span>Load</span></div></div>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn primary" onClick={() => openDialog('agent-assign', { agentId: agent.id })}><Target size={15} />Assign to mission</button>
              <button className="btn" onClick={() => openDialog('mentoring-session', { agentId: agent.id })}><GraduationCap size={15} />Mentor</button>
              {canEdit && <button className="btn" onClick={() => openDialog('agent-edit', { agentId: agent.id })}><PencilLine size={15} />Edit</button>}
              <Menu trigger={<button className="icon-btn" aria-label="More actions"><MoreHorizontal size={16} /></button>} items={[
                { label: 'Open org chart', icon: Crown, onSelect: () => nav('/agents?view=hierarchy') },
                { label: 'Request tool grant', icon: KeyRound, onSelect: () => openDialog('tools-permission', { agentId: agent.id }) },
                { label: 'Pause new instances', icon: Clock, onSelect: () => toast({ tone: 'warning', title: `${agent.name}: new instances paused (demo)`, body: 'Running instances continue on their pinned version.' }) },
              ]} />
            </div>
            <div className="dim" style={{ fontSize: 12 }}>{mgr ? <>Reports to <button className="oa-link-btn" onClick={() => nav(`/agents/${mgr.id}`)}>{mgr.name}</button> · </> : null}created {agent.createdAgo}d ago</div>
          </div>
        </div>
      </motion.section>

      <motion.div className="oa-tabbar panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 }}>
        <Tabs tabs={tabs.map((t, i) => ({ key: t, label: t, icon: ICONS[i] }))} value={tab} onChange={setTab} ariaLabel="Agent profile sections" />
      </motion.div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} className="fit-scroll col" style={{ gap: 'var(--gap)' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }} role="tabpanel" aria-label={tab}>
          {tab === 'Profile' && <ProfileTab a={agent} />}
          {tab === 'Capabilities' && <CapabilitiesTab a={agent} />}
          {tab === 'Tools' && <ToolsTab a={agent} />}
          {tab === 'Instances' && <InstancesTab a={agent} />}
          {tab === 'Conversations' && <ConversationsTab a={agent} />}
          {tab === 'Memory' && <MemoryTab a={agent} />}
          {tab === 'Performance' && <PerformanceTab a={agent} />}
          {tab === 'Mentoring' && <MentoringTab a={agent} />}
          {tab === 'Evolution' && <EvolutionTab a={agent} />}
          {tab === 'Audit' && <AuditTab a={agent} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- */
function useAgentMissions(a: Agent) {
  const missions = useVisibleMissions();
  return useMemo(() => missions.filter((m) => m.agentIds.includes(a.id)), [missions, a.id]);
}

function ProfileTab({ a }: { a: Agent }) {
  const nav = useNavigate();
  const ms = useAgentMissions(a);
  const inst = useAgentInstances(isApi() ? a.id : undefined); // api mode: this agent's instances, each with its pinned version
  const allMissions = useVisibleMissions();
  const dept = DEPT_BY_NAME[a.dept];
  const mgr = a.managerId ? AGENT_BY_ID[a.managerId] : undefined;
  const eligible = ms.filter((m) => ['running', 'planning', 'verifying', 'waiting'].includes(m.status)).length;
  return (
    <div className="oa-grid-2b">
      <Panel icon={Fingerprint} title="Identity" help="agent.identity" delay={.05}>
        <dl className="kv oa-kv">
          <dt>Role</dt><dd><RoleChip role={a.role} size="sm" /></dd>
          <dt>Department</dt><dd>{a.dept}</dd>
          <dt>Manager</dt><dd>{mgr ? <button className="oa-link-btn" onClick={() => nav(`/agents/${mgr.id}`)}>{mgr.name}</button> : 'Owner'}</dd>
          <dt>Owner</dt><dd>Luca (Owner)</dd>
          <dt>Active version</dt><dd className="mono">{a.version} <span className="dim">(pinned for new instances)</span></dd>
          <dt>Status</dt><dd><AgentStatusChip status={a.status} size="sm" /></dd>
          <dt>Model route</dt><dd className="mono">{a.model}</dd>
          <dt>Avatar</dt><dd>Synthetic robot, {ROLES[a.role].label} emblem</dd>
          <dt>Created</dt><dd>{a.createdAgo} days ago</dd>
        </dl>
      </Panel>
      <Panel icon={Sparkles} title="Skills & Eligibility" help="agent.eligibility" delay={.1}>
        <div className="row wrap" style={{ gap: 6 }}>{a.skills.map((s, i) => <motion.span key={s} initial={{ opacity: 0, scale: .7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .15 + i * .05 }}><Chip hue={ROLES[a.role].hue}>{s}</Chip></motion.span>)}</div>
        <div className="section-label" style={{ margin: '14px 0 8px' }}>Mission eligibility</div>
        <div className="col" style={{ gap: 6, fontSize: 13 }}>
          <div className="row" style={{ gap: 8 }}><CheckCircle2 size={15} className="good" />Eligible for {ROLES[a.role].label.toLowerCase()} tasks in any mission it is staffed on</div>
          <div className="row" style={{ gap: 8 }}>{a.status === 'idle' ? <XCircle size={15} className="warn" /> : <CheckCircle2 size={15} className="good" />}{a.status === 'idle' ? 'Idle: no current instances. Can be assigned.' : `Running ${eligible} active instance${eligible === 1 ? '' : 's'} (cap 3)`}</div>
          <div className="row" style={{ gap: 8 }}><Lock size={15} className="warn" />Needs separate grants for browser origins and write tools</div>
        </div>
        {dept && <div className="oa-deptline"><span className="dim" style={{ fontSize: 12 }}>Department capacity</span><div className="bar thin" style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${dept.capacity}%` }} transition={{ duration: .9 }} /></div><b className="tnum">{dept.capacity}%</b></div>}
      </Panel>
      <Panel icon={Boxes} title="Current Missions" help="agent.missions" delay={.15} className="oa-span2">
        {isApi() ? (
          inst.error && !inst.data ? <div className="oa-banner" role="alert"><span>The instances could not be read: {inst.error}</span><button className="btn sm" onClick={inst.retry}>Retry</button></div>
          : !inst.data ? <div className="dim" style={{ fontSize: 13 }} data-state="loading">Loading instances…</div>
          : inst.data.filter((i) => allMissions.some((m) => m.id === i.missionId)).length === 0 ? <EmptyState icon={Boxes} title="No missions yet" body="Assign this agent to a mission to create its first instance." />
          : <div className="oa-mission-chips" data-current-missions>
              {inst.data.map((i) => ({ i, m: allMissions.find((m) => m.id === i.missionId) })).filter((x) => x.m).slice(0, 6).map(({ i, m }, k) => (
                <motion.button key={i.id} className="subpanel glass-card hoverable oa-mchip" data-instance={i.id} onClick={() => nav(`/missions/${m!.id}`)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 + k * .05 }}>
                  <div className="row" style={{ gap: 6 }}><span className="mono dim" style={{ fontSize: 11 }}>{m!.id}</span><span className="spacer" /><Chip hue={225} size="sm" className="mono">{i.versionLabel}</Chip></div>
                  <div className="clamp-2" style={{ fontWeight: 600, fontSize: 13, textAlign: 'left', margin: '4px 0 8px' }}>{m!.title}</div>
                  <div className="row" style={{ gap: 6 }}><InstanceStateChip state={i.state as never} size="sm" /><div className="bar thin good" style={{ flex: 1 }}><i style={{ width: `${i.progress}%` }} /></div><b className="tnum" style={{ fontSize: 12 }}>{i.progress}%</b></div>
                </motion.button>
              ))}
            </div>
        ) : ms.length === 0 ? <EmptyState icon={Boxes} title="No missions yet" body="Assign this agent to a mission to create its first instance." action={<button className="btn primary" onClick={() => openDialog('agent-assign', { agentId: a.id })}>Assign to mission</button>} /> : (
          <div className="oa-mission-chips">
            {ms.slice(0, 6).map((m, i) => (
              <motion.button key={m.id} className="subpanel glass-card hoverable oa-mchip" onClick={() => nav(`/missions/${m.id}`)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 + i * .05 }}>
                <div className="row" style={{ gap: 6 }}><span className="mono dim" style={{ fontSize: 11 }}>{m.id}</span><span className="spacer" />{m.leadId === a.id && <Chip hue={46} size="sm"><Crown size={10} />Lead</Chip>}</div>
                <div className="clamp-2" style={{ fontWeight: 600, fontSize: 13, textAlign: 'left', margin: '4px 0 8px' }}>{m.title}</div>
                <div className="row" style={{ gap: 6 }}><div className="bar thin good" style={{ flex: 1 }}><i style={{ width: `${m.progress}%` }} /></div><b className="tnum" style={{ fontSize: 12 }}>{m.progress}%</b></div>
              </motion.button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function CapabilitiesTab({ a }: { a: Agent }) {
  const [cmp, setCmp] = useState<'none' | 'dept'>('dept');
  const peers = AGENTS.filter((x) => x.dept === a.dept && x.id !== a.id);
  const avg = METRIC_KEYS.map((k) => Math.round(peers.reduce((s, x) => s + x.metrics[k], 0) / Math.max(1, peers.length)));
  if (needsEvidence(a)) return <Panel icon={Gauge} titleSize="lg" title="Capabilities" help="agent.metricEvidence" actions={<ProvenanceChip agent={a} />}><EmptyState icon={Gauge} title="Not enough evidence yet" body={`${NOT_ENOUGH}. Scores come from verified tasks and are never guessed.`} /></Panel>;
  return (
    <div className="oa-grid-2b">
      <Panel icon={RadarIcon} title="Capability Radar" help="agent.capabilities" delay={.05} actions={<div className="row" style={{ gap: 8 }}><Segmented ariaLabel="Compare" size="sm" value={cmp} onChange={setCmp} options={[{ key: 'none', label: 'Agent' }, { key: 'dept', label: 'vs dept' }]} /><ProvTag agent={a} /></div>}>
        <div className="oa-radar"><Radar axes={METRIC_KEYS.map((k) => METRIC_LABELS[k].replace('Tool precision', 'Precision'))} values={METRIC_KEYS.map((k) => a.metrics[k])} compare={cmp === 'dept' ? avg : undefined} size={340} color={`hsl(${ROLES[a.role].hue} 95% 66%)`} /></div>
        <div className="dim" style={{ fontSize: 12, textAlign: 'center' }}>Scores come from tests and verified missions. They never grant permissions.</div>
      </Panel>
      <Panel icon={Gauge} title="Metrics with evidence" help="agent.metricEvidence" delay={.1} sub="click a row to inspect" actions={<ProvenanceChip agent={a} />}>
        <div className="col" style={{ gap: 4 }}>
          {METRIC_KEYS.map((k, i) => {
            const v = a.metrics[k]; const n = metricSample(a, k);
            return (
              <motion.button key={k} className="oa-metric" onClick={() => openDialog('agent-evidence', { agentId: a.id, metric: k })} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .12 + i * .04 }} aria-label={`${METRIC_LABELS[k]} ${v}, sample ${n}. Open evidence`}>
                <span style={{ width: 112, textAlign: 'left', fontWeight: 600, fontSize: 13 }}>{METRIC_LABELS[k]}</span>
                <span className={cx('bar', v >= 90 ? 'good' : v >= 75 ? '' : 'warn')} style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: .9, delay: .15 + i * .04 }} /></span>
                <b className="tnum" style={{ width: 30, textAlign: 'right' }}>{v}</b>
                <span className="dim tnum" style={{ width: 62, textAlign: 'right', fontSize: 11.5 }}>n={n}</span>
                <span className="dim" style={{ width: 52, fontSize: 11.5 }}>{(i * 3 + 2)}d ago</span>
                <ArrowRight size={13} className="dim" />
              </motion.button>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function ToolsTab({ a }: { a: Agent }) {
  const tools = useMemo(() => toolsFor(a), [a]);
  return (
    <Panel icon={Wrench} titleSize="lg" title="Tools & Permissions" help="agent.tools" delay={.05} sub="Capability is not authorization." actions={<button className="btn primary" onClick={() => openDialog('tools-permission', { agentId: a.id })}><KeyRound size={15} />Request grant</button>}>
      <div className="oa-banner"><ShieldCheck size={16} /><span>A registered tool is only a capability. Use requires an active, scoped, expiring grant.</span></div>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="table">
          <thead><tr><th>Tool</th><th>Provider</th><th>Grant</th><th>Actions</th><th>Allowed sites</th><th>Expiry</th><th>Last use</th><th>Risk</th><th /></tr></thead>
          <tbody>
            {tools.map((t, i) => (
              <motion.tr key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }}>
                <td><b>{t.name}</b></td><td className="dim">{t.provider}</td>
                <td>{t.granted ? <Chip hue={145} size="sm"><CheckCircle2 size={10} />Granted</Chip> : <Chip hue={225} size="sm"><Lock size={10} />Not granted</Chip>}</td>
                <td className="mono" style={{ fontSize: 12 }}>{t.granted ? t.scopes : '-'}</td>
                <td className="dim ellipsis" style={{ maxWidth: 200 }}>{t.granted ? t.sites : '-'}</td>
                <td className="tnum">{t.expiryD ? `${t.expiryD}d` : '-'}</td>
                <td className="tnum dim">{t.granted ? ago(t.lastUseMin) : 'never'}</td>
                <td><Chip hue={t.risk === 'high' ? 350 : t.risk === 'medium' ? 38 : 145} size="sm">{t.risk}</Chip></td>
                <td><button className="btn sm ghost" onClick={() => t.granted ? toast({ tone: 'warning', title: `Revoke ${t.name}? (demo)`, body: 'Revocation takes effect on next use and is audited.' }) : openDialog('tools-permission', { agentId: a.id, tool: t.name })}>{t.granted ? 'Revoke' : 'Request'}</button></td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function InstancesTab({ a }: { a: Agent }) {
  const nav = useNavigate();
  const ms = useAgentMissions(a);
  const allMissions = useVisibleMissions();
  useMissionControls(isApi() ? [] : ms.map((m) => m.id), ['hierarchy']); // demo mode: the fixture's instances
  const srv = useAgentInstances(isApi() ? a.id : undefined); // api mode: GET /agent-instances?agentId=
  const rows = isApi()
    ? (srv.data ?? []).flatMap((i) => { const m = allMissions.find((x) => x.id === i.missionId); return m ? [{ m, n: { instanceId: i.id, agentId: i.agentId, task: i.task, state: i.state as never, progress: i.progress, versionLabel: i.versionLabel, simulated: i.simulated } }] : []; })
    : ms.flatMap((m) => getMissionControl(m).nodes.filter((n) => n.agentId === a.id).map((n) => ({ m, n: { ...n, simulated: false } })));
  if (isApi() && !srv.data) return <Panel icon={Boxes} titleSize="lg" title="Instances" help="agent.instance" delay={.05}>{srv.error ? <div className="oa-banner" role="alert"><span>The instances could not be read: {srv.error}</span><button className="btn sm" onClick={srv.retry}>Retry</button></div> : <div className="dim" style={{ fontSize: 13 }} data-state="loading">Loading instances…</div>}</Panel>;
  return (
    <Panel icon={Boxes} titleSize="lg" title="Instances" help="agent.instance" sub="Each mission gets its own memory, grants and pinned version." delay={.05} actions={<button className="btn primary" onClick={() => openDialog('agent-assign', { agentId: a.id })}><Target size={15} />New instance</button>}>
      {rows.length === 0 ? <EmptyState icon={Boxes} title="No instances" body="This agent has not been staffed on a mission yet." /> : (
        <div className="oa-inst-grid">
          {rows.map(({ m, n }, i) => (
            <motion.div key={n.instanceId} className="subpanel glass-card hoverable oa-inst" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }}>
              <div className="row" style={{ gap: 8 }}><span className="mono dim" style={{ fontSize: 11.5 }}>{n.instanceId}</span>{n.simulated && <span className="sim-tag" title="Simulated on a DEMO mission. Agents do not execute yet.">Simulated</span>}<span className="spacer" /><InstanceStateChip state={n.state} size="sm" /></div>
              <b className="clamp-2" style={{ margin: '6px 0 2px', fontSize: 13.5 }}>{m.title}</b>
              <div className="dim ellipsis" style={{ fontSize: 12 }}>{n.task}</div>
              <div className="row" style={{ gap: 6, margin: '10px 0' }}><div className="bar thin good" style={{ flex: 1 }}><motion.i initial={{ width: 0 }} animate={{ width: `${n.progress}%` }} transition={{ duration: .8, delay: .1 + i * .04 }} /></div><b className="tnum" style={{ fontSize: 12 }}>{n.progress}%</b></div>
              <dl className="kv oa-kv sm"><dt>Pinned</dt><dd className="mono" data-pinned>{n.versionLabel ?? a.version}</dd><dt>Memory</dt><dd>scope {m.id} (isolated)</dd><dt>Tokens</dt><dd>{hasDemoActivity(m) ? fmtTokens(activityFor(m, a.id).tokens) : <span className="dim" title="Measured once agents execute (Stage 9/10)">not measured yet</span>}</dd><dt>Tasks</dt><dd>{'tasks' in n ? `${n.tasks} · ${n.pending} pending` : <span className="dim">in the mission</span>}</dd></dl>
              <div className="row" style={{ gap: 6, marginTop: 8 }}><button className="btn sm" onClick={() => nav(`/missions/${m.id}?tab=hierarchy&agent=${a.id}`)}>Open in mission</button><button className="btn sm ghost" onClick={() => toast({ tone: 'info', title: 'Migration is a controlled change (demo)', body: 'Running instances stay pinned unless a migration is approved.' })}>Migrate version</button></div>
            </motion.div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ConversationsTab({ a }: { a: Agent }) {
  const ms = useAgentMissions(a);
  useMissionControls(ms.map((m) => m.id), ['hierarchy', 'threads']);
  const threads = ms.flatMap((m) => Object.entries(getMissionControl(m).threads).filter(([k]) => k.split('|').includes(a.id)).map(([k, msgs]) => {
    const other = k.split('|').find((x) => x !== a.id) ?? '';
    return { m, k, other, msgs, last: msgs[msgs.length - 1] };
  })).sort((x, y) => x.last.agoMin - y.last.agoMin);
  const me = useMe();
  return (
    <div className="ap-conv">
    <Panel icon={MessageCircle} titleSize="lg" title={`Chat with ${a.name}`} help="agent.directTask" sub="Talk, or switch to Task to give an individual task." delay={.02} className="ap-direct">
      {me && <ChannelChat channel={channelId.agent(a.id, me.id)} compact title={<><b>{a.name}</b><span className="dim" style={{ fontSize: 11.5 }}>direct · {ROLES[a.role].label}</span></>} />}
    </Panel>
    <Panel icon={MessagesSquare} titleSize="lg" title="Mission threads" help="agent.conversations" sub="Immutable mission threads this agent takes part in." delay={.05} actions={<DemoTag />}>
      {threads.length === 0 ? <EmptyState icon={MessagesSquare} title="No threads" body="Conversations appear once the agent works on a mission." /> : (
        <div className="col" style={{ gap: 6 }}>
          {threads.slice(0, 14).map((t, i) => {
            const o = AGENT_BY_ID[t.other];
            return (
              <motion.div key={t.m.id + t.k} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .03 }}>
                <Link to={`/missions/${t.m.id}?tab=conversations&agent=${a.id}`} className="oa-thread">
                  {o ? <RobotAvatar role={o.role} size={36} /> : <span className="oa-ev-sys lg"><UserRound size={16} /></span>}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 13.5 }}>{o?.name ?? 'Owner'}</b><Chip hue={225} size="sm">{t.m.id}</Chip><Chip hue={t.last.kind === 'question' ? 38 : 205} size="sm">{t.last.kind}</Chip></div>
                    <div className="dim ellipsis" style={{ fontSize: 12.5 }}>{t.last.text}</div>
                  </div>
                  <span className="dim tnum" style={{ fontSize: 12 }}>{t.msgs.length} msgs · {ago(t.last.agoMin)}</span>
                  <ArrowRight size={14} className="dim" />
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </Panel>
    </div>
  );
}

function MemoryTab({ a }: { a: Agent }) {
  const mem = useMemo(() => memoryFor(a), [a]);
  const [dec, setDec] = useState<Record<string, 'accepted' | 'rejected'>>({});
  return (
    <div className="oa-grid-3">
      <Panel icon={Brain} title="Instance Memory Scopes" help="agent.memoryScopes" delay={.05}>
        {mem.scopes.length === 0 ? <EmptyState icon={Brain} title="No private memory" body="Memory is created per mission instance." /> : (
          <div className="col" style={{ gap: 8 }}>
            {mem.scopes.map((s, i) => (
              <motion.div key={s.missionId} className="oa-scope" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .1 + i * .05 }}>
                <Lock size={14} className="dim" /><div style={{ flex: 1, minWidth: 0 }}><b className="mono" style={{ fontSize: 12 }}>{s.missionId}</b><div className="dim ellipsis" style={{ fontSize: 12 }}>{s.title}</div></div>
                <div style={{ textAlign: 'right' }}><b className="tnum" style={{ fontSize: 13 }}>{s.items}</b><div className="dim" style={{ fontSize: 11 }}>{s.kb} KB</div></div>
              </motion.div>
            ))}
          </div>
        )}
      </Panel>
      <Panel icon={Sparkles} title="Proposed Learning" help="agent.proposedLearning" delay={.1}>
        <div className="col" style={{ gap: 8 }}>
          {mem.proposed.map((p) => (
            <div key={p.id} className="oa-learn">
              <div style={{ flex: 1 }}><div style={{ fontSize: 13 }}>{p.text}</div><div className="dim" style={{ fontSize: 11.5 }}>Source: {p.source} · expires in 30d</div></div>
              {dec[p.id] ? <Chip hue={dec[p.id] === 'accepted' ? 145 : 350} size="sm">{dec[p.id]}</Chip> : <>
                <IconButton icon={Check} label="Send to review" size="xs" variant="active" onClick={() => { setDec({ ...dec, [p.id]: 'accepted' }); toast({ tone: 'success', title: 'Sent to Knowledge review (demo)', body: 'It becomes a reusable skill only after verification.' }); }} />
                <IconButton icon={X} label="Discard" size="xs" variant="danger" onClick={() => setDec({ ...dec, [p.id]: 'rejected' })} /></>}
            </div>
          ))}
        </div>
      </Panel>
      <Panel icon={CheckCircle2} title="Verified Reusable Skills" help="agent.verifiedSkills" delay={.15}>
        <div className="col" style={{ gap: 6 }}>
          {mem.skills.map((s, i) => (
            <motion.div key={s.id} className="list-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .15 + i * .05 }}>
              {s.verified ? <CheckCircle2 size={15} className="good" /> : <Clock size={15} className="warn" />}
              <span style={{ flex: 1, fontSize: 13 }}>{s.skill}</span>
              <span className="dim" style={{ fontSize: 11.5 }}>{s.uses} uses · {s.source}{s.expiresD ? ` · exp ${s.expiresD}d` : ''}</span>
            </motion.div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function PerformanceTab({ a }: { a: Agent }) {
  const [rng, setRng] = useState('14d');
  const n = rng === '7d' ? 7 : rng === '14d' ? 14 : 28;
  const q = useMemo(() => perfSeries(a, 'q' + rng, n), [a, rng, n]);
  const base = useMemo(() => perfSeries(a, 'base' + rng, n, a.success - 4, 3), [a, rng, n]);
  const peerAvg = Math.round(AGENTS.filter((x) => x.role === a.role && x.id !== a.id).reduce((s, x) => s + x.success, 0) / Math.max(1, AGENTS.filter((x) => x.role === a.role && x.id !== a.id).length)) || a.success - 1;
  const mini = [
    { l: 'Completion rate', v: `${Math.min(99, a.success - 1)}%`, d: perfSeries(a, 'comp', 16, a.success - 1, 4), c: 'var(--good)' },
    { l: 'Median latency', v: `${Math.round(12 + (100 - a.success) * 2)} min`, d: perfSeries(a, 'lat', 16, 40, 10), c: 'var(--accent-2)' },
    { l: 'Error rate', v: `${(100 - a.success) / 2}%`, d: perfSeries(a, 'err', 16, 12, 8), c: 'var(--warn)' },
    { l: 'Tokens per task', v: `${(8 + (100 - a.success) * .9).toFixed(1)}k`, d: perfSeries(a, 'cost', 16, 50, 12), c: 'var(--violet)' },
  ];
  if (needsEvidence(a)) return <Panel icon={TrendingUp} titleSize="lg" title="Performance" help="agent.perfTrend" actions={<ProvenanceChip agent={a} />}><EmptyState icon={TrendingUp} title="Not enough evidence yet" body={`${NOT_ENOUGH}. Trends appear once its tasks have been verified.`} /></Panel>;
  return (
    <>
      {isApi() && <div className="row" style={{ gap: 8 }}><ProvenanceChip agent={a} /></div>}
      <div className="oa-grid-4s">
        {mini.map((m, i) => (
          <Panel key={m.l} delay={.05 + i * .05} className="oa-mini-perf">
            <div className="dim" style={{ fontSize: 12.5 }}>{m.l}</div>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}><b className="display" style={{ fontSize: 26 }}>{m.v}</b><Sparkline data={m.d} w={96} h={36} color={m.c} /></div>
          </Panel>
        ))}
      </div>
      <div className="oa-grid-2b">
        <Panel icon={TrendingUp} title="Verified quality trend" help="agent.perfTrend" delay={.2} actions={<div className="row" style={{ gap: 8 }}><Segmented ariaLabel="Range" size="sm" value={rng} onChange={setRng} options={[{ key: '7d', label: '7d' }, { key: '14d', label: '14d' }, { key: '28d', label: '28d' }]} /><DemoTag /></div>}>
          <AreaChart series={[{ label: a.name, data: q, color: 'var(--accent-2)' }, { label: 'Baseline', data: base, color: 'var(--text-dim)' }]} labels={q.map((_, i) => `${i + 1}`)} h={190} min={60} max={100} unit="%" />
        </Panel>
        <Panel icon={Gauge} title="Fair comparison" help="agent.peerCompare" delay={.25}>
          <div className="row" style={{ gap: 18 }}>
            <RingGauge value={a.success} size={118} label={`${a.success}%`} />
            <div className="col" style={{ gap: 8, flex: 1, fontSize: 13 }}>
              <div className="row"><span style={{ flex: 1 }}>Verified success</span><b>{a.success}%</b></div>
              <div className="row"><span style={{ flex: 1 }}>Same-role peers</span><b>{peerAvg}%</b></div>
              <div className="row"><span style={{ flex: 1 }}>Confidence</span><b>{a.sample >= 100 ? 'High' : a.sample >= 60 ? 'Medium' : 'Low'}</b></div>
              <div className="row"><span style={{ flex: 1 }}>Sample size</span><b>n={a.sample}</b></div>
            </div>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>Peers share the same role and task mix. Low samples are marked, never ranked.</div>
        </Panel>
      </div>
    </>
  );
}

function MentoringTab({ a }: { a: Agent }) {
  const canEdit = useCanEditAgents();
  const m = useMemo(() => mentoringFor(a), [a]);
  if (isApi()) return <ServerMentoring agentId={a.id} agentName={a.name} canStart={canEdit} />; // improvement cycle 19: recorded plans
  return (
    <div className="oa-grid-2b">
      <Panel icon={GraduationCap} title="Mentor & Goals" help="agent.mentoring" delay={.05} actions={<button className="btn primary" onClick={() => openDialog('mentoring-session', { agentId: a.id })}><GraduationCap size={15} />Schedule exercise</button>}>
        <div className="row" style={{ gap: 12, marginBottom: 14 }}>
          <RobotAvatar role="mentor" size={56} faceMode="face" /><div><b>{m.mentor.name}</b><div className="dim" style={{ fontSize: 12 }}>Mentor · weekly check-in · {m.mentor.success}% verified</div></div>
        </div>
        <div className="section-label" style={{ marginBottom: 8 }}>Coaching goals (lowest metrics)</div>
        <div className="col" style={{ gap: 10 }}>
          {m.goals.map((g, i) => (
            <div key={g.metric}>
              <div className="row" style={{ fontSize: 13, marginBottom: 4 }}><span style={{ flex: 1 }}>{METRIC_LABELS[g.metric]}</span><span className="dim">now {g.now}</span><ArrowRight size={12} className="dim" /><b>{g.target}</b></div>
              <div className="bar thin goal"><motion.i initial={{ width: 0 }} animate={{ width: `${g.now}%` }} transition={{ duration: .9, delay: i * .08 }} /><u style={{ left: `${g.target}%` }} /></div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel icon={FlaskConical} title="Assessed Exercises" help="agent.exercises" delay={.1}>
        <div className="col" style={{ gap: 8 }}>
          {m.exercises.map((e, i) => (
            <motion.div key={e.id} className="oa-ex" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .15 + i * .06 }}>
              <span className={cx('oa-step-dot', e.state === 'passed' && 'done')}>{e.state === 'passed' ? <CheckCircle2 size={13} /> : e.id}</span>
              <div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{e.title}</b><div className="dim" style={{ fontSize: 12 }}>{e.state === 'passed' ? `Before ${e.before} → after ${e.after} (n=${e.n}, independent QA)` : 'Scheduled · evidence required before sign-off'}</div></div>
              <Chip hue={e.state === 'passed' ? 145 : 205} size="sm">{e.state}</Chip>
            </motion.div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function VersionsPanel({ a }: { a: Agent }) {
  const v = useAgentVersions(a.id);
  const canEdit = useCanEditAgents(); // api mode: administrators
  const list = v.data ?? [];
  const activeV = list.find((x) => x.label === a.version);
  // improvement cycle 5: "last good" = the version before the active one (its parent)
  const lastGood = activeV ? list.find((x) => x.id === activeV.parentVersionId) : undefined;
  return (
    <Panel icon={Dna} title="Versions" help="agent.versions" delay={.05} actions={canEdit ? <div className="row" style={{ gap: 6 }}>
      <button className="btn primary" disabled={!activeV} onClick={() => openDialog('agent-version-propose', { agentId: a.id })}><GitBranchPlus size={15} />Propose a change</button>
      <HelpTrigger k="agent.version.propose" />
      <button className="btn" onClick={() => openDialog('agent-edit', { agentId: a.id })}>Edit</button>
    </div> : undefined}>
      {v.error && !v.data ? <div className="oa-banner" role="alert"><span>The versions could not be read: {v.error}</span><button className="btn sm" onClick={v.retry}>Retry</button></div>
        : !v.data ? <div className="dim" style={{ fontSize: 13 }} data-state="loading">Loading versions…</div>
        : <div className="col" style={{ gap: 8 }} data-versions>
          {list.slice().reverse().map((x, i, all) => {
            const active = x.id === activeV?.id;
            const good = x.id === lastGood?.id;
            return (
              <motion.div key={x.id} className={cx('oa-ver', active && 'stable')} data-version={x.label} data-active={active ? '1' : undefined} data-last-good={good ? '1' : undefined} style={{ width: 'auto', flexDirection: 'row', alignItems: 'center', gap: 12, textAlign: 'left', padding: '10px 12px' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 + i * .05 }}>
                <b className="mono">{x.label}</b>{active ? <Chip hue={145} size="sm" icon={CheckCircle2}>active</Chip> : <Chip hue={225} size="sm">earlier</Chip>}
                {good && <Chip hue={190} size="sm" icon={ShieldCheck} title="The version before the active one: one click to roll back to it">last good</Chip>}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ellipsis" style={{ fontSize: 12.5 }} title={`${x.model} · skills: ${x.skills.join(', ') || 'none'} · tools: ${x.tools.join(', ') || 'none'}`}>{x.model} · {x.skills.length ? x.skills.join(', ') : 'no skills'}</div>
                  <div className="dim ellipsis" style={{ fontSize: 11.5 }}>{new Date(x.createdAt).toLocaleString()}{i === all.length - 1 ? ' · first version' : ''}</div>
                </div>
                {canEdit && !active && <button className={cx('btn sm', !good && 'ghost')} style={{ flex: 'none' }} aria-label={`Roll back to this version (${x.label})`} title={`Roll back to this version (${x.label})`} onClick={() => openDialog('agent-rollback', { agentId: a.id, versionId: x.id })}><RotateCcw size={13} />Roll back</button>}
              </motion.div>
            );
          })}
          <div className="row" style={{ gap: 6 }}><span className="dim" style={{ fontSize: 12 }}>A promoted proposal, an edit of the model, skills or tools, or a rollback adds a version; none is ever changed or deleted. Instances already running keep theirs; new instances use the active one.</span>{canEdit && <HelpTrigger k="agent.version.rollback" />}</div>
        </div>}
    </Panel>
  );
}

function EvolutionTab({ a }: { a: Agent }) {
  const nav = useNavigate();
  const e = useMemo(() => evolutionFor(a), [a]);
  const canEdit = useCanEditAgents();
  if (isApi()) return (
    <div className="oa-grid-2b">
      <VersionsPanel a={a} />
      <Panel icon={GitBranchPlus} title="Version proposals" help="agent.version.proposals" delay={.1} sub="Candidates for this agent: another administrator promotes them.">
        <VersionProposalList agentId={a.id} compact />
      </Panel>
    </div>
  );
  return (
    <div className="oa-grid-2b">
      <Panel icon={Dna} title="Version Lineage" help="agent.lineage" delay={.05} actions={canEdit ? <button className="btn" onClick={() => openDialog('agent-edit', { agentId: a.id })}>Propose revision</button> : undefined}>
        <div className="oa-lineage">
          {e.lineage.map((v, i) => (
            <div key={v.v} className="row" style={{ gap: 6 }}>
              <motion.div className={cx('oa-ver', v.state)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .15 + i * .12 }}>
                <RobotAvatar role="optimize" hue={[200, 290, 215][i]} size={58} faceMode="face" animated={v.state === 'candidate'} />
                <b className="mono">{v.v}</b><Chip hue={[145, 290, 205][i]} size="sm">{v.label}</Chip>
                <span className="dim" style={{ fontSize: 11.5, textAlign: 'center' }}>{v.note}</span>
                {v.gain > 0 && <b className="good" style={{ fontSize: 12 }}>+{v.gain}pp</b>}
              </motion.div>
              {i < 2 && <ArrowRight size={18} className="muted" />}
            </div>
          ))}
        </div>
        <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>Promotion changes future instances only. Running instances stay pinned.</div>
      </Panel>
      <Panel icon={FlaskConical} title="Candidate Experiment" help="agent.experiment" delay={.1}>
        <div className="row" style={{ gap: 18 }}>
          <div className="oa-vs"><span className="dim">Baseline</span><b className="display">{e.experiment.baseline}%</b></div>
          <ArrowRight className="accent-on" />
          <div className="oa-vs good"><span className="dim">Candidate</span><b className="display">{e.experiment.candidate}%</b></div>
          <div className="dim" style={{ fontSize: 12.5 }}>n={e.experiment.n} paired tasks</div>
        </div>
        <dl className="kv oa-kv" style={{ marginTop: 14 }}>
          <dt>Independent reviewer</dt><dd>{e.experiment.reviewer}</dd><dt>Security review</dt><dd>{e.experiment.security}</dd><dt>Approval needed</dt><dd>Owner (no self-approval)</dd>
        </dl>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn primary" disabled={false} onClick={() => toast({ tone: 'info', title: 'Promotion request sent (demo)', body: 'Needs QA verdict and Owner approval first.' })}>Request promotion</button>
          <button className="btn ghost" onClick={() => nav('/operations?tab=agents&sub=development')}>Open Development</button>
        </div>
      </Panel>
    </div>
  );
}

function AuditTab({ a }: { a: Agent }) {
  const rows = useMemo(() => auditFor(a), [a]);
  const [f, setF] = useState<'all' | 'grant' | 'denied'>('all');
  const list = rows.filter((r) => f === 'all' || r.kind === f);
  return (
    <Panel icon={ScrollText} titleSize="lg" title="Audit Log" help="agent.audit" sub="Immutable changes, grants, denied actions and provenance." delay={.05}
      actions={<Segmented ariaLabel="Audit filter" size="sm" value={f} onChange={setF} options={[{ key: 'all', label: 'All' }, { key: 'grant', label: 'Grants' }, { key: 'denied', label: 'Denied' }]} />}>
      <div className="oa-audit">
        <AnimatePresence initial={false}>
          {list.map((r, i) => (
            <motion.div key={r.id} layout className="oa-aud" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * .03 }}>
              <span className={cx('oa-bn-dot', r.tone)} />
              <Chip hue={r.tone === 'bad' ? 350 : r.tone === 'good' ? 145 : r.tone === 'warn' ? 38 : 205} size="sm">{r.kind}</Chip>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13 }}>{r.text}</div><div className="dim mono" style={{ fontSize: 11 }}>{r.hash} · {r.who}</div></div>
              <span className="dim tnum" style={{ fontSize: 12 }}>{r.agoH}h ago</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
