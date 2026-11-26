// Every host object the Guard names (directories, containers, networks, images, the OS user), in one place, so the
// controller can run a trial with another root and name prefix. Read from the environment once per CLI run:
//   AXION_GUARD_ROOT (/srv/axion-evolve)   AXION_GUARD_PREFIX (axion)          AXION_GUARD_USER (axion: slots run as its uid:gid)
//   AXION_GUARD_LIVE_NETWORK (axion-live)  AXION_GUARD_EDGE_NETWORK (axion-edge)  AXION_GUARD_FRONT_IMAGE (nginx:1.27-alpine)
//   AXION_GUARD_POSTGRES_IMAGE (postgres:16-alpine)  AXION_GUARD_EGRESS (http://axion-egress:3128)
//   AXION_GUARD_LIVE_ENV (<root>/secrets/live.env)  AXION_GUARD_BACKUP_SCRIPT (<root>/guard/evolve/backup.sh)
// The trusted files (Dockerfiles, run-checks.sh, entry.mjs, protected.txt, baseline.json) come from the evolve/ directory
// this file is installed in (R7/R11), never from a candidate; `.dockerignore` from the directory above it.

import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type GuardConfig = {
  root: string;
  prefix: string;
  liveNetwork: string;
  edgeNetwork: string;
  frontImage: string;
  postgresImage: string;
  /** OS user whose uid:gid the slots run as (looked up with `id` when first needed) */
  osUser: string;
  egressUrl: string;
  liveEnvFile: string;
  backupScript: string;
  /** the Guard's installed evolve/ directory (trusted copy) */
  evolveDir: string;
  /** the Guard's installed .dockerignore (next to evolveDir) */
  dockerignore: string;
  repo: string;
  stateDir: string;
  historyFile: string;
  lockFile: string;
  /** bind-mounted into the front at /etc/nginx/conf.d (a directory, so an atomic rename is visible inside) */
  frontDir: string;
  /** root-only scratch space for build contexts and checks output */
  workDir: string;
  dataDir: string;
  backupsDir: string;
  socketDir: string;
  defaultFrontPort: number;
  defaultDatabase: string;
  // timings (ms unless named otherwise)
  pollMs: number;
  leaderGraceMs: number;
  badPollLimit: number;
  errorLineLimit: number;
  healthTimeoutMs: number;
  healthIntervalMs: number;
  frontTimeoutMs: number;
  stopTimeoutS: number;
  buildTimeoutMs: number;
  checksTimeoutMs: number;
  backupTimeoutMs: number;
  migrateTimeoutMs: number;
};

const NAME_RE = /^[a-z_][a-z0-9_-]*$/;
/** the prefix and both networks: axion, axion-live, axion-trial-edge, … */
export const AXION_NAME_RE = /^axion(-[a-z0-9]+)*$/;
/** [registry[:port]/]name[:tag][@sha256:digest], lowercase name; never starts with `-` (it is a docker argument) */
const IMAGE_RE = /^([a-z0-9][a-z0-9.-]*(:\d{1,5})?\/)?[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(@sha256:[0-9a-f]{64})?$/;
const EGRESS_RE = /^http:\/\/[a-z0-9][a-z0-9.-]*:\d{1,5}$/;
const INSTALLED_EVOLVE = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env: Record<string, string | undefined> = process.env, evolveDir = INSTALLED_EVOLVE): GuardConfig {
  const get = (k: string, d: string) => {
    const v = env[k];
    return v === undefined || v.trim() === '' ? d : v.trim();
  };
  const root = get('AXION_GUARD_ROOT', '/srv/axion-evolve');
  if (!isAbsolute(root)) throw new Error(`AXION_GUARD_ROOT must be an absolute path, got ${root}`);
  // every Docker object the Guard creates or removes is named axion or axion-… (R14): a misconfiguration can never make
  // it touch another application's containers, networks or volumes
  const axionName = (k: string, d: string) => {
    const v = get(k, d);
    if (!AXION_NAME_RE.test(v)) throw new Error(`${k} must match ${AXION_NAME_RE.source}, got ${JSON.stringify(v)}`);
    return v;
  };
  const prefix = axionName('AXION_GUARD_PREFIX', 'axion');
  const name = (k: string, d: string) => {
    const v = get(k, d);
    if (!NAME_RE.test(v)) throw new Error(`${k} must be a lowercase user name, got ${JSON.stringify(v)}`);
    return v;
  };
  const image = (k: string, d: string) => {
    const v = get(k, d);
    if (!IMAGE_RE.test(v)) throw new Error(`${k} must be an image reference (e.g. nginx:1.27-alpine), got ${JSON.stringify(v)}`);
    return v;
  };
  const egress = get('AXION_GUARD_EGRESS', 'http://axion-egress:3128');
  if (!EGRESS_RE.test(egress)) throw new Error(`AXION_GUARD_EGRESS must look like http://<host>:<port>, got ${JSON.stringify(egress)}`);
  const path = (k: string, d: string) => {
    const v = get(k, d);
    if (!isAbsolute(v)) throw new Error(`${k} must be an absolute path, got ${v}`);
    return v;
  };
  return {
    root,
    prefix,
    liveNetwork: axionName('AXION_GUARD_LIVE_NETWORK', 'axion-live'),
    edgeNetwork: axionName('AXION_GUARD_EDGE_NETWORK', 'axion-edge'),
    frontImage: image('AXION_GUARD_FRONT_IMAGE', 'nginx:1.27-alpine'),
    postgresImage: image('AXION_GUARD_POSTGRES_IMAGE', 'postgres:16-alpine'),
    osUser: name('AXION_GUARD_USER', 'axion'),
    egressUrl: egress,
    liveEnvFile: path('AXION_GUARD_LIVE_ENV', join(root, 'secrets', 'live.env')),
    backupScript: path('AXION_GUARD_BACKUP_SCRIPT', join(root, 'guard', 'evolve', 'backup.sh')),
    evolveDir,
    dockerignore: join(evolveDir, '..', '.dockerignore'),
    repo: join(root, 'repo.git'),
    stateDir: root,
    historyFile: join(root, 'history.jsonl'),
    lockFile: join(root, 'guard.lock'),
    frontDir: join(root, 'front'),
    workDir: join(root, 'work'),
    dataDir: join(root, 'data'),
    backupsDir: join(root, 'backups'),
    socketDir: '/var/run/postgresql',
    defaultFrontPort: 5290,
    defaultDatabase: 'axion',
    pollMs: 10_000,
    leaderGraceMs: 30_000,
    badPollLimit: 3,
    errorLineLimit: 20,
    healthTimeoutMs: 180_000,
    healthIntervalMs: 2_000,
    frontTimeoutMs: 30_000,
    stopTimeoutS: 30,
    buildTimeoutMs: 45 * 60_000,
    checksTimeoutMs: 30 * 60_000,
    backupTimeoutMs: 30 * 60_000,
    migrateTimeoutMs: 15 * 60_000,
  };
}

/** Container and image names derived from the prefix. */
export function names(cfg: GuardConfig) {
  const p = cfg.prefix;
  return {
    slot: (s: 'blue' | 'green') => `${p}-${s}`,
    front: `${p}-front`,
    appRepo: `${p}-app`,
    checksRepo: `${p}-checks`,
    app: (tag: string) => `${p}-app:${tag}`,
    checks: (tag: string) => `${p}-checks:${tag}`,
  };
}
