import type { Db, Tx } from '../db.ts';
import type { OrgChurn } from '../../../shared/contracts/src/index.ts';
import type { OrgGuardrailSettings } from '../config.ts';
import { diffLines, type EdgeIn } from './validate.ts';

/**
 * c64 (R3-6) item 3: churn budget and cooldown. Operator settings (Config.orgGuardrails, env ORG_*), never routes; 0 or unset means
 * "not enforced". The number of lines a proposal changes is the cycle 4 diff: added + removed + re-pointed. Time is the DATABASE clock
 * only: "inside the cooldown", "inside the window" and the minutes remaining are computed in SQL with now(); the application never
 * builds a time bound or compares a time. Anchor = the decision time of an APPLIED proposal (not org_revisions: a hire appends a
 * revision too, and a hire is not a restructure).
 */
export const DEFAULT_CHURN_WINDOW_HOURS = 168; // a budget with no window set counts over one week

export const linesChanged = (current: EdgeIn[], proposed: EdgeIn[]) => { const d = diffLines(current, proposed); return d.added.length + d.removed.length + d.moved.length; };

export async function churnStatus(c: Tx | Db, tenantId: string, lines: number, s: OrgGuardrailSettings = {}): Promise<OrgChurn> {
  const cooldown = s.cooldownHours && s.cooldownHours > 0 ? s.cooldownHours : null;
  const budget = s.churnBudget && s.churnBudget > 0 ? s.churnBudget : null;
  const windowHours = budget === null ? null : (s.churnWindowHours && s.churnWindowHours > 0 ? s.churnWindowHours : DEFAULT_CHURN_WINDOW_HOURS);
  const r = (await c.query(
    `select coalesce((select sum(lines_changed) from org_proposals where tenant_id = $1 and status = 'applied' and $2::int is not null
                       and decided_at > now() - make_interval(hours => $2::int)), 0)::int as used,
            (select ceil(extract(epoch from (max(decided_at) + make_interval(hours => $3::int) - now())) / 60)::int
               from org_proposals where tenant_id = $1 and status = 'applied' and $3::int is not null) as left_min`,
    [tenantId, windowHours, cooldown])).rows[0];
  const left = r.left_min as number | null;
  return {
    linesChanged: lines, budget, windowHours, usedInWindow: r.used, overBudget: budget !== null && r.used + lines > budget,
    cooldownHours: cooldown, cooldownEndsInMinutes: left !== null && left > 0 ? left : null,
  };
}

const span = (min: number) => (min >= 120 ? `${Math.ceil(min / 60)} hours` : min === 60 ? '1 hour' : `${min} ${min === 1 ? 'minute' : 'minutes'}`);
export const cooldownMessage = (ch: OrgChurn) => `An organisation change was approved less than ${ch.cooldownHours} hours ago. A new restructure proposal can be made in ${span(ch.cooldownEndsInMinutes!)}. This pause is set by the operator.`;
export const budgetMessage = (ch: OrgChurn) => `This proposal changes ${ch.linesChanged} reporting ${ch.linesChanged === 1 ? 'line' : 'lines'}. The operator allows ${ch.budget} per ${ch.windowHours} hours, and ${ch.usedInWindow} ${ch.usedInWindow === 1 ? 'was' : 'were'} already changed in that time. Split it, or wait.`;
