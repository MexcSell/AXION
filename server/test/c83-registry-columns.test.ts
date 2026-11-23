import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeSchema } from './helpers.ts';
import { METRICS, INPUT_FIELDS, CONTEXT_READS, LOADER_EXTRA, NON_METRIC_COMPANY_FILES } from '../../shared/contracts/src/index.ts';
import { columnProblems, companyFiles, fragmentProblems, statements, reads, FRAGMENT_FILES, planUnitProblems, PLAN_FILE, SCAN_EXCLUSIONS, type ColumnSetup, type SchemaCols } from './contracts/columns.ts';
import { PLAN_UNIT_READS, UNITS } from '../src/organization/plan-metrics.ts';

/**
 * c83 item 3: the registry loader test, at column level and for every company loader. It is generated from the source: every file under
 * server/src/company/ is scanned, plus every loader a registry row names (metric-reads.ts); a new file, statement or column cannot go uncovered.
 *
 * What it proves: every column a loader's SQL reads is declared by a row that names that loader (or is a context column, a keyed
 * exception with a reason), and every column a row declares is really read by one of its loaders. The unit is the loader file (or function), not
 * the row: two rows that share a loader share its columns, so which of them uses a column is a reviewed declaration, not a machine proof.
 * Limits: SQL assembled by concatenation or built at run time is not seen (a template expression that is not a known fragment is reported);
 * a helper that returns rows from another file is covered only when a row names that file as a loader.
 */
let cols: SchemaCols;
let drop: () => Promise<void>;
beforeAll(async () => {
  const s = await makeSchema();
  drop = () => s.drop();
  cols = {};
  for (const r of (await s.pool.query(`select table_name, column_name from information_schema.columns where table_schema = current_schema()`)).rows) (cols[r.table_name] ??= []).push(r.column_name);
});
afterAll(async () => { await drop?.(); });

const setup = (over: Partial<ColumnSetup> = {}): ColumnSetup => ({
  metrics: METRICS, context: CONTEXT_READS, extra: LOADER_EXTRA, nonMetric: NON_METRIC_COMPANY_FILES,
  fieldTables: Object.fromEntries(Object.entries(INPUT_FIELDS).map(([k, f]) => [k, f.tables])), ...over,
});

