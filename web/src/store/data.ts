import { useMemo } from 'react';
import { create } from 'zustand';
import { useAuth, useMe, isAdmin, type Account } from '@/store/auth';
import type { Approval, Mission, MissionFile, MissionStatus } from '@/data/types';
import { api, newKey, ApiFailure } from '@/api/client';
import type { Notice } from '@/data/notifications';
import { actionForUiStatus, type UiMissionStatus } from '@contracts';
import { missionCreateBody } from '@/features/mission/create-body';

/** Mission records are scoped to the current server session and updated by the event stream. */
export type Connection = 'off' | 'live' | 'reconnecting' | 'stale';
interface DataState {
  missions: Mission[];
  /** api mode: approvals of visible missions (server) */
  approvals: Approval[];
  /** Notifications returned by the server. */
  serverNotices: Notice[];
  connection: Connection;
  loaded: boolean;
  approvalDecisions: Record<string, 'approved' | 'denied'>;
  readNotifications: Record<string, true>;
  lastEventAt: number;
  /** Owner update u1: a mission is only its content (text + files); the GM staffs it. */
  addMission: (input: { text: string; files: MissionFile[]; shared: boolean; improve?: boolean }, owner: { id: string; name: string }) => Promise<Mission>;
  updateMission: (id: string, patch: Partial<Mission>) => void;
  setMissionStatus: (id: string, status: MissionStatus) => void;
  archiveMission: (id: string) => void;
  restoreMission: (id: string) => void;
  purgeMission: (id: string) => void;
  decideApproval: (id: string, decision: 'approved' | 'denied', reason?: string) => Promise<boolean>;
  markRead: (id: string) => void;
  markAllRead: (ids: string[]) => void;
  touch: () => void;
}

export const useData = create<DataState>((set) => ({
  missions: [],
  approvals: [],
  serverNotices: [],
  connection: 'off',
  loaded: false,
  approvalDecisions: {},
  readNotifications: {},
  lastEventAt: Date.now(),

  addMission: apiAddMission,
  updateMission: (id, patch) => { void apiUpdateMission(id, patch); },
  setMissionStatus: (id, status) => { void apiSetStatus(id, status); },
  archiveMission: id => { void apiAction(id, 'archive', { cancelFirst: true }); },
  restoreMission: id => { void apiAction(id, 'restore'); },
  purgeMission: id => { void apiDelete(id); },

  decideApproval: apiDecide,
  markRead: (id) => { void acknowledge([id]); },
  markAllRead: (ids) => { void acknowledge(ids); },
  touch: () => set({ lastEventAt: Date.now() }),
}));

export function useMission(id: string | undefined) {
  return useData((s) => s.missions.find((m) => m.id === id));
}

export function allApprovals(missions: Mission[], decisions: Record<string, 'approved' | 'denied'>): Approval[] {
  const ids = new Set(missions.map(m => m.id));
  return useData.getState().approvals.filter(a => ids.has(a.missionId)).map(a => (
    decisions[a.id] && a.status === 'pending' ? { ...a, status: decisions[a.id] } : a
  ));
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
    missions: ms.missions.filter(m => !m.demo), loaded: true, lastEventAt: Date.now(),
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
    if (r.mission.demo) { drop(id); return 'gone'; }
    put(r.mission); return 'ok';
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) { if (gen.get(id) !== mine) return 'stale'; const had = useData.getState().missions.some((m) => m.id === id); drop(id); return had ? 'gone' : 'stale'; }
    throw e;
  }
}
export async function refreshApprovals() { useData.setState(approvalsState((await api<{ approvals: ServerApproval[] }>('GET', '/approvals')).approvals)); }
async function acknowledge(ids: string[]) {
  if (!ids.length) return;
  const user = useAuth.getState().server;
  try {
    if (ids.length === 1) await api('POST', `/notifications/${encodeURIComponent(ids[0])}/ack`, {});
    else await api('POST', '/notifications/ack-all', { ids });
    const current = useAuth.getState().server;
    if (user.phase === 'connected' && current.phase === 'connected' && current.meId === user.meId) {
      useData.setState(s => ({ readNotifications: { ...s.readNotifications, ...Object.fromEntries(ids.map(id => [id, true])) } }));
    }
  } catch (e) { await say('Could not acknowledge notifications', e); }
}
export async function refreshNotices() {
  const nt = await api<{ notifications: Notice[]; read: string[] }>('GET', '/notifications');
  useData.setState((s) => ({ serverNotices: nt.notifications, readNotifications: { ...s.readNotifications, ...Object.fromEntries(nt.read.map((i) => [i, true as const])) } }));
}
export function clearServerData() { useData.setState({ missions: [], approvals: [], serverNotices: [], approvalDecisions: {}, readNotifications: {}, loaded: false, connection: 'off' }); }

async function uploadMissionFiles(files: { name: string; blob?: Blob }[]) {
  const ids: string[] = [];
  for (const f of files) {
    if (!f.blob) throw new Error(`Choose ${f.name} again before uploading.`);
    const fd = new FormData();
    fd.append('file', f.blob, f.name);
    ids.push((await api<{ id: string }>('POST', '/uploads', fd)).id);
  }
  return ids;
}

export async function attachMissionFiles(id: string, files: { name: string; blob?: Blob }[], rowVersion: number) {
  const addFiles = await uploadMissionFiles(files);
  const result = await api<{ mission: ServerMission }>('PATCH', `/missions/${id}`, { addFiles }, { ifMatch: rowVersion });
  put(result.mission);
}

async function apiAddMission(input: { text: string; files: MissionFile[]; shared: boolean; improve?: boolean }): Promise<Mission> {
  const ids = await uploadMissionFiles(input.files);
  const r = await api<{ mission: ServerMission }>('POST', '/missions', missionCreateBody(input, ids), { idempotencyKey: newKey() });
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

async function apiDecide(id: string, decision: 'approved' | 'denied', reason = '') {
  const a = useData.getState().approvals.find((x) => x.id === id) as ServerApproval | undefined;
  if (!a || a.canDecide !== true) return false;
  try {
    await api('POST', `/approvals/${id}/decision`, { decision, digest: a.digest, reason });
    useData.setState(s => ({ approvalDecisions: { ...s.approvalDecisions, [id]: decision }, lastEventAt: Date.now() }));
    return true;
  } catch (e) {
    await say('Decision not recorded', e);
    return false;
  } finally {
    await Promise.all([refreshApprovals(), refreshMission(a.missionId)]).catch(() => undefined);
  }
}

/** Can this account see the mission? Owners see theirs, everyone sees shared ones, administrators see all (owner update u1). */
export const canSee = (m: Mission, me?: Account) => !!me && (isAdmin(me) || m.ownerId === me.id || m.shared);

/** The missions the signed-in user may see. Use this instead of reading `missions` directly in views. */
export function useVisibleMissions(): Mission[] {
  const me = useMe();
  const missions = useData((s) => s.missions);
  return useMemo(() => missions.filter((m) => canSee(m, me)), [missions, me]);
}
