import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useEffect, useSyncExternalStore } from 'react';
import type { RoleKey } from '@/data/types';

/**
 * Users, devices and sign-in (owner update 2026-11-20 u1) — DEMO, kept in this browser only.
 * - Everyone registers: name + password + Connect.
 * - The FIRST account becomes the administrator and is connected at once.
 * - Later accounts wait until an administrator approves them; then they connect automatically
 *   (accounts live in localStorage and are synced across tabs, so approving in one tab connects the other).
 * - A sign-in from a new device also waits for an administrator to approve that device.
 * - The signed-in session is per tab (sessionStorage), so two tabs can be two different people.
 * Stage 5 replaces all of this with real server-side auth; passwords here are only hashed with a demo hash.
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
  const ss = safeSession();
  if (!ss) return memSession;
  try { return JSON.parse(ss.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
let cachedSession: Session = readSession();
export function setSession(s: Session) {
  cachedSession = s; memSession = s;
  const ss = safeSession();
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
interface AuthState {
  accounts: Account[];
  /** Connect = sign in, or register when the name is new. */
  connect: (name: string, pass: string) => { ok: true; account: Account; created: boolean } | { ok: false; error: string };
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
  updateProfile: (uid: string, p: { name?: string; avatar?: AvatarSpec }) => { ok: boolean; error?: string };
  changePassword: (uid: string, current: string, next: string) => { ok: boolean; error?: string };
  touchDevice: (uid: string, did: string) => void;
  resetAccounts: () => void;
}

const mapAcc = (list: Account[], id: string, f: (a: Account) => Account) => list.map((a) => (a.id === id ? f(a) : a));
const mapDev = (a: Account, did: string, f: (d: Device) => Device): Account => ({ ...a, devices: a.devices.map((d) => (d.id === did ? f(d) : d)) });

export const useAuth = create<AuthState>()(persist((set, get) => ({
  accounts: [],

  connect: (rawName, pass) => {
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
  signOut: () => setSession(null),

  approveUser: (id, by) => set((s) => ({ accounts: mapAcc(s.accounts, id, (a) => ({ ...a, status: 'approved', approvedAt: now(), approvedBy: by, devices: a.devices.map((d) => (d.status === 'pending' ? { ...d, status: 'approved' } : d)) })) })),
  rejectUser: (id, by) => set((s) => ({ accounts: mapAcc(s.accounts, id, (a) => ({ ...a, status: 'rejected', approvedBy: by })) })),
  setRole: (id, role) => set((s) => ({ accounts: mapAcc(s.accounts, id, (a) => ({ ...a, role })) })),
  setStatus: (id, status) => set((s) => ({ accounts: mapAcc(s.accounts, id, (a) => ({ ...a, status })) })),
  approveDevice: (uid, did) => set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => mapDev(a, did, (d) => ({ ...d, status: 'approved' }))) })),
  blockDevice: (uid, did) => set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => mapDev(a, did, (d) => ({ ...d, status: 'blocked' }))) })),
  removeDevice: (uid, did) => set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => ({ ...a, devices: a.devices.filter((d) => d.id !== did) })) })),
  simulateNewDevice: (uid) => {
    const kinds: [string, DeviceKind][] = [['Safari on iOS', 'phone'], ['Chrome on Android', 'phone'], ['Firefox on Windows', 'laptop'], ['Safari on iPadOS', 'tablet']];
    const n = get().accounts.find((a) => a.id === uid)?.devices.length ?? 0;
    const [name, kind] = kinds[n % kinds.length];
    const d: Device = { id: 'dev-sim-' + now().toString(36), name, kind, browser: name.split(' ')[0], status: 'pending', addedAt: now(), lastSeenAt: now() };
    set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => ({ ...a, devices: [...a.devices, d] })) }));
    return d;
  },
  updateProfile: (uid, p) => {
    if (p.name !== undefined) {
      const name = p.name.trim().replace(/\s+/g, ' ');
      if (name.length < 2) return { ok: false, error: 'Name needs at least 2 characters.' };
      if (get().accounts.some((a) => a.id !== uid && a.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'Another user already has this name.' };
      p = { ...p, name };
    }
    set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => ({ ...a, ...(p.name ? { name: p.name } : {}), ...(p.avatar ? { avatar: p.avatar } : {}) })) }));
    return { ok: true };
  },
  changePassword: (uid, current, next) => {
    const a = get().accounts.find((x) => x.id === uid);
    if (!a) return { ok: false, error: 'Unknown user.' };
    if (a.passHash !== demoHash(current)) return { ok: false, error: 'The current password is wrong.' };
    if (next.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
    if (next === current) return { ok: false, error: 'The new password must differ from the current one.' };
    set((s) => ({ accounts: mapAcc(s.accounts, uid, (x) => ({ ...x, passHash: demoHash(next), passwordChangedAt: now() })) }));
    return { ok: true };
  },
  touchDevice: (uid, did) => set((s) => ({ accounts: mapAcc(s.accounts, uid, (a) => mapDev(a, did, (d) => ({ ...d, lastSeenAt: now() }))) })),
  resetAccounts: () => { set({ accounts: [] }); setSession(null); },
}), {
  name: 'axion.accounts.v1',
  version: 1,
  storage: createJSONStorage(() => safeLocal() ?? (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; })()),
}));

/* Cross-tab sync: an approval in the admin's tab reaches the waiting tab, which then connects automatically. */
if (typeof window !== 'undefined') {
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
    const t = window.setInterval(() => { void useAuth.persist.rehydrate(); }, 1500);
    return () => window.clearInterval(t);
  }, [active]);
}
