import { writeFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStream, Browser } from '../helpers.ts';
import { exportMissionToFile } from '../../src/otel/cli.ts';
import { idem, mutateTenant, type Tenant, type World } from './fixture.ts';

/**
 * Improvement cycle 79 (R4-4): the detector. The relations are the c79 author's construction, not taken from a paper:
 *  MR1  adding, changing or deleting tenant B's data never changes any GET response for tenant A (after a listed normalisation);
 *  MR3  a unique marker planted in every free-text field of tenant B appears nowhere in tenant A's responses, SSE stream, stored rows or export;
 *  W    tenant A acting on tenant B's ids on a write route gets 404 or 403 and changes nothing in B.
 * (The research file numbers MR2 "swap tenant ids" and MR4 "forged scope fields"; they are not part of this cycle.)
 */
/** The detector itself is not valid (rate-limited or crashed responses), never a finding: the test fails instead of counting it as a detection. */
export class DetectorInvalid extends Error {}
/** Fresh sessions for a tenant: some routes are limited per session (audit verify: 6 a minute), and a 429 must never look like a difference. */
export async function freshSessions(t: Tenant): Promise<Tenant> {
  const sign = async (name: string, old: Browser): Promise<Browser> => { const b = new Browser(t.app, old.ip, old.ua); for (const [k, x] of old.jar) if (k !== 'axion_sid') b.jar.set(k, x); /* keep the device cookie: a new device would wait for approval */ const r = await b.connect(name, 'pass1234'); if (r.status !== 200) throw new DetectorInvalid(`cannot sign ${name} in again: ${r.status}`); return b; };
  return { ...t, admin: await sign('Luca', t.admin), member: await sign(t.ids.memberName, t.member) };
}
const assertUsable = (snaps: { who: string; label: string; status: number }[]) => {
  const bad = snaps.filter((s) => s.status === 429 || s.status >= 500);
  if (bad.length) throw new DetectorInvalid('responses that make a comparison meaningless: ' + bad.slice(0, 3).map((s) => `${s.who} ${s.label} ${s.status}`).join(', '));
};
export interface Violation { relation: 'CONTROL' | 'MR1' | 'MR2' | 'MR3' | 'MR4' | 'FOREIGN-GET' | 'WRITE'; where: string; detail: string }

/** Pattern (as registered, without /api/v1) -> the value of each `:param` from a tenant's ids. First path segment + param name. */
const PARAM: Record<string, (i: Record<string, string>) => string> = {
  'missions:id': (i) => i.mission, 'missions:kind': () => 'task', 'missions:version': () => '1', 'missions:action': () => 'pause',
  'agent-instances:id': (i) => encodeURIComponent(i.instance),
  'agents:id': (i) => i.coder, 'agents:v': () => '1',
  'tasks:id': (i) => i.task, 'tasks:action': () => 'retry',
  'threads:id': (i) => i.thread,
  'lessons:lid': (i) => i.lesson, 'skills:sid': (i) => i.skill,
  'channels:key': () => 'gm', 'channels:userId': (i) => i.memberId,
  'organization:seq': (i) => i.revision ?? '1', 'organization:id': (i) => i.orgProposal,
  'uploads:id': (i) => i.upload,
  'users:id': (i) => i.memberId, 'users:did': (i) => i.device, 'users:action': () => 'block',
  'me:did': (i) => i.device,
  'version-proposals:pid': (i) => i.versionProposal, 'mentoring:pid': (i) => i.plan, 'mentoring:mid': (i) => i.milestone,
  'site-grants:id': (i) => i.grant, 'failure-tags:id': (i) => i.tag, 'approvals:id': (i) => i.approval, 'notifications:id': (i) => i.notification,
};
export function urlFor(pattern: string, ids: Record<string, string>): string | undefined {
  const first = pattern.split('/')[1];
  let missing = false;
  const url = pattern.replace(/:([A-Za-z]+)/g, (_m, p) => { const f = PARAM[`${first}:${p}`]; const v = f?.(ids); if (v === undefined || v === '') { missing = true; return ''; } return v; });
  return missing ? undefined : url;
}
/** Default query per GET route, so a route that needs one is exercised, plus extra variants. */
export const QUERY: Record<string, string[]> = {
  'GET /agents/:id/playbook/diff': ['?from=1&to=2'],
  'GET /organization/revisions/:seq/diff': ['?against=1'],
  'GET /site-grants/validate': ['?origin=' + encodeURIComponent('https://example.com')],
  'GET /failure-tags': ['?subjectKind=task&subjectId=__task__'],
  'GET /company/scorecard': ['?window=7d&includeDemo=1', ''],
  'GET /agent-instances': ['?agentId=gm', ''],
  'GET /channels/:key/messages': ['?limit=1', ''],
  'GET /company/throughput': ['?weeks=4'], 'GET /company/dimensions': ['?window=30d'], 'GET /company/failure-modes': ['?window=30d'],
  'GET /agents/:id/skills/compare': ['?with=__agent2__'], // c72: the route needs a second agent id; the foreign :id must still be refused (404), which this makes testable
  'GET /review-capacity': ['?windowDays=7', ''], 'GET /agents': ['?includeSimulated=1', ''],
};

