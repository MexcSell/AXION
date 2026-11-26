// The Guard's state file (/srv/axion-evolve/state.json): which slot is live, and an unfinished deploy if one is running.
// Written atomically: a temp file in the same directory, fsynced, then renamed over state.json.
// Fields other than the ones below (e.g. the front port and database kept by the CLI) are preserved as they are.

import { open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export type Slot = 'blue' | 'green';

export const STEPS = ['lock', 'classify', 'base', 'build', 'checks', 'boot', 'backup', 'migrate', 'start', 'smoke', 'drain', 'switch',
  'watch', 'record'] as const;
export type Step = typeof STEPS[number];

export type GuardState = {
  active: Slot;
  /** null = nothing live through the Guard yet */
  activeImage: string | null;
  activeSha: string | null;
  previousImage: string | null;
  /** the commit previousImage was built from (lets `rollback` restore activeSha on its own) */
  previousSha: string | null;
  /** present while a deploy is running (or was killed); `step` is the step in progress */
  deploying?: { sha: string; step: Step; startedAt: string };
  [extra: string]: unknown;
};

const FILE = 'state.json';

function bad(why: string): never {
  throw new Error(`state.json is invalid: ${why}`);
}

const strOrNull = (v: unknown) => v === null || typeof v === 'string';

function validate(v: unknown): GuardState {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad('not an object');
  const s = v as Record<string, unknown>;
  if (s.active !== 'blue' && s.active !== 'green') bad(`active must be blue or green, got ${JSON.stringify(s.active)}`);
  for (const k of ['activeImage', 'activeSha', 'previousImage']) if (!strOrNull(s[k])) bad(`${k} must be a string or null`);
  if (s.previousSha !== undefined && !strOrNull(s.previousSha)) bad('previousSha must be a string or null');
  if (s.deploying !== undefined) {
    const d = s.deploying as Record<string, unknown> | null;
    if (typeof d !== 'object' || d === null || typeof d.sha !== 'string' || typeof d.startedAt !== 'string'
      || !(STEPS as readonly unknown[]).includes(d.step)) bad('deploying must be { sha, step, startedAt }');
  }
  return { previousSha: null, ...s } as GuardState;
}

/** null when state.json does not exist; throws when it exists but cannot be trusted. */
export async function readState(dir: string): Promise<GuardState | null> {
  let text: string;
  try {
    text = await readFile(join(dir, FILE), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    bad(`not JSON (${(e as Error).message})`);
  }
  return validate(parsed);
}

export async function writeState(dir: string, s: GuardState): Promise<void> {
  const target = join(dir, FILE);
  const tmp = join(dir, `.${FILE}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const fh = await open(tmp, 'wx', 0o600);
  try {
    await fh.writeFile(`${JSON.stringify(s, null, 2)}\n`);
    await fh.sync();
  } catch (e) {
    await fh.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw e;
  }
  await fh.close();
  try {
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  // make the rename itself durable
  const d = await open(dir, 'r');
  try { await d.sync(); } finally { await d.close(); }
}
