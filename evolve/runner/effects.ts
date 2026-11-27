// The runner's real effects (evolution step 2): files under the root, git in the Guard's bare repository, the Workshop
// (workshop.ts), the typecheck container, the mission CLI in the live image, and the Guard's CLI. Argument arrays only,
// never a shell string; no secret is ever an argument (the Workshop token travels only in its root-only --env-file).
//
// The commit (plan Global Constraints): the Workshop gets an exported tree without .git. The runner builds the commit
// with git plumbing in the Guard's repository with a temporary index AND a scratch object directory
// (<change>/a<n>/{index,objects}, the repository's objects as alternates), hooks and fsmonitor off, no system/global
// config (so no filter, textconv, external diff or excludes from anywhere but repo.git), `add -A -f` (the exact tree, an
// ignored file too). Nothing enters repo.git before the secret gate passed (importObjects); a secret hit deletes the
// change directory and with it every object the engineer's tree produced. No push to GitHub, ever.

import { spawn } from 'node:child_process';
import { appendFile, chmod, copyFile, mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { acquireLock, currentBootId } from '../guard/effects.ts';
import { Busy } from '../guard/deploy.ts';
import { readState } from '../guard/state.ts';
import { assertSha, isPlainRef, MAIN_REF, parseNameStatusZ } from '../guard/effects-git.ts';
import { LOG_OPTS } from '../guard/effects-docker.ts';
import { realHost } from '../guard/host.ts';
import type { Host } from '../guard/host.ts';
import { realExec, runEngineer, runReviewer, WORKSHOP_DEFAULTS } from './workshop.ts';
import type { Exec, WorkshopConfig } from './workshop.ts';
import type { Mission } from './prompts.ts';
import type { DeployAnswer, GuardResult, GuardStep, HistoryEntry, MissionCli, RunnerEffects, WriteResult } from './loop.ts';
import { CONTAINER_PREFIXES, DB_USER, GUARD_BIN, HISTORY_KEEP, MAX_DIFF_BYTES, REF_PREFIX, SOCKET_DIR, TIMING } from './config.ts';
import type { RunnerPaths } from './config.ts';

export type ProcResult = { code: number; stdout: string; stderr: string; truncated: boolean };
export type ProcOpts = {
  input?: string;
  /** the WHOLE environment of the child (not merged); default: the runner's own */
  env?: Record<string, string>;
  timeoutMs?: number;
  /** stdout beyond this is dropped and `truncated` set (default 16 MB) */
  maxBytes?: number;
};
export type Proc = (cmd: string, args: string[], o?: ProcOpts) => Promise<ProcResult>;

/** spawn without a shell; stdin from `input`; resolves with the exit code; rejects when it cannot run or times out */
export const realProc: Proc = (cmd, args, o = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: o.env ?? process.env });
  const max = o.maxBytes ?? 16 * 1024 * 1024;
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let outSize = 0;
  let errSize = 0;
  let truncated = false;
  child.stdout.on('data', (b: Buffer) => {
    if (outSize + b.length > max) { truncated = true; const room = max - outSize; if (room > 0) { out.push(b.subarray(0, room)); outSize = max; } return; }
    out.push(b); outSize += b.length;
  });
  child.stderr.on('data', (b: Buffer) => { err.push(b); errSize += b.length; while (errSize > 1024 * 1024 && err.length > 1) errSize -= err.shift()!.length; });
  child.stdin.on('error', () => { /* closed early; the exit code tells */ });
  child.stdin.end(o.input ?? '');
  let timedOut = false;
  const timer = o.timeoutMs ? setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
  }, o.timeoutMs) : null;
  child.on('error', (e) => { if (timer) clearTimeout(timer); reject(new Error(`${cmd}: ${e.message}`)); });
  child.on('close', (code, signal) => {
    if (timer) clearTimeout(timer);
    if (timedOut) { reject(new Error(`${cmd} ${args[0] ?? ''} timed out after ${o.timeoutMs} ms`)); return; }
    resolve({ code: code ?? (signal ? 128 : 1), stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), truncated });
  });
});

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,40}$/;
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DB_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const UIDGID_RE = /^\d{1,10}:\d{1,10}$/;
const tail = (s: string, n = 400) => (s.length > n ? `…${s.slice(-n)}` : s).trim();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const hex = (n: number) => randomBytes(n).toString('hex');

