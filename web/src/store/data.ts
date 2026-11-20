import { useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MISSIONS, FIXTURE_OWNERS, getMissionControl, threadKey } from '@/data/missions';
import { useMe, isAdmin, type Account } from '@/store/auth';
import type { Approval, Attachment, Message, MessageKind, Mission, MissionFile, MissionStatus } from '@/data/types';
import { deriveTitle, guessKind, staffingPlan } from '@/features/mission/staffing';

/**
 * DEMO data store. Every mutation here is local to the browser session —
 * nothing is sent to a backend (Stage 5+ replaces this with the real API + SSE).
 */
interface DataState {
  missions: Mission[];
  extraMessages: Record<string, Message[]>; // key: missionId + '::' + threadKey
  approvalDecisions: Record<string, 'approved' | 'denied'>;
  readNotifications: Record<string, true>;
  lastEventAt: number;
  /** Owner update u1: a mission is only its content (text + files); the GM staffs it. */
  addMission: (input: { text: string; files: MissionFile[]; shared: boolean }, owner: { id: string; name: string }) => Mission;
  updateMission: (id: string, patch: Partial<Mission>) => void;
  setMissionStatus: (id: string, status: MissionStatus) => void;
  archiveMission: (id: string) => void;
  restoreMission: (id: string) => void;
  purgeMission: (id: string) => void;
  sendMessage: (missionId: string, a: string, b: string, msg: { from: string; to: string; kind: MessageKind; text: string; attachments?: Attachment[]; replyTo?: string }) => Message;
  patchMessage: (missionId: string, a: string, b: string, id: string, patch: Partial<Message>) => void;
  decideApproval: (id: string, decision: 'approved' | 'denied') => void;
  markRead: (id: string) => void;
  markAllRead: (ids: string[]) => void;
  touch: () => void;
  resetDemo: () => void;
}

let msgSeq = 1;