/** GET routes excluded from the byte-comparison relation, each with the reason. Everything else in the route table is covered. */
export const GET_EXCEPTIONS: Record<string, string> = {
  'GET /events/stream': 'A live server-sent stream has no stable body to compare. It gets its own relation: the viewer\'s stream, kept open while the other tenant writes, may not carry any marker, and the viewer\'s own later write must arrive (so the stream was really being read).',
};
/** Routes that are global (no tenant data) but are still run through every relation, listed so the count is visible. */
export const GLOBAL_ROUTES: Record<string, string> = {
  'GET /health': 'Reports only whether the database answers and the build version. No tenant data.',
  'GET /auth/hello': 'Public, unauthenticated: one boolean, whether the app\'s tenant still has no user. No names, ids or text.',
};
/** Statuses a route may legitimately return for a tenant in this fixture, when not 200. */
export const ALLOWED_STATUS: { match: (key: string, who: Tenant) => boolean; statuses: number[]; why: string }[] = [
  { match: (k, w) => w.tenantId === 't-b' && /^GET \/organization\/revisions\/:seq/.test(k), statuses: [404], why: 'tenant B has no organisation chart (agent ids and the root id are global, see seedmock.ts)' },
];

/** c81: the id placeholders a QUERY value may hold, and where each comes from. A placeholder not listed here fails the inventory test. */
export const QUERY_ID_PLACEHOLDERS: Record<string, (i: Record<string, string>) => string> = { __task__: (i) => i.task ?? '', __agent2__: (i) => i.tester ?? '' };
export const fillQuery = (q: string, ids: Record<string, string>): string => q.replace(/__[a-z0-9]+__/g, (m) => QUERY_ID_PLACEHOLDERS[m]?.(ids) ?? m);
export interface GetCase { key: string; url: string; label: string }
export function getCases(t: Tenant, ids: Record<string, string> = t.ids): { cases: GetCase[]; skipped: string[] } {
  const cases: GetCase[] = []; const skipped: string[] = [];
  const keys = [...new Set(t.app.routeTable.filter((r) => r.method === 'GET').map((r) => 'GET ' + r.url.replace(/^\/api\/v1/, '')))].sort();
  for (const key of keys) {
    if (key in GET_EXCEPTIONS) continue;
    const base = urlFor(key.slice(4), ids);
    if (base === undefined) { skipped.push(key); continue; }
    for (const q of QUERY[key] ?? ['']) cases.push({ key, url: base + fillQuery(q, ids), label: key + (q ? ' ' + q : '') });
  }
  return { cases, skipped };
}