/** git options for every call on runner-owned or engineer-written data */
const GIT_SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'core.quotePath=false',
  '-c', 'core.untrackedCache=false', '-c', 'core.splitIndex=false', '-c', 'core.attributesFile=/dev/null', '-c', 'core.excludesFile=/dev/null',
  '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.symlinks=true'];
const AUTHOR = { GIT_AUTHOR_NAME: 'AXION engineer', GIT_AUTHOR_EMAIL: 'engineer@axion.invalid', GIT_COMMITTER_NAME: 'axion-evolve', GIT_COMMITTER_EMAIL: 'evolve@axion.invalid' };
const INJECTOR = { GIT_AUTHOR_NAME: 'axion-evolve inject-failure', GIT_AUTHOR_EMAIL: 'evolve@axion.invalid', GIT_COMMITTER_NAME: 'axion-evolve', GIT_COMMITTER_EMAIL: 'evolve@axion.invalid' };

// ---- the exit demo's failure (once --inject-failure only) ----

/** the line in server/src/app.ts (buildApp) after which the failure hook is inserted; it must appear exactly once */
export const INJECT_ANCHOR = "  app.decorate('leader', leader);\n";
const INJECT_MARK = 'axion-evolve once --inject-failure';
/**
 * The hook: GET /api/v1/health answers 503 only in lock mode (AXION_LEADER=lock, the Guard's slots), only while this process
 * holds the leader lock, and only once this app is older than 60 s. The offline boot (sole leader for seconds), the smoke
 * (standby) and the checks (test apps live seconds) pass; after the switch the slot becomes the leader, and a minute
 * later the watch sees 503 through the front and rolls it back. server/src/app.ts is not protected; no flagged construct.
 */
export const INJECT_HOOK = [
  `  // ${INJECT_MARK} (evolution step 2 exit demo): a deliberate failure the Guard's watch must roll back.`,
  '  const injectedSince = Date.now();',
  "  app.addHook('onRequest', async (req, reply) => {",
  "    if ((cfg.leaderMode ?? 'always') === 'lock' && req.method === 'GET' && req.url.split('?')[0] === '/api/v1/health'",
  '      && leader.isLeader() && Date.now() - injectedSince > 60_000) {',
  `      return reply.code(503).send({ ok: false, injected: '${INJECT_MARK}' });`,
  '    }',
  '  });',
  '',
].join('\n');

export function injectFailurePatch(src: string): string {
  if (src.includes(INJECT_MARK)) throw new Error('inject-failure: server/src/app.ts already carries the injected hook');
  const n = src.split(INJECT_ANCHOR).length - 1;
  if (n !== 1) throw new Error(`inject-failure: the anchor ${JSON.stringify(INJECT_ANCHOR.trim())} appears ${n} times in server/src/app.ts (needs exactly 1)`);
  return src.replace(INJECT_ANCHOR, INJECT_ANCHOR + INJECT_HOOK);
}

// ---- small parsers ----

/** the values of KEY=VALUE lines (optional `export`, optional quotes) that are 12+ characters */
export function parseEnvValues(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=(.*)$/.exec(raw.replace(/\r$/, ''));
    if (!m) continue;
    let v = m[1].trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    if (v.length >= 12) out.push(v);
  }
  return out;
}

/** the Guard's JSON result line (`{outcome,…}`) among its other stdout lines; null when there is none */
export function parseGuardResult(stdout: string): GuardResult | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(lines[i]) as Record<string, unknown>;
      if (v && typeof v === 'object' && typeof v.outcome === 'string') return v as GuardResult;
    } catch { /* not the result line */ }
  }
  return null;
}

