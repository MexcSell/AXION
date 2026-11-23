import type { Tx, Db } from '../db.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import {
  TASK_CLASS_IDS, TASK_CLASSES, SKILL_MIN_N, SKILL_METHOD, PAIR_RATING_NOTE,
  skillCells, compareSkill, skillRatingDependsText, SKILL_RATING_INPUTS, writabilityOf,
  type LevelCount, type SkillCellDto, type AgentSkillsDto, type SkillCompareDto, type TaskClassId,
} from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 72 (R3-7): the skill vector of an agent, read from recorded tasks only. Method and limits are written in
 * shared/contracts/src/skills.ts. Read model: nothing here writes, assigns or ranks, and no function returns agents ordered by a rating.
 *
 * An outcome is a finished (passed or failed) task of a mission the viewer can see, owned by the agent when it finished, with a delegation
 * brief to that agent that was created BEFORE the task first finished (the first such one, so no later brief can relabel an outcome that is already known; see loadSkillOutcomes) and names BOTH a task class and a difficulty. A task whose brief names only one of the
 * two is counted as "unrated" and left out of every cell. Simulated (DEMO) tasks are left out unless includeSimulated.
 */
export interface SkillOutcome { agentId: string; classId: TaskClassId | null; difficulty: number | null; success: boolean }
const isClass = (s: unknown): s is TaskClassId => typeof s === 'string' && (TASK_CLASS_IDS as readonly string[]).includes(s);

export async function loadSkillOutcomes(c: Tx | Db, viewer: { tenantId: string; admin: boolean; userId: string }, includeSimulated: boolean): Promise<SkillOutcome[]> {
  // c72 fix round (F1). `fin` is the time the task FIRST became passed, failed or canceled (the first such state-change event; a task with no event, such as a
  // fixture, uses its creation time). The owner is the agent that owned the task at `fin` (task_owner_history; before the first row, the first owner), so a
  // reassignment after a failure moves nothing. A label counts only from a brief to that owner created before `fin` (the first such brief).
  const rows = (await c.query(
    `select o.owner, o.status, b.brief->>'taskClass' as cls, b.brief->>'difficulty' as diff
       from (select t.id, t.status, t.fin, (select coalesce(h.agent_id, h.owner_agent) from task_owner_history h where h.task_id = t.id
                                               order by (h.at <= t.fin) desc, (case when h.at <= t.fin then -h.seq else h.seq end) limit 1) as owner
               from (select t.id, t.status, coalesce((select min(e.occurred_at) from events e where e.tenant_id = t.tenant_id and e.type = 'task.stateChanged' and e.subject_id = t.id
                                                         and e.payload->>'to' in ('passed','failed','canceled')), t.created_at) as fin
                       from tasks t join missions m on m.id = t.mission_id
                      where m.tenant_id = $1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')}
                        and t.status in ('passed','failed') and ($4::boolean or not (t.simulated or m.demo))) t) o
       left join lateral (select d.brief from delegation_briefs d where d.task_id = o.id and d.to_agent = o.owner and d.created_at < o.fin order by d.seq asc limit 1) b on true
      where o.owner is not null`,
    [viewer.tenantId, viewer.admin, viewer.userId, includeSimulated])).rows as { owner: string; status: string; cls: string | null; diff: string | null }[];
  return rows.map((r) => {
    const d = r.diff === null ? NaN : Number(r.diff);
    const ok = isClass(r.cls) && Number.isInteger(d) && d >= 1 && d <= 5;
    return { agentId: r.owner, classId: ok ? (r.cls as TaskClassId) : null, difficulty: ok ? d : null, success: r.status === 'passed' };
  });
}

/** Counts per task class and difficulty level for one agent (pure). */
export function levelsByClass(outcomes: readonly SkillOutcome[], agentId: string): { byClass: Map<TaskClassId, LevelCount[]>; unrated: number } {
  const acc = new Map<TaskClassId, Map<number, LevelCount>>();
  let unrated = 0;
  for (const o of outcomes) {
    if (o.agentId !== agentId) continue;
    if (!o.classId || !o.difficulty) { unrated++; continue; }
    const m = acc.get(o.classId) ?? new Map<number, LevelCount>();
    const l = m.get(o.difficulty) ?? { d: o.difficulty, n: 0, x: 0 };
    l.n++; if (o.success) l.x++;
    m.set(o.difficulty, l); acc.set(o.classId, m);
  }
  return { byClass: new Map([...acc].map(([k, v]) => [k, [...v.values()].sort((a, b) => a.d - b.d)])), unrated };
}

export { skillCells };

export function skillsOf(outcomes: readonly SkillOutcome[], agentId: string, includeSimulated: boolean): AgentSkillsDto {
  const { byClass, unrated } = levelsByClass(outcomes, agentId);
  return {
    agentId, method: SKILL_METHOD, minN: SKILL_MIN_N, classes: skillCells(byClass), unrated, finished: unrated + [...byClass.values()].reduce((a, lv) => a + lv.reduce((x, l) => x + l.n, 0), 0), includesSimulated: includeSimulated,
    pairRatings: { built: false, why: PAIR_RATING_NOTE },
    dependsOn: { gameable: writabilityOf(SKILL_RATING_INPUTS).agentWritable, text: skillRatingDependsText() },
  };
}

/** Two agents, class by class, in the fixed class order. Only "distinguishable" or "indistinguishable"; never a direction, a rank or a score. */
export function compareSkills(outcomes: readonly SkillOutcome[], agentId: string, withId: string): SkillCompareDto {
  const a = levelsByClass(outcomes, agentId).byClass, b = levelsByClass(outcomes, withId).byClass;
  return {
    agentId, withId, method: SKILL_METHOD,
    classes: TASK_CLASS_IDS.filter((k) => a.has(k) || b.has(k)).map((classId) => ({ classId, label: TASK_CLASSES[classId], ...compareSkill(a.get(classId) ?? [], b.get(classId) ?? []) })),
  };
}
