import { create } from 'zustand';
import { seeded } from './agents';

/** DEMO fixtures for mission browser sessions (Mission › Browser tab, Settings › Browser). All deterministic. */
export type SessionState = 'active' | 'paused' | 'awaiting-grant' | 'takeover' | 'expired';
export interface BrowserSession {
  id: string; missionId: string; agentId: string; origin: string; path: string; state: SessionState;
  tabs: number; durationMin: number; ttlMin: number; memMb: number; memCap: number; profile: string; viewport: string;
  steps: number; screenshotAgoSec: number;
}
export const SESSIONS: BrowserSession[] = [
  { id: 'BS-2041', missionId: 'M-132', agentId: 'browser-01', origin: 'https://status.example.com', path: '/incidents', state: 'awaiting-grant', tabs: 2, durationMin: 42, ttlMin: 78, memMb: 412, memCap: 1024, profile: 'ephemeral-audit', viewport: '1440x900', steps: 31, screenshotAgoSec: 4 },
  { id: 'BS-2038', missionId: 'M-126', agentId: 'browser-01', origin: 'https://portal.example.com', path: '/checkout', state: 'active', tabs: 3, durationMin: 118, ttlMin: 62, memMb: 688, memCap: 1024, profile: 'staging-readonly', viewport: '1440x900', steps: 87, screenshotAgoSec: 2 },
  { id: 'BS-2036', missionId: 'M-127', agentId: 'browser-01', origin: 'https://shop.example.com', path: '/cart', state: 'takeover', tabs: 1, durationMin: 24, ttlMin: 36, memMb: 301, memCap: 768, profile: 'training-fixture', viewport: '1280x800', steps: 19, screenshotAgoSec: 1 },
  { id: 'BS-2033', missionId: 'M-130', agentId: 'researcher-01', origin: 'https://competitor-a.example.org', path: '/pricing', state: 'paused', tabs: 4, durationMin: 203, ttlMin: 17, memMb: 540, memCap: 1024, profile: 'research-public', viewport: '1440x900', steps: 142, screenshotAgoSec: 187 },
  { id: 'BS-2029', missionId: 'M-128', agentId: 'browser-01', origin: 'https://preview.example.com', path: '/home', state: 'expired', tabs: 0, durationMin: 240, ttlMin: 0, memMb: 0, memCap: 1024, profile: 'ephemeral-preview', viewport: '1440x900', steps: 64, screenshotAgoSec: 5400 },
];

export type Risk = 'low' | 'medium' | 'high' | 'critical';
export interface SiteGrant {
  id: string; origin: string; missionId: string; actions: string[]; cred: string; expiresMin: number; risk: Risk; status: 'active' | 'pending' | 'expiring' | 'revoked'; by: string;
}
export const GRANTS: SiteGrant[] = [
  { id: 'G-301', origin: 'https://portal.example.com', missionId: 'M-126', actions: ['navigate', 'read', 'click', 'type'], cred: 'none (public staging)', expiresMin: 360, risk: 'low', status: 'active', by: 'Luca' },
  { id: 'G-302', origin: 'https://shop.example.com', missionId: 'M-127', actions: ['navigate', 'read', 'click'], cred: 'fixture account (vault ref)', expiresMin: 95, risk: 'medium', status: 'active', by: 'Luca' },
  { id: 'G-303', origin: 'https://status.example.com', missionId: 'M-132', actions: ['navigate', 'read'], cred: 'none', expiresMin: 120, risk: 'high', status: 'pending', by: 'Browser-01' },
  { id: 'G-304', origin: 'https://competitor-a.example.org', missionId: 'M-130', actions: ['navigate', 'read'], cred: 'none (public)', expiresMin: 22, risk: 'low', status: 'expiring', by: 'Mina' },
  { id: 'G-305', origin: 'https://admin.example.com', missionId: 'M-129', actions: ['navigate', 'read', 'submit'], cred: 'owner vault ref (redacted)', expiresMin: 40, risk: 'critical', status: 'active', by: 'Luca' },
  { id: 'G-306', origin: 'https://preview.example.com', missionId: 'M-128', actions: ['navigate', 'read', 'click', 'type'], cred: 'none', expiresMin: 0, risk: 'low', status: 'revoked', by: 'Luca' },
];

