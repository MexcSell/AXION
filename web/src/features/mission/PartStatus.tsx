import { Loader2, CloudOff, RotateCcw } from 'lucide-react';
import '@/theme/pages/chat.css';
import { EmptyState } from '@/components/ui/EmptyState';
import { isApi } from '@/api/mode';
import { partState, retryPart, useMissionControl, type Part } from '@/api/missionControl';

/**
 * api mode (Stage 6): a part of a mission's server data that is still loading, or whose load failed, is shown as such,
 * never as an empty result. Returns null when the part is ready (or in demo mode), so the caller renders its content.
 */
export function usePartStatus(missionId: string, part: Part, what: string) {
  const entry = useMissionControl(missionId, [part]);
  if (!isApi()) return null;
  const st = partState(entry, part);
  if (st === 'ready') return null;
  if (st === 'loading') return <div className="part-status" data-part={part} data-state="loading" role="status"><EmptyState icon={Loader2} title={`Loading ${what}…`} body="Reading it from the AXION server." /></div>;
  return (
    <div className="part-status" data-part={part} data-state="error" role="alert">
      <EmptyState icon={CloudOff} title={`Could not load ${what}`} body={<>{entry?.errors?.[part]} It is retried automatically; nothing here means "empty".</>}
        action={<button className="btn" onClick={() => retryPart(missionId, part)}><RotateCcw size={14} />Retry</button>} />
    </div>
  );
}
