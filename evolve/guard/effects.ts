// The real `Effects` for the deploy core (deploy.ts): git (effects-git.ts) + Docker (effects-docker.ts) + the lock file and
// history.jsonl (here). One instance per CLI run; `ctx` carries that run's front port, database, sha and watch options.

import { appendFile, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Busy } from './deploy.ts';
import type { Effects, HistoryEntry } from './deploy.ts';
import type { GuardConfig } from './config.ts';
import type { Host } from './host.ts';
import { gitOps } from './effects-git.ts';
import { dockerOps } from './effects-docker.ts';
import type { DeployContext } from './effects-docker.ts';

export { renderFrontConf } from './effects-docker.ts';
export type { DeployContext };

export type GuardEffects = Effects & {
  /** the commit a CLI ref names in the Guard's repository */
  resolve(ref: string): Promise<string>;
  pruneImages(active: string | null, previous: string | null): Promise<{ kept: string[]; removed: string[]; warnings: string[] }>;
  /** removes a killed Guard's throw-away containers/networks/volumes and work files (call under the lock) */
  sweepLeftovers(): Promise<string[]>;
  /** compare-and-swap of evolve/main from `old` to `sha` (any direction; `axion-guard revert` moves it back) */
  moveMain(sha: string, old: string): Promise<void>;
  /** the image reference a slot's container was created from; null when the container is missing */
  slotImage(slot: 'blue' | 'green'): Promise<string | null>;
};

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** this boot's id (/proc/sys/kernel/random/boot_id); '' when the kernel does not provide one */
export function currentBootId(): string {
  try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { return ''; }
}

export type LockOpts = {
  isAlive?: (pid: number) => boolean; bootId?: string; attempts?: number;
  /** tests only: runs after an attempt found the file present, before it is read (to stage the release race) */
  afterExists?: () => void;
};

/**
 * The single Guard lock: `file` created exclusively, holding `<pid>\n<boot_id>\n`. Held by a running pid of this boot →
 * `Busy`. Stale (taken over, with a log line): a pid that is not running, or a lock written during another boot (after a
 * reboot its pid may belong to an unrelated process). A file that vanishes between "exists" and the read (its holder just
 * released it) is retried. A file that holds no pid is never taken over (fail closed); the error says how to clear it.
 * A lock without a boot id (written before M3) is judged by its pid only. Returns the release function (removes the file
 * only while it still holds this pid).
 */
export async function acquireLock(file: string, host: Host, opts: LockOpts | ((pid: number) => boolean) = {}): Promise<() => Promise<void>> {
  const o: LockOpts = typeof opts === 'function' ? { isAlive: opts } : opts;
  const isAlive = o.isAlive ?? pidAlive;
  const boot = o.bootId ?? currentBootId();
  const attempts = o.attempts ?? 5;
  await mkdir(dirname(file), { recursive: true });
  const mine = String(process.pid);
  const clear = `if no axion-guard is running (check: pgrep -af axion-guard), remove it with: rm ${file}`;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const fh = await open(file, 'wx', 0o600);
      try { await fh.writeFile(`${mine}\n${boot}\n`); } finally { await fh.close(); }
      return async () => {
        try {
          if ((await readFile(file, 'utf8')).split('\n')[0].trim() === mine) await unlink(file);
        } catch { /* already gone */ }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    o.afterExists?.();
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; // released between our open and our read: try again
      throw e;
    }
    const [pidText = '', bootText = ''] = text.split('\n').map((l) => l.trim());
    if (!/^[1-9]\d*$/.test(pidText)) {
      throw new Error(`${file} exists but holds no pid (${JSON.stringify(text.trim().slice(0, 40))}); ${clear}`);
    }
    const pid = Number(pidText);
    const otherBoot = bootText !== '' && boot !== '' && bootText !== boot;
    if (!otherBoot && isAlive(pid)) {
      throw new Busy(`a deploy is already running (pid ${pid} holds ${file}); if that is not an axion-guard (pgrep -af axion-guard), remove it with: rm ${file}`);
    }
    host.log(`taking over a stale lock: ${file} was held by pid ${pid}, ${otherBoot ? `written during another boot (${bootText})` : 'which is not running'}`);
    await unlink(file).catch(() => {});
  }
  throw new Busy(`could not take ${file} after ${attempts} attempts (other axion-guard runs took it first)`);
}

export function makeEffects(cfg: GuardConfig, host: Host, ctx: DeployContext): GuardEffects {
  const git = gitOps(cfg, host);
  const d = dockerOps(cfg, host, ctx);
  /** the live commit this run's diff was taken from: the old value of the compare-and-swap in advance */
  let base: string | null = null;
  return {
    lock: () => acquireLock(cfg.lockFile, host),
    liveSha: () => git.liveSha(),
    async diff(b, sha) {
      const changes = await git.diff(b, sha);
      base = b;
      return changes;
    },
    isAncestor: (a, b) => git.isAncestor(a, b),
    build: (sha) => d.build(sha),
    checks: (image) => d.checks(image),
    bootOffline: (image) => d.bootOffline(image),
    backup: () => d.backup(),
    migrate: (image) => d.migrate(image),
    startSlot: (slot, image) => d.startSlot(slot, image),
    smoke: (slot) => d.smoke(slot),
    drain: (slot) => d.drain(slot),
    switchTo: (slot, expectCommit) => d.switchTo(slot, expectCommit),
    stopSlot: (slot) => d.stopSlot(slot),
    watch: (slot, ms) => d.watch(slot, ms),
    async record(entry: HistoryEntry) {
      await mkdir(dirname(cfg.historyFile), { recursive: true });
      await appendFile(cfg.historyFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    },
    async advance(sha) {
      if (base === null) throw new Error('advance: no base known (the diff was not taken in this run); evolve/main not moved');
      await git.updateMain(sha, base);
    },
    resolve: (ref) => git.resolve(ref),
    pruneImages: (active, previous) => d.pruneImages(active, previous),
    sweepLeftovers: () => d.sweepLeftovers(),
    slotImage: (slot) => d.slotImage(slot),
    moveMain: (sha, old) => git.updateMain(sha, old),
  };
}
