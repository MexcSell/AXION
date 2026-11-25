import { Cpu } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Mission } from '@/data/types';

export function ActivityTab({ m }: { m: Mission }) {
  return <div data-activity="not-measured">
    <EmptyState icon={Cpu} title="No activity measurements"
      body={`This mission has ${m.agentIds.length} assigned agents. The server has no token, CPU or memory measurements for it.`} />
  </div>;
}
