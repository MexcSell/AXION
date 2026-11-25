/**
 * c80 (R4-6): a lint over one migration's SQL for the append-only tables. Pure text analysis, no database. It exists because a routine
 * migration is the likeliest thing to weaken the guards that make audited records trustworthy (LESSONS: "Append-only needs all four guards").
 *
 * Rules (up file; a down file legitimately drops what its up file created, so only its presence is checked):
 *  - drop-append-only  DROP TABLE / ALTER TABLE ... DROP on an append-only table; DROP TRIGGER on one that the file does not recreate.
 *                      One reviewed exception (owner 2026-11-25, Phase A migration 0064): DROP CONSTRAINT x is allowed when a LATER statement of
 *                      the same file adds a CHECK constraint named x on the same table (a CHECK being widened, e.g. digest_version in (1,2,3)).
 *                      Names that Postgres gives keys (…_pkey, …_key, …_fkey, …_excl) never qualify, so a key cannot be swapped for a CHECK.
 *                      The text cannot prove what kind the dropped constraint was; the generated guard test and review cover the rest.
 *  - guard-disabled    ALTER TABLE ... DISABLE TRIGGER (or session_replication_role = replica) with no matching re-enable later in the same file.
 *  - rewrite-rows      UPDATE of an append-only table; DELETE or TRUNCATE of one outside the axion.purge_demo exception (flag set before, not 'off').
 *  - chain-column      ALTER COLUMN / RENAME COLUMN on the audit_events columns that feed the chain hash (the canonical row, prev_hash, row_hash).
 *  - missing-down      no down file, or a down file with nothing but comments.
 * Not covered (the generated guard test covers some): CREATE OR REPLACE FUNCTION of a guard function (a weakened body cannot be judged from text),
 * dynamic SQL built from strings, and renames of an append-only table. A genuine exception needs a lint change reviewed on purpose, not a waiver comment.
 */
export type LintRule = 'drop-append-only' | 'guard-disabled' | 'rewrite-rows' | 'chain-column' | 'missing-down';
export interface LintFinding { rule: LintRule; table?: string; detail: string }
export interface LintInput { name: string; up: string; down: string | null }

/** The audit_events columns inside canonical(row) plus the two hash columns (server/src/audit.ts chainHash; migration 0026). */
export const CHAIN_COLUMNS = ['tenant_id', 'at', 'actor', 'action', 'subject', 'result', 'correlation_id', 'detail', 'seq', 'prev_hash', 'row_hash'];

/** Remove comments; also return a copy with string-literal contents blanked (for keyword search) and one with them kept (for the purge flag). */
function clean(sql: string): { kept: string; masked: string } {
  let kept = '', masked = '';
  for (let i = 0; i < sql.length;) {
    const c = sql[i], two = sql.slice(i, i + 2);
    if (two === '--') { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e; continue; }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; kept += ' '; masked += ' '; continue; }
    if (c === "'") { // string literal, '' is an escaped quote
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") j += 2; else if (sql[j] === "'") break; else j++; }
      kept += sql.slice(i, j + 1); masked += "'" + ' '.repeat(Math.max(0, j - i - 1)) + "'"; i = j + 1; continue;
    }
    kept += c; masked += c; i++;
  }
  return { kept, masked };
}

interface Stmt { kept: string; masked: string }
/** Split into statements at top-level semicolons. Dollar-quoted bodies stay inside their statement (DO bodies are re-split by the caller). */
function split(sql: string): Stmt[] {
  const { kept, masked } = clean(sql);
  const out: Stmt[] = [];
  let start = 0;
  for (let i = 0; i < masked.length;) {
    const m = /^\$([A-Za-z_]\w*)?\$/.exec(masked.slice(i));
    if (m && (i === 0 || !/\w/.test(masked[i - 1]))) { const e = masked.indexOf(m[0], i + m[0].length); i = e < 0 ? masked.length : e + m[0].length; continue; }
    if (masked[i] === ';') { out.push({ kept: kept.slice(start, i), masked: masked.slice(start, i) }); start = i + 1; }
    i++;
  }
  if (masked.slice(start).trim()) out.push({ kept: kept.slice(start), masked: masked.slice(start) });
  return out;
}

/** Strings were blanked inside `masked` but a dollar body is code, so DO bodies are taken from `kept` and cleaned again. */
function expand(stmts: Stmt[]): Stmt[] {
  const out: Stmt[] = [];
  for (const s of stmts) {
    if (/^\s*do\b/i.test(s.masked)) {
      const m = /\$([A-Za-z_]\w*)?\$([\s\S]*)\$\1?\$/.exec(s.kept);
      if (m) { out.push(...expand(split(m[2]))); continue; }
    }
    out.push(s);
  }
  return out;
}

const ID = String.raw`(?:"?\w+"?\s*\.\s*)?"?(\w+)"?`;
const norm = (s: string) => s.toLowerCase();

