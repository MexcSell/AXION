import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { rankingKeyProblems, ratingOrderProblems, ratingsInBody, sortedByRatingLines, ratedListProblems, sortScan, skillFileSorts, isRankingKey } from './contracts/no-ranking.ts';
import { briefSha } from '../src/delegation/brief.ts';
import { TASK_CLASS_IDS } from '../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 72, item 3: no leaderboard. No API response and no screen returns agents ordered by a skill rating, and a comparison says only
 * "distinguishable" or "indistinguishable". The guard has four parts, each proved against a deliberate violation (RED proofs):
 *  1. key scan: no response key names a rank, position, score or direction;
 *  2. order scan: no list of agents in any response is monotone in an agent's rating (ratings read from the skill route, so a hidden sort is caught);
 *  3. source scan: no sort of skill code mentions a rating;
 *  4. the skill routes are the only routes that carry a rating, and they carry one agent (or two, for a comparison).
 */
let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'c72r-' + Date.now() + '-' + n++ });

describe('guard self-tests (RED proofs)', () => {
  it('reports a key that names a rank or a direction, at any depth', () => {
    expect(rankingKeyProblems({ classes: [{ classId: 'coding', verdict: 'distinguishable' }] }, 'ok')).toEqual([]);
    for (const k of ['rank', 'position', 'place', 'leaderboard', 'standing', 'ordinal', 'winner', 'better', 'higher', 'score', 'order', 'topAgents', 'rankIndex', 'top', 'leaders', 'agent_rank', 'top_n', 'bestAgent']) expect(rankingKeyProblems({ a: [{ b: { [k]: 1 } }] }, 'r').join(), k).toContain(k);
  });
  it('reports a list that is ordered by a rating, ascending or descending, and accepts a mixed order', () => {
    const rating = new Map([['a', 90], ['b', 70], ['c', 80], ['d', 60]]);
    expect(ratingOrderProblems(['b', 'a', 'c', 'd'], rating, 'GET /x')).toEqual([]);
    expect(ratingOrderProblems(['a', 'c', 'b', 'd'], rating, 'GET /x')[0]).toMatch(/ordered by a rating \(descending\)/);
    expect(ratingOrderProblems(['d', 'b', 'c', 'a'], rating, 'GET /x')[0]).toMatch(/\(ascending\)/);
    // F4: the reviewer's probe, a "top 2" list sorted by rating, is now reported (two or more rated entries)
    expect(ratingOrderProblems(['a', 'b'], rating, 'GET /x')[0]).toMatch(/ordered by a rating \(descending\)/);
    expect(ratingOrderProblems(['a', 'b'], rating, 'GET /x', 3)).toEqual([]); // the live sweep keeps 3 for lists, and adds the metamorphic check for any size
  });
  it('finds embedded ratings and reports an array of rated entries that is sorted', () => {
    const body = { entries: [{ agentId: 'a', skills: { classes: [{ classId: 'coding', adjusted: { value: 90 } }] } }, { agentId: 'b', skills: { classes: [{ classId: 'coding', adjusted: { value: 70 } }] } }, { agentId: 'c', skills: { classes: [{ classId: 'coding', adjusted: { value: 60 } }] } }] };
    expect(ratingsInBody(body).length).toBe(3);
    expect(ratingOrderProblems(body.entries.map((e) => e.agentId), new Map(ratingsInBody(body).map((r) => [r.agentId, r.value])), 'GET /y')[0]).toMatch(/\(descending\)/);
  });
  it('F4 probes: words in keys are matched by prefix and by word, and unrelated keys pass', () => {
    for (const k of ['classId', 'verdict', 'sharedLevels', 'stop', 'desktop', 'placeholder', 'positive', 'stopped', 'reason', 'method', 'pairRatings', 'pairs']) expect(isRankingKey(k), k).toBe(false);
    expect(rankingKeyProblems({ rankIndex: 1, top: ['a'], leaders: [1] }, 'r').length).toBe(3);
  });
  it('F4 probes: a list of two rated entries is reported however it is sorted, a renamed value is caught by its key, and a rated list needs classId entries to be exempt', () => {
    const e = (id: string, v: number) => ({ agentId: id, classes: [{ classId: 'coding', adjusted: { value: v } }] });
    expect(ratedListProblems({ top: [e('a', 90), e('b', 80)] }, 'GET /z')[0]).toMatch(/list of two or more rated entries/);
    expect(ratedListProblems({ classes: [e('a', 90).classes[0], e('a', 80).classes[0]] }, 'GET /ok')).toEqual([]); // the skill DTO's own class list is one agent's vector
    expect(rankingKeyProblems({ leaders: [{ agentId: 'a', pct: 90 }] }, 'GET /z').join()).toContain('leaders');
  });
  it('F4 probes: a comparator split over lines, one that calls a function, and a renamed field are reported', () => {
    expect(sortedByRatingLines('xs.sort(\n (p, q) =>\n q.adjusted.value - p.adjusted.value)')).toHaveLength(1);
    expect(sortedByRatingLines('xs.sort((p,q)=>score(q)-score(p))')).toHaveLength(1);
    expect(sortedByRatingLines('xs.sort((p, q) => q.pct - p.pct)')).toHaveLength(1);
    expect(sortedByRatingLines('xs.sort((p, q) => p.name.localeCompare(q.name))')).toEqual([]);
  });
  it('a source line that sorts by a rating is reported', () => {
    expect(sortedByRatingLines('x.sort((a, b) => b.adjusted.value - a.adjusted.value)')).toHaveLength(1);
    expect(sortedByRatingLines('levels.sort((p, q) => p.d - q.d)')).toEqual([]);
    expect(sortedByRatingLines('cells.toSorted((a, b) => a.raw.lo - b.raw.lo)')).toHaveLength(1);
  });
});

