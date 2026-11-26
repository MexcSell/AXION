// Adapter tests (R13): a fake command runner records every argv; the assertions pin the exact docker/git command lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import type { GuardConfig } from './config.ts';
import { makeEffects, acquireLock, renderFrontConf } from './effects.ts';
import { parseNameStatusZ } from './effects-git.ts';
import { Busy } from './deploy.ts';
import { fakeHost, DockerSim, health, T0 } from './testing.ts';
import type { Call } from './testing.ts';

const SHA = 'b'.repeat(40);
const BASE = 'a'.repeat(40);
const TAG = 'bbbbbbbbbbbb-20261126T120000Z';
const SOCKET_URL = 'postgresql:///axion?host=/var/run/postgresql&user=axion';

function tmp(prefix = 'guard-fx-') { return mkdtempSync(join(tmpdir(), prefix)); }

/** a config rooted at the real default /srv/axion-evolve (argv assertions), with the live env file in a temp dir */
function srvCfg(extra: Record<string, string> = {}): GuardConfig {
  const d = tmp();
  writeFileSync(join(d, 'live.env'), `# live\nDATABASE_URL=${SOCKET_URL}\nAUDIT_ANCHOR_KEY=k\n`);
  return loadConfig({ AXION_GUARD_LIVE_ENV: join(d, 'live.env'), ...extra });
}

/** a config rooted in a temp dir (anything that writes files) */
function tmpCfg(extra: Record<string, string> = {}): GuardConfig {
  const root = tmp('guard-root-');
  mkdirSync(join(root, 'secrets'), { recursive: true });
  writeFileSync(join(root, 'secrets', 'live.env'), `DATABASE_URL=${SOCKET_URL}\n`);
  return loadConfig({ AXION_GUARD_ROOT: root, ...extra });
}

const idUser = (c: Call) => {
  if (c.cmd === 'id' && c.args[0] === '-u') return { stdout: '998\n' };
  if (c.cmd === 'id' && c.args[0] === '-g') return { stdout: '997\n' };
  return undefined;
};

/** the brief's fixed slot line plus --init; the env file is /srv/axion-evolve/secrets/live.env by default (config test), a temp file here */
const slotLine = (envFile: string) => [
  'run', '-d', '--init', '--name', 'axion-green', '--network', 'axion-live', '--user', '998:997', '--restart', 'unless-stopped',
  '--env-file', envFile,
  '-e', 'AXION_LEADER=lock', '-e', 'AXION_MIGRATE_ON_START=0', '-e', 'HTTPS_PROXY=http://axion-egress:3128', '-e', 'NO_PROXY=127.0.0.1,localhost',
  '-e', 'UPLOAD_DIR=/data/uploads', '-e', 'AUDIT_ANCHOR_FILE=/data/audit-anchors.jsonl', '-e', 'CLOUD_MODEL_HOME=/data/cloud-home', '-e', 'BACKUP_DIR=/backups',
  '-v', '/var/run/postgresql:/var/run/postgresql', '-v', '/srv/axion-evolve/data:/data', '-v', '/srv/axion-evolve/backups:/backups:ro',
  `axion-app:${TAG}`, 'node', 'evolve/slot/entry.mjs',
];

test('config defaults name the real host objects', () => {
  const c = loadConfig({});
  assert.equal(c.root, '/srv/axion-evolve');
  assert.equal(c.repo, '/srv/axion-evolve/repo.git');
  assert.equal(c.liveEnvFile, '/srv/axion-evolve/secrets/live.env');
  assert.equal(c.backupScript, '/srv/axion-evolve/guard/evolve/backup.sh');
  assert.equal(c.prefix, 'axion');
  assert.equal(c.liveNetwork, 'axion-live');
  assert.equal(c.edgeNetwork, 'axion-edge');
  assert.equal(c.frontImage, 'nginx:1.27-alpine');
  assert.equal(c.egressUrl, 'http://axion-egress:3128');
  assert.equal(c.osUser, 'axion');
  const t = loadConfig({ AXION_GUARD_ROOT: '/srv/trial', AXION_GUARD_PREFIX: 'trial' });
  assert.equal(t.repo, '/srv/trial/repo.git');
  assert.equal(t.lockFile, '/srv/trial/guard.lock');
  assert.equal(t.prefix, 'trial');
  assert.throws(() => loadConfig({ AXION_GUARD_PREFIX: 'Bad Prefix' }), /prefix/);
  assert.throws(() => loadConfig({ AXION_GUARD_ROOT: 'relative/dir' }), /absolute/);
});

test('startSlot runs the fixed slot line (plus --init) as the axion user, after removing a stopped leftover', async () => {
  const f = fakeHost(idUser);
  f.sim.add('axion-green', { running: false, restart: 'no' });
  const cfg = srvCfg();
  const fx = makeEffects(cfg, f.host, { frontPort: 5290, database: 'axion' });
  await fx.startSlot('green', TAG);
  assert.deepEqual(f.lines().slice(0, 2), [
    'docker container inspect --format {{.State.Running}} axion-green',
    'docker rm axion-green',
  ]);
  const run = f.find('docker run');
  assert.equal(run.length, 1);
  assert.deepEqual(run[0].args, slotLine(cfg.liveEnvFile));
  assert.equal(run[0].env, undefined, 'no extra environment when the database is the live env file\'s');
});

