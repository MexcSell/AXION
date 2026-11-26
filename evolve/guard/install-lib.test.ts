// evolve/install-lib.sh (F1, I3) with fake `docker` and `systemctl` binaries on PATH: a small JSON-backed model of the
// networks/containers they touch, one-shot failure injection, and a log of every call. No real Docker or systemd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
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
die('fake docker: unexpected ' + line, 99);
`;

const FAKE_SYSTEMCTL = `#!/usr/bin/env node
const fs = require('node:fs');
const S = process.env.FAKE_STATE, L = process.env.FAKE_LOG;
const st = JSON.parse(fs.readFileSync(S, 'utf8'));
const a = process.argv.slice(2);
fs.appendFileSync(L, 'systemctl ' + a.join(' ') + '\\n');
const u = st.units[a.at(-1)];
if (a[0] === 'list-unit-files') { if (u) process.stdout.write(a.at(-1) + ' ' + u.enabled + '\\n'); process.exit(0); }
if (!u) process.exit(1);
if (a[0] === 'is-enabled') { process.stdout.write(u.enabled + '\\n'); process.exit(u.enabled === 'enabled' ? 0 : 1); }
if (a[0] === 'is-active') { process.stdout.write(u.active + '\\n'); process.exit(u.active === 'active' ? 0 : 3); }
if (a[0] === 'disable' && a[1] === '--now') { u.enabled = 'disabled'; u.active = 'inactive'; fs.writeFileSync(S, JSON.stringify(st)); process.exit(0); }
process.exit(99);
`;

type World = { networks: Record<string, { internal: boolean; inhibit: boolean }>; containers: Record<string, { running: boolean; networks: string[] }>;
  units?: Record<string, { enabled: string; active: string }>; failOnce?: string[] };

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
