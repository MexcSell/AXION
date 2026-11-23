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
 * brief to that agent (the FIRST one for the task, i.e. the label stated when the task was handed over, so a later brief cannot relabel an outcome that is already known) that names BOTH a task class and a difficulty. A task whose brief names only one of the
 * two is counted as "unrated" and left out of every cell. Simulated (DEMO) tasks are left out unless includeSimulated.
 */
export interface SkillOutcome { agentId: string; classId: TaskClassId | null; difficulty: number | null; success: boolean }
const isClass = (s: unknown): s is TaskClassId => typeof s === 'string' && (TASK_CLASS_IDS as readonly string[]).includes(s);

export async function loadSkillOutcomes(c: Tx | Db, viewer: { tenantId: string; admin: boolean; userId: string }, includeSimulated: boolean): Promise<SkillOutcome[]> {
  const rows = (await c.query(
    `select o.owner, o.status, b.brief->>'taskClass' as cls, b.brief->>'difficulty' as diff
       from (select t.id, t.status, coalesce(i.agent_id, t.owner_agent) as owner
               from tasks t join missions m on m.id = t.mission_id left join agent_instances i on i.id = t.owner_instance_id
              where m.tenant_id = $1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')}
                and t.status in ('passed','failed') and ($4::boolean or not (t.simulated or m.demo))) o
       join lateral (select d.brief from delegation_briefs d where d.task_id = o.id and d.to_agent = o.owner order by d.seq asc limit 1) b on true
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
    agentId, method: SKILL_METHOD, minN: SKILL_MIN_N, classes: skillCells(byClass), unrated, includesSimulated: includeSimulated,
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