async function fixture() {
  t = await makeTestApp({ staffingStepMs: 30 });
  const A = await withAdmin(t.app);
  const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission.id as string;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
  const all = (await t.pool.query(`select id, agent_id, tenant_id from agent_instances where mission_id=$1 order by seq`, [m])).rows as { id: string; agent_id: string; tenant_id: string }[];
  const seen = new Set<string>();
  const inst = all.filter((r) => (seen.has(r.agent_id) ? false : (seen.add(r.agent_id), true)));
  return { A, m, inst };
}
const outcomes = async (m: string, ag: { id: string; agent_id: string; tenant_id: string }, pass: number, total: number, cls: string, d: number, tag: string) => {
  for (let i = 0; i < total; i++) {
    const id = `T-c72r-${tag}-${i}`;
    await t.pool.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ($1,$2,$3,'fixture',$4,$5)`, [id, ag.tenant_id, m, i < pass ? 'passed' : 'failed', ag.agent_id]);
    const b = { goal: 'Do the fixture task', inputs: [], acceptance: ['Done'], capabilities: [{ kind: 'read' }], escalation: 'Ask', taskClass: cls, difficulty: d };
    await t.pool.query(`insert into delegation_briefs(tenant_id, mission_id, task_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by, created_at) values ($1,$2,$3,'c72','user',$4,$5,$6,$7,1,'c72', now() - interval '1 hour')`, [ag.tenant_id, m, id, ag.id, ag.agent_id, JSON.stringify(b), briefSha(b)]);
  }
};

describe('no response orders agents by a rating', () => {
  it('with five rated agents, no list in any agent response is monotone in a rating, no key names a rank, and only the skill routes carry a rating', async () => {
    const { A, m, inst } = await fixture();
    expect(inst.length).toBeGreaterThanOrEqual(4);
    const list = (await A.admin.req('GET', '/agents')).body.agents as { id: string }[];
    const instList = (await A.admin.req('GET', '/agent-instances')).body.instances as { agentId: string }[];
    const orders = [list.map((x) => x.id), instList.map((x) => x.agentId)];
    const four = inst.slice(0, 4);
    const monotone = (ids: string[], by: Map<string, number>) => ratingOrderProblems(ids, by, 'x').length > 0;
    // pick the pass counts so that no list the server returns happens to be in rating order (a coincidence would make the scan below fail for the wrong reason)
    const perms = (a: number[]): number[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
    const passes = perms([8, 3, 9, 5]).find((p) => { const by = new Map(four.map((a, i) => [a.agent_id, p[i]] as [string, number])); return orders.every((o) => !monotone(o.filter((id) => by.has(id)), by)); });
    expect(passes, 'a pass-count assignment that is monotone in none of the lists').toBeTruthy();
    const rated = four;
    for (let i = 0; i < rated.length; i++) await outcomes(m, rated[i], passes![i], 10, 'coding', 3, String(i));
    const rating = new Map<string, number>();
    for (const ag of rated) {
      const c = (await A.admin.req('GET', `/agents/${ag.agent_id}/skills`)).body.skills.classes.find((x: any) => x.classId === 'coding');
      expect(c.state).toBe('ok'); rating.set(ag.agent_id, c.adjusted.value);
    }
    expect(new Set(rating.values()).size).toBe(4);
    const problems: string[] = [];
    const bodies: [string, any][] = [];
    const get = async (url: string) => { const r = await A.admin.req('GET', url); expect(r.status, url).toBe(200); bodies.push([`GET ${url}`, r.body]); return r.body; };
    const sweep = ['/agents', '/agents?includeSimulated=1', '/organization/graph', '/agent-instances', '/departments', '/company/dimensions?window=30d', '/company/scorecard?window=30d', '/company/metric-guard', `/missions/${m}/delegation-briefs`, `/missions/${m}`];
    for (const url of sweep) await get(url); // every sweep route must answer 200: a failing route is a failure, not a skip
    for (const ag of rated) { await get(`/agents/${ag.agent_id}`); await get(`/agents/${ag.agent_id}/skills`); await get(`/agents/${ag.agent_id}/skills/compare?with=${rated.find((r) => r !== ag)!.agent_id}`); }
    for (const [route, body] of bodies) {
      problems.push(...rankingKeyProblems(body, route), ...ratedListProblems(body, route));
      // every array of objects that names agents (an `id`, `agentId` or `toAgentId`) is checked against the ratings read from the skill route
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) {
          const ids = v.map((e) => (e && typeof e === 'object' ? ((e as any).agentId ?? (e as any).toAgentId ?? (e as any).id) : undefined));
          if (ids.every((x) => typeof x === 'string') && ids.filter((x) => rating.has(x)).length >= 3) problems.push(...ratingOrderProblems(ids.filter((x) => rating.has(x)), rating, route, 3));
          v.forEach(walk);
        } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(body);
      // only the skill routes carry a rating
      if (!/\/skills/.test(route) && ratingsInBody(body).length) problems.push(`${route}: carries a skill rating, but only the skill routes may`);
      if (/\/skills$/.test(route) && ratingsInBody(body).some((r) => r.agentId !== (body.skills?.agentId))) problems.push(`${route}: carries another agent's rating`);
    }
    expect(problems).toEqual([]);
    // F4, metamorphic check for lists of any size (two entries are in rating order by chance half the time): reverse the ratings by adding outcomes, fetch the same
    // routes again, and every list of two or more rated agents must keep exactly the same order.
    const lists = (bs: [string, any][]) => {
      const out: Record<string, string[]> = {};
      for (const [route, body] of bs) {
        const walk = (v: unknown, path: string): void => {
          if (Array.isArray(v)) {
            const ids = v.map((e) => (e && typeof e === 'object' ? ((e as any).agentId ?? (e as any).toAgentId ?? (e as any).id) : undefined));
            if (ids.every((x) => typeof x === 'string') && new Set(ids).size === ids.length && ids.filter((x) => rating.has(x)).length >= 2) out[`${route} ${path}`] = ids;
            v.forEach((e, i) => walk(e, `${path}[]`));
          } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
        };
        walk(body, '$');
      }
      return out;
    };
    const before = lists(bodies.filter(([r]) => sweep.some((u) => r === `GET ${u}`)));
    expect(Object.keys(before).length, 'the sweep has lists of rated agents').toBeGreaterThanOrEqual(2);
    const first = new Map(rating);
    for (let i = 0; i < rated.length; i++) await outcomes(m, rated[i], Math.round(40 * (1 - passes![i] / 10)), 40, 'coding', 3, 'flip' + i);
    for (const ag of rated) rating.set(ag.agent_id, (await A.admin.req('GET', `/agents/${ag.agent_id}/skills`)).body.skills.classes.find((x: any) => x.classId === 'coding').adjusted.value);
    const ids = rated.map((r) => r.agent_id);
    const flipped = ids.every((a, i) => ids.slice(i + 1).every((b) => (first.get(a)! - first.get(b)!) * (rating.get(a)! - rating.get(b)!) < 0));
    expect(flipped, 'every pair of ratings changed order').toBe(true);
    const bodies2: [string, any][] = [];
    for (const url of sweep) { const r = await A.admin.req('GET', url); expect(r.status, url).toBe(200); bodies2.push([`GET ${url}`, r.body]); }
    expect(lists(bodies2)).toEqual(before);
    expect(bodies.some(([r]) => r === 'GET /agents')).toBe(true);
    expect(bodies.map(([r]) => r).sort()).toEqual([...sweep.map((u) => `GET ${u}`), ...rated.flatMap((ag) => [`GET /agents/${ag.agent_id}`, `GET /agents/${ag.agent_id}/skills`, `GET /agents/${ag.agent_id}/skills/compare?with=${rated.find((r) => r !== ag)!.agent_id}`])].sort());
  });

  it('RED proof: a route that returns the same agents sorted by rating is caught by the same scan', async () => {
    const { A, m, inst } = await fixture();
    const rated = inst.slice(0, 4);
    const passes = [9, 7, 5, 3];
    for (let i = 0; i < rated.length; i++) await outcomes(m, rated[i], passes[i], 10, 'coding', 3, 'p' + i);
    const rating = new Map<string, number>();
    for (const ag of rated) rating.set(ag.agent_id, (await A.admin.req('GET', `/agents/${ag.agent_id}/skills`)).body.skills.classes.find((x: any) => x.classId === 'coding').adjusted.value);
    const sorted = [...rating].sort((a, b) => b[1] - a[1]).map(([id]) => ({ id }));
    expect(ratingOrderProblems(sorted.map((x) => x.id), rating, 'GET /zz-leaders')[0]).toMatch(/GET \/zz-leaders: .*ordered by a rating/);
    expect(rankingKeyProblems({ leaders: sorted.map((x, i) => ({ ...x, rank: i + 1 })) }, 'GET /zz-leaders').join()).toContain('rank');
  });
});

