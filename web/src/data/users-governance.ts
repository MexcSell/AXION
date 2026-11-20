import { create } from 'zustand';
import { seeded } from '@/data/agents';

/** DEMO fixtures + tiny local store for Users, Governance and Notifications (all fabricated, nothing persisted). */
export type HumanRole = 'Owner' | 'Admin' | 'Operator' | 'Reviewer' | 'Viewer';
export const HUMAN_ROLES: { key: HumanRole; hue: number; desc: string }[] = [
  { key: 'Owner', hue: 45, desc: 'Strategy, risky approvals, promotions, policy changes.' },
  { key: 'Admin', hue: 275, desc: 'Users, providers, service operations. Cannot bypass Owner gates.' },
  { key: 'Operator', hue: 200, desc: 'Creates and runs permitted missions, intervenes in conversations.' },
  { key: 'Reviewer', hue: 165, desc: 'Reviews evidence and assigned queues. No self-approval.' },
  { key: 'Viewer', hue: 225, desc: 'Read-only progress and artifacts allowed by ACL.' },
];
export const ROLE_HUE: Record<HumanRole, number> = Object.fromEntries(HUMAN_ROLES.map((r) => [r.key, r.hue])) as Record<HumanRole, number>;

export interface Member { id: string; name: string; initials: string; role: HumanRole; email: string; status: 'active' | 'away' | 'offline' | 'suspended'; lastMin: number; sessions: number; grants: number; team: string; hue: number; title: string; mfa: boolean; }
export const MEMBERS: Member[] = [
  { id: 'U-1', name: 'Luca (Owner)', initials: 'LU', role: 'Owner', email: 'luca@example.com', status: 'active', lastMin: 0, sessions: 2, grants: 14, team: 'Leadership', hue: 45, title: 'Founder & Owner', mfa: true },
  { id: 'U-2', name: 'Amara Okafor', initials: 'AO', role: 'Admin', email: 'amara.okafor@example.com', status: 'active', lastMin: 4, sessions: 1, grants: 11, team: 'Platform', hue: 275, title: 'Platform Administrator', mfa: true },
  { id: 'U-3', name: 'Mateo Silva', initials: 'MS', role: 'Operator', email: 'mateo.silva@example.com', status: 'active', lastMin: 12, sessions: 2, grants: 7, team: 'Web Delivery', hue: 200, title: 'Mission Operator', mfa: true },
  { id: 'U-4', name: 'Hana Kobayashi', initials: 'HK', role: 'Reviewer', email: 'hana.k@example.com', status: 'away', lastMin: 47, sessions: 1, grants: 5, team: 'Quality', hue: 165, title: 'QA Reviewer', mfa: true },
  { id: 'U-5', name: 'Jonas Becker', initials: 'JB', role: 'Operator', email: 'jonas.becker@example.com', status: 'active', lastMin: 21, sessions: 1, grants: 6, team: 'Automation', hue: 215, title: 'Automation Operator', mfa: false },
  { id: 'U-6', name: 'Priya Raman', initials: 'PR', role: 'Reviewer', email: 'priya.raman@example.com', status: 'offline', lastMin: 380, sessions: 0, grants: 4, team: 'Security', hue: 320, title: 'Security Reviewer', mfa: true },
  { id: 'U-7', name: 'Elena Petrova', initials: 'EP', role: 'Viewer', email: 'elena.p@example.com', status: 'offline', lastMin: 2900, sessions: 0, grants: 2, team: 'Stakeholders', hue: 25, title: 'Client Stakeholder', mfa: false },
  { id: 'U-8', name: 'Tomas Novak', initials: 'TN', role: 'Viewer', email: 'tomas.novak@example.com', status: 'suspended', lastMin: 14400, sessions: 0, grants: 0, team: 'Stakeholders', hue: 0, title: 'Contractor (suspended)', mfa: false },
];

