// Egress proxy: the only way out of the internal Docker network.
// HTTP CONNECT tunnels to exact allowlisted host:port pairs; everything else is refused.
// node:-built-ins only. Security boundary: keep it small and strict.
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_RE = /^[a-z0-9_]([a-z0-9_-]|\.(?=[a-z0-9_]))*$/; // no empty labels, no odd characters
const NUMERIC_LABEL = /^(0x[0-9a-f]*|[0-9]+)$/;              // decimal / hex / octal integer pieces

// Lowercase, strip ONE trailing dot.
function normHost(h) {
  h = h.toLowerCase();
  return h.endsWith('.') ? h.slice(0, -1) : h;
}

// True for anything that is, or could be parsed by a resolver as, an IP address.
function looksLikeIp(host) {
  if (host.includes(':') || host.startsWith('[')) return true;
  if (net.isIP(host)) return true;
  const last = host.slice(host.lastIndexOf('.') + 1);
  return NUMERIC_LABEL.test(last); // 2130706433, 0x7f000001, 017700000001, 127.1, ...
}

// Parse a CONNECT authority. Returns { ok:true, host, port } or { ok:false, status, reason }.
export function parseTarget(target) {
  if (typeof target !== 'string' || target.length === 0 || target.length > 300) return { ok: false, status: 400, reason: 'bad target' };
  if (target.includes('@')) return { ok: false, status: 400, reason: 'userinfo not allowed' };
  if (target.startsWith('[')) return { ok: false, status: 403, reason: 'ip literal' };
  const m = /^([^:]*):([0-9]{1,5})$/.exec(target);
  if (!m) return { ok: false, status: 400, reason: 'bad target' };
  const port = Number(m[2]);
  if (!(port >= 1 && port <= 65535)) return { ok: false, status: 400, reason: 'bad port' };
  if (m[1] === '') return { ok: false, status: 400, reason: 'empty host' };
  const host = normHost(m[1]);
  if (!HOST_RE.test(host)) return { ok: false, status: 400, reason: 'bad host' };
  if (looksLikeIp(host)) return { ok: false, host, port, status: 403, reason: 'ip literal' };
  return { ok: true, host, port };
}

// allow.txt format: one host:port per line, '#' comments, blank lines ignored.
// Entries are normalised the same way as targets; invalid or IP entries are dropped.
export function parseAllow(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const p = parseTarget(line);
    if (p.ok) out.push(`${p.host}:${p.port}`);
  }
  return out;
}

// Addresses an allowlisted name must never resolve to (SSRF / DNS-rebinding guard).
const PRIVATE = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) PRIVATE.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::', 96], ['64:ff9b::', 96], ['100::', 64], ['fc00::', 7],
  ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) PRIVATE.addSubnet(a, n, 'ipv6');
