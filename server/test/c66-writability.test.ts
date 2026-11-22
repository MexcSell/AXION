import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { INPUT_FIELDS, INPUT_FIELD_IDS, WRITE_SITES, ROUTE_NO_INPUT, writabilityOf, type WriteSite } from '../../shared/contracts/src/index.ts';
import { writeRoutes, routeWriteProblems, scanWrites, declaredWrites, siteProblems } from './contracts/writability.ts';

/**
 * Improvement cycle 66, item 2: the writability inventory (shared/contracts/src/metric-guard.ts), tested against the route table
 * and against the source. A new write route, or a new write to a table a scorecard, KPI or dimension row reads, fails here until
 * somebody classifies who can reach it.
 */
describe('writability inventory vs the route table', () => {
  it('every non-GET route is classified exactly once, and every classified route is registered', async () => {
    const t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
    try {
      const routes = writeRoutes(t.app.routeTable);
      expect(routes.length, 'the route table was read').toBeGreaterThan(40);
      expect(routeWriteProblems(routes)).toEqual([]);
    } finally { await t.close(); }
  });

  it('RED proof: a new write route is reported until classified; a stale or double classification too', async () => {
    const t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, configure: (app: any) => { app.post('/api/v1/zz-score-writer', async () => ({ ok: true })); } });
    try {
      const routes = writeRoutes(t.app.routeTable);
      expect(routes).toContain('POST /zz-score-writer');
      expect(routeWriteProblems(routes)).toEqual([expect.stringContaining('POST /zz-score-writer: a write route with no classification')]);
      expect(routeWriteProblems(routes.filter((r) => r !== 'POST /me/password'), WRITE_SITES, { ...ROUTE_NO_INPUT, 'POST /zz-score-writer': 'writes a record that no row reads at all, said here' }).join('\n')).toContain('POST /me/password: classified but no such write route is registered');
      expect(routeWriteProblems(['POST /me/password'], WRITE_SITES, { 'POST /me/password': 'too short' }).join('\n')).toContain('needs a real reason');
      expect(routeWriteProblems(['POST /failure-tags'], WRITE_SITES, { 'POST /failure-tags': 'writes nothing a row reads, which is wrong here' }).join('\n')).toContain('both as reaching an input site and as touching no input');
    } finally { await t.close(); }
  });
});

describe('writability inventory vs the source', () => {
  it('every insert/update/delete on an input table (and every state-change or rollback emit) is a declared site, and no site is stale', () => {
    expect(siteProblems(scanWrites(), declaredWrites())).toEqual([]);
  });

  it('RED proof: an undeclared writer, a stale declaration and a missing function are each reported', () => {
    const found = scanWrites();
    const extra = new Set([...found, 'zz/new-writer.ts|tasks']);
    expect(siteProblems(extra, declaredWrites()).join('\n')).toContain('zz/new-writer.ts writes tasks, an input of a scorecard, KPI or dimension row, but no site');
    const stale = new Set([...found].filter((f) => f !== 'tasks/reviews.ts|task_reviews'));
    expect(siteProblems(stale, declaredWrites()).join('\n')).toContain('tasks/reviews.ts is declared as a writer of task_reviews but the source no longer writes it');
    const bad: Record<string, WriteSite> = { ...WRITE_SITES, ghost: { ...WRITE_SITES.recordReview, fn: 'noSuchFn' } };
    expect(siteProblems(found, declaredWrites(bad), bad).join('\n')).toContain('exports no function noSuchFn');
  });

  it('every site names fields that exist, and every input field has a reason to exist (a writer, or a stated absence)', () => {
    for (const [id, s] of Object.entries(WRITE_SITES)) for (const w of s.writes) expect(INPUT_FIELD_IDS, `${id} writes ${w}`).toContain(w);
    const written = new Set(Object.values(WRITE_SITES).flatMap((s) => s.writes));
    // eval_runs has no writer in server/src on purpose (c53: no run-write route); the scan above fails if one appears
    expect(INPUT_FIELD_IDS.filter((f) => !written.has(f))).toEqual(['eval_runs.results']);
  });
});

describe('writabilityOf (threshold b: a row fed by an agent-writable field is flagged in 100% of cases)', () => {
  it('is derived from the sites: every field with an agent site flags a one-input row, every other field does not', () => {
    const agentFields = new Set(Object.values(WRITE_SITES).filter((s) => s.kinds.includes('agent')).flatMap((s) => s.writes));
    expect(agentFields.size).toBeGreaterThan(5);
    let flagged = 0;
    for (const f of INPUT_FIELD_IDS) {
      const w = writabilityOf([f]);
      expect(w.agentWritable, f).toBe(agentFields.has(f));
      if (agentFields.has(f)) { flagged++; expect(w.agentSites.length, f).toBeGreaterThan(0); }
    }
    expect(flagged).toBe(agentFields.size); // 100%
  });

  it('on a fixture inventory: one agent site makes any row that reads its field gameable, and adding an unrelated human site changes nothing', () => {
    const site = (kinds: WriteSite['kinds'], writes: WriteSite['writes']): WriteSite => ({ file: 'x.ts', fn: 'f', kinds, routes: [], writes, note: 'a fixture site for the test' });
    const fx = { a: site(['agent'], ['tasks.status']), b: site(['human'], ['tasks.owner']) };
    expect(writabilityOf(['tasks.status'], fx).agentWritable).toBe(true);
    expect(writabilityOf(['tasks.owner'], fx).agentWritable).toBe(false);
    expect(writabilityOf(['tasks.owner', 'tasks.status'], fx).agentWritable).toBe(true);
    expect(writabilityOf([], fx)).toEqual({ agentWritable: false, kinds: [], agentSites: [] });
    expect(writabilityOf(['tasks.status'], { ...fx, c: site(['human'], ['tasks.status']) }).kinds).toEqual(['agent', 'human']);
  });

  it('what the code permits today: reviews, tags, lessons, approval requests, briefs and instances are agent-reachable; decisions, grants and catalogue edits are not', () => {
    for (const f of ['task_reviews.review', 'failure_tags.mode', 'lesson_candidates.status', 'approval_requests.record', 'delegation_briefs.brief', 'agent_instances.assignment', 'mission_delegations.edge'] as const) expect(writabilityOf([f]).agentWritable, f).toBe(true);
    for (const f of ['approval_decisions.decision', 'failure_tags.status', 'site_grants.window', 'agent_definitions.catalog', 'tasks.status', 'mission_runs.started', 'org_revisions.lines'] as const) expect(writabilityOf([f]).agentWritable, f).toBe(false);
    void INPUT_FIELDS;
  });
});
