import { useMemo } from 'react';
import { ALL_NOTICES } from './notifications-extra';
import { useData, useVisibleMissions } from '@/store/data';

/** Notices the signed-in user may see: one about a mission they cannot see is hidden (owner update u1 visibility rule). */
export function useVisibleNotices() {
  const visible = useVisibleMissions();
  const all = useData((s) => s.missions);
  return useMemo(() => {
    const vis = new Set(visible.map((m) => m.id));
    const exists = new Set(all.map((m) => m.id));
    return ALL_NOTICES.filter((n) => !n.missionId || vis.has(n.missionId) || !exists.has(n.missionId));
  }, [visible, all]);
}
