import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RouteEntry } from './registry.ts';

/** Every registered route as `METHOD /path` without the /api/v1 prefix (HEAD twins and OPTIONS excluded). */
export function registeredRoutes(table: { method: string; url: string }[]): string[] {
  return [...new Set(table.filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS').map((r) => `${r.method} ${r.url.replace(/^\/api\/v1/, '')}`))].sort();
}

/** What is wrong with the route registry compared with the routes the app registered (empty = the registry covers 100 %). */
export function routeProblems(routes: string[], registry: Record<string, RouteEntry>): string[] {
  const out: string[] = [];
  for (const r of routes) if (!(r in registry)) out.push(`${r}: registered but has neither a contract entry nor an explicit exclusion (add it to server/test/contracts/registry.ts)`);
  for (const [k, e] of Object.entries(registry)) {
    if (!routes.includes(k)) out.push(`${k}: in the registry but no such route is registered (renamed or removed?)`);
    if ('exclude' in e && e.exclude.trim().length < 30) out.push(`${k}: an exclusion needs a real reason (at least 30 characters)`);
  }
  return out;
}

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
/** Event types the server code emits: every `type: 'a.b'` literal in server/src (all emit sites pass a literal). */
export function emittedEventTypes(srcDir = join(__dirname, '../../src')): string[] {
  const out = new Set<string>();
  for (const f of walk(srcDir)) for (const m of readFileSync(f, 'utf8').matchAll(/\btype: '([a-z]+\.[A-Za-z]+)'/g)) out.add(m[1]);
  return [...out].sort();
}

/** What is wrong with the event contracts: types without a validator, validators without a type, types emitted but not declared, declared but never emitted. */
export function eventProblems(types: readonly string[], validators: string[], emitted: string[]): string[] {
  const out: string[] = [];
  for (const t of types) if (!validators.includes(t)) out.push(`${t}: declared in EVENT_TYPES but has no payload validator (server/test/contracts/events.ts)`);
  for (const v of validators) if (!types.includes(v)) out.push(`${v}: has a payload validator but is not in EVENT_TYPES`);
  for (const e of emitted) if (!types.includes(e)) out.push(`${e}: emitted by the server but missing from EVENT_TYPES (shared/contracts/src/events.ts)`);
  for (const t of types) if (!emitted.includes(t)) out.push(`${t}: in EVENT_TYPES but no server code emits it (dead contract)`);
  return out;
}