test('startSlot stops a running leftover gracefully (restart no, stop -t 30) before replacing it', async () => {
  const f = fakeHost(idUser);
  f.sim.add('axion-green', { running: true });
  const cfg = srvCfg();
  const fx = makeEffects(cfg, f.host, { frontPort: 5290, database: 'axion' });
  await fx.startSlot('green', TAG);
  assert.deepEqual(f.lines().slice(0, 4), [
    'docker container inspect --format {{.State.Running}} axion-green',
    'docker update --restart no axion-green',
    'docker stop -t 30 axion-green',
    'docker rm axion-green',
  ]);
  assert.deepEqual(f.find('docker run')[0].args, slotLine(cfg.liveEnvFile));
});

test('--database overrides only the database name of DATABASE_URL, passed through the environment (never argv)', async () => {
  const f = fakeHost(idUser);
  const cfg = srvCfg();
  const fx = makeEffects(cfg, f.host, { frontPort: 5290, database: 'axion_restore_check' });
  await fx.startSlot('green', TAG);
  const run = f.find('docker run')[0];
  const want = slotLine(cfg.liveEnvFile);
  want.splice(want.indexOf('-v'), 0, '-e', 'DATABASE_URL');
  assert.deepEqual(run.args, want);
  assert.deepEqual(run.env, { DATABASE_URL: 'postgresql:///axion_restore_check?host=/var/run/postgresql&user=axion' });
});

test('migrate runs the candidate image\'s migrate-cli on the live socket, with the same effective DATABASE_URL', async () => {
  const f = fakeHost(idUser);
  const fx = makeEffects(srvCfg(), f.host, { frontPort: 5290, database: 'axion_restore_check' });
  await fx.migrate(TAG);
  const run = f.find('docker run')[0];
  assert.deepEqual(run.args, [
    'run', '--rm', '--name', 'axion-migrate-00000001', '--network', 'none', '--user', '998:997',
    '--env-file', run.args[9], '-e', 'AXION_MIGRATE_ON_START=0', '-e', 'CLOUD_MODEL_HOME=/tmp/cloud-home', '-e', 'DATABASE_URL',
    '-v', '/var/run/postgresql:/var/run/postgresql', '-w', '/app/server', `axion-app:${TAG}`, 'node', '--import', 'tsx', 'src/migrate-cli.ts', 'up',
  ]);
  assert.match(run.args[9], /live\.env$/);
  assert.equal(run.env?.DATABASE_URL, 'postgresql:///axion_restore_check?host=/var/run/postgresql&user=axion');
  const f2 = fakeHost((c) => (c.cmd === 'docker' && c.args[0] === 'run' ? { code: 1, stderr: 'migration 0066 failed' } : idUser(c)));
  await assert.rejects(makeEffects(srvCfg(), f2.host, { frontPort: 5290, database: 'axion' }).migrate(TAG), /0066/);
});

test('backup runs the installed backup script with the effective database and returns the path it prints last', async () => {
  const cfg = srvCfg();
  const f = fakeHost((c) => (c.cmd === cfg.backupScript ? { stdout: 'dumping…\n/srv/axion-evolve/backups/axion-20261126T120000Z.dump\n' } : undefined));
  const fx = makeEffects(cfg, f.host, { frontPort: 5290, database: 'axion_restore_check' });
  assert.equal(await fx.backup(), '/srv/axion-evolve/backups/axion-20261126T120000Z.dump');
  assert.deepEqual(f.calls[0].args, []);
  assert.deepEqual(f.calls[0].env, {
    EVOLVE_ROOT: '/srv/axion-evolve',
    BACKUP_SOURCE_URL: 'postgresql:///axion_restore_check?host=/var/run/postgresql&user=axion', AXION_GUARD_DATABASE: 'axion_restore_check',
  });
  const bad = fakeHost((c) => (c.cmd === cfg.backupScript ? { stdout: 'no path here\n' } : undefined));
  await assert.rejects(makeEffects(cfg, bad.host, { frontPort: 5290, database: 'axion' }).backup(), /path/);
  const failed = fakeHost((c) => (c.cmd === cfg.backupScript ? { code: 2, stderr: 'pg_dump: error' } : undefined));
  await assert.rejects(makeEffects(cfg, failed.host, { frontPort: 5290, database: 'axion' }).backup(), /pg_dump/);
});

