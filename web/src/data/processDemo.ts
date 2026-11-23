import { PROCESS_KEYS, type ProcessCell, type ProcessDto, type ProcessWindow } from '@contracts';

/**
 * DEMO mode (improvement cycle 69): labelled SAMPLE cells only. The numbers are invented to show the layout; nothing is measured and the panel says so.
 * Only the cost cell stays unmeasured, as in api mode; the approval wait has no sample rows (n = 0, below its floor of 20).
 */
type S = { label: string; unit: ProcessCell['unit']; value: number | null; n: number | null; minN?: number; p90?: number; open?: { n: number; what: string }; breakdown?: { label: string; n: number }[]; trend?: ProcessCell['trend']; prev?: number | null; unmeasured?: string };
const SAMPLE: Record<(typeof PROCESS_KEYS)[number], S> = {
  rework_rate: { label: 'Returned for rework', unit: '%', value: 29, n: 14, open: { n: 3, what: 'finished or verifying with no review yet' }, breakdown: [{ label: 'FM-1.1', n: 2 }, { label: 'no recorded cause', n: 2 }], trend: 'down', prev: 36 },
  first_pass_acceptance: { label: 'Accepted first time', unit: '%', value: 64, n: 16, open: { n: 3, what: 'finished or verifying with no review yet' }, trend: 'up', prev: 55 },
  duplicate_delegation: { label: 'Duplicate delegations', unit: '%', value: null, n: 2 },
  reassign_churn: { label: 'Reassign churn', unit: 'count', value: null, n: 7, minN: 20 },
  handoff_wait_h: { label: 'Wait on a hand-off', unit: 'h', value: 2.5, n: 9, p90: 6, open: { n: 1, what: 'delegated, no attempt started yet' } },
  approval_decision_h: { label: 'Approval wait', unit: 'h', value: null, n: 0, minN: 20 },
  cost: { label: 'Cost', unit: 'count', value: null, n: null, unmeasured: 'not measured until Stage 9 (the usage ledger): nothing records what work cost yet, so there is no number' },
};
export function demoProcess(window: ProcessWindow, department: string | null): ProcessDto {
  const to = new Date(), from = new Date(to.getTime() - ({ '7d': 7, '30d': 30, '90d': 90 }[window]) * 86_400_000);
  return {
    window, from: from.toISOString(), to: to.toISOString(), previousFrom: from.toISOString(), previousTo: from.toISOString(), department, departments: ['Engineering', 'Operations', 'QA'],
    cells: PROCESS_KEYS.map((k): ProcessCell => {
      const s = SAMPLE[k];
      return {
        key: `process.${k}`, label: s.label, value: s.value, unit: s.unit, n: s.n, minN: s.minN ?? 3, from: s.unmeasured ? null : from.toISOString(), to: s.unmeasured ? null : to.toISOString(),
        evidence: s.unmeasured ?? (s.value === null ? `not enough evidence (n = ${s.n}): sample data` : `sample data: ${s.n} invented rows, shown only to illustrate the layout`),
        state: s.unmeasured ? 'unmeasured' : s.value === null ? 'none' : 'ok', previous: { value: s.prev ?? null, n: s.prev != null ? 9 : 0 }, trend: s.trend ?? null,
        open: s.open ?? null, p90: s.p90 ?? null, breakdown: s.breakdown ?? [],
      };
    }),
  };
}
