import { Compass } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';

export default function NotFound() {
  const nav = useNavigate();
  return (
    <div className="page"><Panel>
      <EmptyState icon={Compass} title="Page not found" body="This address does not match any screen. Use search (Ctrl K) or go back to the overview." action={<button className="btn primary" onClick={() => nav('/overview')}>Go to Overview</button>} />
    </Panel></div>
  );
}