/** Normalisation of volatile fields, an explicit list (a key at any depth). The control run proves the list is enough. */
export const VOLATILE_KEYS: Record<string, string> = {
  correlationId: 'a fresh request id on every error body',
  csrf: 'a per-session token', now: 'the server clock',
  from: 'start of a rolling window, computed from the request time', to: 'end of a rolling window, computed from the request time',
  previousFrom: 'start of the previous rolling window', previousTo: 'end of the previous rolling window', windowStart: 'start of a rolling window',
  checkedAt: 'the time the report was computed', uptimeSec: 'process uptime', ageSec: 'age of an item, counted to the request time', expiresInSec: 'time to expiry, counted to the request time',
  avgOpen: 'Little-law average counted over a window that ends now', lambdaTimesW: 'the same figure, as arrival rate times wait',
};
/** Set-valued arrays whose order the product does not define (the query has no ORDER BY, so the database may return them in another order after a re-plan). Compared as sets. */
export const UNORDERED_KEYS: Record<string, string> = {
  // c81: empty. memberIds is now ordered by agent id, and gmReports is derived from it with its own tie-break.
};
export function normalise(v: unknown, key = ''): unknown {
  if (Array.isArray(v)) { const a = v.map((x) => normalise(x)); return key in UNORDERED_KEYS ? [...a].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))) : a; }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !(k in VOLATILE_KEYS)).map(([k, x]) => [k, normalise(x, k)]));
  return v;
}
export const canon = (raw: string): string => { try { return JSON.stringify(normalise(JSON.parse(raw))); } catch { return raw; } };

export interface Snap { who: string; label: string; key: string; status: number; text: string }
/** Every GET case as the admin and as the member of one tenant. `ids` lets a caller point the cases at another tenant's records. */
export async function snapshot(t: Tenant, cases: GetCase[], who: 'admin' | 'member' | 'both' = 'both'): Promise<Snap[]> {
  const out: Snap[] = [];
  for (const [name, b] of [['admin', t.admin], ['member', t.member]] as [string, Browser][]) {
    if (who !== 'both' && who !== name) continue;
    for (const c of cases) {
      const r = await b.req('GET', c.url);
      out.push({ who: name, label: c.label, key: c.key, status: r.status, text: r.raw.body });
    }
  }
  if (t.waiting && who === 'both') for (const c of cases.filter((x) => x.key === 'GET /auth/wait')) { const r = await t.waiting.req('GET', c.url); out.push({ who: 'waiting', label: c.label, key: c.key, status: r.status, text: r.raw.body }); }
  return out;
}
const sk = (s: Snap) => `${s.who} ${s.label}`;
export function diffSnaps(a: Snap[], b: Snap[], relation: Violation['relation']): Violation[] {
  const out: Violation[] = []; const bm = new Map(b.map((s) => [sk(s), s]));
  for (const s of a) {
    const o = bm.get(sk(s));
    if (!o) { out.push({ relation, where: sk(s), detail: 'missing in the second snapshot' }); continue; }
    if (s.status !== o.status) { out.push({ relation, where: sk(s), detail: `status ${s.status} -> ${o.status}` }); continue; }
    const x = canon(s.text), y = canon(o.text);
    if (x !== y) { let i = 0; while (i < x.length && x[i] === y[i]) i++; out.push({ relation, where: sk(s), detail: `body differs at char ${i}: ${JSON.stringify(x.slice(Math.max(0, i - 30), i + 60))} vs ${JSON.stringify(y.slice(Math.max(0, i - 30), i + 60))}` }); }
  }
  return out;
}

export const markerHits = (text: string, other: Tenant, where: string): Violation[] => {
  const low = text.toLowerCase(); const out: Violation[] = [];
  for (const [m, field] of other.markers) if (low.includes(m.toLowerCase())) out.push({ relation: 'MR3', where, detail: `marker ${m} (tenant ${other.tag}, field ${field}) found` });
  return out;
};

