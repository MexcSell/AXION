import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * c72, item 3 (extended in the fix round, F4): helpers that detect "agents ordered by a skill rating" in a response or in source. Pure, with RED proofs in
 * c72-no-ranking.test.ts. Limits are stated there.
 */
/** A key is split into words (camelCase, snake_case, kebab-case); a word that starts with one of these is a ranking word. */
const BANNED_PREFIX = ['podium', 'ladder', 'rank', 'leader', 'standing', 'ordinal', 'winner', 'loser', 'better', 'worse', 'higher', 'lower', 'best', 'worst', 'scoreboard', 'percentile', 'orderby', 'sortby'];
const BANNED_WORD = new Set(['top', 'position', 'positions', 'place', 'placing', 'score', 'scores', 'order']);
/** Existing keys that contain one of the words above for an unrelated reason, each with the reason. A new entry is a reviewed decision. */
/** Keyed `route::key`, so an exemption never spreads to another route. */
export const KEY_ALLOWLIST: Record<string, string> = {
  'GET /review-capacity::minPercentileN': 'the minimum sample size for a percentile of review times; about people\'s review capacity, not a rating of agents',
  'GET /review-capacity/people::minPercentileN': 'the same minimum sample size, on the per-person view',
  'GET /skills/retirement-proposals::score': 'a retirement proposal for a skill RECORD (c59): how little a skill was used; not an agent rating and not an ordering of agents',
  'GET /attention::ranking': 'c68: the order of the "Needs you" queue (by tier and age), a queue of items for a person, never of agents',
};
export const keyWords = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
export const isRankingKey = (k: string) => keyWords(k).some((w) => BANNED_WORD.has(w) || BANNED_PREFIX.some((p) => w.startsWith(p)));

/** Keys that name a rank, a position, a score or a direction, at any depth. */
export function rankingKeyProblems(body: unknown, route: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((e, i) => walk(e, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (isRankingKey(k) && !(`${route}::${k}` in KEY_ALLOWLIST)) out.push(`${route}: ${path}.${k} names a rank, score or direction`); walk(x, `${path}.${k}`); }
  };
  walk(body, '$');
  return [...new Set(out)];
}

/** A list of agent ids that is strictly monotone in the rating of two or more of them is an ordering by rating (statistical: two entries are monotone by chance half the time, so live sweeps also use the metamorphic check). */
export function ratingOrderProblems(ids: readonly string[], rating: ReadonlyMap<string, number>, route: string, min = 2): string[] {
  const vals = ids.filter((i) => rating.has(i)).map((i) => rating.get(i)!);
  if (vals.length < min) return [];
  const pairs = vals.slice(1).map((v, i) => Math.sign(v - vals[i]));
  if (pairs.every((s) => s <= 0) && pairs.some((s) => s < 0)) return [`${route}: the agents are ordered by a rating (descending): ${vals.join(' >= ')}`];
  if (pairs.every((s) => s >= 0) && pairs.some((s) => s > 0)) return [`${route}: the agents are ordered by a rating (ascending): ${vals.join(' <= ')}`];
  return [];
}

/** Every adjusted rating in a body with the agent it belongs to: an object with an agentId (or the path of the entry) that holds classes[].adjusted. */
export function ratingsInBody(body: unknown): { agentId: string; classId: string; value: number }[] {
  const out: { agentId: string; classId: string; value: number }[] = [];
  const walk = (v: unknown, agentId: string | null) => {
    if (Array.isArray(v)) v.forEach((e) => walk(e, agentId));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const id = typeof o.agentId === 'string' ? o.agentId : agentId;
      if (typeof o.classId === 'string' && o.adjusted && typeof (o.adjusted as any).value === 'number') out.push({ agentId: id ?? '?', classId: o.classId, value: (o.adjusted as any).value });
      for (const x of Object.values(o)) walk(x, id);
    }
  };
  walk(body, null);
  return out;
}

/** Arrays holding two or more entries that each carry a skill rating (a list of rated agents, however it is ordered). */
export function ratedListProblems(body: unknown, route: string): string[] {
  const out: string[] = [];
  const carries = (v: unknown): boolean => !!v && typeof v === 'object' && ratingsInBody(v).length > 0;
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) { if (v.filter(carries).length >= 2 && v.every((e) => e && typeof e === 'object' && !('classId' in (e as object)))) out.push(`${route}: ${path} is a list of two or more rated entries`); v.forEach((e, i) => walk(e, `${path}[${i}]`)); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(body, '$');
  return out;
}