/** the typecheck container's script (constant: no interpolation of anything from the candidate or the mission) */
export const TYPECHECK_SCRIPT = [
  'set -u',
  'mkdir /tmp/c && cp -R /cand/. /tmp/c/ || { echo "AXION-TC copy failed"; exit 3; }',
  'rm -rf /tmp/c/server/node_modules /tmp/c/web/node_modules',
  'ln -s /app/server/node_modules /tmp/c/server/node_modules && ln -s /app/web/node_modules /tmp/c/web/node_modules || { echo "AXION-TC link failed"; exit 3; }',
  'echo "== server: tsc --noEmit -p ."',
  'cd /tmp/c/server && node /app/server/node_modules/typescript/bin/tsc --noEmit -p . 2>&1; s=$?',
  'echo "== web: tsc --noEmit -p ."',
  'cd /tmp/c/web && node /app/web/node_modules/typescript/bin/tsc --noEmit -p . 2>&1; w=$?',
  'echo "AXION-TC server=$s web=$w"',
  '[ "$s" = 0 ] && [ "$w" = 0 ]',
].join('\n');

export type EffectsOptions = {
  paths: RunnerPaths;
  proc?: Proc;
  /** the Workshop's Exec (docker for the engineer and the reviewer) */
  exec?: Exec;
  guardBin?: string;
  log?: (m: string) => void;
  stopping?: () => boolean;
  /** aborts sleep() early (the service's SIGTERM) */
  signal?: AbortSignal;
  /** the Guard's prefix (AXION_GUARD_PREFIX, default axion): the live image is <prefix>-app:<tag> */
  prefix?: string;
  /** tests: the uid:gid of the DB user instead of `id -u/-g axion` */
  uidGid?: string;
  maxDiffBytes?: number;
};

