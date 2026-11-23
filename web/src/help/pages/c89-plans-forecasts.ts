import type { HelpEntry } from '../registry';

const h = (title: string, what: string, why?: string, how?: string, example?: string, permission?: string): HelpEntry => ({ title, what, why, how, example, permission });

/** Improvement cycle 89: change plans on organisation proposals (administrators) and task forecasts (everyone who can see the task). Counts only. */
const entries: Record<string, HelpEntry> = {
  // ---- change plans
  'plan.section': h('Change plan', 'What was planned before this organisation change: the one metric it should move, which way, by how much, how many observations are needed on each side, how long the windows are, which guardrail metrics must not get worse, and why.',
    'A metric chosen after the data is seen can always be made to look good. Writing it down first removes that choice. This is a record kept by AXION of what was planned. It gives no statistical verdict.',
    'A plan is set while the proposal is pending. Approving the proposal fixes its sha (a fingerprint of the plan) into the record and locks the plan. After that a change is an amendment with a reason, shown here as made after the change.',
    'Primary metric: tasks verified by review, up, margin 5, 30 observations in each 14-day window.', 'Only administrators see plans. A member never sees this section.'),
  'plan.primary': h('Primary metric and margin', 'The registry metric the change is meant to move, the direction (up or down) and the margin: how far it should move, in that metric\'s own unit.',
    'Naming one metric up front is the point of a plan.', 'The metric comes from the metric registry, never from free text. Metrics that record no countable observation cannot be planned.', undefined, 'Read only here.'),
  'plan.window': h('Minimum n and window', 'Minimum n is the smallest number of observations needed in each window. The window is the number of days before the change (pre) and after it (post) that are counted.',
    'With too few observations nothing can be said, so the readout waits.', 'Pre is [change - N days, change). Post is [change, change + N days).', 'Minimum n 30 and window 14 days: 30 or more counted observations in each 14-day window.'),
  'plan.guardrails': h('Guardrails', 'Up to three more registry metrics, each with a margin, that the change must not make worse.', 'A change can raise the primary metric by harming something else.', 'They are counted in the same two windows as the primary metric.'),
  'plan.why': h('Why', 'The reason for the change, written before it took effect.', 'It is part of the fingerprint: the reason cannot be reworded afterwards without it showing as an amendment.'),
  'plan.sha': h('Plan sha', 'A fingerprint (sha256) of the plan as it was approved. Two plans with the same sha are identical.',
    'Approving sends this sha, so the approval is bound to the exact plan the approver read. If the plan changed meanwhile the server refuses and asks you to read it again.', 'Copy it to compare it with the record or an audit entry.'),
  'plan.amendments': h('Amendments', 'Changes to the plan made after the proposal was approved. Each is a new row with the new plan, the reason, who made it and when. Nothing is edited in place.',
    'A change made after the change took effect is not the same as a plan made before it. It is shown plainly as "amended after the change".', 'The counts below always use the plan as it was locked at approval, not an amended choice.'),
  'plan.readout': h('Readout', 'For an applied proposal: how many observations of each planned metric fall in the pre and the post window, and whether each reaches the minimum n.',
    'It only counts. "Not enough evidence yet" means the post window is not complete or a window is below the minimum. "Ready for analysis" means only that the counts are in place: no analysis is computed in this version, so nothing here says whether the change helped.',
    'Counts come from stored records, computed by the server with its own clock.'),
  'plan.counts': h('Counts per window', 'The number of observations of this metric before (pre) and after (post) the change, with the minimum n required. A tick means the minimum is reached.', 'A count below the minimum means that side is too thin to read.'),
  'plan.other': h('Another change in the window', 'Another organisation revision (a further change or a rollback) took effect during the post window.', 'The post counts then mix the effects of both changes, so they cannot be attributed to this one alone.'),
  'plan.mismatch': h('Plan sha mismatch', 'The sha stored with the approval does not match the plan as stored now.', 'It should never happen. If it does, the record was altered outside the app: treat the plan as unreliable and tell an owner.'),
  // ---- forecasts
  'forecast.control': h('Your forecast', 'Your estimate, before the first review, of the chance that this task is accepted at its first review. One whole number from 1 to 99 percent.',
    'Writing the probability down first lets AXION later show how close people\'s estimates were to what happened. It does not change the review.',
    'Choose the percent and record it. A forecast is final: it cannot be edited or repeated. It is scored once the task\'s first review exists.', 'You expect it to pass: 80%. If the first review accepts it, your Brier is 0.04 (lower is better).',
    'Anyone who can see the task. You see your own forecasts; an administrator can open one person\'s record. There is no ranking.'),
  'forecast.percent': h('Chance of acceptance', 'How likely you think it is that the first review of this task has the verdict "accepted", as a whole percent from 1 to 99.', 'Never 0 or 100: a forecast that can never be wrong cannot be scored fairly.', 'Move the slider or type the number.'),
  'forecast.final': h('A forecast is final', 'Once recorded, a forecast cannot be changed, withdrawn or made again for the same task.', 'An estimate that can be edited after the review would always look good.', 'Check the percent before you record it.'),
  'forecast.result': h('Your score for this task', 'Your forecast, what the first review decided, and your Brier score for the task: (forecast - outcome) squared, where the outcome is 1 for accepted and 0 for anything else. Lower is better. 0 is perfect, 0.25 is what always saying 50% would score.',
    'It is one task, so it says little on its own. Your record over many tasks is under Settings, Forecasts.', 'Log loss is the other score: minus the log of the probability you gave to what happened.'),
  'forecasts.count': h('Forecasts', 'How many forecasts you made, and how many are resolved (scored), open (waiting for a first review), void (the task was canceled or its mission archived) or late (shown, never scored).', 'Only resolved forecasts have scores.'),
  'forecasts.brier': h('Mean Brier', 'The average of (forecast - outcome) squared over your resolved forecasts. Lower is better; 0.25 equals always saying 50%.', 'It rewards honest, well-sized confidence.', 'n is the number of resolved forecasts it averages.'),
  'forecasts.log': h('Mean log loss', 'The average of minus the natural log of the probability you gave to what happened, over your resolved forecasts. Lower is better. Probabilities are held between 1% and 99% for this score.', 'It punishes a confident miss much harder than Brier does.', 'n is the number of resolved forecasts it averages.'),
  'forecasts.skill': h('Skill against the baseline', 'How much closer your forecasts were than the historical first-review acceptance rate of the same task class and difficulty, on the same tasks. Positive: you were closer. Negative: the class rate was closer.',
    'It shows only from 20 resolved forecasts that have such a baseline. Before that it reads "not enough evidence" with the count, because a handful of tasks cannot separate skill from luck.',
    'Skill = 1 - your mean Brier / the baseline\'s mean Brier. The baseline is computed over the missions you can see.', undefined, 'It says nothing about any other task, and nothing about agents.'),
  'forecasts.calibration': h('Calibration', 'Your resolved forecasts grouped into five ranges (1-20, 21-40, 41-60, 61-80, 81-99 percent). For each range: how many forecasts, the average you said, and the share that was actually accepted.',
    'If you said about 70% and about 70% were accepted, you are well calibrated there.', 'A range shows its accepted share only from 5 forecasts; below that it shows the count only.'),
  'forecasts.bin': h('A calibration range', 'The forecasts that fall in this percent range. n is how many. The accepted share and the average forecast are shown from 5 forecasts.', 'With fewer, one task would swing the rate by 20 points or more.'),
  'forecasts.list': h('Your forecasts', 'Each forecast you made, newest first as the server returns them: the task, your percent, its state, and for resolved ones the outcome and the scores.', 'Open the task from its mission to see its reviews.', undefined, undefined, 'Only your own forecasts.'),
  'forecasts.method': h('How it is scored', 'The scoring rules, as the server states them: both scores are losses (lower is better), the clamp used for the log, the calibration ranges and the floors for showing a rate, a baseline and skill.', 'So the numbers can be checked by hand.'),
  'forecasts.class': h('By task class', 'Your mean scores per task class, only for classes where you have resolved forecasts. A mean shows from 5 resolved forecasts in the class.', 'Calibration can differ between kinds of work.'),
  'forecasts.user': h('One person\'s forecasts', 'An administrator can read one person\'s forecast record at a time. There is no list of people ordered by score.', 'A record is for understanding, not ranking.', undefined, undefined, 'Administrators only.'),
};
export default entries;
