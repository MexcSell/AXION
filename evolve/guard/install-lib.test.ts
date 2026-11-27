// evolve/install-lib.sh (F1, I3) with fake `docker` and `systemctl` binaries on PATH: a small JSON-backed model of the
// networks/containers they touch, one-shot failure injection, and a log of every call. No real Docker or systemd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, statSync, existsSync, utimesSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const LIB = new URL('../install-lib.sh', import.meta.url).pathname;

const FAKE_DOCKER = `#!/usr/bin/env node
const fs = require('node:fs');
const S = process.env.FAKE_STATE, L = process.env.FAKE_LOG;
const st = JSON.parse(fs.readFileSync(S, 'utf8'));
const a = process.argv.slice(2);
const line = a.join(' ');
fs.appendFileSync(L, line + '\\n');
const save = () => fs.writeFileSync(S, JSON.stringify(st));
const out = (s) => { process.stdout.write(s); save(); process.exit(0); };
const die = (m, c = 1) => { process.stderr.write(m + '\\n'); save(); process.exit(c); };
const i = (st.failOnce || []).findIndex((p) => line.startsWith(p));
if (i >= 0) { st.failOnce.splice(i, 1); die('injected failure: ' + line); }
const nets = st.networks, ctrs = st.containers;
if (a[0] === 'network') {
  const name = a.at(-1);
  if (a[1] === 'inspect') {
    if (!nets[name]) die('network ' + name + ' not found');
    const n = nets[name];
    if (a[2] === '-f') out(String(n.internal) + ' ' + (n.inhibit ? 'true' : '<no value>') + '\\n');
    out('[{}]\\n');
  }
  if (a[1] === 'create') { if (nets[name]) die('exists'); nets[name] = { internal: a.includes('--internal'), inhibit: a.includes('com.docker.network.bridge.inhibit_ipv4=true') }; out('id\\n'); }
  if (a[1] === 'rm') { if (Object.values(ctrs).some((c) => c.networks.includes(name))) die('has active endpoints'); delete nets[name]; out(name + '\\n'); }
  if (a[1] === 'disconnect') { const c = ctrs[a.at(-1)]; c.networks = c.networks.filter((x) => x !== a.at(-2)); out(''); }
  if (a[1] === 'connect') { if (!nets[a[2]]) die('no such network'); ctrs[a[3]].networks.push(a[2]); out(''); }
}
if (a[0] === 'ps') {
  const net = a[a.indexOf('--filter') + 1].replace('network=', '');
  out(Object.entries(ctrs).filter(([, c]) => c.networks.includes(net)).map(([n]) => n).join('\\n') + '\\n');
}
if (a[0] === 'inspect') {
  const c = ctrs[a.at(-1)]; if (!c) die('no such object');
  const f = a[2];
  if (f === '{{.State.Running}}') out(String(c.running) + '\\n');
  const m = /Networks "([^"]+)"/.exec(f);
  if (m) out(c.networks.includes(m[1]) ? 'yes\\n' : '\\n');
}
if (a[0] === 'exec') out('');
if (a[0] === 'container' && a[1] === 'inspect') { if (!ctrs[a.at(-1)]) die('no such container'); out('[{}]\\n'); }
if (a[0] === 'image' && a[1] === 'inspect') { if (!(st.images || []).includes(a.at(-1))) die('no such image'); out('[{}]\\n'); }
if (a[0] === 'build') { st.images = [...(st.images || []), a[a.indexOf('-t') + 1]]; st.buildEnv = process.env.DOCKER_BUILDKIT ?? null; out('sha256:x\\n'); }
die('fake docker: unexpected ' + line, 99);
`;