export function makeEffects(o: EffectsOptions): RunnerEffects {
  const P = o.paths;
  const proc = o.proc ?? realProc;
  const exec = o.exec ?? realExec;
  const log = o.log ?? ((m: string) => { process.stderr.write(`axion-evolve: ${m}\n`); });
  const prefix = o.prefix ?? 'axion';
  const guardBin = o.guardBin ?? GUARD_BIN;
  const maxDiff = o.maxDiffBytes ?? MAX_DIFF_BYTES;
  const host: Host = { ...realHost, log };
  let ids: string | null = o.uidGid ?? null;

  const changeDirOf = (id: string, attempt?: number) => {
    if (!ID_RE.test(id)) throw new Error(`invalid mission id ${JSON.stringify(id)}`);
    return attempt === undefined ? join(P.changes, id) : join(P.changes, id, `a${attempt}`);
  };
  const must = async (cmd: string, args: string[], po: ProcOpts = {}) => {
    const r = await proc(cmd, args, po);
    if (r.code !== 0) throw new Error(`${cmd} ${args.filter((a) => !a.startsWith('-c') && !a.includes('=')).slice(0, 3).join(' ')}: ${tail(r.stderr || r.stdout) || `exit ${r.code}`}`);
    return r;
  };

  // ---- git ----
  const gitEnv = (changeDir?: string, extra: Record<string, string> = {}): Record<string, string> => ({
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    ...(changeDir && existsSync(join(changeDir, 'objects'))
      ? { GIT_INDEX_FILE: join(changeDir, 'index'), GIT_OBJECT_DIRECTORY: join(changeDir, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: join(P.repo, 'objects') }
      : {}),
    ...extra,
  });
  const git = (args: string[], po: { changeDir?: string; tree?: string; env?: Record<string, string>; input?: string; maxBytes?: number } = {}) =>
    proc('git', [...GIT_SAFE, ...(po.tree ? ['-C', po.tree, '--work-tree', po.tree] : []), '--git-dir', P.repo, ...args],
      { env: gitEnv(po.changeDir, po.env), input: po.input, timeoutMs: TIMING.gitMs, maxBytes: po.maxBytes });
  const gitMust = async (args: string[], po: Parameters<typeof git>[1] = {}) => {
    const r = await git(args, po);
    if (r.code !== 0) throw new Error(`git ${args[0]}: ${tail(r.stderr || r.stdout) || `exit ${r.code}`}`);
    return r.stdout.trim();
  };
  const revParse = async (spec: string, changeDir?: string) => {
    const sha = await gitMust(['rev-parse', '--verify', '--end-of-options', spec], { changeDir });
    assertSha(sha, `git rev-parse ${spec}`);
    return sha;
  };
  /** the tree at <changeDir>/tree as a commit on `parent`, in the scratch object dir; null when it equals parent's tree */
  async function commitTree(changeDir: string, parent: string, message: string, who: Record<string, string>): Promise<string | null> {
    assertSha(parent, 'commit parent');
    const tree = join(changeDir, 'tree');
    await mkdir(join(changeDir, 'objects'), { recursive: true, mode: 0o700 });
    await rm(join(changeDir, 'index'), { force: true });
    await gitMust(['read-tree', parent], { changeDir, tree });
    await gitMust(['add', '-A', '-f', '--', '.'], { changeDir, tree });
    const t = await gitMust(['write-tree'], { changeDir, tree });
    const before = await revParse(`${parent}^{tree}`, changeDir);
    if (t === before) return null;
    const sha = await gitMust(['commit-tree', t, '-p', parent, '-F', '-'], { changeDir, env: who, input: message });
    assertSha(sha, 'commit-tree');
    return sha;
  }
  const fullRef = (ref: string) => {
    if (!ref.startsWith(REF_PREFIX) || !isPlainRef(ref)) throw new Error(`the runner writes only ${REF_PREFIX}* refs, got ${JSON.stringify(ref)}`);
    return `refs/heads/${ref}`;
  };

  // ---- the mission CLI in the live image ----
  async function live(): Promise<{ image: string; database: string }> {
    const s = await readState(P.root);
    if (!s || typeof s.activeImage !== 'string' || !TAG_RE.test(s.activeImage)) throw new Error('state.json names no live image (activeImage); the mission CLI runs from it');
    const database = typeof s.database === 'string' ? s.database : 'axion';
    if (!DB_RE.test(database)) throw new Error(`state.json database is not a database name: ${JSON.stringify(database)}`);
    return { image: `${prefix}-app:${s.activeImage}`, database };
  }
  async function uidGid(): Promise<string> {
    if (ids) return ids;
    const u = (await must('id', ['-u', DB_USER])).stdout.trim();
    const g = (await must('id', ['-g', DB_USER])).stdout.trim();
    const v = `${u}:${g}`;
    if (!UIDGID_RE.test(v)) throw new Error(`id ${DB_USER}: unexpected ${JSON.stringify(v)}`);
    ids = v;
    return v;
  }
  async function cli(cmd: string, args: string[] = [], input?: string): Promise<{ code: number; out: Record<string, unknown> }> {
    const { image, database } = await live();
    const name = `axion-evolve-cli-${hex(4)}`;
    const argv = ['run', '--rm', '-i', '--name', name, '--network', 'none', '--user', await uidGid(), ...LOG_OPTS,
      '-v', `${SOCKET_DIR}:${SOCKET_DIR}`, '-e', `DATABASE_URL=postgresql:///${database}?host=${SOCKET_DIR}&user=${DB_USER}`,
      '-w', '/app/server', image, 'node', '--import', 'tsx', 'src/cli/evolve-missions.ts', cmd, ...args];
    let r: ProcResult;
    try {
      r = await proc('docker', argv, { input: input ?? '', timeoutMs: TIMING.missionCliMs });
    } catch (e) {
      await proc('docker', ['rm', '-f', name], { timeoutMs: 60_000 }).catch(() => null);
      throw e;
    }
    const line = r.stdout.trim().split('\n').at(-1) ?? '';
    let out: unknown;
    try { out = JSON.parse(line); } catch { out = null; }
    if (!out || typeof out !== 'object' || Array.isArray(out)) throw new Error(`evolve-missions ${cmd}: exit ${r.code}, no JSON line (${tail(r.stderr, 300)})`);
    return { code: r.code, out: out as Record<string, unknown> };
  }
  async function write(cmd: 'progress' | 'finish' | 'approved', id: string, body?: unknown): Promise<WriteResult> {
    if (!ID_RE.test(id)) throw new Error(`invalid mission id ${JSON.stringify(id)}`);
    const { code, out } = await cli(cmd, [id], body === undefined ? undefined : JSON.stringify(body));
    if (code === 0 && out.ok === true) return { ok: true };
    if (code === 1 && typeof out.error === 'string' && out.error !== 'failed') return { ok: false, refusal: out as { error: string } };
    throw new Error(`evolve-missions ${cmd} ${id}: exit ${code} ${JSON.stringify(out).slice(0, 300)}`);
  }
  const missions: MissionCli = {
    async halted() {
      try {
        const { code, out } = await cli('halted');
        if (code === 0 && out.halted === false) return { halted: false };
        if (code === 0 && out.halted === true) return { halted: true, reason: typeof out.reason === 'string' ? out.reason : 'halted' };
        return { halted: true, reason: `the halt check failed (exit ${code}): ${JSON.stringify(out).slice(0, 200)}` };
      } catch (e) {
        return { halted: true, reason: `the halt check failed: ${msg(e).slice(0, 200)}` };
      }
    },
    async recover() {
      const { code, out } = await cli('recover');
      if (code !== 0 || !Array.isArray(out.recovered)) throw new Error(`evolve-missions recover: exit ${code} ${JSON.stringify(out).slice(0, 200)}`);
      return out.recovered.map(String);
    },
    async next() {
      const { code, out } = await cli('next');
      if (code !== 0) throw new Error(`evolve-missions next: exit ${code} ${JSON.stringify(out).slice(0, 200)}`);
      const m = out.mission as Record<string, unknown> | null | undefined;
      if (m === null || m === undefined) return null;
      if (typeof m.id !== 'string' || typeof m.title !== 'string' || typeof m.text !== 'string' || !Array.isArray(m.criteria)) {
        throw new Error(`evolve-missions next: unexpected mission shape ${JSON.stringify(Object.keys(m))}`);
      }
      const mission: Mission = { id: m.id, title: m.title, text: m.text, criteria: m.criteria.map(String) };
      if (typeof m.owner === 'string') mission.owner = m.owner;
      return mission;
    },
    progress: (id, body) => write('progress', id, body),
    finish: (id, body) => write('finish', id, body),
    approved: (id) => write('approved', id),
  };

  async function readSecrets(): Promise<string[]> {
    const files = (await readdir(P.secretsDir)).filter((f) => f.endsWith('.env')).sort();
    const vals = new Set<string>();
    for (const f of files) for (const v of parseEnvValues(await readFile(join(P.secretsDir, f), 'utf8'))) vals.add(v);
    return [...vals];
  }
  async function workshopCfg(): Promise<WorkshopConfig> {
    const commit = (await readFile(P.guardCommitFile, 'utf8')).trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${P.guardCommitFile} holds no commit sha`);
    const secrets = await readSecrets();
    return { ...WORKSHOP_DEFAULTS, envFile: P.workshopEnv, image: `axion-workshop:${commit.slice(0, 12)}`, secrets };
  }

  async function readFrom(file: string, offset: number): Promise<{ text: string; size: number }> {
    let fh;
    try { fh = await open(file, 'r'); } catch { return { text: '', size: offset }; }
    try {
      const { size } = await fh.stat();
      if (size <= offset) return { text: '', size: Math.min(size, offset) };
      const buf = Buffer.alloc(size - offset);
      await fh.read(buf, 0, buf.length, offset);
      return { text: buf.toString('utf8'), size };
    } finally { await fh.close(); }
  }
  const sizeOf = async (file: string) => { try { return (await stat(file)).size; } catch { return 0; } };

  function pidAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    if (o.signal?.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    o.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

  return {
    missions,
    secrets: readSecrets,

    async paused() {
      try {
        const t = await readFile(P.paused, 'utf8');
        return t.trim() === '' ? 'paused' : t.trim();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        return `PAUSED exists but cannot be read (${msg(e)})`;
      }
    },
    async writePaused(reason) {
      await writeFile(P.paused, `${reason.trim()}\n`, { mode: 0o600 });
    },
    async clearPaused() {
      try { await unlink(P.paused); return true; } catch { return false; }
    },

    async readHistory() {
      let text: string;
      try { text = await readFile(P.history, 'utf8'); } catch { return []; }
      const out: HistoryEntry[] = [];
      for (const l of text.split('\n')) {
        if (!l.trim()) continue;
        try {
          const v = JSON.parse(l) as HistoryEntry;
          if (v && typeof v === 'object' && typeof v.event === 'string') out.push(v);
        } catch { /* a torn line */ }
      }
      return out;
    },
    async appendHistory(e) {
      await mkdir(P.root, { recursive: true });
      await appendFile(P.history, `${JSON.stringify({ at: new Date().toISOString(), ...e })}\n`, { mode: 0o600 });
      await chmod(P.history, 0o600);
      const lines = (await readFile(P.history, 'utf8')).split('\n').filter((l) => l.trim());
      if (lines.length > HISTORY_KEEP + HISTORY_KEEP / 4) {
        const tmp = `${P.history}.${process.pid}.tmp`;
        await writeFile(tmp, `${lines.slice(-HISTORY_KEEP).join('\n')}\n`, { mode: 0o600 });
        await rename(tmp, P.history);
      }
    },

    async lock() {
      try {
        return await acquireLock(P.lock, host);
      } catch (e) {
        if (e instanceof Busy) return null;
        throw e;
      }
    },

    async sweep() {
      const removed: string[] = [];
      const r = await proc('docker', ['ps', '-a', '--format', '{{.Names}}'], { timeoutMs: 60_000 });
      if (r.code === 0) {
        const mine = r.stdout.split('\n').map((l) => l.trim()).filter((n) => CONTAINER_PREFIXES.some((p) => n.startsWith(p) && n.length > p.length));
        if (mine.length) {
          await proc('docker', ['rm', '-f', ...mine], { timeoutMs: 120_000 }).catch(() => null);
          removed.push(...mine);
        }
      } else {
        log(`sweep: docker ps failed: ${tail(r.stderr)}`);
      }
      await mkdir(P.changes, { recursive: true, mode: 0o700 });
      await chmod(P.changes, 0o700);
      for (const e of await readdir(P.changes)) {
        await rm(join(P.changes, e), { recursive: true, force: true });
        removed.push(join(P.changes, e));
      }
      return removed;
    },

    liveSha: () => revParse(`${MAIN_REF}^{commit}`),

    async exportTree(id, attempt, base) {
      assertSha(base, 'export base');
      await mkdir(P.changes, { recursive: true, mode: 0o700 });
      await chmod(P.changes, 0o700);
      const dir = changeDirOf(id, attempt);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tar = join(dir, 'tree.tar');
      await gitMust(['archive', '--format=tar', '-o', tar, base]);
      await mkdir(join(dir, 'tree'), { mode: 0o755 });
      await must('tar', ['-x', '--no-same-owner', '-f', tar, '-C', join(dir, 'tree')], { timeoutMs: TIMING.gitMs });
      await rm(tar, { force: true });
      // the Workshop runs as uid 1000; -h: a symlink itself, never its target
      await must('chown', ['-R', '-h', '1000:1000', join(dir, 'tree')], { timeoutMs: TIMING.gitMs });
      return dir;
    },

    async engineer(e) {
      return runEngineer(e, exec, await workshopCfg());
    },
    async reviewer(r) {
      return runReviewer(r, exec, await workshopCfg());
    },

    commit: ({ changeDir, parent, message }) => commitTree(changeDir, parent, message, AUTHOR),

    async injectFailure({ changeDir, parent }) {
      const file = join(changeDir, 'tree', 'server', 'src', 'app.ts');
      const st = await stat(file);
      if (!st.isFile()) throw new Error('inject-failure: server/src/app.ts is not a regular file in the tree');
      await writeFile(file, injectFailurePatch(await readFile(file, 'utf8')));
      const sha = await commitTree(changeDir, parent, `evolve: injected failure (${INJECT_MARK})\n\nThe Guard's watch must roll this back.\n`, INJECTOR);
      if (!sha) throw new Error('inject-failure: the patch produced no change');
      return sha;
    },

    async diff(changeDir, base, sha) {
      assertSha(base, 'diff base');
      assertSha(sha, 'diff sha');
      const t = await git(['diff', '--text', '--no-ext-diff', '--no-textconv', '--no-color', '-M', base, sha, '--'], { changeDir, maxBytes: maxDiff });
      if (t.code !== 0) throw new Error(`git diff: ${tail(t.stderr)}`);
      if (t.truncated) throw new Error(`the diff is larger than ${maxDiff} bytes; it is not gated in part (nothing pushed)`);
      const files = parseNameStatusZ(await git(['diff', '--name-status', '-z', '-M', '--no-ext-diff', base, sha, '--'], { changeDir })
        .then((r) => { if (r.code !== 0) throw new Error(`git diff --name-status: ${tail(r.stderr)}`); return r.stdout; }));
      const stat = (await gitMust(['diff', '--stat=120', '--no-color', '--no-ext-diff', base, sha, '--'], { changeDir })).slice(-7000);
      return { text: t.stdout, files, stat };
    },

    async importObjects(changeDir, base, sha) {
      assertSha(base, 'import base');
      assertSha(sha, 'import sha');
      const src = join(changeDir, 'objects');
      const dst = join(P.repo, 'objects');
      for (const d of await readdir(src)) {
        if (d === 'info') continue;
        const from = join(src, d);
        if (!(await stat(from)).isDirectory()) continue;
        await mkdir(join(dst, d), { recursive: true });
        for (const f of await readdir(from)) {
          const target = join(dst, d, f);
          if (existsSync(target)) continue;
          const tmp = join(dst, d, `.tmp-${process.pid}-${hex(4)}`);
          await copyFile(join(from, f), tmp);
          await rename(tmp, target);
        }
      }
      // every object of base..sha now in repo.git (without the scratch dir)
      const r = await git(['rev-list', '--objects', sha, '--not', base]);
      if (r.code !== 0) throw new Error(`import: repo.git is missing objects of ${sha}: ${tail(r.stderr)}`);
    },

    async typecheck({ changeDir, sha, name }) {
      assertSha(sha, 'typecheck sha');
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/.test(name)) throw new Error(`invalid typecheck name ${JSON.stringify(name)}`);
      const { image } = await live();
      const check = join(changeDir, 'check');
      await rm(check, { recursive: true, force: true });
      await mkdir(check, { recursive: true, mode: 0o755 });
      const tar = join(changeDir, 'check.tar');
      try {
        await gitMust(['archive', '--format=tar', '-o', tar, sha]);
        await must('tar', ['-x', '--no-same-owner', '-f', tar, '-C', check], { timeoutMs: TIMING.gitMs });
        await rm(tar, { force: true });
        const cname = `axion-evolve-tc-${name}`;
        await proc('docker', ['rm', '-f', cname], { timeoutMs: 60_000 }).catch(() => null);
        const argv = ['run', '--rm', '--name', cname, '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=2g',
          '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512', '--memory', '4g', ...LOG_OPTS,
          '-v', `${check}:/cand:ro`, '-w', '/tmp', '--entrypoint', 'sh', image, '-c', TYPECHECK_SCRIPT];
        let r: ProcResult;
        try {
          r = await proc('docker', argv, { timeoutMs: TIMING.typecheckMs });
        } catch (e) {
          await proc('docker', ['rm', '-f', cname], { timeoutMs: 60_000 }).catch(() => null);
          return { ok: false, log: `the typecheck did not finish: ${msg(e)}` };
        }
        const out = `${r.stdout}\n${r.stderr}`.trim();
        const m = /AXION-TC server=(\d+) web=(\d+)/.exec(out);
        return { ok: r.code === 0 && m !== null && m[1] === '0' && m[2] === '0', log: out.slice(-60_000) };
      } finally {
        await rm(tar, { force: true });
        await rm(check, { recursive: true, force: true });
      }
    },

    async resolveRef(ref) {
      const r = await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${fullRef(ref)}^{commit}`]);
      const v = r.stdout.trim();
      return r.code === 0 && /^[0-9a-f]{40}$/.test(v) ? v : null;
    },
    async setRef(ref, sha) {
      assertSha(sha, 'ref sha');
      await gitMust(['update-ref', fullRef(ref), sha]);
    },
    async deleteRef(ref) {
      const full = fullRef(ref);
      const r = await git(['update-ref', '-d', full]);
      if (r.code !== 0 && !/not exist|unable to resolve/i.test(r.stderr)) throw new Error(`git update-ref -d ${full}: ${tail(r.stderr)}`);
    },
    async removeChange(id) {
      await rm(changeDirOf(id), { recursive: true, force: true });
    },

    async deploy(d, onStep) {
      assertSha(d.sha, 'deploy sha');
      if (!isPlainRef(d.ref)) throw new Error(`not a plain ref ${JSON.stringify(d.ref)}`);
      const args = ['deploy', d.ref, ...(d.approve ? ['--approve', d.approve.sha, '--approve-base', d.approve.base] : [])];
      let offset = await sizeOf(P.guardHistory);
      let partial = '';
      const poll = async () => {
        const { text, size } = await readFrom(P.guardHistory, offset);
        if (size < offset) { offset = size; return; } // rotated or truncated: start over from its end
        offset = size;
        const lines = (partial + text).split('\n');
        partial = lines.pop() ?? '';
        for (const l of lines) {
          try {
            const e = JSON.parse(l) as Record<string, unknown>;
            if (e.sha !== d.sha || (e.event !== 'start' && e.event !== 'end') || typeof e.step !== 'string') continue;
            const s: GuardStep = { step: e.step, event: e.event };
            if (typeof e.ok === 'boolean') s.ok = e.ok;
            if (typeof e.detail === 'string') s.detail = e.detail.slice(0, 300);
            onStep(s);
          } catch { /* not a step line */ }
        }
      };
      let done = false;
      const run = proc(guardBin, args, { timeoutMs: TIMING.deployMs }).then(
        (r) => { done = true; return r; },
        (e: unknown) => { done = true; return { code: 1, stdout: '', stderr: `axion-guard did not finish: ${msg(e)}`, truncated: false } as ProcResult; },
      );
      while (!done) {
        await Promise.race([run, new Promise((r) => setTimeout(r, TIMING.mirrorMs))]);
        await poll().catch(() => {});
      }
      const r = await run;
      await poll().catch(() => {});
      const answer: DeployAnswer = { code: r.code, result: parseGuardResult(r.stdout), stderr: tail(r.stderr, 4000) };
      return answer;
    },

    async guardOutcome(sha, since) {
      let text: string;
      try { text = await readFile(P.guardHistory, 'utf8'); } catch { return null; }
      let found: GuardResult | null = null;
      for (const l of text.split('\n')) {
        if (!l.includes(sha)) continue;
        try {
          const e = JSON.parse(l) as Record<string, unknown>;
          if (e.sha !== sha || e.event !== 'outcome' || typeof e.outcome !== 'string') continue;
          if (since && (typeof e.at !== 'string' || e.at < since)) continue;
          const g: GuardResult = { outcome: e.outcome };
          if (typeof e.failedStep === 'string') g.failedStep = e.failedStep;
          if (typeof e.reason === 'string') g.reason = e.reason;
          if (Array.isArray(e.hits)) g.hits = e.hits.map(String);
          found = g;
        } catch { /* torn line */ }
      }
      return found;
    },

    async guardBusy() {
      let text: string;
      try { text = await readFile(P.guardLock, 'utf8'); } catch { return false; }
      const [pidText = '', bootText = ''] = text.split('\n').map((l) => l.trim());
      if (!/^[1-9]\d*$/.test(pidText)) return true; // a lock without a pid: the Guard refuses too; treat as busy
      const boot = currentBootId();
      if (bootText !== '' && boot !== '' && bootText !== boot) return false;
      return pidAlive(Number(pidText));
    },

    now: () => Date.now(),
    sleep,
    log,
    stopping: o.stopping ?? (() => false),
  };
}
