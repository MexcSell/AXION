import type { ErrorCode, ErrorEnvelope } from '@contracts';

/** Thin fetch wrapper for /api/v1: JSON in/out, X-CSRF on writes, the server's error envelope as ApiFailure. */
export class ApiFailure extends Error {
  constructor(public code: ErrorCode | 'NETWORK', public status: number, message: string, public correlationId?: string, public fieldErrors?: Record<string, string>, public retryable = false) { super(message); }
}

let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };

type Listener = (e: ApiFailure) => void;
const authLost = new Set<Listener>();
/** Called when any request reports the session is gone (revoked, expired). */
export function onAuthLost(f: Listener) { authLost.add(f); return () => authLost.delete(f); }

export interface ApiOpts { idempotencyKey?: string; ifMatch?: string | number; signal?: AbortSignal; quietAuth?: boolean }

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', path: string, body?: unknown, opts: ApiOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['x-csrf'] = csrf;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  if (opts.ifMatch !== undefined) headers['if-match'] = String(opts.ifMatch);
  let res: Response;
  try {
    res = await fetch('/api/v1' + path, { method, headers, credentials: 'same-origin', signal: opts.signal, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiFailure('NETWORK', 0, 'The AXION server is not reachable.', undefined, undefined, true);
  }
  const text = await res.text();
  let json: unknown = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* not JSON (proxy error page) */ }
  if (!res.ok) {
    const env = json as Partial<ErrorEnvelope> | undefined;
    if (!env?.code) throw new ApiFailure(res.status >= 500 ? 'UNAVAILABLE' : 'BAD_REQUEST', res.status, res.status === 502 || res.status === 504 ? 'The AXION server is not reachable.' : `Request failed (${res.status}).`, undefined, undefined, res.status >= 500);
    const f = new ApiFailure(env.code, res.status, env.message ?? 'Request failed.', env.correlationId, env.fieldErrors, env.retryable ?? false);
    if (res.status === 401 && !opts.quietAuth && (f.code === 'SESSION_REVOKED' || f.code === 'UNAUTHENTICATED')) authLost.forEach((l) => l(f));
    throw f;
  }
  return json as T;
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
