import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProxy, parseAllow, isPrivateAddress } from './proxy.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function startEcho() {
  return new Promise((resolve) => {
    const conns = new Set();
    const events = { closed: 0 };
    const server = net.createServer((s) => {
      conns.add(s);
      s.on('data', (d) => s.write(d));
      s.on('error', () => {});
      s.on('close', () => { conns.delete(s); events.closed++; });
    });
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port, conns, events,
      close: () => { for (const c of conns) c.destroy(); server.close(); },
    }));
  });
}

async function setup(extraAllow = []) {
  const echo = await startEcho();
  const logs = [];
  const proxy = await startProxy({
    port: 0, host: '127.0.0.1', allowPrivate: true,
    allow: [`localhost:${echo.port}`, ...extraAllow],
    log: (l) => logs.push(l),
  });
  return { echo, logs, proxy, done: async () => { await proxy.close(); echo.close(); } };
}

// Send raw bytes to the proxy; resolve with { head, socket, rest } once the response head is in.
function rawRequest(proxyPort, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, '127.0.0.1');
    let buf = Buffer.alloc(0);
    socket.on('error', reject);
    socket.on('data', function onData(d) {
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf('\r\n\r\n');
      if (i >= 0) {
        socket.off('data', onData);
        resolve({ head: buf.subarray(0, i).toString(), rest: buf.subarray(i + 4), socket });
      }
    });
    socket.on('end', () => { if (buf.indexOf('\r\n\r\n') < 0) resolve({ head: buf.toString(), rest: Buffer.alloc(0), socket }); });
    socket.write(text);
  });
}
const connectReq = (target, extra = '') => `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${extra}\r\n`;
const status = (head) => Number(head.split(' ')[1]);
const read = (socket) => new Promise((res) => socket.once('data', res));

test('CONNECT to an allowed host:port is tunnelled', async () => {
  const t = await setup();
  const r = await rawRequest(t.proxy.port, connectReq(`localhost:${t.echo.port}`));
  assert.equal(status(r.head), 200);
  r.socket.write('hello');
  assert.equal((await read(r.socket)).toString(), 'hello');
  r.socket.destroy();
  await t.done();
});

test('host is case-insensitive and one trailing dot is stripped', async () => {
  const t = await setup();
  for (const h of ['LOCALHOST', 'localhost.', 'LocalHost.']) {
    const r = await rawRequest(t.proxy.port, connectReq(`${h}:${t.echo.port}`));
    assert.equal(status(r.head), 200, h);
    r.socket.destroy();
  }
  const r = await rawRequest(t.proxy.port, connectReq(`localhost..:${t.echo.port}`));
  assert.ok([400, 403].includes(status(r.head)));
  await t.done();
});

test('CONNECT to a host not on the list gets 403', async () => {
  const t = await setup();
  const r = await rawRequest(t.proxy.port, connectReq('example.com:443'));
  assert.equal(status(r.head), 403);
  await t.done();
});

test('same host on a different port gets 403', async () => {
  const t = await setup();
  const r = await rawRequest(t.proxy.port, connectReq(`localhost:${t.echo.port === 9 ? 10 : 9}`));
  assert.equal(status(r.head), 403);
  await t.done();
});

test('no wildcard or suffix matching', async () => {
  const t = await setup(['api.anthropic.com:443']);
  for (const h of ['api.anthropic.com.evil.com', 'evil.com', 'x.api.anthropic.com', 'anthropic.com',
    'api.anthropic.com.evil.com.', 'evilapi.anthropic.com', 'api.anthropic.com@evil.com']) {
    const r = await rawRequest(t.proxy.port, connectReq(`${h}:443`));
    assert.ok([400, 403].includes(status(r.head)), h);
  }
  await t.done();
});

