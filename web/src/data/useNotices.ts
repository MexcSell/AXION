import { useMemo } from 'react';
import { ALL_NOTICES } from './notifications-extra';
import { useData, useVisibleMissions } from '@/store/data';
import { isApi } from '@/api/mode';

/**
 * Notices the signed-in user may see: one about a mission they cannot see is hidden (owner update u1 visibility rule).
 * api mode: the server's notifications first (already filtered by the server), then the DEMO fixture notices.
 */
export function useVisibleNotices() {
  const visible = useVisibleMissions();
  const all = useData((s) => s.missions);
  const server = useData((s) => s.serverNotices);
  return useMemo(() => {
    const vis = new Set(visible.map((m) => m.id));
    const exists = new Set(all.map((m) => m.id));
    const demo = ALL_NOTICES.filter((n) => !n.missionId || vis.has(n.missionId) || (!isApi() && !exists.has(n.missionId)));
    return isApi() ? [...server, ...demo] : demo;
  }, [visible, all, server]);
}
