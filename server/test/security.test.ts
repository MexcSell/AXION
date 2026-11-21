// Cycle 14 (security S1): HTTP hardening. Headers on every API response, JSON body limits on every write route,
// per-session write rate limits, CSRF + Origin on every write route added since Stage 5, cookie flags.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';
import { DEFAULT_WRITE_LIMITS, LIMITED_ROUTES } from '../src/ratelimit.ts';

const cookieOf = (b: Browser) => [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
async function upload(app: FastifyInstance, b: Browser, name = 'shot.png', bytes = PNG) {
  const boundary = '----axion' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return app.inject({ method: 'POST', url: '/api/v1/uploads', headers: { cookie: cookieOf(b), 'x-csrf': b.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([head, bytes, tail]) });
}
/** A second session of the same user on the same (already approved) device: a fresh sign-in with that device's cookie. */
async function sameDevice(b: Browser, name: string) {
  const n = new Browser(b.app);
  n.jar.set('axion_dev', b.jar.get('axion_dev')!);
  const r = await n.connect(name, 'pass1234');
  if (r.status !== 200) throw new Error('second session failed ' + JSON.stringify(r.body));
  return n;
}
let ik = 0;
const idem = () => ({ 'idempotency-key': 'c14-' + Date.now() + '-' + ik++ });
const envelope = (body: any, code: string) => {
  expect(body.code).toBe(code);
  expect(typeof body.message).toBe('string');
  expect(typeof body.correlationId).toBe('string');
  expect(typeof body.retryable).toBe('boolean');
};

// Every write route added since Stage 5 (boundary commit dda96f3, the last Stage 5 commit): Stage 6 and cycles 1-3.
const SINCE_STAGE5_WRITES: [string, string][] = [
  ['POST', '/api/v1/agents'],
  ['PATCH', '/api/v1/agents/:id'],
  ['POST', '/api/v1/channels/:key/messages'],
  ['POST', '/api/v1/channels/admin/:userId/messages'],
  ['POST', '/api/v1/missions/:id/threads'],
  ['POST', '/api/v1/threads/:id/messages'],
  ['POST', '/api/v1/organization/proposals'],
  ['POST', '/api/v1/organization/proposals/:id/decision'],
  ['POST', '/api/v1/organization/proposals/:id/withdraw'],
  ['POST', '/api/v1/tasks/:id/:action'],
];
const fill = (url: string) => url.replace(/:(\w+)/g, (_m, k) => (k === 'key' ? 'gm' : k === 'action' ? 'retry' : `x-${k}-1`));

let t: TestApp;
let admin: Browser;
let mina: Browser;
let kenji: Browser;
const LIMIT = 3;
beforeAll(async () => {
  t = await makeTestApp({
    writeLimits: { messages: { max: LIMIT, windowMs: 60_000 }, proposals: { max: LIMIT, windowMs: 60_000 }, uploads: { max: LIMIT, windowMs: 60_000 } },
    configure: (app: FastifyInstance) => app.get('/api/v1/__boom', async () => { throw new Error('boom'); }),
  });
  const w = await withAdmin(t.app);
  admin = w.admin;
  mina = (await w.member('Mina')).b;
  kenji = (await w.member('Kenji')).b;
});
afterAll(async () => { await t?.close(); });

describe('security headers on every API response', () => {
  // one sample of each kind of response: public, authenticated JSON, 401, 403 (CSRF), 404, 413, 429, 500
  const samples: Record<string, { statusCode: number; headers: Record<string, unknown> }> = {};
  beforeAll(async () => {
    samples.health = await t.app.inject({ method: 'GET', url: '/api/v1/health' });
    samples.me = await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: cookieOf(admin) } });
    samples.unauth = await t.app.inject({ method: 'GET', url: '/api/v1/me' });
    samples.csrf = await t.app.inject({ method: 'POST', url: '/api/v1/missions', headers: { cookie: cookieOf(admin), 'content-type': 'application/json' }, payload: '{}' });
    samples.notFound = await t.app.inject({ method: 'GET', url: '/api/v1/nope' });
    samples.tooLarge = await t.app.inject({ method: 'POST', url: '/api/v1/missions', headers: { cookie: cookieOf(admin), 'x-csrf': admin.csrf, 'content-type': 'application/json' }, payload: JSON.stringify({ text: 'x'.repeat(1_100_000) }) });
    const k = await sameDevice(admin, 'Luca'); // a separate admin session so the 429 sample does not use up the others' budgets
    let r;
    for (let i = 0; i <= LIMIT; i++) r = await k.req('POST', '/organization/proposals', {});
    samples.limited = r!.raw as any;
    samples.boom = await t.app.inject({ method: 'GET', url: '/api/v1/__boom' });
  });

  it('the samples are what they claim to be', () => {
    expect(Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, v.statusCode]))).toEqual({ health: 200, me: 200, unauth: 401, csrf: 403, notFound: 404, tooLarge: 413, limited: 429, boom: 500 });
  });
  const each = (name: string, f: (h: Record<string, unknown>) => void) => it(name, () => { for (const [k, s] of Object.entries(samples)) { try { f(s.headers); } catch (e) { throw new Error(`${k}: ${(e as Error).message}`); } } });
  each('X-Content-Type-Options: nosniff', (h) => expect(h['x-content-type-options']).toBe('nosniff'));
  each('Referrer-Policy: no-referrer', (h) => expect(h['referrer-policy']).toBe('no-referrer'));
  each('X-Frame-Options: DENY', (h) => expect(h['x-frame-options']).toBe('DENY'));
  each("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'", (h) => {
    expect(String(h['content-security-policy'])).toMatch(/(^|;\s*)frame-ancestors 'none'(;|$)/);
    expect(String(h['content-security-policy'])).toMatch(/(^|;\s*)default-src 'none'(;|$)/);
  });
  each('Cross-Origin-Opener-Policy: same-origin', (h) => expect(h['cross-origin-opener-policy']).toBe('same-origin'));
  each('Cache-Control: no-store (authenticated JSON and everything else)', (h) => expect(h['cache-control']).toBe('no-store'));
  each('no CORS grant to any other origin', (h) => expect(h['access-control-allow-origin']).toBeUndefined());

  it('a cross-site GET gets no CORS grant either', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: cookieOf(admin), origin: 'https://evil.example' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('a downloaded upload keeps its CSP sandbox, adds frame-ancestors, and is not cached', async () => {
    const up = await upload(t.app, kenji);
    expect(up.statusCode).toBe(201);
    const dl = await t.app.inject({ method: 'GET', url: `/api/v1/uploads/${up.json().id}`, headers: { cookie: cookieOf(kenji) } });
    expect(dl.statusCode).toBe(200);
    const csp = String(dl.headers['content-security-policy']);
    expect(csp).toMatch(/^sandbox;/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(dl.headers['cache-control']).toBe('no-store');
  });

  it('the live event stream (a hijacked response) carries the same headers', async () => {
    const t2 = await makeTestApp();
    try {
      const { admin: a } = await withAdmin(t2.app);
      await t2.app.listen({ host: '127.0.0.1', port: 0 });
      const addr = t2.app.server.address() as { port: number };
      const ac = new AbortController();
      try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/events/stream`, { headers: { cookie: cookieOf(a), accept: 'text/event-stream' }, signal: ac.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(res.headers.get('cache-control')).toMatch(/no-cache/);
      } finally { ac.abort(); }
    } finally { await t2.close(); }
  });
});

describe('JSON body limits', () => {
  it('every JSON write route refuses a body over 1 MB with 413 and the error envelope (no route raises the limit)', async () => {
    const writes = t.app.routeTable.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && r.url.startsWith('/api/v1/'));
    expect(writes.length).toBeGreaterThanOrEqual(30);
    const big = JSON.stringify({ text: 'x'.repeat(1_000_001) });
    const bad: string[] = [];
    for (const r of writes) {
      expect(r.bodyLimit ?? 1_000_000, `${r.method} ${r.url} bodyLimit`).toBeLessThanOrEqual(1_000_000);
      const res = await t.app.inject({ method: r.method as 'POST', url: fill(r.url), headers: { cookie: cookieOf(admin), 'x-csrf': admin.csrf, 'content-type': 'application/json' }, payload: big });
      if (res.statusCode !== 413 || res.json().correlationId === undefined) bad.push(`${r.method} ${r.url} -> ${res.statusCode}`);
    }
    expect(bad).toEqual([]);
  });

  it('a body just under the limit is read (the limit is the 1 MB global one, not smaller by accident)', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/missions', headers: { cookie: cookieOf(admin), 'x-csrf': admin.csrf, 'content-type': 'application/json' }, payload: JSON.stringify({ text: 'x'.repeat(900_000) }) });
    expect(res.statusCode).not.toBe(413);
  });

  it('uploads stay at most 25 MB', async () => {
    const big = await upload(t.app, admin, 'big.txt', Buffer.alloc(25 * 1024 * 1024 + 10, 0x61));
    expect(big.statusCode).toBe(413);
    envelope(big.json(), 'UPLOAD_REJECTED');
  });
});

describe('per-session write rate limits', () => {
  it('defaults are generous enough for real use', () => {
    expect(DEFAULT_WRITE_LIMITS.messages.max / (DEFAULT_WRITE_LIMITS.messages.windowMs / 60_000)).toBeGreaterThanOrEqual(60);
    expect(DEFAULT_WRITE_LIMITS.proposals.max / (DEFAULT_WRITE_LIMITS.proposals.windowMs / 60_000)).toBeGreaterThanOrEqual(20);
    expect(DEFAULT_WRITE_LIMITS.uploads.max / (DEFAULT_WRITE_LIMITS.uploads.windowMs / 60_000)).toBeGreaterThanOrEqual(20);
  });

  it('messages: the next post over the limit gets 429 RATE_LIMITED with the envelope and Retry-After; another session is unaffected', async () => {
    const b = await sameDevice(mina, 'Mina');
    for (let i = 0; i < LIMIT; i++) expect((await b.req('POST', '/channels/gm/messages', { kind: 'reply', text: `hello ${i}` }, idem())).status).toBe(201);
    const r = await b.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'one too many' }, idem());
    expect(r.status).toBe(429);
    envelope(r.body, 'RATE_LIMITED');
    expect(r.body.retryable).toBe(true);
    expect(Number(r.raw.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(r.raw.headers['retry-after'])).toBeLessThanOrEqual(60);
    // all message routes share the bucket
    expect((await b.req('POST', '/threads/x-th-1/messages', { kind: 'reply', text: 'x', to: 'gm' }, idem())).status).toBe(429);
    // nothing was written by the refused post
    const n = (await t.pool.query(`select count(*)::int n from messages where body = 'one too many'`)).rows[0].n;
    expect(n).toBe(0);
    // another session of the same user has its own budget; reads are never limited
    const other = await sameDevice(mina, 'Mina');
    expect((await other.req('POST', '/channels/gm/messages', { kind: 'reply', text: 'from the other tab' }, idem())).status).toBe(201);
    expect((await b.req('GET', '/channels/gm/messages')).status).toBe(200);
  });

  it('proposals: create, decision and withdraw share one per-session budget (refused attempts count)', async () => {
    const b = await sameDevice(admin, 'Luca');
    const s: number[] = [];
    s.push((await b.req('POST', '/organization/proposals', {})).status);
    s.push((await b.req('POST', '/organization/proposals/p-x/decision', { decision: 'approve' })).status);
    s.push((await b.req('POST', '/organization/proposals/p-x/withdraw', {})).status);
    expect(s.every((x) => x !== 429)).toBe(true);
    const r = await b.req('POST', '/organization/proposals', {});
    expect(r.status).toBe(429);
    envelope(r.body, 'RATE_LIMITED');
  });

  it('uploads: the next upload over the limit is refused before the file is read', async () => {
    const b = await sameDevice(kenji, 'Kenji');
    for (let i = 0; i < LIMIT; i++) expect((await upload(t.app, b)).statusCode).toBe(201);
    const before = (await t.pool.query('select count(*)::int n from uploads')).rows[0].n;
    const r = await upload(t.app, b);
    expect(r.statusCode).toBe(429);
    envelope(r.json(), 'RATE_LIMITED');
    expect((await t.pool.query('select count(*)::int n from uploads')).rows[0].n).toBe(before);
  });

  // Merge follow-up (c14 review I1): the map is hand-kept, so the route table guards it. Every write route of a limited
  // kind (messages, uploads, and governance writes: proposals of any kind, rollbacks, mentoring plans) must be in
  // LIMITED_ROUTES, and every key of LIMITED_ROUTES must be a real route.
  const LIMITED_KIND = /\/messages$|proposal|rollback|mentoring|\/uploads$/;
  it('route table: every message, upload and governance write route is in LIMITED_ROUTES; every limited route exists', () => {
    const writes = t.app.routeTable.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && r.url.startsWith('/api/v1/')).map((r) => `${r.method} ${r.url}`);
    const must = writes.filter((k) => LIMITED_KIND.test(k.split(' ')[1]));
    // the pattern must keep catching the routes it was written for (a weakened pattern fails here)
    expect(must).toEqual(expect.arrayContaining([
      'POST /api/v1/threads/:id/messages', 'POST /api/v1/channels/:key/messages', 'POST /api/v1/channels/admin/:userId/messages', 'POST /api/v1/uploads',
      'POST /api/v1/organization/proposals', 'POST /api/v1/organization/proposals/:id/decision', 'POST /api/v1/organization/proposals/:id/withdraw',
      'POST /api/v1/organization/revisions/:seq/rollback-proposal',
      'POST /api/v1/agents/:id/version-proposals', 'POST /api/v1/version-proposals/:pid/decision', 'POST /api/v1/version-proposals/:pid/withdraw', 'POST /api/v1/agents/:id/rollback',
      'POST /api/v1/agents/:id/mentoring', 'POST /api/v1/mentoring/:pid/milestones/:mid/done', 'POST /api/v1/mentoring/:pid/close',
    ]));
    expect(must.filter((k) => !(k in LIMITED_ROUTES))).toEqual([]);
    expect(Object.keys(LIMITED_ROUTES).filter((k) => !writes.includes(k))).toEqual([]);
  });

  it('governance: version proposals, agent rollback, org rollback proposals and mentoring writes share the proposals budget', async () => {
    const b = await sameDevice(admin, 'Luca');
    const s: number[] = [];
    s.push((await b.req('POST', '/agents/no-such-agent/version-proposals', {})).status);
    s.push((await b.req('POST', '/organization/revisions/999/rollback-proposal', {})).status);
    s.push((await b.req('POST', '/mentoring/no-such-plan/close', {})).status);
    expect(s.every((x) => x !== 429)).toBe(true);
    for (const [url, body] of [['/agents/no-such-agent/rollback', {}], ['/version-proposals/no-such/decision', { decision: 'approve' }], ['/agents/no-such-agent/mentoring', {}]] as const) {
      const r = await b.req('POST', url, body);
      expect(r.status, url).toBe(429);
      envelope(r.body, 'RATE_LIMITED');
    }
  });

  it('a request without a valid session is refused as before (401), not counted', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/channels/gm/messages', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(r.statusCode).toBe(401);
  });
});

describe('CSRF and Origin on every write route added since Stage 5 (Stage 6, cycles 1-3)', () => {
  it('the list is complete: every one of these routes exists', () => {
    const have = new Set(t.app.routeTable.map((r) => `${r.method} ${r.url}`));
    for (const [m, u] of SINCE_STAGE5_WRITES) expect(have.has(`${m} ${u}`), `${m} ${u}`).toBe(true);
  });

  it.each(SINCE_STAGE5_WRITES)('%s %s refuses a missing X-CSRF with 403 CSRF', async (method, url) => {
    const r = await t.app.inject({ method: method as 'POST', url: fill(url), headers: { cookie: cookieOf(admin), 'content-type': 'application/json' }, payload: '{}' });
    expect(r.statusCode).toBe(403);
    envelope(r.json(), 'CSRF');
  });

  it.each(SINCE_STAGE5_WRITES)('%s %s refuses a wrong X-CSRF with 403 CSRF', async (method, url) => {
    const r = await t.app.inject({ method: method as 'POST', url: fill(url), headers: { cookie: cookieOf(admin), 'x-csrf': 'not-the-token', 'content-type': 'application/json' }, payload: '{}' });
    expect(r.statusCode).toBe(403);
    envelope(r.json(), 'CSRF');
  });

  it.each(SINCE_STAGE5_WRITES)('%s %s refuses a cross-site Origin with 403 CSRF even with a valid X-CSRF', async (method, url) => {
    const r = await t.app.inject({ method: method as 'POST', url: fill(url), headers: { cookie: cookieOf(admin), 'x-csrf': admin.csrf, origin: 'https://evil.example', host: '127.0.0.1:5191', 'content-type': 'application/json' }, payload: '{}' });
    expect(r.statusCode).toBe(403);
    envelope(r.json(), 'CSRF');
  });

  it('control: the same-origin request with a valid X-CSRF is not refused as CSRF', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/organization/proposals/p-x/withdraw', headers: { cookie: cookieOf(admin), 'x-csrf': admin.csrf, origin: 'http://127.0.0.1:5191', host: '127.0.0.1:5191', 'content-type': 'application/json' }, payload: '{}' });
    expect(r.statusCode).not.toBe(403);
  });

  it('every other write route also refuses a missing X-CSRF (only sign-in and leaving the waiting room are exempt: no session yet)', async () => {
    const exempt = new Set(['POST /api/v1/auth/connect', 'POST /api/v1/auth/cancel']);
    const writes = t.app.routeTable.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && r.url.startsWith('/api/v1/') && !exempt.has(`${r.method} ${r.url}`));
    const bad: string[] = [];
    for (const r of writes) {
      const res = await t.app.inject({ method: r.method as 'POST', url: fill(r.url), headers: { cookie: cookieOf(admin), 'content-type': 'application/json' }, payload: '{}' });
      if (res.statusCode !== 403 || res.json().code !== 'CSRF') bad.push(`${r.method} ${r.url} -> ${res.statusCode} ${res.json().code}`);
    }
    expect(bad).toEqual([]);
  });

  it('every write route, sign-in included, refuses a cross-site Origin', async () => {
    const writes = t.app.routeTable.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && r.url.startsWith('/api/v1/'));
    const bad: string[] = [];
    for (const r of writes) {
      const res = await t.app.inject({ method: r.method as 'POST', url: fill(r.url), headers: { cookie: cookieOf(admin), 'x-csrf': admin.csrf, origin: 'https://evil.example', host: '127.0.0.1:5191', 'content-type': 'application/json' }, payload: '{}' });
      if (res.statusCode !== 403 || res.json().code !== 'CSRF') bad.push(`${r.method} ${r.url} -> ${res.statusCode}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('cookie flags', () => {
  it('session, device and waiting-room cookies (set and cleared) are HttpOnly, SameSite=Strict, Path=/', async () => {
    const n = new Browser(t.app);
    n.jar.set('axion_dev', admin.jar.get('axion_dev')!);
    const r = await n.connect('Luca', 'pass1234'); // a full session: sets axion_sid, clears axion_wait
    expect(r.status).toBe(200);
    const w = await new Browser(t.app).connect('Newcomer', 'pass1234'); // waits for approval: sets axion_dev + axion_wait, clears axion_sid
    expect(w.status).toBe(202);
    const all = [...(r.raw.cookies as any[]), ...(w.raw.cookies as any[])];
    const names = new Set(all.filter((c) => c.value).map((c) => c.name));
    for (const x of ['axion_sid', 'axion_dev', 'axion_wait']) expect(names.has(x), x).toBe(true);
    for (const c of all) {
      expect(c.httpOnly, c.name).toBe(true);
      expect(String(c.sameSite).toLowerCase(), c.name).toBe('strict');
      expect(c.path, c.name).toBe('/');
    }
  });
});
