import {
  Crown, Microscope, BarChart3, Code2, Settings2, ShieldCheck, MessagesSquare, CalendarClock, Cpu,
  Layers, Gauge, BadgeCheck, Network, Globe, PenLine, GraduationCap, Rocket, Palette, Bot,
  type LucideIcon,
} from 'lucide-react';
import type { AgentStatus, InstanceState, MissionStatus, RoleKey, TaskState } from './types';

export interface RoleMeta { key: RoleKey; label: string; icon: LucideIcon; hue: number; hue2: number; short: string; }

const KNOWN_ROLES: Record<RoleKey, RoleMeta> = {
  manager:     { key: 'manager', label: 'General Manager', icon: Crown, hue: 268, hue2: 220, short: 'GM' },
  research:    { key: 'research', label: 'Research', icon: Microscope, hue: 268, hue2: 290, short: 'R&D' },
  analytics:   { key: 'analytics', label: 'Analytics', icon: BarChart3, hue: 195, hue2: 160, short: 'ANL' },
  dev:         { key: 'dev', label: 'Development', icon: Code2, hue: 278, hue2: 200, short: 'DEV' },
  ops:         { key: 'ops', label: 'Operations', icon: Settings2, hue: 192, hue2: 210, short: 'OPS' },
  security:    { key: 'security', label: 'Security', icon: ShieldCheck, hue: 148, hue2: 285, short: 'SEC' },
  comms:       { key: 'comms', label: 'Communication', icon: MessagesSquare, hue: 196, hue2: 225, short: 'COM' },
  planning:    { key: 'planning', label: 'Planning', icon: CalendarClock, hue: 38, hue2: 275, short: 'PLN' },
  loader:     { key: 'loader', label: 'Model Loader', icon: Cpu, hue: 42, hue2: 30, short: 'MDL' },
  knowledge:   { key: 'knowledge', label: 'Knowledge', icon: Layers, hue: 212, hue2: 190, short: 'KNW' },
  optimize:    { key: 'optimize', label: 'Optimization', icon: Gauge, hue: 290, hue2: 220, short: 'OPT' },
  qa:          { key: 'qa', label: 'QA / Testing', icon: BadgeCheck, hue: 172, hue2: 285, short: 'QA' },
  integration: { key: 'integration', label: 'Integration', icon: Network, hue: 204, hue2: 160, short: 'INT' },
  browser:     { key: 'browser', label: 'Browser', icon: Globe, hue: 186, hue2: 240, short: 'WEB' },
  writer:      { key: 'writer', label: 'Writer', icon: PenLine, hue: 320, hue2: 270, short: 'WRT' },
  mentor:      { key: 'mentor', label: 'Mentor', icon: GraduationCap, hue: 52, hue2: 30, short: 'MEN' },
  release:     { key: 'release', label: 'Release', icon: Rocket, hue: 12, hue2: 330, short: 'REL' },
  design:      { key: 'design', label: 'Design', icon: Palette, hue: 330, hue2: 280, short: 'UX' },
};

/**
 * Stage 6: an administrator can create an agent with a role this UI has no artwork for. Such a role keeps its real name
 * and gets a generic entry (robot icon, neutral hue) instead of being shown as another role or crashing a lookup.
 */
const generic = new Map<string, RoleMeta>();
export function roleMeta(role: string): RoleMeta {
  const known = (KNOWN_ROLES as Record<string, RoleMeta>)[role];
  if (known) return known;
  let g = generic.get(role);
  if (!g) {
    const label = role.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Agent';
    g = { key: role as RoleKey, label, icon: Bot, hue: 210, hue2: 235, short: label.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'AGT' };
    generic.set(role, g);
  }
  return g;
}
export const isKnownRole = (role: string): role is RoleKey => Object.prototype.hasOwnProperty.call(KNOWN_ROLES, role);
/** Every `ROLES[role]` lookup is safe for unknown roles (see roleMeta); keys and iteration list the built-in roles only. */
export const ROLES: Record<RoleKey, RoleMeta> = new Proxy(KNOWN_ROLES, {
  get: (t, k) => (typeof k === 'string' && !Object.prototype.hasOwnProperty.call(t, k) && !(k in Object.prototype) ? roleMeta(k) : Reflect.get(t, k)),
});

export interface StatusMeta { label: string; hue: number; tone: 'good' | 'warn' | 'bad' | 'info' | 'violet' | 'neutral'; }

export const AGENT_STATUS: Record<AgentStatus, StatusMeta> = {
  active:      { label: 'Active', hue: 145, tone: 'good' },
  'in-mission':{ label: 'In Mission', hue: 268, tone: 'violet' },
  training:    { label: 'Training', hue: 200, tone: 'info' },
  evolving:    { label: 'Evolving', hue: 38, tone: 'warn' },
  idle:        { label: 'Idle', hue: 225, tone: 'neutral' },
  blocked:     { label: 'Blocked', hue: 350, tone: 'bad' },
  offline:     { label: 'Offline', hue: 225, tone: 'neutral' },
};

export const MISSION_STATUS: Record<MissionStatus, StatusMeta> = {
  draft:     { label: 'Draft', hue: 225, tone: 'neutral' },
  queued:    { label: 'Queued', hue: 210, tone: 'info' },
  planning:  { label: 'Planning', hue: 200, tone: 'info' },
  running:   { label: 'In Progress', hue: 145, tone: 'good' },
  verifying: { label: 'Verifying', hue: 180, tone: 'info' },
  waiting:   { label: 'Needs Decision', hue: 38, tone: 'warn' },
  paused:    { label: 'Paused', hue: 225, tone: 'neutral' },
  completed: { label: 'Completed', hue: 268, tone: 'violet' },
  failed:    { label: 'Failed', hue: 350, tone: 'bad' },
  canceled:  { label: 'Canceled', hue: 0, tone: 'neutral' },
  archived:  { label: 'Archived', hue: 225, tone: 'neutral' },
};

export const INSTANCE_STATE: Record<InstanceState, StatusMeta> = {
  working:   { label: 'Working', hue: 145, tone: 'good' },
  waiting:   { label: 'Waiting', hue: 38, tone: 'warn' },
  blocked:   { label: 'Blocked', hue: 350, tone: 'bad' },
  idle:      { label: 'Idle', hue: 225, tone: 'neutral' },
  verifying: { label: 'Verifying', hue: 180, tone: 'info' },
  done:      { label: 'Done', hue: 268, tone: 'violet' },
  reporting: { label: 'Reporting', hue: 200, tone: 'info' },
};

export const TASK_STATE: Record<TaskState, StatusMeta> = {
  queued:          { label: 'Queued', hue: 225, tone: 'neutral' },
  ready:           { label: 'Ready', hue: 200, tone: 'info' },
  running:         { label: 'Running', hue: 145, tone: 'good' },
  'waiting-agent': { label: 'Waiting on agent', hue: 38, tone: 'warn' },
  'waiting-user':  { label: 'Waiting on you', hue: 30, tone: 'warn' },
  verifying:       { label: 'Verifying', hue: 180, tone: 'info' },
  passed:          { label: 'Verified', hue: 268, tone: 'violet' },
  failed:          { label: 'Failed', hue: 350, tone: 'bad' },
  canceled:        { label: 'Canceled', hue: 225, tone: 'neutral' },
};

export const TONE_VAR: Record<StatusMeta['tone'], string> = {
  good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--info)', violet: 'var(--violet)', neutral: 'var(--text-muted)',
};
