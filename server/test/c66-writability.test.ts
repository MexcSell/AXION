import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { INPUT_FIELDS, INPUT_FIELD_IDS, HELPER_CALLERS, WRITE_SITES, ROUTE_NO_INPUT, writabilityOf, type WriteSite } from '../../shared/contracts/src/index.ts';
import { writeRoutes, routeWriteProblems, scanWrites, declaredWrites, siteProblems, scanCallers, callerProblems } from './contracts/writability.ts';

/**
 * Improvement cycle 66, item 2: the writability inventory (shared/contracts/src/metric-guard.ts), tested against the route table
 * and against the source. A new write route, or a new write to a table a scorecard, KPI or dimension row reads, fails here until
 * somebody classifies who can reach it.
 *
 * What the SCAN cannot see (stated limits, so nobody reads a green run as more than it is): SQL comments placed between keywords
 * (a block comment between `insert` and `into`), SQL built by string concatenation, `.sql` files read at runtime, namespace imports (`import * as m`),
 * re-exports, dynamic imports, and edits inside `instances/service.ts` (one file holds several helpers, so the caller scan classifies the
 * file, not the function). It is a net for the usual shapes of a write, not a proof that no other write exists.
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

/**
 * LIMITS of the source scan (also in the c66 report): it reads literal SQL in server/src only. It sees `insert into|update [only]|delete from|merge into|truncate|copy`
 * on a bare, schema-qualified or quoted input table, and fails closed on a templated table name (`${...}`), which is unknown. It does NOT see: SQL outside
 * server/src (scripts, migrations), triggers and foreign-key cascades (checked by hand: none writes an input table; DELETE /missions/:id and clearDemo cascade, both
 * human or system), columns (a new column written by an agent site on a declared table is invisible), or what a helper's caller passes. The caller scan below covers the
 * helpers by name: a new file importing one must be declared. Which kinds reach a site is typed by hand in WRITE_SITES, checked against the code by review.
 */
describe('the source scan reads every spelling of a write (S1)', () => {
  const src = (text: string) => [{ rel: 'zz/probe.ts', text }];
  const found = (text: string) => [...scanWrites(INPUT_FIELDS, src(text))];
  it('finds schema-qualified, quoted, only, merge, truncate, copy and multi-line forms', () => {
    for (const q of ['insert into public.task_reviews (a) values (1)', 'update "tasks" set x=1', 'update only tasks set x=1', 'merge into tasks t using x', 'truncate tasks', 'truncate table only tasks',
      'copy tasks from stdin', 'INSERT INTO\n  tasks (a)', 'delete from public."tasks" where 1=1', 'update  tasks set a=1'])
      expect(found('await c.query(`' + q + '`)'), q).toEqual([expect.stringMatching(/^zz\/probe\.ts\|(tasks|task_reviews)$/)]);
  });
  it('fails closed on a templated table name: unknown, so it must be declared', () => {
    expect(found('await c.query(`insert into ${tbl} (a) values (1)`)')).toEqual(['zz/probe.ts|${templated}']);
    expect(found('await c.query(`update public.${tbl} set a=1`)')).toEqual(['zz/probe.ts|${templated}']);
    expect(siteProblems(new Set(['zz/probe.ts|${templated}']), declaredWrites()).join('\n')).toContain('zz/probe.ts writes ${templated}');
  });
  it('does not report tables that are not inputs', () => {
    expect(found('await c.query(`insert into users (a) values (1)`)')).toEqual([]);
  });
});

describe('every importer of an exported write helper is a declared caller (S1)', () => {
  it('the importers in server/src equal the declared callers, helper by helper', () => {
    expect(callerProblems(scanCallers(), HELPER_CALLERS)).toEqual([]);
  });
  it('RED proof: a new file that calls insertDelegation, a stale caller and an unknown helper are each reported', () => {
    const now = scanCallers();
    const fake = { ...now, insertDelegation: [...now.insertDelegation, 'zz/new-agent-caller.ts'] };
    expect(callerProblems(fake, HELPER_CALLERS).join('\n')).toContain('zz/new-agent-caller.ts imports insertDelegation');
    expect(callerProblems(now, { ...HELPER_CALLERS, insertDelegation: [...HELPER_CALLERS.insertDelegation, 'gone.ts'] }).join('\n')).toContain('gone.ts is declared as a caller of insertDelegation but no longer imports it');
    expect(callerProblems({ ...now, zzHelper: ['a.ts'] }, HELPER_CALLERS).join('\n')).toContain('zzHelper');
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
    // every input field has a declared writer. eval_runs.results had none when c66 was written ("the scan above fails if one appears"); c53's startRun
    // appeared, the scan failed, and it is now declared as a system site (not called by any server code yet).
    expect(INPUT_FIELD_IDS.filter((f) => !written.has(f))).toEqual([]);
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
    for (const f of ['task_reviews.review', 'failure_tags.mode', 'lesson_candidates.status', 'approval_requests.record', 'delegation_briefs.brief', 'agent_instances.assignment', 'mission_delegations.delegated_edge'] as const) expect(writabilityOf([f]).agentWritable, f).toBe(true);
    for (const f of ['approval_decisions.decision', 'failure_tags.status', 'site_grants.window', 'agent_definitions.catalog', 'tasks.status', 'mission_runs.started', 'org_revisions.lines', 'mission_delegations.verifies_edge'] as const) expect(writabilityOf([f]).agentWritable, f).toBe(false);
    void INPUT_FIELDS;
  });
});