export type StepPhase = 'proposal' | 'policy' | 'execution' | 'observation';
export interface BrowserStep {
  id: string; n: number; verb: string; target: string; locator: string; confidence: number; phase: StepPhase; status: 'ok' | 'gated' | 'retry' | 'pending' | 'error';
  policy: string; observation: string; ms: number; consequential?: boolean; sessionId: string;
}
const V: [string, string, string, string, string][] = [
  ['navigate', 'https://portal.example.com/checkout', 'url:allowlisted', 'Origin matches grant G-301', 'Page loaded 200 · title "Checkout"'],
  ['click', 'Button "Continue to payment"', "getByRole('button', {name:'Continue to payment'})", 'Not consequential · read-only step', 'Route changed to /checkout/payment'],
  ['type', 'Input "Postal code"', "getByLabel('Postal code')", 'Field is non-secret · value redacted in log', 'Field filled · value redacted'],
  ['click', 'Button "Place order"', "getByRole('button', {name:'Place order'})", 'External effect · needs one-time approval', 'Awaiting owner approval'],
  ['read', 'Table "Order summary"', "getByRole('table', {name:/Order/})", 'Read-only', '4 rows extracted · totals match'],
  ['screenshot', 'Viewport 1440x900', 'viewport', 'Redaction mask applied (2 regions)', 'Frame stored · sha256:7ae1…'],
  ['click', 'Link "Download invoice"', "getByRole('link', {name:/invoice/i})", 'Download goes to quarantine scan', 'File quarantined · scan clean'],
  ['navigate', 'https://cdn.unknown-tracker.net/pixel', 'url:unknown', 'New origin blocked · grant required', 'Navigation denied'],
];
export const STEPS: BrowserStep[] = Array.from({ length: 12 }, (_, i) => {
  const r = seeded('step' + i);
  const [verb, target, locator, policy, observation] = V[i % V.length];
  const conf = Math.round((0.72 + r() * 0.27) * 100) / 100;
  const gated = verb === 'click' && target.includes('Place order') && i === 3;
  const blocked = target.includes('unknown');
  return {
    id: `ST-${5100 + i}`, n: i + 1, verb, target, locator, confidence: blocked ? 0.99 : conf,
    phase: i === 11 ? 'proposal' : i === 10 ? 'policy' : i === 9 ? 'execution' : 'observation',
    status: gated ? 'gated' : blocked ? 'error' : i === 11 ? 'pending' : conf < 0.8 ? 'retry' : 'ok',
    policy, observation, ms: Math.round(180 + r() * 1400), consequential: gated, sessionId: 'BS-2038',
  };
});

export interface Recipe {
  id: string; name: string; version: string; owner: string; stability: number; runs: number; origin: string; steps: number; status: 'published' | 'candidate' | 'draft'; hue: number; trend: number[]; updatedMin: number;
}
export const RECIPES: Recipe[] = [
  { id: 'RC-11', name: 'Checkout happy path', version: 'v2.3.1', owner: 'Browser-01', stability: 96, runs: 418, origin: 'portal.example.com', steps: 14, status: 'published', hue: 165, trend: [88, 91, 93, 92, 95, 96, 96], updatedMin: 600 },
  { id: 'RC-12', name: 'Cookie banner dismiss', version: 'v1.8.0', owner: 'Browser-01', stability: 99, runs: 1204, origin: '*.example.com', steps: 3, status: 'published', hue: 190, trend: [97, 98, 98, 99, 99, 99, 99], updatedMin: 4200 },
  { id: 'RC-13', name: 'Pricing table extract', version: 'v1.2.0', owner: 'Researcher-01', stability: 84, runs: 133, origin: 'competitor-a.example.org', steps: 9, status: 'candidate', hue: 268, trend: [70, 74, 80, 78, 83, 84, 84], updatedMin: 140 },
  { id: 'RC-14', name: 'Status page audit', version: 'v0.9.0', owner: 'Browser-01', stability: 71, runs: 28, origin: 'status.example.com', steps: 11, status: 'draft', hue: 38, trend: [55, 60, 66, 64, 70, 71, 71], updatedMin: 35 },
  { id: 'RC-15', name: 'Form accessibility sweep', version: 'v1.0.4', owner: 'Tester-01', stability: 91, runs: 256, origin: 'portal.example.com', steps: 18, status: 'published', hue: 212, trend: [85, 88, 90, 89, 91, 91, 91], updatedMin: 1800 },
  { id: 'RC-16', name: 'Login with vault ref', version: 'v1.1.0', owner: 'Security-01', stability: 93, runs: 77, origin: 'admin.example.com', steps: 7, status: 'candidate', hue: 148, trend: [80, 85, 90, 92, 93, 93, 93], updatedMin: 320 },
];

