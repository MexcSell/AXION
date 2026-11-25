import { useMemo } from 'react';
import { useData, useVisibleMissions } from '@/store/data';

export function useVisibleNotices() {
  const missions = useVisibleMissions();
  const notices = useData(s => s.serverNotices);
  return useMemo(() => {
    const visibleIds = new Set(missions.map(m => m.id));
    return notices.filter(n => !n.missionId || visibleIds.has(n.missionId));
  }, [missions, notices]);
}
