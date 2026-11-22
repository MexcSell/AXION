import { expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { type Browser } from '../helpers.ts';
import { check } from './validate.ts';
import { errorEnvelope } from './validators.ts';
import { ROUTES, routeKey } from './registry.ts';

/** Everything the coverage flow observed: a validated 2xx per route, a validated 403 per admin route, every other error shape. */
export const hits = new Set<string>();
export const gated = new Set<string>();
export const problems: string[] = [];
export const errorShapes: string[] = [];
/** The first valid body of each route, kept so the last test can prove every validator rejects a mutated copy. */
export const samples: Record<string, unknown> = {};
/** Every valid 2xx body per route, and the first happy request per route (replayed as a member by the sweep). */
export const bodies: Record<string, unknown[]> = {};
export const requests: Record<string, { method: string; url: string; body?: unknown }> = {};
/** The route each response was served by, from an onResponse hook (`routeOptions.url`), so a call can never be credited to a route it did not hit. */
export const served: { method: string; url: string }[] = [];
export const recordServed = (app: any) => { app.addHook('onResponse', async (req: any) => { served.push({ method: req.method, url: String(req.routeOptions?.url ?? '') }); }); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dump: Record<string, { status: number; body: unknown }[]> = {};

export interface Opt { body?: unknown; headers?: Record<string, string>; status?: number; query?: string }
let n = 0;
export const key = () => ({ 'idempotency-key': 'c50-' + Date.now() + '-' + n++ });

/** One validated call. `pattern` is the route as registered, without /api/v1 (":id" style). A 2xx is checked with the route's contract, anything else with the error envelope. */
export async function call(b: Browser, method: string, pattern: string, url: string, o: Opt = {}) {
  const want = o.status ?? 200;
  const before = served.length;
  const r = await b.req(method, url + (o.query ?? ''), o.body, o.headers);
  for (let i = 0; i < 50 && served.length === before; i++) await sleep(10);
  const last = served[served.length - 1];
  if (served.length === before || last.method !== method || last.url !== '/api/v1' + pattern) problems.push(`${method} ${url}: credited to ${pattern} but served by ${last?.method} ${last?.url}`);
  const label = `${method} ${url}${o.query ?? ''}`;
  const k = routeKey(method, pattern);
  (dump[k + ' ' + r.status] ??= []).push({ status: r.status, body: r.body });
  if (r.status !== want) { problems.push(`${label}: expected status ${want}, got ${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`); return r; }
  if (want >= 400) {
    const errs = check(label, errorEnvelope, r.body);
    problems.push(...errs);
    if (want !== 403) errorShapes.push(`${label} -> ${want} ${r.body?.code}`);
    return r;
  }
  const entry = ROUTES[k];
  if (!entry) { problems.push(`${label}: no registry entry for ${k}`); return r; }
  if ('exclude' in entry) { problems.push(`${label}: ${k} is excluded but was called as checked`); return r; }
  const errs = check(label, entry.v, r.body);
  problems.push(...errs);
  if (!errs.length) { (bodies[k] ??= []).push(r.body); requests[k] ??= { method, url: url + (o.query ?? ''), body: o.body }; hits.add(k); if (samples[k] === undefined || (Array.isArray(samples[k]) && !(samples[k] as unknown[]).length)) samples[k] = r.body; }
  return r;
}

export function writeDump() { if (process.env.C50_DUMP) writeFileSync(process.env.C50_DUMP, JSON.stringify(dump, null, 1)); }
export { expect };
