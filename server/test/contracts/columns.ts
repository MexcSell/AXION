import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STALE_JOINS, STALE_FLAG, STALE_BEFORE_SQL } from '../../src/company/stale.ts';
import { sqlInWindow } from '../../src/company/clock.ts';
import { VISIBLE_SQL } from '../../src/missions/visibility.ts';
import { SELECT_MISSION } from '../../src/missions/service.ts';
import { REPEAT_EXEMPT_MAX_LEN } from '../../src/evolution/proposal-evidence.ts';

/**
 * c83 item 3: the column-level scan of the SQL a metric loader runs. Everything here is generated from the source text, so a new loader file, a
 * new statement or a new column read cannot go uncovered.
 *
 * How a column read is found, for each `select` statement of a source file:
 *  1. the SQL is cut out of its string literal (template, single or double quotes; comments skipped), with `${...}` expressions expanded from the REAL
 *     fragment functions and constants (FRAGMENTS below) or from a `const NAME = \`...\`` of the same file. An expression that cannot be resolved is
 *     reported, never guessed;
 *  2. `from|join <table> [as] <alias>` gives the alias map (real tables only, taken from the migrated schema);
 *  3. `alias.column` is a read of that table; `alias.*` or a bare `*` select is `table.*` (all columns);
 *  4. a bare word that is a column of one of the statement's tables is a read of it (SQL refuses an ambiguous bare name, so this is exact except for
 *     output aliases and derived-table columns, which can only add a column that the table really has: it over-reports, it never misses).
 * c88: organization/plan-metrics.ts is scanned too (planUnitProblems, units declared in PLAN_UNIT_READS). EXCLUDED on purpose: server/src/forecasts/ is not a
 * registry metric (the forecast ledger; see SCAN_EXCLUSIONS).
 * Limits: the statement must be a string literal that contains `select` and `from`; SQL assembled by concatenation or built at run time is not seen
 * (the unresolved-expression check catches the template forms); a column named like a function or keyword is skipped. See the test header.
 */
export type SchemaCols = Record<string, string[]>;
const SRC = join(__dirname, '../../src');

export const FRAGMENTS: Record<string, (...a: string[]) => string> = {
  STALE_JOINS, STALE_FLAG, STALE_BEFORE_SQL, VISIBLE_SQL, sqlInWindow,
  SELECT_MISSION: () => SELECT_MISSION,
  REPEAT_EXEMPT_MAX_LEN: () => String(REPEAT_EXEMPT_MAX_LEN),
};

export interface Literal { text: string; exprs: string[]; offset: number }
/** All string literals of a TypeScript source, with their `${}` expressions cut out (text holds \u0001<n>\u0001 in their place). */
export function literals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  const scanTemplate = (start: number): { end: number; text: string; exprs: string[] } => {
    let j = start + 1, text = '';
    const exprs: string[] = [];
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') { text += src[j + 1]; j += 2; continue; }
      if (src[j] === '$' && src[j + 1] === '{') {
        let depth = 1, k = j + 2;
        while (k < src.length && depth > 0) {
          if (src[k] === '`') { const inner = scanTemplate(k); k = inner.end + 1; continue; }
          if (src[k] === "'" || src[k] === '"') { const q = src[k]; k++; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k++; k++; } k++; continue; }
          if (src[k] === '{') depth++; else if (src[k] === '}') depth--;
          k++;
        }
        exprs.push(src.slice(j + 2, k - 1));
        text += `\u0001${exprs.length - 1}\u0001`;
        j = k;
        continue;
      }
      text += src[j++];
    }
    return { end: j, text, exprs };
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '`') { const t = scanTemplate(i); out.push({ text: t.text, exprs: t.exprs, offset: i }); i = t.end + 1; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, text = '';
      while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { text += src[j + 1]; j += 2; continue; } text += src[j++]; }
      out.push({ text, exprs: [], offset: i }); i = j + 1; continue;
    }
    i++;
  }
  return out;
}

const splitArgs = (a: string): string[] | null => {
  const out: string[] = [];
  for (const p of a.split(',')) { const m = /^\s*(?:'([^']*)'|"([^"]*)")\s*$/.exec(p); if (!m) return null; out.push(m[1] ?? m[2]); }
  return out;
};