export const PERM_ROWS: { group: string; label: string; ownerOnly?: boolean; grants: [boolean, boolean, boolean, boolean, boolean] }[] = [
  { group: 'Missions', label: 'View missions and progress', grants: [true, true, true, true, true] },
  { group: 'Missions', label: 'Create and run missions', grants: [true, true, true, false, false] },
  { group: 'Missions', label: 'Command agents in conversations', grants: [true, true, true, false, false] },
  { group: 'Review', label: 'Review evidence and approve R1 reviews', grants: [true, true, false, true, false] },
  { group: 'Review', label: 'Approve R2 external effects', grants: [true, true, false, false, false] },
  { group: 'Browser', label: 'Grant site origins to browser agents', grants: [true, true, false, false, false] },
  { group: 'Admin', label: 'Invite, suspend and edit users', grants: [true, true, false, false, false] },
  { group: 'Admin', label: 'Configure model providers', grants: [true, true, false, false, false] },
  { group: 'Admin', label: 'Rotate credentials (R3)', grants: [true, true, false, false, false] },
  { group: 'Owner-only', label: 'Production release (R4)', ownerOnly: true, grants: [true, false, false, false, false] },
  { group: 'Owner-only', label: 'Promote agent versions', ownerOnly: true, grants: [true, false, false, false, false] },
  { group: 'Owner-only', label: 'Change company policy / constitution', ownerOnly: true, grants: [true, false, false, false, false] },
  { group: 'Owner-only', label: 'Change autonomy gates', ownerOnly: true, grants: [true, false, false, false, false] },
  { group: 'Owner-only', label: 'Reorganize departments', ownerOnly: true, grants: [true, false, false, false, false] },
];

export const TEAMS = [
  { id: 'T-1', name: 'Leadership', hue: 45, members: ['U-1'], scope: 'All missions · all sites', access: 'Full' },
  { id: 'T-2', name: 'Platform', hue: 275, members: ['U-2', 'U-1'], scope: 'Tenant · providers · operations', access: 'Admin' },
  { id: 'T-3', name: 'Web Delivery', hue: 200, members: ['U-3', 'U-5', 'U-4'], scope: 'M-126 · M-128 · M-130', access: 'Operate' },
  { id: 'T-4', name: 'Automation', hue: 215, members: ['U-5', 'U-3'], scope: 'M-132 · status.example.com (read-only)', access: 'Operate' },
  { id: 'T-5', name: 'Security & Quality', hue: 165, members: ['U-6', 'U-4'], scope: 'All missions (review queues)', access: 'Review' },
  { id: 'T-6', name: 'Stakeholders', hue: 25, members: ['U-7', 'U-8'], scope: 'M-126 summary only', access: 'View' },
];

export interface Invite { id: string; masked: string; role: HumanRole; invitedBy: string; sentMin: number; expiresMin: number; state: 'pending' | 'expired' | 'accepted'; scope: string; }
export const INVITES: Invite[] = [
  { id: 'I-1', masked: 'l***@example.com', role: 'Operator', invitedBy: 'Luca', sentMin: 360, expiresMin: 6840, state: 'pending', scope: 'M-126, M-128' },
  { id: 'I-2', masked: 's***.k***@example.org', role: 'Reviewer', invitedBy: 'Amara', sentMin: 2880, expiresMin: 4320, state: 'pending', scope: 'Review queues' },
  { id: 'I-3', masked: 'd***@example.net', role: 'Viewer', invitedBy: 'Luca', sentMin: 14400, expiresMin: -4320, state: 'expired', scope: 'M-126 summary' },
  { id: 'I-4', masked: 'p***.r***@example.com', role: 'Reviewer', invitedBy: 'Amara', sentMin: 8640, expiresMin: 0, state: 'accepted', scope: 'Security reviews' },
  { id: 'I-5', masked: 'e***@example.com', role: 'Viewer', invitedBy: 'Luca', sentMin: 10080, expiresMin: 0, state: 'accepted', scope: 'Stakeholder pack' },
];