test('stopSlot: update --restart no then stop -t 30; a missing container is success; a daemon error is not', async () => {
  const f = fakeHost();
  f.sim.add('axion-blue', { running: true });
  const fx = makeEffects(srvCfg(), f.host, { frontPort: 5290, database: 'axion' });
  await fx.stopSlot('blue');
  assert.deepEqual(f.lines(), [
    'docker container inspect --format {{.State.Running}} axion-blue',
    'docker update --restart no axion-blue',
    'docker stop -t 30 axion-blue',
  ]);
  await fx.stopSlot('blue'); // stopped: same commands again, still fine
  assert.equal(f.sim.ctrs.get('axion-blue')?.running, false);
  assert.equal(f.sim.ctrs.get('axion-blue')?.restart, 'no');
  const g = fakeHost();
  await makeEffects(srvCfg(), g.host, { frontPort: 5290, database: 'axion' }).stopSlot('green');
  assert.deepEqual(g.lines(), ['docker container inspect --format {{.State.Running}} axion-green']);
  const down = fakeHost(() => ({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' }));
  await assert.rejects(makeEffects(srvCfg(), down.host, { frontPort: 5290, database: 'axion' }).stopSlot('green'), /Docker daemon/);
});

test('drain waits the grace period for a present slot and is a no-op for a missing one', async () => {
  const f = fakeHost();
  f.sim.add('axion-blue');
  const fx = makeEffects(srvCfg(), f.host, { frontPort: 5290, database: 'axion', drainMs: 7000 });
  await fx.drain('blue');
  assert.equal(f.host.now() - T0, 7000);
  await fx.drain('green');
  assert.equal(f.host.now() - T0, 7000);
  const d = fakeHost();
  d.sim.add('axion-blue');
  await makeEffects(srvCfg(), d.host, { frontPort: 5290, database: 'axion' }).drain('blue');
  assert.equal(d.host.now() - T0, 5000, 'default drain is 5 s');
});

test('front template: listen 8080, upstream to the slot, keepalive, SSE settings, Host passed through', () => {
  const tpl = readFileSync(new URL('../front/nginx.conf.tpl', import.meta.url), 'utf8');
  const conf = renderFrontConf(tpl, 'axion-green');
  assert.match(conf, /upstream axion_slot \{\s*server axion-green:4190;/);
  for (const d of ['listen 8080;', 'proxy_http_version 1.1;', 'proxy_set_header Connection "";', 'proxy_buffering off;',
    'proxy_read_timeout 1h;', 'proxy_set_header Host $http_host;', 'proxy_pass http://axion_slot;', 'client_max_body_size 30m;']) {
    assert.ok(conf.includes(d), `missing ${d}`);
  }
  assert.ok(!conf.includes('{{'), 'no placeholder left');
  assert.throws(() => renderFrontConf(tpl, 'axion-green; evil'), /container name/);
});

function switchSetup(over: { front?: 'missing' | 'running' | 'stopped'; port?: number; frontPort?: number } = {}) {
  const cfg = tmpCfg();
  const f = fakeHost();
  f.sim.add('axion-blue', { running: true });
  f.sim.add('axion-green', { running: true });
  f.sim.health.set('axion-green', health({ commit: SHA }));
  f.sim.health.set('axion-blue', health({ commit: BASE, leader: true }));
  if (over.front !== 'missing') {
    f.sim.add('axion-front', {
      running: over.front !== 'stopped', ports: `{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"${over.port ?? 5290}"}]}`,
    });
  }
  const port = over.frontPort ?? 5290;
  f.fetchAnswers.set(`http://127.0.0.1:${port}/api/v1/health`, [health({ commit: SHA })]);
  const fx = makeEffects(cfg, f.host, { frontPort: port, database: 'axion' });
  return { cfg, f, fx };
}

test('switchTo: target kept restartable and healthy, conf written atomically, nginx -t + reload, health through the front, then the other slot retired', async () => {
  const { cfg, f, fx } = switchSetup();
  await fx.switchTo('green');
  assert.deepEqual(f.lines(), [
    'docker container inspect --format {{.State.Running}} axion-green',
    'docker update --restart unless-stopped axion-green',
    'docker exec axion-green curl -sf --max-time 5 http://127.0.0.1:4190/api/v1/health',
    'docker container inspect --format {{.State.Running}} axion-front',
    'docker container inspect --format {{json .HostConfig.PortBindings}} axion-front',
    'docker exec axion-front nginx -t',
    'docker exec axion-front nginx -s reload',
    'docker container inspect --format {{.State.Running}} axion-blue',
    'docker update --restart no axion-blue',
    'docker stop -t 30 axion-blue',
  ]);
  assert.deepEqual(f.fetches, ['http://127.0.0.1:5290/api/v1/health']);
  const conf = readFileSync(join(cfg.frontDir, 'default.conf'), 'utf8');
  assert.match(conf, /server axion-green:4190;/);
  assert.deepEqual(readdirSync(cfg.frontDir), ['default.conf'], 'no temp file left behind');
  assert.equal(f.sim.ctrs.get('axion-blue')?.running, false);
  assert.equal(f.sim.ctrs.get('axion-blue')?.restart, 'no');
});

test('switchTo a stopped previous slot starts it again (restart policy back to unless-stopped) and waits for health', async () => {
  const { f, fx } = switchSetup();
  f.sim.ctrs.get('axion-green')!.running = false;
  f.sim.ctrs.get('axion-green')!.restart = 'no';
  await fx.switchTo('green');
  assert.deepEqual(f.lines().slice(0, 4), [
    'docker container inspect --format {{.State.Running}} axion-green',
    'docker update --restart unless-stopped axion-green',
    'docker start axion-green',
    'docker exec axion-green curl -sf --max-time 5 http://127.0.0.1:4190/api/v1/health',
  ]);
  assert.equal(f.sim.ctrs.get('axion-green')?.restart, 'unless-stopped');
});

test('switchTo a missing slot fails before touching the front or the other slot', async () => {
  const { f, fx } = switchSetup();
  f.sim.ctrs.delete('axion-green');
  await assert.rejects(fx.switchTo('green'), /axion-green.*(missing|does not exist)/);
  assert.equal(f.find('docker exec axion-front').length, 0);
  assert.equal(f.find('docker stop').length, 0);
});

test('switchTo creates a missing front: create on the edge network, connect the live network, then start (upstream resolvable)', async () => {
  const { cfg, f, fx } = switchSetup({ front: 'missing' });
  await fx.switchTo('green');
  const l = f.lines();
  const i = l.indexOf('docker container inspect --format {{.State.Running}} axion-front');
  assert.deepEqual(l.slice(i, i + 4), [
    'docker container inspect --format {{.State.Running}} axion-front',
    `docker create --name axion-front --network axion-edge --restart unless-stopped -p 0.0.0.0:5290:8080 -v ${cfg.frontDir}:/etc/nginx/conf.d:ro nginx:1.27-alpine`,
    'docker network connect axion-live axion-front',
    'docker start axion-front',
  ]);
  assert.ok(existsSync(join(cfg.frontDir, 'default.conf')));
});

test('switchTo recreates the front when its published port differs from the deploy\'s front port', async () => {
  const { cfg, f, fx } = switchSetup({ port: 5290, frontPort: 5291 });
  await fx.switchTo('green');
  const l = f.lines();
  const i = l.indexOf('docker container inspect --format {{json .HostConfig.PortBindings}} axion-front');
  assert.deepEqual(l.slice(i, i + 7), [
    'docker container inspect --format {{json .HostConfig.PortBindings}} axion-front',
    'docker rm -f axion-front-old',
    'docker rename axion-front axion-front-old',
    `docker create --name axion-front --network axion-edge --restart unless-stopped -p 0.0.0.0:5291:8080 -v ${cfg.frontDir}:/etc/nginx/conf.d:ro nginx:1.27-alpine`,
    'docker network connect axion-live axion-front',
    'docker start axion-front',
    'docker rm -f axion-front-old',
  ]);
  assert.deepEqual(f.fetches, ['http://127.0.0.1:5291/api/v1/health']);
  assert.ok(!f.sim.ctrs.has('axion-front-old'));
});

test('switchTo to a new front port that cannot start keeps the old front serving on its old port', async () => {
  const cfg = tmpCfg();
  mkdirSync(cfg.frontDir, { recursive: true });
  writeFileSync(join(cfg.frontDir, 'default.conf'), 'OLD CONF\n');
  const sim = new DockerSim();
  const f = fakeHost((c) => (c.args.join(' ') === 'start axion-front' ? { code: 125, stderr: 'Bind for 0.0.0.0:5291 failed: port is already allocated' } : undefined), sim);
  sim.add('axion-blue'); sim.add('axion-green');
  sim.add('axion-front', { ports: '{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"5290"}]}' });
  sim.health.set('axion-green', health({ commit: SHA }));
  await assert.rejects(makeEffects(cfg, f.host, { frontPort: 5291, database: 'axion' }).switchTo('green'), /port is already allocated/);
  const l = f.lines();
  assert.deepEqual(l.slice(l.indexOf('docker rename axion-front axion-front-old')), [
    'docker rename axion-front axion-front-old',
    `docker create --name axion-front --network axion-edge --restart unless-stopped -p 0.0.0.0:5291:8080 -v ${cfg.frontDir}:/etc/nginx/conf.d:ro nginx:1.27-alpine`,
    'docker network connect axion-live axion-front',
    'docker start axion-front',
    'docker rm -f axion-front',
    'docker rename axion-front-old axion-front',
  ]);
  assert.match(sim.ctrs.get('axion-front')!.ports!, /"HostPort":"5290"/);
  assert.equal(sim.ctrs.get('axion-front')!.running, true);
  assert.ok(!sim.ctrs.has('axion-front-old'));
  assert.equal(readFileSync(join(cfg.frontDir, 'default.conf'), 'utf8'), 'OLD CONF\n', 'conf restored');
  assert.equal(sim.ctrs.get('axion-blue')!.running, true, 'nothing retired');
});

test('switchTo: a bad nginx config is restored and nothing is retired', async () => {
  const cfg = tmpCfg();
  mkdirSync(cfg.frontDir, { recursive: true });
  writeFileSync(join(cfg.frontDir, 'default.conf'), 'OLD CONF\n');
  const sim = new DockerSim();
  const f = fakeHost((c) => (c.args.join(' ') === 'exec axion-front nginx -t' ? { code: 1, stderr: 'nginx: [emerg] host not found in upstream' } : undefined), sim);
  sim.add('axion-blue'); sim.add('axion-green'); sim.add('axion-front', { ports: '{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"5290"}]}' });
  sim.health.set('axion-green', health({ commit: SHA }));
  const fx = makeEffects(cfg, f.host, { frontPort: 5290, database: 'axion' });
  await assert.rejects(fx.switchTo('green'), /nginx -t.*host not found/s);
  assert.equal(readFileSync(join(cfg.frontDir, 'default.conf'), 'utf8'), 'OLD CONF\n');
  assert.equal(f.find('docker exec axion-front nginx -s reload').length, 0);
  assert.equal(f.find('docker stop').length, 0);
});

test('switchTo: the front never serving the target\'s commit fails the switch and retires nothing', async () => {
  const { f, fx } = switchSetup();
  f.fetchAnswers.set('http://127.0.0.1:5290/api/v1/health', [health({ commit: BASE })]);
  await assert.rejects(fx.switchTo('green'), /front/);
  assert.equal(f.find('docker stop').length, 0);
  assert.equal(f.sim.ctrs.get('axion-blue')?.running, true);
});

test('switchTo is idempotent: switching to the slot already served reloads and leaves a missing other slot alone', async () => {
  const { f, fx } = switchSetup();
  f.sim.ctrs.delete('axion-blue');
  await fx.switchTo('green');
  await fx.switchTo('green');
  assert.equal(f.find('docker exec axion-front nginx -s reload').length, 2);
  assert.equal(f.find('docker stop').length, 0);
});

test('smoke waits for the slot\'s health, loads the page, and reports the commit', async () => {
  const f = fakeHost();
  f.sim.add('axion-green');
  let polls = 0;
  const g = fakeHost((c) => {
    if (c.args[0] === 'exec' && c.args.at(-1)!.endsWith('/health')) { polls++; return polls < 3 ? { code: 7 } : { stdout: health({ commit: SHA }) }; }
    return undefined;
  }, f.sim);
  const r = await makeEffects(srvCfg(), g.host, { frontPort: 5290, database: 'axion' }).smoke('green');
  assert.deepEqual(r, { ok: true, commit: SHA });
  assert.ok(g.lines().includes('docker exec axion-green curl -sf --max-time 5 -o /dev/null http://127.0.0.1:4190/'));
  // a stopped container fails at once with ok false
  const s = fakeHost();
  s.sim.add('axion-green', { running: false });
  const r2 = await makeEffects(srvCfg(), s.host, { frontPort: 5290, database: 'axion' }).smoke('green');
  assert.equal(r2.ok, false);
});

test('git: liveSha, isAncestor, diff and advance (compare-and-swap against the base read at classify)', async () => {
  const cfg = srvCfg();
  const f = fakeHost((c) => {
    if (c.cmd !== 'git') return undefined;
    const a = c.args.slice(2).join(' ');
    if (a === 'rev-parse --verify refs/heads/evolve/main^{commit}') return { stdout: `${BASE}\n` };
    if (a === `merge-base --is-ancestor ${BASE} ${SHA}`) return { code: 0 };
    if (a === `merge-base --is-ancestor ${SHA} ${BASE}`) return { code: 1 };
    if (a.startsWith('diff ')) return { stdout: 'M\0web/a.ts\0' };
    return { code: 128, stderr: 'fatal: unexpected' };
  });
  const fx = makeEffects(cfg, f.host, { frontPort: 5290, database: 'axion', sha: SHA });
  assert.equal(await fx.liveSha(), BASE);
  assert.equal(await fx.isAncestor(BASE, SHA), true);
  assert.equal(await fx.isAncestor(SHA, BASE), false);
  await assert.rejects(fx.advance(SHA), /base/, 'advance before diff has no known old value');
  assert.deepEqual(await fx.diff(BASE, SHA), [{ path: 'web/a.ts', status: 'M' }]);
  await assert.rejects(fx.advance(SHA), /unexpected/);
  assert.deepEqual(f.lines(), [
    'git --git-dir /srv/axion-evolve/repo.git rev-parse --verify refs/heads/evolve/main^{commit}',
    `git --git-dir /srv/axion-evolve/repo.git merge-base --is-ancestor ${BASE} ${SHA}`,
    `git --git-dir /srv/axion-evolve/repo.git merge-base --is-ancestor ${SHA} ${BASE}`,
    `git --git-dir /srv/axion-evolve/repo.git diff --name-status -z -M ${BASE} ${SHA}`,
    `git --git-dir /srv/axion-evolve/repo.git update-ref refs/heads/evolve/main ${SHA} ${BASE}`,
  ]);
  await assert.rejects(fx.diff('HEAD', SHA), /sha/);
  const e = fakeHost(() => ({ code: 128, stderr: 'fatal: Not a valid object name' }));
  await assert.rejects(makeEffects(cfg, e.host, { frontPort: 5290, database: 'axion' }).isAncestor(BASE, SHA), /Not a valid/);
});

test('diff parsing: -z name-status with renames and copies into {path,status,oldPath}', () => {
  const out = 'M\0web/a.ts\0R087\0old/x.ts\0new/x.ts\0A\0b c\n.ts\0D\0gone.ts\0C100\0s.ts\0t.ts\0T\0link\0';
  assert.deepEqual(parseNameStatusZ(out), [
    { path: 'web/a.ts', status: 'M' },
    { path: 'new/x.ts', status: 'R', oldPath: 'old/x.ts' },
    { path: 'b c\n.ts', status: 'A' },
    { path: 'gone.ts', status: 'D' },
    { path: 't.ts', status: 'C', oldPath: 's.ts' },
    { path: 'link', status: 'T' },
  ]);
  assert.deepEqual(parseNameStatusZ(''), []);
  assert.throws(() => parseNameStatusZ('R100\0only-one\0'), /malformed/);
  assert.throws(() => parseNameStatusZ('M\0'), /malformed/);
});

function watchSetup(answers: string[], opts: { expectLeader?: boolean; logs?: string } = {}) {
  const f = fakeHost((c) => (c.args[0] === 'logs' ? { stdout: opts.logs ?? '', stderr: '' } : undefined));
  f.sim.add('axion-green');
  f.fetchAnswers.set('http://127.0.0.1:5290/api/v1/health', answers);
  const fx = makeEffects(srvCfg(), f.host, { frontPort: 5290, database: 'axion', sha: SHA, expectLeader: opts.expectLeader });
  return { f, fx };
}
const good = health({ commit: SHA, leader: true });
const badH = health({ ok: false, commit: SHA, leader: true });

test('watch: every 10 s through the front; passes when every poll is good', async () => {
  const { f, fx } = watchSetup([good]);
  assert.deepEqual(await fx.watch('green', 60_000), { ok: true });
  assert.equal(f.fetches.length, 7); // 0,10,…,60 s
  assert.equal(f.host.now() - T0, 60_000);
  assert.equal(f.find('docker logs').at(-1)!.args.join(' '), `logs --since ${new Date(T0).toISOString()} axion-green`);
});

test('watch: 3 consecutive bad polls fail; 2 bad then a good one do not', async () => {
  const a = watchSetup([badH, badH, badH, good]);
  const r = await a.fx.watch('green', 60_000);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /3 consecutive bad polls.*ok/);
  assert.equal(a.f.fetches.length, 3);
  const b = watchSetup([badH, badH, good, badH, badH, good]);
  assert.deepEqual(await b.fx.watch('green', 60_000), { ok: true });
  const c = watchSetup([health({ commit: BASE, leader: true })]);
  assert.match((await c.fx.watch('green', 60_000)).reason!, /commit/);
  const d = watchSetup([]); // front unreachable
  assert.match((await d.fx.watch('green', 60_000)).reason!, /ECONNREFUSED/);
});

test('watch: leader must be true within 30 s; --no-expect-leader skips the condition', async () => {
  const notLeader = health({ commit: SHA, leader: false });
  const a = watchSetup([notLeader]);
  const r = await a.fx.watch('green', 120_000);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /leader/);
  assert.equal(a.f.fetches.length, 6, 'polls at 0..20 s are in the grace period; 30, 40, 50 s are the 3 bad ones');
  const b = watchSetup([notLeader, notLeader, good]);
  assert.deepEqual(await b.fx.watch('green', 60_000), { ok: true });
  const c = watchSetup([notLeader], { expectLeader: false });
  assert.deepEqual(await c.fx.watch('green', 120_000), { ok: true });
  const d = watchSetup([notLeader]);
  assert.match((await d.fx.watch('green', 20_000)).reason!, /leader/, 'a short window still needs leader:true once');
});

test('watch: more than 20 error lines (level >= 50) in docker logs since the switch fail; 20 do not', async () => {
  const line = (lvl: number | string) => JSON.stringify({ level: lvl, msg: 'x' });
  const many = Array.from({ length: 21 }, (_, i) => line(i % 2 ? 50 : 60)).join('\n');
  const a = watchSetup([good], { logs: `${many}\n${line(40)}\nnot json\n` });
  const r = await a.fx.watch('green', 60_000);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /21 error log lines/);
  const twenty = Array.from({ length: 20 }, () => line(50)).concat([line(30), line('info')]).join('\n');
  const b = watchSetup([good], { logs: twenty });
  assert.deepEqual(await b.fx.watch('green', 60_000), { ok: true });
  const c = watchSetup([good], { logs: Array.from({ length: 21 }, () => line('error')).join('\n') });
  assert.equal((await c.fx.watch('green', 60_000)).ok, false, 'string levels error/fatal count too');
});

test('watch counts error lines on both docker logs streams, since the switch time', async () => {
  const cfg = tmpCfg();
  const errs = Array.from({ length: 11 }, () => '{"level":50}').join('\n');
  const f = fakeHost((c) => (c.args[0] === 'logs' ? { stdout: errs, stderr: errs } : undefined));
  f.sim.add('axion-blue'); f.sim.add('axion-green'); f.sim.add('axion-front', { ports: '{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"5290"}]}' });
  f.sim.health.set('axion-green', health({ commit: SHA }));
  f.fetchAnswers.set('http://127.0.0.1:5290/api/v1/health', [good]);
  const fx = makeEffects(cfg, f.host, { frontPort: 5290, database: 'axion', sha: SHA });
  f.advance(5_000);
  await fx.switchTo('green');
  const r = await fx.watch('green', 30_000);
  assert.match(r.reason!, /22 error log lines/);
  assert.equal(f.find('docker logs')[0].args[2], new Date(T0 + 5_000).toISOString());
});

test('pruneImages keeps the active, the previous and one more app image; removes older app and checks images (never -f)', async () => {
  const tags = ['aaaaaaaaaaaa-20261120T100000Z', 'bbbbbbbbbbbb-20261121T100000Z', 'cccccccccccc-20261122T100000Z',
    'dddddddddddd-20261123T100000Z', 'eeeeeeeeeeee-20261124T100000Z'];
  const f = fakeHost((c) => (c.args.join(' ') === `image rm axion-app:${tags[1]}` ? { code: 1, stderr: 'image is in use by container x' } : undefined));
  f.sim.images = [...tags.map((t) => `axion-app:${t}`), 'axion-app:dev', ...tags.map((t) => `axion-checks:${t}`), 'axion-checks:dev'];
  const fx = makeEffects(srvCfg(), f.host, { frontPort: 5290, database: 'axion' });
  const r = await fx.pruneImages(tags[4], tags[2]);
  assert.deepEqual(f.lines(), [
    'docker image ls --format {{.Tag}} axion-app',
    'docker image ls --format {{.Tag}} axion-checks',
    `docker image rm axion-app:${tags[0]}`,
    `docker image rm axion-app:${tags[1]}`,
    `docker image rm axion-checks:${tags[0]}`,
    `docker image rm axion-checks:${tags[1]}`,
  ]);
  assert.deepEqual(r.kept, [tags[4], tags[2], tags[3]]);
  assert.deepEqual(r.removed, [`axion-app:${tags[0]}`, `axion-checks:${tags[0]}`, `axion-checks:${tags[1]}`]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /in use/);
});

test('checks: internal network, throw-away postgres (300 connections) with the shared socket volume, both DBs, the checks container; all removed even on failure', async () => {
  const cfg = tmpCfg();
  for (const outcome of ['pass', 'fail'] as const) {
    const f = fakeHost((c) => {
      const a = c.args;
      if (a[0] === 'run' && a.includes(`axion-checks:${TAG}`)) {
        const out = a.find((x) => x.endsWith(':/out'))!.slice(0, -':/out'.length);
        writeFileSync(join(out, 'summary.json'), JSON.stringify({ passed: 4836, failed: outcome === 'pass' ? 0 : 2, skipped: 36, seconds: 273, ok: outcome === 'pass', steps: {} }));
        return { code: outcome === 'pass' ? 0 : 1, stdout: '== summary\n' };
      }
      return undefined;
    });
    const r = await makeEffects(cfg, f.host, { frontPort: 5290, database: 'axion' }).checks(TAG);
    assert.equal(r.ok, outcome === 'pass');
    assert.equal(r.passed, 4836);
    const id = 'axion-checks-00000001';
    const l = f.lines();
    assert.deepEqual(l.slice(0, 3), [
      `docker network create --internal ${id}`,
      `docker volume create ${id}-sock`,
      `docker run -d --name ${id}-pg --network ${id} -e POSTGRES_PASSWORD -v ${id}-sock:/var/run/postgresql postgres:16-alpine -c max_connections=300`,
    ]);
    assert.ok(l.includes(`docker exec ${id}-pg pg_isready -U postgres -h 127.0.0.1`));
    assert.ok(l.includes(`docker exec ${id}-pg createdb -U postgres axion_test`));
    assert.ok(l.includes(`docker exec ${id}-pg createdb -U postgres axion_e2e`));
    const run = f.calls.find((c) => c.args.includes(`axion-checks:${TAG}`))!;
    const out = run.args[run.args.indexOf(`${id}-sock:/var/run/postgresql`) + 2].split(':')[0];
    assert.deepEqual(run.args, [
      'run', '--name', `${id}-run`, '--network', id, '--shm-size=1g',
      '-e', 'TEST_DATABASE_URL', '-e', 'E2E_DATABASE_URL', '-e', 'PGUSER=postgres', '-e', 'AXION_REQUIRE_SOCKET_TEST=1',
      '-v', `${cfg.repo}:/repo.git:ro`, '-e', 'GIT_DIR=/repo.git', '-e', 'GIT_WORK_TREE=/app',
      '-v', `${id}-sock:/var/run/postgresql`, '-v', `${out}:/out`, `axion-checks:${TAG}`,
    ]);
    const pw = f.calls[2].env!.POSTGRES_PASSWORD;
    assert.match(pw, /^[0-9a-f]{48}$/);
    assert.deepEqual(run.env, {
      TEST_DATABASE_URL: `postgresql://postgres:${pw}@${id}-pg:5432/axion_test`,
      E2E_DATABASE_URL: `postgresql://postgres:${pw}@${id}-pg:5432/axion_e2e`,
    });
    assert.ok(!l.some((x) => x.includes(pw)), 'the password never appears in an argv');
    assert.deepEqual(l.slice(-3), [`docker rm -f ${id}-run ${id}-pg`, `docker volume rm ${id}-sock`, `docker network rm ${id}`]);
    assert.ok(!existsSync(out), 'the out dir is removed');
  }
  // a failure while preparing still removes everything
  const f = fakeHost((c) => (c.args[0] === 'volume' && c.args[1] === 'create' ? { code: 1, stderr: 'no space' } : undefined));
  await assert.rejects(makeEffects(cfg, f.host, { frontPort: 5290, database: 'axion' }).checks(TAG), /no space/);
  assert.deepEqual(f.lines().slice(-3), ['docker rm -f axion-checks-00000001-run axion-checks-00000001-pg',
    'docker volume rm axion-checks-00000001-sock', 'docker network rm axion-checks-00000001']);
  // no summary.json → not ok, passed NaN-free
  const g = fakeHost((c) => (c.args.includes(`axion-checks:${TAG}`) ? { code: 2, stderr: 'TEST_DATABASE_URL is required' } : undefined));
  const r = await makeEffects(cfg, g.host, { frontPort: 5290, database: 'axion' }).checks(TAG);
  assert.equal(r.ok, false);
  assert.equal(r.passed, 0);
  assert.match(r.log, /summary\.json/);
});

test('bootOffline: candidate on its own internal network with a throw-away postgres, migrate on start, health ok; removed afterwards', async () => {
  for (const healthy of [true, false]) {
    const f = fakeHost((c) => {
      if (c.cmd === 'id') return idUser(c);
      if (c.args[0] === 'exec' && c.args[1].endsWith('-app') && c.args.at(-1)!.endsWith('/health')) {
        return healthy ? { stdout: health({ commit: SHA, leader: true }) } : { code: 7 };
      }
      return undefined;
    });
    const ok = await makeEffects(srvCfg(), f.host, { frontPort: 5290, database: 'axion' }).bootOffline(TAG);
    assert.equal(ok, healthy);
    const id = 'axion-boot-00000001';
    const l = f.lines();
    assert.equal(l[0], `docker network create --internal ${id}`);
    assert.equal(l[1], `docker run -d --name ${id}-pg --network ${id} -e POSTGRES_PASSWORD -e POSTGRES_DB=axion postgres:16-alpine`);
    const app = f.calls.find((c) => c.args.includes(`axion-app:${TAG}`))!;
    assert.deepEqual(app.args, [
      'run', '-d', '--init', '--name', `${id}-app`, '--network', id, '--user', '998:997',
      '-e', 'DATABASE_URL', '-e', 'AXION_MIGRATE_ON_START=1', '-e', 'AXION_LEADER=lock',
      '-e', 'UPLOAD_DIR=/tmp/uploads', '-e', 'AUDIT_ANCHOR_FILE=/tmp/audit-anchors.jsonl', '-e', 'CLOUD_MODEL_HOME=/tmp/cloud-home', '-e', 'BACKUP_DIR=/tmp/backups',
      `axion-app:${TAG}`, 'node', 'evolve/slot/entry.mjs',
    ]);
    assert.match(app.env!.DATABASE_URL, new RegExp(`^postgresql://postgres:[0-9a-f]{48}@${id}-pg:5432/axion$`));
    assert.ok(l.includes(`docker exec ${id}-app curl -sf --max-time 5 http://127.0.0.1:4190/api/v1/health`));
    assert.deepEqual(l.slice(-2), [`docker rm -f ${id}-app ${id}-pg`, `docker network rm ${id}`]);
  }
});

test('build: git archive of the candidate, evolve/ and .dockerignore replaced by the installed copy, app then checks image', async () => {
  const cfg = tmpCfg();
  // an installed guard copy: <guard>/evolve + <guard>/.dockerignore
  const guard = tmp('guard-installed-');
  mkdirSync(join(guard, 'evolve', 'docker'), { recursive: true });
  writeFileSync(join(guard, 'evolve', 'docker', 'app.Dockerfile'), 'FROM trusted\n');
  writeFileSync(join(guard, '.dockerignore'), 'trusted-ignore\n');
  const c2 = loadConfig({ AXION_GUARD_ROOT: cfg.root }, join(guard, 'evolve'));
  let seen: { evolve: string[]; ignore: string; dockerfile: string } | null = null;
  const f = fakeHost((c) => {
    if (c.cmd === 'tar') {
      const dir = c.args[c.args.indexOf('-C') + 1];
      mkdirSync(join(dir, 'evolve', 'docker'), { recursive: true });
      writeFileSync(join(dir, 'evolve', 'docker', 'app.Dockerfile'), 'FROM candidate\n');
      writeFileSync(join(dir, 'evolve', 'evil.sh'), 'x');
      writeFileSync(join(dir, '.dockerignore'), 'candidate-ignore\n');
      return {};
    }
    if (c.cmd === 'docker' && c.args[0] === 'build' && !seen) {
      const ctx = c.args.at(-1)!;
      seen = {
        evolve: readdirSync(join(ctx, 'evolve')), ignore: readFileSync(join(ctx, '.dockerignore'), 'utf8'),
        dockerfile: readFileSync(join(ctx, 'evolve', 'docker', 'app.Dockerfile'), 'utf8'),
      };
    }
    return undefined;
  });
  const tag = await makeEffects(c2, f.host, { frontPort: 5290, database: 'axion' }).build(SHA);
  assert.equal(tag, 'bbbbbbbbbbbb-20261126T120000Z');
  assert.deepEqual(seen, { evolve: ['docker'], ignore: 'trusted-ignore\n', dockerfile: 'FROM trusted\n' });
  const l = f.lines();
  const work = f.calls[0].args[f.calls[0].args.indexOf('-o') + 1];
  const ctx = f.calls[1].args.at(-1)!;
  assert.deepEqual(l, [
    `git --git-dir ${c2.repo} archive --format=tar -o ${work} ${SHA}`,
    `tar -xf ${work} -C ${ctx}`,
    `docker build -f ${ctx}/evolve/docker/app.Dockerfile --build-arg AXION_COMMIT=${SHA} -t axion-app:${tag} ${ctx}`,
    `docker build -f ${ctx}/evolve/docker/checks.Dockerfile --build-arg APP_IMAGE=axion-app:${tag} -t axion-checks:${tag} ${ctx}`,
  ]);
  assert.ok(!existsSync(ctx) && !existsSync(work), 'build context and archive removed');
  // no installed .dockerignore → fail closed, never the candidate's
  const bare = tmp('guard-installed-');
  mkdirSync(join(bare, 'evolve'));
  const f2 = fakeHost();
  await assert.rejects(makeEffects(loadConfig({ AXION_GUARD_ROOT: cfg.root }, join(bare, 'evolve')), f2.host, { frontPort: 5290, database: 'axion' }).build(SHA), /dockerignore/);
  assert.equal(f2.find('docker build').length, 0);
});

test('lock: exclusive with the pid inside; held by a live pid → Busy; a dead pid is stale and taken over (logged)', async () => {
  const dir = tmp();
  const file = join(dir, 'guard.lock');
  const f = fakeHost();
  const release = await acquireLock(file, f.host);
  assert.equal(readFileSync(file, 'utf8').trim(), String(process.pid));
  await assert.rejects(acquireLock(file, f.host), Busy);
  await release();
  assert.ok(!existsSync(file));
  writeFileSync(file, '999999999\n');
  const r2 = await acquireLock(file, f.host, (pid) => pid === process.pid);
  assert.match(f.logs.join('\n'), /stale lock.*999999999/);
  assert.equal(readFileSync(file, 'utf8').trim(), String(process.pid));
  await r2();
  writeFileSync(file, 'garbage');
  await assert.rejects(acquireLock(file, f.host), /guard\.lock/);
});

test('record appends one JSON line per entry to history.jsonl', async () => {
  const cfg = tmpCfg();
  const fx = makeEffects(cfg, fakeHost().host, { frontPort: 5290, database: 'axion' });
  await fx.record({ at: '2026-11-26T12:00:00.000Z', sha: SHA, step: 'build', event: 'start' });
  await fx.record({ at: '2026-11-26T12:00:01.000Z', sha: SHA, step: 'build', event: 'end', ok: true, detail: TAG });
  const lines = readFileSync(cfg.historyFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[1].detail, TAG);
});