const FAKE_SYSTEMCTL = `#!/usr/bin/env node
const fs = require('node:fs');
const S = process.env.FAKE_STATE, L = process.env.FAKE_LOG;
const st = JSON.parse(fs.readFileSync(S, 'utf8'));
const a = process.argv.slice(2);
fs.appendFileSync(L, 'systemctl ' + a.join(' ') + '\\n');
if (a[0] === 'daemon-reload') { st.reloads = (st.reloads || 0) + 1; st.units['axion-evolve.service'] ??= { enabled: 'disabled', active: 'inactive' }; fs.writeFileSync(S, JSON.stringify(st)); process.exit(0); }
const u = st.units[a.at(-1)];
if (a[0] === 'list-unit-files') { if (u) process.stdout.write(a.at(-1) + ' ' + u.enabled + '\\n'); process.exit(0); }
if (!u) process.exit(1);
if (a[0] === 'is-enabled') { process.stdout.write(u.enabled + '\\n'); process.exit(u.enabled === 'enabled' ? 0 : 1); }
if (a[0] === 'is-active') { process.stdout.write(u.active + '\\n'); process.exit(u.active === 'active' ? 0 : 3); }
if (a[0] === 'disable' && a[1] === '--now') { u.enabled = 'disabled'; u.active = 'inactive'; fs.writeFileSync(S, JSON.stringify(st)); process.exit(0); }
if (a[0] === 'enable') { u.enabled = 'enabled'; fs.writeFileSync(S, JSON.stringify(st)); process.exit(0); }
process.exit(99);
`;

type World = { networks: Record<string, { internal: boolean; inhibit: boolean }>; containers: Record<string, { running: boolean; networks: string[] }>;
  units?: Record<string, { enabled: string; active: string }>; failOnce?: string[]; images?: string[]; buildEnv?: string | null; reloads?: number };

