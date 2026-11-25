import { create } from 'zustand';
import { useEffect } from 'react';
import type { RoleKey } from '@/data/types';
import { api, setCsrf, onAuthLost, ApiFailure } from '@/api/client';
import type { AccountDto, ConnectResult, MeDto } from '@contracts';

/** The server owns accounts, device approvals and the session cookie shared by this browser's tabs. */
export type AccountRole = 'admin' | 'member';
export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'disabled';
export type DeviceStatus = 'pending' | 'approved' | 'blocked';
export type DeviceKind = 'desktop' | 'laptop' | 'phone' | 'tablet';

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  browser: string;
  status: DeviceStatus;
  addedAt: number;
  lastSeenAt: number;
}

export interface AvatarSpec {
  kind: 'initials' | 'image' | 'robot';
  hue: number;
  image?: string; // data URL (kept small)
  robot?: RoleKey;
}

export interface Account {
  id: string;
  name: string;
  role: AccountRole;
  status: AccountStatus;
  avatar: AvatarSpec;
  devices: Device[];
  createdAt: number;
  approvedAt?: number;
  approvedBy?: string;
  passwordChangedAt?: number;
}

export const initialsOf = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const hueOf = (name: string) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/* ------------------------------------------------------------ this device */
function detectDevice(): Omit<Device, 'id' | 'status' | 'addedAt' | 'lastSeenAt'> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const kind: DeviceKind = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'phone' : /Mac|Windows|Linux/i.test(ua) ? 'desktop' : 'laptop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'device';
  return { name: `${browser} on ${os}`, kind, browser };
}

/** Where this browser stands with the server. */
export type ServerPhase =
  | { phase: 'booting' }
  | { phase: 'offline' }
  | { phase: 'signed-out'; firstEver?: boolean; notice?: string }
  | { phase: 'waiting'; reason: 'user' | 'device'; name: string; deviceName: string }
  | { phase: 'denied'; why: 'rejected' | 'blocked' | 'disabled'; name: string; deviceName?: string }
  | { phase: 'connected'; meId: string; deviceId: string };

export type ConnectOutcome = { ok: true; account?: Account; created: boolean } | { ok: false; error: string };
export type Done = { ok: boolean; error?: string };

interface AuthState {
  accounts: Account[];
  server: ServerPhase;
  /** Read /me (or the waiting ticket) and fill the store. */
  boot: () => Promise<void>;
  /** Re-read the user list (admins: everyone with devices; members: approved people). */
  refreshAccounts: () => Promise<void>;
  /** Connect = sign in, or register when the name is new. */
  connect: (name: string, pass: string) => Promise<ConnectOutcome>;
  signOut: () => void;
  approveUser: (id: string, by: string) => void;
  rejectUser: (id: string, by: string) => void;
  setRole: (id: string, role: AccountRole) => void;
  setStatus: (id: string, status: AccountStatus) => void;
  approveDevice: (uid: string, did: string) => void;
  blockDevice: (uid: string, did: string) => void;
  removeDevice: (uid: string, did: string) => void;
  updateProfile: (uid: string, p: { name?: string; avatar?: AvatarSpec }) => Promise<Done>;
  changePassword: (uid: string, current: string, next: string) => Promise<Done>;
}

export const useAuth = create<AuthState>(() => ({
  accounts: [],
  server: { phase: 'booting' },
  boot: apiBoot,
  refreshAccounts: apiRefresh,
  connect: apiConnect,
  signOut: () => { void apiSignOut(); },
  approveUser: id => { void adminCall('POST', `/users/${id}/approve`); },
  rejectUser: id => { void adminCall('POST', `/users/${id}/reject`); },
  setRole: (id, role) => { void adminCall('PATCH', `/users/${id}`, { role }); },
  setStatus: (id, status) => { void adminCall('PATCH', `/users/${id}`, { status }); },
  approveDevice: (uid, did) => { void adminCall('POST', `/users/${uid}/devices/${did}/approve`); },
  blockDevice: (uid, did) => { void adminCall('POST', `/users/${uid}/devices/${did}/block`); },
  removeDevice: (uid, did) => { void adminCall('DELETE', uid === meId() ? `/me/devices/${did}` : `/users/${uid}/devices/${did}`); },
  updateProfile: (_uid, profile) => apiDone(async () => { const r = await api<{ me: MeDto }>('PATCH', '/me', profile); applyMe(r.me); }),
  changePassword: (_uid, current, next) => apiDone(async () => { await api('POST', '/me/password', { current, next }); await apiRefresh(); }),
}));

const meId = () => { const sv = useAuth.getState().server; return sv.phase === 'connected' ? sv.meId : ''; };
const toAccount = (a: AccountDto): Account => ({ ...a, avatar: a.avatar as AvatarSpec });
const patchServer = (p: ServerPhase) => useAuth.setState({ server: p });
const msgOf = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Something went wrong. Try again.');

