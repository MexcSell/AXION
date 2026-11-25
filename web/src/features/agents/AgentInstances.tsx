import { Link } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { useAgentInstances } from '@/api/agents';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstanceStateChip } from '@/components/ui/Chips';
import { useVisibleMissions } from '@/store/data';
import { AGENT_BY_ID } from '@/data/agents';
import type { InstanceState } from '@/data/types';

export function AgentInstances({ agentId }: { agentId?: string }) {
  const records = useAgentInstances(agentId);
  const missions = useVisibleMissions();
  if (records.error) return <div role="alert">{records.error} <button className="btn sm" onClick={records.retry}>Retry</button></div>;
  if (!records.data) return <span role="status">Loading instances…</span>;
  const visible = new Map(missions.filter(m => !m.demo).map(m => [m.id, m]));
  const rows = records.data.filter(i => !i.simulated && visible.has(i.missionId) && (agentId || !i.endedAt));
  if (!rows.length) return <EmptyState icon={Boxes} title={agentId ? 'No recorded instances' : 'No live instances'} />;
  return <div className="table-wrap"><table className="table" data-live-instances>
    <thead><tr><th>Instance</th><th>Agent</th><th>Mission</th><th>Task</th><th>State</th><th>Pinned version</th><th>Progress</th></tr></thead>
    <tbody>{rows.map(i => <tr key={i.id} data-instance={i.id} data-agent={i.agentId}>
      <td className="mono">{i.id}</td><td><Link to={`/agents/${i.agentId}`}>{AGENT_BY_ID[i.agentId]?.name ?? i.agentId}</Link></td>
      <td><Link to={`/missions/${i.missionId}?tab=hierarchy&agent=${i.agentId}`}>{visible.get(i.missionId)?.title}</Link></td>
      <td>{i.task}</td><td><InstanceStateChip state={i.state as InstanceState} size="sm" /></td><td data-pinned>{i.versionLabel}</td><td>{i.progress}%</td>
    </tr>)}</tbody>
  </table></div>;
}
