import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useEffect, useSyncExternalStore } from 'react';
import type { RoleKey } from '@/data/types';
import { isApi } from '@/api/mode';
import { api, setCsrf, onAuthLost, ApiFailure } from '@/api/client';
import type { AccountDto, ConnectResult, MeDto } from '@contracts';

/**
 * Users, devices and sign-in (owner update 2026-11-20 u1) — DEMO, kept in this browser only.
 * - Everyone registers: name + password + Connect.
 * - The FIRST account becomes the administrator and is connected at once.
 * - Later accounts wait until an administrator approves them; then they connect automatically
 *   (accounts live in localStorage and are synced across tabs, so approving in one tab connects the other).
 * - A sign-in from a new device also waits for an administrator to approve that device.
 * - The signed-in session is per tab (sessionStorage), so two tabs can be two different people.
 * Stage 5: in 'api' data mode (the default) all of this lives on the AXION server instead — see `server` below.
 * The session is then an HTTP-only cookie, so every tab of a browser is the same user (owner decision D4).
 */

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
  passHash: string;
  role: AccountRole;
  status: AccountStatus;
  avatar: AvatarSpec;
  devices: Device[];
  createdAt: number;
  approvedAt?: number;
  approvedBy?: string;
  passwordChangedAt?: number;
  /** demo fixture member (seeded after the first real account) */
  fixture?: boolean;
}

/** Demo hash — NOT secure, only so plain passwords are never stored. Real auth arrives in Stage 5. */
export function demoHash(pass: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = 'axion-demo-salt:' + pass;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ (c + i), 2246822519); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export const initialsOf = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const hueOf = (name: string) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

/* ------------------------------------------------------------ this device */
const DEVICE_KEY = 'axion.device';
const SESSION_KEY = 'axion.session';

function safeLocal(): Storage | null { try { localStorage.setItem('__a', '1'); localStorage.removeItem('__a'); return localStorage; } catch { return null; } }
function safeSession(): Storage | null { try { sessionStorage.setItem('__a', '1'); sessionStorage.removeItem('__a'); return sessionStorage; } catch { return null; } }

function detectDevice(): Omit<Device, 'id' | 'status' | 'addedAt' | 'lastSeenAt'> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const kind: DeviceKind = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'phone' : /Mac|Windows|Linux/i.test(ua) ? 'desktop' : 'laptop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'device';
  return { name: `${browser} on ${os}`, kind, browser };
}

let memDevice = '';
export function thisDeviceId(): string {
  const ls = safeLocal();
  let id = ls?.getItem(DEVICE_KEY) || memDevice;
  if (!id) { id = 'dev-' + Math.random().toString(36).slice(2, 10); memDevice = id; ls?.setItem(DEVICE_KEY, id); }
  return id;
}

