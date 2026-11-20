import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ROUTE_TABS, slug } from '@/config/nav';

/** Tab state persisted in the URL (?tab=slug) so every tab is deep-linkable and Back works (spec §2). */
export function useTab(routeKey: string, param = 'tab'): [string, (label: string) => void, string[]] {
  const tabs = ROUTE_TABS[routeKey] ?? [];
  const [sp, setSp] = useSearchParams();
  const cur = sp.get(param);
  const label = tabs.find((t) => slug(t) === cur) ?? tabs[0] ?? '';
  const set = useCallback((l: string) => {
    setSp((prev) => { const n = new URLSearchParams(prev); n.set(param, slug(l)); return n; });
  }, [setSp, param]);
  return [label, set, tabs];
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
