import { useEffect, useState } from 'react';
import type { AgentSkillsDto, SkillCompareDto } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';

/** c72: the skill vector of one agent (api mode), and a comparison of two (distinguishable or indistinguishable per class). Read only. */
interface St<T> { data: T | null; error: string | null; loading: boolean }
function useGet<T>(path: string | null, pick: (b: any) => T): St<T> {
  const [s, set] = useState<St<T>>({ data: null, error: null, loading: !!path && isApi() });
  useEffect(() => {
    if (!path || !isApi()) { set({ data: null, error: null, loading: false }); return; }
    let live = true;
    set((x) => ({ ...x, loading: true }));
    api<unknown>('GET', path)
      .then((b) => { if (live) set({ data: pick(b), error: null, loading: false }); })
      .catch((e) => { if (live) set({ data: null, error: e instanceof ApiFailure ? e.message : 'Could not load the skill ratings.', loading: false }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return s;
}
export const useAgentSkills = (agentId: string) => useGet<AgentSkillsDto>(`/agents/${encodeURIComponent(agentId)}/skills`, (b) => b.skills);
export const useSkillCompare = (agentId: string, withId: string | null) =>
  useGet<SkillCompareDto>(withId ? `/agents/${encodeURIComponent(agentId)}/skills/compare?with=${encodeURIComponent(withId)}` : null, (b) => b.compare);
