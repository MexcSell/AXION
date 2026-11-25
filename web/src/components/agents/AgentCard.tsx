import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { PencilLine, MessageSquare } from 'lucide-react';
import { RobotAvatar } from '@/components/art/RobotAvatar';
import { RoleChip } from '@/components/ui/Chips';
import { ReliabilityChip } from './Reliability';
import { useCanEditAgents } from '@/hooks/useCanEditAgents';
import type { Agent } from '@/data/types';
import { ROLES } from '@/data/roles';
import { openDialog } from '@/store/ui';

export function AgentCard({ agent, index = 0 }: { agent: Agent; index?: number }) {
  const canEdit = useCanEditAgents();
  return <motion.article className="agent-card glass-card" style={{ ['--rh' as string]: ROLES[agent.role].hue }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(index, 10) * .02 }}>
    <div className="agent-card-top">
      <RobotAvatar role={agent.role} size={66} />
      <div className="agent-card-info">
        <Link className="agent-name" to={`/agents/${agent.id}`}>{agent.name}</Link>
        <RoleChip role={agent.role} /><span className="dim">{agent.dept} · {agent.version}</span>
      </div>
    </div>
    <p>{agent.duty}</p>
    <div className="row wrap" style={{ gap: 6 }}>
      <ReliabilityChip agent={agent} /><span className="spacer" />
      <Link className="btn sm" to={`/agents/${agent.id}?tab=conversations`}><MessageSquare size={13} />Chat</Link>
      {canEdit && <button className="btn sm" onClick={() => openDialog('agent-edit', { agentId: agent.id })}><PencilLine size={13} />Edit</button>}
    </div>
  </motion.article>;
}