/** Words that, inside a sort comparator, say it sorts by a rating or by a function of one. */
const RATING_WORDS = /(adjusted|\braw\b|\.value\b|\.lo\b|\.hi\b|rating|nEff|\bscore\w*|\brank\w*|skill\w*|standardis\w*|\bpct\b|percent\w*|\bsuccess\b|reliab\w*)/;
/** Source that sorts with a comparator naming a rating. Newlines are joined first, so a comparator split over lines is seen; the whole comparator (balanced parentheses) is read. */
export function sortedByRatingLines(src: string): string[] {
  const flat = src.replace(/\/\/[^\n]*/g, ' ').replace(/\s*\n\s*/g, ' ');
  const out: string[] = [];
  for (const m of flat.matchAll(/(\.sort\(|\.toSorted\(|orderBy\()/g)) {
    let depth = 1, i = m.index! + m[0].length;
    for (; i < flat.length && depth > 0; i++) { if (flat[i] === '(') depth++; else if (flat[i] === ')') depth--; }
    const call = flat.slice(m.index!, i);
    if (RATING_WORDS.test(call)) out.push(call.length > 160 ? call.slice(0, 160) + '…' : call);
  }
  return out;
}

const walkDir = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f === 'node_modules' || f === 'dist' ? [] : walkDir(join(d, f))) : /\.(ts|tsx)$/.test(f) ? [join(d, f)] : []));
/** Files that import a skill module (the rating's source): any sort in them must be reviewed, whatever the comparator calls its fields. */
const SKILL_IMPORT = /(agents\/skills|\/skills\.ts|skillDemo|agentSkills|SkillVector|contracts\/src\/index|@contracts)/;
/** Sorts that are not about a rating although the comparator mentions one of the words, each with the reason. `file::first 60 characters of the call`. */
export const SORT_ALLOWLIST: Record<string, string> = {
  '/server/src/conversations/service.ts::.sort((x, y) => rank(x, ctx.user.id) - rank(y, ctx.user.id))': 'orders conversations for a viewer; has nothing to do with agents or ratings',
  '/web/src/components/layout/CommandPalette.tsx::.sort((x, y) => x.score - y.score)': 'orders command-palette search matches by match score',
  '/server/src/delegation/brief.ts::.sort()': 'default sort of capability strings inside a brief (canonical order); no rating',
  '/web/src/pages/AgentProfile.tsx::.sort((a, b) => agent.metrics[b] - agent.metrics[a])': 'orders the metric NAMES of one agent for its own profile card, not agents',
  '/web/src/pages/AgentProfile.tsx::.sort((x, y) => x.last.agoMin - y.last.agoMin)': 'orders conversation threads by recency',
};
export interface SortFinding { file: string; call: string }
/** Every sort over a rating word in ALL of server/src and web/src, plus every non-trivial sort in a file that imports a skill module. */
export function sortScan(root: string): SortFinding[] {
  const out: SortFinding[] = [];
  for (const dir of ['server/src', 'web/src', 'shared/contracts/src']) for (const f of walkDir(join(root, dir))) {
    const src = readFileSync(f, 'utf8');
    for (const c of sortedByRatingLines(src)) if (!(`${f.replace(root, '')}::${c.slice(0, 60)}` in SORT_ALLOWLIST)) out.push({ file: f.replace(root, ''), call: c });
  }
  return out;
}
/** A file that imports a skill-specific module (not the whole contracts index) and sorts with a comparator that is not a plain name or level order. */
export function skillFileSorts(root: string): SortFinding[] {
  const out: SortFinding[] = [];
  const SKILL_SPECIFIC = /(agents\/skills|contracts\/src\/skills|skillDemo|agentSkills|SkillVector)/;
  for (const dir of ['server/src', 'web/src', 'shared/contracts/src']) for (const f of walkDir(join(root, dir))) {
    const src = readFileSync(f, 'utf8');
    if (!SKILL_SPECIFIC.test(src.split('\n').filter((l) => /^import|from '/.test(l)).join('\n')) && !/skills\.ts$|skills\.tsx$/.test(f)) continue;
    const flat = src.replace(/\s*\n\s*/g, ' ');
    for (const m of flat.matchAll(/(\.sort\(|\.toSorted\()/g)) {
      let depth = 1, i = m.index! + m[0].length;
      for (; i < flat.length && depth > 0; i++) { if (flat[i] === '(') depth++; else if (flat[i] === ')') depth--; }
      const call = flat.slice(m.index!, i);
      if (!/(localeCompare|\.d - |p - q|\.d\b)/.test(call) && !(`${f.replace(root, '')}::${call.slice(0, 60)}` in SORT_ALLOWLIST)) out.push({ file: f.replace(root, ''), call: call.slice(0, 160) });
    }
  }
  return out;
}
void SKILL_IMPORT;
