import type { ReviewCapacityDto, CapacityPeopleBody } from '@contracts';

const cell = (n: number, per: number, open: number, p50: number | null, p95: number | null, decided = n - open) => ({ n, decided, people: 3, shown: true, arrivalPerDay: per, openBacklog: open, p50Ms: p50, p95Ms: p95, medianQueueSize: 3 });
/** DEMO sample of the review-capacity view: invented, only to show the layout. */
export function demoCapacity(windowDays: number): { review: ReviewCapacityDto; people: CapacityPeopleBody } {
  const from = new Date(Date.UTC(2026, 10, 22) - windowDays * 86_400_000).toISOString();
  return {
    review: {
      windowDays, windowStart: from, minItems: 5, minPeople: 3, minPercentileN: 20,
      total: cell(46, 46 / windowDays, 4, 6 * 60_000, 3 * 3_600_000),
      departments: [
        { dept: 'Engineering', ...cell(24, 24 / windowDays, 2, 5 * 60_000, 2 * 3_600_000) },
        { dept: 'Operations', ...cell(17, 17 / windowDays, 2, 9 * 60_000, 4 * 3_600_000, 15) },
        { dept: 'Finance', ...cell(3, 3 / windowDays, 0, null, null) , shown: false, arrivalPerDay: null, openBacklog: null },
      ],
      littles: { status: 'pass', reason: 'ok', avgOpen: 3.8, lambdaTimesW: 3.5, relError: 0.08, relTol: 0.15, absTol: 0.25, missingClose: 0, openNow: 4 },
      span: { rows: [{ supervisorId: 'gm-01', name: 'General Manager', dept: 'Executive', agents: 6, openItems: 1 }, { supervisorId: 'eng-01', name: 'Engineering Lead', dept: 'Engineering', agents: 5, openItems: 3 }], note: 'A measure only, from the latest org chart. No recommended number: no source gives a safe span of control.' },
      utilisation: { value: null, reason: 'not_measured', note: 'Not measured in this version: AXION records how long a request waits for a decision, not how long a person spends handling it (no handling time), and there is no review hours per week setting yet.' },
    },
    people: { windowDays, minPercentileN: 20, people: [
      { userId: 'demo-1', name: 'Luca (DEMO)', decided: 31, p50Ms: 4 * 60_000, p95Ms: 2 * 3_600_000, medianQueueSize: 3 },
      { userId: 'demo-2', name: 'Mina (DEMO)', decided: 11, p50Ms: null, p95Ms: null, medianQueueSize: 2 },
    ] },
  };
}
