import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from '../db.ts';
import { buildOtlp, loadMissionRecords, validateOtlp } from './export.ts';

/** Improvement cycle 60: the command line of `npm run export:otlp` (kept apart from the script so tests can call it). Local file only. */
export interface ExportArgs { missionId: string; tenant?: string; out?: string; includeContent: boolean; force: boolean }

export function parseExportArgs(argv: string[]): ExportArgs {
  const a: ExportArgs = { missionId: '', includeContent: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--include-content') a.includeContent = true;
    else if (x === '--force') a.force = true;
    else if (x === '--out' || x === '--tenant') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${x} needs a value.`);
      if (x === '--out') a.out = v; else a.tenant = v;
    } else if (x.startsWith('--')) throw new Error(`Unknown option ${x}.`);
    else if (!a.missionId) a.missionId = x;
    else throw new Error(`Unexpected argument ${x}.`);
  }
  if (!a.missionId) throw new Error('A mission id is required.');
  return a;
}

export const USAGE = 'usage: npm run export:otlp -- <missionId> [--out FILE] [--tenant ID] [--include-content] [--force]\n  Writes the stored task and trace records of one mission as OTLP JSON to a local file. Content is off (pointers only) unless --include-content.';

/** Loads, builds, validates against the pinned spec and writes the file ("wx": an existing file is never overwritten without `force`). */
export async function exportMissionToFile(db: Db, o: { tenant: string; missionId: string; out?: string; includeContent: boolean; force: boolean }): Promise<{ out: string; spans: number; includeContent: boolean }> {
  const out = resolve(o.out ?? `axion-otlp-${o.missionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  const doc = buildOtlp(await loadMissionRecords(db, o.tenant, o.missionId), { includeContent: o.includeContent });
  const problems = validateOtlp(doc, { includeContent: o.includeContent });
  if (problems.length) throw new Error(`The export does not match the pinned specification:\n${problems.slice(0, 10).join('\n')}`);
  try { writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', { flag: o.force ? 'w' : 'wx' }); }
  catch (e) { if ((e as { code?: string }).code === 'EEXIST') throw new Error(`${out} already exists (use --force to replace it).`); throw e; }
  return { out, spans: doc.resourceSpans[0].scopeSpans[0].spans.length, includeContent: o.includeContent };
}
