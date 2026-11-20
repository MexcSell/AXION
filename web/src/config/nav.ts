import {
  Home, Target, Package, Bell, Settings, Activity, LifeBuoy, type LucideIcon } from 'lucide-react';

export interface NavItem {
  key: string; label: string; path: string; icon: LucideIcon;
  /** shown in the rail's top section by default (owner 2026-11-20 u1: only Missions, Notifications, Settings) */
  shown: boolean;
  badge?: 'approvals' | 'notifications' | 'users';
  /** other paths that belong to this screen (agent profiles live under System Operations) */
  also?: string[];
  /** one-line purpose, used by Settings › Navigation and search */
  note: string;
}

/**
 * Rail top section (owner update 2026-11-20 u1). Missions, Notifications and Settings are shown; the other screens
 * are hidden by default but stay reachable through search (Ctrl K), links and URLs — Settings › Navigation can show them.
 * Plug-in apps live in the rail's bottom section: see config/plugins.ts.
 */
export const NAV: NavItem[] = [
  { key: 'missions', label: 'Missions', path: '/missions', icon: Target, shown: true, note: 'Add missions and follow their agents live' },
  { key: 'notifications', label: 'Notifications', path: '/notifications', icon: Bell, shown: true, badge: 'notifications', note: 'Inbox, news and pending decisions' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: Settings, shown: true, badge: 'users', note: 'Users, navigation, appearance and system preferences' },
  { key: 'overview', label: 'Overview', path: '/overview', icon: Home, shown: false, note: 'Company pulse, portfolio and health at a glance' },
  { key: 'results', label: 'Results & Versions', path: '/results', icon: Package, shown: false, note: 'Verified outputs and their versions' },
  { key: 'operations', label: 'System Operations', path: '/operations', icon: Activity, shown: false, also: ['/agents', '/models'], note: 'Services, VMs, agents, models and recovery' },
  { key: 'help', label: 'Help Center', path: '/help', icon: LifeBuoy, shown: false, note: 'Guides, context help and shortcuts' },
];

/** Tabs per route (spec §2) — pages read these so the command palette can deep-link every tab. */
export const ROUTE_TABS: Record<string, string[]> = {
  overview: ['Pulse', 'Portfolio', 'Activity', 'Health'],
  /** Missions = list + Mission Control workspace merged into one page: these are the workspace tabs (?tab=). */
  missions: ['Overview', 'Activity', 'Hierarchy', 'Task Flow', 'Browser', 'Conversations', 'Results', 'Approvals', 'Reports', 'Timeline'],
  /** Agents + former Organization page merged (owner 2026-11-20). Directory has List / Cards / Hierarchy views (?view=). */
  agents: ['Directory', 'Development', 'Lineage', 'Live Instances', 'Departments', 'Assignments', 'Policies', 'Proposals'],
  agentProfile: ['Profile', 'Capabilities', 'Tools', 'Instances', 'Conversations', 'Memory', 'Performance', 'Mentoring', 'Evolution', 'Audit'],
  /** plug-in: Job Search (replaces Browser Studio) */
  jobSearch: ['Investigate', 'Jobs', 'Profile'],
  results: ['Summary', 'Library', 'Previews', 'Timeline', 'Branch Graph', 'Comparisons', 'Downloads', 'Releases'],
  models: ['Manager', 'Providers', 'Routing', 'Playground', 'Usage', 'Health'],
  notifications: ['Inbox', 'News', 'Pending', 'Resolved', 'Rules'],
  settings: ['General', 'Users', 'Navigation', 'Appearance', 'Avatars & Faces', 'Accessibility', 'Browser', 'Integrations', 'Storage', 'Security', 'Backups'],
  operations: ['Services', 'VMs', 'Agents', 'Models', 'Workers', 'Queues', 'Storage', 'Logs', 'Recovery'],
  help: ['Guides', 'Context Help', 'Shortcuts', 'Troubleshooting', 'Glossary'],
};

/** Mission list status filter (?filter=) on the Missions page — not a route, so kept out of ROUTE_TABS. */
export const MISSION_FILTERS = ['All', 'Active', 'Waiting', 'Completed', 'Archived'];

export const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
