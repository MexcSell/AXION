import { useCallback, useEffect, useState } from 'react';
import type { ApprovalQualityDto, ApproverQualityBody } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';

/**
 * Approval quality (c58, api mode). The aggregate is read by everyone. The per-approver table is requested only for an administrator
 * (the server refuses anyone else, so the client never has per-person numbers it should not show).
 */
export interface QualityState { agg: ApprovalQualityDto | null; approvers: ApproverQualityBody | null; error: string | null; loading: boolean; retry: () => void }
export function useApprovalQuality(windowDays: number, admin: boolean): QualityState {
  const [st, setSt] = useState<{ agg: ApprovalQualityDto | null; approvers: ApproverQualityBody | null; error: string | null; for: string }>({ agg: null, approvers: null, error: null, for: '' });
  const [tick, setTick] = useState(0);
  const key = `${windowDays}|${admin ? 'a' : 'm'}`;
  useEffect(() => {
    if (!isApi()) return;
    let live = true;
    const q = `?windowDays=${windowDays}`;
    Promise.all([
      api<{ quality: ApprovalQualityDto }>('GET', `/approvals/quality${q}`),
      admin ? api<ApproverQualityBody>('GET', `/approvals/quality/approvers${q}`) : Promise.resolve(null),
    ]).then(([a, p]) => { if (live) setSt({ agg: a.quality, approvers: p, error: null, for: key }); })
      .catch((e) => { if (live) setSt((x) => ({ ...x, error: e instanceof ApiFailure ? e.message : 'Something went wrong.', for: key })); });
    return () => { live = false; };
  }, [windowDays, admin, tick, key]);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  return { agg: st.for === key ? st.agg : null, approvers: st.for === key ? st.approvers : null, error: st.for === key ? st.error : null, loading: st.for !== key, retry };
}
