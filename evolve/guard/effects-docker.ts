// Docker side of the Guard's effects: build, checks, offline boot, migrate, slots, the front proxy, watch, image retention.
// Every command is `docker <args…>` with an argument array (never a shell string). Secrets (throw-away passwords, an
// overridden DATABASE_URL) reach containers as `-e NAME` with the value in the docker CLI's environment, never in argv.
// The exact command lines are listed in the Task 6 report and pinned by effects.test.ts.

import { chmod, copyFile, cp, mkdir, mkdtemp, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Slot } from './deploy.ts';
import { names } from './config.ts';
import type { GuardConfig } from './config.ts';
import type { Host, RunOpts, RunResult } from './host.ts';
import { assertSha } from './effects-git.ts';

export type DeployContext = {
  /** host port the front publishes (0.0.0.0:<port> → 8080) */
  frontPort: number;
  /** database name the slots use (only the name inside the live env file's DATABASE_URL is replaced) */
  database: string;
  /** watch requires leader:true (default true; --no-expect-leader → false) */
  expectLeader?: boolean;
  /** grace wait before the switch (default 5000) */
  drainMs?: number;
  /** the candidate commit (watch compares the front's health commit with it) */
  sha?: string;
};

type Health = { ok?: unknown; commit?: unknown; leader?: unknown };
type State = 'missing' | 'running' | 'stopped';

const DB_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TAG_RE = /^[0-9a-f]{12}-\d{8}T\d{6}Z$/;
const CONTAINER_RE = /^[a-z0-9][a-z0-9_.-]*$/;
const SLOT_HEALTH = 'http://127.0.0.1:4190/api/v1/health';