export interface Session { id: string; userId: string; device: string; kind: 'laptop' | 'phone' | 'desktop' | 'tablet'; browser: string; ip: string; place: string; lastMin: number; current?: boolean; }
export const SESSIONS: Session[] = [
  { id: 'S-1', userId: 'U-1', device: 'MacBook Pro 16"', kind: 'laptop', browser: 'Chrome 131', ip: '203.0.113.x', place: 'Lisbon, PT', lastMin: 0, current: true },
  { id: 'S-2', userId: 'U-1', device: 'iPhone 16', kind: 'phone', browser: 'Safari Mobile', ip: '198.51.100.x', place: 'Lisbon, PT', lastMin: 38 },
  { id: 'S-3', userId: 'U-2', device: 'ThinkPad X1', kind: 'laptop', browser: 'Firefox 133', ip: '192.0.2.x', place: 'Lagos, NG', lastMin: 4 },
  { id: 'S-4', userId: 'U-3', device: 'Workstation', kind: 'desktop', browser: 'Edge 131', ip: '203.0.113.x', place: 'Madrid, ES', lastMin: 12 },
  { id: 'S-5', userId: 'U-3', device: 'iPad Air', kind: 'tablet', browser: 'Safari', ip: '203.0.113.x', place: 'Madrid, ES', lastMin: 190 },
  { id: 'S-6', userId: 'U-4', device: 'Surface Laptop', kind: 'laptop', browser: 'Edge 131', ip: '198.51.100.x', place: 'Osaka, JP', lastMin: 47 },
  { id: 'S-7', userId: 'U-5', device: 'Linux desktop', kind: 'desktop', browser: 'Chrome 130', ip: '192.0.2.x', place: 'Berlin, DE', lastMin: 21 },
];

const ACT = ['login.success', 'login.mfa', 'grant.created', 'grant.revoked', 'role.changed', 'user.invited', 'session.revoked', 'user.suspended', 'password.reset'];
export interface AuditRow { id: string; agoMin: number; actor: string; action: string; target: string; result: 'allowed' | 'denied' | 'review'; hash: string; trace: string; }
function hex(r: () => number, n: number) { return Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join(''); }
export const USER_AUDIT: AuditRow[] = (() => {
  const r = seeded('user-audit');
  return Array.from({ length: 28 }, (_, i) => {
    const a = ACT[Math.floor(r() * ACT.length)];
    const m = MEMBERS[Math.floor(r() * MEMBERS.length)];
    return { id: `UA-${900 - i}`, agoMin: Math.round(i * 37 + r() * 20), actor: m.name, action: a, target: a.startsWith('grant') ? `M-${126 + Math.floor(r() * 7)}` : a.startsWith('role') ? MEMBERS[(i + 2) % 8].name : m.email, result: a === 'user.suspended' || r() > .9 ? 'review' : r() > .93 ? 'denied' : 'allowed', hash: hex(r, 10), trace: `tr_${hex(r, 8)}` };
  });
})();
const GACT = ['policy.evaluate', 'approval.decided', 'grant.expired', 'secret.accessed', 'autonomy.limit_hit', 'origin.granted', 'release.gated', 'key.rotated'];
export const GOV_AUDIT: AuditRow[] = (() => {
  const r = seeded('gov-audit');
  let prev = hex(r, 10);
  return Array.from({ length: 30 }, (_, i) => {
    const a = GACT[Math.floor(r() * GACT.length)];
    const hash = hex(r, 10);
    const row: AuditRow = { id: `GA-${4410 - i}`, agoMin: Math.round(i * 23 + r() * 15), actor: r() > .45 ? 'GM' : r() > .5 ? 'Luca' : ['Browser-02', 'Release-01', 'Security-01'][Math.floor(r() * 3)], action: a, target: a.startsWith('secret') ? 'sec://deploy/token' : a.startsWith('origin') ? 'status.example.com' : `M-${126 + Math.floor(r() * 7)}`, result: r() > .88 ? 'denied' : r() > .85 ? 'review' : 'allowed', hash, trace: prev };
    prev = hash;
    return row;
  });
})();

export const PERMISSION_GRANTS = [
  { id: 'G-1', subject: 'Browser-02', kind: 'site', scope: 'status.example.com', level: 'read-only', mission: 'M-132', expiresH: 2, risk: 'R0' },
  { id: 'G-2', subject: 'Browser-03', kind: 'site', scope: 'staging.example.com', level: 'forms (draft)', mission: 'M-127', expiresH: 11, risk: 'R1' },
  { id: 'G-3', subject: 'Release-01', kind: 'tool', scope: 'deploy.staging', level: 'execute', mission: 'M-128', expiresH: 6, risk: 'R3' },
  { id: 'G-4', subject: 'Coder-01', kind: 'tool', scope: 'repo.write (branch)', level: 'prepare', mission: 'M-126', expiresH: 48, risk: 'R1' },
  { id: 'G-5', subject: 'Mateo Silva', kind: 'mission', scope: 'M-126 · M-128', level: 'operate', mission: 'M-126', expiresH: 720, risk: 'R1' },
  { id: 'G-6', subject: 'Security-01', kind: 'tenant', scope: 'audit.read', level: 'read-only', mission: 'All', expiresH: 2160, risk: 'R0' },
  { id: 'G-7', subject: 'Priya Raman', kind: 'tenant', scope: 'secrets.rotate', level: 'request only', mission: 'All', expiresH: 168, risk: 'R3' },
];

