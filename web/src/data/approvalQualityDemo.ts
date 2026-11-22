import type { ApprovalQualityDto, ApproverQualityBody } from '@contracts';

/** DEMO sample of the approval-quality statistics: invented, only to show the layout (one approver with enough evidence, one without). */
export function demoQuality(windowDays: number): { agg: ApprovalQualityDto; approvers: ApproverQualityBody } {
  const from = new Date(Date.UTC(2026, 10, 22) - windowDays * 86_400_000).toISOString();
  return {
    agg: { n: 14, enough: true, approvalRate: 0.79, medianLatencyMs: 4 * 60_000 + 20_000, fastBulk: 2, medianQueueSize: 3, windowDays, windowStart: from, minEvidence: 5 },
    approvers: { windowDays, minEvidence: 5, approvers: [
      { userId: 'demo-1', name: 'Luca (DEMO)', n: 11, enough: true, approvalRate: 0.82, medianLatencyMs: 3 * 60_000 + 5_000, fastBulk: 2 },
      { userId: 'demo-2', name: 'Mina (DEMO)', n: 3, enough: false, approvalRate: null, medianLatencyMs: null, fastBulk: null },
    ] },
  };
}
