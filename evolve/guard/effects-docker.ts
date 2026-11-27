// Docker side of the Guard's effects: build, checks, offline boot, migrate, slots, the front proxy, watch, image retention.
// Every command is `docker <args…>` with an argument array (never a shell string). Secrets never appear in argv: the
// throw-away postgres passwords and test database URLs reach containers as `-e NAME` with the value in the docker CLI's
// environment; a slot's DATABASE_URL comes from an --env-file (the live env file, or with --database a derived copy in
// the root-only work dir, removed right after `docker run`).
// Every container gets bounded json-file logs (LOG_OPTS); every network that holds candidate or live code is internal
// with no IPv4 address on the host side of the bridge (ISOLATED_NET), so containers on it cannot reach host services.
// The exact command lines are pinned by effects.test.ts.

import { chmod, copyFile, cp, mkdir, mkdtemp, open, readdir, readFile, rm, unlink } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Slot } from './deploy.ts';
import { names } from './config.ts';
import type { GuardConfig } from './config.ts';
import type { Host, RunOpts, RunResult } from './host.ts';
import { assertSha } from './effects-git.ts';
import { envFileValue, errTail, imageTag, parseHealth, readSummary, renderFrontConf, resolveRunAs, writeAtomic } from './effects-util.ts';

export { errTail, imageTag, renderFrontConf, writeAtomic };

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

type State = 'missing' | 'running' | 'stopped';

const DB_NAME_RE = /^[a-z_][a-z0-9_]*$/;
const TAG_RE = /^[0-9a-f]{12}-\d{8}T\d{6}Z$/;
/** the stage tags of one build: <prefix>-build:<tag>-deps / -browsers */
const BUILD_TAG_RE = /^[0-9a-f]{12}-\d{8}T\d{6}Z-(deps|browsers)$/;
const SLOT_HEALTH = 'http://127.0.0.1:4190/api/v1/health';
/** <repo>/info/attributes (written by install.sh): overrides any in-tree .gitattributes for `git archive` */
export const REPO_ATTRIBUTES = '* -export-ignore -export-subst';

/** every container the Guard starts: bounded logs (the json-file driver; at most 3 × 10 MB per container) */
export const LOG_OPTS = ['--log-opt', 'max-size=10m', '--log-opt', 'max-file=3'];
/**
 * `docker network create` options for every network holding candidate or live code: --internal (no route out) and no
 * IPv4 address on the bridge's host side, so the host's own services (sshd, web servers on the gateway address) are
 * unreachable too. Containers on the network still reach each other and Docker's DNS (verified in the fix wave).
 */
export const ISOLATED_NET = ['--internal', '-o', 'com.docker.network.bridge.inhibit_ipv4=true'];
/** the legacy builder (`--network none` for RUN steps; buildx/BuildKit is not installed on the host) */
const BUILD_ENV = { DOCKER_BUILDKIT: '0' };

