import {
  Home, Target, Radar, Bot, Network, Globe, Package, BookOpen, Dna, Boxes, Users, ShieldCheck,
  BarChart3, Bell, Settings, Activity, LifeBuoy, type LucideIcon,
} from 'lucide-react';

export interface NavItem { key: string; label: string; path: string; icon: LucideIcon; group: 'workspace' | 'intelligence' | 'management' | 'system'; badge?: 'approvals' | 'notifications'; }

/** Route map (spec §2). Finance/Bittensor/Docker modules intentionally absent (spec §0.3). */
export const NAV: NavItem[] = [
  { key: 'overview', label: 'Overview', path: '/overview', icon: Home, group: 'workspace' },
  { key: 'missions', label: 'Missions', path: '/missions', icon: Target, group: 'workspace' },
  { key: 'control', label: 'Mission Control', path: '/control', icon: Radar, group: 'workspace' },
  { key: 'agents', label: 'Agents', path: '/agents', icon: Bot, group: 'workspace' },
  { key: 'organization', label: 'Organization', path: '/organization', icon: Network, group: 'workspace' },
  { key: 'browser', label: 'Browser Studio', path: '/browser', icon: Globe, group: 'workspace' },
  { key: 'results', label: 'Results & Versions', path: '/results', icon: Package, group: 'intelligence' },
  { key: 'knowledge', label: 'Knowledge', path: '/knowledge', icon: BookOpen, group: 'intelligence' },
  { key: 'evolution', label: 'Evolution Lab', path: '/evolution', icon: Dna, group: 'intelligence' },
  { key: 'models', label: 'Models', path: '/models', icon: Boxes, group: 'intelligence' },
  { key: 'users', label: 'Users', path: '/users', icon: Users, group: 'management' },
  { key: 'governance', label: 'Governance', path: '/governance', icon: ShieldCheck, group: 'management', badge: 'approvals' },
  { key: 'usage', label: 'Usage & Budgets', path: '/usage', icon: BarChart3, group: 'management' },
  { key: 'notifications', label: 'Notifications', path: '/notifications', icon: Bell, group: 'management', badge: 'notifications' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: Settings, group: 'system' },
  { key: 'operations', label: 'System Operations', path: '/operations', icon: Activity, group: 'system' },
  { key: 'help', label: 'Help Center', path: '/help', icon: LifeBuoy, group: 'system' },
];

/** Tabs per route (spec §2) — pages read these so the command palette can deep-link every tab. */
export const ROUTE_TABS: Record<string, string[]> = {
  overview: ['Pulse', 'Portfolio', 'Activity', 'Health'],
  missions: ['All', 'Active', 'Waiting', 'Completed', 'Archived'],
  control: ['Overview', 'Hierarchy', 'Task Flow', 'Browser', 'Conversations', 'Results', 'Approvals', 'Reports', 'Timeline'],
  agents: ['Directory', 'Live Instances', 'Teams', 'Coaching'],
  agentProfile: ['Profile', 'Capabilities', 'Tools', 'Instances', 'Conversations', 'Memory', 'Performance', 'Mentoring', 'Evolution', 'Audit'],
  organization: ['Org Chart', 'Departments', 'Assignments', 'Policies', 'Performance', 'Proposals'],
  browser: ['Sessions', 'Live View', 'Actions', 'Site Grants', 'Recipes', 'Replay'],
  results: ['Library', 'Previews', 'Timeline', 'Branch Graph', 'Comparisons', 'Downloads', 'Releases'],
  knowledge: ['Library', 'Research', 'Sources', 'Citations', 'Learning Queue'],
  evolution: ['Proposals', 'Experiments', 'Benchmarks', 'Mentoring', 'Promotions', 'History'],
  models: ['Catalog', 'Providers', 'Routing', 'Playground', 'Usage', 'Health'],
  users: ['Members', 'Roles', 'Teams & Access', 'Invitations', 'Sessions', 'Audit'],
  governance: ['Approvals', 'Permissions', 'Autonomy', 'Policies', 'Secrets', 'Audit'],
  usage: ['Overview', 'Mission Costs', 'Model Usage', 'Limits', 'Alerts', 'Forecast'],
  notifications: ['Inbox', 'Pending', 'Resolved', 'Rules'],
  settings: ['General', 'Appearance', 'Avatars & Faces', 'Accessibility', 'Browser', 'Integrations', 'Storage', 'Security', 'Backups'],
  operations: ['Services', 'Workers', 'Queues', 'Browser Hosts', 'Storage', 'Logs', 'Recovery'],
  help: ['Guides', 'Context Help', 'Shortcuts', 'Troubleshooting', 'Glossary'],
};

export const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
