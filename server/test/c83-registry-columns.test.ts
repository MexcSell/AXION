import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeSchema } from './helpers.ts';
import { METRICS, INPUT_FIELDS, CONTEXT_READS, LOADER_EXTRA, NON_METRIC_COMPANY_FILES } from '../../shared/contracts/src/index.ts';
import { columnProblems, companyFiles, fragmentProblems, statements, reads, FRAGMENT_FILES, type ColumnSetup, type SchemaCols } from './contracts/columns.ts';

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