/** Tables with a tenant_id column in the schema, read at rest: every row of the viewer's tenant, as text. */
export async function atRestText(w: World, tenantId: string): Promise<{ table: string; text: string }[]> {
  const tabs = (await w.pool.query(`select table_name from information_schema.columns where table_schema = current_schema() and column_name = 'tenant_id' order by 1`)).rows.map((r) => r.table_name as string);
  const out: { table: string; text: string }[] = [];
  for (const t of tabs) out.push({ table: t, text: (await w.pool.query(`select coalesce(string_agg(row_to_json(x)::text, E'\\n'), '') as s from "${t}" x where tenant_id = $1`, [tenantId])).rows[0].s });
  return out;
}
export const AT_REST_COVERAGE = async (w: World) => {
  const all = (await w.pool.query(`select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => r.table_name as string);
  const withT = new Set((await w.pool.query(`select table_name from information_schema.columns where table_schema = current_schema() and column_name = 'tenant_id'`)).rows.map((r) => r.table_name as string));
  return { swept: all.filter((t) => withT.has(t)), notSwept: all.filter((t) => !withT.has(t)) };
};

/** The OTLP export (the c60 code, in process, on the test schema) of each of the viewer's missions, content included, and of each foreign mission id. */
export async function exportChecks(w: World, view: Tenant, other: Tenant): Promise<Violation[]> {
  const out: Violation[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'axion-c79-otlp-'));
  try {
    const mine = (await w.pool.query(`select id from missions where tenant_id = $1 and deleted_at is null order by id`, [view.tenantId])).rows.map((r) => r.id as string);
    for (const id of mine) {
      const f = join(dir, `${view.tag}-${id}.json`);
      try { await exportMissionToFile(view.app.db, { tenant: view.tenantId, missionId: id, out: f, includeContent: true, force: true }); out.push(...markerHits(readFileSync(f, 'utf8'), other, `export ${id}`)); }
      catch (e) { out.push({ relation: 'MR3', where: `export ${id}`, detail: 'export of the viewer\'s own mission failed: ' + (e as Error).message.slice(0, 200) }); }
    }
    const foreign = (await w.pool.query(`select id from missions where tenant_id = $1 order by id`, [other.tenantId])).rows.map((r) => r.id as string);
    for (const id of foreign) {
      const f = join(dir, `foreign-${id}.json`);
      let wrote = false;
      try { await exportMissionToFile(view.app.db, { tenant: view.tenantId, missionId: id, out: f, includeContent: true, force: true }); wrote = true; } catch { /* refused, as it must be */ }
      if (wrote) out.push({ relation: 'FOREIGN-GET', where: `export ${id}`, detail: `tenant ${view.tag} exported tenant ${other.tag}'s mission` }, ...markerHits(readFileSync(f, 'utf8'), other, `export ${id}`));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return out;
}

const waitUntil = async (f: () => boolean | Promise<boolean>, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };

/** GET with the other tenant's ids as this tenant: 404 or 403 (never 200) and no marker. */
export async function foreignGets(view: Tenant, other: Tenant): Promise<{ violations: Violation[]; tried: string[]; untried: string[] }> {
  const { cases, skipped } = getCases(view, other.ids);
  const violations: Violation[] = []; const tried: string[] = [];
  const idKeys = new Set(cases.filter((c) => c.key.includes(':')).map((c) => c.key));
  for (const [name, b] of [['admin', view.admin], ['member', view.member]] as [string, Browser][]) {
    for (const c of cases) {
      if (!idKeys.has(c.key) || NO_ID_NAMESPACE.has(c.key)) continue;
      const r = await b.req('GET', c.url);
      tried.push(`${name} ${c.label}`);
      if (![403, 404].includes(r.status)) violations.push({ relation: 'FOREIGN-GET', where: `${name} ${c.label}`, detail: `status ${r.status}, expected 404 or 403` });
      violations.push(...markerHits(r.raw.body, other, `${name} ${c.label}`));
    }
  }
  const rev = reverseQueryCases(view, other);
  for (const [name, b] of [['admin', view.admin], ['member', view.member]] as [string, Browser][]) {
    for (const c of rev.cases) {
      const r = await b.req('GET', c.url);
      tried.push(`${name} ${c.label}`);
      if (![403, 404].includes(r.status)) violations.push({ relation: 'FOREIGN-GET', where: `${name} ${c.label}`, detail: `status ${r.status}, expected 404 or 403` });
      violations.push(...markerHits(r.raw.body, other, `${name} ${c.label}`));
    }
  }
  return { violations, tried, untried: [...skipped, ...rev.skipped] };
}
/**
 * c81 (item 5): the reverse case. For every QUERY value that holds an id placeholder, the caller's OWN id in the path (where the route has one) and
 * the OTHER tenant's id in the query. A route that checks only the path id would answer 200 here. Generated from the QUERY map, not listed by hand.
 */
export function reverseQueryCases(view: Tenant, other: Tenant): { cases: GetCase[]; skipped: string[] } {
  const cases: GetCase[] = []; const skipped: string[] = [];
  const keys = [...new Set(view.app.routeTable.filter((r) => r.method === 'GET').map((r) => 'GET ' + r.url.replace(/^\/api\/v1/, '')))].sort();
  for (const key of keys) {
    const withId = (QUERY[key] ?? []).filter((q) => /__[a-z0-9]+__/.test(q));
    if (!withId.length) continue;
    const base = urlFor(key.slice(4), view.ids);
    if (base === undefined) { skipped.push(key); continue; }
    for (const q of withId) cases.push({ key, url: base + fillQuery(q, other.ids), label: key + ' ' + q + ' [own path, foreign query id]' });
  }
  return { cases, skipped };
}
/** Routes whose id is a per-tenant counter or a name that exists in both tenants, so a "foreign id" is not meaningful. */
export const NO_ID_NAMESPACE = new Set([
  'GET /organization/revisions/:seq', 'GET /organization/revisions/:seq/diff',
  'GET /channels/:key/messages', // the key is a channel name ('gm'): it always means the caller's own channel
  'GET /agents/:id/playbook/versions/:v',
]);

/** The whole detector for one (viewer, other) pair. Applies one round of changes to `other` between the two snapshots. */
export async function detect(w: World, view0: Tenant, other0: Tenant, round: number, opt: { skipExport?: boolean; arm?: () => void } = {}): Promise<{ violations: Violation[]; stats: Record<string, number> }> {
  const v: Violation[] = []; const stats: Record<string, number> = {};
  const view = await freshSessions(view0), other = await freshSessions(other0);
  opt.arm?.(); // a seeded fault is switched on only now: signing in again must not depend on it
  const { cases } = getCases(view);
  const sA = await openStream(view.base, view.admin); const sM = await openStream(view.base, view.member);
  try {
    await sA.waitFor((e) => e.event === 'hello'); await sM.waitFor((e) => e.event === 'hello');
    assertUsable(await snapshot(other, getCases(other).cases)); // the other tenant uses its own app first (this also primes any cache that is shared between tenants)
    await snapshot(view, cases); // warm-up: reading a channel or thread marks it read, which changes the unread counts once
    const s0 = await snapshot(view, cases);
    const s1 = await snapshot(view, cases);
    v.push(...diffSnaps(s0, s1, 'CONTROL')); // nothing changed: any difference is a volatile field missing from the list
    await mutateTenant(other, round);
    const s2 = await snapshot(view, cases);
    assertUsable([...s0, ...s1, ...s2]);
    v.push(...diffSnaps(s1, s2, 'MR1'));
    stats.getResponses = s0.length + s1.length + s2.length;
    for (const [i, s] of [s0, s1, s2].entries()) for (const x of s) v.push(...markerHits(x.text, other, `snapshot${i} ${sk(x)}`));
    // the viewer does something audited itself (a person asks to join and is approved), so a fault in how audit rows are chained shows up in its own chain
    const joiner = new Browser(view.app, `127.0.2.${20 + round % 200}`, 'Firefox on Linux');
    const jn = view.mk('viewer.user');
    const jr = await joiner.connect(jn, 'pass1234', { name: 'Tablet ' + view.mk('viewer.device'), kind: 'tablet', browser: 'Firefox' });
    if (jr.status !== 202) v.push({ relation: 'MR1', where: 'viewer activity: a person asks to join', detail: `status ${jr.status} ${JSON.stringify(jr.body)?.slice(0, 120)}, expected 202: the viewer's own audited write was disturbed` });
    const jid = ((await view.admin.req('GET', '/users')).body?.users as { id: string; name: string }[] | undefined)?.find((u) => u.name === jn)?.id;
    if (jid) { const ar = await view.admin.req('POST', `/users/${jid}/approve`); if (ar.status !== 200) v.push({ relation: 'MR1', where: 'viewer activity: approve', detail: `status ${ar.status}, expected 200: the viewer's own audited write was disturbed` }); }
    // SSE: the viewer writes after the other tenant's writes; once its own events arrive, the stream has passed everything before them
    const own = view.mk('sse.control');
    const before = Number((await w.pool.query(`select coalesce(max(id),0) as m from events where tenant_id=$1`, [view.tenantId])).rows[0].m);
    await view.admin.req('POST', '/channels/gm/messages', { kind: 'command', text: 'Control ' + own }, idem());
    await view.member.req('POST', '/channels/gm/messages', { kind: 'command', text: 'Control member ' + own }, idem());
    for (const [nm, s, uid] of [['admin', sA, view.ids.adminId], ['member', sM, view.ids.memberId]] as const) {
      const last = (await w.pool.query(`select id::text as id from events where tenant_id=$1 and id > $2 and audience_user=$3 order by id desc limit 1`, [view.tenantId, before, uid])).rows[0]?.id as string | undefined;
      const ok = last ? await s.waitFor((e) => e.id === last, 8000) : undefined;
      if (!ok) v.push({ relation: 'MR3', where: 'sse ' + nm, detail: 'the viewer\'s own control event never arrived, so the stream check proves nothing' });
    }
    for (const [nm, s] of [['admin', sA], ['member', sM]] as const) { for (const e of s.events) v.push(...markerHits(JSON.stringify(e), other, `sse ${nm} stream event ${e.id ?? e.event}`)); stats['sse' + nm] = s.events.length; }
    // stored rows of the viewer's tenant (audit rows, events, notifications ... every table that has a tenant_id)
    for (const r of await atRestText(w, view.tenantId)) v.push(...markerHits(r.text, other, `at rest ${r.table}`));
    const av = await view.admin.req('GET', '/audit/verify');
    if (av.status !== 200 || av.body?.ok !== true) v.push({ relation: 'MR1', where: 'GET /audit/verify', detail: 'the viewer\'s audit chain does not verify: ' + JSON.stringify(av.body).slice(0, 200) });
    if (!opt.skipExport) v.push(...(await exportChecks(w, view, other)));
    // a session of the other tenant is not a session here (a forged or replayed credential must not set the tenant)
    for (const [nm, b] of [['admin', other.admin], ['member', other.member]] as [string, Browser][]) {
      const r = await view.app.inject({ method: 'GET', url: '/api/v1/missions', remoteAddress: '127.0.0.1', headers: { cookie: [...b.jar].map(([k, x]) => `${k}=${x}`).join('; ') } });
      if (r.statusCode !== 401) v.push({ relation: 'FOREIGN-GET', where: `session of ${other.tag} ${nm} on the ${view.tag} app`, detail: `GET /missions answered ${r.statusCode}, expected 401` });
      v.push(...markerHits(r.body, other, `session of ${other.tag} ${nm}`));
    }
    const fg = await foreignGets(view, other);
    v.push(...fg.violations); stats.foreignGets = fg.tried.length;
    stats.cases = cases.length;
  } finally { sA.close(); sM.close(); await Promise.allSettled([sA.done, sM.done]); }
  return { violations: v, stats };
}
void writeFileSync;
