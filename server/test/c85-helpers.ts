/** c85: a valid plan shared by the c85 tests. */
export const PLAN = {
  primary: { metric: 'process.first_pass_acceptance', direction: 'up', margin: 5 },
  minN: 20, windowDays: 14,
  guardrails: [{ metric: 'scorecard.failure_rate', margin: 2 }],
  why: 'We think a shorter review path raises first-pass acceptance.',
};
