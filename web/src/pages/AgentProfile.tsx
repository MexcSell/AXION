import { motion } from 'motion/react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bot, Boxes, CheckCircle2, Dna, Gauge, GitBranchPlus, GraduationCap, MessageCircle, MessagesSquare, PencilLine, RotateCcw, ShieldCheck, UserRound, Wrench } from 'lucide-react';
import { useAgentsCatalog, useAgentsVersion, useAgentVersions } from '@/api/agents';
import { useMissionControls } from '@/api/missionControl';
import { ReliabilityStat } from '@/components/agents/Reliability';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { Chip, RoleChip } from '@/components/ui/Chips';
import { EmptyState } from '@/components/ui/EmptyState';
import { HelpTrigger } from '@/components/ui/HelpTrigger';
import { LiveStatus } from '@/components/ui/LiveStatus';
import { Panel } from '@/components/ui/Panel';
import { Tabs } from '@/components/ui/Tabs';
import { AGENT_BY_ID } from '@/data/agents';
import { getMissionControl } from '@/data/missionControl';
import { ROLES } from '@/data/roles';
import type { Agent } from '@/data/types';
import { AgentInstances } from '@/features/agents/AgentInstances';
import { ServerMentoring } from '@/features/agents/Mentoring';
import { SkillVector } from '@/features/agents/SkillVector';
import { VersionProposalList } from '@/features/agents/VersionProposals';
import { ChannelChat } from '@/features/chat/ChannelChat';
import { useCanEditAgents } from '@/hooks/useCanEditAgents';
import { useTab } from '@/hooks/useTab';
import { ago, cx } from '@/lib/format';
import { useMe } from '@/store/auth';
import { channelId } from '@/store/chat';
import { useVisibleMissions } from '@/store/data';
import { openDialog } from '@/store/ui';
import '@/theme/pages/overview-org-agent.css';

export default function AgentProfilePage() {
  useAgentsCatalog();
  const { loaded, failed } = useAgentsVersion();
  const { id } = useParams();
  const agent = id ? AGENT_BY_ID[id] : undefined;
  if (!loaded) return <div role="status">Loading agent profile…</div>;
  if (failed) return <div role="alert">The agent catalog could not be loaded.</div>;
  if (!agent) return <EmptyState icon={Bot} title="Agent not found" action={<Link to="/agents" className="btn">Back to agents</Link>} />;
  return <Profile key={agent.id} agent={agent} />;
}

function Profile({ agent }: { agent: Agent }) {
  const [tab, setTab, tabs] = useTab('agentProfile');
  const canEdit = useCanEditAgents();
  const manager = agent.managerId ? AGENT_BY_ID[agent.managerId] : undefined;
  const icons = [Bot, Wrench, Boxes, MessagesSquare, Gauge, GraduationCap, Dna];
  return <div className="page">
    <section className="panel" style={{ padding: 16 }}>
      <Link to="/agents" className="btn ghost sm"><ArrowLeft size={14} />Agents</Link>
      <div className="row wrap" style={{ gap: 16 }}>
        <RobotAvatar role={agent.role} size={76} />
        <div style={{ flex: 1 }}><h1 className="display">{agent.name}</h1><div className="row wrap" style={{gap: 8}}>
          <RoleChip role={agent.role} /><span>{agent.dept}</span><Chip size="sm">{agent.version}</Chip>
        </div></div>
        <ReliabilityStat agent={agent} />
        {canEdit && <button className="btn" onClick={() => openDialog('agent-edit', { agentId: agent.id })}><PencilLine size={14} />Edit</button>}
      </div>
    </section>
    <div className="oa-tabbar panel"><Tabs collapse tabs={tabs.map((t, i) => ({ key: t, label: t, icon: icons[i] }))} value={tab} onChange={setTab} ariaLabel="Agent profile sections" /></div>
    <div className="fit-scroll col" role="tabpanel" aria-label={tab} style={{ gap: 'var(--gap)' }}>
      {tab === 'Profile' && <Panel icon={Bot} title="Profile"><dl className="kv oa-kv">
        <dt>Duty</dt><dd>{agent.duty}</dd><dt>Description</dt><dd>{agent.description || '—'}</dd>
        <dt>Model</dt><dd>{agent.model}</dd><dt>Skills</dt><dd>{agent.skills.join(', ') || 'None configured'}</dd>
        {manager && <><dt>Reports to</dt><dd><Link to={`/agents/${manager.id}`}>{manager.name}</Link></dd></>}
        {agent.parentId && <><dt>Derived from</dt><dd><Link to={`/agents/${agent.parentId}`}>{AGENT_BY_ID[agent.parentId]?.name ?? agent.parentId}</Link></dd></>}
      </dl></Panel>}
      {tab === 'Tools' && <Panel icon={Wrench} title="Configured tools">{agent.tools?.length ? <div className="row wrap" style={{gap:6}}>{agent.tools.map(t => <Chip key={t}>{t}</Chip>)}</div> : <p>No tools configured.</p>}</Panel>}
      {tab === 'Instances' && <Panel icon={Boxes} title="Instances"><AgentInstances agentId={agent.id} /></Panel>}
      {tab === 'Conversations' && <ConversationsTab a={agent} />}
      {tab === 'Performance' && <SkillVector agentId={agent.id} agentName={agent.name} />}
      {tab === 'Mentoring' && <ServerMentoring agentId={agent.id} agentName={agent.name} canStart={canEdit} />}
      {tab === 'Evolution' && <><VersionsPanel a={agent} /><Panel icon={GitBranchPlus} title="Version proposals"><VersionProposalList agentId={agent.id} compact /></Panel></>}
    </div>
  </div>;
}

function ConversationsTab({ a }: { a: Agent }) {
  const ms = useVisibleMissions().filter(m => !m.demo && m.agentIds.includes(a.id));
  useMissionControls(ms.map((m) => m.id), ['hierarchy', 'threads']);
  const threads = ms.flatMap((m) => Object.entries(getMissionControl(m).threads).filter(([k, messages]) => messages.length > 0 && k.split('|').includes(a.id)).map(([k, msgs]) => {
    const other = k.split('|').find((x) => x !== a.id) ?? '';
    return { m, k, other, msgs, last: msgs[msgs.length - 1] };
  })).sort((x, y) => x.last.agoMin - y.last.agoMin);
  const me = useMe();
  return (
    <div className="ap-conv">
    <Panel icon={MessageCircle} titleSize="lg" title={`Chat with ${a.name}`} help="agent.directTask" sub="Talk, or switch to Task to give an individual task." delay={.02} className="ap-direct">
      {me && <ChannelChat channel={channelId.agent(a.id, me.id)} compact title={<><b>{a.name}</b><span className="dim" style={{ fontSize: 11.5 }}>direct · {ROLES[a.role].label}</span></>} />}
    </Panel>
    <Panel icon={MessagesSquare} titleSize="lg" title="Mission threads" help="agent.conversations" sub="Immutable mission threads this agent takes part in." delay={.05}>
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
        : !v.data ? <LiveStatus className="dim" style={{ fontSize: 13 }} data-state="loading">Loading versions…</LiveStatus>
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
