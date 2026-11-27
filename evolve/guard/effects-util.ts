// Pure helpers of the Guard's Docker effects (effects-docker.ts): output tails, health parsing, image tags, the front
// config rendering and its atomic write, env-file reading.

import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { RunResult } from './host.ts';

export type Health = { ok?: unknown; commit?: unknown; leader?: unknown };

const CONTAINER_RE = /^[a-z0-9][a-z0-9_.-]*$/;

/** the last few non-empty lines of a failed command (docker build/BuildKit puts the reason at the end) */
export function errTail(r: RunResult, n = 5): string {
  const lines = `${r.stderr}\n${r.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(-n).join(' | ') || `exit ${r.code}`;
}

export function parseHealth(text: string): Health | null {
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null ? (v as Health) : null;
  } catch {
    return null;
  }
}

/** `<sha12>-<YYYYMMDDTHHMMSSZ>` */
export function imageTag(sha: string, nowMs: number): string {
  return `${sha.slice(0, 12)}-${new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
}

export async function readSummary(file: string): Promise<{ passed?: unknown; ok?: unknown } | null> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return typeof v === 'object' && v !== null ? (v as { passed?: unknown; ok?: unknown }) : null;
  } catch {
    return null;
  }
}

export function renderFrontConf(template: string, container: string): string {
  if (!CONTAINER_RE.test(container)) throw new Error(`not a container name: ${JSON.stringify(container)}`);
  return template.replaceAll('{{SLOT}}', container);
}

/** tmp file in the same directory (named so nginx's conf.d/*.conf never matches it), fsync, rename, fsync the directory */
export async function writeAtomic(file: string, text: string, mode = 0o644): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const fh = await open(tmp, 'wx', mode);
  try {
    await fh.writeFile(text);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  const d = await open(dir, 'r');
  try { await d.sync(); } finally { await d.close(); }
}

/** KEY=VALUE lines as `docker --env-file` reads them (no quotes, # comments); the last duplicate wins */
export function envFileValue(text: string, key: string): string | undefined {
  let v: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i).trim() === key) v = line.slice(i + 1);
  }
  return v;
}

/** R31: the shells of accounts nobody can log in to */
export const NOLOGIN_SHELLS = ['/usr/sbin/nologin', '/sbin/nologin', '/bin/false', '/usr/bin/false'] as const;

/**
 * R31: why `uid` may not run a container, or null when it may: uid 0, or `getent passwd <uid>` names an account whose
 * shell is a login shell (a login user's processes could read the container's /proc/<pid>/environ and write through
 * /proc/<pid>/root). getent exit 2 (no such uid) is fine; any other failure fails closed.
 */
export function loginAccountProblem(uid: string, getent: RunResult): string | null {
  if (!/^\d{1,10}$/.test(uid)) return `not a uid: ${JSON.stringify(uid)}`;
  if (Number(uid) === 0) return 'uid 0 (root) is never used to run agent or Guard work';
  if (getent.code === 2 || (getent.code === 0 && getent.stdout.trim() === '')) return null;
  if (getent.code !== 0) return `getent passwd ${uid} failed (exit ${getent.code}); refusing (fail closed)`;
  const f = getent.stdout.split('\n')[0].trim().split(':');
  const shell = f[6] ?? '';
  if ((NOLOGIN_SHELLS as readonly string[]).includes(shell)) return null;
  return `uid ${uid} resolves to the account ${f[0] ?? '?'} with the login shell ${shell || '(none given)'}`;
}

/**
 * R31: `<uid>:<gid>` a container runs as: `who` is a user name (looked up with `id -u/-g` at run time, never hard-coded)
 * or a numeric `<uid>:<gid>` (trials: a uid that resolves to no account). Throws when the uid is 0 or a login account.
 */
export async function resolveRunAs(run: (cmd: string, args: string[]) => Promise<RunResult>, who: string): Promise<string> {
  let ids: string;
  if (/^\d{1,10}:\d{1,10}$/.test(who)) ids = who;
  else {
    const v: string[] = [];
    for (const flag of ['-u', '-g']) {
      const r = await run('id', [flag, who]);
      const x = r.stdout.trim();
      if (r.code !== 0 || !/^\d{1,10}$/.test(x)) throw new Error(`cannot look up the ${who} user (id ${flag}): ${errTail(r)}`);
      v.push(x);
    }
    ids = v.join(':');
  }
  const [uid, gid] = ids.split(':');
  const why = Number(uid) === 0 ? loginAccountProblem(uid, { code: 2, stdout: '', stderr: '' })
    : Number(gid) === 0 ? 'gid 0 (root group)' : loginAccountProblem(uid, await run('getent', ['passwd', uid]));
  if (why) throw new Error(`refusing to run a container as ${who} (${ids}): ${why}`);
  return ids;
}