export interface ReplayFrame { t: number; label: string; kind: 'nav' | 'click' | 'type' | 'gate' | 'read' | 'shot'; x: number; y: number; tgt: Target; policy?: string; }
export type Target = 'nav' | 'read' | 'postal' | 'continue' | 'place' | 'none';
export const REPLAY: ReplayFrame[] = [
  { t: 0, label: 'Open /checkout', kind: 'nav', x: 50, y: 5, tgt: 'nav' },
  { t: 6, label: 'Read cart summary', kind: 'read', x: 78, y: 46, tgt: 'read' },
  { t: 13, label: 'Type postal code', kind: 'type', x: 30, y: 57, tgt: 'postal' },
  { t: 19, label: 'Click Continue', kind: 'click', x: 19, y: 82, tgt: 'continue' },
  { t: 27, label: 'Policy gate: Place order', kind: 'gate', x: 80, y: 83, tgt: 'place', policy: 'Consequential action paused for approval' },
  { t: 41, label: 'Approved once (nonce 7f3a)', kind: 'click', x: 80, y: 83, tgt: 'place', policy: 'Approval nonce consumed' },
  { t: 52, label: 'Read confirmation', kind: 'read', x: 78, y: 46, tgt: 'read' },
  { t: 60, label: 'Redacted screenshot', kind: 'shot', x: 50, y: 50, tgt: 'none' },
];
export const REPLAY_LEN = 64;

export const BROWSER_AGENT_FOR = (sessionId: string) => SESSIONS.find((s) => s.id === sessionId);

interface BrowserState {
  grants: SiteGrant[]; sessions: BrowserSession[]; resolved: Record<string, 'approved' | 'denied'>; takeover: Record<string, number>;
  addGrant: (g: Omit<SiteGrant, 'id'>) => void; revokeGrant: (id: string) => void; approveGrant: (id: string) => void;
  addSession: (s: BrowserSession) => void; setSession: (id: string, p: Partial<BrowserSession>) => void;
  resolveStep: (id: string, d: 'approved' | 'denied') => void; startTakeover: (sid: string, min: number) => void; endTakeover: (sid: string) => void;
}
let seq = 400;
export const useBrowser = create<BrowserState>()((set) => ({
  grants: GRANTS, sessions: SESSIONS, resolved: {}, takeover: {},
  addGrant: (g) => set((s) => ({ grants: [{ ...g, id: `G-${++seq}` }, ...s.grants] })),
  revokeGrant: (id) => set((s) => ({ grants: s.grants.map((g) => (g.id === id ? { ...g, status: 'revoked', expiresMin: 0 } : g)) })),
  approveGrant: (id) => set((s) => ({ grants: s.grants.map((g) => (g.id === id ? { ...g, status: 'active' } : g)) })),
  addSession: (n) => set((s) => ({ sessions: [n, ...s.sessions] })),
  setSession: (id, p) => set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
  resolveStep: (id, d) => set((s) => ({ resolved: { ...s.resolved, [id]: d } })),
  startTakeover: (sid, min) => set((s) => ({ takeover: { ...s.takeover, [sid]: Date.now() + min * 60000 }, sessions: s.sessions.map((x) => (x.id === sid ? { ...x, state: 'takeover' } : x)) })),
  endTakeover: (sid) => set((s) => { const t = { ...s.takeover }; delete t[sid]; return { takeover: t, sessions: s.sessions.map((x) => (x.id === sid ? { ...x, state: 'active' } : x)) }; }),
}));
let sseq = 2050;
export const nextSessionId = () => `BS-${++sseq}`;
