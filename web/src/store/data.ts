import { useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MISSIONS, FIXTURE_OWNERS, getMissionControl, threadKey } from '@/data/missions';
import { useMe, isAdmin, type Account } from '@/store/auth';
import type { Approval, Attachment, Message, MessageKind, Mission, MissionFile, MissionStatus } from '@/data/types';
import { deriveTitle, guessKind, staffingPlan } from '@/features/mission/staffing';
import { isApi } from '@/api/mode';
import { api, newKey, ApiFailure } from '@/api/client';
import type { Notice } from '@/data/notifications';
import { actionForUiStatus, type UiMissionStatus } from '@contracts';

/**
 * Mission data. In 'demo' mode every mutation stays in this browser (the prototype).
 * In 'api' mode (Stage 5) missions, approvals and notification read state come from the server: actions call the API,
 * apply the change optimistically and roll back with a toast on error; the event stream (api/events.ts) keeps it current.
 * Stage 6: in api mode mission conversations, hierarchy and tasks come from the server (api/missionControl.ts);
 * extraMessages are the demo mode's local conversations only.
 */
export type Connection = 'off' | 'live' | 'reconnecting' | 'stale';
interface DataState {
  missions: Mission[];
  /** api mode: approvals of visible missions (server) */
  approvals: Approval[];
  /** api mode: server notifications (shown before the DEMO fixture notices) */
  serverNotices: Notice[];
  connection: Connection;
  loaded: boolean;
  extraMessages: Record<string, Message[]>; // key: missionId + '::' + threadKey
  approvalDecisions: Record<string, 'approved' | 'denied'>;
  readNotifications: Record<string, true>;
  lastEventAt: number;
  /** Owner update u1: a mission is only its content (text + files); the GM staffs it. */
  addMission: (input: { text: string; files: MissionFile[]; shared: boolean }, owner: { id: string; name: string }) => Promise<Mission>;
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
  missions: isApi() ? [] : MISSIONS,
  approvals: [],
  serverNotices: [],
  connection: 'off',
  loaded: !isApi(),
  extraMessages: {},
  approvalDecisions: {},
  readNotifications: {},
  lastEventAt: Date.now(),

  addMission: async (input, owner) => {
    if (isApi()) return apiAddMission(input);
    const nums = get().missions.map((m) => Number(m.id.slice(2))).filter(Number.isFinite);
    const id = `M-${Math.max(...nums) + 1}`;
    const kind = guessKind(input.text, input.files);
    const { executorId, plan } = staffingPlan(kind, input.text);
    const now = Date.now();
    const m: Mission = {
      id, kind, title: deriveTitle(input.text, input.files), objective: input.text.trim() || 'See the attached files.',
      content: { text: input.text.trim(), files: input.files.map(({ blob: _b, ...f }) => { void _b; return f; }) },
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
  updateMission: (id, patch) => { if (isApi()) { void apiUpdateMission(id, patch); return; } set((s) => ({ missions: s.missions.map((m) => (m.id === id ? { ...m, ...patch } : m)), lastEventAt: Date.now() })); },
  setMissionStatus: (id, status) => isApi() ? void apiSetStatus(id, status) : set((s) => ({
    missions: s.missions.map((m) => (m.id === id ? { ...m, status, lastEvent: `Status changed to ${status} by Luca`, lastEventAgoMin: 0 } : m)),
    lastEventAt: Date.now(),
  })),
  archiveMission: (id) => isApi() ? void apiAction(id, 'archive', { cancelFirst: true }) : get().setMissionStatus(id, 'archived'),
  restoreMission: (id) => isApi() ? void apiAction(id, 'restore') : get().setMissionStatus(id, 'paused'),
  purgeMission: (id) => isApi() ? void apiDelete(id) : set((s) => ({ missions: s.missions.filter((m) => m.id !== id) })),

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
  decideApproval: (id, decision) => { if (isApi()) { void apiDecide(id, decision); return; } set((s) => ({ approvalDecisions: { ...s.approvalDecisions, [id]: decision }, lastEventAt: Date.now() })); },
  markRead: (id) => { set((s) => ({ readNotifications: { ...s.readNotifications, [id]: true } })); if (isApi()) void api('POST', `/notifications/${encodeURIComponent(id)}/ack`, {}).catch(() => undefined); },
  markAllRead: (ids) => { set((s) => ({ readNotifications: { ...s.readNotifications, ...Object.fromEntries(ids.map((i) => [i, true as const])) } })); if (isApi() && ids.length) void api('POST', '/notifications/ack-all', { ids }).catch(() => undefined); },
  touch: () => set({ lastEventAt: Date.now() }),
  resetDemo: () => isApi() ? undefined : set({ missions: MISSIONS, extraMessages: {}, approvalDecisions: {}, readNotifications: {}, lastEventAt: Date.now() }),
}), {
  // DEMO state survives reloads in this browser only; api mode keeps only the DEMO conversations locally.
  name: isApi() ? 'axion.api-data.v1' : 'axion.demo-data.v1',
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
  partialize: (s) => (isApi() ? {
    extraMessages: Object.fromEntries(Object.entries(s.extraMessages).map(([k, v]) => [k, v.map((m) => ({ ...m, attachments: m.attachments?.map((a) => ({ ...a, url: undefined, blob: undefined })) }))])),
  } : {
    missions: s.missions.map((m) => (m.content?.files.some((f) => f.url) ? { ...m, content: { ...m.content, files: m.content.files.map((f) => ({ ...f, url: undefined })) } } : m)), approvalDecisions: s.approvalDecisions, readNotifications: s.readNotifications,
    extraMessages: Object.fromEntries(Object.entries(s.extraMessages).map(([k, v]) => [k, v.map((m) => ({ ...m, attachments: m.attachments?.map((a) => ({ ...a, url: undefined, blob: undefined })) }))])),
  }) as unknown as DataState,
}));