function applyMe(me: MeDto) {
  setCsrf(me.csrf);
  const acc = toAccount(me.account);
  const rest = useAuth.getState().accounts.filter((a) => a.id !== acc.id);
  useAuth.setState({ accounts: [acc, ...rest].sort((x, y) => x.createdAt - y.createdAt), server: { phase: 'connected', meId: acc.id, deviceId: me.deviceId } });
}

async function apiRefresh() {
  const st = useAuth.getState().server;
  if (st.phase !== 'connected') return;
  try {
    const [{ me }, { people }] = await Promise.all([api<{ me: MeDto }>('GET', '/me'), api<{ people: AccountDto[] }>('GET', '/people')]);
    if (useAuth.getState().server !== st) return;
    if (me.account.id !== st.meId || me.deviceId !== st.deviceId) {
      useAuth.setState({ accounts: [] });
      applyMe(me);
      await apiRefresh();
      return;
    }
    setCsrf(me.csrf);
    const meAcc = toAccount(me.account);
    useAuth.setState({ accounts: people.map((p) => (p.id === meAcc.id ? meAcc : toAccount(p))).concat(people.some((p) => p.id === meAcc.id) ? [] : [meAcc]) });
  } catch { /* auth loss is handled by onAuthLost; offline keeps the last list */ }
}

function waitingFrom(r: Extract<ConnectResult, { state: 'waiting' }>) {
  patchServer({ phase: 'waiting', reason: r.reason, name: r.name, deviceName: r.device.name });
}

async function apiBoot() {
  try {
    const { me } = await api<{ me: MeDto }>('GET', '/me', undefined, { quietAuth: true });
    applyMe(me);
    await apiRefresh();
    return;
  } catch (e) {
    if (!(e instanceof ApiFailure) || e.code === 'NETWORK' || e.code === 'UNAVAILABLE' || e.status >= 500) { patchServer({ phase: 'offline' }); return; } // review M9
    if (e.code === 'SESSION_REVOKED') { await toSignedOut(e.message); return; }
  }
  // not signed in: maybe this browser is waiting for an approval
  if (await apiPollWait()) return;
  await toSignedOut();
}

async function toSignedOut(notice?: string) {
  setCsrf('');
  const checking: ServerPhase = { phase: 'booting' };
  useAuth.setState({ accounts: [], server: checking });
  let firstEver: boolean | undefined;
  try { firstEver = (await api<{ firstEver: boolean }>('GET', '/auth/hello')).firstEver; } catch { /* hint only */ }
  if (useAuth.getState().server === checking) patchServer({ phase: 'signed-out', firstEver, notice });
}

/** One look at the waiting ticket. Returns true when the phase was decided (waiting, denied or connected). */
async function apiPollWait(): Promise<boolean> {
  const prev = useAuth.getState().server;
  try {
    const r = await api<ConnectResult>('GET', '/auth/wait', undefined, { quietAuth: true });
    if (r.state === 'signedIn') { applyMe(r.me); await apiRefresh(); return true; }
    waitingFrom(r);
    return true;
  } catch (e) {
    if (!(e instanceof ApiFailure)) return false;
    const name = prev.phase === 'waiting' ? prev.name : '';
    if (e.code === 'USER_REJECTED') { patchServer({ phase: 'denied', why: 'rejected', name }); return true; }
    if (e.code === 'USER_DISABLED') { patchServer({ phase: 'denied', why: 'disabled', name }); return true; }
    if (e.code === 'DEVICE_BLOCKED') { patchServer({ phase: 'denied', why: 'blocked', name, deviceName: prev.phase === 'waiting' ? prev.deviceName : undefined }); return true; }
    if (e.code === 'NETWORK' || e.code === 'UNAVAILABLE' || e.status >= 500) return prev.phase === 'waiting'; // keep waiting through a blip
    if (prev.phase === 'waiting' && e.status === 401) {
      // review I3: the ticket is gone — another tab of this browser may already be signed in; otherwise start over
      try { const { me } = await api<{ me: MeDto }>('GET', '/me', undefined, { quietAuth: true }); applyMe(me); await apiRefresh(); }
      catch { await toSignedOut(e.message); }
      return true;
    }
    return false;
  }
}