test('an IP literal is refused even if its name would be allowed', async () => {
  const echoPort = (await startEcho());
  const logs = [];
  const forms = ['127.0.0.1', '[::1]', '[::ffff:127.0.0.1]', '2130706433', '0x7f000001', '017700000001',
    '127.1', '0177.0.0.1', '0x7f.0.0.1', '1.2.3.4', '[2001:db8::1]', '::1'];
  const allow = forms.map((f) => `${f}:${echoPort.port}`).concat([`127.0.0.1:${echoPort.port}`]);
  const proxy = await startProxy({ port: 0, host: '127.0.0.1', allowPrivate: true, allow, log: (l) => logs.push(l) });
  for (const f of forms) {
    const r = await rawRequest(proxy.port, connectReq(`${f}:${echoPort.port}`));
    assert.ok([400, 403].includes(status(r.head)), f);
  }
  assert.equal(echoPort.events.closed + echoPort.conns.size, 0, 'echo server must never be contacted');
  assert.ok(logs.every((l) => l.allowed === false));
  await proxy.close(); echoPort.close();
});

test('plain GET http://... gets 403 (and nothing is forwarded)', async () => {
  const t = await setup();
  const r = await rawRequest(t.proxy.port,
    `GET http://localhost:${t.echo.port}/ HTTP/1.1\r\nHost: localhost:${t.echo.port}\r\n\r\n`);
  assert.equal(status(r.head), 403);
  const r2 = await rawRequest(t.proxy.port, `POST /x HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n`);
  assert.equal(status(r2.head), 403);
  assert.equal(t.echo.events.closed + t.echo.conns.size, 0);
  await t.done();
});