export function useMission(id: string | undefined) {
  return useData((s) => s.missions.find((m) => m.id === id));
}

export function threadMessages(missionId: string, a: string, b: string, extra: Record<string, Message[]>): Message[] {
  const m = useData.getState().missions.find((x) => x.id === missionId);
  if (!m) return [];
  const base = getMissionControl(m).threads[threadKey(a, b)] ?? [];
  return isApi() ? base : [...base, ...(extra[`${missionId}::${threadKey(a, b)}`] ?? [])]; // api mode: the server's thread only
}

export function allApprovals(missions: Mission[], decisions: Record<string, 'approved' | 'denied'>): Approval[] {
  if (isApi()) {
    // server approvals; `decisions` changes whenever they reload, so callers' memos stay fresh
    const ids = new Set(missions.map((m) => m.id));
    return useData.getState().approvals.filter((a) => ids.has(a.missionId)).map((a) => (decisions[a.id] && a.status === 'pending' ? { ...a, status: decisions[a.id] } : a));
  }
  return missions.flatMap((m) => getMissionControl(m).approvals).map((a) => (decisions[a.id] ? { ...a, status: decisions[a.id] } : a));
}

/* Cross-tab sync (owner update u1): two tabs can be two users, so a mission added or shared in one tab must reach the other. */
if (typeof window !== 'undefined' && !isApi()) {
  window.addEventListener('storage', (e) => { if (e.key === 'axion.demo-data.v1') void useData.persist.rehydrate(); });
}

/* ------------------------------------------------------------ api mode (Stage 5) */
type ServerMission = Mission & { rowVersion: number; serverStatus: string };
type ServerApproval = Approval & { digest: string; state: string };
const say = async (title: string, e: unknown) => { const { toast } = await import('@/store/ui'); toast({ tone: 'error', title, body: e instanceof ApiFailure ? e.message : 'Something went wrong. Try again.' }); };
// review I7: a response that is older than what we hold (syncVersion = the server's row_version) is ignored,
// and a per-id request generation lets drop() cancel refreshes that were already in flight.
const gen = new Map<string, number>();
const bump = (id: string) => { const g = (gen.get(id) ?? 0) + 1; gen.set(id, g); return g; };
let snapGen = 0;
type Synced = Mission & { syncVersion?: number };
const put = (m: Mission) => useData.setState((s) => {
  const i = s.missions.findIndex((x) => x.id === m.id);
  const cur = s.missions[i] as Synced | undefined;
  const inc = m as Synced;
  if (cur && cur.syncVersion !== undefined && inc.syncVersion !== undefined && inc.syncVersion < cur.syncVersion) return {};
  const missions = i < 0 ? [m, ...s.missions] : s.missions.map((x) => (x.id === m.id ? m : x));
  return { missions, lastEventAt: Date.now() };
});
const drop = (id: string) => { bump(id); useData.setState((s) => ({ missions: s.missions.filter((m) => m.id !== id), lastEventAt: Date.now() })); };
/**
 * A request about this mission answered 404. That alone does not prove the mission is gone (a thread or agent instance
 * can be missing on a visible mission), so re-read the mission itself: only when that is 404 too is it forgotten and the
 * open view told to leave it (one toast, from the Missions page). Returns true when the mission is gone.
 */
