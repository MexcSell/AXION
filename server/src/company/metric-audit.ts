import { AUDIT_BAR, AUDIT_MIN_N, type MetricAuditState } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 66 (R3-4), item 4: the human-audited sample, scaffold. A person re-checks a sample of the units a row counted
 * and records what they found next to what the metric said. This file is the pure arithmetic. It decides nothing: a row whose
 * divergence is at or above the bar is FLAGGED (shown), and no score, tier or promotion changes.
 *
 * The bar (15%) and the minimum sample (100) live in the shared contracts so the help text reads the same constants. They were fixed before any trial:
 * 15% is three times the 5% auditor error the fixture assumes; the minimum was raised from 60 to 100 in the c66 fix round because the 95% threshold held only from
 * 100 samples. Below the minimum the row says "not enough audited samples" and is never flagged, however large the disagreement looks.
 */
export { AUDIT_BAR, AUDIT_MIN_N };

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
