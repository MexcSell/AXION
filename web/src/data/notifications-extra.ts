import type { Notice } from '@/data/notifications';
import { NOTIFICATIONS } from '@/data/notifications';

/** Extra demo notices (not counted by the top-bar badge, which uses NOTIFICATIONS only). */
export const EXTRA_NOTICES: Notice[] = [
  { id: 'N-11', severity: 'warning', category: 'agent', title: 'Browser-03 CPU at 92%', body: 'Instance M-127 is throttled. Consider reassigning a heavy form task.', agoMin: 8, missionId: 'M-127', route: '/control/M-127?tab=hierarchy' },
  { id: 'N-12', severity: 'success', category: 'mission', title: 'Mission M-124 completed', body: 'All 12 tasks verified. Delivery report ready for review.', agoMin: 55, missionId: 'M-124', route: '/missions?m=M-124' },
  { id: 'N-13', severity: 'info', category: 'system', title: 'Platform v1.5.0 available', body: 'Release notes reviewed by Security-01. Upgrade window tonight.', agoMin: 26, route: '/operations?tab=releases' },
  { id: 'N-14', severity: 'info', category: 'agent', title: 'Release-01 upgraded to v2.4.0', body: '+15.4% on staging dry-runs (n=60).', agoMin: 140, route: '/agents/release-01?tab=versions' },
];
export const ALL_NOTICES: Notice[] = [...NOTIFICATIONS, ...EXTRA_NOTICES];

export interface ActivityEvent { id: string; agoSec: number; icon: 'agent' | 'data' | 'trade' | 'done' | 'merge' | 'know' | 'health'; text: string; }
export const ACTIVITY: ActivityEvent[] = [
  { id: 'A-1', agoSec: 20, icon: 'agent', text: 'Tester-01 started execution: visual regression (M-126)' },
  { id: 'A-2', agoSec: 44, icon: 'data', text: 'Knowledge pipeline: 4,219 records processed (+12%)' },
  { id: 'A-3', agoSec: 78, icon: 'trade', text: 'Browser-03 filled 3 draft forms, nothing submitted (M-127)' },
  { id: 'A-4', agoSec: 95, icon: 'done', text: 'Mission M-124 marked as Completed' },
  { id: 'A-5', agoSec: 139, icon: 'merge', text: 'Builder-01 merged changes (v2.4.0) after green checks' },
  { id: 'A-6', agoSec: 177, icon: 'know', text: 'Knowledge base updated: +128 entries' },
  { id: 'A-7', agoSec: 219, icon: 'health', text: 'System health: all services operational' },
];
export const LIVE_POOL: Omit<ActivityEvent, 'id' | 'agoSec'>[] = [
  { icon: 'agent', text: 'Coder-01 pushed commit to branch feature/header (M-126)' },
  { icon: 'data', text: 'Usage ledger reconciled: 1,842 calls attributed' },
  { icon: 'done', text: 'Task T-88 verified by Tester-02 with 3 screenshots' },
  { icon: 'know', text: 'Knowledge sync: +9 verified entries' },
  { icon: 'health', text: 'Gateway latency p95 412 ms (within budget)' },
  { icon: 'merge', text: 'Release-01 prepared canary plan for M-128' },
  { icon: 'agent', text: 'Mentor-01 graded exercise 4 for Browser-03' },
];