function world(w: World) {
  const d = mkdtempSync(join(tmpdir(), 'guard-install-lib-'));
  writeFileSync(join(d, 'docker'), FAKE_DOCKER); chmodSync(join(d, 'docker'), 0o755);
  writeFileSync(join(d, 'systemctl'), FAKE_SYSTEMCTL); chmodSync(join(d, 'systemctl'), 0o755);
  writeFileSync(join(d, 'state.json'), JSON.stringify({ units: {}, failOnce: [], ...w }));
  writeFileSync(join(d, 'log'), '');
  const run = (script: string) => {
    const r = spawnSync('bash', ['-c', `set -euo pipefail; . ${LIB}; ${script}`], {
      encoding: 'utf8', env: { PATH: `${d}:${process.env.PATH}`, FAKE_STATE: join(d, 'state.json'), FAKE_LOG: join(d, 'log') },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  return {
    dir: d,
    run,
    state: () => JSON.parse(readFileSync(join(d, 'state.json'), 'utf8')) as World,
    log: () => readFileSync(join(d, 'log'), 'utf8').trim().split('\n').filter(Boolean),
  };
}

const ISO = '--internal -o com.docker.network.bridge.inhibit_ipv4=true';
const LIVE_LAYOUT = (): World => ({
  networks: { 'axion-live': { internal: true, inhibit: false }, 'axion-edge': { internal: false, inhibit: false } },
  containers: {
    'axion-front': { running: true, networks: ['axion-edge', 'axion-live'] },
    'axion-egress': { running: true, networks: ['axion-edge', 'axion-live'] },
    'axion-blue': { running: true, networks: ['axion-live'] },
    'axion-green': { running: false, networks: ['axion-live'] },
  },
});

test('retire_native_units (F1): disables only an enabled or active unit; idempotent; a missing unit is fine', () => {
  const w = world({ networks: {}, containers: {}, units: {
    'axion-api.service': { enabled: 'enabled', active: 'active' }, 'axion-web.service': { enabled: 'disabled', active: 'inactive' } } });
  const a = w.run('retire_native_units');
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /disabled and stopped axion-api\.service \(was enabled\/active\)/);
  assert.match(a.out, /already done: axion-web\.service \(disabled\/inactive\)/);
  assert.deepEqual(w.log().filter((l) => l.includes('disable')), ['systemctl disable --now axion-api.service']);
  const b = w.run('retire_native_units');
  assert.match(b.out, /already done: axion-api\.service \(disabled\/inactive\)/);
  assert.equal(w.log().filter((l) => l.includes('disable')).length, 1, 'nothing disabled twice');
  const none = world({ networks: {}, containers: {} });
  assert.match(none.run('retire_native_units').out, /already done: axion-api\.service \(no such unit\)[\s\S]*axion-web\.service \(no such unit\)/);
});

test('ensure_live_network (I3): creates it isolated; an existing one without the isolation is left alone with rc 3', () => {
  const w = world({ networks: {}, containers: {} });
  assert.equal(w.run('ensure_live_network axion-live').code, 0);
  assert.deepEqual(w.log(), ['network inspect axion-live', `network create ${ISO} axion-live`]);
  assert.match(w.run('ensure_live_network axion-live').out, /already done: axion-live/);
  const old = world(LIVE_LAYOUT());
  const r = old.run('ensure_live_network axion-live || echo "rc=$?"');
  assert.match(r.out, /NEEDS --recreate-live-network[\s\S]*rc=3/);
  assert.ok(!old.log().some((l) => /create|rm|connect/.test(l)), 'nothing changed');
});

test('recreate_live_network (I3): every member (running or stopped) disconnected, isolated network, reconnected with the front last, nginx reloaded', () => {
  const w = world(LIVE_LAYOUT());
  const r = w.run('recreate_live_network axion-live axion-front');
  assert.equal(r.code, 0, r.err);
  const changes = w.log().filter((l) => /^network (disconnect|rm|create|connect)|^exec/.test(l));
  assert.deepEqual(changes, [
    'network disconnect -f axion-live axion-front', 'network disconnect -f axion-live axion-egress',
    'network disconnect -f axion-live axion-blue', 'network disconnect -f axion-live axion-green',
    'network rm axion-live', `network create ${ISO} axion-live`,
    'network connect axion-live axion-egress', 'network connect axion-live axion-blue', 'network connect axion-live axion-green',
    'network connect axion-live axion-front', 'exec axion-front nginx -s reload',
  ]);
  const s = w.state();
  assert.deepEqual(s.networks['axion-live'], { internal: true, inhibit: true });
  for (const c of Object.values(s.containers)) assert.ok(c.networks.includes('axion-live'));
  const again = w.run('recreate_live_network axion-live axion-front');
  assert.match(again.out, /nothing to recreate/);
});

test('recreate_live_network refuses when a non-axion container is attached (nothing changed)', () => {
  const l = LIVE_LAYOUT();
  l.containers['other-app'] = { running: true, networks: ['axion-live'] };
  const w = world(l);
  const r = w.run('recreate_live_network axion-live axion-front || echo "rc=$?"');
  assert.match(r.err, /refusing: other-app/);
  assert.match(r.out, /rc=2/);
  assert.ok(!w.log().some((x) => /disconnect|network rm|create/.test(x)));
});

test('recreate_live_network: a failure after the first disconnect puts the network and every member back, rc 1', () => {
  for (const fail of [`network create ${ISO} axion-live`, 'network connect axion-live axion-blue', 'network rm axion-live',
    'network disconnect -f axion-live axion-blue']) {
    const w = world({ ...LIVE_LAYOUT(), failOnce: [fail] });
    const r = w.run('recreate_live_network axion-live axion-front || echo "rc=$?"');
    assert.match(r.out, /rc=1/, fail);
    assert.match(r.err, /FAILED while/, fail);
    assert.match(r.err, /restored: axion-live exists \((isolated|NOT isolated)\), every member is connected again/, fail);
    const s = w.state();
    assert.ok(s.networks['axion-live'], fail);
    for (const [n, c] of Object.entries(s.containers)) assert.ok(c.networks.includes('axion-live'), `${fail}: ${n}`);
    assert.ok(w.log().includes('exec axion-front nginx -s reload'), `${fail}: front reloaded`);
  }
});

// ---- evolution step 2: the runner's install steps ----

test('copy_missing: rsync --ignore-existing never replaces a file the destination has, even a newer source; copies what is missing', () => {
  const w = world({ networks: {}, containers: {} });
  const src = join(w.dir, 'src'); const dst = join(w.dir, 'dst');
  mkdirSync(join(src, 'up'), { recursive: true }); mkdirSync(join(dst, 'up'), { recursive: true });
  writeFileSync(join(src, 'anchors.jsonl'), 'stale native\n'); writeFileSync(join(dst, 'anchors.jsonl'), 'live\n');
  utimesSync(join(dst, 'anchors.jsonl'), new Date('2020-01-01'), new Date('2020-01-01'));
  writeFileSync(join(src, 'up', 'old.png'), 'native'); writeFileSync(join(dst, 'up', 'old.png'), 'live');
  utimesSync(join(dst, 'up', 'old.png'), new Date('2020-01-01'), new Date('2020-01-01'));
  writeFileSync(join(src, 'up', 'new.png'), 'only native');
  const r = w.run(`copy_missing ${src}/up/ ${dst}/up/ && copy_missing ${src}/anchors.jsonl ${dst}/anchors.jsonl && copy_missing ${src}/none ${dst}/none`);
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(join(dst, 'anchors.jsonl'), 'utf8'), 'live\n');
  assert.equal(readFileSync(join(dst, 'up', 'old.png'), 'utf8'), 'live');
  assert.equal(readFileSync(join(dst, 'up', 'new.png'), 'utf8'), 'only native');
  assert.match(r.out, /\(no .*none\)/);
  assert.match(readFileSync(new URL('../install.sh', import.meta.url), 'utf8'), /copy_missing "\$SRC_DATA\/audit-anchors\.jsonl"/);
  assert.doesNotMatch(readFileSync(new URL('../install.sh', import.meta.url), 'utf8'), /rsync[^\n]*--update/);
});

test('ensure_workshop_network: created isolated, the egress connected; idempotent; a non-isolated one with only the egress is recreated', () => {
  const w = world({ networks: { 'axion-edge': { internal: false, inhibit: false } }, containers: { 'axion-egress': { running: true, networks: ['axion-edge'] } } });
  const a = w.run('ensure_workshop_network axion-workshop axion-egress');
  assert.equal(a.code, 0, a.err);
  assert.deepEqual(w.state().networks['axion-workshop'], { internal: true, inhibit: true });
  assert.ok(w.state().containers['axion-egress'].networks.includes('axion-workshop'));
  assert.ok(w.log().includes(`network create ${ISO} axion-workshop`));
  const before = w.log().length;
  const b = w.run('ensure_workshop_network axion-workshop axion-egress');
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /already done: axion-workshop[\s\S]*already done: axion-egress on axion-workshop/);
  assert.ok(!w.log().slice(before).some((l) => /create|connect|rm/.test(l)), 'nothing changed the second time');
  const old = world({ networks: { 'axion-workshop': { internal: true, inhibit: false } }, containers: { 'axion-egress': { running: true, networks: ['axion-edge', 'axion-workshop'] } } });
  const c = old.run('ensure_workshop_network axion-workshop axion-egress');
  assert.equal(c.code, 0, c.err);
  assert.deepEqual(old.state().networks['axion-workshop'], { internal: true, inhibit: true });
  assert.ok(old.state().containers['axion-egress'].networks.includes('axion-workshop'));
});

