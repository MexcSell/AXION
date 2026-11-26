// Git side of the Guard's effects, against its own bare repository (<root>/repo.git). Argument arrays only.
//   resolve:    git --git-dir <repo> rev-parse --verify <ref>^{commit}
//   liveSha:    git --git-dir <repo> rev-parse --verify refs/heads/evolve/main^{commit}
//   isAncestor: git --git-dir <repo> merge-base --is-ancestor <a> <b>          (exit 0 = yes, 1 = no, other = error)
//   diff:       git --git-dir <repo> diff --name-status -z -M <base> <sha>
//   advance:    git --git-dir <repo> update-ref refs/heads/evolve/main <sha> <old>   (compare-and-swap; the last action)
//   archive:    git --git-dir <repo> archive --format=tar -o <file> <sha>

import type { Change } from './deploy.ts';
import type { GuardConfig } from './config.ts';
import type { Host, RunResult } from './host.ts';

export const MAIN_REF = 'refs/heads/evolve/main';
const SHA_RE = /^[0-9a-f]{40}$/;

export function assertSha(v: string, what: string): void {
  if (!SHA_RE.test(v)) throw new Error(`${what} must be a full 40-char lowercase commit sha, got ${JSON.stringify(v)}`);
}

/** A ref the CLI accepts (a branch/tag name or a sha): no option-like start, no revision syntax (`..`, `@{`, `^`, `~`, `:`). */
export function isPlainRef(ref: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('/')
    && !ref.endsWith('.lock') && !ref.endsWith('.');
}

const firstLine = (s: string) => s.trim().split('\n')[0] ?? '';
const why = (r: RunResult) => firstLine(r.stderr) || firstLine(r.stdout) || `exit ${r.code}`;

/**
 * Parses `git diff --name-status -z -M` output: `<status>\0<path>\0` or, for renames/copies, `<status>\0<old>\0<new>\0`.
 * Status letters other than A/M/D/R are passed through as is (classify treats them as modifications).
 */
export function parseNameStatusZ(out: string): Change[] {
  if (out === '') return [];
  const parts = out.split('\0');
  if (parts[parts.length - 1] !== '') throw new Error('malformed git diff -z output (no trailing NUL)');
  parts.pop();
  const changes: Change[] = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (!/^[A-Z][0-9]*$/.test(status)) throw new Error(`malformed git diff -z output (status ${JSON.stringify(status)})`);
    const letter = status[0];
    if (letter === 'R' || letter === 'C') {
      if (i + 2 > parts.length) throw new Error('malformed git diff -z output (rename without two paths)');
      const oldPath = parts[i++];
      const path = parts[i++];
      changes.push({ path, status: letter as Change['status'], oldPath });
    } else {
      if (i + 1 > parts.length) throw new Error('malformed git diff -z output (status without a path)');
      changes.push({ path: parts[i++], status: letter as Change['status'] });
    }
  }
  return changes;
}

export function gitOps(cfg: GuardConfig, host: Host) {
  const git = (args: string[], timeoutMs = 120_000) => host.run('git', ['--git-dir', cfg.repo, ...args], { timeoutMs });
  const must = async (args: string[], timeoutMs?: number) => {
    const r = await git(args, timeoutMs);
    if (r.code !== 0) throw new Error(`git ${args[0]}: ${why(r)}`);
    return r.stdout;
  };
  const revParse = async (spec: string) => {
    const sha = (await must(['rev-parse', '--verify', `${spec}^{commit}`])).trim();
    assertSha(sha, `git rev-parse ${spec}`);
    return sha;
  };
  return {
    /** the commit a CLI ref names (refused when it looks like an option or revision syntax) */
    async resolve(ref: string): Promise<string> {
      if (!isPlainRef(ref)) throw new Error(`not a plain ref or sha: ${JSON.stringify(ref)}`);
      return revParse(ref);
    },
    liveSha: () => revParse(MAIN_REF),
    async isAncestor(a: string, b: string): Promise<boolean> {
      assertSha(a, 'isAncestor a');
      assertSha(b, 'isAncestor b');
      const r = await git(['merge-base', '--is-ancestor', a, b]);
      if (r.code === 0) return true;
      if (r.code === 1) return false;
      throw new Error(`git merge-base: ${why(r)}`);
    },
    async diff(base: string, sha: string): Promise<Change[]> {
      assertSha(base, 'diff base');
      assertSha(sha, 'diff sha');
      return parseNameStatusZ(await must(['diff', '--name-status', '-z', '-M', base, sha]));
    },
    /** compare-and-swap of evolve/main from `old` to `sha`; throws (ref unchanged) if evolve/main is not at `old` */
    async updateMain(sha: string, old: string): Promise<void> {
      assertSha(sha, 'advance sha');
      assertSha(old, 'advance old value');
      await must(['update-ref', MAIN_REF, sha, old]);
    },
    async archive(sha: string, file: string): Promise<void> {
      assertSha(sha, 'archive sha');
      await must(['archive', '--format=tar', '-o', file, sha], 10 * 60_000);
    },
  };
}
