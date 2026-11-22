import { useEffect } from 'react';
import { create } from 'zustand';
import { AUDIT_BAR, AUDIT_MIN_N, guardRows, type MetricGuardDto, type MetricGuardRow, type MetricAuditState } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';
import { makeScorecardCache } from './scorecardCache';
import { useScorecardTick, onScorecardClear } from './scorecard';

/**
 * Goodhart guard (improvement cycle 66, api mode): the row registry, the derived "gameable" flag and the human-audit state, from
 * GET /company/metric-guard. Same session-safe cache as the scorecard (one read per tick, a sign-out drops late responses).
 * Demo mode has no server: it shows the registry's own declarations (counter-metric, uncovered, gameable are static facts about the
 * code) with "not audited" state; nothing is measured there.
 */
interface Entry { data: MetricGuardDto | null; error: string | null; tick?: number }
const useStore = create<{ byKey: Record<string, Entry> }>(() => ({ byKey: {} }));
const cache = makeScorecardCache<MetricGuardDto>(
  () => api<MetricGuardDto>('GET', '/company/metric-guard'),
  (e) => (e instanceof ApiFailure ? e.message : 'Something went wrong.'),
);
cache.subscribe((byKey) => useStore.setState({ byKey }));
onScorecardClear.add(() => cache.clear());

const NO_AUDIT: MetricAuditState = { n: 0, disagreements: 0, metricOver: 0, auditOver: 0, divergence: null, bar: AUDIT_BAR, minN: AUDIT_MIN_N, state: 'none', flagged: false, lastAuditedAt: null };
const STATIC: MetricGuardRow[] = guardRows().map((g) => ({ ...g, audit: NO_AUDIT }));
const BY_LABEL = new Map(STATIC.filter((g) => g.kind === 'dimension').map((g) => [g.label, g]));

/** Row lookup by id, with the demo-mode fallback by label (demo cells carry sample keys but the real labels). */
export function useMetricGuard(): { byId: (id: string, label?: string) => MetricGuardRow | undefined; ready: boolean } {
  const tick = useScorecardTick();
  const entry = useStore((s) => s.byKey.all);
  useEffect(() => { if (isApi()) void cache.load('all', '', tick); }, [tick]);
  const rows = isApi() ? entry?.data?.rows : STATIC;
  const map = rows ? new Map(rows.map((r) => [r.id, r])) : null;
  return { byId: (id, label) => map?.get(id) ?? (!isApi() && label ? BY_LABEL.get(label) : undefined), ready: !!rows };
}