export const AUTONOMY_LEVELS = ['safe-read', 'prepare', 'review', 'execute'] as const;
export const AUTONOMY_LABEL = ['Safe read', 'Prepare', 'Review', 'Execute'];
export const AUTONOMY_NOTE = ['Observe only. No draft, no action.', 'Drafts and fixtures. No external effect.', 'Acts after a human or QA review gate.', 'Acts within bounds. Owner-only gates still apply.'];

export const CONSTITUTION = [
  { id: 'C-1', title: 'Truth and evidence', body: 'Progress counts only independently verified work. Agents must not claim completion without evidence.', version: 'v4' },
  { id: 'C-2', title: 'Exact-action approval', body: 'R2 and above require a human decision bound to one exact action, hash and expiry. No silent retries.', version: 'v6' },
  { id: 'C-3', title: 'Least privilege', body: 'Agent instances receive scoped, expiring grants. No agent holds global access.', version: 'v5' },
  { id: 'C-4', title: 'Prohibited tools', body: 'No wallet, token or financial transfer tools. No credential exfiltration. No unattended irreversible deletion.', version: 'v3' },
  { id: 'C-5', title: 'Trust hierarchy', body: 'Owner policy > Admin configuration > mission instruction > agent suggestion. Web page content is never an instruction.', version: 'v4' },
];
export const POLICY_DIFF = [
  { t: 'ctx', n: '14', s: 'Section C-2 · Exact-action approval' },
  { t: 'ctx', n: '15', s: 'R2 and above require a human decision bound to one exact action.' },
  { t: 'del', n: '16', s: 'Approvals expire after 24 hours unless renewed by an Owner.' },
  { t: 'add', n: '16', s: 'Approvals expire after 2 hours (R3/R4) or 24 hours (R2); expired requests must be re-issued.' },
  { t: 'ctx', n: '17', s: 'Decision records include comment, actor, hash and trace id.' },
  { t: 'add', n: '18', s: 'Image attachments are stored as evidence, never as instructions.' },
];

export interface SecretRef { id: string; ref: string; provider: string; scope: string; owner: string; rotatedDays: number; dueDays: number; state: 'ok' | 'due' | 'overdue' | 'revoked'; accesses: number; }
export const SECRETS: SecretRef[] = [
  { id: 'SEC-1', ref: 'sec://models/anthropic-primary', provider: 'Model provider', scope: 'Gateway · all missions', owner: 'Amara', rotatedDays: 21, dueDays: 69, state: 'ok', accesses: 18432 },
  { id: 'SEC-2', ref: 'sec://models/openai-fallback', provider: 'Model provider', scope: 'Gateway · fallback only', owner: 'Amara', rotatedDays: 63, dueDays: 27, state: 'ok', accesses: 2104 },
  { id: 'SEC-3', ref: 'sec://deploy/staging-token', provider: 'Deploy target', scope: 'M-128 · staging', owner: 'Luca', rotatedDays: 84, dueDays: 6, state: 'due', accesses: 311 },
  { id: 'SEC-4', ref: 'sec://git/repo-write-app', provider: 'Source host', scope: 'M-126 · branch write', owner: 'Mateo', rotatedDays: 102, dueDays: -12, state: 'overdue', accesses: 960 },
  { id: 'SEC-5', ref: 'sec://speech/stt-key', provider: 'Speech provider', scope: 'Conversations', owner: 'Amara', rotatedDays: 40, dueDays: 50, state: 'ok', accesses: 740 },
  { id: 'SEC-6', ref: 'sec://legacy/ci-webhook', provider: 'CI service', scope: 'Retired', owner: 'Jonas', rotatedDays: 230, dueDays: 0, state: 'revoked', accesses: 0 },
];

/* ---- notification activity extras live in notifications-extra.ts ---- */