export function isPrivateAddress(addr) {
  const fam = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
  if (fam === null) return true; // unparseable counts as refused
  // Every IPv4-mapped IPv6 form is refused (BlockList would fold ::ffff:0:0/96 into 0.0.0.0/0, so do it by hand).
  if (fam === 'ipv6' && /^\[::ffff:/.test(new URL(`http://[${addr}]`).hostname)) return true;
  return PRIVATE.check(addr, fam);
}

const REASONS = { 400: 'Bad Request', 403: 'Forbidden', 502: 'Bad Gateway' };
function reply(socket, code) {
  if (socket.destroyed || !socket.writable) return;
  socket.end(`HTTP/1.1 ${code} ${REASONS[code]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function startProxy({ port, allow, log = () => {}, host = '0.0.0.0', idleMs = 120_000, connectMs = 10_000,
  maxConnections = 256, allowPrivate = false, dial = (o) => net.connect(o) }) {
  const allowed = new Set(parseAllow((allow || []).join('\n')));
  const sockets = new Set();
  const emit = (line) => { try { log({ at: new Date().toISOString(), ...line }); } catch { /* logging must never break the proxy */ } };

  const server = http.createServer((req, res) => {
    // Any non-CONNECT request (including absolute-form GET http://...) is refused.
    emit({ host: null, port: null, allowed: false, reason: 'method not allowed', method: String(req.method).slice(0, 16) });
    res.writeHead(403, { 'Content-Length': 0, Connection: 'close' });
    res.end();
  });
  server.maxConnections = maxConnections;
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.on('error', () => {});
    s.setTimeout(idleMs, () => s.destroy());
  });
  server.on('clientError', (err, socket) => {
    emit({ host: null, port: null, allowed: false, reason: 'bad request' });
    reply(socket, 400);
  });

  server.on('connect', (req, client, head) => {
    client.on('error', () => {});
    let clientGone = false;
    client.on('close', () => { clientGone = true; });
    const t = parseTarget(req.url);
    if (!t.ok) {
      // Never log the raw target: it may carry userinfo credentials. Length only.
      emit({ host: t.host ?? null, port: t.port ?? null, allowed: false, reason: t.reason, targetLength: String(req.url).length });
      return reply(client, t.status);
    }
    if (!allowed.has(`${t.host}:${t.port}`)) {
      emit({ host: t.host, port: t.port, allowed: false, reason: 'not on allowlist' });
      return reply(client, 403);
    }

    // The proxy resolves the name itself, vets every address, and dials only the vetted result;
    // nothing from the request headers is used.
    dns.lookup(t.host, { all: true, verbatim: true }, (dnsErr, addrs) => {
      if (clientGone) return;
      if (!dnsErr && !allowPrivate && addrs.some((a) => isPrivateAddress(a.address))) {
        emit({ host: t.host, port: t.port, allowed: false, reason: 'private address' });
        return reply(client, 403);
      }
      emit({ host: t.host, port: t.port, allowed: true });
      if (dnsErr || addrs.length === 0) {
        emit({ host: t.host, port: t.port, allowed: true, event: 'upstream_error', code: dnsErr?.code || 'ENOTFOUND' });
        return reply(client, 502);
      }
      const pinned = (_h, opts, cb) => (opts && opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family));
      const upstream = dial({ host: t.host, port: t.port, lookup: pinned });
      sockets.add(upstream);
      let connected = false;
      const teardown = () => { client.destroy(); upstream.destroy(); };
      const connectTimer = setTimeout(() => {
        if (!connected) upstream.destroy(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' }));
      }, connectMs);
      upstream.on('close', () => { clearTimeout(connectTimer); sockets.delete(upstream); client.destroy(); });
      client.on('close', () => { clearTimeout(connectTimer); upstream.destroy(); });
      upstream.on('error', (e) => {
        if (connected) return teardown(); // inside the tunnel: never write plaintext HTTP, just close
        emit({ host: t.host, port: t.port, allowed: true, event: 'upstream_error', code: e.code || 'ERR' });
        reply(client, 502);
      });
      upstream.once('connect', () => {
        connected = true;
        clearTimeout(connectTimer);
        upstream.setTimeout(idleMs, teardown);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({
        port: server.address().port,
        close: () => new Promise((res) => {
          server.close(() => res());
          for (const s of sockets) s.destroy();
        }),
      });
    });
  });
}

// CLI: node evolve/egress/proxy.mjs   (PORT default 3128, ALLOW_FILE default sibling allow.txt)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = process.env.ALLOW_FILE || join(here, 'allow.txt');
  const allow = parseAllow(readFileSync(file, 'utf8'));
  const port = process.env.PORT === undefined || process.env.PORT === '' ? 3128 : Number(process.env.PORT);
  const log = (line) => process.stdout.write(JSON.stringify(line) + '\n');
  const idleMs = process.env.IDLE_MS ? Number(process.env.IDLE_MS) : 120_000;
  // ALLOW_PRIVATE=1 exists for local testing only; in the container it must stay unset.
  const allowPrivate = process.env.ALLOW_PRIVATE === '1';
  const p = await startProxy({ port, allow, log, idleMs, allowPrivate });
  log({ at: new Date().toISOString(), event: 'listening', port: p.port, allow });
  const stop = () => p.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