test('malformed CONNECT targets never tunnel', async () => {
  const t = await setup();
  const bad = ['localhost', `:${t.echo.port}`, 'localhost:0', 'localhost:65536', 'localhost:abc', 'localhost:',
    `user@localhost:${t.echo.port}`, `user:pw@localhost:${t.echo.port}`, `localhost:${t.echo.port}:1`,
    `localhost:+${t.echo.port}`, `localhost:0${t.echo.port}x`, `local host:${t.echo.port}`, `localhost/x:${t.echo.port}`,
    `localhost:${t.echo.port}/`, `http://localhost:${t.echo.port}`, '', '*:443', `%6cocalhost:${t.echo.port}`];
  for (const b of bad) {
    const r = await rawRequest(t.proxy.port, `CONNECT ${b} HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.ok([400, 403].includes(status(r.head)), JSON.stringify(b) + ' -> ' + r.head);
  }
  assert.equal(t.echo.events.closed + t.echo.conns.size, 0, 'no upstream connection for malformed targets');
  await t.done();
});

test('request headers cannot redirect the tunnel', async () => {
  const t = await setup();
  const r = await rawRequest(t.proxy.port,
    connectReq(`localhost:${t.echo.port}`, 'Host: evil.com:443\r\nX-Forwarded-Host: evil.com\r\nForwarded: for=evil.com\r\n'));
  assert.equal(status(r.head), 200);
  r.socket.write('ping');
  assert.equal((await read(r.socket)).toString(), 'ping'); // still the echo server
  r.socket.destroy();
  await t.done();
});

test('bytes sent in the same packet as CONNECT reach the upstream', async () => {
  const t = await setup();
  const r = await rawRequest(t.proxy.port, connectReq(`localhost:${t.echo.port}`) + 'early');
  assert.equal(status(r.head), 200);
  const got = r.rest.length ? r.rest : await read(r.socket);
  assert.equal(got.toString(), 'early');
  r.socket.destroy();
  await t.done();
});

test('every decision is logged', async () => {
  const t = await setup();
  const a = await rawRequest(t.proxy.port, connectReq(`localhost:${t.echo.port}`));
  a.socket.destroy();
  await rawRequest(t.proxy.port, connectReq('evil.com:443'));
  await rawRequest(t.proxy.port, connectReq('127.0.0.1:80'));
  await rawRequest(t.proxy.port, 'GET http://evil.com/ HTTP/1.1\r\nHost: evil.com\r\n\r\n');
  await rawRequest(t.proxy.port, 'CONNECT nonsense HTTP/1.1\r\n\r\n');
  assert.equal(t.logs.length, 5);
  for (const l of t.logs) {
    assert.equal(typeof l.at, 'string');
    assert.ok(!Number.isNaN(Date.parse(l.at)));
    assert.ok('host' in l && 'port' in l);
    assert.equal(typeof l.allowed, 'boolean');
  }
  assert.deepEqual([t.logs[0].host, t.logs[0].port, t.logs[0].allowed], ['localhost', t.echo.port, true]);
  assert.deepEqual([t.logs[1].host, t.logs[1].port, t.logs[1].allowed], ['evil.com', 443, false]);
  assert.equal(t.logs[2].allowed, false);
  assert.equal(t.logs[3].allowed, false);
  assert.equal(t.logs[4].allowed, false);
  await t.done();
});

test('client closing ends the upstream side; upstream closing ends the client side', async () => {
  const t = await setup();
  const r = await rawRequest(t.proxy.port, connectReq(`localhost:${t.echo.port}`));
  r.socket.write('x'); await read(r.socket);
  assert.equal(t.echo.conns.size, 1);
  r.socket.destroy();
  for (let i = 0; i < 50 && t.echo.conns.size; i++) await new Promise((s) => setTimeout(s, 20));
  assert.equal(t.echo.conns.size, 0, 'upstream socket closed after client left');

  const r2 = await rawRequest(t.proxy.port, connectReq(`localhost:${t.echo.port}`));
  r2.socket.write('x'); await read(r2.socket);
  const closed = new Promise((res) => r2.socket.once('close', res));
  for (const c of t.echo.conns) c.resetAndDestroy(); // RST: must not crash the proxy
  await closed;
  const r3 = await rawRequest(t.proxy.port, connectReq(`localhost:${t.echo.port}`));
  assert.equal(status(r3.head), 200, 'proxy still alive');
  r3.socket.destroy();
  await t.done();
});

test('allowed host that refuses the connection gets 502, proxy survives', async () => {
  const probe = net.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const dead = probe.address().port; await new Promise((r) => probe.close(r));
  const logs = [];
  const proxy = await startProxy({ port: 0, host: '127.0.0.1', allowPrivate: true, allow: [`localhost:${dead}`], log: (l) => logs.push(l) });
  const r = await rawRequest(proxy.port, connectReq(`localhost:${dead}`));
  assert.equal(status(r.head), 502);
  await proxy.close();
});

test('close() tears down open tunnels', async () => {
  const t = await setup();
  const r = await rawRequest(t.proxy.port, connectReq(`localhost:${t.echo.port}`));
  const closed = new Promise((res) => r.socket.once('close', res));
  await t.proxy.close();
  await closed;
  t.echo.close();
});

test('parseAllow ignores comments and blank lines, normalises, drops IP entries', () => {
  const out = parseAllow('# c\n\n  API.Anthropic.com.:443  # trailing\n\t\nfoo.com:80\n127.0.0.1:80\n');
  assert.deepEqual(out, ['api.anthropic.com:443', 'foo.com:80']);
});

test('shipped allow.txt lists api.anthropic.com:443 and nothing wild', () => {
  const out = parseAllow(readFileSync(join(here, 'allow.txt'), 'utf8'));
  assert.ok(out.includes('api.anthropic.com:443'));
  assert.ok(out.every((e) => /^[a-z0-9.-]+:\d+$/.test(e)));
});

test('CLI: PORT and ALLOW_FILE env, one JSON log line per decision on stdout', async () => {
  const echo = await startEcho();
  const probe = net.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'egress-'));
  const file = join(dir, 'allow.txt');
  writeFileSync(file, `# test\nlocalhost:${echo.port}\n`);
  const child = spawn(process.execPath, [join(here, 'proxy.mjs')], { env: { ...process.env, PORT: String(port), ALLOW_FILE: file, ALLOW_PRIVATE: '1' } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  try {
    let r;
    for (let i = 0; i < 100; i++) {
      try { r = await rawRequest(port, connectReq(`localhost:${echo.port}`)); break; }
      catch { await new Promise((s) => setTimeout(s, 50)); }
    }
    assert.equal(status(r.head), 200);
    r.socket.destroy();
    await rawRequest(port, connectReq('evil.com:443'));
    await new Promise((s) => setTimeout(s, 200));
    const lines = out.trim().split('\n').map((l) => JSON.parse(l)).filter((l) => 'allowed' in l);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].allowed, true);
    assert.equal(lines[1].allowed, false);
  } finally { child.kill(); echo.close(); }
});

test('upstream RST after the 200 writes nothing into the tunnel (no 502)', async () => {
  const t = await setup();
  const r = await rawRequest(t.proxy.port, connectReq(`localhost:${t.echo.port}`));
  assert.equal(status(r.head), 200);
  const got = [];
  r.socket.on('data', (d) => got.push(d));
  const closed = new Promise((res) => r.socket.once('close', res));
  r.socket.write('x'); await new Promise((s) => setTimeout(s, 50));
  for (const c of t.echo.conns) c.resetAndDestroy();
  await closed;
  assert.equal(Buffer.concat(got.slice(1)).toString(), '', 'only the echo of x, nothing after');
  await t.done();
});

test('refused targets never log the raw target (userinfo secrets)', async () => {
  const t = await setup();
  await rawRequest(t.proxy.port, connectReq('user:SECRETTOKEN@api.anthropic.com:443'));
  await rawRequest(t.proxy.port, 'CONNECT SECRETTOKEN HTTP/1.1\r\n\r\n');
  await rawRequest(t.proxy.port, 'CONNECT [SECRETTOKEN]:1 HTTP/1.1\r\n\r\n');
  assert.equal(t.logs.length, 3);
  assert.ok(!JSON.stringify(t.logs).includes('SECRETTOKEN'));
  await t.done();
});

test('connect timeout sends 502 and closes', async () => {
  const logs = [];
  const proxy = await startProxy({
    port: 0, host: '127.0.0.1', allowPrivate: true, allow: ['localhost:9'], connectMs: 100, log: (l) => logs.push(l),
    dial: () => new net.Socket(), // a socket that never connects: stands in for a black hole
  });
  const r = await rawRequest(proxy.port, connectReq('localhost:9'));
  assert.equal(status(r.head), 502);
  assert.ok(logs.some((l) => l.event === 'upstream_error' && l.code === 'ETIMEDOUT'));
  await proxy.close();
});

test('allowlisted name resolving to a private address is refused unless allowPrivate', async () => {
  const echo = await startEcho();
  const logs = [];
  const proxy = await startProxy({ port: 0, host: '127.0.0.1', allow: [`localhost:${echo.port}`], log: (l) => logs.push(l) });
  const r = await rawRequest(proxy.port, connectReq(`localhost:${echo.port}`));
  assert.equal(status(r.head), 403);
  assert.deepEqual(logs.map((l) => [l.allowed, l.reason]), [[false, 'private address']]);
  assert.equal(echo.events.closed + echo.conns.size, 0, 'never dialled');
  await proxy.close(); echo.close();
});

test('isPrivateAddress covers loopback, RFC1918, link-local, ULA, CGNAT, unspecified, mapped', () => {
  for (const a of ['127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:8.8.8.8', 'ff02::1', 'garbage'])
    assert.equal(isPrivateAddress(a), true, a);
  for (const a of ['8.8.8.8', '160.79.104.10', '172.32.0.1', '100.128.0.1', '2607:6bc0::10', '2001:4860:4860::8888'])
    assert.equal(isPrivateAddress(a), false, a);
});

test('CLI: IDLE_MS closes an idle tunnel', async () => {
  const echo = await startEcho();
  const probe = net.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  const dir = mkdtempSync(join(tmpdir(), 'egress-'));
  const file = join(dir, 'allow.txt');
  writeFileSync(file, `localhost:${echo.port}\n`);
  const child = spawn(process.execPath, [join(here, 'proxy.mjs')],
    { env: { ...process.env, PORT: String(port), ALLOW_FILE: file, ALLOW_PRIVATE: '1', IDLE_MS: '200' } });
  try {
    let r;
    for (let i = 0; i < 100; i++) {
      try { r = await rawRequest(port, connectReq(`localhost:${echo.port}`)); break; }
      catch { await new Promise((s) => setTimeout(s, 50)); }
    }
    assert.equal(status(r.head), 200);
    const t0 = Date.now();
    await new Promise((res) => r.socket.once('close', res));
    assert.ok(Date.now() - t0 < 2000);
  } finally { child.kill(); echo.close(); }
});

test('idleMs option closes an idle tunnel', async () => {
  const echo = await startEcho();
  const proxy = await startProxy({ port: 0, host: '127.0.0.1', allowPrivate: true, allow: [`localhost:${echo.port}`], idleMs: 150 });
  const r = await rawRequest(proxy.port, connectReq(`localhost:${echo.port}`));
  assert.equal(status(r.head), 200);
  await new Promise((res) => r.socket.once('close', res));
  await proxy.close(); echo.close();
});
