import { Activity, Server, Bot, Boxes, ListChecks } from 'lucide-react';
import { TopBoard, FrameBody } from '@/components/layout/PageFrame';
import { Tabs } from '@/components/ui/Tabs';
import { Panel } from '@/components/ui/Panel';
import { useTab } from '@/hooks/useTab';
import { useAgentsCatalog } from '@/api/agents';
import { useAgentsSection } from '@/pages/Agents';
import { useModelsSection } from '@/pages/Models';
import { useMe, isAdmin } from '@/store/auth';
import { ServerHealth } from '@/features/ops/ServerHealth';
import { JobRecords } from '@/features/ops/JobRecords';
import { ReviewCapacity } from '@/features/ops/ReviewCapacity';
import '@/theme/pages/agents.css';
import '@/theme/pages/models.css';
import '@/theme/pages/settings-ops-help.css';

const ICONS = [Server, Bot, Boxes, ListChecks];

export default function OperationsPage() {
  useAgentsCatalog();
  const me = useMe();
  const [tab, setTab, tabs] = useTab('operations');
  // Agents and Models live here since the owner update u1; their own tabs become sub-tabs (?sub=).
  const agents = useAgentsSection();
  const models = useModelsSection(tab === 'Models');
  const section = tab === 'Agents' ? agents : tab === 'Models' ? models : null;
  const SUB: Record<string, string> = {
    Agents: 'Every agent, its duty, lineage and live instances — managed next to the machines they run on.',
    Models: 'Manage provider connections, check usage and send prompts to an enabled model.',
  };
  return (
    <div className="page">
      <TopBoard id="operations" icon={Activity} title="System Operations" help="ops.services"
        sub={SUB[tab] ?? 'Server health, agent records, model connections and queues.'}
        actions={section?.actions}
        kpis={section?.kpis}
        tabs={{ tabs, value: tab, onChange: setTab, icons: ICONS, ariaLabel: 'Operations sections' }}
        toolbar={section?.toolbar} />
      {section ? (
        <FrameBody tab={`${tab}-${section.bodyKey}`} scroll={'scroll' in section ? section.scroll : true}
          head={<div className="ops-subhead">
            <Tabs size="sm" ariaLabel={`${tab} views`} value={section.sub.value} onChange={section.sub.onChange}
              tabs={section.sub.tabs.map((t, i) => ({ key: t, label: t, icon: section.sub.icons[i], count: 'counts' in section.sub ? (section.sub.counts as Record<string, number | undefined>)[t] : undefined }))} />
            {'head' in section && section.head && <div className="ops-subhead-row">{section.head}</div>}
          </div>}>
          {section.body}
        </FrameBody>
      ) : (
        <FrameBody tab={tab} panel={false}>
          {tab === 'Services' && (isAdmin(me) ? <ServerHealth /> : <Panel title="Server health" icon={Server}>Administrator access is required to view server health.</Panel>)}
          {tab === 'Queues' && <><ReviewCapacity />{isAdmin(me) && <JobRecords />}</>}

        </FrameBody>
      )}
      {tab === 'Agents' && agents.bottom}
    </div>
  );
}