const other = (s: Slot): Slot => (s === 'blue' ? 'green' : 'blue');
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** the last few non-empty lines of a failed command (docker build/BuildKit puts the reason at the end) */
export function errTail(r: RunResult, n = 5): string {
  const lines = `${r.stderr}\n${r.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(-n).join(' | ') || `exit ${r.code}`;
}

function parseHealth(text: string): Health | null {
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

async function readSummary(file: string): Promise<{ passed?: unknown; ok?: unknown } | null> {
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
function envFileValue(text: string, key: string): string | undefined {
  let v: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i).trim() === key) v = line.slice(i + 1);
  }
  return v;
}

export function dockerOps(cfg: GuardConfig, host: Host, ctx: DeployContext) {
  const n = names(cfg);
  let userCache: string | null = null;
  let switchedAt: number | null = null;

  /** every docker call has a timeout (a hung daemon must not hang the Guard); long ones pass their own */
  const docker = (args: string[], opts?: RunOpts) => host.run('docker', args, { timeoutMs: 120_000, ...opts });
  const must = async (args: string[], opts?: RunOpts) => {
    const r = await docker(args, opts);
    if (r.code !== 0) throw new Error(`docker ${args[0]}${args[0] === 'exec' || args[0] === 'network' ? ` ${args[1]}` : ''}: ${errTail(r)}`);
    return r;
  };

  async function state(name: string): Promise<State> {
    const r = await docker(['container', 'inspect', '--format', '{{.State.Running}}', name]);
    if (r.code === 0) return r.stdout.trim() === 'true' ? 'running' : 'stopped';
    if (/no such (container|object)/i.test(r.stderr)) return 'missing';
    throw new Error(`docker container inspect ${name}: ${errTail(r)}`);
  }

  /** `<uid>:<gid>` of the OS user the slots run as, looked up once */
  async function user(): Promise<string> {
    if (userCache) return userCache;
    const ids: string[] = [];
    for (const flag of ['-u', '-g']) {
      const r = await host.run('id', [flag, cfg.osUser]);
      const v = r.stdout.trim();
      if (r.code !== 0 || !/^\d+$/.test(v)) throw new Error(`cannot look up the ${cfg.osUser} user (id ${flag}): ${errTail(r)}`);
      ids.push(v);
    }
    userCache = ids.join(':');
    return userCache;
  }

  /** the slots' DATABASE_URL: the live env file's, with only the database name replaced by ctx.database */
  async function dbUrl(): Promise<{ url: string; overridden: boolean }> {
    if (!DB_NAME_RE.test(ctx.database)) throw new Error(`not a database name: ${JSON.stringify(ctx.database)}`);
    const live = envFileValue(await readFile(cfg.liveEnvFile, 'utf8'), 'DATABASE_URL');
    if (!live) throw new Error(`${cfg.liveEnvFile} has no DATABASE_URL`);
    const u = new URL(live);
    if (decodeURIComponent(u.pathname.replace(/^\//, '')) === ctx.database) return { url: live, overridden: false };
    u.pathname = `/${ctx.database}`;
    return { url: u.toString(), overridden: true };
  }

  /** update --restart no, then a graceful stop (SIGTERM, 30 s): app.close lets in-flight answers finish */
  async function retire(name: string): Promise<void> {
    await must(['update', '--restart', 'no', name]);
    await must(['stop', '-t', String(cfg.stopTimeoutS), name]);
  }

  /** polls `docker exec <name> curl …/api/v1/health` until ok:true; gives up when the container stops or on timeout */
  async function waitHealthy(name: string, timeoutMs = cfg.healthTimeoutMs): Promise<{ ok: boolean; commit: string | null; reason?: string }> {
    const start = host.now();
    let last = 'no answer';
    for (;;) {
      const r = await docker(['exec', name, 'curl', '-sf', '--max-time', '5', SLOT_HEALTH]);
      if (r.code === 0) {
        const h = parseHealth(r.stdout);
        const commit = typeof h?.commit === 'string' ? h.commit : null;
        if (h?.ok === true) return { ok: true, commit };
        last = `health answered ${r.stdout.trim().slice(0, 200)}`;
      } else {
        last = `curl exit ${r.code}`;
        if ((await state(name)) !== 'running') return { ok: false, commit: null, reason: `${name} is not running` };
      }
      if (host.now() - start >= timeoutMs) return { ok: false, commit: null, reason: `${name} not healthy after ${timeoutMs} ms (${last})` };
      await host.sleep(cfg.healthIntervalMs);
    }
  }

  async function waitPg(name: string): Promise<void> {
    const start = host.now();
    for (;;) {
      const r = await docker(['exec', name, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']);
      if (r.code === 0) return;
      if (host.now() - start >= 90_000) throw new Error(`throw-away postgres ${name} not ready: ${errTail(r)}`);
      await host.sleep(1_000);
    }
  }

  async function cleanup(args: string[][]): Promise<void> {
    for (const a of args) {
      try { await docker(a); } catch (e) { host.log(`cleanup docker ${a.join(' ')} failed: ${msg(e)}`); }
    }
  }

  async function workDir(): Promise<string> {
    await mkdir(cfg.workDir, { recursive: true, mode: 0o700 });
    return cfg.workDir;
  }

  // ---- front ----

  const frontConf = join(cfg.frontDir, 'default.conf');
  const frontUrl = () => `http://127.0.0.1:${ctx.frontPort}/api/v1/health`;

  async function createFront(): Promise<void> {
    // created on the edge network only, joined to the live network, then started: nginx resolves the upstream at start
    await must(['create', '--name', n.front, '--network', cfg.edgeNetwork, '--restart', 'unless-stopped',
      '-p', `0.0.0.0:${ctx.frontPort}:8080`, '-v', `${cfg.frontDir}:/etc/nginx/conf.d:ro`, cfg.frontImage]);
    try {
      await must(['network', 'connect', cfg.liveNetwork, n.front]);
      await must(['start', n.front]);
    } catch (e) {
      await cleanup([['rm', '-f', n.front]]);
      throw e;
    }
  }

  async function frontPort(): Promise<number | null> {
    const r = await must(['container', 'inspect', '--format', '{{json .HostConfig.PortBindings}}', n.front]);
    try {
      const b = JSON.parse(r.stdout) as Record<string, { HostPort?: string }[]> | null;
      const p = Number(b?.['8080/tcp']?.[0]?.HostPort);
      return Number.isInteger(p) ? p : null;
    } catch {
      return null;
    }
  }

  /** writes the conf for `target`, (re)creates or reloads the front, and waits until the front serves `commit` */
  async function routeFront(target: string, commit: string | null): Promise<void> {
    const template = await readFile(join(cfg.evolveDir, 'front', 'nginx.conf.tpl'), 'utf8');
    const conf = renderFrontConf(template, target);
    const prev = existsSync(frontConf) ? await readFile(frontConf, 'utf8') : null;
    await writeAtomic(frontConf, conf);
    /** before the front picked the new file up: put the previous one back (the running nginx still has it loaded) */
    const restoreConf = async () => {
      if (prev === null) await unlink(frontConf).catch(() => {});
      else await writeAtomic(frontConf, prev);
    };
    const st = await state(n.front);
    if (st === 'missing') {
      await createFront();
    } else if ((await frontPort()) !== ctx.frontPort) {
      // move to another port: the old front keeps serving (renamed aside) until the new one has started; if the new
      // one cannot start (e.g. the port is taken), the old one gets its name back untouched
      const aside = `${n.front}-old`;
      await cleanup([['rm', '-f', aside]]);
      await must(['rename', n.front, aside]);
      try {
        await createFront();
      } catch (e) {
        await must(['rename', aside, n.front]);
        await restoreConf();
        throw e;
      }
      await cleanup([['rm', '-f', aside]]);
    } else if (st === 'stopped') {
      await must(['start', n.front]);
    } else {
      const t = await docker(['exec', n.front, 'nginx', '-t']);
      if (t.code !== 0) {
        await restoreConf();
        throw new Error(`nginx -t refused the config for ${target}: ${errTail(t)}`);
      }
      await must(['exec', n.front, 'nginx', '-s', 'reload']);
    }
    const start = host.now();
    let last = '';
    for (;;) {
      try {
        const r = await host.fetchText(frontUrl(), 5_000);
        const h = parseHealth(r.body);
        if (r.status === 200 && h?.ok === true && (commit === null || h.commit === commit)) return;
        last = `HTTP ${r.status}, commit ${String(h?.commit ?? 'none')}`;
      } catch (e) {
        last = msg(e);
      }
      if (host.now() - start >= cfg.frontTimeoutMs) {
        throw new Error(`the front on port ${ctx.frontPort} does not serve ${target}${commit ? ` (commit ${commit})` : ''} after ${cfg.frontTimeoutMs} ms: ${last}`);
      }
      await host.sleep(1_000);
    }
  }

  // ---- watch ----

  async function errorLines(name: string, since: string): Promise<number> {
    const r = await docker(['logs', '--since', since, name]);
    if (r.code !== 0) throw new Error(`docker logs ${name}: ${errTail(r)}`);
    let count = 0;
    for (const line of `${r.stdout}\n${r.stderr}`.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      const lvl = (parseHealth(t) as { level?: unknown } | null)?.level;
      if ((typeof lvl === 'number' && lvl >= 50) || lvl === 'error' || lvl === 'fatal') count++;
    }
    return count;
  }

  return {
    user,
    dbUrl,

    async build(sha: string): Promise<string> {
      assertSha(sha, 'build sha');
      // fail closed: the trusted copy decides what goes into the image, never the candidate (R7/R11)
      if (!existsSync(cfg.dockerignore)) throw new Error(`the Guard's installed .dockerignore is missing (${cfg.dockerignore})`);
      if (!existsSync(join(cfg.evolveDir, 'docker', 'app.Dockerfile'))) throw new Error(`the Guard's installed evolve/ is incomplete (${cfg.evolveDir})`);
      const tag = imageTag(sha, host.now());
      const base = join(await workDir(), `build-${host.randomHex(4)}`);
      const tar = `${base}.tar`;
      try {
        await mkdir(base, { mode: 0o700 });
        const r = await host.run('git', ['--git-dir', cfg.repo, 'archive', '--format=tar', '-o', tar, sha], { timeoutMs: 10 * 60_000 });
        if (r.code !== 0) throw new Error(`git archive: ${errTail(r)}`);
        const x = await host.run('tar', ['-xf', tar, '-C', base], { timeoutMs: 10 * 60_000 });
        if (x.code !== 0) throw new Error(`tar: ${errTail(x)}`);
        await rm(join(base, 'evolve'), { recursive: true, force: true });
        await cp(cfg.evolveDir, join(base, 'evolve'), { recursive: true });
        await copyFile(cfg.dockerignore, join(base, '.dockerignore'));
        await must(['build', '-f', join(base, 'evolve', 'docker', 'app.Dockerfile'), '--build-arg', `AXION_COMMIT=${sha}`,
          '-t', n.app(tag), base], { timeoutMs: cfg.buildTimeoutMs });
        await must(['build', '-f', join(base, 'evolve', 'docker', 'checks.Dockerfile'), '--build-arg', `APP_IMAGE=${n.app(tag)}`,
          '-t', n.checks(tag), base], { timeoutMs: cfg.buildTimeoutMs });
        return tag;
      } finally {
        await rm(base, { recursive: true, force: true });
        await rm(tar, { force: true });
      }
    },

    async checks(tag: string): Promise<{ ok: boolean; passed: number; log: string }> {
      const id = `${cfg.prefix}-checks-${host.randomHex(4)}`;
      const pw = host.randomHex(24);
      const [net, vol, pg, run] = [id, `${id}-sock`, `${id}-pg`, `${id}-run`];
      const out = await mkdtemp(join(await workDir(), 'checks-'));
      try {
        // the checks run as the image's user (node, uid 1000); the dir sits inside the root-only work dir
        await chmod(out, 0o777);
        await must(['network', 'create', '--internal', net]);
        await must(['volume', 'create', vol]);
        await must(['run', '-d', '--name', pg, '--network', net, '-e', 'POSTGRES_PASSWORD', '-v', `${vol}:/var/run/postgresql`,
          cfg.postgresImage, '-c', 'max_connections=300'], { env: { POSTGRES_PASSWORD: pw } });
        await waitPg(pg);
        await must(['exec', pg, 'createdb', '-U', 'postgres', 'axion_test']);
        await must(['exec', pg, 'createdb', '-U', 'postgres', 'axion_e2e']);
        const r = await docker(['run', '--name', run, '--network', net, '--shm-size=1g',
          '-e', 'TEST_DATABASE_URL', '-e', 'E2E_DATABASE_URL', '-e', 'PGUSER=postgres', '-e', 'AXION_REQUIRE_SOCKET_TEST=1',
          '-v', `${cfg.repo}:/repo.git:ro`, '-e', 'GIT_DIR=/repo.git', '-e', 'GIT_WORK_TREE=/app',
          '-v', `${vol}:/var/run/postgresql`, '-v', `${out}:/out`, n.checks(tag)], {
          env: {
            TEST_DATABASE_URL: `postgresql://postgres:${pw}@${pg}:5432/axion_test`,
            E2E_DATABASE_URL: `postgresql://postgres:${pw}@${pg}:5432/axion_e2e`,
          },
          timeoutMs: cfg.checksTimeoutMs,
        });
        const log = `${r.stdout}\n${r.stderr}`.trim().slice(-4000);
        const summary = await readSummary(join(out, 'summary.json'));
        if (!summary) return { ok: false, passed: 0, log: `no summary.json (checks container exit ${r.code}): ${log}` };
        return { ok: r.code === 0 && summary.ok === true, passed: summary.passed as number, log };
      } finally {
        await cleanup([['rm', '-f', run, pg], ['volume', 'rm', vol], ['network', 'rm', net]]);
        await rm(out, { recursive: true, force: true });
      }
    },

    async bootOffline(tag: string): Promise<boolean> {
      const id = `${cfg.prefix}-boot-${host.randomHex(4)}`;
      const pw = host.randomHex(24);
      const [net, pg, app] = [id, `${id}-pg`, `${id}-app`];
      try {
        await must(['network', 'create', '--internal', net]);
        await must(['run', '-d', '--name', pg, '--network', net, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=axion', cfg.postgresImage],
          { env: { POSTGRES_PASSWORD: pw } });
        await waitPg(pg);
        await must(['run', '-d', '--init', '--name', app, '--network', net, '--user', await user(),
          '-e', 'DATABASE_URL', '-e', 'AXION_MIGRATE_ON_START=1', '-e', 'AXION_LEADER=lock',
          '-e', 'UPLOAD_DIR=/tmp/uploads', '-e', 'AUDIT_ANCHOR_FILE=/tmp/audit-anchors.jsonl', '-e', 'CLOUD_MODEL_HOME=/tmp/cloud-home',
          '-e', 'BACKUP_DIR=/tmp/backups', n.app(tag), 'node', 'evolve/slot/entry.mjs'],
        { env: { DATABASE_URL: `postgresql://postgres:${pw}@${pg}:5432/axion` } });
        const h = await waitHealthy(app);
        if (!h.ok) {
          const l = await docker(['logs', '--tail', '30', app]);
          host.log(`offline boot of ${n.app(tag)} failed: ${h.reason ?? ''}\n${`${l.stdout}\n${l.stderr}`.trim().slice(-3000)}`);
        }
        return h.ok;
      } finally {
        await cleanup([['rm', '-f', app, pg], ['network', 'rm', net]]);
      }
    },

    async migrate(tag: string): Promise<void> {
      const id = host.randomHex(4);
      const db = await dbUrl();
      const r = await docker(['run', '--rm', '--name', `${cfg.prefix}-migrate-${id}`, '--network', 'none', '--user', await user(),
        '--env-file', cfg.liveEnvFile, '-e', 'AXION_MIGRATE_ON_START=0', '-e', 'CLOUD_MODEL_HOME=/tmp/cloud-home',
        ...(db.overridden ? ['-e', 'DATABASE_URL'] : []),
        '-v', `${cfg.socketDir}:${cfg.socketDir}`, '-w', '/app/server', n.app(tag), 'node', '--import', 'tsx', 'src/migrate-cli.ts', 'up'],
      { ...(db.overridden ? { env: { DATABASE_URL: db.url } } : {}), timeoutMs: cfg.migrateTimeoutMs });
      if (r.code !== 0) throw new Error(`migrations failed: ${errTail(r)}`);
      host.log(`migrations: ${r.stdout.trim().split('\n').at(-1) ?? ''}`);
    },

    async backup(): Promise<string> {
      const db = await dbUrl();
      const r = await host.run(cfg.backupScript, [], {
        // EVOLVE_ROOT: evolve/backup.sh's root; BACKUP_SOURCE_URL/AXION_GUARD_DATABASE: the database this deploy's slots use
        env: { EVOLVE_ROOT: cfg.root, BACKUP_SOURCE_URL: db.url, AXION_GUARD_DATABASE: ctx.database }, timeoutMs: cfg.backupTimeoutMs,
      });
      if (r.code !== 0) throw new Error(`backup failed: ${errTail(r)}`);
      const path = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
      if (!path.startsWith('/') || /\s/.test(path)) throw new Error(`the backup script printed no dump path (last line ${JSON.stringify(path)})`);
      return path;
    },

    async startSlot(slot: Slot, tag: string): Promise<void> {
      const name = n.slot(slot);
      const st = await state(name);
      if (st === 'running') {
        host.log(`${name} is running although it is the idle slot; stopping it before replacing it`);
        await retire(name);
      }
      if (st !== 'missing') await must(['rm', name]);
      const db = await dbUrl();
      await must(['run', '-d', '--init', '--name', name, '--network', cfg.liveNetwork, '--user', await user(), '--restart', 'unless-stopped',
        '--env-file', cfg.liveEnvFile,
        '-e', 'AXION_LEADER=lock', '-e', 'AXION_MIGRATE_ON_START=0', '-e', `HTTPS_PROXY=${cfg.egressUrl}`, '-e', 'NO_PROXY=127.0.0.1,localhost',
        '-e', 'UPLOAD_DIR=/data/uploads', '-e', 'AUDIT_ANCHOR_FILE=/data/audit-anchors.jsonl', '-e', 'CLOUD_MODEL_HOME=/data/cloud-home',
        '-e', 'BACKUP_DIR=/backups', ...(db.overridden ? ['-e', 'DATABASE_URL'] : []),
        '-v', `${cfg.socketDir}:${cfg.socketDir}`, '-v', `${cfg.dataDir}:/data`, '-v', `${cfg.backupsDir}:/backups:ro`,
        n.app(tag), 'node', 'evolve/slot/entry.mjs'], db.overridden ? { env: { DATABASE_URL: db.url } } : undefined);
    },

    async smoke(slot: Slot): Promise<{ ok: boolean; commit: string | null }> {
      const name = n.slot(slot);
      const h = await waitHealthy(name);
      if (!h.ok) {
        host.log(`smoke ${name}: ${h.reason ?? 'not healthy'}`);
        return { ok: false, commit: h.commit };
      }
      const page = await docker(['exec', name, 'curl', '-sf', '--max-time', '5', '-o', '/dev/null', 'http://127.0.0.1:4190/']);
      if (page.code !== 0) host.log(`smoke ${name}: the page did not load (curl exit ${page.code})`);
      return { ok: page.code === 0, commit: h.commit };
    },

    async drain(slot: Slot): Promise<void> {
      if ((await state(n.slot(slot))) === 'missing') return;
      await host.sleep(ctx.drainMs ?? 5_000);
    },

    async switchTo(slot: Slot): Promise<void> {
      const target = n.slot(slot);
      const st = await state(target);
      if (st === 'missing') throw new Error(`cannot switch to ${target}: the container is missing`);
      await must(['update', '--restart', 'unless-stopped', target]);
      if (st === 'stopped') await must(['start', target]);
      const h = await waitHealthy(target);
      if (!h.ok) throw new Error(`cannot switch to ${target}: ${h.reason ?? 'not healthy'}`);
      switchedAt = host.now();
      await routeFront(target, h.commit);
      const old = n.slot(other(slot));
      if ((await state(old)) !== 'missing') await retire(old);
    },

    async stopSlot(slot: Slot): Promise<void> {
      const name = n.slot(slot);
      if ((await state(name)) === 'missing') return;
      await retire(name);
    },

    async watch(slot: Slot, ms: number): Promise<{ ok: boolean; reason?: string }> {
      const sha = ctx.sha;
      if (!sha) throw new Error('watch needs the candidate sha');
      const expectLeader = ctx.expectLeader !== false;
      const name = n.slot(slot);
      const start = host.now();
      const since = new Date(switchedAt ?? start).toISOString();
      let bad = 0;
      let sawLeader = false;
      for (;;) {
        const elapsed = host.now() - start;
        let problem: string | null = null;
        try {
          const r = await host.fetchText(frontUrl(), 5_000);
          const h = parseHealth(r.body);
          if (r.status !== 200) problem = `the front answered HTTP ${r.status}`;
          else if (!h) problem = 'health is not JSON';
          else if (h.ok !== true) problem = 'health ok is not true';
          else if (h.commit !== sha) problem = `the front serves commit ${String(h.commit)}, expected ${sha}`;
          else if (h.leader === true) sawLeader = true;
          else if (expectLeader && elapsed >= cfg.leaderGraceMs) problem = `leader is not true ${Math.round(elapsed / 1000)} s after the switch`;
        } catch (e) {
          problem = `the front is unreachable: ${msg(e)}`;
        }
        let errs = 0;
        try { errs = await errorLines(name, since); } catch (e) { problem ??= msg(e); }
        if (errs > cfg.errorLineLimit) {
          return { ok: false, reason: `${errs} error log lines (level >= 50) in ${name} since the switch (limit ${cfg.errorLineLimit})` };
        }
        if (problem) {
          bad++;
          if (bad >= cfg.badPollLimit) return { ok: false, reason: `${bad} consecutive bad polls (last: ${problem})` };
        } else {
          bad = 0;
        }
        if (elapsed >= ms) break;
        await host.sleep(Math.min(cfg.pollMs, ms - elapsed));
      }
      if (expectLeader && !sawLeader) return { ok: false, reason: 'the candidate never reported leader:true through the front' };
      return { ok: true };
    },

    /** keeps the active, the previous and the newest other `<prefix>-app:<sha12>-<utc>`; the same tags of `<prefix>-checks` */
    async pruneImages(active: string | null, previous: string | null): Promise<{ kept: string[]; removed: string[]; warnings: string[] }> {
      const list = async (repo: string) => (await must(['image', 'ls', '--format', '{{.Tag}}', repo])).stdout
        .split('\n').map((t) => t.trim()).filter((t) => TAG_RE.test(t));
      const byTime = (a: string, b: string) => a.slice(13).localeCompare(b.slice(13)) || a.localeCompare(b);
      const app = await list(n.appRepo);
      const checks = await list(n.checksRepo);
      const kept: string[] = [];
      for (const t of [active, previous]) if (t && !kept.includes(t)) kept.push(t);
      const rest = app.filter((t) => !kept.includes(t)).sort(byTime);
      if (rest.length > 0) kept.push(rest[rest.length - 1]);
      const removed: string[] = [];
      const warnings: string[] = [];
      const refs = [
        ...app.filter((t) => !kept.includes(t)).sort(byTime).map(n.app),
        ...checks.filter((t) => !kept.includes(t)).sort(byTime).map(n.checks),
      ];
      for (const ref of refs) {
        const r = await docker(['image', 'rm', ref]);
        if (r.code === 0) removed.push(ref);
        else warnings.push(`${ref}: ${errTail(r)}`);
      }
      return { kept, removed, warnings };
    },
  };
}
