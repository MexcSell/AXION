import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { INPUT_FIELDS, WRITE_SITES, ROUTE_NO_INPUT, ALL_WRITE_ROUTES, type WriteSite, type InputField } from '../../../shared/contracts/src/index.ts';

const SRC = join(__dirname, '../../src');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
const files = () => walk(SRC).map((f) => ({ rel: relative(SRC, f).split('\\').join('/'), text: readFileSync(f, 'utf8') }));

/** Every non-GET route of the app's route table (HEAD/OPTIONS excluded), as `METHOD /path` without the /api/v1 prefix. */
export function writeRoutes(table: { method: string; url: string }[]): string[] {
  return [...new Set(table.filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)).map((r) => `${r.method} ${r.url.replace(/^\/api\/v1/, '')}`))].sort();
}

/** What is wrong with the route classification (empty = every write route is classified exactly once, and every classified route exists). */
export function routeWriteProblems(routes: string[], sites: Record<string, WriteSite> = WRITE_SITES, noInput: Record<string, string> = ROUTE_NO_INPUT): string[] {
  const out: string[] = [];
  const claimed = new Set(Object.values(sites).flatMap((s) => s.routes));
  for (const r of routes) {
    if (!claimed.has(r) && !(r in noInput)) out.push(`${r}: a write route with no classification (add it to a site in shared/contracts/src/metric-guard.ts, or to ROUTE_NO_INPUT with the reason it touches no scorecard input)`);
    if (claimed.has(r) && r in noInput) out.push(`${r}: classified both as reaching an input site and as touching no input`);
  }
  for (const r of [...claimed, ...Object.keys(noInput)]) if (!routes.includes(r)) out.push(`${r}: classified but no such write route is registered (renamed or removed?)`);
  for (const [r, why] of Object.entries(noInput)) if (why.trim().length < 30) out.push(`${r}: "touches no input" needs a real reason (at least 30 characters)`);
  return out;
}

/** `file|table` for every insert/update/delete on an input table, and `file|field` for every marker literal, found in server/src. */
export function scanWrites(fields: Record<string, InputField> = INPUT_FIELDS, src = files()): Set<string> {
  const tables = [...new Set(Object.values(fields).flatMap((f) => f.tables))];
  const re = new RegExp(`\\b(?:insert\\s+into|update|delete\\s+from)\\s+(${tables.join('|')})\\b`, 'gi');
  const out = new Set<string>();
  for (const f of src) {
    for (const m of f.text.matchAll(re)) out.add(`${f.rel}|${m[1].toLowerCase()}`);
    for (const [id, fd] of Object.entries(fields)) if (fd.marker && f.text.includes(fd.marker)) out.add(`${f.rel}|${id}`);
  }
  return out;
}

/** The same set, as the sites declare it. */
export function declaredWrites(sites: Record<string, WriteSite> = WRITE_SITES, fields: Record<string, InputField> = INPUT_FIELDS): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(sites)) for (const w of s.writes) { const f = fields[w]; for (const t of f.tables) out.add(`${s.file}|${t}`); if (f.marker) out.add(`${s.file}|${w}`); }
  return out;
}

export function siteProblems(found: Set<string>, declared: Set<string>, sites: Record<string, WriteSite> = WRITE_SITES, src = files()): string[] {
  const out: string[] = [];
  for (const f of found) if (!declared.has(f)) { const [file, what] = f.split('|'); out.push(`${file} writes ${what}, an input of a scorecard, KPI or dimension row, but no site in shared/contracts/src/metric-guard.ts declares it (classify who can reach it)`); }
  for (const d of declared) if (!found.has(d)) { const [file, what] = d.split('|'); out.push(`${file} is declared as a writer of ${what} but the source no longer writes it (stale site)`); }
  for (const [id, s] of Object.entries(sites)) {
    const f = src.find((x) => x.rel === s.file);
    if (!f) { out.push(`site ${id}: ${s.file} does not exist`); continue; }
    if (s.fn !== 'handler' && !new RegExp(`export\\s+(?:async\\s+)?function\\s+${s.fn}\\b`).test(f.text)) out.push(`site ${id}: ${s.file} exports no function ${s.fn}`);
    if (s.note.trim().length < 20) out.push(`site ${id}: needs a note`);
  }
  return out;
}

/** Tables the three company loaders read, as written in their SQL (`from x` / `join x`). */
export function loaderTables(): string[] {
  const t = new Set<string>();
  for (const f of files().filter((x) => ['company/routes.ts', 'company/dimensions-routes.ts', 'company/departments.ts'].includes(x.rel)))
    for (const m of f.text.matchAll(/\b(?:from|join)\s+([a-z_]+)\b/g)) t.add(m[1]);
  return [...t].sort();
}
export { ALL_WRITE_ROUTES };
