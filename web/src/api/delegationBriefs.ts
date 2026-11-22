import { useCallback, useEffect, useState } from 'react';
import type { DelegationBriefList } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';

/** c42: the typed briefs of a mission's delegations (api mode). `tick` re-reads when something changed (a reassignment, a new task owner). */
export function useDelegationBriefs(missionId: string, tick: unknown = 0) {
  const [state, setState] = useState<{ data: DelegationBriefList | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: isApi() });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!isApi()) { setState({ data: null, error: null, loading: false }); return; }
    let live = true;
    api<DelegationBriefList>('GET', `/missions/${encodeURIComponent(missionId)}/delegation-briefs`)
      .then((data) => { if (live) setState({ data, error: null, loading: false }); })
      .catch((e) => { if (live) setState((s) => ({ ...s, error: e instanceof ApiFailure ? e.message : 'Could not load the delegation briefs.', loading: false })); });
    return () => { live = false; };
  }, [missionId, tick, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...state, reload };
}