describe('source: no sort of skill code mentions a rating, and the compare payload has no direction', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f === 'node_modules' ? [] : walk(join(d, f))) : /\.(ts|tsx)$/.test(f) ? [join(d, f)] : []));
  const root = join(__dirname, '../..');
  const skillFiles = [
    join(root, 'server/src/agents/skills.ts'), join(root, 'shared/contracts/src/skills.ts'),
    ...walk(join(root, 'web/src')).filter((f) => /[Ss]kill/.test(f)),
  ];
  it('the skill files exist; no sort anywhere in server/src, web/src or shared/contracts/src mentions a rating (allowlist entries carry a reason), and skill-importing files have no unreviewed sort', () => {
    expect(skillFiles.map((f) => f.replace(root, "")).sort()).toEqual(["/server/src/agents/skills.ts", "/shared/contracts/src/skills.ts", "/web/src/api/agentSkills.ts", "/web/src/data/skillDemo.ts", "/web/src/features/agents/SkillVector.tsx", "/web/src/help/pages/c72-skills.ts"]);
    expect(sortScan(root)).toEqual([]);
    expect(skillFileSorts(root)).toEqual([]);
  });
  it('the compare route is declared with a fixed class order (the classes come from TASK_CLASS_IDS, never from a sort of values)', () => {
    const src = readFileSync(join(root, 'server/src/agents/skills.ts'), 'utf8');
    expect(src).toMatch(/TASK_CLASS_IDS\.filter/);
    expect(TASK_CLASS_IDS.length).toBeGreaterThan(5);
  });
});