export const useData = create<DataState>()(persist((set, get) => ({
  missions: MISSIONS,
  extraMessages: {},
  approvalDecisions: {},
  readNotifications: {},
  lastEventAt: Date.now(),

  addMission: (input, owner) => {
    const nums = get().missions.map((m) => Number(m.id.slice(2))).filter(Number.isFinite);
    const id = `M-${Math.max(...nums) + 1}`;
    const kind = guessKind(input.text, input.files);
    const { executorId, plan } = staffingPlan(kind, input.text);
    const now = Date.now();
    const m: Mission = {
      id, kind, title: deriveTitle(input.text, input.files), objective: input.text.trim() || 'See the attached files.',
      content: { text: input.text.trim(), files: input.files },
      owner: owner.name, ownerId: owner.id, shared: input.shared,
      status: 'planning', priority: 'normal', criteria: [], progress: 0, tasksVerified: 0, tasksTotal: plan.length + 2, blocked: 0,
      agentIds: ['gm'], leadId: 'gm', executorId,
      staffing: { stage: 'reading', plan, joined: 0, log: [{ at: now, by: 'gm', text: `GM is reading the mission from ${owner.name}` }] },
      summary: 'The General Manager is reading the mission and will appoint a general executor.', summaryAgoMin: 0,
      lastEvent: `Added by ${owner.name}`, lastEventAgoMin: 0,
      elapsedH: 0, dueInDays: 7, revision: 1, version: 'v0.1.0',
      phases: ['Plan', 'Design', 'Build', 'Verify', 'Deliver', 'Learn'].map((label, i) => ({ key: label.toLowerCase(), label, date: '—', state: i === 0 ? 'active' : 'next' })),
      pendingApprovals: 0, unread: 0, createdAgoDays: 0,
    };
    set((s) => ({ missions: [m, ...s.missions], lastEventAt: Date.now() }));
    return m;
  },
  updateMission: (id, patch) => set((s) => ({ missions: s.missions.map((m) => (m.id === id ? { ...m, ...patch } : m)), lastEventAt: Date.now() })),
  setMissionStatus: (id, status) => set((s) => ({
    missions: s.missions.map((m) => (m.id === id ? { ...m, status, lastEvent: `Status changed to ${status} by Luca`, lastEventAgoMin: 0 } : m)),
    lastEventAt: Date.now(),
  })),
  archiveMission: (id) => get().setMissionStatus(id, 'archived'),
  restoreMission: (id) => get().setMissionStatus(id, 'paused'),
  purgeMission: (id) => set((s) => ({ missions: s.missions.filter((m) => m.id !== id) })),

  sendMessage: (missionId, a, b, msg) => {
    const key = `${missionId}::${threadKey(a, b)}`;
    const full: Message = { id: `live-${msgSeq++}`, agoMin: 0, ts: Date.now(), status: 'sent', ...msg };
    set((s) => ({ extraMessages: { ...s.extraMessages, [key]: [...(s.extraMessages[key] ?? []), full] }, lastEventAt: Date.now() }));
    return full;
  },
  patchMessage: (missionId, a, b, id, patch) => {
    const key = `${missionId}::${threadKey(a, b)}`;
    set((s) => ({ extraMessages: { ...s.extraMessages, [key]: (s.extraMessages[key] ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) } }));
  },
  decideApproval: (id, decision) => set((s) => ({ approvalDecisions: { ...s.approvalDecisions, [id]: decision }, lastEventAt: Date.now() })),
  markRead: (id) => set((s) => ({ readNotifications: { ...s.readNotifications, [id]: true } })),
  markAllRead: (ids) => set((s) => ({ readNotifications: { ...s.readNotifications, ...Object.fromEntries(ids.map((i) => [i, true as const])) } })),
  touch: () => set({ lastEventAt: Date.now() }),
  resetDemo: () => set({ missions: MISSIONS, extraMessages: {}, approvalDecisions: {}, readNotifications: {}, lastEventAt: Date.now() }),
}), {
  // DEMO state survives reloads in this browser only (Stage 5 replaces it with the real API).
  name: 'axion.demo-data.v1',
  // v2 (owner update 2026-11-20 u1): missions lose budget/cost, gain ownerId/shared/content; finance-01 became loader-01.
  version: 2,
  migrate: (persisted, from) => {
    type Legacy = Partial<Mission> & { id: string; objective?: string; cost?: number; budget?: number };
    const st = (persisted ?? {}) as { missions?: Legacy[] } & Record<string, unknown>;
    if (from < 2 && Array.isArray(st.missions)) {
      st.missions = st.missions.map((m: Legacy) => {
        const { cost: _c, budget: _b, ...rest } = m; void _c; void _b;
        return {
          ...rest,
          ownerId: rest.ownerId ?? FIXTURE_OWNERS[rest.id]?.ownerId ?? 'u-1',
          shared: rest.shared ?? FIXTURE_OWNERS[rest.id]?.shared ?? false,
          content: rest.content ?? { text: rest.objective ?? '', files: [] },
          agentIds: (rest.agentIds ?? []).map((id) => (id === 'finance-01' ? 'loader-01' : id)),
        } as Legacy;
      });
    }
    return st as unknown as DataState;
  },
  storage: createJSONStorage(() => { try { localStorage.setItem('__d', '1'); localStorage.removeItem('__d'); return localStorage; } catch { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; } }),
  // blob: URLs die with the page, so attachments keep only their metadata
  partialize: (s) => ({
    missions: s.missions.map((m) => (m.content?.files.some((f) => f.url) ? { ...m, content: { ...m.content, files: m.content.files.map((f) => ({ ...f, url: undefined })) } } : m)), approvalDecisions: s.approvalDecisions, readNotifications: s.readNotifications,
    extraMessages: Object.fromEntries(Object.entries(s.extraMessages).map(([k, v]) => [k, v.map((m) => ({ ...m, attachments: m.attachments?.map((a) => ({ ...a, url: undefined })) }))])),
  }) as unknown as DataState,
}));

export function useMission(id: string | undefined) {
  return useData((s) => s.missions.find((m) => m.id === id));
}

export function threadMessages(missionId: string, a: string, b: string, extra: Record<string, Message[]>): Message[] {
  const m = useData.getState().missions.find((x) => x.id === missionId);
  if (!m) return [];
  const base = getMissionControl(m).threads[threadKey(a, b)] ?? [];
  return [...base, ...(extra[`${missionId}::${threadKey(a, b)}`] ?? [])];
}

export function allApprovals(missions: Mission[], decisions: Record<string, 'approved' | 'denied'>): Approval[] {
  return missions.flatMap((m) => getMissionControl(m).approvals).map((a) => (decisions[a.id] ? { ...a, status: decisions[a.id] } : a));
}

/* Cross-tab sync (owner update u1): two tabs can be two users, so a mission added or shared in one tab must reach the other. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === 'axion.demo-data.v1') void useData.persist.rehydrate(); });
}

/** Can this account see the mission? Owners see theirs, everyone sees shared ones, administrators see all (owner update u1). */
export const canSee = (m: Mission, me?: Account) => !!me && (isAdmin(me) || m.ownerId === me.id || m.shared);

/** The missions the signed-in user may see. Use this instead of reading `missions` directly in views. */
export function useVisibleMissions(): Mission[] {
  const me = useMe();
  const missions = useData((s) => s.missions);
  return useMemo(() => missions.filter((m) => canSee(m, me)), [missions, me]);
}
