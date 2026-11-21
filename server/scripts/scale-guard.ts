import { basename, resolve } from 'node:path';

/** The database a lane worktree may wipe: axion_e2e<N> for the worktree /…/AXION-w<N>. Anything else is refused. */
export function laneDbOf(worktreeRoot: string): string {
  const m = /^AXION-w(\d+)$/.exec(basename(resolve(worktreeRoot)));
  if (!m) throw new Error('scale-bench runs only inside a lane worktree named AXION-w<N>');
  return `axion_e2e${m[1]}`;
}
export function assertOwnLaneDb(url: string | undefined, worktreeRoot: string): void {
  const own = laneDbOf(worktreeRoot);
  const name = url ? new URL(url).pathname.replace(/^\//, '') : '';
  if (name !== own) throw new Error(`refusing to wipe "${name}": this lane may only use ${own}`);
}
