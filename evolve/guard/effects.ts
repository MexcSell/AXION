// The real `Effects` for the deploy core (deploy.ts): git (effects-git.ts) + Docker (effects-docker.ts) + the lock file and
// history.jsonl (here). One instance per CLI run; `ctx` carries that run's front port, database, sha and watch options.

import { appendFile, mkdir, open, readFile, unlink } from 'node:fs/promises';
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
};

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The single Guard lock: `file` created exclusively with this pid inside. Held by a running pid → `Busy`. A lock whose
 * pid is not running is stale (a killed Guard) and is taken over, with a log line. A lock file without a pid is never
 * taken over (fail closed). Returns the release function (removes the file only while it still holds this pid).
 */
export async function acquireLock(file: string, host: Host, isAlive: (pid: number) => boolean = pidAlive): Promise<() => Promise<void>> {
  await mkdir(dirname(file), { recursive: true });
  const mine = String(process.pid);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(file, 'wx', 0o600);
      try { await fh.writeFile(`${mine}\n`); } finally { await fh.close(); }
      return async () => {
        try {
          if ((await readFile(file, 'utf8')).trim() === mine) await unlink(file);
        } catch { /* already gone */ }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const text = (await readFile(file, 'utf8').catch(() => '')).trim();
    if (!/^[1-9]\d*$/.test(text)) {
      throw new Error(`${file} exists but holds no pid (${JSON.stringify(text.slice(0, 40))}); remove it by hand if no axion-guard is running`);
    }
    const pid = Number(text);
    if (isAlive(pid)) throw new Busy(`a deploy is already running (pid ${pid} holds ${file})`);
    host.log(`taking over a stale lock: ${file} was held by pid ${pid}, which is not running`);
    await unlink(file).catch(() => {});
  }
  throw new Busy(`could not take ${file} (another axion-guard took it first)`);
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
    switchTo: (slot) => d.switchTo(slot),
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
  };
}