describe('registry loader coverage at column level', () => {
  it('every company loader is scanned, and every column read is declared and every declared column is read', () => {
    expect(columnProblems(setup(), cols)).toEqual([]);
  });

  it('the scan really finds the loaders: it reads the files the old table-level test read, and every other company file with SQL is named', () => {
    const withSql = companyFiles().filter((f) => !FRAGMENT_FILES.includes(f) && statements(f).length > 0);
    expect(withSql).toEqual(expect.arrayContaining(['company/routes.ts', 'company/dimensions-routes.ts', 'company/departments.ts', 'company/process-routes.ts', 'company/metric-guard-routes.ts']));
    for (const f of withSql) expect(METRICS.some((m) => m.loaders.some((l) => l.split('#')[0] === f)) || f in NON_METRIC_COMPANY_FILES, f).toBe(true);
    expect(fragmentProblems()).toEqual([]);
    const all = new Set(withSql.flatMap((f) => [...statements(f).flatMap((s) => [...reads(s.sql, cols).reads])]));
    expect(all.size, 'the scan found a realistic number of columns').toBeGreaterThan(100);
  });

  it('RED proof 1: an undeclared column read injected into a loader is reported', () => {
    const rel = 'company/routes.ts';
    const text = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src', rel), 'utf8') as string;
    const injected = text.replace("select mission_id, min(started_at) as started_at from mission_runs", "select mission_id, min(started_at) as started_at, 0 as x from mission_runs join tasks zt on zt.mission_id = mission_runs.mission_id and zt.title is not null");
    expect(injected).not.toBe(text);
    const p = columnProblems(setup(), cols, { [rel]: injected });
    expect(p).toEqual([expect.stringContaining('company/routes.ts: reads tasks.title, but no row that names this loader declares it')]);
  });

  it('RED proof 2: a new company file with SQL that no row names, and one with an unknown template expression, are reported', () => {
    const p = columnProblems(setup(), cols, { 'company/zz-new-loader.ts': 'export const q = `select t.status from tasks t where t.tenant_id=$1`;' });
    expect(p).toEqual([expect.stringContaining('company/zz-new-loader.ts: runs SQL but no registry row names it')]);
    const q = columnProblems(setup({ metrics: METRICS.map((m) => (m.id === 'scorecard.started' ? { ...m, loaders: [...m.loaders, 'company/zz-new-loader.ts'] } : m)) }), cols,
      { 'company/zz-new-loader.ts': 'export const q = (x: string) => `select t.status from tasks t where ${x}`;' });
    expect(q.join('\n')).toContain('unresolved SQL');
  });

  it('RED proof 3: a column a row declares but no loader reads, a column that is not in the schema, and a row with a loader but no column are reported', () => {
    const p = columnProblems(setup({ metrics: METRICS.map((m) => (m.id === 'scorecard.started' ? { ...m, reads: [...m.reads, 'tasks.title', 'tasks.nope'] } : m)) }), cols);
    expect(p).toEqual(expect.arrayContaining([
      expect.stringContaining('scorecard.started: declares tasks.title, which none of its loaders'),
      expect.stringContaining('scorecard.started: declares tasks.nope, which is not a column of the schema'),
    ]));
    const q = columnProblems(setup({ metrics: METRICS.map((m) => (m.id === 'scorecard.started' ? { ...m, reads: [] } : m)) }), cols);
    expect(q.join('\n')).toContain('scorecard.started: has inputs but declares no loader or no column');
  });

  it('the scanner reads real SQL: aliases, bare columns, a star, casts with spaces, and fragment expansion', () => {
    const c: SchemaCols = { tasks: ['id', 'status', 'title', 'mission_id'], missions: ['id', 'status', 'demo'], task_reviews: ['id', 'task_id', 'verdict', 'created_at', 'attempt_id'], task_attempts: ['id', 'task_id', 'attempt_no', 'started_at'] };
    expect([...reads(`select t.id, title as s, m.* from tasks t join missions m on m.id = t.mission_id where t.status = 'status' and m.demo::double precision > 0`, c).reads].sort())
      .toEqual(['missions.*', 'tasks.id', 'tasks.status', 'tasks.title', 'tasks.mission_id', 'missions.demo', 'missions.id'].sort());
    // a table without an alias followed by a join is still two tables
    expect([...reads('select x.verdict, y.attempt_no from task_reviews x join task_attempts y on y.task_id = x.task_id', c).tables].sort()).toEqual(['task_attempts', 'task_reviews']);
    const st = statements('x.ts', "export const f = (r: string) => `select 1 from task_reviews r ${STALE_JOINS('r')} where ${STALE_FLAG('r')}`;")[0];
    expect([...reads(st.sql, c).reads].sort()).toEqual(['task_attempts.attempt_no', 'task_attempts.id', 'task_attempts.started_at', 'task_attempts.task_id', 'task_reviews.attempt_id', 'task_reviews.created_at', 'task_reviews.task_id'].sort());
  });

  it('RED proof (review finding 1): comma joins and schema-qualified tables are read, and an entry that resolves to nothing is an error', () => {
    const c: SchemaCols = { tasks: ['id', 'status', 'title'], task_reviews: ['id', 'verdict', 'task_id'] };
    expect([...reads('select t.id from tasks t, task_reviews r where r.verdict = 1', c).reads].sort()).toEqual(['task_reviews.verdict', 'tasks.id']);
    expect([...reads('select t.title from public.tasks t where t.status = 1', c).reads].sort()).toEqual(['tasks.status', 'tasks.title']);
    expect([...reads('select a.id from tasks a join "public"."task_reviews" b on b.task_id = a.id, tasks z', c).tables].sort()).toEqual(['task_reviews', 'tasks']);
    expect(reads('select x.id from nosuch x where x.id = 1', c).unresolved).toEqual(['nosuch']);
    expect(reads('select x.id from other.nosuch x', c).unresolved).toEqual(['other.nosuch']);
    expect(reads('with w as (select id from tasks) select w.id from w, unnest($1::text[]) u', c).unresolved).toEqual([]);
    // an unresolved entry in a loader fails the column test
    const p = columnProblems(setup(), cols, { 'company/routes.ts': require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/company/routes.ts'), 'utf8').replace('from mission_runs where', 'from mission_runs, zz_not_a_table where') });
    expect(p.join('\n')).toContain('unresolved SQL: FROM/JOIN entry zz_not_a_table');
  });
});

/**
 * c88 (M2d): the scan covers organization/plan-metrics.ts too (c85's observation counts, one SQL unit per registry metric). Its units are declared in
 * PLAN_UNIT_READS next to the SQL. EXCLUDED on purpose: server/src/forecasts/ (c86), because the forecast ledger is not a registry metric (see SCAN_EXCLUSIONS).
 */
describe('c88: plan-metrics.ts is in the scan; forecasts/ is an explicit exclusion', () => {
  const run = (src: Record<string, string> = {}, declared: Record<string, readonly string[]> = PLAN_UNIT_READS) => planUnitProblems(cols, declared, UNITS, CONTEXT_READS, src);
  const source = () => require('node:fs').readFileSync(require('node:path').join(__dirname, '../src', PLAN_FILE), 'utf8') as string;

  it('every unit and helper of plan-metrics.ts reads only declared columns, and declares only what it reads', () => {
    expect(run()).toEqual([]);
  });

  it('RED proof: an undeclared column read injected into one unit is reported, naming the unit and the column', () => {
    const text = source();
    const injected = text.replace("select l.created_at as ts from lesson_candidates l where l.tenant_id = $1`", "select l.created_at as ts from lesson_candidates l where l.tenant_id = $1 and l.agent_id is not null`");
    expect(injected).not.toBe(text);
    expect(run({ [PLAN_FILE]: injected })).toEqual([expect.stringContaining('unit:lesson_proposed reads lesson_candidates.agent_id, but PLAN_UNIT_READS does not declare it')]);
  });

  it('RED proof: a new unit with no declaration, a declared column nothing reads, and SQL outside any unit are reported', () => {
    const text = source();
    const added = text.replace("  playbook: unit('playbook'", "  zz: unit('zz', 'x', ['tasks'], [], `select t.created_at as ts from tasks t where t.tenant_id = $1`),\n  playbook: unit('playbook'");
    expect(added).not.toBe(text);
    expect(run({ [PLAN_FILE]: added }).join('\n')).toContain('SQL in "unit:zz" has no entry in PLAN_UNIT_READS');
    expect(run({}, { ...PLAN_UNIT_READS, 'unit:run': [...PLAN_UNIT_READS['unit:run'], 'mission_runs.ended_at'] })).toEqual([expect.stringContaining('unit:run declares mission_runs.ended_at, which its SQL does not read')]);
    const free = run({ [PLAN_FILE]: text + "\nexport const zzFree = `select count(*) from tasks t where t.title = 'x'`;" });
    expect(free.join('\n')).toContain('countObservations reads tasks.title, but PLAN_UNIT_READS does not declare it'); // SQL added at the end of the file belongs to the last function, which is checked too
  });

  it('forecasts/ is excluded on purpose: it exists, it is named with its reason, and no registry row names a loader there', () => {
    const fs = require('node:fs') as typeof import('node:fs'); const path = require('node:path') as typeof import('node:path');
    for (const [dir, why] of Object.entries(SCAN_EXCLUSIONS)) {
      expect(fs.existsSync(path.join(__dirname, '../src', dir)), dir).toBe(true);
      expect(why.length).toBeGreaterThan(20);
      expect(METRICS.some((m) => m.loaders.some((l) => l.startsWith(dir))), dir).toBe(false);
    }
    expect(Object.keys(SCAN_EXCLUSIONS)).toEqual(['forecasts/']);
  });
});

describe('c92 M2c-1: the scanner and FROM lists', () => {
  const c: SchemaCols = { tasks: ['id', 'status', 'title', 'created_at'], task_reviews: ['id', 'verdict', 'task_id'] };
  it('a sub-select, lateral or function in a FROM list does not hide the entries after it', () => {
    const r1 = reads('select x.n, t.title from (select count(*) as n from task_reviews) x, tasks t where t.status = 1', c);
    expect([...r1.tables].sort()).toEqual(['task_reviews', 'tasks']);
    expect([...r1.reads]).toEqual(expect.arrayContaining(['tasks.title', 'tasks.status']));
    expect(r1.unresolved).toEqual([]);
    expect([...reads('select t.id from tasks t, lateral (select 1 as k) l, task_reviews r where r.verdict = 1', c).tables].sort()).toEqual(['task_reviews', 'tasks']);
    expect([...reads('select u.v, t.id from unnest($1::text[]) u(v), tasks t', c).tables]).toEqual(['tasks']);
  });
  it('extract(epoch from col), substring(.. from ..) and trim(.. from ..) are not FROM lists (no false unresolved)', () => {
    const r2 = reads('select extract(epoch from t.created_at) as e, extract(epoch from (now() - created_at)) from tasks t', c);
    expect(r2.unresolved).toEqual([]);
    expect([...r2.reads]).toEqual(['tasks.created_at']);
    expect(reads(`select substring(t.title from 2), trim(both ' ' from t.title) from tasks t`, c).unresolved).toEqual([]);
  });
  it('fail-closed is kept: an unknown table is still unresolved after a sub-select, inside an extract sub-select and beside an extract', () => {
    expect(reads('select 1 from (select 1) x, nosuch n', c).unresolved).toEqual(['nosuch']);
    expect(reads('select extract(epoch from (select max(z.q) from nosuch z))', c).unresolved).toEqual(['nosuch']);
    expect(reads('select 1 from tasks t, nosuch n where extract(epoch from t.created_at) > 0', c).unresolved).toEqual(['nosuch']);
  });
});