export function lintMigration(m: LintInput, appendOnly: ReadonlySet<string>): LintFinding[] {
  const out: LintFinding[] = [];
  const ao = (t: string) => appendOnly.has(norm(t));
  const add = (rule: LintRule, detail: string, table?: string) => out.push({ rule, detail, ...(table ? { table } : {}) });

  if (m.down === null || clean(m.down).kept.trim() === '') add('missing-down', `${m.name}: no down file, or it holds no SQL`);

  const stmts = expand(split(m.up)).filter((s) => !/^\s*create\s+(or\s+replace\s+)?(function|procedure)\b/i.test(s.masked));
  const createdTriggers = new Set<string>(); // "trigger|table"
  for (const s of stmts) { const x = new RegExp(String.raw`^\s*create\s+(?:or\s+replace\s+)?trigger\s+"?(\w+)"?[\s\S]*?\bon\s+` + ID, 'i').exec(s.masked); if (x) createdTriggers.add(norm(x[1]) + '|' + norm(x[2])); }
  const ALTER = new RegExp(String.raw`^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?` + ID + String.raw`([\s\S]*)`, 'i');
  const addedChecks = new Map<string, number>(); // "table|constraint" -> index of the last statement that adds it as a CHECK
  stmts.forEach((s, i) => { const a = ALTER.exec(s.masked); if (a) for (const c of a[2].matchAll(/\badd\s+constraint\s+"?(\w+)"?\s+check\s*\(/gi)) addedChecks.set(norm(a[1]) + '|' + norm(c[1]), i); });
  const KEY_NAME = /_(pkey|key|fkey|excl)$/i;
  const widenedCheck = (t: string, name: string, at: number) => !KEY_NAME.test(name) && (addedChecks.get(t + '|' + norm(name)) ?? -1) > at;

  let purge = false; // the transaction-local flag, set earlier in this file
  const disabled = new Map<string, string>(); // "table|trigger" -> detail; removed again by a matching ENABLE
  let replicaOff = false;

  for (const [idx, s] of stmts.entries()) {
    const q = s.masked;
    let x: RegExpExecArray | null;

    // purge flag (read from the kept text: the value is a string literal)
    if (/axion\.purge_demo/i.test(s.kept)) { if (/axion\.purge_demo[^;]*?\bon\b/i.test(s.kept)) purge = true; else if (/axion\.purge_demo/i.test(s.kept)) purge = false; }

    // session-wide trigger switch
    if (/\bsession_replication_role\b/i.test(q) || /\bsession_replication_role\b/i.test(s.kept)) {
      if (/(=|\bto\b)\s*'?replica'?/i.test(s.kept)) replicaOff = true;
      else if (/(=|\bto\b)\s*'?(origin|default)'?|\breset\s+session_replication_role\b/i.test(s.kept)) replicaOff = false;
    }

    // DROP TABLE
    if ((x = /^\s*drop\s+table\s+(?:if\s+exists\s+)?([\s\S]+)/i.exec(q))) {
      for (const part of x[1].replace(/\b(cascade|restrict)\b/gi, '').split(',')) { const n = new RegExp(ID, 'i').exec(part.trim()); if (n && ao(n[1])) add('drop-append-only', `DROP TABLE ${n[1]}`, norm(n[1])); }
    }
    // DROP TRIGGER name ON table, unless recreated in this file
    if ((x = new RegExp(String.raw`^\s*drop\s+trigger\s+(?:if\s+exists\s+)?"?(\w+)"?\s+on\s+` + ID, 'i').exec(q)) && ao(x[2]) && !createdTriggers.has(norm(x[1]) + '|' + norm(x[2]))) add('drop-append-only', `DROP TRIGGER ${x[1]} on ${x[2]} without recreating it`, norm(x[2]));

    // ALTER TABLE
    if ((x = new RegExp(String.raw`^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?` + ID + String.raw`([\s\S]*)`, 'i').exec(q))) {
      const t = norm(x[1]), rest = x[2];
      const restNoWidened = rest.replace(/\bdrop\s+constraint\s+(?:if\s+exists\s+)?"?(\w+)"?/gi, (all, n: string) => (widenedCheck(t, n, idx) ? '' : all));
      if (ao(t) && /\bdrop\b/i.test(restNoWidened)) add('drop-append-only', `ALTER TABLE ${t} ... DROP`, t);
      const dis = new RegExp(String.raw`\bdisable\s+trigger\s+(?:"?(\w+)"?)`, 'i').exec(rest);
      if (dis) disabled.set(t + '|' + norm(dis[1]), `ALTER TABLE ${t} DISABLE TRIGGER ${dis[1]}`);
      const ena = new RegExp(String.raw`\benable\s+(?:always\s+|replica\s+)?trigger\s+(?:"?(\w+)"?)`, 'i').exec(rest);
      if (ena) { const n = norm(ena[1]); for (const k of [...disabled.keys()]) { const [kt, kn] = k.split('|'); if (kt === t && (n === kn || n === 'all' || (n === 'user' && kn !== 'all'))) disabled.delete(k); } }
      if (t === 'audit_events') {
        for (const c of rest.matchAll(/\b(?:alter\s+column|rename\s+column)\s+"?(\w+)"?/gi)) if (CHAIN_COLUMNS.includes(norm(c[1]))) add('chain-column', `ALTER/RENAME COLUMN ${c[1]} on audit_events (feeds the chain hash)`, t);
      }
    }

    // row rewrites
    if ((x = new RegExp(String.raw`\bupdate\s+(?:only\s+)?` + ID + String.raw`\s+(?:as\s+\w+\s+)?set\b`, 'i').exec(q)) && ao(x[1]) && !/\bdo\s+update\b/i.test(q.slice(Math.max(0, x.index - 4), x.index + 8))) add('rewrite-rows', `UPDATE ${x[1]} (a purge flag never allows an UPDATE)`, norm(x[1]));
    if ((x = new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?` + ID, 'i').exec(q)) && ao(x[1]) && !purge) add('rewrite-rows', `DELETE FROM ${x[1]} outside the axion.purge_demo exception`, norm(x[1]));
    if ((x = new RegExp(String.raw`^\s*truncate\s+(?:table\s+)?(?:only\s+)?` + ID, 'i').exec(q)) && ao(x[1])) add('rewrite-rows', `TRUNCATE ${x[1]}`, norm(x[1]));
  }
  for (const d of disabled.values()) add('guard-disabled', `${d} with no matching ENABLE in the same file`);
  if (replicaOff) add('guard-disabled', 'session_replication_role = replica with no reset in the same file');
  return out;
}