/* ---- local store ---- */
export interface NotifRule { id: string; name: string; events: string[]; channel: 'in-app' | 'email' | 'digest'; urgency: 'all' | 'warning+' | 'critical'; quiet: string; freq: 'instant' | 'hourly' | 'daily'; on: boolean; }
interface UG {
  revokedSessions: Record<string, true>;
  roleOverrides: Record<string, HumanRole>;
  extraInvites: Invite[];
  suspended: Record<string, true>;
  secrets: SecretRef[];
  revisions: { id: string; title: string; at: number }[];
  rules: NotifRule[];
  resolvedNotices: Record<string, string>;
  autonomy: Record<string, number>;
  revokeSession: (id: string) => void;
  setRole: (id: string, r: HumanRole) => void;
  addInvite: (i: Invite) => void;
  setInviteState: (id: string, s: Invite['state'] | 'revoked') => void;
  inviteOverride: Record<string, Invite['state'] | 'revoked'>;
  toggleSuspend: (id: string) => void;
  addSecret: (s: SecretRef) => void;
  revokeSecret: (id: string) => void;
  rotateSecret: (id: string) => void;
  addRevision: (title: string) => void;
  addRule: (r: NotifRule) => void;
  toggleRule: (id: string) => void;
  resolveNotice: (id: string, how: string) => void;
  setAutonomy: (id: string, v: number) => void;
}
export const useUG = create<UG>()((set) => ({
  revokedSessions: {}, roleOverrides: {}, extraInvites: [], suspended: {}, inviteOverride: {},
  secrets: SECRETS, revisions: [],
  rules: [
    { id: 'R-1', name: 'Critical alerts, instant', events: ['critical', 'approval'], channel: 'in-app', urgency: 'critical', quiet: 'Ignored for critical', freq: 'instant', on: true },
    { id: 'R-2', name: 'Mission milestones digest', events: ['mission', 'agent'], channel: 'digest', urgency: 'all', quiet: '22:00 - 07:00', freq: 'daily', on: true },
    { id: 'R-3', name: 'Budget and system warnings', events: ['system'], channel: 'email', urgency: 'warning+', quiet: '22:00 - 07:00', freq: 'hourly', on: false },
  ],
  resolvedNotices: {}, autonomy: {},
  revokeSession: (id) => set((s) => ({ revokedSessions: { ...s.revokedSessions, [id]: true } })),
  setRole: (id, r) => set((s) => ({ roleOverrides: { ...s.roleOverrides, [id]: r } })),
  addInvite: (i) => set((s) => ({ extraInvites: [i, ...s.extraInvites] })),
  setInviteState: (id, st) => set((s) => ({ inviteOverride: { ...s.inviteOverride, [id]: st } })),
  toggleSuspend: (id) => set((s) => { const n = { ...s.suspended }; if (n[id]) delete n[id]; else n[id] = true; return { suspended: n }; }),
  addSecret: (x) => set((s) => ({ secrets: [x, ...s.secrets] })),
  revokeSecret: (id) => set((s) => ({ secrets: s.secrets.map((x) => (x.id === id ? { ...x, state: 'revoked' } : x)) })),
  rotateSecret: (id) => set((s) => ({ secrets: s.secrets.map((x) => (x.id === id ? { ...x, state: 'ok', rotatedDays: 0, dueDays: 90 } : x)) })),
  addRevision: (title) => set((s) => ({ revisions: [{ id: `REV-${s.revisions.length + 1}`, title, at: Date.now() }, ...s.revisions] })),
  addRule: (r) => set((s) => ({ rules: [r, ...s.rules] })),
  toggleRule: (id) => set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, on: !r.on } : r)) })),
  resolveNotice: (id, how) => set((s) => ({ resolvedNotices: { ...s.resolvedNotices, [id]: how } })),
  setAutonomy: (id, v) => set((s) => ({ autonomy: { ...s.autonomy, [id]: v } })),
}));

export const RISK_TIER: Record<string, { tier: string; label: string; hue: number; order: number }> = {
  critical: { tier: 'R4', label: 'Critical', hue: 350, order: 0 },
  high: { tier: 'R3', label: 'High', hue: 25, order: 1 },
  medium: { tier: 'R2', label: 'Medium', hue: 45, order: 2 },
  low: { tier: 'R1', label: 'Low', hue: 165, order: 3 },
};