async function apiConnect(name: string, pass: string): Promise<ConnectOutcome> {
  const d = detectDevice();
  try {
    const r = await api<ConnectResult>('POST', '/auth/connect', { name, password: pass, device: { name: d.name, kind: d.kind, browser: d.browser } }, { quietAuth: true });
    if (r.state === 'signedIn') { applyMe(r.me); await apiRefresh(); return { ok: true, account: toAccount(r.me.account), created: false }; }
    waitingFrom(r);
    return { ok: true, created: r.reason === 'user' };
  } catch (e) {
    if (e instanceof ApiFailure && (e.code === 'USER_REJECTED' || e.code === 'USER_DISABLED' || e.code === 'DEVICE_BLOCKED')) {
      patchServer({ phase: 'denied', why: e.code === 'USER_REJECTED' ? 'rejected' : e.code === 'USER_DISABLED' ? 'disabled' : 'blocked', name: name.trim(), deviceName: d.name });
      return { ok: true, created: false };
    }
    return { ok: false, error: msgOf(e) };
  }
}

async function apiSignOut() {
  const phase = useAuth.getState().server.phase;
  try { await api('POST', phase === 'connected' ? '/auth/logout' : '/auth/cancel', {}, { quietAuth: true }); } catch { /* the cookie may already be gone */ }
  await toSignedOut();
}

async function apiDone(f: () => Promise<void>): Promise<Done> {
  try { await f(); return { ok: true }; } catch (e) { return { ok: false, error: msgOf(e) }; }
}

/** Admin actions: call the API, re-read the users; report failures as a toast (lazy import keeps the store free of UI code). */
async function adminCall(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  try { await api(method, path, body ?? {}); }
  catch (e) { const { toast } = await import('@/store/ui'); toast({ tone: 'error', title: 'Not changed', body: msgOf(e) }); }
  await apiRefresh();
}

if (typeof window !== 'undefined') {
  onAuthLost((e) => {
    if (useAuth.getState().server.phase !== 'connected') return;
    void toSignedOut(e.code === 'SESSION_REVOKED' ? e.message : 'Your session ended. Connect again.');
  });
}

/** Called by the event stream and timers (api mode). */
export const authApi = { refresh: apiRefresh, pollWait: apiPollWait, boot: apiBoot };

export function useSession() {
  const server = useAuth(st => st.server);
  return server.phase === 'connected' ? { accountId: server.meId, deviceId: server.deviceId } : null;
}

export function useMe(): Account | undefined {
  return useAuth(st => {
    const server = st.server;
    return server.phase === 'connected' ? st.accounts.find(a => a.id === server.meId) : undefined;
  });
}
export const isAdmin = (a?: Account) => !!a && a.role === 'admin' && a.status === 'approved';

/** Where this tab stands: no session, waiting (user or device), rejected, blocked, or connected. */
export type Gate = { state: 'signed-out' } | { state: 'waiting-user' | 'waiting-device' | 'rejected' | 'blocked' | 'disabled'; account: Account; device?: Device } | { state: 'connected'; account: Account; device: Device };
const pendingAccount = (name: string, status: AccountStatus): Account => ({ id: 'pending', name: name || '…', role: 'member', status, avatar: { kind: 'initials', hue: hueOf(name || '?') }, devices: [], createdAt: Date.now() });

export function useGate(): Gate {
  const sv = useAuth(st => st.server);
  const account = useMe();
  if (sv.phase === 'connected') {
    const device = account?.devices.find(d => d.id === sv.deviceId);
    if (account?.status === 'approved' && device?.status === 'approved') return { state: 'connected', account, device };
    return { state: 'signed-out' };
  }
  if (sv.phase === 'waiting') {
    const device: Device = { id: 'this', name: sv.deviceName, kind: 'desktop', browser: '', status: 'pending', addedAt: Date.now(), lastSeenAt: Date.now() };
    return { state: sv.reason === 'user' ? 'waiting-user' : 'waiting-device', account: pendingAccount(sv.name, sv.reason === 'user' ? 'pending' : 'approved'), device };
  }
  if (sv.phase === 'denied') {
    const device: Device | undefined = sv.deviceName ? { id: 'this', name: sv.deviceName, kind: 'desktop', browser: '', status: 'blocked', addedAt: Date.now(), lastSeenAt: Date.now() } : undefined;
    return { state: sv.why, account: pendingAccount(sv.name, sv.why === 'blocked' ? 'approved' : sv.why), device };
  }
  return { state: 'signed-out' };
}

/** Pending approvals an administrator must handle. */
export function usePendingApprovals() {
  const accounts = useAuth((s) => s.accounts);
  const users = accounts.filter((a) => a.status === 'pending');
  const devices = accounts.filter((a) => a.status === 'approved').flatMap((a) => a.devices.filter((d) => d.status === 'pending').map((d) => ({ account: a, device: d })));
  return { users, devices, total: users.length + devices.length };
}

/** Refresh a waiting ticket so approval in another browser or tab opens this session. */
export function useAuthPoll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => { void apiPollWait(); }, 3000);
    return () => window.clearInterval(t);
  }, [active]);
}
