import { openSync, writeSync, fchmodSync, closeSync, lstatSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from '../db.ts';
import { buildOtlp, loadMissionRecords, validateOtlp, withReadOnlySnapshot } from './export.ts';
export { withReadOnlySnapshot };

/** Improvement cycle 60: the command line of `npm run export:otlp` (kept apart from the script so tests can call it). Local file only. */
export interface ExportArgs { missionId: string; databaseUrlEnv: string; tenant?: string; out?: string; includeContent: boolean; force: boolean }

export function parseExportArgs(argv: string[]): ExportArgs {
  const a: ExportArgs = { missionId: '', databaseUrlEnv: '', includeContent: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--include-content') a.includeContent = true;
    else if (x === '--force') a.force = true;
    else if (x === '--out' || x === '--tenant' || x === '--database-url-env') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${x} needs a value.`);
      if (x === '--out') a.out = v; else if (x === '--tenant') a.tenant = v; else a.databaseUrlEnv = v;
    } else if (x.startsWith('--')) throw new Error(`Unknown option ${x}.`);
    else if (!a.missionId) a.missionId = x;
    else throw new Error(`Unexpected argument ${x}.`);
  }
  if (!a.missionId) throw new Error('A mission id is required.');
  if (!a.databaseUrlEnv) throw new Error('--database-url-env is required: there is no default database. Name the environment variable that holds the database URL.');
  return a;
}

/** The URL comes from the environment variable the operator named, never from a default. The URL itself is never printed. */
export function resolveDatabaseUrl(a: { databaseUrlEnv: string }, env: Record<string, string | undefined>): string {
  const v = env[a.databaseUrlEnv];
  if (!v) throw new Error(`The environment variable ${a.databaseUrlEnv} is not set.`);
  return v;
}

export const USAGE = [
  'usage: npm run export:otlp -- <missionId> --database-url-env VAR [--out FILE] [--tenant ID] [--include-content] [--force]',
  '  Writes the stored task and trace records of one mission as OTLP JSON to a local file. Content is off (pointers only) unless --include-content.',
  '  --database-url-env VAR  required: the name of the environment variable that holds the database URL. There is no default database.',
  '                          The reads run in one REPEATABLE READ READ ONLY transaction; the output names the database (not the host or user).',
  '  This is an operator tool: it works with database credentials and is scoped to a tenant (--tenant, default t-1), with no per-person visibility',
  '  (a mission a person could not see in the app is exported too).',
  '  Evaluation results are linked to the mission through the pinned agent version of its instances, so they can belong to other missions that ran',
  '  the same version (marked axion.export.linked_by = agent_version); with --include-content their trace text is exported too.',
  '  The file is created with mode 0600; a symlink at --out is refused, even with --force.',
].join('\n');

export const describeExport = (r: { out: string; spans: number; includeContent: boolean; database: string }) =>
  `wrote ${r.spans} spans to ${r.out} from database "${r.database}" (content ${r.includeContent ? 'INCLUDED' : 'off: pointers only'})`;

/** Loads, builds, validates against the pinned spec and writes the file ("wx": an existing file is never overwritten without `force`). */
export async function exportMissionToFile(db: Db, o: { tenant: string; missionId: string; out?: string; includeContent: boolean; force: boolean }): Promise<{ out: string; spans: number; includeContent: boolean; database: string }> {
  const out = resolve(o.out ?? `axion-otlp-${o.missionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  const { rec, database } = await loadMissionRecords(db, o.tenant, o.missionId, true);
  const doc = buildOtlp(rec, { includeContent: o.includeContent });
  const problems = validateOtlp(doc, { includeContent: o.includeContent });
  if (problems.length) throw new Error(`The export does not match the pinned specification:\n${problems.slice(0, 10).join('\n')}`);
  writeOutFile(out, JSON.stringify(doc, null, 2) + '\n', o.force);
  return { out, spans: doc.resourceSpans[0].scopeSpans[0].spans.length, includeContent: o.includeContent, database };
}

/** Mode 0600 (the file may hold content). "wx" never overwrites; with force an existing regular file is truncated, but a symlink is refused (O_NOFOLLOW plus an lstat), so the file it points at is never written. */
function writeOutFile(out: string, text: string, force: boolean): void {
  let st: ReturnType<typeof lstatSync> | null = null;
  try { st = lstatSync(out); } catch { /* absent */ }
  if (st?.isSymbolicLink()) throw new Error(`${out} is a symlink; refusing to write through it (not even with --force).`);
  if (st && !force) throw new Error(`${out} already exists (use --force to replace it).`);
  let fd: number;
  try { fd = openSync(out, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (force ? constants.O_TRUNC : constants.O_EXCL), 0o600); }
  catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'EEXIST') throw new Error(`${out} already exists (use --force to replace it).`);
    if (code === 'ELOOP') throw new Error(`${out} is a symlink; refusing to write through it (not even with --force).`);
    throw e;
  }
  try { fchmodSync(fd, 0o600); writeSync(fd, text); } finally { closeSync(fd); }
}
