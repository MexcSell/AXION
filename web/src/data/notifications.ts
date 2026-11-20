export interface Notice {
  id: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
  category: 'mission' | 'agent' | 'system' | 'approval' | 'evolution';
  title: string;
  body: string;
  agoMin: number;
  missionId?: string;
  actionable?: boolean;
  route?: string;
}

export const NOTIFICATIONS: Notice[] = [
  { id: 'N-1', severity: 'critical', category: 'approval', title: 'Origin grant requested', body: 'Browser-02 asks to visit status.example.com (M-132, read-only, 2 h).', agoMin: 12, missionId: 'M-132', actionable: true, route: '/governance?tab=approvals' },
  { id: 'N-2', severity: 'warning', category: 'approval', title: 'Publish decision needed', body: 'Release-01: publish homepage preview v2.1 (M-128).', agoMin: 24, missionId: 'M-128', actionable: true, route: '/control/M-128?tab=approvals' },
  { id: 'N-3', severity: 'info', category: 'agent', title: 'Tester-01 started visual regression', body: 'Dark-theme suite, 214 snapshots (M-126).', agoMin: 2, missionId: 'M-126', route: '/control/M-126?tab=timeline' },
  { id: 'N-4', severity: 'success', category: 'evolution', title: 'Promotion approved', body: 'Tester-02 v2.4.0 promoted for future instances (+11pp triage accuracy).', agoMin: 1430, route: '/evolution?tab=promotions' },
  { id: 'N-5', severity: 'warning', category: 'system', title: 'Budget 76% used', body: 'This month spend $2,840 of $3,750.', agoMin: 95, route: '/usage' },
  { id: 'N-6', severity: 'critical', category: 'mission', title: 'Verification failed: LCP 3.1s', body: 'M-125 variant C exceeded the performance budget. Retry from checkpoint available.', agoMin: 715, missionId: 'M-125', actionable: true, route: '/control/M-125' },
  { id: 'N-7', severity: 'info', category: 'mission', title: 'Mission summary updated', body: 'M-126: 11 of 14 pages migrated; QA running visual diffs.', agoMin: 6, missionId: 'M-126', route: '/missions?m=M-126' },
  { id: 'N-8', severity: 'success', category: 'system', title: 'Nightly backup verified', body: 'Snapshot 2026-11-20 03:00 · integrity OK · restore dry-run passed.', agoMin: 450, route: '/operations?tab=recovery' },
  { id: 'N-9', severity: 'info', category: 'agent', title: 'Mentor-01 assigned exercise 4', body: 'Browser-03 · address forms · M-127.', agoMin: 11, missionId: 'M-127', route: '/control/M-127?tab=conversations' },
  { id: 'N-10', severity: 'warning', category: 'evolution', title: 'Candidate needs review', body: 'Optimizer-01 v2.4.1 prompt-cache recipe: +12.9% speed, n=80.', agoMin: 180, route: '/evolution?tab=experiments' },
];
