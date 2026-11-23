import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

/**
 * Test-only fault seams (never in src). Two kinds, both installed through buildApp's `configure` hook on the app of one tenant:
 *  - a SQL seam: every statement of that app's pool passes through `seam.fn`, which may return a rewritten statement (a dropped
 *    tenant predicate, a parameter swapped to the other tenant). Off unless a mutant sets it.
 *  - a response cache keyed by the URL alone, shared by both apps (a cache that forgot the tenant). Off unless a mutant switches it on.
 */
export type Rewrite = (sql: string, params: unknown[]) => { sql: string; params: unknown[] } | null;
export interface Seam { fn: Rewrite | null; applied: number; cacheOn: boolean; fromHeader: boolean }
/** c81: the tenant id a request asked for in its `x-tenant-id` header, while a mutant that trusts that header is armed (null otherwise). */
export const asked = { tenant: null as string | null };
export const SEAMS = new WeakMap<FastifyInstance, Seam>();
export const sharedCache = new Map<string, { status: number; type: string; body: string }>();

export function attachSeams(app: FastifyInstance) {
  const seam: Seam = { fn: null, applied: 0, cacheOn: false, fromHeader: false };
  SEAMS.set(app, seam);
  const pool = app.db as pg.Pool;
  const patch = (c: any) => {
    if (c.__c79) return;
    c.__c79 = true;
    const q = c.query.bind(c);
    c.query = (...a: any[]) => {
      if (seam.fn) {
        const first = a[0];
        const text: string | undefined = typeof first === 'string' ? first : typeof first?.text === 'string' ? first.text : undefined;
        const params: unknown[] = Array.isArray(a[1]) ? a[1] : Array.isArray(first?.values) ? first.values : [];
        if (text) {
          const out = seam.fn(text, params);
          if (out && (out.sql !== text || out.params.some((p, i) => p !== params[i]))) {
            seam.applied++;
            if (typeof first === 'string') { a[0] = out.sql; if (Array.isArray(a[1])) a[1] = out.params; }
            else a[0] = { ...first, text: out.sql, ...(Array.isArray(first.values) ? { values: out.params } : {}) }, Array.isArray(a[1]) && (a[1] = out.params);
          }
        }
      }
      return q(...a);
    };
  };
  const connect = pool.connect.bind(pool) as any;
  (pool as any).connect = (cb?: any) => {
    if (cb) return connect((err: any, client: any, done: any) => { if (client) patch(client); cb(err, client, done); });
    return connect().then((c: any) => { patch(c); return c; });
  };
  app.addHook('onRequest', async (req) => { asked.tenant = seam.fromHeader ? (String(req.headers['x-tenant-id'] ?? '') || null) : null; });
  app.addHook('onResponse', async () => { asked.tenant = null; });
  // the URL-only cache: answers a repeated GET with whatever any tenant stored first
  app.addHook('onRequest', async (req, reply) => {
    if (!seam.cacheOn || req.method !== 'GET' || !req.url.startsWith('/api/v1/') || /^\/api\/v1\/(events|me|auth)/.test(req.url)) return;
    const hit = sharedCache.get(req.url);
    if (hit) { reply.status(hit.status).header('content-type', hit.type).send(hit.body); }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (seam.cacheOn && req.method === 'GET' && req.url.startsWith('/api/v1/') && !/^\/api\/v1\/(events|me|auth)/.test(req.url) && !sharedCache.has(req.url) && reply.statusCode === 200 && typeof payload === 'string') sharedCache.set(req.url, { status: 200, type: String(reply.getHeader('content-type') ?? 'application/json'), body: payload });
    return payload;
  });
}

/** Drop every `tenant_id = $n` predicate of a SELECT that reads `table` (the predicate becomes `($n::text is not null)`, so the parameter stays used). */
export const dropTenantPredicate = (read: RegExp): Rewrite => (sql, params) => {
  if (!/^\s*(with|select)/i.test(sql) || !read.test(sql)) return null;
  const out = sql.replace(/\b(?:[a-z]+\.)?tenant_id\s*=\s*\$(\d+)/gi, '($$$1::text is not null)');
  return out === sql ? null : { sql: out, params };
};
/** Use another tenant's id wherever a statement that reads `table` is given this tenant's id (a join or lookup with the wrong tenant). */
export const swapTenantParam = (read: RegExp, from: string, to: string): Rewrite => (sql, params) => {
  if (!/^\s*(with|select)/i.test(sql) || !read.test(sql) || !params.includes(from)) return null;
  return { sql, params: params.map((p) => (p === from ? to : p)) };
};
export const writeWithTenant = (stmt: RegExp, from: string, to: string): Rewrite => (sql, params) => {
  if (!stmt.test(sql) || params[0] !== from) return null;
  return { sql, params: [to, ...params.slice(1)] };
};
export const useSeams = (app: FastifyInstance) => SEAMS.get(app)!;
/** Apply a rewrite only for statements whose parameters satisfy `when` (a fault that hits one kind of lookup, not every one). */
export const onlyWhen = (when: (params: unknown[]) => boolean, r: Rewrite): Rewrite => (sql, params) => (when(params) ? r(sql, params) : null);
/** A fault that lets the request choose the tenant: while the header is present, every statement is given that tenant id instead of t-1. */
export const tenantFromHeader: Rewrite = (sql, params) => (asked.tenant && params.includes('t-1') ? { sql, params: params.map((p) => (p === 't-1' ? asked.tenant : p)) } : null);
/** A lookup by exact id and tenant becomes a lookup by id PREFIX across all tenants (a forged, shortened id finds another tenant's row). */
export const prefixLookup = (read: RegExp, predicate: RegExp): Rewrite => (sql, params) => {
  if (!/^\s*(with|select)/i.test(sql) || !read.test(sql) || !predicate.test(sql)) return null;
  return { sql: sql.replace(predicate, "($1::text is not null) and d.id like $2 || '%'"), params };
};
