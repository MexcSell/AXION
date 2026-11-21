import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { MentoringPlanDto } from '@contracts';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';

/**
 * Mentoring plans (improvement cycle 19, api mode only). Lists re-read on every mentoring.* event and on a stream
 * reconnect (bumpMentoring, from api/events.ts). Only recorded facts: no score is invented.
 */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpMentoring = () => useTick.setState((s) => ({ n: s.n + 1 }));

interface Read<T> { data: T | null; error: string | null; retry: () => void }
/** Every plan (GET /mentoring), or one agent's (GET /agents/:id/mentoring), newest first. */
export function useMentoringPlans(agentId?: string): Read<MentoringPlanDto[]> {
  const tick = useTick((s) => s.n);
  const path = agentId ? `/agents/${encodeURIComponent(agentId)}/mentoring` : '/mentoring';
  const [st, setSt] = useState<{ path: string; data: MentoringPlanDto[] | null; error: string | null }>({ path, data: null, error: null });
  useEffect(() => {
    if (!isApi()) return;
    let live = true;
    api<{ plans: MentoringPlanDto[] }>('GET', path).then((r) => { if (live) setSt({ path, data: r.plans ?? [], error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ path, data: x.path === path ? x.data : null, error: e instanceof ApiFailure ? e.message : 'Something went wrong.' })); });
    return () => { live = false; };
  }, [path, tick]);
  return { data: st.path === path ? st.data : null, error: st.error, retry: bumpMentoring };
}

export type Write<T> = { ok: true; value: T } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };
const fail = (e: unknown): { ok: false; code: string; message: string; fieldErrors?: Record<string, string> } =>
  (e instanceof ApiFailure ? { ok: false, code: e.code, message: e.message, fieldErrors: (e as { fieldErrors?: Record<string, string> }).fieldErrors } : { ok: false, code: 'UNKNOWN', message: 'Something went wrong.' });

export interface MentoringPlanBody { mentorId: string; skill: string; milestones: string[]; reevalOn: string }
export async function createMentoringPlan(agentId: string, body: MentoringPlanBody, idempotencyKey: string): Promise<Write<MentoringPlanDto>> {
  try { const r = await api<{ plan: MentoringPlanDto }>('POST', `/agents/${encodeURIComponent(agentId)}/mentoring`, body, { idempotencyKey }); bumpMentoring(); return { ok: true, value: r.plan }; }
  catch (e) { bumpMentoring(); return fail(e); }
}
export async function tickMilestone(planId: string, milestoneId: string): Promise<Write<MentoringPlanDto>> {
  try { const r = await api<{ plan: MentoringPlanDto }>('POST', `/mentoring/${encodeURIComponent(planId)}/milestones/${encodeURIComponent(milestoneId)}/done`); bumpMentoring(); return { ok: true, value: r.plan }; }
  catch (e) { bumpMentoring(); return fail(e); }
}
export async function closeMentoringPlan(planId: string, outcome: 'completed' | 'cancelled', note: string): Promise<Write<MentoringPlanDto>> {
  try { const r = await api<{ plan: MentoringPlanDto }>('POST', `/mentoring/${encodeURIComponent(planId)}/close`, { outcome, ...(note.trim() ? { note: note.trim() } : {}) }); bumpMentoring(); return { ok: true, value: r.plan }; }
  catch (e) { bumpMentoring(); return fail(e); }
}
export { newKey };
