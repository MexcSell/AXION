import { ProvenanceChip, needsEvidence, NOT_ENOUGH } from '@/components/agents/Provenance';
import { ReliabilityChip } from '@/components/agents/Reliability';
import { useCanEditAgents } from '@/hooks/useCanEditAgents';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, UserRound, MessageSquare, GraduationCap, PencilLine, Target, PauseCircle } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { AgentStatusChip, RoleChip } from '@/components/ui/Chips';
import { Menu } from '@/components/ui/Menu';
import { openDialog, toast } from '@/store/ui';
import type { Agent } from '@/data/types';
import { AGENT_STATUS, ROLES } from '@/data/roles';
import { DevStrip } from '@/features/agents/Growth';
import { isApi } from '@/api/mode';

/** Player-card style agent tile (40-4 grid). */
export function AgentCard({ agent, index = 0 }: { agent: Agent; index?: number }) {
  const nav = useNavigate();
  const canEdit = useCanEditAgents();
  const open = () => nav(`/agents/${agent.id}`);
  return (
    <motion.article
      layout
      className="agent-card glass-card hoverable"
      initial={{ opacity: 0, y: 14, scale: .97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: .95 }}
      transition={{ duration: .32, delay: Math.min(index, 14) * .035, layout: { type: 'spring', stiffness: 380, damping: 34 } }}
      style={{ ['--rh' as string]: ROLES[agent.role].hue }}
      aria-label={`${agent.name}, ${AGENT_STATUS[agent.status].label}, ${agent.growth}, ${needsEvidence(agent) ? 'not enough evidence' : `success ${agent.success}%`}`}
    >
      <button className="agent-card-hit" onClick={open} aria-label={`Open ${agent.name} profile`} />
      <div className="agent-card-top">
        <div className="agent-card-art"><RobotAvatar role={agent.role} size={80} title={`${agent.name} avatar`} animated={agent.growth === 'evolving'} /></div>
        <div className="agent-card-info">
          <div className="agent-name ellipsis">{agent.name}</div>
          <RoleChip role={agent.role} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 2 }}>
            <AgentStatusChip status={agent.status} />
            <span className="agent-ver">{agent.version}</span>
          </div>
        </div>
        <div className="agent-card-menu">
          <Menu
            trigger={<button className="icon-btn xs" aria-label={`${agent.name} actions`}><MoreHorizontal size={15} /></button>}
            items={[
              { label: 'Open profile', icon: UserRound, onSelect: open },
              { label: 'Conversations', icon: MessageSquare, onSelect: () => nav(`/agents/${agent.id}?tab=conversations`) },
              { label: 'Assign to mission', icon: Target, onSelect: () => openDialog('agent-assign', { agentId: agent.id }) },
              { label: 'Schedule mentoring', icon: GraduationCap, onSelect: () => openDialog('mentoring-session', { agentId: agent.id }) },
              ...(canEdit ? [{ label: 'Edit profile', icon: PencilLine, onSelect: () => openDialog('agent-edit', { agentId: agent.id }) }] : []),
              { label: 'Pause new assignments', icon: PauseCircle, sep: true, onSelect: () => toast({ tone: 'info', title: `${agent.name}: new assignments paused (demo)`, body: 'Running instances continue under their pinned version.' }) },
            ]}
          />
        </div>
      </div>
      <DevStrip agent={agent} />
      <div className="agent-card-stats">
        <span>Missions</span><b className="tnum">{agent.missions}</b>
        {isApi() && <span className="agent-card-rel"><ReliabilityChip agent={agent} /></span>}
        <span className="sep" />
        <span>Success</span>{needsEvidence(agent) ? <b className="tnum dim" title={NOT_ENOUGH}>n/a</b> : <b className="tnum">{agent.success}%</b>}<span style={{ position: 'absolute', right: 8, top: -9, zIndex: 1 }}><ProvenanceChip agent={agent} /></span>
      </div>
    </motion.article>
  );
}