const other = (s: Slot): Slot => (s === 'blue' ? 'green' : 'blue');
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

  /** `<uid>:<gid>` of the OS user the slots run as, looked up once (R31: never uid 0 or a login account) */
  async function user(): Promise<string> {
    if (userCache) return userCache;
    userCache = await resolveRunAs((c, a) => host.run(c, a), cfg.osUser);
    return userCache;
  }
  let workerCache: string | null = null;
  /** R31: `<uid>:<gid>` of the worker user (axion-ws): the checks container and the candidate's web build; looked up once */
  async function worker(): Promise<string> {
    if (workerCache) return workerCache;
    workerCache = await resolveRunAs((c, a) => host.run(c, a), cfg.workerUser);
    return workerCache;
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

  /**
   * The --env-file for a container on the live database: the live env file itself, or (with --database) a derived copy
   * in the root-only work dir with only DATABASE_URL replaced (mode 600). One env file, no `-e DATABASE_URL`: nothing
   * depends on which of two duplicate entries Docker keeps. `done()` removes the copy (call it right after `docker run`).
   */
  async function liveEnvFile(): Promise<{ file: string; done: () => Promise<void> }> {
    const db = await dbUrl();
    if (!db.overridden) return { file: cfg.liveEnvFile, done: async () => {} };
    const text = await readFile(cfg.liveEnvFile, 'utf8');
    const derived = text.split('\n').map((line) => {
      if (line.trim().startsWith('#')) return line;
      const i = line.indexOf('=');
      return i > 0 && line.slice(0, i).trim() === 'DATABASE_URL' ? `DATABASE_URL=${db.url}` : line;
    }).join('\n');
    const file = join(await workDir(), `env-${host.randomHex(4)}.env`);
    const fh = await open(file, 'wx', 0o600);
    try { await fh.writeFile(derived); } finally { await fh.close(); }
    return { file, done: () => rm(file, { force: true }) };
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
    await must(['create', '--name', n.front, '--network', cfg.edgeNetwork, '--restart', 'unless-stopped', ...LOG_OPTS,
      '-p', `0.0.0.0:${ctx.frontPort}:8080`, '-v', `${cfg.frontDir}:/etc/nginx/conf.d:ro`, cfg.frontImage]);
    try {
      await must(['network', 'connect', cfg.liveNetwork, n.front]);
      await must(['start', n.front]);
    } catch (e) {
      await cleanup([['rm', '-f', n.front]]);
      throw e;
    }
  }

  /** the front's published port and whether it has the Guard's log limits (a front created before them is recreated) */
  async function frontConfig(): Promise<{ port: number | null; logLimits: boolean }> {
    const r = await must(['container', 'inspect', '--format', '{{json .HostConfig}}', n.front]);
    try {
      const h = JSON.parse(r.stdout) as {
        PortBindings?: Record<string, { HostPort?: string }[]> | null; LogConfig?: { Type?: string; Config?: Record<string, string> | null };
      } | null;
      const p = Number(h?.PortBindings?.['8080/tcp']?.[0]?.HostPort);
      const lc = h?.LogConfig?.Config ?? {};
      return { port: Number.isInteger(p) ? p : null, logLimits: lc['max-size'] === '10m' && lc['max-file'] === '3' };
    } catch {
      return { port: null, logLimits: false };
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
    const fc = st === 'missing' ? null : await frontConfig();
    if (st === 'missing') {
      await createFront();
    } else if (fc!.port !== ctx.frontPort || !fc!.logLimits) {
      // recreate: another port, or a front created before the log limits. The old front is renamed aside. On another port
      // it keeps serving until the new one has started; on the same port it must be stopped first (about a second without
      // the site). If the new one cannot start (e.g. the port is taken), the old one gets its name back and is started.
      const aside = `${n.front}-old`;
      const samePort = fc!.port === ctx.frontPort;
      await cleanup([['rm', '-f', aside]]);
      await must(['rename', n.front, aside]);
      try {
        if (samePort && st === 'running') await must(['stop', '-t', '5', aside]);
        await createFront();
      } catch (e) {
        await must(['rename', aside, n.front]);
        if (samePort && st === 'running') await cleanup([['start', n.front]]);
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

  /**
   * 5xx answers the front gave for `target` since `since`: the front logs one JSON line per request to stdout
   * (nginx.conf.tpl, log_format axion_guard: status first, the slot baked in), so requests that died on the retiring slot
   * during the switch are not counted against the candidate.
   */
  async function front5xx(target: string, since: string): Promise<number> {
    const r = await docker(['logs', '--since', since, n.front]);
    if (r.code !== 0) throw new Error(`docker logs ${n.front}: ${errTail(r)}`);
    let count = 0;
    for (const line of r.stdout.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{"status":')) continue;
      const v = parseHealth(t) as { status?: unknown; slot?: unknown } | null;
      if (v?.slot === target && typeof v.status === 'number' && v.status >= 500) count++;
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
      // git archive honours in-tree .gitattributes (export-ignore/export-subst): a candidate could drop or rewrite files
      // in its own build. Two layers: the repo's info/attributes neutralises them, and a tree with any .gitattributes is refused.
      const attrFile = join(cfg.repo, 'info', 'attributes');
      const attrs = await readFile(attrFile, 'utf8').catch(() => null);
      if (attrs === null || attrs.replace(/\n$/, '') !== REPO_ATTRIBUTES) {
        throw new Error(`${attrFile} must contain exactly "${REPO_ATTRIBUTES}" (install.sh writes it); refusing to build`);
      }
      const ls = await host.run('git', ['--git-dir', cfg.repo, 'ls-tree', '-r', '-z', '--name-only', sha], { timeoutMs: 120_000 });
      if (ls.code !== 0 || ls.stdout.startsWith('[…output truncated…]')) throw new Error(`git ls-tree: ${errTail(ls)}`);
      const attrPaths = ls.stdout.split('\0').filter((p) => p === '.gitattributes' || p.endsWith('/.gitattributes'));
      if (attrPaths.length > 0) throw new Error(`the candidate contains ${attrPaths.join(', ')}; the Guard does not build trees with .gitattributes`);
      const tag = imageTag(sha, host.now());
      const base = join(await workDir(), `build-${host.randomHex(4)}`);
      const tar = `${base}.tar`;
      try {
        await mkdir(base, { mode: 0o700 });
        const r = await host.run('git', ['--git-dir', cfg.repo, 'archive', '--format=tar', '-o', tar, sha], { timeoutMs: 10 * 60_000 });
        if (r.code !== 0) throw new Error(`git archive: ${errTail(r)}`);
        const x = await host.run('tar', ['-xf', tar, '-C', base], { timeoutMs: 10 * 60_000 });
        if (x.code !== 0) throw new Error(`tar: ${errTail(x)}`);
        // the candidate's evolve/ and .dockerignore go entirely (a symlink is removed, never followed); the trusted copies
        // are written to fresh paths only (errorOnExist / COPYFILE_EXCL), so nothing is written through a candidate link
        await rm(join(base, 'evolve'), { recursive: true, force: true });
        await rm(join(base, '.dockerignore'), { recursive: true, force: true });
        await cp(cfg.evolveDir, join(base, 'evolve'), { recursive: true, force: false, errorOnExist: true });
        await copyFile(cfg.dockerignore, join(base, '.dockerignore'), constants.COPYFILE_EXCL);
        // I2: only the lockfile stages (target deps / browsers: no candidate file in them) are built with a network; every
        // stage holding the candidate tree, including the web build that runs the candidate's vite.config.ts, is built
        // with --network none (their lockfile stages come from the cache of the run before; a miss fails closed)
        const appFile = join(base, 'evolve', 'docker', 'app.Dockerfile');
        const checksFile = join(base, 'evolve', 'docker', 'checks.Dockerfile');
        const deps = n.build(`${tag}-deps`);
        const browsers = n.build(`${tag}-browsers`);
        const b = (args: string[]) => must(['build', '--force-rm', ...args, base], { timeoutMs: cfg.buildTimeoutMs, env: BUILD_ENV });
        // R31: the candidate's web build (its vite.config.ts) runs as the worker user, never as the image's node (uid 1000)
        const [buildUid, buildGid] = (await worker()).split(':');
        try {
          await b(['-f', appFile, '--target', 'deps', '-t', deps]);
          await b(['--network', 'none', '-f', appFile, '--build-arg', `AXION_COMMIT=${sha}`, '--build-arg', `AXION_BUILD_UID=${buildUid}`,
            '--build-arg', `AXION_BUILD_GID=${buildGid}`, '-t', n.app(tag)]);
          await b(['-f', checksFile, '--target', 'browsers', '--build-arg', `DEPS_IMAGE=${deps}`, '-t', browsers]);
          await b(['--network', 'none', '-f', checksFile, '--build-arg', `DEPS_IMAGE=${deps}`, '--build-arg', `APP_IMAGE=${n.app(tag)}`,
            '--build-arg', `AXION_COMMIT=${sha}`, '--build-arg', `AXION_BUILD_UID=${buildUid}`, '--build-arg', `AXION_BUILD_GID=${buildGid}`, '-t', n.checks(tag)]);
        } finally {
          // the stage tags only: their layers stay as long as the app/checks images built on them
          await cleanup([['image', 'rm', deps, browsers]]);
        }
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
        // R31: the checks run as the worker user (axion-ws, a non-login system user; never the image's node = uid 1000,
        // which is a login account on this host); /out is world-writable inside the root-only work dir
        const runAs = await worker();
        await chmod(out, 0o777);
        await must(['network', 'create', ...ISOLATED_NET, net]);
        await must(['volume', 'create', vol]);
        await must(['run', '-d', '--name', pg, '--network', net, ...LOG_OPTS, '-e', 'POSTGRES_PASSWORD', '-v', `${vol}:/var/run/postgresql`,
          cfg.postgresImage, '-c', 'max_connections=300'], { env: { POSTGRES_PASSWORD: pw } });
        await waitPg(pg);
        await must(['exec', pg, 'createdb', '-U', 'postgres', 'axion_test']);
        await must(['exec', pg, 'createdb', '-U', 'postgres', 'axion_e2e']);
        // I1: the candidate cannot rewrite its judge. The root filesystem is read-only (all of /app: tests, scripts,
        // node_modules), only /tmp (tmpfs), /out and /dev/shm are writable, and the script that runs is the Guard's
        // installed run-checks.sh, mounted read-only from outside /app. /tmp allows exec: tests run fake CLI scripts from there
        const r = await docker(['run', '--name', run, '--network', net, ...LOG_OPTS, '--shm-size=1g',
          '--read-only', '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=4g', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', runAs,
          '-v', `${join(cfg.evolveDir, 'slot', 'run-checks.sh')}:/guard/run-checks.sh:ro`,
          '-e', 'TEST_DATABASE_URL', '-e', 'E2E_DATABASE_URL', '-e', 'PGUSER=postgres', '-e', 'AXION_REQUIRE_SOCKET_TEST=1',
          '-v', `${cfg.repo}:/repo.git:ro`, '-e', 'GIT_DIR=/repo.git', '-e', 'GIT_WORK_TREE=/app',
          '-v', `${vol}:/var/run/postgresql`, '-v', `${out}:/out`, n.checks(tag), 'bash', '/guard/run-checks.sh'], {
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
        // -v: postgres:16-alpine declares VOLUME /var/lib/postgresql/data; without it every run leaks an anonymous volume.
        // The checks image goes right after its run, passed or not (I7: it is the biggest image and never used again).
        await cleanup([['rm', '-f', '-v', run, pg], ['volume', 'rm', vol], ['network', 'rm', net], ['image', 'rm', n.checks(tag)]]);
        await rm(out, { recursive: true, force: true });
      }
    },

    async bootOffline(tag: string): Promise<boolean> {
      const id = `${cfg.prefix}-boot-${host.randomHex(4)}`;
      const pw = host.randomHex(24);
      const [net, pg, app] = [id, `${id}-pg`, `${id}-app`];
      try {
        await must(['network', 'create', ...ISOLATED_NET, net]);
        await must(['run', '-d', '--name', pg, '--network', net, ...LOG_OPTS, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=axion', cfg.postgresImage],
          { env: { POSTGRES_PASSWORD: pw } });
        await waitPg(pg);
        await must(['run', '-d', '--init', '--name', app, '--network', net, ...LOG_OPTS, '--user', await user(),
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
        await cleanup([['rm', '-f', '-v', app, pg], ['network', 'rm', net]]);
      }
    },

    async migrate(tag: string): Promise<void> {
      const name = `${cfg.prefix}-migrate-${host.randomHex(4)}`;
      const env = await liveEnvFile();
      let r: RunResult;
      try {
        r = await docker(['run', '--rm', '--init', '--name', name, '--network', 'none', ...LOG_OPTS, '--user', await user(),
          '--env-file', env.file, '-e', 'AXION_MIGRATE_ON_START=0', '-e', 'CLOUD_MODEL_HOME=/tmp/cloud-home',
          '-v', `${cfg.socketDir}:${cfg.socketDir}`, '-w', '/app/server', n.app(tag), 'node', '--import', 'tsx', 'src/migrate-cli.ts', 'up'],
        { timeoutMs: cfg.migrateTimeoutMs });
      } finally {
        await env.done();
        // --rm only works while the docker CLI waits: after a timeout (CLI killed) the container would keep migrating
        await cleanup([['rm', '-f', name]]);
      }
      if (r.code !== 0) throw new Error(`migrations failed: ${errTail(r)}`);
      host.log(`migrations: ${r.stdout.trim().split('\n').at(-1) ?? ''}`);
    },

    async backup(): Promise<string> {
      if (!DB_NAME_RE.test(ctx.database)) throw new Error(`not a database name: ${JSON.stringify(ctx.database)}`);
      const r = await host.run(cfg.backupScript, [], {
        // the contract of evolve/backup.sh: EVOLVE_ROOT = its root; AXION_GUARD_DATABASE = the database this deploy's slots
        // use (only the name: the script connects through the socket as OS user axion)
        env: { EVOLVE_ROOT: cfg.root, AXION_GUARD_DATABASE: ctx.database }, timeoutMs: cfg.backupTimeoutMs,
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
      const env = await liveEnvFile();
      try {
        // the container keeps its environment from creation; a later `docker start` does not read the env file again
        await must(['run', '-d', '--init', '--name', name, '--network', cfg.liveNetwork, ...LOG_OPTS, '--user', await user(), '--restart', 'unless-stopped',
          '--env-file', env.file,
          '-e', 'AXION_LEADER=lock', '-e', 'AXION_MIGRATE_ON_START=0', '-e', `HTTPS_PROXY=${cfg.egressUrl}`, '-e', 'NO_PROXY=127.0.0.1,localhost',
          '-e', 'UPLOAD_DIR=/data/uploads', '-e', 'AUDIT_ANCHOR_FILE=/data/audit-anchors.jsonl', '-e', 'CLOUD_MODEL_HOME=/data/cloud-home',
          '-e', 'BACKUP_DIR=/backups',
          '-v', `${cfg.socketDir}:${cfg.socketDir}`, '-v', `${cfg.dataDir}:/data`, '-v', `${cfg.backupsDir}:/backups:ro`,
          n.app(tag), 'node', 'evolve/slot/entry.mjs']);
      } finally {
        await env.done();
      }
    },

    async smoke(slot: Slot): Promise<{ ok: boolean; commit: string | null }> {
      const name = n.slot(slot);
      const h = await waitHealthy(name);
      if (!h.ok) {
        host.log(`smoke ${name}: ${h.reason ?? 'not healthy'}`);
        return { ok: false, commit: h.commit };
      }
      // through the slot's own port (vite preview: the page, and /api proxied to the API): the page and a public API route
      const page = await docker(['exec', name, 'curl', '-sf', '--max-time', '5', '-o', '/dev/null', 'http://127.0.0.1:4190/']);
      if (page.code !== 0) {
        host.log(`smoke ${name}: the page did not load (curl exit ${page.code})`);
        return { ok: false, commit: h.commit };
      }
      const hello = await docker(['exec', name, 'curl', '-sf', '--max-time', '5', 'http://127.0.0.1:4190/api/v1/auth/hello']);
      if (hello.code !== 0 || parseHealth(hello.stdout) === null) {
        host.log(`smoke ${name}: /api/v1/auth/hello ${hello.code !== 0 ? `failed (curl exit ${hello.code})` : `is not JSON: ${hello.stdout.trim().slice(0, 200)}`}`);
        return { ok: false, commit: h.commit };
      }
      return { ok: true, commit: h.commit };
    },

    async drain(slot: Slot): Promise<void> {
      if ((await state(n.slot(slot))) === 'missing') return;
      await host.sleep(ctx.drainMs ?? 5_000);
    },

    async switchTo(slot: Slot, expectCommit?: string): Promise<void> {
      const target = n.slot(slot);
      const st = await state(target);
      if (st === 'missing') throw new Error(`cannot switch to ${target}: the container is missing`);
      await must(['update', '--restart', 'unless-stopped', target]);
      if (st === 'stopped') await must(['start', target]);
      const h = await waitHealthy(target);
      if (!h.ok) throw new Error(`cannot switch to ${target}: ${h.reason ?? 'not healthy'}`);
      if (expectCommit !== undefined && h.commit !== expectCommit) {
        throw new Error(`cannot switch to ${target}: it reports commit ${h.commit ?? 'none'}, expected ${expectCommit}`);
      }
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
        let fivexx = 0;
        try { fivexx = await front5xx(name, since); } catch (e) { problem ??= msg(e); }
        if (fivexx > cfg.front5xxLimit) {
          return { ok: false, reason: `${fivexx} 5xx answers from ${name} in the front's access log since the switch (limit ${cfg.front5xxLimit})` };
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

    /**
     * Under the lock, before a deploy: removes what a killed Guard left behind: throw-away containers (with their anonymous
     * volumes), networks and volumes named <prefix>-checks-<id>…, <prefix>-boot-<id>…, <prefix>-migrate-<id>, and the
     * work dir's contents (build contexts, checks output, derived env files). Returns what it removed.
     */
    async sweepLeftovers(): Promise<string[]> {
      const re = new RegExp(`^${cfg.prefix}-(checks|boot|migrate)-[0-9a-f]{8}(-(pg|run|app|sock))?$`);
      const list = async (args: string[]) => (await must(args)).stdout.split('\n').map((l) => l.trim()).filter((l) => re.test(l));
      const removed: string[] = [];
      const ctrs = await list(['ps', '-a', '--format', '{{.Names}}']);
      if (ctrs.length) { await cleanup([['rm', '-f', '-v', ...ctrs]]); removed.push(...ctrs); }
      const nets = await list(['network', 'ls', '--format', '{{.Name}}']);
      if (nets.length) { await cleanup([['network', 'rm', ...nets]]); removed.push(...nets.map((x) => `network ${x}`)); }
      const vols = await list(['volume', 'ls', '--format', '{{.Name}}']);
      if (vols.length) { await cleanup([['volume', 'rm', ...vols]]); removed.push(...vols.map((x) => `volume ${x}`)); }
      if (existsSync(cfg.workDir)) {
        for (const e of await readdir(cfg.workDir)) {
          await rm(join(cfg.workDir, e), { recursive: true, force: true });
          removed.push(join(cfg.workDir, e));
        }
      }
      return removed;
    },

    /** the image reference `slot`'s container was created from (`<prefix>-app:<tag>`), or null when there is no container */
    async slotImage(slot: Slot): Promise<string | null> {
      const name = n.slot(slot);
      const r = await docker(['container', 'inspect', '--format', '{{.Config.Image}}', name]);
      if (r.code === 0) return r.stdout.trim();
      if (/no such (container|object)/i.test(r.stderr)) return null;
      throw new Error(`docker container inspect ${name}: ${errTail(r)}`);
    },

    /**
     * Image retention, after every deploy outcome (I7): keeps the active and the previous `<prefix>-app:<sha12>-<utc>`
     * and removes every other app image, every `<prefix>-checks` image and every `<prefix>-build` stage tag, oldest first
     * and never with -f. An image a container still uses (running or stopped, e.g. the retired slot) is never removed.
     */
    async pruneImages(active: string | null, previous: string | null): Promise<{ kept: string[]; removed: string[]; warnings: string[] }> {
      const tags = async (repo: string) => (await must(['image', 'ls', '--format', '{{.Tag}}', repo])).stdout
        .split('\n').map((t) => t.trim()).filter((t) => t !== '' && t !== '<none>');
      const byTime = (a: string, b: string) => a.slice(13).localeCompare(b.slice(13)) || a.localeCompare(b);
      const app = (await tags(n.appRepo)).filter((t) => TAG_RE.test(t));
      const checks = (await tags(n.checksRepo)).filter((t) => TAG_RE.test(t));
      const builds = (await tags(n.buildRepo)).filter((t) => BUILD_TAG_RE.test(t));
      const kept: string[] = [];
      for (const t of [active, previous]) if (t && !kept.includes(t)) kept.push(t);
      const removed: string[] = [];
      const warnings: string[] = [];
      const refs = [
        ...app.filter((t) => !kept.includes(t)).sort(byTime).map(n.app),
        ...checks.sort(byTime).map(n.checks),
        ...builds.sort().map(n.build),
      ];
      for (const ref of refs) {
        // --filter ancestor: containers created from this image (or one built on it), stopped ones included
        const users = await must(['ps', '-a', '-q', '--filter', `ancestor=${ref}`]);
        if (users.stdout.trim() !== '') {
          if (app.some((t) => n.app(t) === ref)) kept.push(ref.slice(n.appRepo.length + 1));
          warnings.push(`${ref}: kept, a container still uses it (${users.stdout.trim().split('\n').join(' ')})`);
          continue;
        }
        const r = await docker(['image', 'rm', ref]);
        if (r.code === 0) removed.push(ref);
        else warnings.push(`${ref}: ${errTail(r)}`);
      }
      return { kept, removed, warnings };
    },
  };
}
