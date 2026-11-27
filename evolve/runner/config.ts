// The runner's constants (evolution step 2): caps, kill switches, the agents that act, and every host path it uses.
// Caps (plan Global Constraints): attempts per change 3; engineer wall time 30 min per attempt; reviewer 5 min; changes
// per UTC day 12; 2 consecutive rolled-back changes → the runner writes PAUSED and stops claiming.
// Root: AXION_GUARD_ROOT (default /srv/axion-evolve), the same variable the Guard reads, so a trial root moves both.

import { isAbsolute, join } from 'node:path';

export const CAPS = {
  attempts: 3,
  engineerMs: 30 * 60_000,
  reviewerMs: 5 * 60_000,
  changesPerDay: 12,
  rollbacksToPause: 2,
} as const;

export const TIMING = {
  /** the service polls for work (and for a lifted kill switch) this often */
  pollMs: 30_000,
  /** the Guard answered busy (exit 4): wait, then deploy again, for at most busyMaxMs */
  busyWaitMs: 60_000,
  busyMaxMs: 30 * 60_000,
  /** while the Guard deploys: how often history.jsonl is read for step lines to mirror */
  mirrorMs: 3_000,
  /** at start: how long to wait for a Guard deploy a previous runner left running before reconciling it */
  reconcileMaxMs: 3 * 60 * 60_000,
  missionCliMs: 120_000,
  typecheckMs: 10 * 60_000,
  /** backstop for one `axion-guard deploy` (build 45 + checks 30 + backup 30 + migrate 15 + watch 10 min + boot/smoke) */
  deployMs: 4 * 60 * 60_000,
  gitMs: 10 * 60_000,
} as const;

/** lines of a failing log (typecheck, Guard reason) fed back to the engineer's next attempt */
export const FEEDBACK_LINES = 80;
/** a larger `git diff --text` is not gated (fail closed: it cannot be scanned whole) */
export const MAX_DIFF_BYTES = 8 * 1024 * 1024;
/** runner-history.jsonl keeps the newest this many lines */
export const HISTORY_KEEP = 1000;

/** progress `by` ids (the AXION agents that act on an improve mission) */
export const AGENTS = { gm: 'gm', engineer: 'web-dev-01', reviewer: 'tester-01', release: 'release-01' } as const;

/** the Guard's CLI (installed by install.sh; runs the Guard's own copy) */
export const GUARD_BIN = '/usr/local/bin/axion-guard';
/** the OS user whose uid:gid the mission CLI container runs as (peer auth on the DB socket) */
export const DB_USER = 'axion';
export const SOCKET_DIR = '/var/run/postgresql';
/** git ref prefix of the commits handed to the Guard: incoming/evolve-<mission>-a<n> */
export const REF_PREFIX = 'incoming/evolve-';
/** container names the runner owns (the startup sweep removes leftovers of a killed runner) */
export const CONTAINER_PREFIXES = ['axion-workshop-', 'axion-evolve-tc-', 'axion-evolve-cli-'] as const;
/** the containers that run agent work (the Workshop runs hold TOKEN1): removed on a stop signal and by ExecStopPost */
export const WORKER_PREFIXES = ['axion-workshop-', 'axion-evolve-tc-'] as const;
/** the Guard's output while the runner waits for it: <root>/runner-guard/<sha12>-<hex>.log (a file, never a pipe) */
export const GUARD_LOG_DIR = 'runner-guard';

export type RunnerPaths = {
  root: string;
  paused: string;
  lock: string;
  history: string;
  /** the change trees: <changes>/<mission>/a<n>/{tree,objects,index,check} (NOT <root>/work: the Guard sweeps that) */
  changes: string;
  secretsDir: string;
  workshopEnv: string;
  repo: string;
  guardHistory: string;
  guardLock: string;
  guardCommitFile: string;
};

export function runnerPaths(env: Record<string, string | undefined> = process.env): RunnerPaths {
  const v = env.AXION_GUARD_ROOT?.trim();
  const root = v ? v : '/srv/axion-evolve';
  if (!isAbsolute(root)) throw new Error(`AXION_GUARD_ROOT must be an absolute path, got ${root}`);
  return {
    root,
    paused: join(root, 'PAUSED'),
    lock: join(root, 'runner.lock'),
    history: join(root, 'runner-history.jsonl'),
    changes: join(root, 'changes'),
    secretsDir: join(root, 'secrets'),
    workshopEnv: join(root, 'secrets', 'workshop.env'),
    repo: join(root, 'repo.git'),
    guardHistory: join(root, 'history.jsonl'),
    guardLock: join(root, 'guard.lock'),
    guardCommitFile: join(root, 'guard', 'INSTALLED_COMMIT'),
  };
}
