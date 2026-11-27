// The runner's diff gates (evolution step 2), run on the engineer's commit before anything is pushed. Pure; no I/O except
// loadRules (the runner's own installed evolve/protected.txt, never the candidate's).
//   protectedHits: the Guard's classify() on the changed paths (a hit → the mission waits for the owner).
//   secretHits:    any secret value (length ≥ 12; also base64/base64url at every alignment, hex, reversed, split over added
//                  lines) or the markers sk-ant- / CLAUDE_CODE_OAUTH / -----BEGIN in an added line, a file name, the commit
//                  message or the report; a binary change (cannot be scanned) counts too. A hit names the place, never the value.
//   flags:         a static scan of added lines (B1b): network calls, absolute URLs, environment reads, child processes,
//                  file writes/deletes, destructive SQL, eval. A flag → the mission waits for the owner.
// The diff must be `git diff` text (Task 4: `--text` so binary content is shown as lines, or it is caught as unscannable);
// `files` must list every changed path (from `git diff --name-status -z -M`).

import { readFileSync } from 'node:fs';
import { classify, parseRules } from '../guard/classify.ts';
import type { ClassifyInput } from '../guard/classify.ts';

export type GateInput = {
  diff: string;
  files: ClassifyInput[];
  /** the values of every secrets/*.env entry; values shorter than 12 characters are ignored */
  secrets: string[];
  /** the engineer's report (shown on the mission page) */
  report: string;
  /** the commit message */
  message?: string;
  /** protected rules; default: the runner's installed evolve/protected.txt */
  rules?: string[];
};
export type GateResult = { protectedHits: string[]; secretHits: string[]; flags: string[] };

const MIN_SECRET = 12;
const MARKERS = ['sk-ant-', 'CLAUDE_CODE_OAUTH', '-----BEGIN'];
const MAX_FLAGS = 50;

export function loadRules(file: string | URL = new URL('../protected.txt', import.meta.url)): string[] {
  return parseRules(readFileSync(file, 'utf8'));
}

const re = (r: RegExp) => (s: string) => r.test(s);
const SQL_CI = /\bdrop\s+(?:table|schema|database|index|view|materialized|column|constraint|trigger|function|type|extension|role|user|sequence|owned|policy)\b|\btruncate\s+table\b|\bdelete\s+from\b(?![^\n]*\bwhere\b)/i;

