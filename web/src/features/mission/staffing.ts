import { useEffect } from 'react';
import type { Mission } from '@/data/types';
import { tickStaffing } from './staffing-plan';

/**
 * Mission staffing (owner update 2026-11-20 u1). The pure steps live in ./staffing-plan (shared with the server,
 * which runs them in api mode); this file adds the browser timer used in demo mode.
 */
export * from './staffing-plan';

/** Mounted once in the shell: moves every staffing mission forward on a timer (also after a reload). `fresh` reads the live store, never the render-time copy. */
export function useStaffingDriver(missions: Mission[], update: (id: string, patch: Partial<Mission>) => void, fresh: (id: string) => Mission | undefined) {
  useEffect(() => {
    const t = window.setInterval(() => {
      // Read the store inside the tick: `missions` is the render-time copy and can be a commit behind it.
      tickStaffing(missions, fresh, update, Date.now());
    }, 1500);
    return () => window.clearInterval(t);
  }, [missions, update, fresh]);
}
