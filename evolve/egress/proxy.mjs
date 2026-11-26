// Egress proxy: the only way out of the internal Docker network.
// HTTP CONNECT tunnels to exact allowlisted host:port pairs; everything else is refused.
// node:-built-ins only. Security boundary: keep it small and strict.
import http from 'node:http';
import net from 'node:net';
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

const REASONS = { 400: 'Bad Request', 403: 'Forbidden', 502: 'Bad Gateway' };
function reply(socket, code) {
  if (socket.destroyed || !socket.writable) return;
  socket.end(`HTTP/1.1 ${code} ${REASONS[code]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function startProxy({ port, allow, log = () => {}, host = '0.0.0.0', idleMs = 120_000, connectMs = 10_000, maxConnections = 256 }) {
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
    const t = parseTarget(req.url);
    if (!t.ok) {
      emit({ host: t.host ?? null, port: t.port ?? null, allowed: false, reason: t.reason, ...(t.host ? {} : { target: String(req.url).slice(0, 100) }) });
      return reply(client, t.status);
    }
    if (!allowed.has(`${t.host}:${t.port}`)) {
      emit({ host: t.host, port: t.port, allowed: false, reason: 'not on allowlist' });
      return reply(client, 403);
    }
    emit({ host: t.host, port: t.port, allowed: true });

    // The proxy resolves and dials the name itself; nothing from the request headers is used.
    const upstream = net.connect({ host: t.host, port: t.port });
    sockets.add(upstream);
    const teardown = () => { client.destroy(); upstream.destroy(); };
    upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
    client.on('close', () => upstream.destroy());
    upstream.on('error', () => {});
    upstream.setTimeout(connectMs, () => upstream.destroy());
    upstream.once('error', (e) => {
      emit({ host: t.host, port: t.port, allowed: true, event: 'upstream_error', code: e.code || 'ERR' });
      reply(client, 502);
    });
    upstream.once('connect', () => {
      upstream.setTimeout(idleMs, teardown);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
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
  const p = await startProxy({ port, allow, log });
  log({ at: new Date().toISOString(), event: 'listening', port: p.port, allow });
  const stop = () => p.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