test('ensure_workshop_network: a non-isolated network with other members is left alone (rc 3); a missing egress fails (rc 1)', () => {
  const w = world({ networks: { 'axion-workshop': { internal: false, inhibit: false } }, containers: {
    'axion-egress': { running: true, networks: ['axion-workshop'] }, 'axion-workshop-M-1-a1': { running: true, networks: ['axion-workshop'] } } });
  const r = w.run('ensure_workshop_network axion-workshop axion-egress || echo "rc=$?"');
  assert.match(r.out, /rc=3/);
  assert.match(r.err, /axion-workshop-M-1-a1/);
  assert.ok(!w.log().some((l) => /network (rm|create|disconnect)/.test(l)));
  const n = world({ networks: {}, containers: {} });
  assert.match(n.run('ensure_workshop_network axion-workshop axion-egress || echo "rc=$?"').out, /rc=1/);
});

test('ensure_workshop_image: built once per tag with the legacy builder; an existing tag is not rebuilt', () => {
  const w = world({ networks: {}, containers: {} });
  const a = w.run('ensure_workshop_image axion-workshop:abc /g/evolve/docker/workshop.Dockerfile /g/evolve/docker');
  assert.equal(a.code, 0, a.err);
  assert.ok(w.log().includes('build -q -f /g/evolve/docker/workshop.Dockerfile -t axion-workshop:abc /g/evolve/docker'));
  assert.equal(w.state().buildEnv, '0');
  const b = w.run('ensure_workshop_image axion-workshop:abc /g/evolve/docker/workshop.Dockerfile /g/evolve/docker');
  assert.match(b.out, /already done: axion-workshop:abc/);
  assert.equal(w.log().filter((l) => l.startsWith('build')).length, 1);
});