/* ------------------------------------------------------------ session (per tab) */
type Session = { accountId: string; deviceId: string } | null;
let memSession: Session = null;
const sessionListeners = new Set<() => void>();
function readSession(): Session {
  if (isApi()) return memSession;
  const ss = safeSession();
  if (!ss) return memSession;
  try { return JSON.parse(ss.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
let cachedSession: Session = readSession();
export function setSession(s: Session) {
  cachedSession = s; memSession = s;
  const ss = isApi() ? null : safeSession();
  if (ss) { if (s) ss.setItem(SESSION_KEY, JSON.stringify(s)); else ss.removeItem(SESSION_KEY); }
  sessionListeners.forEach((f) => f());
}
export function useSession(): Session {
  return useSyncExternalStore((cb) => { sessionListeners.add(cb); return () => sessionListeners.delete(cb); }, () => cachedSession, () => cachedSession);
}

/* ------------------------------------------------------------ fixtures */
const now = () => Date.now();
const MIN = 60_000;
function fixtureMembers(t: number): Account[] {
  const dev = (id: string, name: string, kind: DeviceKind, status: DeviceStatus, agoMin: number): Device => ({ id, name, kind, browser: name.split(' ')[0], status, addedAt: t - agoMin * MIN - 86_400_000, lastSeenAt: t - agoMin * MIN });
  const base = (id: string, name: string, status: AccountStatus, devices: Device[], extra: Partial<Account> = {}): Account => ({
    id, name, passHash: demoHash('demo'), role: 'member', status, devices, createdAt: t - 6 * 86_400_000, fixture: true,
    avatar: { kind: 'initials', hue: hueOf(name) }, ...(status === 'approved' ? { approvedAt: t - 5 * 86_400_000, approvedBy: 'u-1' } : {}), ...extra,
  });
  return [
    base('u-mina', 'Mina Park', 'approved', [dev('dev-mina-1', 'Chrome on macOS', 'laptop', 'approved', 14), dev('dev-mina-2', 'Safari on iOS', 'phone', 'pending', 3)], { avatar: { kind: 'robot', hue: 268, robot: 'design' } }),
    base('u-kenji', 'Kenji Sato', 'approved', [dev('dev-kenji-1', 'Firefox on Linux', 'desktop', 'approved', 52)]),
    base('u-sara', 'Sara Lind', 'approved', [dev('dev-sara-1', 'Edge on Windows', 'desktop', 'approved', 300)]),
    { ...base('u-tomo', 'Tomo Ito', 'pending', [dev('dev-tomo-1', 'Chrome on Android', 'phone', 'pending', 7)]), createdAt: t - 7 * MIN },
  ];
}

/* ------------------------------------------------------------ store */
/** Where this browser stands with the server (api mode only). */
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
  /** api mode: read /me (or the waiting ticket) and fill the store. */
  boot: () => Promise<void>;
  /** api mode: re-read the user list (admins: everyone with devices; members: approved people). */
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
  /** demo: pretend this account signed in from another device (it waits for approval) */
  simulateNewDevice: (uid: string) => Device;
  updateProfile: (uid: string, p: { name?: string; avatar?: AvatarSpec }) => Promise<Done>;
  changePassword: (uid: string, current: string, next: string) => Promise<Done>;
  touchDevice: (uid: string, did: string) => void;
  resetAccounts: () => void;
}

const mapAcc = (list: Account[], id: string, f: (a: Account) => Account) => list.map((a) => (a.id === id ? f(a) : a));
const mapDev = (a: Account, did: string, f: (d: Device) => Device): Account => ({ ...a, devices: a.devices.map((d) => (d.id === did ? f(d) : d)) });

export const useAuth = create<AuthState>()(persist((set, get) => ({
  accounts: [],
  server: { phase: 'booting' },
  boot: async () => { if (isApi()) await apiBoot(); },
  refreshAccounts: async () => { if (isApi()) await apiRefresh(); },

  connect: async (rawName, pass) => {
    if (isApi()) return apiConnect(rawName, pass);
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return { ok: false, error: 'Enter a name of at least 2 characters.' };
    if (pass.length < 4) return { ok: false, error: 'The password needs at least 4 characters.' };
    const t = now();
    const did = thisDeviceId();
    const info = detectDevice();
    const accounts = get().accounts;
    const existing = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (existing.passHash !== demoHash(pass)) return { ok: false, error: 'Wrong password for this name. A new name registers a new user.' };
      if (existing.status === 'disabled') return { ok: false, error: 'This user is disabled. Ask the administrator.' };
      let acc = existing;
      const known = acc.devices.find((d) => d.id === did);
      if (!known) {
        acc = { ...acc, devices: [...acc.devices, { id: did, ...info, status: 'pending', addedAt: t, lastSeenAt: t }] };
        set({ accounts: mapAcc(accounts, acc.id, () => acc) });
      }
      setSession({ accountId: acc.id, deviceId: did });
      return { ok: true, account: acc, created: false };
    }
    const first = accounts.filter((a) => !a.fixture).length === 0;
    const acc: Account = {
      id: first ? 'u-1' : 'u-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 16) + '-' + t.toString(36).slice(-4),
      name, passHash: demoHash(pass), role: first ? 'admin' : 'member', status: first ? 'approved' : 'pending',
      avatar: { kind: 'initials', hue: hueOf(name) },
      devices: [{ id: did, ...info, status: first ? 'approved' : 'pending', addedAt: t, lastSeenAt: t }],
      createdAt: t, ...(first ? { approvedAt: t, approvedBy: 'first sign-up' } : {}),
    };
    // Demo members are seeded right after the first real account so the admin has someone to approve.
    set({ accounts: first ? [acc, ...fixtureMembers(t)] : [...accounts, acc] });
    setSession({ accountId: acc.id, deviceId: did });
    return { ok: true, account: acc, created: true };
  },
  signOut: () => { if (isApi()) { void apiSignOut(); return; } setSession(null); },

  approveUser: (id, by) => isApi() ? void adminCall('POST', `/users/${id}/approve`) : set((s) => ({ accounts: mapAcc(s.accounts, id, (a) => ({ ...a, status: 'approved', approvedAt: now(), approvedBy: by, devices: a.devices.map((d) => (d.status === 'pending' ? { ...d, status: 'approved' } : d)) })) })),
  rejectUser: (id, by) => isApi() ? void adminCall('POST', `/users/${id}/reject`) : set((s) => ({ accounts: mapAcc(s.accounts, id, (a) => ({ ...a, status: 'rejected', approvedBy: by })) })),
  setRole: (id, role) => isApi() ? void adminCall('PATCH', `/users/${id}`, { role }) : set((s) => ({ accounts: mapAcc(s.accounts, id, (a) => ({ ...a, role })) })),
  setStatus: (id, status) => isApi() ? void adminCall('PATCH', `/users/${id}`, { status }) : set((s) => ({ accounts: mapAcc(s.accounts, id, (a) => ({ ...a, status })) })),
  approveDevice: (uid, did) => isApi() ? void adminCall('POST', `/users/${uid}/devices/${did}/approve`) : set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => mapDev(a, did, (d) => ({ ...d, status: 'approved' }))) })),
  blockDevice: (uid, did) => isApi() ? void adminCall('POST', `/users/${uid}/devices/${did}/block`) : set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => mapDev(a, did, (d) => ({ ...d, status: 'blocked' }))) })),
  removeDevice: (uid, did) => isApi() ? void adminCall('DELETE', uid === meId() ? `/me/devices/${did}` : `/users/${uid}/devices/${did}`) : set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => ({ ...a, devices: a.devices.filter((d) => d.id !== did) })) })),
  simulateNewDevice: (uid) => {
    const kinds: [string, DeviceKind][] = [['Safari on iOS', 'phone'], ['Chrome on Android', 'phone'], ['Firefox on Windows', 'laptop'], ['Safari on iPadOS', 'tablet']];
    const n = get().accounts.find((a) => a.id === uid)?.devices.length ?? 0;
    const [name, kind] = kinds[n % kinds.length];
    const d: Device = { id: 'dev-sim-' + now().toString(36), name, kind, browser: name.split(' ')[0], status: 'pending', addedAt: now(), lastSeenAt: now() };
    set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => ({ ...a, devices: [...a.devices, d] })) }));
    return d;
  },
  updateProfile: async (uid, p) => {
    if (isApi()) return apiDone(async () => { const r = await api<{ me: MeDto }>('PATCH', '/me', p); applyMe(r.me); });
    if (p.name !== undefined) {
      const name = p.name.trim().replace(/\s+/g, ' ');
      if (name.length < 2) return { ok: false, error: 'Name needs at least 2 characters.' };
      if (get().accounts.some((a) => a.id !== uid && a.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'Another user already has this name.' };
      p = { ...p, name };
    }
    set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => ({ ...a, ...(p.name ? { name: p.name } : {}), ...(p.avatar ? { avatar: p.avatar } : {}) })) }));
    return { ok: true };
  },
  changePassword: async (uid, current, next) => {
    if (isApi()) return apiDone(async () => { await api('POST', '/me/password', { current, next }); await apiRefresh(); });
    const a = get().accounts.find((x) => x.id === uid);
    if (!a) return { ok: false, error: 'Unknown user.' };
    if (a.passHash !== demoHash(current)) return { ok: false, error: 'The current password is wrong.' };
    if (next.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
    if (next === current) return { ok: false, error: 'The new password must differ from the current one.' };
    set((s) => ({ accounts: mapAcc(s.accounts, uid, (x) => ({ ...x, passHash: demoHash(next), passwordChangedAt: now() })) }));
    return { ok: true };
  },
  touchDevice: (uid, did) => isApi() ? undefined : set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => mapDev(a, did, (d) => ({ ...d, lastSeenAt: now() }))) })),
  resetAccounts: () => { if (isApi()) return; set({ accounts: [] }); setSession(null); },
}), {
  // api mode keeps nothing in localStorage: the server is the only record
  name: isApi() ? 'axion.accounts.api' : 'axion.accounts.v1',
  version: 1,
  partialize: (s) => (isApi() ? {} : { accounts: s.accounts }) as AuthState,
  storage: createJSONStorage(() => safeLocal() ?? (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; })()),
}));

