/**
 * c72, item 3: helpers that detect "agents ordered by a skill rating" in a response or in source. Pure, with RED proofs in c72-no-ranking.test.ts.
 */
const BANNED = /^(rank|ranks|ranking|position|place|leaderboard|standing|standings|ordinal|winner|loser|better|worse|higher|lower|best|worst|score|scores|order|orderBy|sortBy|topAgents|percentile)$/i;

/** Keys that name a rank, a position, a score or a direction, at any depth. */
export function rankingKeyProblems(body: unknown, route: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((e, i) => walk(e, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (BANNED.test(k)) out.push(`${route}: ${path}.${k} names a rank, score or direction`); walk(x, `${path}.${k}`); }
  };
  walk(body, '$');
  return [...new Set(out)];
}

/** A list of agent ids that is strictly monotone in the rating of three or more of them is an ordering by rating. */
export function ratingOrderProblems(ids: readonly string[], rating: ReadonlyMap<string, number>, route: string): string[] {
  const vals = ids.filter((i) => rating.has(i)).map((i) => rating.get(i)!);
  if (vals.length < 3) return [];
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

/** Source lines that sort (sort, toSorted, orderBy) with a comparator that mentions a rating field. */
export function sortedByRatingLines(src: string): string[] {
  return src.split('\n').filter((l) => /(\.sort\(|\.toSorted\(|orderBy)/.test(l) && /(adjusted|\braw\b|\.value\b|\.lo\b|\.hi\b|rating|nEff)/.test(l));
}
