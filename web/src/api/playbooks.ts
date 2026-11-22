import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ContributionDto, LessonCandidateDto, PlaybookDiff, PlaybookDto, PlaybookVersionRow, RetirementProposalsDto, SkillDto, SkillStep, SourceRef } from '@contracts';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';

/**
 * Reviewed playbooks and the skill library (improvement cycle 41, api mode; demo mode shows DEMO samples, see data/playbooksDemo.ts).
 * Lists re-read on every playbook.* and skill.* event and on a stream reconnect (bumpPlaybooks, from api/events.ts).
 * Only recorded facts: nothing here executes, and no agent reads a playbook yet.
 */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpPlaybooks = () => useTick.setState((s) => ({ n: s.n + 1 }));

export interface Read<T> { data: T | null; error: string | null; retry: () => void }
function useTickedRead<T>(path: string | null, pick: (r: any) => T): Read<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const tick = useTick((s) => s.n);
  const [st, setSt] = useState<{ path: string | null; data: T | null; error: string | null }>({ path, data: null, error: null });
  useEffect(() => {
    if (!path || !isApi()) return;
    let live = true;
    api<unknown>('GET', path).then((r) => { if (live) setSt({ path, data: pick(r), error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ path, data: x.path === path ? x.data : null, error: e instanceof ApiFailure ? e.message : 'Something went wrong.' })); });
    return () => { live = false; };
  }, [path, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: st.path === path ? st.data : null, error: st.error, retry: bumpPlaybooks };
}

export interface PlaybookRead { playbook: PlaybookDto; versions: PlaybookVersionRow[] }
export const usePlaybook = (agentId: string) => useTickedRead<PlaybookRead>(`/agents/${encodeURIComponent(agentId)}/playbook`, (r) => r);
export const useLessons = (agentId?: string) => useTickedRead<LessonCandidateDto[]>(agentId ? `/lessons?agentId=${encodeURIComponent(agentId)}` : '/lessons', (r) => r.lessons ?? []);
/** c59: the append-only contribution log of one lesson or skill (read when its Log is opened; null path = not asked). */
export const useContributions = (kind: 'lessons' | 'skills', id: string | null) =>
  useTickedRead<ContributionDto[]>(id ? `/${kind}/${encodeURIComponent(id)}/contributions` : null, (r) => r.contributions ?? []);
/** c59: fixture-only retirement proposals (administrators; pass false to skip the request). */
export const useRetirementProposals = (enabled: boolean) => useTickedRead<RetirementProposalsDto>(enabled ? '/skills/retirement-proposals' : null, (r) => r);
export const useSkills = () => useTickedRead<SkillDto[]>('/skills', (r) => r.skills ?? []);
/** What changed between two versions (from 0 = the empty playbook). */
export const usePlaybookDiff = (agentId: string, from: number | null, to: number | null) =>
  useTickedRead<PlaybookDiff>(from === null || to === null ? null : `/agents/${encodeURIComponent(agentId)}/playbook/diff?from=${from}&to=${to}`, (r) => r.diff);

export type Write<T> = { ok: true; value: T } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };
const fail = (e: unknown): { ok: false; code: string; message: string; fieldErrors?: Record<string, string> } =>
  (e instanceof ApiFailure ? { ok: false, code: e.code, message: e.message, fieldErrors: (e as { fieldErrors?: Record<string, string> }).fieldErrors } : { ok: false, code: 'UNKNOWN', message: 'Something went wrong.' });
async function write<T>(method: 'POST', path: string, body: unknown, idempotencyKey?: string): Promise<Write<T>> {
  try { const r = await api<T>(method, path, body, idempotencyKey ? { idempotencyKey } : {}); bumpPlaybooks(); return { ok: true, value: r }; }
  catch (e) { bumpPlaybooks(); return fail(e); } // a stale or refused write: show the current state too
}

export const proposeLesson = (agentId: string, body: { text: string; sources: SourceRef[]; reviewBy?: string }, key: string) =>
  write<{ lesson: LessonCandidateDto }>('POST', `/agents/${encodeURIComponent(agentId)}/lessons`, body, key);
export const decideLesson = (id: string, body: { decision: 'accept' | 'reject'; baseVersion?: number; note?: string; overrideNote?: string }) =>
  write<{ lesson: LessonCandidateDto; playbook: PlaybookDto | null }>('POST', `/lessons/${encodeURIComponent(id)}/decision`, body);
export const rollbackPlaybook = (agentId: string, body: { toVersion: number; baseVersion: number; why: string }) =>
  write<{ playbook: PlaybookDto }>('POST', `/agents/${encodeURIComponent(agentId)}/playbook/rollback`, body);
export const proposeSkill = (body: { name: string; description: string; steps: SkillStep[]; preconditions: string[]; sources: SourceRef[] }, key: string) =>
  write<{ skill: SkillDto }>('POST', '/skills', body, key);
export const approveSkill = (id: string) => write<{ skill: SkillDto }>('POST', `/skills/${encodeURIComponent(id)}/approve`, {});
export const retireSkill = (id: string, note: string) => write<{ skill: SkillDto }>('POST', `/skills/${encodeURIComponent(id)}/retire`, note.trim() ? { note: note.trim() } : {});
export const keepSkill = (id: string, note: string) => write<{ ok: true }>('POST', `/skills/${encodeURIComponent(id)}/retirement-dismiss`, note.trim() ? { note: note.trim() } : {});
export { newKey };
