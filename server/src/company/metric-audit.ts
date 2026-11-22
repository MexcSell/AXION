import type { MetricAuditState } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 66 (R3-4), item 4: the human-audited sample, scaffold. A person re-checks a sample of the units a row counted
 * and records what they found next to what the metric said. This file is the pure arithmetic. It decides nothing: a row whose
 * divergence is at or above the bar is FLAGGED (shown), and no score, tier or promotion changes.
 *
 * The bar and the minimum sample are fixed here, before any trial was run: 15% is three times the 5% auditor error the fixture
 * assumes, and 60 samples is the smallest audit where that auditor error alone rarely reaches the bar. Below the minimum the row
 * says "not enough audited samples" and is never flagged, however large the disagreement looks.
 */
export const AUDIT_BAR = 15;
export const AUDIT_MIN_N = 60;

export interface AuditSample { ref: string; metricLabel: boolean; auditLabel: boolean }

export function auditState(samples: readonly AuditSample[], lastAuditedAt: string | null = null): MetricAuditState {
  const n = samples.length;
  const metricOver = samples.filter((s) => s.metricLabel && !s.auditLabel).length;
  const auditOver = samples.filter((s) => !s.metricLabel && s.auditLabel).length;
  const disagreements = metricOver + auditOver;
  const ok = n >= AUDIT_MIN_N;
  const divergence = ok ? Math.round((disagreements / n) * 1000) / 10 : null;
  return { n, disagreements, metricOver, auditOver, divergence, bar: AUDIT_BAR, minN: AUDIT_MIN_N, state: ok ? 'ok' : 'none', flagged: ok && (disagreements / n) * 100 >= AUDIT_BAR - 1e-9, lastAuditedAt };
}
