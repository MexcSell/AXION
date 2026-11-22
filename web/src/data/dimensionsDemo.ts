import { DIMENSION_KEYS, DIMENSION_LABEL, type CompanyDimensionsDto, type DimensionCell, type DimensionWindow } from '@contracts';

/**
 * DEMO mode (improvement cycle 46): labelled SAMPLE cells only. The numbers below are invented to show the layout; nothing is
 * measured, no composite is ever drawn, and the dialog says so. Cells without a sample show "not enough evidence".
 */
type S = { label: string; unit: DimensionCell['unit']; value: number | null; n: number | null; minN?: number; trend?: DimensionCell['trend']; prev?: number | null; state?: 'hidden' | 'unmeasured'; scope?: DimensionCell['scope'] };
const SAMPLE: Record<string, S[]> = {
  cognitive: [{ label: 'Verified on first attempt', unit: '%', value: 72, n: 18, trend: 'up', prev: 61 }, { label: 'Missions with a flagged stall', unit: '%', value: null, n: 2 }, { label: 'Context-loss failures (FM-1.4, FM-2.1)', unit: '%', value: null, n: 1 }],
  capability: [{ label: 'Playbook items in force', unit: 'count', value: 9, n: 7 }, { label: 'Tasks passed first time', unit: '%', value: 64, n: 11, minN: 5, trend: 'flat', prev: 64 }, { label: 'Site grants active at the end', unit: 'count', value: null, n: null, state: 'hidden' }],
  environmental: [{ label: 'Website navigation outcomes', unit: '%', value: null, n: null, state: 'unmeasured' }, { label: 'Model availability incidents', unit: 'count', value: null, n: null, state: 'unmeasured' }],
  collective: [{ label: 'Delegations with a brief', unit: '%', value: 83, n: 12, trend: 'up', prev: 50 }, { label: 'Agent reviews across model families', unit: '%', value: 40, n: 10 }, { label: 'Median approval decision time', unit: 'h', value: 2.4, n: 6, trend: 'down', prev: 3.1 }],
  knowledge: [{ label: 'Lessons proposed', unit: 'count', value: 5, n: 5, scope: 'company' }, { label: 'Lessons accepted', unit: '%', value: 75, n: 4, scope: 'company' }, { label: 'Accepted lessons rolled back', unit: '%', value: null, n: 2, scope: 'company' }],
  evolutionary: [{ label: 'Version proposals promoted', unit: 'count', value: 3, n: 3 }, { label: 'Agent versions rolled back', unit: 'count', value: null, n: 1 }, { label: 'Evaluation verdicts (win / inconclusive / loss)', unit: 'count', value: null, n: null, state: 'unmeasured' }, { label: 'Org revisions applied', unit: 'count', value: null, n: 2 }],
};
export function demoDimensions(window: DimensionWindow, department: string | null): CompanyDimensionsDto {
  const to = new Date(), from = new Date(to.getTime() - ({ '7d': 7, '30d': 30, '90d': 90 }[window]) * 86_400_000);
  return {
    window, from: from.toISOString(), to: to.toISOString(), previousFrom: from.toISOString(), previousTo: from.toISOString(), department,
    departments: ['Engineering', 'Operations', 'QA'],
    dimensions: DIMENSION_KEYS.map((k) => ({
      key: k, label: DIMENSION_LABEL[k],
      cells: SAMPLE[k].map((s, i) => ({
        key: `${k}.sample${i}`, label: s.label, value: s.value, unit: s.unit, n: s.n, minN: s.minN ?? 3, basis: 'window' as const, from: from.toISOString(), to: to.toISOString(),
        scope: s.scope ?? 'missions' as const,
        evidence: s.state === 'hidden' ? 'hidden for your role: sample data' : s.state === 'unmeasured' ? (/verdict/i.test(s.label) ? 'not measured yet (cycle 47)' : 'not measured until Stage 7 (browser execution)') : s.value === null ? `not enough evidence (n = ${s.n}): sample data` : `sample data: ${s.n} invented rows, shown only to illustrate the layout`,
        state: s.state ?? (s.value === null ? 'none' as const : 'ok' as const), previous: { value: s.prev ?? null, n: s.prev != null ? 9 : 0 }, trend: s.trend ?? null,
      })),
    })),
  };
}
