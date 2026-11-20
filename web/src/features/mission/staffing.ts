import { useEffect } from 'react';
import type { Mission } from '@/data/types';
import { advance } from './staffing-plan';

/**
 * Mission staffing (owner update 2026-11-20 u1). The pure steps live in ./staffing-plan (shared with the server,
 * which runs them in api mode); this file adds the browser timer used in demo mode.
 */
export * from './staffing-plan';

/** Mounted once in the shell: moves every staffing mission forward on a timer (also after a reload). */
export function useStaffingDriver(missions: Mission[], update: (id: string, patch: Partial<Mission>) => void) {
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      for (const m of missions) {
        const p = advance(m, now);
        if (p) update(m.id, p);
      }
    }, 1500);
    return () => window.clearInterval(t);
  }, [missions, update]);
}