export const FLAG_RULES: { id: string; label: string; test: (line: string) => boolean }[] = [
  { id: 'fetch', label: 'fetch(', test: re(/\bfetch\s*\(/) },
  // absolute URLs; XML namespace URIs (svg markup) are identifiers, never fetched
  { id: 'url', label: 'absolute http(s) URL', test: re(/\bhttps?:\/\/(?!www\.w3\.org\/)[^\s'"`<>)]/i) },
  { id: 'env', label: 'process.env', test: re(/\bprocess\s*(?:\.\s*env\b|\[\s*['"`]env['"`]\s*\])|\{[^}]*\benv\b[^}]*\}\s*=\s*process\b/) },
  { id: 'child_process', label: 'child_process', test: re(/\bchild_process\b/) },
  {
    id: 'fs_write',
    label: 'fs write/delete',
    test: re(/\b(?:fs|fsp|promises)\s*\.\s*(?:write\w*|append\w*|rm|rmSync|rmdir|rmdirSync|unlink\w*|rename\w*|truncate\w*|copyFile\w*|cp|cpSync|createWriteStream)\b|\b(?:writeFileSync|writeFile|writeSync|appendFileSync|appendFile|createWriteStream|rmSync|rmdirSync|unlink|unlinkSync)\s*\(/),
  },
  // DROP <object>, TRUNCATE TABLE, DELETE FROM without WHERE on the line (any case); bare TRUNCATE x only in upper case,
  // since truncate(text, 40) is a common helper
  { id: 'sql', label: 'destructive SQL', test: (s) => SQL_CI.test(s) || /\bTRUNCATE\s+["\w]/.test(s) },
  { id: 'eval', label: 'eval(/new Function(', test: re(/\beval\s*\(|\bnew\s+Function\s*\(/) },
];

/** ids of the flag rules that fire on one line of text */
export function scanFlags(text: string): string[] {
  return FLAG_RULES.filter((r) => r.test(text)).map((r) => r.id);
}

export type DiffLine = { file: string; line: number; text: string };
export type ParsedDiff = { added: DiffLine[]; headers: { file: string; text: string }[] };

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function headerPath(line: string): string | null {
  if (line.startsWith('+++ ')) {
    const p = line.slice(4).replace(/\t.*$/, '');
    return p === '/dev/null' ? null : p.replace(/^b\//, '');
  }
  if (line.startsWith('diff --git ')) {
    const i = line.lastIndexOf(' b/');
    return i > 0 ? line.slice(i + 3) : line.slice('diff --git '.length);
  }
  return null;
}

/** Added lines (with the new-side line number) and the header lines of a unified git diff. Hunk lengths decide what is content. */
export function parseDiff(diff: string): ParsedDiff {
  const added: DiffLine[] = [];
  const headers: { file: string; text: string }[] = [];
  let file = '';
  let oldLeft = 0;
  let newLeft = 0;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      const c = raw[0];
      if (c === '+') { added.push({ file, line, text: raw.slice(1) }); line++; newLeft--; continue; }
      if (c === '-') { oldLeft--; continue; }
      if (c === '\\') continue;
      // a context line (' ', or an empty line when trailing whitespace was stripped)
      oldLeft--; newLeft--; line++;
      continue;
    }
    const m = HUNK.exec(raw);
    if (m) {
      oldLeft = m[1] === undefined ? 1 : Number(m[1]);
      newLeft = m[3] === undefined ? 1 : Number(m[3]);
      line = Number(m[2]);
      continue;
    }
    if (raw === '') continue;
    const p = headerPath(raw);
    if (p !== null) file = p;
    headers.push({ file, text: raw });
  }
  return { added, headers };
}

function b64Cores(v: string, url: boolean): string[] {
  const out: string[] = [];
  for (let k = 0; k < 3; k++) {
    const enc = Buffer.from('\0'.repeat(k) + v).toString(url ? 'base64url' : 'base64').replace(/=+$/, '');
    // drop the characters that also depend on the bytes before (prefix) and after (the last partial group)
    const core = enc.slice(Math.ceil((k * 8) / 6), enc.length - 3);
    if (core.length >= MIN_SECRET) out.push(core);
  }
  return out;
}

type Needle = { what: string; forms: string[]; ci: boolean };

function needles(secrets: string[]): Needle[] {
  const values = [...new Set(secrets.map((s) => s.trim()).filter((s) => s.length >= MIN_SECRET))];
  const list: Needle[] = values.map((v, i) => ({
    what: `secret value #${i + 1}`,
    forms: [...new Set([v, [...v].reverse().join(''), Buffer.from(v).toString('hex'), ...b64Cores(v, false), ...b64Cores(v, true)])],
    ci: false,
  }));
  for (const m of MARKERS) list.push({ what: m, forms: [m], ci: true });
  return list;
}

function found(text: string, n: Needle): boolean {
  if (n.ci) { const t = text.toLowerCase(); return n.forms.some((f) => t.includes(f.toLowerCase())); }
  const lower = text.toLowerCase();
  // hex may be upper or lower case; everything else is exact
  return n.forms.some((f, i) => (i === 2 ? lower.includes(f) : text.includes(f)));
}

export function gates(o: GateInput): GateResult {
  const rules = o.rules ?? loadRules();
  const protectedHits = classify(o.files, rules).hits;
  const { added, headers } = parseDiff(o.diff);
  const ns = needles(o.secrets);
  const secretHits: string[] = [];
  const hit = (s: string) => { if (!secretHits.includes(s)) secretHits.push(s); };

  for (const n of ns) {
    for (const a of added) if (found(a.text, n)) hit(`${n.what} in added line ${a.file}:${a.line}`);
    for (const h of headers) if (found(h.text, n)) hit(`${n.what} in a file name or diff header (${h.file})`);
    for (const f of o.files) {
      for (const p of [f.path, f.oldPath]) if (p !== undefined && found(p, n)) hit(`${n.what} in a file name`);
    }
    // a value split over consecutive added lines of one file
    const byFile = new Map<string, string>();
    for (const a of added) byFile.set(a.file, (byFile.get(a.file) ?? '') + a.text);
    for (const [file, joined] of byFile) {
      if (found(joined, n) && !secretHits.some((s) => s.startsWith(`${n.what} in added line ${file}:`))) hit(`${n.what} in added lines of ${file}`);
    }
    if (o.message !== undefined && found(o.message, n)) hit(`${n.what} in the commit message`);
    if (found(o.report, n)) hit(`${n.what} in the report`);
  }
  for (const h of headers) {
    if (/^Binary files .* differ$/.test(h.text) || h.text === 'GIT binary patch') hit(`binary change in ${h.file} (cannot be scanned for secrets)`);
  }

  const flags: string[] = [];
  const flag = (s: string) => { if (!flags.includes(s)) flags.push(s); };
  for (const h of headers) {
    if (/^(?:new file mode|new mode) 120000$/.test(h.text)) flag(`symlink ${h.file}`);
  }
  for (const a of added) {
    for (const id of scanFlags(a.text)) flag(`${FLAG_RULES.find((r) => r.id === id)!.label} in ${a.file}:${a.line}`);
  }
  if (flags.length > MAX_FLAGS) {
    const more = flags.length - MAX_FLAGS;
    flags.length = MAX_FLAGS;
    flags.push(`… ${more} more`);
  }
  return { protectedHits, secretHits, flags };
}
