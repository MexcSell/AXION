import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MISSIONS, getMissionControl, threadKey } from '@/data/missions';
import type { Approval, Attachment, Message, MessageKind, Mission, MissionStatus } from '@/data/types';

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
  addMission: (m: Partial<Mission> & { title: string; objective: string }, start: boolean) => Mission;
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

  addMission: (p, start) => {
    const nums = get().missions.map((m) => Number(m.id.slice(2))).filter(Number.isFinite);
    const id = `M-${Math.max(...nums) + 1}`;
    const m: Mission = {
      id, kind: 'website', priority: 'normal', owner: 'Luca', criteria: [], progress: 0, tasksVerified: 0, tasksTotal: 6, blocked: 0,
      agentIds: ['gm', 'planner-01', 'coder-01', 'tester-01'], leadId: 'gm',
      summary: start ? 'GM is drafting the plan and staffing the team. The first summary arrives after the first verified checkpoint.' : 'Draft saved. Nothing is running yet.',
      summaryAgoMin: 0, lastEvent: start ? 'Mission started · GM planning' : 'Draft created', lastEventAgoMin: 0,
      cost: 0, budget: 50, elapsedH: 0, dueInDays: 7, revision: 1, version: 'v0.1.0',
      phases: ['Plan', 'Design', 'Build', 'Verify', 'Deliver', 'Learn'].map((label, i) => ({ key: label.toLowerCase(), label, date: '—', state: i === 0 && start ? 'active' : 'next' })),
      pendingApprovals: 0, unread: 0, createdAgoDays: 0,
      ...p,
      status: start ? 'planning' : 'draft',
    } as Mission;
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
  version: 1,
  storage: createJSONStorage(() => { try { localStorage.setItem('__d', '1'); localStorage.removeItem('__d'); return localStorage; } catch { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; } }),
  // blob: URLs die with the page, so attachments keep only their metadata
  partialize: (s) => ({
    missions: s.missions, approvalDecisions: s.approvalDecisions, readNotifications: s.readNotifications,
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