/* ------------------------------------------------------------ api mode (Stage 5) */
const meId = () => { const sv = useAuth.getState().server; return sv.phase === 'connected' ? sv.meId : ''; };
const toAccount = (a: AccountDto): Account => ({ ...a, passHash: '', avatar: a.avatar as AvatarSpec });
const patchServer = (p: ServerPhase) => useAuth.setState({ server: p });
const msgOf = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Something went wrong. Try again.');

function applyMe(me: MeDto) {
  setCsrf(me.csrf);
  const acc = toAccount(me.account);
  const rest = useAuth.getState().accounts.filter((a) => a.id !== acc.id);
  useAuth.setState({ accounts: [acc, ...rest].sort((x, y) => x.createdAt - y.createdAt), server: { phase: 'connected', meId: acc.id, deviceId: me.deviceId } });
  setSession({ accountId: acc.id, deviceId: me.deviceId });
}

async function apiRefresh() {
  const st = useAuth.getState().server;
  if (st.phase !== 'connected') return;
  try {
    const [{ me }, { people }] = await Promise.all([api<{ me: MeDto }>('GET', '/me'), api<{ people: AccountDto[] }>('GET', '/people')]);
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
  setSession(null); setCsrf('');
  let firstEver: boolean | undefined;
  try { firstEver = (await api<{ firstEver: boolean }>('GET', '/auth/hello')).firstEver; } catch { /* hint only */ }
  useAuth.setState({ accounts: [], server: { phase: 'signed-out', firstEver, notice } });
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

if (typeof window !== 'undefined' && isApi()) {
  onAuthLost((e) => {
    if (useAuth.getState().server.phase !== 'connected') return;
    void toSignedOut(e.code === 'SESSION_REVOKED' ? e.message : 'Your session ended. Connect again.');
  });
}

/** Called by the event stream and timers (api mode). */
export const authApi = { refresh: apiRefresh, pollWait: apiPollWait, boot: apiBoot };

/* Cross-tab sync: an approval in the admin's tab reaches the waiting tab, which then connects automatically. */
if (typeof window !== 'undefined' && !isApi()) {
  window.addEventListener('storage', (e) => { if (e.key === 'axion.accounts.v1') void useAuth.persist.rehydrate(); });
  // Verification scripts (and kiosk demos) may pre-name the first admin: only honoured while no account exists.
  try {
    const auto = localStorage.getItem('axion.demo-autologin');
    if (auto) {
      const st = useAuth.getState();
      const acc = st.accounts.find((a) => a.name === auto);
      if (!acc && st.accounts.length === 0) st.connect(auto, 'demo-password');
      else if (acc && !readSession()) setSession({ accountId: acc.id, deviceId: thisDeviceId() });
    }
  } catch { /* storage blocked: nothing to auto-login */ }
}

/* ------------------------------------------------------------ selectors */
export function useMe(): Account | undefined {
  const s = useSession();
  return useAuth((st) => (s ? st.accounts.find((a) => a.id === s.accountId) : undefined));
}
export const isAdmin = (a?: Account) => !!a && a.role === 'admin' && a.status === 'approved';

/** Where this tab stands: no session, waiting (user or device), rejected, blocked, or connected. */
export type Gate = { state: 'signed-out' } | { state: 'waiting-user' | 'waiting-device' | 'rejected' | 'blocked' | 'disabled'; account: Account; device?: Device } | { state: 'connected'; account: Account; device: Device };
export function useGate(): Gate {
  const server = useAuth((st) => st.server);
  const demo = useDemoGate();
  if (!isApi()) return demo;
  return gateFromServer(server, demo);
}

const ghost = (name: string, status: AccountStatus): Account => ({ id: 'pending', name: name || '…', passHash: '', role: 'member', status, avatar: { kind: 'initials', hue: hueOf(name || '?') }, devices: [], createdAt: Date.now() });
function gateFromServer(sv: ServerPhase, demo: Gate): Gate {
  if (sv.phase === 'connected') return demo.state === 'connected' ? demo : { state: 'signed-out' };
  if (sv.phase === 'waiting') {
    const device: Device = { id: 'this', name: sv.deviceName, kind: 'desktop', browser: '', status: 'pending', addedAt: Date.now(), lastSeenAt: Date.now() };
    return { state: sv.reason === 'user' ? 'waiting-user' : 'waiting-device', account: ghost(sv.name, sv.reason === 'user' ? 'pending' : 'approved'), device };
  }
  if (sv.phase === 'denied') {
    const device: Device | undefined = sv.deviceName ? { id: 'this', name: sv.deviceName, kind: 'desktop', browser: '', status: 'blocked', addedAt: Date.now(), lastSeenAt: Date.now() } : undefined;
    return { state: sv.why, account: ghost(sv.name, sv.why === 'blocked' ? 'approved' : sv.why), device };
  }
  return { state: 'signed-out' };
}

function useDemoGate(): Gate {
  const s = useSession();
  const acc = useAuth((st) => (s ? st.accounts.find((a) => a.id === s.accountId) : undefined));
  if (!s || !acc) return { state: 'signed-out' };
  const dev = acc.devices.find((d) => d.id === s.deviceId);
  if (acc.status === 'rejected') return { state: 'rejected', account: acc };
  if (acc.status === 'disabled') return { state: 'disabled', account: acc };
  if (acc.status === 'pending') return { state: 'waiting-user', account: acc, device: dev };
  if (!dev) return { state: 'waiting-device', account: acc };
  if (dev.status === 'blocked') return { state: 'blocked', account: acc, device: dev };
  if (dev.status === 'pending') return { state: 'waiting-device', account: acc, device: dev };
  return { state: 'connected', account: acc, device: dev };
}

/** Pending approvals an administrator must handle. */
export function usePendingApprovals() {
  const accounts = useAuth((s) => s.accounts);
  const users = accounts.filter((a) => a.status === 'pending');
  const devices = accounts.filter((a) => a.status === 'approved').flatMap((a) => a.devices.filter((d) => d.status === 'pending').map((d) => ({ account: a, device: d })));
  return { users, devices, total: users.length + devices.length };
}

/** While a waiting tab is open, also poll storage (some browsers throttle `storage` events in background tabs). */
export function useAuthPoll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => { if (isApi()) void apiPollWait(); else void useAuth.persist.rehydrate(); }, isApi() ? 3000 : 1500);
    return () => window.clearInterval(t);
  }, [active]);
}