export async function confirmMissionGone(id: string): Promise<boolean> {
  const had = useData.getState().missions.some((m) => m.id === id);
  let r: 'ok' | 'gone' | 'stale';
  try { r = await refreshMission(id); } catch { return false; }
  if (r === 'ok') return false;
  if (r === 'stale') return !useData.getState().missions.some((m) => m.id === id) && had; // a newer read already decided
  window.dispatchEvent(new CustomEvent('axion:mission-gone', { detail: id }));
  return true;
}

/** Full snapshot: after sign-in, after every (re)connect of the event stream, or after a gap. */
export async function loadSnapshot() {
  const mine = ++snapGen;
  const [ms, ap, nt] = await Promise.all([
    api<{ missions: ServerMission[] }>('GET', '/missions'),
    api<{ approvals: ServerApproval[] }>('GET', '/approvals'),
    api<{ notifications: Notice[]; read: string[] }>('GET', '/notifications'),
  ]);
  if (mine !== snapGen) return; // a newer snapshot was started meanwhile
  useData.setState((s) => ({
    missions: ms.missions, loaded: true, lastEventAt: Date.now(),
    ...approvalsState(ap.approvals),
    serverNotices: nt.notifications,
    readNotifications: { ...s.readNotifications, ...Object.fromEntries(nt.read.map((i) => [i, true as const])) },
  }));
}
function approvalsState(list: ServerApproval[]) {
  return { approvals: list as Approval[], approvalDecisions: Object.fromEntries(list.filter((a) => a.status !== 'pending').map((a) => [a.id, a.status as 'approved' | 'denied'])) };
}
export async function refreshMission(id: string): Promise<'ok' | 'gone' | 'stale'> {
  const mine = bump(id);
  try {
    const r = await api<{ mission: ServerMission }>('GET', `/missions/${id}`);
    if (gen.get(id) !== mine) return 'stale';
    put(r.mission); return 'ok';
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) { if (gen.get(id) !== mine) return 'stale'; const had = useData.getState().missions.some((m) => m.id === id); drop(id); return had ? 'gone' : 'stale'; }
    throw e;
  }
}
export async function refreshApprovals() { useData.setState(approvalsState((await api<{ approvals: ServerApproval[] }>('GET', '/approvals')).approvals)); }
export async function refreshNotices() {
  const nt = await api<{ notifications: Notice[]; read: string[] }>('GET', '/notifications');
  useData.setState((s) => ({ serverNotices: nt.notifications, readNotifications: { ...s.readNotifications, ...Object.fromEntries(nt.read.map((i) => [i, true as const])) } }));
}
export function clearServerData() { useData.setState({ missions: [], approvals: [], serverNotices: [], approvalDecisions: {}, readNotifications: {}, loaded: false, connection: 'off' }); }

async function apiAddMission(input: { text: string; files: MissionFile[]; shared: boolean }): Promise<Mission> {
  const ids: string[] = [];
  for (const f of input.files) {
    if (!f.blob) continue;
    const fd = new FormData();
    fd.append('file', f.blob, f.name);
    ids.push((await api<{ id: string }>('POST', '/uploads', fd)).id);
  }
  const r = await api<{ mission: ServerMission }>('POST', '/missions', { text: input.text, files: ids, shared: input.shared }, { idempotencyKey: newKey() });
  put(r.mission);
  return r.mission;
}