test('write_workshop_env: only CLAUDE_CODE_OAUTH_TOKEN=<TOKEN1>, mode 600, the value never printed; not rebuilt when present; refuses a missing token', () => {
  const w = world({ networks: {}, containers: {} });
  const tok1 = 'sk-' + 'ant-oat01-' + randomBytes(30).toString('base64url');
  const tok2 = 'sk-' + 'ant-oat01-' + randomBytes(30).toString('base64url');
  const src = join(w.dir, 'root.env');
  writeFileSync(src, `OTHER=1\nCLAUDE_CODE_OAUTH_TOKEN2=${tok2}\nCLAUDE_CODE_OAUTH_TOKEN1="${tok1}"\n`);
  const dest = join(w.dir, 'secrets', 'workshop.env');
  mkdirSync(join(w.dir, 'secrets'));
  const r = w.run(`write_workshop_env ${src} ${dest}`);
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(dest, 'utf8'), `CLAUDE_CODE_OAUTH_TOKEN=${tok1}\n`);
  assert.equal(statSync(dest).mode & 0o777, 0o600);
  for (const t of [tok1, tok2]) assert.ok(!r.out.includes(t) && !r.err.includes(t), 'never printed');
  assert.ok(!existsSync(`${dest}.tmp`));
  writeFileSync(src, `CLAUDE_CODE_OAUTH_TOKEN1=${tok2}\n`);
  assert.match(w.run(`write_workshop_env ${src} ${dest}`).out, /already done/);
  assert.equal(readFileSync(dest, 'utf8'), `CLAUDE_CODE_OAUTH_TOKEN=${tok1}\n`, 'kept, like live.env');
  const none = join(w.dir, 'none.env'); writeFileSync(none, 'CLAUDE_CODE_OAUTH_TOKEN2=x\n');
  const d2 = join(w.dir, 'secrets', 'w2.env');
  const bad = w.run(`write_workshop_env ${none} ${d2} || echo "rc=$?"`);
  assert.match(bad.out, /rc=1/);
  assert.ok(!existsSync(d2));
});

test('install_runner_unit: installed, daemon-reload, enabled (never --now, never started); idempotent', () => {
  const w = world({ networks: {}, containers: {} });
  const unit = new URL('../runner/axion-evolve.service', import.meta.url).pathname;
  const dir = join(w.dir, 'systemd'); mkdirSync(dir);
  const a = w.run(`install_runner_unit ${unit} ${dir}`);
  assert.equal(a.code, 0, a.err);
  assert.equal(readFileSync(join(dir, 'axion-evolve.service'), 'utf8'), readFileSync(unit, 'utf8'));
  const sys = w.log().filter((l) => l.startsWith('systemctl'));
  assert.ok(sys.includes('systemctl daemon-reload'));
  assert.ok(sys.includes('systemctl enable axion-evolve.service'));
  assert.ok(!sys.some((l) => /--now|start|restart/.test(l)), sys.join('; '));
  assert.equal(w.state().units!['axion-evolve.service'].active, 'inactive');
  const b = w.run(`install_runner_unit ${unit} ${dir}`);
  assert.match(b.out, /already done: .*axion-evolve\.service[\s\S]*already done: axion-evolve\.service is enabled/);
  assert.equal(w.state().reloads, 1);
});

test('runner_running: install.sh refuses while axion-evolve.service is active', () => {
  const on = world({ networks: {}, containers: {}, units: { 'axion-evolve.service': { enabled: 'enabled', active: 'active' } } });
  assert.match(on.run('runner_running && echo yes || echo no').out, /yes/);
  const off = world({ networks: {}, containers: {}, units: { 'axion-evolve.service': { enabled: 'enabled', active: 'inactive' } } });
  assert.match(off.run('runner_running && echo yes || echo no').out, /no/);
  assert.match(world({ networks: {}, containers: {} }).run('runner_running && echo yes || echo no').out, /no/);
  assert.match(readFileSync(new URL('../install.sh', import.meta.url), 'utf8'), /if runner_running; then .*exit 2; fi/);
});