/** The label of the enclosing function or route (`listVisible`, `GET /approvals`) for a statement at `offset`, or '' at the top level. */
export function enclosing(src: string, offset: number): string {
  let label = '';
  for (const m of src.slice(0, offset).matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|app\.(get|post|put|patch|delete)\(\s*'([^']+)'|\bunit\(\s*'(\w+)'/g)) label = m[4] ? `unit:${m[4]}` : (m[1] ?? `${m[2].toUpperCase()} ${m[3]}`);
  return label;
}

export interface Statement { file: string; scope: string; sql: string; unresolved: string[] }
export function statements(rel: string, src = readFileSync(join(SRC, rel), 'utf8')): Statement[] {
  const lits = literals(src);
  const consts = new Map<string, Literal>();
  for (const l of lits) { const m = /(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*$/.exec(src.slice(Math.max(0, l.offset - 80), l.offset)); if (m) consts.set(m[1], l); }
  const expand = (l: Literal, depth = 0): { sql: string; unresolved: string[] } => {
    const unresolved: string[] = [];
    const sql = l.text.replace(/\u0001(\d+)\u0001/g, (_, n) => {
      const e = l.exprs[Number(n)].trim();
      const call = /^(\w+)\s*\(([\s\S]*)\)$/.exec(e);
      if (call && FRAGMENTS[call[1]]) { const a = splitArgs(call[2]); if (a) return FRAGMENTS[call[1]](...a); }
      if (/^\w+$/.test(e) && FRAGMENTS[e]) return FRAGMENTS[e]();
      if (/^\w+$/.test(e) && consts.has(e) && depth < 4) { const r = expand(consts.get(e)!, depth + 1); unresolved.push(...r.unresolved); return r.sql; }
      unresolved.push(e);
      return ' ?? ';
    });
    return { sql, unresolved };
  };
  const out: Statement[] = [];
  for (const l of lits) {
    if (/^\s*(?:insert|update|delete)\b/i.test(l.text)) continue;
    const { sql, unresolved } = expand(l);
    if (!/\bselect\b[\s\S]*\bfrom\b/i.test(sql) || !/^\s*(?:select|with|\()/i.test(sql)) continue; // a statement starts with select / with / a parenthesised select
    out.push({ file: rel, scope: enclosing(src, l.offset), sql, unresolved });
  }
  return out;
}

const KW = new Set('select from where and or not on join left right inner outer full cross lateral using group by order limit offset as in is null true false case when then else end distinct all any exists between like ilike union except intersect with over partition having asc desc interval epoch cast filter within coalesce'.split(' '));

/** `table.column` and `table.*` reads of one statement. */
export function reads(sql: string, cols: SchemaCols): { reads: Set<string>; tables: Set<string>; unresolved: string[] } {
  let s = sql.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''").replace(/::(?:double\s+precision|[a-z_][a-z0-9_]*)(?:\[\])?/gi, ' ').replace(/\$\d+/g, ' ');
  const alias = new Map<string, Set<string>>();
  const tables = new Set<string>();
  // c83 fix round: FROM and JOIN lists, with comma joins and schema-qualified names. An entry that is not a known table, a CTE, a function call or a
  // sub-select is UNRESOLVED and reported (the scanner fails closed instead of skipping it).
  const unresolved: string[] = [];
  const ctes = new Set([...s.matchAll(/(?:\bwith|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const entry = /\s*(?:only\s+)?(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)(?![a-z0-9_])"?(?!\s*\()(?:\s+(?:as\s+)?(?!(?:where|on|join|left|right|inner|outer|full|cross|lateral|group|order|limit|using|natural|union|except|intersect|window|having|offset|for|returning|set)\b)([a-z_][a-z0-9_]*))?/iy;
  for (const m of s.matchAll(/\b(?:from|join)\b/gi)) {
    let pos = m.index! + m[0].length;
    for (;;) {
      entry.lastIndex = pos;
      const e = entry.exec(s);
      if (!e) break; // a sub-select, a function call or the end: nothing to resolve here
      pos = entry.lastIndex;
      const name = e[2].toLowerCase();
      if (cols[name]) {
        tables.add(name);
        const al = e[3] && !KW.has(e[3].toLowerCase()) ? e[3].toLowerCase() : name;
        for (const k of new Set([al, name])) alias.set(k, (alias.get(k) ?? new Set()).add(name));
      } else if (!ctes.has(name) && !/^(?:now|current_\w+|generate_series|unnest|lateral)$/.test(name)) unresolved.push(e[1] ? `${e[1]}.${e[2]}` : e[2]);
      const comma = /\s*,/y; comma.lastIndex = pos;
      if (!comma.exec(s)) break;
      pos = comma.lastIndex;
    }
  }
  const out = new Set<string>();
  const addQual = (a: string, c: string) => { for (const t of alias.get(a) ?? []) { if (c === '*') out.add(`${t}.*`); else if (cols[t].includes(c)) out.add(`${t}.${c}`); } };
  s = s.replace(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*|\*)/gi, (_, a: string, c: string) => { addQual(a.toLowerCase(), c.toLowerCase()); return ' '; });
  // a bare `select *` reads every column of every table of the statement; count(*) does not
  if (/\bselect\s+(?:distinct\s+)?\*/i.test(s)) for (const t of tables) out.add(`${t}.*`);
  s = s.replace(/\bas\s+[a-z_][a-z0-9_]*/gi, ' ');
  for (const m of s.matchAll(/\b([a-z_][a-z0-9_]*)\b(?!\s*\()/gi)) {
    const w = m[1].toLowerCase();
    if (KW.has(w)) continue;
    for (const t of tables) if (cols[t].includes(w)) out.add(`${t}.${w}`);
  }
  return { reads: out, tables, unresolved };
}

/** Reads of every statement of a source file, optionally limited to one enclosing function or route. */
export function fileReads(rel: string, cols: SchemaCols, scope?: string): { reads: Set<string>; statements: number; unresolved: string[] } {
  const all = statements(rel).filter((x) => !scope || x.scope === scope);
  const out = new Set<string>();
  for (const st of all) for (const r of reads(st.sql, cols).reads) out.add(r);
  return { reads: out, statements: all.length, unresolved: all.flatMap((x) => x.unresolved.map((e) => `${rel}${x.scope ? '#' + x.scope : ''}: \${${e}}`)) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The comparison with the registry (item 3).

/** Files that only define SQL fragments: their text is expanded, through FRAGMENTS, into every statement that uses it, so it is not scanned on its own. */
export const FRAGMENT_FILES = ['company/stale.ts', 'company/clock.ts'];

export function companyFiles(): string[] {
  return readdirSync(join(SRC, 'company')).filter((f) => f.endsWith('.ts')).map((f) => `company/${f}`).sort();
}
/** A fragment function exported by a fragment file that FRAGMENTS does not know would be skipped everywhere: list them. */
export function fragmentProblems(): string[] {
  const out: string[] = [];
  for (const f of FRAGMENT_FILES) for (const m of readFileSync(join(SRC, f), 'utf8').matchAll(/export const (\w+)\s*=\s*\(/g)) if (!FRAGMENTS[m[1]]) out.push(`${f}: exports ${m[1]}, a SQL fragment function that FRAGMENTS (server/test/contracts/columns.ts) does not expand`);
  return out;
}

const matches = (pattern: string, col: string) => pattern === col || (pattern.startsWith('*.') && col.endsWith(pattern.slice(1)));
const covers = (declared: Set<string>, col: string) => declared.has(col) || declared.has(`${col.split('.')[0]}.*`);

export interface ColumnSetup {
  metrics: readonly { id: string; inputs: readonly string[]; loaders: readonly string[]; reads: readonly string[] }[];
  context: readonly { column: string }[];
  extra: Record<string, { reads: string[] }>;
  nonMetric: Record<string, { reads: string[] }>;
  /** field id -> the tables a write to it goes through (INPUT_FIELDS), to tie a row's inputs to its columns */
  fieldTables: Record<string, readonly string[]>;
}

/**
 * What is wrong with the column declarations, compared with the SQL the loaders really run. `src` replaces or adds source text by path (used to inject a
 * read for the RED proof); everything else is read from server/src.
 */
export function columnProblems(setup: ColumnSetup, cols: SchemaCols, src: Record<string, string> = {}): string[] {
  const out: string[] = [];
  const text = (rel: string) => src[rel] ?? readFileSync(join(SRC, rel), 'utf8');
  const scan = new Map<string, { reads: Set<string>; statements: number; unresolved: string[] }>();
  const scanOf = (ref: string) => {
    if (!scan.has(ref)) {
      const [file, scope] = ref.split('#');
      const all = statements(file, text(file)).filter((x) => !scope || x.scope === scope);
      const reads_ = new Set<string>();
      const unres: string[] = [];
      for (const st of all) { const r = reads(st.sql, cols); for (const x of r.reads) reads_.add(x); unres.push(...r.unresolved.map((t) => `FROM/JOIN entry ${t} is not a known table, CTE, function or sub-select`)); }
      scan.set(ref, { reads: reads_, statements: all.length, unresolved: [...all.flatMap((x) => x.unresolved.map((e) => `\${${e}}`)), ...unres] });
    }
    return scan.get(ref)!;
  };
  const isContext = (c: string) => setup.context.some((x) => matches(x.column, c));
  const refs = new Map<string, Set<string>>(); // loader ref -> columns declared for it (rows + extra)
  const add = (ref: string, cs: readonly string[]) => { const s = refs.get(ref) ?? new Set<string>(); for (const c of cs) s.add(c); refs.set(ref, s); };

  for (const m of setup.metrics) {
    if (m.inputs.length === 0 && (m.loaders.length || m.reads.length)) out.push(`${m.id}: reads no input, so it names no loader and no column`);
    if (m.inputs.length > 0 && (!m.loaders.length || !m.reads.length)) out.push(`${m.id}: has inputs but declares no loader or no column (metric-reads.ts)`);
    for (const c of m.reads) {
      const [t, k] = c.split('.');
      if (!cols[t] || (k !== '*' && !cols[t].includes(k))) out.push(`${m.id}: declares ${c}, which is not a column of the schema`);
    }
    const tables = new Set(m.reads.map((c) => c.split('.')[0]));
    for (const f of m.inputs) { const ft = setup.fieldTables[f] ?? []; if (ft.length && !ft.some((t) => tables.has(t))) out.push(`${m.id}: input ${f} is stored in ${ft.join('/')}, but the row declares no column of it`); }
    for (const ref of m.loaders) add(ref, m.reads);
  }
  for (const [ref, e] of Object.entries(setup.extra)) add(ref, e.reads);
  for (const [file, e] of Object.entries(setup.nonMetric)) add(file, e.reads);

  // every company file that runs SQL is named by a row, or listed as a non-metric file
  for (const f of Object.keys(src).filter((k) => k.startsWith('company/')).concat(companyFiles()).filter((f, i, a) => a.indexOf(f) === i)) {
    if (FRAGMENT_FILES.includes(f)) continue;
    if (statements(f, text(f)).length === 0) continue;
    const named = setup.metrics.some((m) => m.loaders.some((l) => l.split('#')[0] === f)) || f in setup.nonMetric || Object.keys(setup.extra).some((e) => e.split('#')[0] === f);
    if (!named) out.push(`${f}: runs SQL but no registry row names it as a loader and it is not listed in NON_METRIC_COMPANY_FILES (shared/contracts/src/metric-reads.ts)`);
  }
  for (const [ref, declared] of refs) {
    const s = scanOf(ref);
    if (s.statements === 0) { out.push(`${ref}: a loader that runs no SQL statement (renamed, moved, or a wrong scope?)`); continue; }
    for (const u of s.unresolved) out.push(`${ref}: unresolved SQL: ${u} (a template expression: add it to FRAGMENTS in columns.ts or write the SQL out; a FROM entry: write it as a known table)`);
    for (const c of s.reads) if (!isContext(c) && !covers(declared, c)) out.push(`${ref}: reads ${c}, but no row that names this loader declares it`);
  }
  // a declared column must be read by one of the row's loaders
  for (const m of setup.metrics) for (const c of m.reads) {
    if (!m.loaders.some((l) => { const s = scanOf(l).reads; return s.has(c) || (!c.endsWith('.*') && s.has(`${c.split('.')[0]}.*`)); })) out.push(`${m.id}: declares ${c}, which none of its loaders (${m.loaders.join(', ')}) reads`);
  }
  for (const [ref, e] of [...Object.entries(setup.extra), ...Object.entries(setup.nonMetric)]) for (const c of e.reads) {
    const s = scanOf(ref).reads;
    if (!(s.has(c) || (!c.endsWith('.*') && s.has(`${c.split('.')[0]}.*`)))) out.push(`${ref}: declared as fetched but not read: ${c}`);
  }
  return out;
}

/**
 * c88 (M2d): organization/plan-metrics.ts (c85's observation counts, one SQL unit per registry metric) is part of the loader scan. A unit is not a company
 * loader, so its reads are declared in PLAN_UNIT_READS next to the SQL (reviewed there), not in a registry row. Reported: a statement outside a unit or a
 * known helper, a column read that is neither declared nor a context column, a declared column that is not read, a declared table the unit does not name,
 * and a unit or helper with a declaration but no SQL (or SQL with no declaration).
 */
export const PLAN_FILE = 'organization/plan-metrics.ts';
/** Directories under server/src that run SQL for numbers but are NOT registry metrics, so the scan does not cover them, each with the reason. */
export const SCAN_EXCLUSIONS: Record<string, string> = {
  'forecasts/': 'the forecast ledger (c86) is not a registry metric: it stores what was predicted and what happened, and no registry row, loader or plan reads it',
};
export function planUnitProblems(
  cols: SchemaCols, declared: Record<string, readonly string[]>, units: Record<string, { tables: readonly string[]; support: readonly string[] }>,
  context: readonly { column: string }[], src: Record<string, string> = {}): string[] {
  const out: string[] = [];
  const stm = statements(PLAN_FILE, src[PLAN_FILE]);
  const byScope = new Map<string, Set<string>>();
  for (const st of stm) {
    const r = reads(st.sql, cols);
    for (const u of [...st.unresolved.filter((e) => !(st.scope === 'countObservations' && e === 'u.sql')).map((e) => `\${${e}}`), ...r.unresolved]) out.push(`${PLAN_FILE}: unresolved SQL in ${st.scope || 'top level'}: ${u}`);
    const set = byScope.get(st.scope) ?? new Set<string>();
    for (const c of r.reads) set.add(c);
    byScope.set(st.scope, set);
  }
  for (const [scope, got] of byScope) {
    const d = declared[scope];
    if (!d) { out.push(`${PLAN_FILE}: SQL in "${scope || 'top level'}" has no entry in PLAN_UNIT_READS`); continue; }
    for (const c of got) if (!context.some((x) => matches(x.column, c)) && !d.includes(c) && !d.includes(`${c.split('.')[0]}.*`)) out.push(`${PLAN_FILE}: ${scope} reads ${c}, but PLAN_UNIT_READS does not declare it`);
    for (const c of d) if (!got.has(c)) out.push(`${PLAN_FILE}: ${scope} declares ${c}, which its SQL does not read`);
    const id = scope.startsWith('unit:') ? scope.slice(5) : '';
    if (id) {
      const u = units[id];
      if (!u) out.push(`${PLAN_FILE}: ${scope} is SQL for a unit that UNITS does not list`);
      else for (const c of d) if (![...u.tables, ...u.support].includes(c.split('.')[0])) out.push(`${PLAN_FILE}: ${scope} declares ${c}, but the table is neither a table nor a support table of the unit`);
    }
  }
  for (const k of Object.keys(declared)) if (!byScope.has(k)) out.push(`${PLAN_FILE}: PLAN_UNIT_READS lists ${k}, which runs no SQL statement (renamed or removed?)`);
  for (const id of Object.keys(units)) if (!byScope.has(`unit:${id}`)) out.push(`${PLAN_FILE}: unit ${id} has no SQL statement the scan can see`);
  return out;
}