const EDITABLE = ['title', 'kind', 'priority', 'criteria'] as const;
async function apiUpdateMission(id: string, patch: Partial<Mission>) {
  const before = useData.getState().missions.find((m) => m.id === id);
  if (!before) return;
  put({ ...before, ...patch });
  try {
    if (patch.shared !== undefined && patch.shared !== before.shared) put((await api<{ mission: ServerMission }>('POST', `/missions/${id}/share`, { shared: patch.shared })).mission);
    const body: Record<string, unknown> = {};
    for (const k of EDITABLE) if (patch[k] !== undefined) body[k] = patch[k];
    if (patch.content?.text !== undefined && patch.content.text !== before.content.text) body.text = patch.content.text;
    if (patch.objective !== undefined && body.text === undefined && patch.objective !== before.objective) body.text = patch.objective;
    if (Object.keys(body).length) {
      const cur = useData.getState().missions.find((m) => m.id === id);
      put((await api<{ mission: ServerMission }>('PATCH', `/missions/${id}`, body, { ifMatch: patch.rowVersion ?? cur?.rowVersion ?? before.rowVersion })).mission);
    }
  } catch (e) {
    bump(id); useData.setState((s) => ({ missions: s.missions.map((x) => (x.id === id ? before : x)) }));
    await refreshMission(id).catch(() => undefined);
    await say('Not saved', e);
  }
}

async function apiAction(id: string, action: string, body: Record<string, unknown> = {}, original?: Mission) {
  const before = original ?? useData.getState().missions.find((m) => m.id === id);
  try { put((await api<{ mission: ServerMission }>('POST', `/missions/${id}/actions/${action}`, body, { idempotencyKey: newKey() })).mission); }
  catch (e) {
    // review I1: restore the state from before the optimistic change, then re-read the truth
    if (before) { bump(id); useData.setState((s) => ({ missions: s.missions.map((x) => (x.id === id ? before : x)) })); }
    await refreshMission(id).catch(() => undefined);
    await say('Not changed', e);
  }
}

async function apiSetStatus(id: string, status: MissionStatus) {
  const m = useData.getState().missions.find((x) => x.id === id);
  if (!m) return;
  if (status === 'archived') return apiAction(id, 'archive', { cancelFirst: true });
  if (m.status === 'archived') return apiAction(id, 'restore');
  const action = actionForUiStatus(m.status as UiMissionStatus, status as UiMissionStatus);
  if (!action) { await say('Not changed', new ApiFailure('ILLEGAL_TRANSITION', 409, `The server decides when a mission becomes ${status}.`)); return; }
  useData.setState((s) => ({ missions: s.missions.map((x) => (x.id === id ? { ...m, status } : x)) }));
  await apiAction(id, action, {}, m);
}

async function apiDelete(id: string) {
  const before = useData.getState().missions.find((m) => m.id === id);
  drop(id);
  try { await api('DELETE', `/missions/${id}`); }
  catch (e) { if (e instanceof ApiFailure && e.status === 404) return; if (before) put(before); await say('Not deleted', e); }
}

async function apiDecide(id: string, decision: 'approved' | 'denied') {
  const a = useData.getState().approvals.find((x) => x.id === id) as ServerApproval | undefined;
  if (!a) return;
  useData.setState((s) => ({ approvalDecisions: { ...s.approvalDecisions, [id]: decision }, lastEventAt: Date.now() }));
  try {
    await api('POST', `/approvals/${id}/decision`, { decision, digest: a.digest });
  } catch (e) {
    useData.setState((s) => { const d = { ...s.approvalDecisions }; delete d[id]; return { approvalDecisions: d }; });
    await say('Decision not recorded', e);
  }
  await Promise.all([refreshApprovals(), refreshMission(a.missionId)]).catch(() => undefined);
}

/** Can this account see the mission? Owners see theirs, everyone sees shared ones, administrators see all (owner update u1). */
export const canSee = (m: Mission, me?: Account) => !!me && (isAdmin(me) || m.ownerId === me.id || m.shared);

/** The missions the signed-in user may see. Use this instead of reading `missions` directly in views. */
export function useVisibleMissions(): Mission[] {
  const me = useMe();
  const missions = useData((s) => s.missions);
  return useMemo(() => missions.filter((m) => canSee(m, me)), [missions, me]);
}
