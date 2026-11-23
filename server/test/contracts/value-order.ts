/**
 * c78 (H20): a VALUE-based no-leaderboard check for the coverage run. It looks at what the responses contain, never at what the fields are called,
 * so a rating renamed to `pct`, or a list sorted by a comparator that calls an unrelated function, is still seen.
 *
 *  1. Any array of three or more entries that each NAME AN AGENT (a string directly in the entry, or in an object one level down, is the id of a real agent
 *     or agent instance the run has seen, whatever the key is called) and whose numeric field (a leaf, or a leaf inside nested objects) is monotone over three or more
 *     distinct values is "agents ordered by that field". Restricting to agent entries keeps the check quiet on lists of versions, messages and
 *     missions that are sorted by time on purpose; a real hit needs a reviewed entry in ORDER_ALLOWED.
 *  2. RATING_FIELDS is the registry of fields that hold a rating (a skill rating, c72). An array in which two or more entries carry a marked field is
 *     a list of rated entries, in whatever order, and is flagged unless it is a single agent's own vector (RATED_LIST_ALLOWED).
 *     c72 is merged: `adjusted.value` is registered below.
 * Pure functions; the self-tests are in c78-value-order.test.ts, the sweep over every coverage response is in coverage.test.ts.
 */
export const RATING_FIELDS: Record<string, string[]> = {
  // c72 (registered at its merge): the adjusted rate of a skill cell; the cells are one agent's own, one per task class
  'GET /agents/:id/skills': ['classes[].adjusted.value'],
};
/**
 * Matched against `route::array path::field path`. Every entry is a reviewed decision with the reason the order is not about agents and a rating:
 * these are lists of records that name an agent and are sorted by time or by a counter on purpose. Keep each pattern to one route and one field.
 */
export const ORDER_ALLOWED: [RegExp, string][] = [
  [/^GET \/lessons::lessons\[\]::acceptedInVersion$/, 'lessons of the playbook, newest accepted first (the version they entered); a version counter, not a rating'],
  [/^GET \/missions::missions\[\]::(updatedAt|syncVersion)$/, 'the mission list is newest-updated first; syncVersion is the per-mission change counter and rises with the update time'],
  [/^(GET|PATCH|POST) \/missions\/:id(\/actions\/:action|\/share)?::(mission\.)?staffing\.log\[\]::at$/, 'the staffing log of a mission, oldest first, by time'],
  [/^(GET) \/missions::missions\[\]\.staffing\.log\[\]::at$/, 'the staffing log of each mission in the list, oldest first, by time'],
];
/** Keyed `route::array path`: arrays that legitimately hold a rating on two or more entries (one agent's own cells, one per task class). */
export const RATED_LIST_ALLOWED: Record<string, string> = {
  'GET /agents/:id/skills::classes': 'one agent\'s own skill cells, one per task class, always in the fixed class order (never sorted by a rating); a single agent\'s vector, not a list of agents',
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Numeric leaves of an object, as dotted paths ("adjusted.value"), looking through nested objects but not arrays. */
export function numericLeaves(o: Obj, prefix = '', depth = 0): Record<string, number> {
  const out: Record<string, number> = {};
  if (depth > 3) return out;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[prefix + k] = v;
    else if (isObj(v)) Object.assign(out, numericLeaves(v, prefix + k + '.', depth + 1));
  }
  return out;
}

/** 'asc' / 'desc' when the values never move against that direction and take at least `minDistinct` different values. */
export function monotone(vals: readonly number[], minDistinct = 3): 'asc' | 'desc' | null {
  if (new Set(vals).size < minDistinct) return null;
  let up = true, down = true;
  for (let i = 1; i < vals.length; i++) { if (vals[i] < vals[i - 1]) up = false; if (vals[i] > vals[i - 1]) down = false; }
  return up ? 'asc' : down ? 'desc' : null;
}

/** True when a string directly in the entry, or directly in an object nested one level down (never in a list), is the id of a known agent. */
const namesAgent = (o: Obj, ids: ReadonlySet<string>): boolean =>
  Object.values(o).some((v) => (typeof v === 'string' ? ids.has(v) : isObj(v) && Object.values(v).some((x) => typeof x === 'string' && ids.has(x))));

/** Every array of three or more agent entries in `body` that is monotone in a numeric field the entries all carry. */
export function orderedArrays(body: unknown, agentIds: ReadonlySet<string>): { path: string; field: string; dir: 'asc' | 'desc'; vals: number[] }[] {
  const out: { path: string; field: string; dir: 'asc' | 'desc'; vals: number[] }[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      if (objs.length >= 3 && objs.length === v.length && objs.every((o) => namesAgent(o, agentIds))) {
        const leaves = objs.map((o) => numericLeaves(o));
        for (const f of Object.keys(leaves[0])) {
          if (!leaves.every((l) => f in l)) continue;
          const vals = leaves.map((l) => l[f]);
          const dir = monotone(vals);
          if (dir) out.push({ path: path + '[]', field: f, dir, vals });
        }
      }
      v.forEach((e) => walk(e, path + '[]'));
    } else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? path + '.' + k : k);
  };
  walk(body, '');
  return out;
}

/** Arrays in which two or more entries carry a field registered as a rating (any order). `marked` are paths like 'classes[].adjusted.value'. */
export function ratedLists(body: unknown, marked: readonly string[]): { path: string; field: string; n: number }[] {
  const out: { path: string; field: string; n: number }[] = [];
  const has = (v: unknown, segs: string[]): boolean => {
    if (!segs.length) return typeof v === 'number';
    if (Array.isArray(v)) return v.some((e) => has(e, segs));
    if (!isObj(v)) return false;
    const [head, ...rest] = segs;
    return head in v && has(v[head], rest);
  };
  for (const m of marked) {
    const segs = m.replace(/\[\]/g, '').split('.');
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) {
        const n = v.filter((e) => has(e, segs)).length;
        if (n >= 2) out.push({ path: path + '[]', field: m, n });
        v.forEach((e) => walk(e, path + '[]'));
      } else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? path + '.' + k : k);
    };
    walk(body, '');
  }
  return out;
}

/** The problems of one response, minus the reviewed allowances. */
export function valueOrderProblems(route: string, body: unknown, agentIds: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const o of orderedArrays(body, agentIds)) if (!ORDER_ALLOWED.some(([re]) => re.test(`${route}::${o.path}::${o.field}`))) out.push(`${route}: ${o.path} is ordered ${o.dir === 'asc' ? 'ascending' : 'descending'} by ${o.field} (${o.vals.slice(0, 6).join(', ')})`);
  for (const r of ratedLists(body, RATING_FIELDS[route] ?? [])) if (!(`${route}::${r.path}` in RATED_LIST_ALLOWED)) out.push(`${route}: ${r.path} is a list of ${r.n} entries that carry the rating ${r.field}`);
  return out;
}
