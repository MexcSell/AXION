import { TASK_CLASS_IDS, DIFFICULTY_LEVELS, PAIR_RATING_NOTE, SKILL_METHOD, SKILL_MIN_N, TASK_CLASSES, compareSkill, skillCells, skillRatingDependsText, type AgentSkillsDto, type LevelCount, type SkillCompareDto, type TaskClassId } from '@contracts';

/**
 * c72: demo-mode skill ratings. A fixed fixture per agent id (deterministic: the same agent always has the same cells), run through the SAME shared
 * estimator the server uses, so the screen shows real arithmetic on made-up outcomes. Tagged DEMO on screen. Classes come out in the fixed class order.
 */
const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const DELTA = [0, -1.5, -0.75, 0, 0.75, 1.5];

function levelsFor(agentId: string): Map<TaskClassId, LevelCount[]> {
  const r = rng(hash(agentId));
  const out = new Map<TaskClassId, LevelCount[]>();
  const picks = [...TASK_CLASS_IDS].filter(() => r() < 0.7);
  if (picks.length < 4) picks.push(...TASK_CLASS_IDS.filter((c) => !picks.includes(c)).slice(0, 4 - picks.length));
  const skill = (r() - 0.4) * 2;
  for (const c of picks) {
    const total = r() < 0.25 ? 2 + Math.floor(r() * 3) : 8 + Math.floor(r() * 28); // some classes stay under 5: "not enough evidence"
    const lo = 1 + Math.floor(r() * 3), width = 1 + Math.floor(r() * 2); // the levels this agent happened to be given
    const lv = new Map<number, LevelCount>();
    for (let i = 0; i < total; i++) {
      const d = Math.min(5, lo + Math.floor(r() * (width + 1)));
      const l = lv.get(d) ?? { d, n: 0, x: 0 };
      l.n++; if (r() < 1 / (1 + Math.exp(-(skill + (r() - 0.5) * 0.6 - DELTA[d])))) l.x++;
      lv.set(d, l);
    }
    out.set(c, DIFFICULTY_LEVELS.map((d) => lv.get(d)).filter((l): l is LevelCount => !!l));
  }
  return out;
}

export function demoSkills(agentId: string): AgentSkillsDto {
  return {
    agentId, method: SKILL_METHOD, minN: SKILL_MIN_N, classes: skillCells(levelsFor(agentId)), unrated: 0, includesSimulated: true,
    pairRatings: { built: false, why: PAIR_RATING_NOTE }, dependsOn: { gameable: true, text: skillRatingDependsText() },
  };
}
export function demoCompare(agentId: string, withId: string): SkillCompareDto {
  const a = levelsFor(agentId), b = levelsFor(withId);
  return {
    agentId, withId, method: SKILL_METHOD,
    classes: TASK_CLASS_IDS.filter((k) => a.has(k) || b.has(k)).map((classId) => ({ classId, label: TASK_CLASSES[classId], ...compareSkill(a.get(classId) ?? [], b.get(classId) ?? []) })),
  };
}
