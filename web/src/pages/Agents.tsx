import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Activity, Bot, Building2, GitBranch, Layers, LayoutGrid, Lightbulb, List, Network, Plus, Search, ShieldCheck, Sprout } from 'lucide-react';
import { useAgentsCatalog, useAgentsVersion, loadAgents } from '@/api/agents';
import { AgentCard } from '@/components/agents/AgentCard';
import { ReliabilityChip } from '@/components/agents/Reliability';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { AGENTS } from '@/data/agents';
import { AgentHierarchy } from '@/features/agents/AgentHierarchy';
import { AgentInstances } from '@/features/agents/AgentInstances';
import { Dimensions } from '@/features/agents/Dimensions';
import { Lineage } from '@/features/agents/Lineage';
import { CoverageCard } from '@/features/agents/OrgCoverage';
import { ServerDepartments } from '@/features/agents/ServerDepartments';
import { ServerProposals } from '@/features/agents/ServerProposals';
import { ServerDevelopment } from '@/features/agents/VersionProposals';
import { useCanEditAgents } from '@/hooks/useCanEditAgents';
import { useTab } from '@/hooks/useTab';
import { openDialog } from '@/store/ui';
import '@/theme/pages/overview-org-agent.css';

export default function AgentsRedirect() {
  const [sp] = useSearchParams();
  const n = new URLSearchParams(sp);
  const t = n.get('tab');
  n.set('tab', 'agents');
  if (t) n.set('sub', t);
  return <Navigate to={`/operations?${n}`} replace />;
}

export function useAgentsSection() {
  const [tab, setTab, tabs] = useTab('agents', 'sub');
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') ?? 'cards';
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const canEdit = useCanEditAgents();
  useAgentsCatalog();
  const { loaded, failed } = useAgentsVersion();
  const departments = [...new Set(AGENTS.map(a => a.dept))].sort();
  const list = AGENTS.filter(a => (!dept || dept === a.dept) && [a.name, a.role, a.duty, a.dept, ...a.skills].join(' ').toLowerCase().includes(query.toLowerCase()));
  const directory = tab === 'Directory';
  const head = directory && <>
    <label className="input-wrap"><Search size={15}/><input className="input" aria-label="Search agents" placeholder="Search agents or skills" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <select className="select" style={{width: 160}} aria-label="Filter by department" value={dept} onChange={e => setDept(e.target.value)}><option value="">All departments</option>{departments.map(d => <option key={d}>{d}</option>)}</select>
    <div className="view-switch">{[{key:'cards', icon:LayoutGrid}, {key:'list', icon:List}, {key:'hierarchy', icon:Network}].map(v =>
      <IconButton key={v.key} label={v.key} icon={v.icon} size="sm" variant={view === v.key ? 'active' : 'default'} onClick={() => setSp(p => { const next = new URLSearchParams(p); next.set('view', v.key); return next; })} />
    )}</div>
  </>;
  const body = <>
    {directory && (failed ? <span role="alert">The agent catalog could not be loaded. <button className="btn sm" onClick={() => void loadAgents().catch(() => {})}>Retry</button></span>
      : !loaded ? <span role="status">Loading agents…</span> : !list.length ? <EmptyState icon={Bot} title="No matching agents" />
      : view === 'hierarchy' ? <AgentHierarchy highlight={a => list.includes(a)} /> : view === 'list' ? <div className="table-wrap"><table className="table ag-table">
        <thead><tr><th>Agent</th><th>Department</th><th>Duty</th><th>Version</th><th>Reliability</th></tr></thead>
        <tbody>{list.map(a => <tr key={a.id}><td><Link to={`/agents/${a.id}`}>{a.name}</Link></td><td>{a.dept}</td><td>{a.duty}</td><td>{a.version}</td><td><ReliabilityChip agent={a} /></td></tr>)}</tbody>
      </table></div> : <div className="agent-grid">{list.map((a, i) => <AgentCard key={a.id} agent={a} index={i} />)}</div>)}
    {tab === 'Development' && <ServerDevelopment />}
    {tab === 'Lineage' && <Lineage />}
    {tab === 'Live Instances' && <AgentInstances />}
    {tab === 'Departments' && <ServerDepartments />}
    {tab === 'Policies' && <CoverageCard />}
    {tab === 'Proposals' && <ServerProposals />}
    {tab === 'Dimensions' && <Dimensions />}
  </>;
  return {
    kpis: loaded && !failed ? [{ key: 'agents', icon: Bot, value: AGENTS.length, label: 'Registered agents', color: '#22d3ee' },
      { key: 'depts', icon: Building2, value: departments.length, label: 'Departments', color: '#c084fc' }] : [],
    actions: canEdit && <button className="btn primary" onClick={() => openDialog('agent-create')}><Plus size={15} />New agent</button>,
    sub: { tabs, value: tab, onChange: setTab, icons: [Bot, Sprout, GitBranch, Activity, Building2, ShieldCheck, Lightbulb, Layers] },
    toolbar: null, bodyKey: directory ? tab + view : tab, head, body, scroll: !(directory && view === 'hierarchy'), bottom: null,
  };
}
